use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::SystemTime;
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmMemoryPathOverrides {
    pub claude_home: Option<String>,
    pub codex_home: Option<String>,
    pub codex_project_root: Option<String>,
    pub opencode_db_path: Option<String>,
    pub lingmo_home: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmMemorySessionListItem {
    pub platform: String,
    pub session_key: String,
    pub session_id: String,
    pub title: String,
    pub preview: String,
    pub updated_at: String,
    pub cwd: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmMemorySessionListResult {
    pub total: usize,
    pub items: Vec<LlmMemorySessionListItem>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmMemoryMessage {
    pub id: String,
    pub role: String,
    pub content: String,
    pub timestamp: String,
    pub editable: bool,
    pub edit_target: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmMemorySessionDetail {
    pub platform: String,
    pub session_key: String,
    pub session_id: String,
    pub title: String,
    pub cwd: String,
    pub commands: HashMap<String, String>,
    pub messages: Vec<LlmMemoryMessage>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmMemoryEditLogItem {
    pub id: i64,
    pub platform: String,
    pub session_key: String,
    pub session_id: String,
    pub cwd: String,
    pub edit_target: String,
    pub old_content: String,
    pub new_content: String,
    pub created_at: i64,
}

#[derive(Clone)]
struct SessionSummary {
    session_id: String,
    cwd: String,
    preview: String,
}

const SESSION_DETAIL_CACHE_MAX_ENTRIES: usize = 64;

fn session_detail_cache() -> &'static Mutex<HashMap<String, LlmMemorySessionDetail>> {
    static CACHE: OnceLock<Mutex<HashMap<String, LlmMemorySessionDetail>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn build_session_detail_cache_key(platform: &str, session_key: &str, source_path: &Path) -> String {
    format!("{platform}::{session_key}::{}", modified_nanos(source_path))
}

fn get_cached_session_detail(cache_key: &str) -> Option<LlmMemorySessionDetail> {
    session_detail_cache()
        .lock()
        .ok()
        .and_then(|cache| cache.get(cache_key).cloned())
}

fn put_cached_session_detail(cache_key: String, detail: &LlmMemorySessionDetail) {
    if let Ok(mut cache) = session_detail_cache().lock() {
        if cache.len() >= SESSION_DETAIL_CACHE_MAX_ENTRIES && !cache.contains_key(&cache_key) {
            cache.clear();
        }
        cache.insert(cache_key, detail.clone());
    }
}

fn invalidate_session_detail_cache(platform: &str, session_key: &str) {
    let prefix = format!("{platform}::{session_key}::");
    if let Ok(mut cache) = session_detail_cache().lock() {
        cache.retain(|cache_key, _| !cache_key.starts_with(&prefix));
    }
}

#[tauri::command]
pub fn llm_memory_list_sessions(
    app: AppHandle,
    platform: String,
    query: Option<String>,
    limit: Option<usize>,
    offset: Option<usize>,
    paths: Option<LlmMemoryPathOverrides>,
) -> Result<LlmMemorySessionListResult, String> {
    let normalized = normalize_platform(&platform)?;
    let query = query.unwrap_or_default();
    let limit = limit.unwrap_or(50);
    let offset = offset.unwrap_or(0);

    match normalized.as_str() {
        "claude" => list_claude_sessions(&query, limit, offset, &paths),
        "codex" => list_codex_sessions(&query, limit, offset, &paths),
        "opencode" => list_opencode_sessions(&query, limit, offset, &paths),
        "lingmo" => list_lingmo_sessions(&app, &query, limit, offset, &paths),
        _ => Err(format!("Unsupported platform: {platform}")),
    }
}

#[tauri::command]
pub fn llm_memory_get_session_detail(
    app: AppHandle,
    platform: String,
    session_key: String,
    paths: Option<LlmMemoryPathOverrides>,
) -> Result<LlmMemorySessionDetail, String> {
    let normalized = normalize_platform(&platform)?;

    match normalized.as_str() {
        "claude" => get_claude_session_detail(&session_key),
        "codex" => get_codex_session_detail(&session_key),
        "opencode" => get_opencode_session_detail(&session_key, &paths),
        "lingmo" => get_lingmo_session_detail(&app, &session_key, &paths),
        _ => Err(format!("Unsupported platform: {platform}")),
    }
}

#[tauri::command]
pub fn llm_memory_update_message(
    app: AppHandle,
    platform: String,
    edit_target: String,
    new_content: String,
    session_key: Option<String>,
    session_id: Option<String>,
    cwd: Option<String>,
    paths: Option<LlmMemoryPathOverrides>,
) -> Result<String, String> {
    let normalized = normalize_platform(&platform)?;

    let old_content = match normalized.as_str() {
        "claude" => update_claude_message(&edit_target, &new_content),
        "codex" => update_codex_message(&edit_target, &new_content),
        "opencode" => update_opencode_message(&edit_target, &new_content, &paths),
        "lingmo" => update_lingmo_message(&app, &edit_target, &new_content, &paths),
        _ => Err(format!("Unsupported platform: {platform}")),
    }?;

    let inferred_session_key = session_key
        .unwrap_or_else(|| infer_session_key_from_edit_target(&normalized, &edit_target));
    let inferred_session_id =
        session_id.unwrap_or_else(|| infer_session_id_from_session_key(&inferred_session_key));
    let inferred_cwd = cwd.unwrap_or_default();

    invalidate_session_detail_cache(&normalized, &inferred_session_key);

    insert_edit_log(
        &app,
        &LlmMemoryEditLogItem {
            id: 0,
            platform: normalized,
            session_key: inferred_session_key,
            session_id: inferred_session_id,
            cwd: inferred_cwd,
            edit_target,
            old_content: old_content.clone(),
            new_content,
            created_at: now_millis(),
        },
    )?;

    Ok(old_content)
}

#[tauri::command]
pub fn llm_memory_delete_session(
    app: AppHandle,
    platform: String,
    session_key: String,
    paths: Option<LlmMemoryPathOverrides>,
) -> Result<String, String> {
    let normalized = normalize_platform(&platform)?;

    let deleted = match normalized.as_str() {
        "claude" => delete_jsonl_session_file(&session_key, &resolve_claude_projects_root(&paths)?),
        "codex" => delete_jsonl_session_file(&session_key, &resolve_codex_sessions_root(&paths)?),
        "opencode" => delete_opencode_session(&session_key, &paths),
        "lingmo" => delete_lingmo_session(&app, &session_key, &paths),
        _ => Err(format!("Unsupported platform: {platform}")),
    }?;

    invalidate_session_detail_cache(&normalized, &session_key);
    Ok(deleted)
}

#[tauri::command]
pub fn llm_memory_delete_message(
    app: AppHandle,
    platform: String,
    edit_target: String,
    session_key: Option<String>,
    session_id: Option<String>,
    cwd: Option<String>,
    paths: Option<LlmMemoryPathOverrides>,
) -> Result<String, String> {
    let normalized = normalize_platform(&platform)?;
    let inferred_session_key = session_key
        .unwrap_or_else(|| infer_session_key_from_edit_target(&normalized, &edit_target));
    let _ = (session_id, cwd);

    let old_content = match normalized.as_str() {
        "claude" => delete_claude_message(&edit_target),
        "codex" => delete_codex_message(&edit_target),
        "opencode" => delete_opencode_message(&edit_target, &paths),
        "lingmo" => delete_lingmo_message(&app, &edit_target, &paths),
        _ => Err(format!("Unsupported platform: {platform}")),
    }?;

    invalidate_session_detail_cache(&normalized, &inferred_session_key);
    Ok(old_content)
}

#[tauri::command]
pub fn llm_memory_list_edit_logs(
    app: AppHandle,
    platform: String,
    session_key: String,
    limit: Option<usize>,
) -> Result<Vec<LlmMemoryEditLogItem>, String> {
    let normalized = normalize_platform(&platform)?;
    let conn = open_edit_log_db(&app)?;
    let max_rows = limit.unwrap_or(200).min(1000) as i64;

    let mut stmt = conn
        .prepare(
            "SELECT id, platform, session_key, session_id, cwd, edit_target, old_content, new_content, created_at
             FROM edit_log
             WHERE platform = ?1 AND session_key = ?2
             ORDER BY id DESC
             LIMIT ?3",
        )
        .map_err(|error| format!("Failed to prepare edit log query: {error}"))?;

    let mut rows = stmt
        .query(params![normalized, session_key, max_rows])
        .map_err(|error| format!("Failed to load edit log rows: {error}"))?;

    let mut items = Vec::new();
    while let Some(row) = rows
        .next()
        .map_err(|error| format!("Failed to read edit log row: {error}"))?
    {
        items.push(LlmMemoryEditLogItem {
            id: row.get(0).unwrap_or_default(),
            platform: row.get(1).unwrap_or_default(),
            session_key: row.get(2).unwrap_or_default(),
            session_id: row.get(3).unwrap_or_default(),
            cwd: row.get(4).unwrap_or_default(),
            edit_target: row.get(5).unwrap_or_default(),
            old_content: row.get(6).unwrap_or_default(),
            new_content: row.get(7).unwrap_or_default(),
            created_at: row.get(8).unwrap_or_default(),
        });
    }

    Ok(items)
}

#[tauri::command]
pub fn llm_memory_restore_message(
    app: AppHandle,
    log_id: i64,
    paths: Option<LlmMemoryPathOverrides>,
) -> Result<String, String> {
    let conn = open_edit_log_db(&app)?;
    let mut stmt = conn
        .prepare(
            "SELECT platform, session_key, session_id, cwd, edit_target, old_content, new_content
             FROM edit_log
             WHERE id = ?1",
        )
        .map_err(|error| format!("Failed to prepare restore query: {error}"))?;

    let Some(log) = stmt
        .query_row(params![log_id], |row| {
            Ok(LlmMemoryEditLogItem {
                id: log_id,
                platform: row.get(0)?,
                session_key: row.get(1)?,
                session_id: row.get(2)?,
                cwd: row.get(3)?,
                edit_target: row.get(4)?,
                old_content: row.get(5)?,
                new_content: row.get(6)?,
                created_at: 0,
            })
        })
        .optional()
        .map_err(|error| format!("Failed to read edit log: {error}"))?
    else {
        return Err(format!("Edit log not found: {log_id}"));
    };

    let normalized = normalize_platform(&log.platform)?;
    let current_content = match normalized.as_str() {
        "claude" => update_claude_message(&log.edit_target, &log.old_content),
        "codex" => update_codex_message(&log.edit_target, &log.old_content),
        "opencode" => update_opencode_message(&log.edit_target, &log.old_content, &paths),
        "lingmo" => update_lingmo_message(&app, &log.edit_target, &log.old_content, &paths),
        _ => Err(format!("Unsupported platform: {}", log.platform)),
    }?;

    invalidate_session_detail_cache(&normalized, &log.session_key);

    insert_edit_log(
        &app,
        &LlmMemoryEditLogItem {
            id: 0,
            platform: normalized,
            session_key: log.session_key,
            session_id: log.session_id,
            cwd: log.cwd,
            edit_target: log.edit_target,
            old_content: current_content.clone(),
            new_content: log.old_content,
            created_at: now_millis(),
        },
    )?;

    Ok(current_content)
}

fn normalize_platform(platform: &str) -> Result<String, String> {
    let normalized = platform.trim().to_lowercase();
    match normalized.as_str() {
        "claude" | "claudecode" | "claude-code" => Ok("claude".to_string()),
        "codex" | "codex-cli" => Ok("codex".to_string()),
        "opencode" => Ok("opencode".to_string()),
        "lingmo" => Ok("lingmo".to_string()),
        _ => Err(format!("Unsupported platform: {platform}")),
    }
}

fn list_claude_sessions(
    query: &str,
    limit: usize,
    offset: usize,
    paths: &Option<LlmMemoryPathOverrides>,
) -> Result<LlmMemorySessionListResult, String> {
    let projects_root = resolve_claude_projects_root(paths)?;
    if !projects_root.exists() {
        return Ok(LlmMemorySessionListResult {
            total: 0,
            items: Vec::new(),
        });
    }

    let mut files = Vec::new();
    collect_jsonl_recursive(&projects_root, &mut files);
    files.sort_by(|a, b| modified_nanos(b).cmp(&modified_nanos(a)));

    let needle = query.trim().to_lowercase();
    let mut items = Vec::new();

    for file_path in files {
        let session_key = encode_path_key(&file_path);
        let summary = scan_claude_summary(&file_path);
        let item = LlmMemorySessionListItem {
            platform: "claude".to_string(),
            session_key: session_key.clone(),
            session_id: summary.session_id.clone(),
            title: summary.session_id,
            preview: summary.preview,
            updated_at: modified_nanos(&file_path).to_string(),
            cwd: summary.cwd,
        };

        if needle.is_empty()
            || matches_session_item(&item, &needle)
            || file_contains_text(&file_path, &needle)
        {
            items.push(item);
        }
    }

    Ok(paginate_sessions(items, limit, offset))
}

fn list_codex_sessions(
    query: &str,
    limit: usize,
    offset: usize,
    paths: &Option<LlmMemoryPathOverrides>,
) -> Result<LlmMemorySessionListResult, String> {
    let sessions_root = resolve_codex_sessions_root(paths)?;
    let project_root = resolve_codex_project_root(paths);
    if !sessions_root.exists() {
        return Ok(LlmMemorySessionListResult {
            total: 0,
            items: Vec::new(),
        });
    }

    let mut files = Vec::new();
    collect_jsonl_recursive(&sessions_root, &mut files);
    files.sort_by(|a, b| modified_nanos(b).cmp(&modified_nanos(a)));

    let needle = query.trim().to_lowercase();
    let mut items = Vec::new();

    for file_path in files {
        let session_key = encode_path_key(&file_path);
        let summary = scan_codex_summary(&file_path);
        let item = LlmMemorySessionListItem {
            platform: "codex".to_string(),
            session_key: session_key.clone(),
            session_id: summary.session_id.clone(),
            title: summary.session_id,
            preview: summary.preview,
            updated_at: modified_nanos(&file_path).to_string(),
            cwd: summary.cwd,
        };

        if let Some(root) = project_root.as_deref() {
            if !path_is_within_root(&item.cwd, root) {
                continue;
            }
        }

        if needle.is_empty()
            || matches_session_item(&item, &needle)
            || file_contains_text(&file_path, &needle)
        {
            items.push(item);
        }
    }

    Ok(paginate_sessions(items, limit, offset))
}

fn list_opencode_sessions(
    query: &str,
    limit: usize,
    offset: usize,
    paths: &Option<LlmMemoryPathOverrides>,
) -> Result<LlmMemorySessionListResult, String> {
    let db_path = resolve_opencode_db_path(paths)?;
    if !db_path.exists() {
        return Ok(LlmMemorySessionListResult {
            total: 0,
            items: Vec::new(),
        });
    }

    let conn = rusqlite::Connection::open(&db_path)
        .map_err(|error| format!("Failed to open OpenCode database: {error}"))?;

    let needle = query.trim().to_lowercase();
    let mut all_items = Vec::new();

    let mut stmt = conn
        .prepare(
            "SELECT id, title, directory, time_updated FROM session ORDER BY time_updated DESC",
        )
        .map_err(|error| format!("Failed to query OpenCode sessions: {error}"))?;

    let mut rows = stmt
        .query([])
        .map_err(|error| format!("Failed to iterate OpenCode sessions: {error}"))?;

    while let Some(row) = rows
        .next()
        .map_err(|error| format!("Failed to read OpenCode row: {error}"))?
    {
        let session_id: String = row.get(0).unwrap_or_default();
        let title: String = row.get(1).unwrap_or_default();
        let cwd: String = row.get(2).unwrap_or_default();
        let updated_at: i64 = row.get(3).unwrap_or(0);

        let effective_title = if title.trim().is_empty() {
            session_id.clone()
        } else {
            title.clone()
        };

        if !needle.is_empty()
            && !effective_title.to_lowercase().contains(&needle)
            && !cwd.to_lowercase().contains(&needle)
            && !session_id.to_lowercase().contains(&needle)
            && !opencode_part_contains_text(&conn, &session_id, &needle)
        {
            continue;
        }

        all_items.push(LlmMemorySessionListItem {
            platform: "opencode".to_string(),
            session_key: session_id.clone(),
            session_id,
            title: effective_title,
            preview: title,
            updated_at: updated_at.to_string(),
            cwd,
        });
    }

    Ok(paginate_sessions(all_items, limit, offset))
}

fn get_claude_session_detail(session_key: &str) -> Result<LlmMemorySessionDetail, String> {
    let path = PathBuf::from(session_key);
    if !path.exists() {
        return Err(format!("Session file not found: {session_key}"));
    }

    let cache_key = build_session_detail_cache_key("claude", session_key, &path);
    if let Some(cached) = get_cached_session_detail(&cache_key) {
        return Ok(cached);
    }

    let lines = read_jsonl(&path)?;
    let session_id = lines
        .iter()
        .find_map(|line| line.get("sessionId").and_then(Value::as_str))
        .map(ToString::to_string)
        .unwrap_or_else(|| fallback_session_id(&path));

    let cwd = lines
        .iter()
        .find_map(|line| line.get("cwd").and_then(Value::as_str))
        .unwrap_or_default()
        .to_string();

    let mut messages = Vec::new();
    for (line_index, line) in lines.iter().enumerate() {
        let message_timestamp = line_timestamp(line);
        let Some(message) = line.get("message") else {
            continue;
        };

        let Some(role) = message.get("role").and_then(Value::as_str) else {
            continue;
        };

        if let Some(content) = message.get("content").and_then(Value::as_str) {
            if role == "user" || role == "assistant" {
                messages.push(LlmMemoryMessage {
                    id: format!("{line_index}:0:{role}"),
                    role: role.to_string(),
                    content: content.to_string(),
                    timestamp: message_timestamp.clone(),
                    editable: true,
                    edit_target: format!("{session_key}::{line_index}::0::content"),
                });
            }
            continue;
        }

        let Some(items) = message.get("content").and_then(Value::as_array) else {
            continue;
        };

        for (content_index, item) in items.iter().enumerate() {
            let item_type = item.get("type").and_then(Value::as_str).unwrap_or_default();
            if (role == "user" || role == "assistant") && item_type == "text" {
                let text = item
                    .get("text")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string();
                messages.push(LlmMemoryMessage {
                    id: format!("{line_index}:{content_index}:{role}"),
                    role: role.to_string(),
                    content: text,
                    timestamp: message_timestamp.clone(),
                    editable: true,
                    edit_target: format!("{session_key}::{line_index}::{content_index}::text"),
                });
            } else if role == "assistant" && (item_type == "thinking" || item_type == "reasoning") {
                let field_name = if item.get("thinking").is_some() {
                    "thinking"
                } else {
                    "text"
                };
                let text = item
                    .get(field_name)
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string();
                messages.push(LlmMemoryMessage {
                    id: format!("{line_index}:{content_index}:thinking"),
                    role: "thinking".to_string(),
                    content: text,
                    timestamp: message_timestamp.clone(),
                    editable: true,
                    edit_target: format!(
                        "{session_key}::{line_index}::{content_index}::{field_name}"
                    ),
                });
            }
        }
    }

    let detail = LlmMemorySessionDetail {
        platform: "claude".to_string(),
        session_key: session_key.to_string(),
        session_id: session_id.clone(),
        title: session_id.clone(),
        cwd,
        commands: build_commands("claude", &session_id),
        messages,
    };

    put_cached_session_detail(cache_key, &detail);
    Ok(detail)
}

fn get_codex_session_detail(session_key: &str) -> Result<LlmMemorySessionDetail, String> {
    let path = PathBuf::from(session_key);
    if !path.exists() {
        return Err(format!("Session file not found: {session_key}"));
    }

    let cache_key = build_session_detail_cache_key("codex", session_key, &path);
    if let Some(cached) = get_cached_session_detail(&cache_key) {
        return Ok(cached);
    }

    let lines = read_jsonl(&path)?;
    let session_id = lines
        .iter()
        .find_map(|line| {
            line.get("payload")
                .and_then(|payload| payload.get("id"))
                .and_then(Value::as_str)
        })
        .map(ToString::to_string)
        .unwrap_or_else(|| fallback_session_id(&path));

    let cwd = lines
        .iter()
        .find_map(|line| {
            line.get("payload")
                .and_then(|payload| payload.get("cwd"))
                .and_then(Value::as_str)
        })
        .unwrap_or_default()
        .to_string();

    let mut messages = Vec::new();
    for (line_index, line) in lines.iter().enumerate() {
        let message_timestamp = line_timestamp(line);
        let Some(payload) = line.get("payload") else {
            continue;
        };

        let payload_type = payload
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or_default();
        match payload_type {
            "user_message" => {
                let content = payload
                    .get("message")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string();
                messages.push(LlmMemoryMessage {
                    id: format!("{line_index}:user"),
                    role: "user".to_string(),
                    content,
                    timestamp: message_timestamp.clone(),
                    editable: true,
                    edit_target: format!("{session_key}::{line_index}"),
                });
            }
            "agent_message" => {
                let content = payload
                    .get("message")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string();
                messages.push(LlmMemoryMessage {
                    id: format!("{line_index}:assistant"),
                    role: "assistant".to_string(),
                    content,
                    timestamp: message_timestamp.clone(),
                    editable: true,
                    edit_target: format!("{session_key}::{line_index}"),
                });
            }
            "function_call" => {
                let name = payload
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or("function_call");
                let arguments = payload
                    .get("arguments")
                    .map(|value| {
                        serde_json::to_string_pretty(value).unwrap_or_else(|_| value.to_string())
                    })
                    .unwrap_or_default();
                let content = if arguments.is_empty() {
                    format!("Tool call: {name}")
                } else {
                    format!("Tool call: {name}\n{arguments}")
                };
                messages.push(LlmMemoryMessage {
                    id: format!("{line_index}:tool-call"),
                    role: "tool".to_string(),
                    content,
                    timestamp: message_timestamp.clone(),
                    editable: false,
                    edit_target: String::new(),
                });
            }
            "function_call_output" => {
                let output = payload
                    .get("output")
                    .map(|value| {
                        value.as_str().map(ToString::to_string).unwrap_or_else(|| {
                            serde_json::to_string_pretty(value)
                                .unwrap_or_else(|_| value.to_string())
                        })
                    })
                    .unwrap_or_default();
                if !output.trim().is_empty() {
                    messages.push(LlmMemoryMessage {
                        id: format!("{line_index}:tool-output"),
                        role: "tool".to_string(),
                        content: output,
                        timestamp: message_timestamp.clone(),
                        editable: false,
                        edit_target: String::new(),
                    });
                }
            }
            _ => {}
        }
    }

    let detail = LlmMemorySessionDetail {
        platform: "codex".to_string(),
        session_key: session_key.to_string(),
        session_id: session_id.clone(),
        title: session_id.clone(),
        cwd,
        commands: build_commands("codex", &session_id),
        messages,
    };

    put_cached_session_detail(cache_key, &detail);
    Ok(detail)
}

fn get_opencode_session_detail(
    session_key: &str,
    paths: &Option<LlmMemoryPathOverrides>,
) -> Result<LlmMemorySessionDetail, String> {
    let db_path = resolve_opencode_db_path(paths)?;
    if !db_path.exists() {
        return Err(format!(
            "OpenCode database not found: {}",
            db_path.display()
        ));
    }

    let cache_key = build_session_detail_cache_key("opencode", session_key, &db_path);
    if let Some(cached) = get_cached_session_detail(&cache_key) {
        return Ok(cached);
    }

    let conn = rusqlite::Connection::open(&db_path)
        .map_err(|error| format!("Failed to open OpenCode database: {error}"))?;

    let (session_title, cwd): (String, String) = conn
        .query_row(
            "SELECT title, directory FROM session WHERE id = ?1",
            params![session_key],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|error| format!("Failed to load session metadata: {error}"))?;

    let mut stmt = conn
        .prepare(
            "SELECT part.id, part.data, message.data, part.time_created
             FROM part
             JOIN message ON message.id = part.message_id
             WHERE part.session_id = ?1
             ORDER BY part.time_created ASC, part.id ASC",
        )
        .map_err(|error| format!("Failed to prepare parts query: {error}"))?;

    let mut rows = stmt
        .query(params![session_key])
        .map_err(|error| format!("Failed to query parts: {error}"))?;

    let mut messages = Vec::new();
    while let Some(row) = rows
        .next()
        .map_err(|error| format!("Failed to read part row: {error}"))?
    {
        let part_id: String = row.get(0).unwrap_or_default();
        let part_data: String = row.get(1).unwrap_or_default();
        let message_data: String = row.get(2).unwrap_or_default();
        let part_time_created: i64 = row.get(3).unwrap_or_default();
        let message_timestamp = if part_time_created > 0 {
            part_time_created.to_string()
        } else {
            String::new()
        };

        let data: Value = serde_json::from_str(&part_data).unwrap_or_default();
        let message_payload: Value = serde_json::from_str(&message_data).unwrap_or_default();
        let role = message_payload
            .get("role")
            .and_then(Value::as_str)
            .unwrap_or("assistant")
            .to_string();

        let part_type = data.get("type").and_then(Value::as_str).unwrap_or_default();
        match part_type {
            "text" => {
                let content = data
                    .get("text")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string();
                messages.push(LlmMemoryMessage {
                    id: part_id.clone(),
                    role,
                    content,
                    timestamp: message_timestamp.clone(),
                    editable: true,
                    edit_target: part_id.clone(),
                });
            }
            "reasoning" => {
                let content = data
                    .get("text")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string();
                messages.push(LlmMemoryMessage {
                    id: part_id.clone(),
                    role: "thinking".to_string(),
                    content,
                    timestamp: message_timestamp.clone(),
                    editable: true,
                    edit_target: part_id.clone(),
                });
            }
            "tool" => {
                let content = data
                    .get("state")
                    .and_then(|state| state.get("output"))
                    .or_else(|| data.get("output"))
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string();
                if !content.trim().is_empty() {
                    messages.push(LlmMemoryMessage {
                        id: part_id.clone(),
                        role: "tool".to_string(),
                        content,
                        timestamp: message_timestamp.clone(),
                        editable: true,
                        edit_target: part_id.clone(),
                    });
                }
            }
            _ => {}
        }
    }

    let title = if session_title.trim().is_empty() {
        session_key.to_string()
    } else {
        session_title
    };

    let detail = LlmMemorySessionDetail {
        platform: "opencode".to_string(),
        session_key: session_key.to_string(),
        session_id: session_key.to_string(),
        title,
        cwd,
        commands: build_commands("opencode", session_key),
        messages,
    };

    put_cached_session_detail(cache_key, &detail);
    Ok(detail)
}

fn update_claude_message(edit_target: &str, new_content: &str) -> Result<String, String> {
    let mut splitter = edit_target.rsplitn(4, "::");
    let field_name = splitter
        .next()
        .ok_or_else(|| "Invalid edit target (field)".to_string())?;
    let content_index = splitter
        .next()
        .ok_or_else(|| "Invalid edit target (content index)".to_string())?
        .parse::<usize>()
        .map_err(|error| format!("Invalid content index: {error}"))?;
    let line_index = splitter
        .next()
        .ok_or_else(|| "Invalid edit target (line index)".to_string())?
        .parse::<usize>()
        .map_err(|error| format!("Invalid line index: {error}"))?;
    let file_path = splitter
        .next()
        .ok_or_else(|| "Invalid edit target (file path)".to_string())?;

    let path = PathBuf::from(file_path);
    let mut rows = read_jsonl(&path)?;
    let Some(row) = rows.get_mut(line_index) else {
        return Err("Line index out of range".to_string());
    };
    let Some(message) = row.get_mut("message") else {
        return Err("Message payload missing".to_string());
    };

    let old_content = if field_name == "content" {
        let old = message
            .get("content")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        message["content"] = Value::String(new_content.to_string());
        old
    } else {
        let Some(items) = message.get_mut("content").and_then(Value::as_array_mut) else {
            return Err("Message content is not an array".to_string());
        };
        let Some(item) = items.get_mut(content_index) else {
            return Err("Content index out of range".to_string());
        };
        let old = item
            .get(field_name)
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        item[field_name] = Value::String(new_content.to_string());
        old
    };

    write_jsonl(&path, &rows)?;
    Ok(old_content)
}

fn update_codex_message(edit_target: &str, new_content: &str) -> Result<String, String> {
    let mut splitter = edit_target.rsplitn(2, "::");
    let line_index = splitter
        .next()
        .ok_or_else(|| "Invalid edit target (line index)".to_string())?
        .parse::<usize>()
        .map_err(|error| format!("Invalid line index: {error}"))?;
    let file_path = splitter
        .next()
        .ok_or_else(|| "Invalid edit target (file path)".to_string())?;

    let path = PathBuf::from(file_path);
    let mut rows = read_jsonl(&path)?;
    let Some(row) = rows.get_mut(line_index) else {
        return Err("Line index out of range".to_string());
    };
    let Some(payload) = row.get_mut("payload") else {
        return Err("Payload missing".to_string());
    };

    let old_content = payload
        .get("message")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    payload["message"] = Value::String(new_content.to_string());

    write_jsonl(&path, &rows)?;
    Ok(old_content)
}

fn delete_jsonl_session_file(session_key: &str, allowed_root: &Path) -> Result<String, String> {
    let path = PathBuf::from(session_key);
    if !path.exists() {
        return Err(format!("Session file not found: {session_key}"));
    }
    if path.extension().and_then(|value| value.to_str()) != Some("jsonl") {
        return Err("Only JSONL session files can be deleted".to_string());
    }

    let canonical_path = path
        .canonicalize()
        .map_err(|error| format!("Failed to resolve session file path: {error}"))?;
    let canonical_root = allowed_root
        .canonicalize()
        .map_err(|error| format!("Failed to resolve session root path: {error}"))?;
    if !canonical_path.starts_with(&canonical_root) {
        return Err(format!(
            "Refusing to delete session outside configured root: {}",
            canonical_path.display()
        ));
    }

    fs::remove_file(&canonical_path).map_err(|error| {
        format!(
            "Failed to delete session file {}: {error}",
            canonical_path.display()
        )
    })?;
    Ok(canonical_path.to_string_lossy().to_string())
}

fn delete_claude_message(edit_target: &str) -> Result<String, String> {
    let mut splitter = edit_target.rsplitn(4, "::");
    let field_name = splitter
        .next()
        .ok_or_else(|| "Invalid edit target (field)".to_string())?;
    let content_index = splitter
        .next()
        .ok_or_else(|| "Invalid edit target (content index)".to_string())?
        .parse::<usize>()
        .map_err(|error| format!("Invalid content index: {error}"))?;
    let line_index = splitter
        .next()
        .ok_or_else(|| "Invalid edit target (line index)".to_string())?
        .parse::<usize>()
        .map_err(|error| format!("Invalid line index: {error}"))?;
    let file_path = splitter
        .next()
        .ok_or_else(|| "Invalid edit target (file path)".to_string())?;

    let path = PathBuf::from(file_path);
    let mut rows = read_jsonl(&path)?;
    let Some(row) = rows.get_mut(line_index) else {
        return Err("Line index out of range".to_string());
    };
    let Some(message) = row.get_mut("message") else {
        return Err("Message payload missing".to_string());
    };

    let old_content = if field_name == "content" {
        let old = message
            .get("content")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        rows.remove(line_index);
        old
    } else {
        let Some(items) = message.get_mut("content").and_then(Value::as_array_mut) else {
            return Err("Message content is not an array".to_string());
        };
        if content_index >= items.len() {
            return Err("Content index out of range".to_string());
        }
        let old = items
            .get(content_index)
            .and_then(|item| item.get(field_name))
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        items.remove(content_index);
        if items.is_empty() {
            rows.remove(line_index);
        }
        old
    };

    write_jsonl(&path, &rows)?;
    Ok(old_content)
}

fn delete_codex_message(edit_target: &str) -> Result<String, String> {
    let mut splitter = edit_target.rsplitn(2, "::");
    let line_index = splitter
        .next()
        .ok_or_else(|| "Invalid edit target (line index)".to_string())?
        .parse::<usize>()
        .map_err(|error| format!("Invalid line index: {error}"))?;
    let file_path = splitter
        .next()
        .ok_or_else(|| "Invalid edit target (file path)".to_string())?;

    let path = PathBuf::from(file_path);
    let mut rows = read_jsonl(&path)?;
    let Some(row) = rows.get(line_index) else {
        return Err("Line index out of range".to_string());
    };
    let old_content = row
        .get("payload")
        .and_then(|payload| payload.get("message"))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    rows.remove(line_index);

    write_jsonl(&path, &rows)?;
    Ok(old_content)
}

fn update_opencode_message(
    edit_target: &str,
    new_content: &str,
    paths: &Option<LlmMemoryPathOverrides>,
) -> Result<String, String> {
    let db_path = resolve_opencode_db_path(paths)?;
    if !db_path.exists() {
        return Err(format!(
            "OpenCode database not found: {}",
            db_path.display()
        ));
    }

    let conn = rusqlite::Connection::open(&db_path)
        .map_err(|error| format!("Failed to open OpenCode database: {error}"))?;

    let data_str: String = conn
        .query_row(
            "SELECT data FROM part WHERE id = ?1",
            params![edit_target],
            |row| row.get(0),
        )
        .map_err(|error| format!("Part not found: {error}"))?;

    let mut payload: Value = serde_json::from_str(&data_str)
        .map_err(|error| format!("Failed to parse part payload: {error}"))?;
    let part_type = payload
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or_default();

    let old_content = match part_type {
        "text" | "reasoning" => {
            let old = payload
                .get("text")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            payload["text"] = Value::String(new_content.to_string());
            old
        }
        "tool" => {
            let old = payload
                .get("state")
                .and_then(|state| state.get("output"))
                .or_else(|| payload.get("output"))
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            if payload.get("state").is_none() {
                payload["state"] = serde_json::json!({});
            }
            payload["state"]["output"] = Value::String(new_content.to_string());
            old
        }
        _ => String::new(),
    };

    let updated_payload = serde_json::to_string(&payload)
        .map_err(|error| format!("Failed to serialize updated payload: {error}"))?;
    conn.execute(
        "UPDATE part SET data = ?1 WHERE id = ?2",
        params![updated_payload, edit_target],
    )
    .map_err(|error| format!("Failed to update part: {error}"))?;

    Ok(old_content)
}

fn extract_opencode_part_content(payload: &Value) -> String {
    match payload
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or_default()
    {
        "text" | "reasoning" => payload
            .get("text")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        "tool" => payload
            .get("state")
            .and_then(|state| state.get("output"))
            .or_else(|| payload.get("output"))
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        _ => String::new(),
    }
}

fn delete_opencode_message(
    edit_target: &str,
    paths: &Option<LlmMemoryPathOverrides>,
) -> Result<String, String> {
    let db_path = resolve_opencode_db_path(paths)?;
    if !db_path.exists() {
        return Err(format!(
            "OpenCode database not found: {}",
            db_path.display()
        ));
    }

    let conn = rusqlite::Connection::open(&db_path)
        .map_err(|error| format!("Failed to open OpenCode database: {error}"))?;

    let (data_str, message_id): (String, String) = conn
        .query_row(
            "SELECT data, message_id FROM part WHERE id = ?1",
            params![edit_target],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|error| format!("Part not found: {error}"))?;

    let payload: Value = serde_json::from_str(&data_str)
        .map_err(|error| format!("Failed to parse part payload: {error}"))?;
    let old_content = extract_opencode_part_content(&payload);

    conn.execute("DELETE FROM part WHERE id = ?1", params![edit_target])
        .map_err(|error| format!("Failed to delete part: {error}"))?;

    let remaining_parts: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM part WHERE message_id = ?1",
            params![message_id],
            |row| row.get(0),
        )
        .unwrap_or(0);
    if remaining_parts == 0 {
        let _ = conn.execute("DELETE FROM message WHERE id = ?1", params![message_id]);
    }

    Ok(old_content)
}

fn delete_opencode_session(
    session_key: &str,
    paths: &Option<LlmMemoryPathOverrides>,
) -> Result<String, String> {
    let db_path = resolve_opencode_db_path(paths)?;
    if !db_path.exists() {
        return Err(format!(
            "OpenCode database not found: {}",
            db_path.display()
        ));
    }

    let conn = rusqlite::Connection::open(&db_path)
        .map_err(|error| format!("Failed to open OpenCode database: {error}"))?;
    let exists: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM session WHERE id = ?1",
            params![session_key],
            |row| row.get(0),
        )
        .map_err(|error| format!("Failed to check OpenCode session: {error}"))?;
    if exists == 0 {
        return Err(format!("OpenCode session not found: {session_key}"));
    }

    conn.execute(
        "DELETE FROM part WHERE message_id IN (SELECT id FROM message WHERE session_id = ?1)",
        params![session_key],
    )
    .map_err(|error| format!("Failed to delete OpenCode parts: {error}"))?;
    conn.execute(
        "DELETE FROM message WHERE session_id = ?1",
        params![session_key],
    )
    .map_err(|error| format!("Failed to delete OpenCode messages: {error}"))?;
    conn.execute("DELETE FROM session WHERE id = ?1", params![session_key])
        .map_err(|error| format!("Failed to delete OpenCode session: {error}"))?;

    Ok(session_key.to_string())
}

fn resolve_claude_projects_root(paths: &Option<LlmMemoryPathOverrides>) -> Result<PathBuf, String> {
    if let Some(path) = paths
        .as_ref()
        .and_then(|value| value.claude_home.as_ref())
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    {
        return Ok(PathBuf::from(path).join("projects"));
    }

    Ok(home_dir()?.join(".claude").join("projects"))
}

fn resolve_codex_sessions_root(paths: &Option<LlmMemoryPathOverrides>) -> Result<PathBuf, String> {
    if let Some(path) = paths
        .as_ref()
        .and_then(|value| value.codex_home.as_ref())
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    {
        return Ok(PathBuf::from(path).join("sessions"));
    }

    Ok(home_dir()?.join(".codex").join("sessions"))
}

fn resolve_codex_project_root(paths: &Option<LlmMemoryPathOverrides>) -> Option<String> {
    paths
        .as_ref()
        .and_then(|value| value.codex_project_root.as_ref())
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn resolve_opencode_db_path(paths: &Option<LlmMemoryPathOverrides>) -> Result<PathBuf, String> {
    if let Some(path) = paths
        .as_ref()
        .and_then(|value| value.opencode_db_path.as_ref())
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    {
        return Ok(PathBuf::from(path));
    }

    let home = home_dir()?;
    let candidates = default_opencode_candidates(&home);

    if let Some(existing) = candidates.iter().find(|path| path.exists()) {
        return Ok(existing.clone());
    }

    candidates
        .into_iter()
        .next()
        .ok_or_else(|| "Cannot resolve OpenCode database path".to_string())
}

fn default_opencode_candidates(home: &Path) -> Vec<PathBuf> {
    let mut candidates = vec![home
        .join(".local")
        .join("share")
        .join("opencode")
        .join("opencode.db")];

    #[cfg(windows)]
    {
        if let Ok(appdata) = std::env::var("APPDATA") {
            candidates.push(PathBuf::from(appdata).join("opencode").join("opencode.db"));
        }
        candidates.push(
            home.join("AppData")
                .join("Roaming")
                .join("opencode")
                .join("opencode.db"),
        );
        candidates.push(home.join(".opencode").join("opencode.db"));
    }

    candidates
}

fn home_dir() -> Result<PathBuf, String> {
    dirs::home_dir().ok_or_else(|| "Cannot resolve user home directory".to_string())
}

fn read_jsonl(path: &Path) -> Result<Vec<Value>, String> {
    let file =
        File::open(path).map_err(|error| format!("Failed to open {}: {error}", path.display()))?;
    let reader = BufReader::new(file);
    let mut rows = Vec::new();

    for line in reader.lines() {
        let line = line.map_err(|error| format!("Failed to read {}: {error}", path.display()))?;
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if let Ok(value) = serde_json::from_str::<Value>(trimmed) {
            rows.push(value);
        }
    }

    Ok(rows)
}

fn write_jsonl(path: &Path, rows: &[Value]) -> Result<(), String> {
    let serialized = rows
        .iter()
        .map(serde_json::to_string)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Failed to serialize JSONL rows: {error}"))?;

    fs::write(path, format!("{}\n", serialized.join("\n")))
        .map_err(|error| format!("Failed to write {}: {error}", path.display()))
}

fn collect_jsonl_recursive(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_jsonl_recursive(&path, out);
        } else if path.extension().and_then(|extension| extension.to_str()) == Some("jsonl") {
            out.push(path);
        }
    }
}

fn modified_nanos(path: &Path) -> u128 {
    fs::metadata(path)
        .and_then(|metadata| metadata.modified())
        .and_then(|time| {
            time.duration_since(SystemTime::UNIX_EPOCH)
                .map_err(std::io::Error::other)
        })
        .map(|duration| duration.as_nanos())
        .unwrap_or(0)
}

fn encode_path_key(path: &Path) -> String {
    path.canonicalize()
        .unwrap_or_else(|_| path.to_path_buf())
        .to_string_lossy()
        .replace('\\', "/")
}

fn fallback_session_id(path: &Path) -> String {
    path.file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or("unknown")
        .to_string()
}

fn timestamp_to_string(value: &Value) -> Option<String> {
    if let Some(text) = value.as_str() {
        let trimmed = text.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
    }
    if let Some(number) = value.as_i64() {
        return Some(number.to_string());
    }
    if let Some(number) = value.as_u64() {
        return Some(number.to_string());
    }
    None
}

fn line_timestamp(line: &Value) -> String {
    line.get("timestamp")
        .and_then(timestamp_to_string)
        .or_else(|| {
            line.get("payload")
                .and_then(|payload| payload.get("timestamp"))
                .and_then(timestamp_to_string)
        })
        .unwrap_or_default()
}

fn scan_claude_summary(path: &Path) -> SessionSummary {
    let default_id = fallback_session_id(path);
    let Ok(file) = File::open(path) else {
        return SessionSummary {
            session_id: default_id,
            cwd: String::new(),
            preview: String::new(),
        };
    };
    let reader = BufReader::new(file);

    let mut session_id = String::new();
    let mut cwd = String::new();
    let mut preview = String::new();

    for line in reader.lines().flatten() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let Ok(parsed) = serde_json::from_str::<Value>(trimmed) else {
            continue;
        };

        if session_id.is_empty() {
            if let Some(value) = parsed.get("sessionId").and_then(Value::as_str) {
                session_id = value.to_string();
            }
        }

        if cwd.is_empty() {
            if let Some(value) = parsed.get("cwd").and_then(Value::as_str) {
                cwd = value.to_string();
            }
        }

        if preview.is_empty() {
            if let Some(message) = parsed.get("message") {
                let role = message
                    .get("role")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                if role == "user" || role == "assistant" {
                    if let Some(text) = message.get("content").and_then(Value::as_str) {
                        let candidate = sanitize_preview(text);
                        if !candidate.is_empty() {
                            preview = truncate_chars(&candidate, 120);
                        }
                    } else if let Some(items) = message.get("content").and_then(Value::as_array) {
                        for item in items {
                            if item.get("type").and_then(Value::as_str) == Some("text") {
                                if let Some(text) = item.get("text").and_then(Value::as_str) {
                                    let candidate = sanitize_preview(text);
                                    if !candidate.is_empty() {
                                        preview = truncate_chars(&candidate, 120);
                                        break;
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        if !session_id.is_empty() && !cwd.is_empty() && !preview.is_empty() {
            break;
        }
    }

    SessionSummary {
        session_id: if session_id.is_empty() {
            default_id
        } else {
            session_id
        },
        cwd,
        preview,
    }
}

fn scan_codex_summary(path: &Path) -> SessionSummary {
    let default_id = fallback_session_id(path);
    let Ok(file) = File::open(path) else {
        return SessionSummary {
            session_id: default_id,
            cwd: String::new(),
            preview: String::new(),
        };
    };
    let reader = BufReader::new(file);

    let mut session_id = String::new();
    let mut cwd = String::new();
    let mut preview = String::new();

    for line in reader.lines().flatten() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let Ok(parsed) = serde_json::from_str::<Value>(trimmed) else {
            continue;
        };
        let Some(payload) = parsed.get("payload") else {
            continue;
        };

        if session_id.is_empty() {
            if let Some(value) = payload.get("id").and_then(Value::as_str) {
                session_id = value.to_string();
            }
        }
        if cwd.is_empty() {
            if let Some(value) = payload.get("cwd").and_then(Value::as_str) {
                cwd = value.to_string();
            }
        }
        if preview.is_empty() {
            let payload_type = payload
                .get("type")
                .and_then(Value::as_str)
                .unwrap_or_default();
            if payload_type == "user_message" || payload_type == "agent_message" {
                if let Some(value) = payload.get("message").and_then(Value::as_str) {
                    let candidate = sanitize_preview(value);
                    if !candidate.is_empty() {
                        preview = truncate_chars(&candidate, 120);
                    }
                }
            }
        }

        if !session_id.is_empty() && !cwd.is_empty() && !preview.is_empty() {
            break;
        }
    }

    SessionSummary {
        session_id: if session_id.is_empty() {
            default_id
        } else {
            session_id
        },
        cwd,
        preview,
    }
}

fn sanitize_preview(text: &str) -> String {
    let mut content = text.trim().to_string();
    let start_tag = "<local-command-caveat>";
    let end_tag = "</local-command-caveat>";

    if content.contains(start_tag) && content.contains(end_tag) {
        if let Some(position) = content.find(end_tag) {
            content = content[position + end_tag.len()..].trim().to_string();
        }
    }

    content.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn truncate_chars(text: &str, max_chars: usize) -> String {
    let chars: Vec<char> = text.chars().collect();
    if chars.len() <= max_chars {
        return text.to_string();
    }
    chars.into_iter().take(max_chars).collect()
}

fn matches_session_item(item: &LlmMemorySessionListItem, needle: &str) -> bool {
    item.session_id.to_lowercase().contains(needle)
        || item.title.to_lowercase().contains(needle)
        || item.preview.to_lowercase().contains(needle)
        || item.cwd.to_lowercase().contains(needle)
}

fn file_contains_text(path: &Path, needle: &str) -> bool {
    fs::read_to_string(path)
        .map(|content| content.to_lowercase().contains(needle))
        .unwrap_or(false)
}

fn opencode_part_contains_text(
    conn: &rusqlite::Connection,
    session_id: &str,
    needle: &str,
) -> bool {
    let mut stmt = match conn.prepare("SELECT data FROM part WHERE session_id = ?1") {
        Ok(statement) => statement,
        Err(_) => return false,
    };

    let mut rows = match stmt.query(params![session_id]) {
        Ok(rows) => rows,
        Err(_) => return false,
    };

    while let Ok(Some(row)) = rows.next() {
        let data: String = row.get(0).unwrap_or_default();
        if data.to_lowercase().contains(needle) {
            return true;
        }
    }

    false
}

fn path_is_within_root(path: &str, root: &str) -> bool {
    let normalized_path = normalize_path_for_prefix(path);
    let normalized_root = normalize_path_for_prefix(root);

    if normalized_path.is_empty() || normalized_root.is_empty() {
        return false;
    }

    normalized_path == normalized_root
        || normalized_path.starts_with(&format!("{normalized_root}/"))
}

fn normalize_path_for_prefix(path: &str) -> String {
    let mut value = path.trim().replace('\\', "/");
    while value.ends_with('/') {
        value.pop();
    }
    #[cfg(windows)]
    {
        value = value.to_lowercase();
    }
    value
}

fn infer_session_key_from_edit_target(platform: &str, edit_target: &str) -> String {
    match platform {
        "claude" => edit_target
            .rsplitn(4, "::")
            .last()
            .unwrap_or(edit_target)
            .to_string(),
        "codex" => edit_target
            .rsplitn(2, "::")
            .last()
            .unwrap_or(edit_target)
            .to_string(),
        "lingmo" => {
            if let Some(pos) = edit_target.rfind("::") {
                edit_target[..pos].to_string()
            } else {
                edit_target.to_string()
            }
        }
        _ => edit_target.to_string(),
    }
}

fn resolve_lingmo_db_path(
    app: &AppHandle,
    paths: &Option<LlmMemoryPathOverrides>,
) -> Result<PathBuf, String> {
    if let Some(path) = paths
        .as_ref()
        .and_then(|value| value.lingmo_home.as_ref())
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    {
        return Ok(PathBuf::from(path));
    }

    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Failed to resolve app data dir: {error}"))?;
    Ok(app_data_dir.join("note.db"))
}

fn list_lingmo_sessions(
    app: &AppHandle,
    query: &str,
    limit: usize,
    offset: usize,
    paths: &Option<LlmMemoryPathOverrides>,
) -> Result<LlmMemorySessionListResult, String> {
    let db_path = resolve_lingmo_db_path(app, paths)?;
    if !db_path.exists() {
        return Ok(LlmMemorySessionListResult {
            total: 0,
            items: Vec::new(),
        });
    }

    let conn = rusqlite::Connection::open(&db_path)
        .map_err(|error| format!("Failed to open LingMo database: {error}"))?;

    let needle = query.trim().to_lowercase();
    let mut items = Vec::new();

    let mut stmt = conn
        .prepare(
            "SELECT id, title, createdAt, updatedAt, messageCount FROM conversations ORDER BY updatedAt DESC",
        )
        .map_err(|error| format!("Failed to query LingMo conversations: {error}"))?;

    let mut rows = stmt
        .query([])
        .map_err(|error| format!("Failed to iterate LingMo conversations: {error}"))?;

    while let Some(row) = rows
        .next()
        .map_err(|error| format!("Failed to read LingMo conversation row: {error}"))?
    {
        let id: i64 = row.get(0).unwrap_or_default();
        let title: String = row.get(1).unwrap_or_default();
        let _created_at: i64 = row.get(2).unwrap_or_default();
        let updated_at: i64 = row.get(3).unwrap_or_default();
        let message_count: i64 = row.get(4).unwrap_or_default();

        let session_id = id.to_string();
        let effective_title = if title.trim().is_empty() {
            format!("会话 {}", session_id)
        } else {
            title.clone()
        };

        if !needle.is_empty()
            && !effective_title.to_lowercase().contains(&needle)
            && !session_id.to_lowercase().contains(&needle)
        {
            continue;
        }

        items.push(LlmMemorySessionListItem {
            platform: "lingmo".to_string(),
            session_key: session_id.clone(),
            session_id,
            title: effective_title,
            preview: format!("{} 条消息", message_count),
            updated_at: updated_at.to_string(),
            cwd: String::new(),
        });
    }

    Ok(paginate_sessions(items, limit, offset))
}

fn get_lingmo_session_detail(
    app: &AppHandle,
    session_key: &str,
    paths: &Option<LlmMemoryPathOverrides>,
) -> Result<LlmMemorySessionDetail, String> {
    let db_path = resolve_lingmo_db_path(app, paths)?;
    if !db_path.exists() {
        return Err(format!(
            "LingMo database not found: {}",
            db_path.display()
        ));
    }

    let cache_key = build_session_detail_cache_key("lingmo", session_key, &db_path);
    if let Some(cached) = get_cached_session_detail(&cache_key) {
        return Ok(cached);
    }

    let conn = rusqlite::Connection::open(&db_path)
        .map_err(|error| format!("Failed to open LingMo database: {error}"))?;

    let conversation_id: i64 = session_key
        .parse()
        .map_err(|_| format!("Invalid LingMo session key: {session_key}"))?;

    let (title, _created_at, _updated_at): (String, i64, i64) = conn
        .query_row(
            "SELECT title, createdAt, updatedAt FROM conversations WHERE id = ?1",
            params![conversation_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .map_err(|error| format!("Failed to load LingMo conversation: {error}"))?;

    let mut stmt = conn
        .prepare(
            "SELECT id, content, role, type, createdAt, thinking FROM chats WHERE conversationId = ?1 ORDER BY createdAt ASC"
        )
        .map_err(|error| format!("Failed to prepare LingMo chats query: {error}"))?;

    let mut rows = stmt
        .query(params![conversation_id])
        .map_err(|error| format!("Failed to query LingMo chats: {error}"))?;

    let mut messages = Vec::new();
    while let Some(row) = rows
        .next()
        .map_err(|error| format!("Failed to read LingMo chat row: {error}"))?
    {
        let id: i64 = row.get(0).unwrap_or_default();
        let content: String = row.get(1).unwrap_or_default();
        let role: String = row.get(2).unwrap_or_default();
        let _chat_type: String = row.get(3).unwrap_or_default();
        let created_at: i64 = row.get(4).unwrap_or_default();
        let thinking: Option<String> = row.get(5).ok();

        let llm_role = if role == "user" { "user" } else { "assistant" };

        if let Some(thinking_content) = thinking {
            if !thinking_content.trim().is_empty() {
                messages.push(LlmMemoryMessage {
                    id: format!("{}_thinking", id),
                    role: "thinking".to_string(),
                    content: thinking_content,
                    timestamp: created_at.to_string(),
                    editable: true,
                    edit_target: format!("{}::{}_thinking", session_key, id),
                });
            }
        }

        messages.push(LlmMemoryMessage {
            id: id.to_string(),
            role: llm_role.to_string(),
            content,
            timestamp: created_at.to_string(),
            editable: true,
            edit_target: format!("{}::{}", session_key, id),
        });
    }

    let session_id = if title.trim().is_empty() {
        session_key.to_string()
    } else {
        title
    };

    let detail = LlmMemorySessionDetail {
        platform: "lingmo".to_string(),
        session_key: session_key.to_string(),
        session_id: session_id.clone(),
        title: session_id.clone(),
        cwd: String::new(),
        commands: build_commands("lingmo", session_key),
        messages,
    };

    put_cached_session_detail(cache_key, &detail);
    Ok(detail)
}

fn update_lingmo_message(
    app: &AppHandle,
    edit_target: &str,
    new_content: &str,
    paths: &Option<LlmMemoryPathOverrides>,
) -> Result<String, String> {
    let db_path = resolve_lingmo_db_path(app, paths)?;
    if !db_path.exists() {
        return Err(format!(
            "LingMo database not found: {}",
            db_path.display()
        ));
    }

    let conn = rusqlite::Connection::open(&db_path)
        .map_err(|error| format!("Failed to open LingMo database: {error}"))?;

    let chat_id: i64 = if let Some(pos) = edit_target.rfind("::") {
        edit_target[pos + 2..]
            .replace("_thinking", "")
            .parse()
            .map_err(|_| format!("Invalid LingMo edit target: {edit_target}"))?
    } else {
        edit_target
            .replace("_thinking", "")
            .parse()
            .map_err(|_| format!("Invalid LingMo edit target: {edit_target}"))?
    };

    let is_thinking = edit_target.ends_with("_thinking");

    let (old_content,): (String,) = conn
        .query_row(
            if is_thinking {
                "SELECT thinking FROM chats WHERE id = ?1"
            } else {
                "SELECT content FROM chats WHERE id = ?1"
            },
            params![chat_id],
            |row| Ok((row.get(0)?,)),
        )
        .map_err(|error| format!("Chat not found: {error}"))?;

    conn.execute(
        if is_thinking {
            "UPDATE chats SET thinking = ?1 WHERE id = ?2"
        } else {
            "UPDATE chats SET content = ?1 WHERE id = ?2"
        },
        params![new_content, chat_id],
    )
    .map_err(|error| format!("Failed to update LingMo chat: {error}"))?;

    Ok(old_content)
}

fn delete_lingmo_message(
    app: &AppHandle,
    edit_target: &str,
    paths: &Option<LlmMemoryPathOverrides>,
) -> Result<String, String> {
    let db_path = resolve_lingmo_db_path(app, paths)?;
    if !db_path.exists() {
        return Err(format!(
            "LingMo database not found: {}",
            db_path.display()
        ));
    }

    let conn = rusqlite::Connection::open(&db_path)
        .map_err(|error| format!("Failed to open LingMo database: {error}"))?;

    let chat_id: i64 = if let Some(pos) = edit_target.rfind("::") {
        edit_target[pos + 2..]
            .replace("_thinking", "")
            .parse()
            .map_err(|_| format!("Invalid LingMo edit target: {edit_target}"))?
    } else {
        edit_target
            .replace("_thinking", "")
            .parse()
            .map_err(|_| format!("Invalid LingMo edit target: {edit_target}"))?
    };

    let is_thinking = edit_target.ends_with("_thinking");

    let (old_content,): (String,) = conn
        .query_row(
            if is_thinking {
                "SELECT thinking FROM chats WHERE id = ?1"
            } else {
                "SELECT content FROM chats WHERE id = ?1"
            },
            params![chat_id],
            |row| Ok((row.get(0)?,)),
        )
        .map_err(|error| format!("Chat not found: {error}"))?;

    if is_thinking {
        conn.execute("UPDATE chats SET thinking = NULL WHERE id = ?1", params![chat_id])
            .map_err(|error| format!("Failed to clear LingMo thinking: {error}"))?;
    } else {
        conn.execute("DELETE FROM chats WHERE id = ?1", params![chat_id])
            .map_err(|error| format!("Failed to delete LingMo chat: {error}"))?;
    }

    Ok(old_content)
}

fn delete_lingmo_session(
    app: &AppHandle,
    session_key: &str,
    paths: &Option<LlmMemoryPathOverrides>,
) -> Result<String, String> {
    let db_path = resolve_lingmo_db_path(app, paths)?;
    if !db_path.exists() {
        return Err(format!(
            "LingMo database not found: {}",
            db_path.display()
        ));
    }

    let conn = rusqlite::Connection::open(&db_path)
        .map_err(|error| format!("Failed to open LingMo database: {error}"))?;

    let conversation_id: i64 = session_key
        .parse()
        .map_err(|_| format!("Invalid LingMo session key: {session_key}"))?;

    let exists: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM conversations WHERE id = ?1",
            params![conversation_id],
            |row| row.get(0),
        )
        .map_err(|error| format!("Failed to check LingMo conversation: {error}"))?;

    if exists == 0 {
        return Err(format!("LingMo conversation not found: {session_key}"));
    }

    conn.execute(
        "DELETE FROM chats WHERE conversationId = ?1",
        params![conversation_id],
    )
    .map_err(|error| format!("Failed to delete LingMo chats: {error}"))?;

    conn.execute(
        "DELETE FROM conversations WHERE id = ?1",
        params![conversation_id],
    )
    .map_err(|error| format!("Failed to delete LingMo conversation: {error}"))?;

    Ok(session_key.to_string())
}

fn infer_session_id_from_session_key(session_key: &str) -> String {
    if session_key.trim().is_empty() {
        return String::new();
    }

    let path = Path::new(session_key);
    if let Some(stem) = path.file_stem().and_then(|value| value.to_str()) {
        return stem.to_string();
    }

    session_key.to_string()
}

fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or_default()
}

fn open_edit_log_db(app: &AppHandle) -> Result<rusqlite::Connection, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Failed to resolve app data dir: {error}"))?;
    let db_dir = app_data_dir.join("llm-memory");
    fs::create_dir_all(&db_dir)
        .map_err(|error| format!("Failed to create llm-memory directory: {error}"))?;

    let db_path = db_dir.join("edit-log.db");
    let conn = rusqlite::Connection::open(&db_path)
        .map_err(|error| format!("Failed to open edit log database: {error}"))?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS edit_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            platform TEXT NOT NULL,
            session_key TEXT NOT NULL,
            session_id TEXT NOT NULL DEFAULT '',
            cwd TEXT NOT NULL DEFAULT '',
            edit_target TEXT NOT NULL,
            old_content TEXT NOT NULL DEFAULT '',
            new_content TEXT NOT NULL DEFAULT '',
            created_at INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_edit_log_platform_session
            ON edit_log(platform, session_key, id DESC);",
    )
    .map_err(|error| format!("Failed to initialize edit log table: {error}"))?;

    Ok(conn)
}

fn insert_edit_log(app: &AppHandle, item: &LlmMemoryEditLogItem) -> Result<(), String> {
    let conn = open_edit_log_db(app)?;
    conn.execute(
        "INSERT INTO edit_log
        (platform, session_key, session_id, cwd, edit_target, old_content, new_content, created_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            item.platform,
            item.session_key,
            item.session_id,
            item.cwd,
            item.edit_target,
            item.old_content,
            item.new_content,
            item.created_at
        ],
    )
    .map_err(|error| format!("Failed to insert edit log: {error}"))?;

    Ok(())
}

fn paginate_sessions(
    items: Vec<LlmMemorySessionListItem>,
    limit: usize,
    offset: usize,
) -> LlmMemorySessionListResult {
    let total = items.len();
    let start = offset.min(total);
    let end = (start.saturating_add(limit)).min(total);
    let page = items[start..end].to_vec();

    LlmMemorySessionListResult { total, items: page }
}

fn build_commands(platform: &str, session_id: &str) -> HashMap<String, String> {
    let mut commands = HashMap::new();
    match platform {
        "claude" => {
            commands.insert(
                "resume".to_string(),
                format!("claude --resume {session_id}"),
            );
            commands.insert(
                "fork".to_string(),
                format!("claude --resume {session_id} --fork-session"),
            );
        }
        "codex" => {
            commands.insert("resume".to_string(), format!("codex resume {session_id}"));
        }
        "opencode" => {
            commands.insert("resume".to_string(), format!("opencode -s {session_id}"));
            commands.insert(
                "fork".to_string(),
                format!("opencode -s {session_id} --fork"),
            );
        }
        "lingmo" => {
            commands.insert("resume".to_string(), format!("LingMo session {session_id}"));
        }
        _ => {}
    }
    commands
}

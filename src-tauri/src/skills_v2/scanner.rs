use std::path::{Path, PathBuf};
use serde::Serialize;
use uuid::Uuid;
use walkdir::WalkDir;
use crate::skills_v2::content_hash::hash_directory;
use crate::skills_v2::skill_metadata::{is_skill_directory, parse_skill_md, sanitize_skill_name};
use crate::skills_v2::db::{DiscoveredSkill, SkillStore};
use crate::skills_v2::error::SkillResult;

#[derive(Debug, Clone, Serialize)]
pub struct ToolAdapter {
    pub key: String,
    pub name: String,
    pub skills_dirs: Vec<PathBuf>,
}

fn home_dir() -> Option<PathBuf> {
    dirs::home_dir()
}

pub fn get_tool_adapters() -> Vec<ToolAdapter> {
    let home = match home_dir() {
        Some(h) => h,
        None => return vec![],
    };

    let mut adapters = vec![];

    // Claude Code
    let claude_dirs = vec![
        home.join(".claude").join("commands"),
        home.join(".claude").join("skills"),
    ];
    adapters.push(ToolAdapter {
        key: "claude-code".into(),
        name: "Claude Code".into(),
        skills_dirs: claude_dirs,
    });

    // Cursor
    let cursor_dirs = vec![
        home.join(".cursor").join("commands"),
        home.join(".cursor").join("rules"),
    ];
    adapters.push(ToolAdapter {
        key: "cursor".into(),
        name: "Cursor".into(),
        skills_dirs: cursor_dirs,
    });

    // Windsurf
    let windsurf_dirs = vec![
        home.join(".codeium").join("windsurf").join("commands"),
    ];
    adapters.push(ToolAdapter {
        key: "windsurf".into(),
        name: "Windsurf".into(),
        skills_dirs: windsurf_dirs,
    });

    adapters
}

#[derive(Debug, Clone, Serialize)]
pub struct ScanResult {
    pub discovered: Vec<DiscoveredSkill>,
    pub total_scanned: u32,
    pub new_count: u32,
}

pub fn scan_all_tools(store: &SkillStore) -> SkillResult<ScanResult> {
    let adapters = get_tool_adapters();
    let mut discovered = vec![];
    let mut total_scanned = 0u32;

    let now = chrono::Utc::now().timestamp();

    // Clear previous unimported discoveries
    store.clear_discovered()?;

    for adapter in &adapters {
        for skills_dir in &adapter.skills_dirs {
            if !skills_dir.exists() {
                continue;
            }

            for entry in WalkDir::new(skills_dir)
                .max_depth(3)
                .follow_links(true)
                .into_iter()
                .filter_map(|e| e.ok())
            {
                let path = entry.path();
                if !path.is_dir() {
                    continue;
                }
                total_scanned += 1;

                if !is_skill_directory(path) {
                    continue;
                }

                let meta = parse_skill_md(path).ok().flatten();
                let name_guess = meta
                    .as_ref()
                    .and_then(|m| m.name.clone())
                    .unwrap_or_else(|| {
                        path.file_name()
                            .and_then(|n| n.to_str())
                            .unwrap_or("unknown")
                            .to_string()
                    });

                let fingerprint = hash_directory(path);
                let record = DiscoveredSkill {
                    id: Uuid::new_v4().to_string(),
                    tool_key: adapter.key.clone(),
                    found_path: path.to_string_lossy().to_string(),
                    name_guess: Some(sanitize_skill_name(&name_guess)),
                    fingerprint: fingerprint.clone(),
                    imported: false,
                    discovered_at: now,
                };

                store.insert_discovered(&record)?;
                discovered.push(record);
            }
        }
    }

    let new_count = discovered.len() as u32;

    Ok(ScanResult {
        discovered,
        total_scanned,
        new_count,
    })
}

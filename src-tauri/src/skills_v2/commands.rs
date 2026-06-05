use crate::skills_v2::db::{DiscoveredSkill, ScenarioRecord, SkillRecord, SkillStore};
use crate::skills_v2::git_fetcher::PreviewSkill;
use crate::skills_v2::installer;
use crate::skills_v2::scanner;
use crate::skills_v2::skillssh_api::{self, SkillsShSkill};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

pub struct SkillState(pub Mutex<SkillStore>);

#[tauri::command]
pub fn skill_v2_get_all(state: State<'_, SkillState>) -> Result<Vec<SkillRecord>, String> {
    let store = state.0.lock().map_err(|e| e.to_string())?;
    store.get_all_skills().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn skill_v2_get_by_id(
    id: String,
    state: State<'_, SkillState>,
) -> Result<Option<SkillRecord>, String> {
    let store = state.0.lock().map_err(|e| e.to_string())?;
    store.get_skill_by_id(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn skill_v2_delete(
    id: String,
    app: AppHandle,
    state: State<'_, SkillState>,
) -> Result<bool, String> {
    let (deleted, record) = {
        let store = state.0.lock().map_err(|e| e.to_string())?;
        let record = store.get_skill_by_id(&id).map_err(|e| e.to_string())?;
        let deleted = store.delete_skill(&id).map_err(|e| e.to_string())?;
        (deleted, record)
    };

    if deleted {
        if let Some(record) = record {
            let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
            let central_root = app_data_dir.join("skills");
            let central_path = std::path::PathBuf::from(record.central_path);

            if central_path.exists() {
                let canonical_root = central_root
                    .canonicalize()
                    .unwrap_or_else(|_| central_root.clone());
                let canonical_target = central_path
                    .canonicalize()
                    .unwrap_or_else(|_| central_path.clone());

                if canonical_target.starts_with(&canonical_root)
                    && canonical_target != canonical_root
                {
                    if canonical_target.is_dir() {
                        std::fs::remove_dir_all(&canonical_target).map_err(|e| e.to_string())?;
                    } else {
                        std::fs::remove_file(&canonical_target).map_err(|e| e.to_string())?;
                    }
                }
            }
        }
    }

    Ok(deleted)
}

#[tauri::command]
pub fn skill_v2_set_enabled(
    id: String,
    enabled: bool,
    state: State<'_, SkillState>,
) -> Result<bool, String> {
    let store = state.0.lock().map_err(|e| e.to_string())?;
    store
        .set_skill_enabled(&id, enabled)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn skill_v2_scan(state: State<'_, SkillState>) -> Result<scanner::ScanResult, String> {
    let store = state.0.lock().map_err(|e| e.to_string())?;
    scanner::scan_all_tools(&store).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn skill_v2_get_discovered(
    state: State<'_, SkillState>,
) -> Result<Vec<DiscoveredSkill>, String> {
    let store = state.0.lock().map_err(|e| e.to_string())?;
    store.get_all_discovered().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn skill_v2_import_discovered(
    discovered_id: String,
    app: AppHandle,
    state: State<'_, SkillState>,
) -> Result<SkillRecord, String> {
    let store = state.0.lock().map_err(|e| e.to_string())?;
    let discovered = store.get_all_discovered().map_err(|e| e.to_string())?;
    let item = discovered
        .iter()
        .find(|d| d.id == discovered_id)
        .ok_or("Discovered skill not found")?;

    let source_path = std::path::Path::new(&item.found_path);
    if !source_path.exists() {
        return Err("Source path no longer exists".into());
    }

    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let record = installer::install_from_local_dir(
        source_path,
        &app_data_dir,
        &store,
        item.name_guess.as_deref(),
    )
    .map_err(|e| e.to_string())?;
    store
        .mark_discovered_imported(&discovered_id)
        .map_err(|e| e.to_string())?;

    Ok(record)
}

// --- Scenario Commands ---

#[tauri::command]
pub fn skill_v2_get_scenarios(state: State<'_, SkillState>) -> Result<Vec<ScenarioRecord>, String> {
    let store = state.0.lock().map_err(|e| e.to_string())?;
    store.get_all_scenarios().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn skill_v2_create_scenario(
    name: String,
    description: Option<String>,
    icon: Option<String>,
    state: State<'_, SkillState>,
) -> Result<ScenarioRecord, String> {
    let store = state.0.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().timestamp();
    let record = ScenarioRecord {
        id: uuid::Uuid::new_v4().to_string(),
        name,
        description,
        icon,
        sort_order: 0,
        created_at: now,
        updated_at: now,
    };
    store.insert_scenario(&record).map_err(|e| e.to_string())?;
    Ok(record)
}

#[tauri::command]
pub fn skill_v2_delete_scenario(id: String, state: State<'_, SkillState>) -> Result<bool, String> {
    let store = state.0.lock().map_err(|e| e.to_string())?;
    store.delete_scenario(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn skill_v2_get_active_scenario(
    state: State<'_, SkillState>,
) -> Result<Option<String>, String> {
    let store = state.0.lock().map_err(|e| e.to_string())?;
    store.get_active_scenario_id().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn skill_v2_switch_scenario(
    scenario_id: Option<String>,
    state: State<'_, SkillState>,
) -> Result<(), String> {
    let store = state.0.lock().map_err(|e| e.to_string())?;
    store
        .set_active_scenario(scenario_id.as_deref())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn skill_v2_add_to_scenario(
    scenario_id: String,
    skill_id: String,
    state: State<'_, SkillState>,
) -> Result<(), String> {
    let store = state.0.lock().map_err(|e| e.to_string())?;
    store
        .add_skill_to_scenario(&scenario_id, &skill_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn skill_v2_remove_from_scenario(
    scenario_id: String,
    skill_id: String,
    state: State<'_, SkillState>,
) -> Result<(), String> {
    let store = state.0.lock().map_err(|e| e.to_string())?;
    store
        .remove_skill_from_scenario(&scenario_id, &skill_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn skill_v2_get_scenario_skills(
    scenario_id: String,
    state: State<'_, SkillState>,
) -> Result<Vec<SkillRecord>, String> {
    let store = state.0.lock().map_err(|e| e.to_string())?;
    store
        .get_scenario_skills(&scenario_id)
        .map_err(|e| e.to_string())
}

// --- Install Commands ---

#[tauri::command]
pub fn skill_v2_preview_git(url: String) -> Result<Vec<PreviewSkill>, String> {
    installer::preview_git(&url).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn skill_v2_install_git(
    url: String,
    name: Option<String>,
    app: AppHandle,
    state: State<'_, SkillState>,
) -> Result<SkillRecord, String> {
    let store = state.0.lock().map_err(|e| e.to_string())?;
    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    installer::install_from_git(&url, &app_data_dir, &store, name.as_deref())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn skill_v2_install_archive(
    path: String,
    app: AppHandle,
    state: State<'_, SkillState>,
) -> Result<SkillRecord, String> {
    let store = state.0.lock().map_err(|e| e.to_string())?;
    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    installer::install_from_archive(std::path::Path::new(&path), &app_data_dir, &store)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn skill_v2_install_local_dir(
    path: String,
    name: Option<String>,
    app: AppHandle,
    state: State<'_, SkillState>,
) -> Result<SkillRecord, String> {
    let store = state.0.lock().map_err(|e| e.to_string())?;
    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    installer::install_from_local_dir(
        std::path::Path::new(&path),
        &app_data_dir,
        &store,
        name.as_deref(),
    )
    .map_err(|e| e.to_string())
}

// --- Marketplace Commands ---

#[tauri::command]
pub fn skill_v2_fetch_leaderboard(board: String) -> Result<Vec<SkillsShSkill>, String> {
    let board_type = skillssh_api::LeaderboardType::from_str(&board);
    skillssh_api::fetch_leaderboard(board_type)
}

#[tauri::command]
pub fn skill_v2_search_skillssh(
    query: String,
    limit: Option<usize>,
) -> Result<Vec<SkillsShSkill>, String> {
    let bounded = limit.unwrap_or(60).clamp(1, 300);
    skillssh_api::search_skills(&query, bounded)
}

#[tauri::command]
pub fn skill_v2_install_from_skillssh(
    source: String,
    skill_id: String,
    app: AppHandle,
    state: State<'_, SkillState>,
) -> Result<SkillRecord, String> {
    let repo_url = format!("https://github.com/{}.git", source);
    let store = state.0.lock().map_err(|e| e.to_string())?;
    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;

    let result = installer::install_from_git(&repo_url, &app_data_dir, &store, Some(&skill_id))
        .map_err(|e| e.to_string())?;
    Ok(result)
}

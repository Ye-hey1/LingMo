use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};
use crate::skills_v2::db::{SkillRecord, SkillStore, DiscoveredSkill, ScenarioRecord};
use crate::skills_v2::scanner;
use crate::skills_v2::installer;
use crate::skills_v2::git_fetcher::PreviewSkill;
use crate::skills_v2::skillssh_api::{self, SkillsShSkill};

pub struct SkillState(pub Mutex<SkillStore>);

#[tauri::command]
pub fn skill_v2_get_all(state: State<'_, SkillState>) -> Result<Vec<SkillRecord>, String> {
    let store = state.0.lock().map_err(|e| e.to_string())?;
    store.get_all_skills().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn skill_v2_get_by_id(id: String, state: State<'_, SkillState>) -> Result<Option<SkillRecord>, String> {
    let store = state.0.lock().map_err(|e| e.to_string())?;
    store.get_skill_by_id(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn skill_v2_delete(id: String, state: State<'_, SkillState>) -> Result<bool, String> {
    let store = state.0.lock().map_err(|e| e.to_string())?;
    store.delete_skill(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn skill_v2_set_enabled(id: String, enabled: bool, state: State<'_, SkillState>) -> Result<bool, String> {
    let store = state.0.lock().map_err(|e| e.to_string())?;
    store.set_skill_enabled(&id, enabled).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn skill_v2_scan(state: State<'_, SkillState>) -> Result<scanner::ScanResult, String> {
    let store = state.0.lock().map_err(|e| e.to_string())?;
    scanner::scan_all_tools(&store).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn skill_v2_get_discovered(state: State<'_, SkillState>) -> Result<Vec<DiscoveredSkill>, String> {
    let store = state.0.lock().map_err(|e| e.to_string())?;
    store.get_all_discovered().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn skill_v2_import_discovered(
    discovered_id: String,
    state: State<'_, SkillState>,
) -> Result<SkillRecord, String> {
    let store = state.0.lock().map_err(|e| e.to_string())?;
    let discovered = store.get_all_discovered().map_err(|e| e.to_string())?;
    let item = discovered.iter().find(|d| d.id == discovered_id)
        .ok_or("Discovered skill not found")?;

    let source_path = std::path::Path::new(&item.found_path);
    if !source_path.exists() {
        return Err("Source path no longer exists".into());
    }

    let name = item.name_guess.clone().unwrap_or_else(|| "unnamed".into());
    let now = chrono::Utc::now().timestamp();

    let record = SkillRecord {
        id: uuid::Uuid::new_v4().to_string(),
        name: name.clone(),
        description: None,
        source_type: "local".into(),
        source_ref: Some(item.found_path.clone()),
        source_ref_resolved: None,
        source_subpath: None,
        source_branch: None,
        source_revision: None,
        remote_revision: None,
        central_path: item.found_path.clone(),
        content_hash: crate::skills_v2::content_hash::hash_directory(source_path),
        enabled: true,
        status: "ok".into(),
        update_status: "unknown".into(),
        created_at: now,
        updated_at: now,
    };

    store.insert_skill(&record).map_err(|e| e.to_string())?;
    store.mark_discovered_imported(&discovered_id).map_err(|e| e.to_string())?;

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
pub fn skill_v2_get_active_scenario(state: State<'_, SkillState>) -> Result<Option<String>, String> {
    let store = state.0.lock().map_err(|e| e.to_string())?;
    store.get_active_scenario_id().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn skill_v2_switch_scenario(scenario_id: Option<String>, state: State<'_, SkillState>) -> Result<(), String> {
    let store = state.0.lock().map_err(|e| e.to_string())?;
    store.set_active_scenario(scenario_id.as_deref()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn skill_v2_add_to_scenario(
    scenario_id: String,
    skill_id: String,
    state: State<'_, SkillState>,
) -> Result<(), String> {
    let store = state.0.lock().map_err(|e| e.to_string())?;
    store.add_skill_to_scenario(&scenario_id, &skill_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn skill_v2_remove_from_scenario(
    scenario_id: String,
    skill_id: String,
    state: State<'_, SkillState>,
) -> Result<(), String> {
    let store = state.0.lock().map_err(|e| e.to_string())?;
    store.remove_skill_from_scenario(&scenario_id, &skill_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn skill_v2_get_scenario_skills(
    scenario_id: String,
    state: State<'_, SkillState>,
) -> Result<Vec<SkillRecord>, String> {
    let store = state.0.lock().map_err(|e| e.to_string())?;
    store.get_scenario_skills(&scenario_id).map_err(|e| e.to_string())
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
    ).map_err(|e| e.to_string())
}

// --- Marketplace Commands ---

#[tauri::command]
pub fn skill_v2_fetch_leaderboard(board: String) -> Result<Vec<SkillsShSkill>, String> {
    let board_type = skillssh_api::LeaderboardType::from_str(&board);
    skillssh_api::fetch_leaderboard(board_type)
}

#[tauri::command]
pub fn skill_v2_search_skillssh(query: String, limit: Option<usize>) -> Result<Vec<SkillsShSkill>, String> {
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

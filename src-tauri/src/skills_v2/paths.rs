use crate::skills_v2::error::SkillResult;
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};

fn configured_workspace_dir(app_data_dir: &Path) -> Option<PathBuf> {
    let store_path = app_data_dir.join("store.json");
    let content = fs::read_to_string(store_path).ok()?;
    let value = serde_json::from_str::<Value>(&content).ok()?;
    let workspace_path = value
        .get("workspacePath")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())?;

    Some(PathBuf::from(workspace_path))
}

pub fn workspace_dir(app_data_dir: &Path) -> PathBuf {
    configured_workspace_dir(app_data_dir).unwrap_or_else(|| app_data_dir.join("article"))
}

pub fn workspace_skills_dir(app_data_dir: &Path) -> SkillResult<PathBuf> {
    let dir = workspace_dir(app_data_dir).join("skills");
    fs::create_dir_all(&dir)?;
    Ok(dir)
}

pub fn legacy_skill_roots(app_data_dir: &Path) -> Vec<PathBuf> {
    vec![
        app_data_dir.join("skills"),
        app_data_dir.join("skills-v2").join("skills"),
    ]
}

pub fn path_is_inside(path: &Path, root: &Path) -> bool {
    if path.starts_with(root) {
        return true;
    }

    match (path.canonicalize(), root.canonicalize()) {
        (Ok(canonical_path), Ok(canonical_root)) => canonical_path.starts_with(canonical_root),
        _ => false,
    }
}

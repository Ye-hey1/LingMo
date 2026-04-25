use std::path::{Path, PathBuf};
use std::process::Command;
use crate::skills_v2::error::{SkillError, SkillResult};
use crate::skills_v2::skill_metadata::{is_skill_directory, parse_skill_md, sanitize_skill_name};

#[derive(Debug, Clone, serde::Serialize)]
pub struct PreviewSkill {
    pub name: String,
    pub path: String,
    pub description: Option<String>,
}

/// Parse a Git URL into a cloneable URL.
/// Supports: https://..., git@..., user/repo shorthand
pub fn parse_git_url(input: &str) -> SkillResult<String> {
    let trimmed = input.trim();
    if trimmed.starts_with("https://") || trimmed.starts_with("http://") || trimmed.starts_with("git@") {
        Ok(trimmed.to_string())
    } else if trimmed.contains('/') && !trimmed.contains(' ') {
        // user/repo shorthand → GitHub
        Ok(format!("https://github.com/{}.git", trimmed))
    } else {
        Err(SkillError::Validation(format!("Invalid Git URL: {}", trimmed)))
    }
}

/// Clone a git repo to a temp directory, returns the temp dir path.
pub fn clone_to_temp(url: &str, branch: Option<&str>) -> SkillResult<PathBuf> {
    let temp_dir = tempfile::tempdir()?.keep();

    let mut cmd = Command::new("git");
    cmd.arg("clone")
        .arg("--depth").arg("1")
        .arg("--quiet");

    if let Some(b) = branch {
        cmd.arg("--branch").arg(b);
    }

    cmd.arg(url).arg(&temp_dir);

    let output = cmd.output()
        .map_err(|e| SkillError::Git(format!("Failed to run git: {}", e)))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        // Clean up temp dir
        let _ = std::fs::remove_dir_all(&temp_dir);
        Err(SkillError::Git(format!("Git clone failed: {}", stderr.trim())))
    } else {
        Ok(temp_dir)
    }
}

/// Find all skill directories within a cloned repo.
pub fn find_skills_in_dir(dir: &Path) -> Vec<PreviewSkill> {
    let mut skills = Vec::new();

    // Check root
    if is_skill_directory(dir) {
        let meta = parse_skill_md(dir).ok().flatten();
        let name = meta.as_ref()
            .and_then(|m| m.name.clone())
            .unwrap_or_else(|| {
                dir.file_name().and_then(|n| n.to_str()).unwrap_or("unknown").to_string()
            });
        skills.push(PreviewSkill {
            name: sanitize_skill_name(&name),
            path: dir.to_string_lossy().to_string(),
            description: meta.and_then(|m| m.description),
        });
        return skills;
    }

    // Check subdirectories (skills/, skill/, or direct children)
    let search_dirs: Vec<PathBuf> = [
        dir.join("skills"),
        dir.join("skill"),
    ].to_vec();

    for search_dir in &search_dirs {
        if let Ok(entries) = std::fs::read_dir(search_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() && is_skill_directory(&path) {
                    let meta = parse_skill_md(&path).ok().flatten();
                    let name = meta.as_ref()
                        .and_then(|m| m.name.clone())
                        .unwrap_or_else(|| {
                            path.file_name().and_then(|n| n.to_str()).unwrap_or("unknown").to_string()
                        });
                    skills.push(PreviewSkill {
                        name: sanitize_skill_name(&name),
                        path: path.to_string_lossy().to_string(),
                        description: meta.and_then(|m| m.description),
                    });
                }
            }
        }
    }

    // Also check direct children of root
    if skills.is_empty() {
        if let Ok(entries) = std::fs::read_dir(dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() && is_skill_directory(&path) {
                    let meta = parse_skill_md(&path).ok().flatten();
                    let name = meta.as_ref()
                        .and_then(|m| m.name.clone())
                        .unwrap_or_else(|| {
                            path.file_name().and_then(|n| n.to_str()).unwrap_or("unknown").to_string()
                        });
                    skills.push(PreviewSkill {
                        name: sanitize_skill_name(&name),
                        path: path.to_string_lossy().to_string(),
                        description: meta.and_then(|m| m.description),
                    });
                }
            }
        }
    }

    skills
}

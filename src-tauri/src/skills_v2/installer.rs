use crate::skills_v2::content_hash::hash_directory;
use crate::skills_v2::db::{SkillRecord, SkillStore};
use crate::skills_v2::error::{SkillError, SkillResult};
use crate::skills_v2::git_fetcher;
use crate::skills_v2::skill_metadata::{is_skill_directory, parse_skill_md, sanitize_skill_name};
use std::fs;
use std::path::Path;
use uuid::Uuid;

/// Get the central skills directory under app data.
fn central_skills_dir(app_data_dir: &Path) -> SkillResult<std::path::PathBuf> {
    let dir = app_data_dir.join("skills-v2").join("skills");
    fs::create_dir_all(&dir)?;
    Ok(dir)
}

/// Install a skill from a local directory by copying it to the central store.
pub fn install_from_local_dir(
    source_path: &Path,
    app_data_dir: &Path,
    store: &SkillStore,
    custom_name: Option<&str>,
) -> SkillResult<SkillRecord> {
    if !source_path.exists() || !source_path.is_dir() {
        return Err(SkillError::Validation(
            "Source path does not exist or is not a directory".into(),
        ));
    }
    if !is_skill_directory(source_path) {
        return Err(SkillError::Validation(
            "Directory does not contain SKILL.md".into(),
        ));
    }

    let meta = parse_skill_md(source_path).ok().flatten();
    let raw_name = custom_name
        .map(|s| s.to_string())
        .or_else(|| meta.as_ref().and_then(|m| m.name.clone()))
        .unwrap_or_else(|| {
            source_path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("unknown")
                .to_string()
        });
    let name = sanitize_skill_name(&raw_name);

    let central = central_skills_dir(app_data_dir)?;
    let target = central.join(&name);

    // If target exists, append suffix
    let final_target = if target.exists() {
        let mut i = 2u32;
        loop {
            let candidate = central.join(format!("{}-{}", name, i));
            if !candidate.exists() {
                break candidate;
            }
            i += 1;
        }
    } else {
        target
    };

    copy_dir_recursive(source_path, &final_target)?;

    let now = chrono::Utc::now().timestamp();
    let record = SkillRecord {
        id: Uuid::new_v4().to_string(),
        name: if final_target != central.join(&name) {
            final_target
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or(&name)
                .to_string()
        } else {
            name
        },
        description: meta.and_then(|m| m.description),
        source_type: "local".into(),
        source_ref: Some(source_path.to_string_lossy().to_string()),
        source_ref_resolved: None,
        source_subpath: None,
        source_branch: None,
        source_revision: None,
        remote_revision: None,
        central_path: final_target.to_string_lossy().to_string(),
        content_hash: hash_directory(&final_target),
        enabled: true,
        status: "ok".into(),
        update_status: "unknown".into(),
        created_at: now,
        updated_at: now,
    };

    store.insert_skill(&record)?;
    Ok(record)
}

/// Install a skill from a ZIP archive.
pub fn install_from_archive(
    zip_path: &Path,
    app_data_dir: &Path,
    store: &SkillStore,
) -> SkillResult<SkillRecord> {
    let temp_dir = tempfile::tempdir()?;
    extract_zip(zip_path, temp_dir.path())?;

    // Find the skill directory in the extracted files
    let skill_dir = find_skill_in_extracted(temp_dir.path())?;
    install_from_local_dir(&skill_dir, app_data_dir, store, None)
}

/// Install a skill from a Git repository.
pub fn install_from_git(
    url: &str,
    app_data_dir: &Path,
    store: &SkillStore,
    custom_name: Option<&str>,
) -> SkillResult<SkillRecord> {
    let parsed_url = git_fetcher::parse_git_url(url)?;
    let temp_dir = git_fetcher::clone_to_temp(&parsed_url, None)?;

    // Find skill directories
    let skills = git_fetcher::find_skills_in_dir(&temp_dir);
    if skills.is_empty() {
        let _ = fs::remove_dir_all(&temp_dir);
        return Err(SkillError::Validation(
            "No skills found in repository".into(),
        ));
    }

    // Install the first skill (or the one matching custom_name)
    let target = if let Some(name) = custom_name {
        skills.iter().find(|s| s.name == name).unwrap_or(&skills[0])
    } else {
        &skills[0]
    };

    let source_path = Path::new(&target.path);
    let result = install_from_local_dir(source_path, app_data_dir, store, Some(&target.name));

    // Clean up temp
    let _ = fs::remove_dir_all(&temp_dir);

    result.map(|mut r| {
        r.source_type = "git".into();
        r.source_ref = Some(url.to_string());
        r
    })
}

/// Preview what skills are in a Git repo without installing.
pub fn preview_git(url: &str) -> SkillResult<Vec<git_fetcher::PreviewSkill>> {
    let parsed_url = git_fetcher::parse_git_url(url)?;
    let temp_dir = git_fetcher::clone_to_temp(&parsed_url, None)?;
    let skills = git_fetcher::find_skills_in_dir(&temp_dir);
    let _ = fs::remove_dir_all(&temp_dir);
    Ok(skills)
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> SkillResult<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());
        if src_path.is_dir() {
            // Skip .git directories
            if entry.file_name() == ".git" {
                continue;
            }
            copy_dir_recursive(&src_path, &dst_path)?;
        } else {
            fs::copy(&src_path, &dst_path)?;
        }
    }
    Ok(())
}

fn extract_zip(zip_path: &Path, dest: &Path) -> SkillResult<()> {
    let file = fs::File::open(zip_path)?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|e| SkillError::Install(format!("Failed to read ZIP: {}", e)))?;

    for i in 0..archive.len() {
        let mut file = archive
            .by_index(i)
            .map_err(|e| SkillError::Install(format!("Failed to read ZIP entry: {}", e)))?;
        let outpath = match file.enclosed_name() {
            Some(path) => dest.join(path),
            None => continue,
        };

        // Zip slip protection
        let canonical_dest = dest.canonicalize().unwrap_or_else(|_| dest.to_path_buf());
        if let Some(parent) = outpath.parent() {
            if parent.exists() {
                let canonical_parent = parent
                    .canonicalize()
                    .unwrap_or_else(|_| parent.to_path_buf());
                if !canonical_parent.starts_with(&canonical_dest)
                    && canonical_parent != canonical_dest
                {
                    continue;
                }
            }
            fs::create_dir_all(parent)?;
        }

        if file.is_dir() {
            fs::create_dir_all(&outpath)?;
        } else {
            if let Some(parent) = outpath.parent() {
                fs::create_dir_all(parent)?;
            }
            let mut outfile = fs::File::create(&outpath)?;
            std::io::copy(&mut file, &mut outfile)?;
        }
    }
    Ok(())
}

fn find_skill_in_extracted(dir: &Path) -> SkillResult<std::path::PathBuf> {
    // Check root
    if is_skill_directory(dir) {
        return Ok(dir.to_path_buf());
    }
    // Check one level deep
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_dir() && is_skill_directory(&path) {
            return Ok(path);
        }
        // Check two levels deep
        if path.is_dir() {
            for sub_entry in fs::read_dir(&path)? {
                let sub_path = sub_entry?.path();
                if sub_path.is_dir() && is_skill_directory(&sub_path) {
                    return Ok(sub_path);
                }
            }
        }
    }
    Err(SkillError::Validation(
        "No SKILL.md found in archive".into(),
    ))
}

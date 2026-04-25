use std::path::Path;
use std::fs;
use tauri::{command, AppHandle, Manager};
use zip::ZipArchive;

#[command]
pub async fn import_skill_zip(app_handle: AppHandle, zip_path: String) -> Result<String, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {}", e))?;

    // 确保 skills 目录存在
    let skills_dir = app_data_dir.join("skills");
    if !skills_dir.exists() {
        fs::create_dir_all(&skills_dir)
            .map_err(|e| format!("Failed to create skills directory: {}", e))?;
    }

    // 创建临时目录用于解压
    let temp_dir = app_data_dir.join("temp_skill_import");
    if temp_dir.exists() {
        fs::remove_dir_all(&temp_dir)
            .map_err(|e| format!("Failed to remove temp directory: {}", e))?;
    }
    fs::create_dir_all(&temp_dir)
        .map_err(|e| format!("Failed to create temp directory: {}", e))?;

    // 使用 zip crate 解压到临时目录
    let file = fs::File::open(&zip_path)
        .map_err(|e| format!("Failed to open zip file: {}", e))?;
    let mut archive = ZipArchive::new(file)
        .map_err(|e| format!("Failed to read zip archive: {}", e))?;

    for i in 0..archive.len() {
        let mut file = archive.by_index(i)
            .map_err(|e| format!("Failed to read zip entry: {}", e))?;
        let outpath = temp_dir.join(file.mangled_name());

        if file.name().ends_with('/') {
            fs::create_dir_all(&outpath)
                .map_err(|e| format!("Failed to create directory: {}", e))?;
        } else {
            if let Some(p) = outpath.parent() {
                if !p.exists() {
                    fs::create_dir_all(p)
                        .map_err(|e| format!("Failed to create parent directory: {}", e))?;
                }
            }
            let mut outfile = fs::File::create(&outpath)
                .map_err(|e| format!("Failed to create file: {}", e))?;
            std::io::copy(&mut file, &mut outfile)
                .map_err(|e| format!("Failed to extract file: {}", e))?;
        }
    }

    // 查找解压后的目录
    let entries = fs::read_dir(&temp_dir)
        .map_err(|e| format!("Failed to read temp directory: {}", e))?;

    let mut skill_name = String::new();

    // 查找包含 SKILL.md 的目录
    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read directory entry: {}", e))?;
        let path = entry.path();

        if path.is_dir() {
            // 检查是否包含 SKILL.md
            let skill_md = path.join("SKILL.md");
            if skill_md.exists() {
                skill_name = path.file_name()
                    .and_then(|n| n.to_str())
                    .ok_or("Failed to get skill directory name")?
                    .to_string();

                let dest_path = skills_dir.join(&skill_name);

                // 如果目标目录已存在，先删除
                if dest_path.exists() {
                    fs::remove_dir_all(&dest_path)
                        .map_err(|e| format!("Failed to remove existing skill directory: {}", e))?;
                }

                // 移动目录到 skills 目录
                fs::rename(&path, &dest_path)
                    .or_else(|_| {
                        // 如果 rename 失败（可能跨文件系统），尝试复制
                        copy_dir_recursive(&path, &dest_path)
                    })
                    .map_err(|e| format!("Failed to move skill directory: {}", e))?;

                break;
            }
        }
    }

    // 清理临时目录
    fs::remove_dir_all(&temp_dir)
        .map_err(|e| format!("Failed to remove temp directory: {}", e))?;

    if skill_name.is_empty() {
        return Err("No valid skill found in zip file. A valid skill must contain a SKILL.md file.".to_string());
    }

    Ok(skill_name)
}

// 递归复制目录的辅助函数
fn copy_dir_recursive(src: &Path, dest: &Path) -> Result<(), String> {
    if !dest.exists() {
        fs::create_dir_all(dest).map_err(|e| format!("Failed to create directory: {}", e))?;
    }

    for entry in fs::read_dir(src).map_err(|e| format!("Failed to read source directory: {}", e))? {
        let entry = entry.map_err(|e| format!("Failed to read directory entry: {}", e))?;
        let src_path = entry.path();
        let dest_path = dest.join(entry.file_name());

        if src_path.is_file() {
            fs::copy(&src_path, &dest_path)
                .map_err(|e| format!("Failed to copy file: {}", e))?;
        } else if src_path.is_dir() {
            copy_dir_recursive(&src_path, &dest_path)?;
        }
    }

    Ok(())
}

use std::path::Path;
use sha2::{Sha256, Digest};
use walkdir::WalkDir;

pub fn hash_directory(dir: &Path) -> Option<String> {
    if !dir.exists() {
        return None;
    }

    let mut hasher = Sha256::new();

    let mut entries: Vec<_> = WalkDir::new(dir)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| {
            let path = e.path();
            let rel = path.strip_prefix(dir).unwrap_or(path);
            let rel_str = rel.to_string_lossy();
            !rel_str.starts_with(".git") &&
            !rel_str.contains("node_modules") &&
            !rel_str.contains(".hub")
        })
        .collect();

    entries.sort_by(|a, b| a.path().cmp(b.path()));

    for entry in &entries {
        let rel = entry.path().strip_prefix(dir).unwrap_or(entry.path());
        let rel_bytes = rel.to_string_lossy().as_bytes().to_vec();
        hasher.update(&rel_bytes);

        if entry.file_type().is_file() {
            if let Ok(content) = std::fs::read(entry.path()) {
                hasher.update(&content);
            }
        }
    }

    let result = hasher.finalize();
    Some(hex::encode(result))
}

use std::path::Path;
use crate::skills_v2::error::SkillResult;

#[derive(Debug, Clone)]
pub struct SkillMeta {
    pub name: Option<String>,
    pub description: Option<String>,
}

pub fn parse_skill_md(dir: &Path) -> SkillResult<Option<SkillMeta>> {
    let skill_md = dir.join("SKILL.md");
    let skill_md_lower = dir.join("skill.md");

    let content = if skill_md.exists() {
        std::fs::read_to_string(&skill_md)?
    } else if skill_md_lower.exists() {
        std::fs::read_to_string(&skill_md_lower)?
    } else {
        return Ok(None);
    };

    let meta = parse_frontmatter(&content);
    Ok(Some(meta))
}

fn parse_frontmatter(content: &str) -> SkillMeta {
    let trimmed = content.trim_start();
    if !trimmed.starts_with("---") {
        return SkillMeta { name: None, description: None };
    }

    let after_start = &trimmed[3..];
    let end = match after_start.find("---") {
        Some(pos) => pos,
        None => return SkillMeta { name: None, description: None },
    };

    let yaml = &after_start[..end].trim();

    let mut name = None;
    let mut description = None;

    for line in yaml.lines() {
        let line = line.trim();
        if let Some(rest) = line.strip_prefix("name:") {
            name = Some(rest.trim().trim_matches('"').trim_matches('\'').to_string());
        } else if let Some(rest) = line.strip_prefix("description:") {
            description = Some(rest.trim().trim_matches('"').trim_matches('\'').to_string());
        }
    }

    SkillMeta { name, description }
}

pub fn sanitize_skill_name(name: &str) -> String {
    let sanitized: String = name
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();

    let result = sanitized.trim_matches(|c: char| c == '.' || c == '-' || c == '_');

    if result.is_empty() {
        "unnamed-skill".to_string()
    } else {
        result.to_string()
    }
}

pub fn is_skill_directory(dir: &Path) -> bool {
    dir.join("SKILL.md").exists() || dir.join("skill.md").exists()
}

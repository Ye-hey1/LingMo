use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillsShSkill {
    pub id: String,
    pub skill_id: String,
    pub name: String,
    pub source: String,
    pub installs: u64,
}

#[derive(Debug, Clone, Copy)]
pub enum LeaderboardType {
    AllTime,
    Trending,
    Hot,
}

impl LeaderboardType {
    pub fn from_str(s: &str) -> Self {
        match s {
            "trending" => Self::Trending,
            "hot" => Self::Hot,
            _ => Self::AllTime,
        }
    }

    fn url(&self) -> &str {
        match self {
            Self::AllTime => "https://skills.sh/",
            Self::Trending => "https://skills.sh/trending",
            Self::Hot => "https://skills.sh/hot",
        }
    }
}

pub fn fetch_leaderboard(board: LeaderboardType) -> Result<Vec<SkillsShSkill>, String> {
    let client = reqwest::blocking::Client::builder()
        .user_agent("lingmo-skills")
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;

    let html = client
        .get(board.url())
        .send()
        .map_err(|e| format!("Failed to fetch skills.sh: {}", e))?
        .text()
        .map_err(|e| format!("Failed to read response: {}", e))?;

    parse_leaderboard_html(&html)
}

fn parse_leaderboard_html(html: &str) -> Result<Vec<SkillsShSkill>, String> {
    if let Ok(skills) = parse_next_data(html) {
        if !skills.is_empty() {
            return Ok(skills);
        }
    }
    parse_embedded_skill_objects(html)
}

fn parse_next_data(html: &str) -> Result<Vec<SkillsShSkill>, String> {
    let marker = r#"<script id="__NEXT_DATA__" type="application/json">"#;
    let start = html
        .find(marker)
        .ok_or("__NEXT_DATA__ not found")?
        + marker.len();

    let end = html[start..]
        .find("</script>")
        .ok_or("Closing script tag not found")?
        + start;

    let json_str = &html[start..end];
    let data: serde_json::Value =
        serde_json::from_str(json_str).map_err(|e| format!("JSON parse error: {}", e))?;

    let skills_array = data
        .pointer("/props/pageProps/initialSkills")
        .or_else(|| data.pointer("/props/pageProps/skills"))
        .or_else(|| data.pointer("/props/pageProps/items"))
        .and_then(|v| v.as_array());

    match skills_array {
        Some(arr) => Ok(parse_skills_array(arr)),
        None => Ok(Vec::new()),
    }
}

fn parse_skills_array(arr: &[serde_json::Value]) -> Vec<SkillsShSkill> {
    let mut seen = HashSet::new();
    let mut skills = Vec::new();

    for item in arr {
        let source = item
            .get("source")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let skill_id = item
            .get("skillId")
            .or_else(|| item.get("skill_id"))
            .or_else(|| item.get("id"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        if source.is_empty() || skill_id.is_empty() {
            continue;
        }

        let id = format!("{}/{}", source, skill_id);
        if !seen.insert(id.clone()) {
            continue;
        }

        let name = item
            .get("name")
            .and_then(|v| v.as_str())
            .filter(|v| !v.is_empty())
            .unwrap_or(&skill_id)
            .to_string();
        let installs = item.get("installs").and_then(|v| v.as_u64()).unwrap_or(0);

        skills.push(SkillsShSkill {
            id,
            skill_id,
            name,
            source,
            installs,
        });
    }

    skills
}

fn parse_embedded_skill_objects(html: &str) -> Result<Vec<SkillsShSkill>, String> {
    let pattern = Regex::new(
        r#"(?:\\)?\"source(?:\\)?\":(?:\\)?\"(?P<source>[^"\\]+)(?:\\)?\",(?:[^{}]|\\.)*?(?:(?:\\)?\"skillId(?:\\)?\"|(?:\\)?\"skill_id(?:\\)?\"):(?:\\)?\"(?P<skill_id>[^"\\]+)(?:\\)?\",(?:[^{}]|\\.)*?(?:\\)?\"name(?:\\)?\":(?:\\)?\"(?P<name>[^"\\]*)(?:\\)?\",(?:[^{}]|\\.)*?(?:\\)?\"installs(?:\\)?\":(?P<installs>\d+)"#,
    )
    .map_err(|e| format!("Regex build error: {}", e))?;

    let fallback_pattern = Regex::new(
        r#"\{"source":"(?P<source>[^"]+)","skill_id":"(?P<skill_id>[^"]+)"(?:,"name":"(?P<name>[^"]*)")?(?:.*?"installs":(?P<installs>\d+))?\}"#,
    )
    .map_err(|e| format!("Fallback regex build error: {}", e))?;

    let mut skills = parse_embedded_with_regex(html, &pattern);
    if skills.is_empty() {
        skills = parse_embedded_with_regex(html, &fallback_pattern);
    }

    Ok(skills)
}

fn parse_embedded_with_regex(html: &str, pattern: &Regex) -> Vec<SkillsShSkill> {
    let mut seen = HashSet::new();
    let mut skills = Vec::new();

    for caps in pattern.captures_iter(html) {
        let source = match caps.name("source") {
            Some(v) => v.as_str().replace(r#"\""#, "\""),
            None => continue,
        };
        let skill_id = match caps.name("skill_id") {
            Some(v) => v.as_str().replace(r#"\""#, "\""),
            None => continue,
        };

        let id = format!("{}/{}", source, skill_id);
        if !seen.insert(id.clone()) {
            continue;
        }

        let name = caps
            .name("name")
            .map(|v| v.as_str().replace(r#"\""#, "\""))
            .filter(|v| !v.is_empty())
            .unwrap_or_else(|| skill_id.clone());
        let installs = caps
            .name("installs")
            .and_then(|v| v.as_str().parse::<u64>().ok())
            .unwrap_or(0);

        skills.push(SkillsShSkill {
            id,
            skill_id,
            name,
            source,
            installs,
        });
    }

    skills
}

pub fn search_skills(query: &str, limit: usize) -> Result<Vec<SkillsShSkill>, String> {
    let client = reqwest::blocking::Client::builder()
        .user_agent("lingmo-skills")
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;

    let url = format!(
        "https://skills.sh/api/search?q={}&limit={}",
        urlencoding::encode(query),
        limit
    );

    let resp: serde_json::Value = client
        .get(&url)
        .send()
        .map_err(|e| format!("Search request failed: {}", e))?
        .json()
        .map_err(|e| format!("Search response parse error: {}", e))?;

    if let Some(arr) = resp.as_array() {
        return Ok(parse_skills_array(arr));
    }

    let skills_array = resp.get("skills").and_then(|v| v.as_array());
    match skills_array {
        Some(arr) => Ok(parse_skills_array(arr)),
        None => Ok(Vec::new()),
    }
}

use rusqlite::Connection;
use crate::skills_v2::error::SkillResult;

const SCHEMA_V1: &str = "
CREATE TABLE IF NOT EXISTS skills (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    source_type TEXT NOT NULL DEFAULT 'local',
    source_ref TEXT,
    source_ref_resolved TEXT,
    source_subpath TEXT,
    source_branch TEXT,
    source_revision TEXT,
    remote_revision TEXT,
    central_path TEXT NOT NULL,
    content_hash TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'ok',
    update_status TEXT NOT NULL DEFAULT 'unknown',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS skill_targets (
    id TEXT PRIMARY KEY,
    skill_id TEXT NOT NULL,
    tool_key TEXT NOT NULL,
    target_path TEXT NOT NULL,
    sync_mode TEXT NOT NULL DEFAULT 'symlink',
    status TEXT NOT NULL DEFAULT 'ok',
    created_at INTEGER NOT NULL,
    FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE,
    UNIQUE(skill_id, tool_key)
);

CREATE TABLE IF NOT EXISTS discovered_skills (
    id TEXT PRIMARY KEY,
    tool_key TEXT NOT NULL,
    found_path TEXT NOT NULL,
    name_guess TEXT,
    fingerprint TEXT,
    imported INTEGER NOT NULL DEFAULT 0,
    discovered_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS scenarios (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    icon TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS scenario_skills (
    scenario_id TEXT NOT NULL,
    skill_id TEXT NOT NULL,
    added_at INTEGER NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (scenario_id, skill_id),
    FOREIGN KEY (scenario_id) REFERENCES scenarios(id) ON DELETE CASCADE,
    FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS skill_tags (
    skill_id TEXT NOT NULL,
    tag TEXT NOT NULL,
    PRIMARY KEY (skill_id, tag),
    FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS active_scenario (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    scenario_id TEXT,
    FOREIGN KEY (scenario_id) REFERENCES scenarios(id) ON DELETE SET NULL
);

INSERT OR IGNORE INTO active_scenario (id, scenario_id) VALUES (1, NULL);
";

pub fn run_migrations(conn: &Connection) -> SkillResult<()> {
    conn.execute_batch("PRAGMA foreign_keys=ON;")?;

    let user_version: u32 = conn.pragma_query_value(None, "user_version", |r| r.get(0))?;

    if user_version < 1 {
        conn.execute_batch(SCHEMA_V1)?;
        conn.pragma_update(None, "user_version", 1)?;
    }

    Ok(())
}

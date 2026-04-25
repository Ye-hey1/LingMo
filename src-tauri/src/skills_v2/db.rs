use std::path::PathBuf;
use std::sync::Mutex;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use crate::skills_v2::error::{SkillError, SkillResult};
use crate::skills_v2::migrations::run_migrations;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillRecord {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub source_type: String,
    pub source_ref: Option<String>,
    pub source_ref_resolved: Option<String>,
    pub source_subpath: Option<String>,
    pub source_branch: Option<String>,
    pub source_revision: Option<String>,
    pub remote_revision: Option<String>,
    pub central_path: String,
    pub content_hash: Option<String>,
    pub enabled: bool,
    pub status: String,
    pub update_status: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscoveredSkill {
    pub id: String,
    pub tool_key: String,
    pub found_path: String,
    pub name_guess: Option<String>,
    pub fingerprint: Option<String>,
    pub imported: bool,
    pub discovered_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScenarioRecord {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub icon: Option<String>,
    pub sort_order: i32,
    pub created_at: i64,
    pub updated_at: i64,
}

pub struct SkillStore {
    conn: Connection,
}

impl SkillStore {
    pub fn new(db_path: &std::path::Path) -> SkillResult<Self> {
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let conn = Connection::open(db_path)?;
        run_migrations(&conn)?;
        Ok(Self { conn })
    }

    pub fn insert_skill(&self, record: &SkillRecord) -> SkillResult<()> {
        let enabled_i32 = record.enabled as i32;
        let params: Vec<Box<dyn rusqlite::types::ToSql>> = vec![
            Box::new(record.id.clone()),
            Box::new(record.name.clone()),
            Box::new(record.description.clone()),
            Box::new(record.source_type.clone()),
            Box::new(record.source_ref.clone()),
            Box::new(record.source_ref_resolved.clone()),
            Box::new(record.source_subpath.clone()),
            Box::new(record.source_branch.clone()),
            Box::new(record.source_revision.clone()),
            Box::new(record.remote_revision.clone()),
            Box::new(record.central_path.clone()),
            Box::new(record.content_hash.clone()),
            Box::new(enabled_i32),
            Box::new(record.status.clone()),
            Box::new(record.update_status.clone()),
            Box::new(record.created_at),
            Box::new(record.updated_at),
        ];
        self.conn.execute(
            "INSERT OR REPLACE INTO skills (id, name, description, source_type, source_ref, source_ref_resolved, source_subpath, source_branch, source_revision, remote_revision, central_path, content_hash, enabled, status, update_status, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)",
            rusqlite::params_from_iter(params.iter().map(|p| p.as_ref())),
        )?;
        Ok(())
    }

    pub fn get_all_skills(&self) -> SkillResult<Vec<SkillRecord>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, description, source_type, source_ref, source_ref_resolved, source_subpath, source_branch, source_revision, remote_revision, central_path, content_hash, enabled, status, update_status, created_at, updated_at FROM skills ORDER BY updated_at DESC"
        )?;
        let records = stmt.query_map([], |row| {
            Ok(SkillRecord {
                id: row.get(0)?, name: row.get(1)?, description: row.get(2)?,
                source_type: row.get(3)?, source_ref: row.get(4)?, source_ref_resolved: row.get(5)?,
                source_subpath: row.get(6)?, source_branch: row.get(7)?, source_revision: row.get(8)?,
                remote_revision: row.get(9)?, central_path: row.get(10)?, content_hash: row.get(11)?,
                enabled: row.get::<_, i32>(12)? != 0, status: row.get(13)?,
                update_status: row.get(14)?, created_at: row.get(15)?, updated_at: row.get(16)?,
            })
        })?.collect::<Result<Vec<_>, _>>()?;
        Ok(records)
    }

    pub fn get_skill_by_id(&self, id: &str) -> SkillResult<Option<SkillRecord>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, description, source_type, source_ref, source_ref_resolved, source_subpath, source_branch, source_revision, remote_revision, central_path, content_hash, enabled, status, update_status, created_at, updated_at FROM skills WHERE id = ?1"
        )?;
        let mut records = stmt.query_map([id], |row| {
            Ok(SkillRecord {
                id: row.get(0)?, name: row.get(1)?, description: row.get(2)?,
                source_type: row.get(3)?, source_ref: row.get(4)?, source_ref_resolved: row.get(5)?,
                source_subpath: row.get(6)?, source_branch: row.get(7)?, source_revision: row.get(8)?,
                remote_revision: row.get(9)?, central_path: row.get(10)?, content_hash: row.get(11)?,
                enabled: row.get::<_, i32>(12)? != 0, status: row.get(13)?,
                update_status: row.get(14)?, created_at: row.get(15)?, updated_at: row.get(16)?,
            })
        })?.collect::<Result<Vec<_>, _>>()?;
        Ok(records.pop())
    }

    pub fn delete_skill(&self, id: &str) -> SkillResult<bool> {
        let affected = self.conn.execute("DELETE FROM skills WHERE id = ?1", [id])?;
        Ok(affected > 0)
    }

    pub fn set_skill_enabled(&self, id: &str, enabled: bool) -> SkillResult<bool> {
        let affected = self.conn.execute(
            "UPDATE skills SET enabled = ?1, updated_at = ?2 WHERE id = ?3",
            (enabled as i32, chrono::Utc::now().timestamp(), id),
        )?;
        Ok(affected > 0)
    }

    // --- Discovered Skills ---

    pub fn clear_discovered(&self) -> SkillResult<()> {
        self.conn.execute("DELETE FROM discovered_skills WHERE imported = 0", [])?;
        Ok(())
    }

    pub fn insert_discovered(&self, record: &DiscoveredSkill) -> SkillResult<()> {
        self.conn.execute(
            "INSERT OR REPLACE INTO discovered_skills (id, tool_key, found_path, name_guess, fingerprint, imported, discovered_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            (&record.id, &record.tool_key, &record.found_path, &record.name_guess,
             &record.fingerprint, record.imported as i32, record.discovered_at),
        )?;
        Ok(())
    }

    pub fn get_all_discovered(&self) -> SkillResult<Vec<DiscoveredSkill>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, tool_key, found_path, name_guess, fingerprint, imported, discovered_at FROM discovered_skills ORDER BY discovered_at DESC"
        )?;
        let records = stmt.query_map([], |row| {
            Ok(DiscoveredSkill {
                id: row.get(0)?, tool_key: row.get(1)?, found_path: row.get(2)?,
                name_guess: row.get(3)?, fingerprint: row.get(4)?,
                imported: row.get::<_, i32>(5)? != 0, discovered_at: row.get(6)?,
            })
        })?.collect::<Result<Vec<_>, _>>()?;
        Ok(records)
    }

    pub fn mark_discovered_imported(&self, id: &str) -> SkillResult<()> {
        self.conn.execute("UPDATE discovered_skills SET imported = 1 WHERE id = ?1", [id])?;
        Ok(())
    }

    // --- Settings ---

    pub fn get_setting(&self, key: &str) -> SkillResult<Option<String>> {
        let mut stmt = self.conn.prepare("SELECT value FROM settings WHERE key = ?1")?;
        let mut rows = stmt.query_map([key], |row| row.get::<_, String>(0))?;
        match rows.next() {
            Some(row) => Ok(Some(row?)),
            None => Ok(None),
        }
    }

    pub fn set_setting(&self, key: &str, value: &str) -> SkillResult<()> {
        self.conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
            (key, value),
        )?;
        Ok(())
    }

    // --- Scenarios ---

    pub fn get_all_scenarios(&self) -> SkillResult<Vec<ScenarioRecord>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, description, icon, sort_order, created_at, updated_at FROM scenarios ORDER BY sort_order"
        )?;
        let records = stmt.query_map([], |row| {
            Ok(ScenarioRecord {
                id: row.get(0)?, name: row.get(1)?, description: row.get(2)?,
                icon: row.get(3)?, sort_order: row.get(4)?,
                created_at: row.get(5)?, updated_at: row.get(6)?,
            })
        })?.collect::<Result<Vec<_>, _>>()?;
        Ok(records)
    }

    pub fn insert_scenario(&self, record: &ScenarioRecord) -> SkillResult<()> {
        self.conn.execute(
            "INSERT INTO scenarios (id, name, description, icon, sort_order, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            (&record.id, &record.name, &record.description, &record.icon,
             record.sort_order, record.created_at, record.updated_at),
        )?;
        Ok(())
    }

    pub fn delete_scenario(&self, id: &str) -> SkillResult<bool> {
        let affected = self.conn.execute("DELETE FROM scenarios WHERE id = ?1", [id])?;
        Ok(affected > 0)
    }

    pub fn get_active_scenario_id(&self) -> SkillResult<Option<String>> {
        let mut stmt = self.conn.prepare("SELECT scenario_id FROM active_scenario WHERE id = 1")?;
        let mut rows = stmt.query_map([], |row| row.get::<_, Option<String>>(0))?;
        match rows.next() {
            Some(row) => Ok(row?),
            None => Ok(None),
        }
    }

    pub fn set_active_scenario(&self, scenario_id: Option<&str>) -> SkillResult<()> {
        self.conn.execute(
            "UPDATE active_scenario SET scenario_id = ?1 WHERE id = 1",
            [scenario_id],
        )?;
        Ok(())
    }

    pub fn add_skill_to_scenario(&self, scenario_id: &str, skill_id: &str) -> SkillResult<()> {
        let now = chrono::Utc::now().timestamp();
        self.conn.execute(
            "INSERT OR IGNORE INTO scenario_skills (scenario_id, skill_id, added_at, sort_order) VALUES (?1, ?2, ?3, 0)",
            (scenario_id, skill_id, now),
        )?;
        Ok(())
    }

    pub fn remove_skill_from_scenario(&self, scenario_id: &str, skill_id: &str) -> SkillResult<()> {
        self.conn.execute(
            "DELETE FROM scenario_skills WHERE scenario_id = ?1 AND skill_id = ?2",
            (scenario_id, skill_id),
        )?;
        Ok(())
    }

    pub fn get_scenario_skills(&self, scenario_id: &str) -> SkillResult<Vec<SkillRecord>> {
        let mut stmt = self.conn.prepare(
            "SELECT s.id, s.name, s.description, s.source_type, s.source_ref, s.source_ref_resolved, s.source_subpath, s.source_branch, s.source_revision, s.remote_revision, s.central_path, s.content_hash, s.enabled, s.status, s.update_status, s.created_at, s.updated_at
             FROM skills s JOIN scenario_skills ss ON s.id = ss.skill_id
             WHERE ss.scenario_id = ?1 ORDER BY ss.sort_order"
        )?;
        let records = stmt.query_map([scenario_id], |row| {
            Ok(SkillRecord {
                id: row.get(0)?, name: row.get(1)?, description: row.get(2)?,
                source_type: row.get(3)?, source_ref: row.get(4)?, source_ref_resolved: row.get(5)?,
                source_subpath: row.get(6)?, source_branch: row.get(7)?, source_revision: row.get(8)?,
                remote_revision: row.get(9)?, central_path: row.get(10)?, content_hash: row.get(11)?,
                enabled: row.get::<_, i32>(12)? != 0, status: row.get(13)?,
                update_status: row.get(14)?, created_at: row.get(15)?, updated_at: row.get(16)?,
            })
        })?.collect::<Result<Vec<_>, _>>()?;
        Ok(records)
    }
}

pub fn init_skill_store(app_data_dir: &std::path::Path) -> SkillResult<SkillStore> {
    let db_path = app_data_dir.join("skills-v2").join("skills.db");
    SkillStore::new(&db_path)
}

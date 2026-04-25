use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum SkillError {
    #[error("Database error: {0}")]
    Db(#[from] rusqlite::Error),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Invalid skill: {0}")]
    Validation(String),

    #[error("Not found: {0}")]
    NotFound(String),

    #[error("Git error: {0}")]
    Git(String),

    #[error("Install error: {0}")]
    Install(String),

    #[error("{0}")]
    Other(String),
}

impl Serialize for SkillError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

pub type SkillResult<T> = Result<T, SkillError>;

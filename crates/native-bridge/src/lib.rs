//! Restricted native capabilities shared by Ember Tavern applications.

#![forbid(unsafe_code)]

mod adventure_play;
mod character_creation;
mod model_settings;
mod npc_dialogue;
mod quest_board;
mod settlement;
mod tavern_initialization;
mod world_creation;
pub use adventure_play::*;
pub use character_creation::*;
pub use model_settings::*;
pub use npc_dialogue::*;
pub use quest_board::*;
pub use settlement::*;
pub use tavern_initialization::*;
pub use world_creation::*;

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use rusqlite::{Connection, OpenFlags, OptionalExtension, TransactionBehavior, params};
use serde::Serialize;
use thiserror::Error;
use time::OffsetDateTime;
use time::format_description::FormatItem;
use time::format_description::well_known::Rfc3339;
use time::macros::format_description;
use uuid::Uuid;

const INITIAL_MIGRATION: &str = include_str!("../../../database/migrations/0001_initial.sql");
const FULL_BACKUP_RETENTION: usize = 3;
const TIMESTAMP_FORMAT: &[FormatItem<'static>] =
    format_description!("[year]-[month]-[day]T[hour]:[minute]:[second].[subsecond digits:3]Z");
const CAMPAIGN_STATES: &[&str] = &[
    "CREATING_WORLD",
    "REVIEWING_WORLD",
    "CREATING_CHARACTER",
    "GENERATING_TAVERN",
    "TAVERN",
    "ADVENTURE",
    "SETTLEMENT",
    "GENERATION_FAILED",
    "WAITING_FOR_MODEL",
    "RECOVERY_REQUIRED",
    "ARCHIVED",
];

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CampaignSummary {
    pub id: String,
    pub state: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Error)]
pub enum CampaignStoreError {
    #[error("campaign does not exist")]
    NotFound,
    #[error("campaign is already archived")]
    AlreadyArchived,
    #[error("stored campaign data is invalid")]
    InvalidData,
    #[error("campaign is not in the required state")]
    InvalidState,
    #[error("database schema is incompatible")]
    IncompatibleSchema,
    #[error("the current time could not be represented")]
    InvalidSystemTime,
    #[error("database operation failed")]
    Database(#[from] rusqlite::Error),
    #[error("application data directory could not be created")]
    Io(#[from] std::io::Error),
}

/// Owns a platform database path without exposing SQL or file access to the WebView.
#[derive(Debug, Clone)]
pub struct CampaignStore {
    pub(crate) database_path: PathBuf,
}

impl CampaignStore {
    pub fn open(path: impl AsRef<Path>) -> Result<Self, CampaignStoreError> {
        let database_path = path.as_ref().to_path_buf();
        if let Some(parent) = database_path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        if database_path.exists() {
            create_consistent_backup(&database_path)?;
        }
        let store = Self { database_path };
        let mut connection = store.connect()?;
        apply_migrations(&mut connection)?;
        Ok(store)
    }

    pub fn list(&self) -> Result<Vec<CampaignSummary>, CampaignStoreError> {
        let connection = self.connect()?;
        let mut statement = connection.prepare(
            "SELECT id, state, created_at, updated_at
             FROM campaigns
             WHERE state <> 'ARCHIVED'
             ORDER BY updated_at DESC, id",
        )?;
        let campaigns = statement
            .query_map([], |row| {
                Ok(CampaignSummary {
                    id: row.get(0)?,
                    state: row.get(1)?,
                    created_at: row.get(2)?,
                    updated_at: row.get(3)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        campaigns
            .into_iter()
            .map(validate_campaign)
            .collect::<Result<Vec<_>, _>>()
    }

    pub fn create_campaign(&self) -> Result<CampaignSummary, CampaignStoreError> {
        self.create_at(Uuid::new_v4().to_string(), current_timestamp()?)
    }

    pub fn continue_campaign(&self, id: &str) -> Result<CampaignSummary, CampaignStoreError> {
        self.touch_at(id, current_timestamp()?)
    }

    pub fn archive_campaign(&self, id: &str) -> Result<(), CampaignStoreError> {
        validate_id(id)?;
        let at = current_timestamp()?;
        let connection = self.connect()?;
        let changed = connection.execute(
            "UPDATE campaigns
             SET state = 'ARCHIVED', resume_state = NULL, updated_at = ?1, archived_at = ?1
             WHERE id = ?2 AND state <> 'ARCHIVED'",
            params![at, id],
        )?;
        if changed == 1 {
            return Ok(());
        }
        match campaign_state(&connection, id)? {
            Some(state) if state == "ARCHIVED" => Err(CampaignStoreError::AlreadyArchived),
            Some(_) => Err(CampaignStoreError::InvalidData),
            None => Err(CampaignStoreError::NotFound),
        }
    }

    pub(crate) fn connect(&self) -> Result<Connection, CampaignStoreError> {
        let connection = Connection::open(&self.database_path)?;
        connection.busy_timeout(Duration::from_secs(5))?;
        connection.execute_batch("PRAGMA foreign_keys = ON")?;
        Ok(connection)
    }

    fn create_at(&self, id: String, at: String) -> Result<CampaignSummary, CampaignStoreError> {
        validate_id(&id)?;
        validate_timestamp(&at)?;
        let connection = self.connect()?;
        connection.execute(
            "INSERT INTO campaigns (
               id, schema_version, state, resume_state, created_at, updated_at
             ) VALUES (?1, 1, 'CREATING_WORLD', NULL, ?2, ?2)",
            params![id, at],
        )?;
        Ok(CampaignSummary {
            id,
            state: "CREATING_WORLD".to_owned(),
            created_at: at.clone(),
            updated_at: at,
        })
    }

    fn touch_at(&self, id: &str, at: String) -> Result<CampaignSummary, CampaignStoreError> {
        validate_id(id)?;
        validate_timestamp(&at)?;
        let connection = self.connect()?;
        let changed = connection.execute(
            "UPDATE campaigns SET updated_at = ?1
             WHERE id = ?2 AND state <> 'ARCHIVED'",
            params![at, id],
        )?;
        if changed != 1 {
            return match campaign_state(&connection, id)? {
                Some(state) if state == "ARCHIVED" => Err(CampaignStoreError::AlreadyArchived),
                Some(_) => Err(CampaignStoreError::InvalidData),
                None => Err(CampaignStoreError::NotFound),
            };
        }
        load_campaign(&connection, id)?.ok_or(CampaignStoreError::NotFound)
    }
}

fn create_consistent_backup(database_path: &Path) -> Result<PathBuf, CampaignStoreError> {
    let backup_directory = backup_directory(database_path);
    std::fs::create_dir_all(&backup_directory)?;
    let database_name = database_path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or(CampaignStoreError::InvalidData)?;
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| CampaignStoreError::InvalidSystemTime)?
        .as_nanos();
    let prefix = format!("{database_name}.full-");
    let final_path =
        backup_directory.join(format!("{prefix}{timestamp:039}-{}.sqlite", Uuid::new_v4()));
    let mut working_name = final_path.as_os_str().to_os_string();
    working_name.push(".tmp");
    let working_path = PathBuf::from(working_name);

    let result = (|| {
        let source = Connection::open_with_flags(
            database_path,
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )?;
        assert_database_integrity(&source)?;
        source.backup("main", &working_path, None)?;
        let copy = Connection::open_with_flags(
            &working_path,
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )?;
        assert_database_integrity(&copy)?;
        drop(copy);
        std::fs::rename(&working_path, &final_path)?;
        rotate_consistent_backups(&backup_directory, &prefix)?;
        Ok(final_path.clone())
    })();

    if result.is_err() {
        let _ = std::fs::remove_file(&working_path);
        let _ = std::fs::remove_file(&final_path);
    }
    result
}

fn backup_directory(database_path: &Path) -> PathBuf {
    let mut path = OsString::from(database_path.as_os_str());
    path.push(".backups");
    PathBuf::from(path)
}

fn rotate_consistent_backups(directory: &Path, prefix: &str) -> Result<(), CampaignStoreError> {
    let mut backups = std::fs::read_dir(directory)?
        .filter_map(Result::ok)
        .filter(|entry| {
            entry.file_type().is_ok_and(|file_type| file_type.is_file())
                && entry
                    .file_name()
                    .to_str()
                    .is_some_and(|name| name.starts_with(prefix) && name.ends_with(".sqlite"))
        })
        .collect::<Vec<_>>();
    backups.sort_by_key(std::fs::DirEntry::file_name);
    let obsolete_count = backups.len().saturating_sub(FULL_BACKUP_RETENTION);
    for entry in backups.into_iter().take(obsolete_count) {
        std::fs::remove_file(entry.path())?;
    }
    Ok(())
}

fn assert_database_integrity(connection: &Connection) -> Result<(), CampaignStoreError> {
    let integrity =
        connection.query_row("PRAGMA integrity_check", [], |row| row.get::<_, String>(0))?;
    if integrity == "ok" {
        Ok(())
    } else {
        Err(CampaignStoreError::InvalidData)
    }
}

fn apply_migrations(connection: &mut Connection) -> Result<(), CampaignStoreError> {
    connection.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_migrations (
           version INTEGER PRIMARY KEY,
           name TEXT NOT NULL,
           applied_at TEXT NOT NULL
         )",
    )?;
    let latest_version = connection.query_row(
        "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
        [],
        |row| row.get::<_, i64>(0),
    )?;
    if latest_version > 1 {
        return Err(CampaignStoreError::IncompatibleSchema);
    }
    let applied_name = connection
        .query_row(
            "SELECT name FROM schema_migrations WHERE version = 1",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    if let Some(name) = applied_name {
        return if name == "initial" {
            Ok(())
        } else {
            Err(CampaignStoreError::IncompatibleSchema)
        };
    }

    let applied_at = current_timestamp()?;
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    transaction.execute_batch(INITIAL_MIGRATION)?;
    transaction.execute(
        "INSERT INTO schema_migrations (version, name, applied_at) VALUES (1, 'initial', ?1)",
        [applied_at],
    )?;
    transaction.commit()?;
    Ok(())
}

fn campaign_state(connection: &Connection, id: &str) -> Result<Option<String>, CampaignStoreError> {
    connection
        .query_row("SELECT state FROM campaigns WHERE id = ?1", [id], |row| {
            row.get(0)
        })
        .optional()
        .map_err(Into::into)
}

fn load_campaign(
    connection: &Connection,
    id: &str,
) -> Result<Option<CampaignSummary>, CampaignStoreError> {
    connection
        .query_row(
            "SELECT id, state, created_at, updated_at FROM campaigns WHERE id = ?1",
            [id],
            |row| {
                Ok(CampaignSummary {
                    id: row.get(0)?,
                    state: row.get(1)?,
                    created_at: row.get(2)?,
                    updated_at: row.get(3)?,
                })
            },
        )
        .optional()?
        .map(validate_campaign)
        .transpose()
}

fn validate_campaign(campaign: CampaignSummary) -> Result<CampaignSummary, CampaignStoreError> {
    validate_id(&campaign.id)?;
    if !CAMPAIGN_STATES.contains(&campaign.state.as_str()) {
        return Err(CampaignStoreError::InvalidData);
    }
    validate_timestamp(&campaign.created_at)?;
    validate_timestamp(&campaign.updated_at)?;
    if campaign.updated_at < campaign.created_at {
        return Err(CampaignStoreError::InvalidData);
    }
    Ok(campaign)
}

pub(crate) fn validate_id(id: &str) -> Result<(), CampaignStoreError> {
    if id.is_empty() || id.trim() != id {
        return Err(CampaignStoreError::InvalidData);
    }
    Ok(())
}

pub(crate) fn validate_timestamp(value: &str) -> Result<(), CampaignStoreError> {
    let parsed =
        OffsetDateTime::parse(value, &Rfc3339).map_err(|_| CampaignStoreError::InvalidData)?;
    let canonical = parsed
        .format(TIMESTAMP_FORMAT)
        .map_err(|_| CampaignStoreError::InvalidData)?;
    if canonical == value {
        Ok(())
    } else {
        Err(CampaignStoreError::InvalidData)
    }
}

pub(crate) fn current_timestamp() -> Result<String, CampaignStoreError> {
    OffsetDateTime::now_utc()
        .format(TIMESTAMP_FORMAT)
        .map_err(|_| CampaignStoreError::InvalidSystemTime)
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIRST_TIME: &str = "2026-07-31T01:02:03.004Z";
    const SECOND_TIME: &str = "2026-07-31T02:03:04.005Z";

    #[test]
    fn campaigns_survive_reopening_and_continue_updates_last_played() {
        let directory = tempfile::tempdir().expect("temp directory");
        let database_path = directory.path().join("ember-tavern.sqlite");
        let first = CampaignStore::open(&database_path).expect("open database");
        let created = first
            .create_at("campaign-one".to_owned(), FIRST_TIME.to_owned())
            .expect("create campaign");
        assert_eq!(created.state, "CREATING_WORLD");
        drop(first);

        let reopened = CampaignStore::open(&database_path).expect("reopen database");
        assert_eq!(reopened.list().expect("list campaigns"), vec![created]);
        let continued = reopened
            .touch_at("campaign-one", SECOND_TIME.to_owned())
            .expect("continue campaign");
        assert_eq!(continued.updated_at, SECOND_TIME);
        drop(reopened);

        let reopened_again = CampaignStore::open(&database_path).expect("reopen again");
        assert_eq!(
            reopened_again.list().expect("list after second reopen")[0].updated_at,
            SECOND_TIME
        );
    }

    #[test]
    fn native_startup_retains_three_verified_full_backups() {
        let directory = tempfile::tempdir().expect("temp directory");
        let database_path = directory.path().join("ember-tavern.sqlite");
        let store = CampaignStore::open(&database_path).expect("create database");
        store
            .create_at("campaign-one".to_owned(), FIRST_TIME.to_owned())
            .expect("create campaign");
        drop(store);

        for _ in 0..4 {
            drop(CampaignStore::open(&database_path).expect("reopen and back up"));
        }

        let directory = backup_directory(&database_path);
        let backups = std::fs::read_dir(directory)
            .expect("read backup directory")
            .filter_map(Result::ok)
            .filter(|entry| {
                entry
                    .path()
                    .extension()
                    .is_some_and(|value| value == "sqlite")
            })
            .collect::<Vec<_>>();
        assert_eq!(backups.len(), FULL_BACKUP_RETENTION);
        for backup in backups {
            let connection = Connection::open_with_flags(
                backup.path(),
                OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
            )
            .expect("open backup");
            assert_database_integrity(&connection).expect("backup integrity");
            assert_eq!(
                connection
                    .query_row("SELECT COUNT(*) FROM campaigns", [], |row| row
                        .get::<_, i64>(0))
                    .expect("campaign count"),
                1
            );
        }
    }

    #[test]
    fn native_backup_failure_leaves_main_database_bytes_unchanged() {
        let directory = tempfile::tempdir().expect("temp directory");
        let database_path = directory.path().join("ember-tavern.sqlite");
        let store = CampaignStore::open(&database_path).expect("create database");
        store
            .create_at("campaign-one".to_owned(), FIRST_TIME.to_owned())
            .expect("create campaign");
        drop(store);
        let before = std::fs::read(&database_path).expect("read database before failure");
        std::fs::write(backup_directory(&database_path), b"occupied")
            .expect("occupy backup directory path");

        assert!(matches!(
            CampaignStore::open(&database_path),
            Err(CampaignStoreError::Io(_))
        ));
        assert_eq!(
            std::fs::read(&database_path).expect("read database after failure"),
            before
        );
        let connection = Connection::open_with_flags(
            &database_path,
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )
        .expect("reopen main database");
        assert_eq!(
            connection
                .query_row("SELECT COUNT(*) FROM campaigns", [], |row| row
                    .get::<_, i64>(0))
                .expect("campaign count"),
            1
        );
    }

    #[test]
    fn archived_campaign_stays_in_sqlite_but_leaves_active_list() {
        let directory = tempfile::tempdir().expect("temp directory");
        let database_path = directory.path().join("ember-tavern.sqlite");
        let store = CampaignStore::open(&database_path).expect("open database");
        store
            .create_at("campaign-one".to_owned(), FIRST_TIME.to_owned())
            .expect("create campaign");

        store
            .archive_campaign("campaign-one")
            .expect("archive campaign");
        assert!(store.list().expect("list campaigns").is_empty());
        assert!(matches!(
            store.continue_campaign("campaign-one"),
            Err(CampaignStoreError::AlreadyArchived)
        ));

        let connection = Connection::open(database_path).expect("inspect database");
        let state: String = connection
            .query_row(
                "SELECT state FROM campaigns WHERE id = 'campaign-one'",
                [],
                |row| row.get(0),
            )
            .expect("archived row");
        assert_eq!(state, "ARCHIVED");
    }

    #[test]
    fn refuses_a_database_from_a_newer_schema_version() {
        let directory = tempfile::tempdir().expect("temp directory");
        let database_path = directory.path().join("ember-tavern.sqlite");
        let connection = Connection::open(&database_path).expect("open database");
        connection
            .execute_batch(
                "CREATE TABLE schema_migrations (
                   version INTEGER PRIMARY KEY,
                   name TEXT NOT NULL,
                   applied_at TEXT NOT NULL
                 );
                 INSERT INTO schema_migrations VALUES (2, 'future', '2026-07-31T01:02:03.004Z');",
            )
            .expect("seed future schema");
        drop(connection);

        assert!(matches!(
            CampaignStore::open(database_path),
            Err(CampaignStoreError::IncompatibleSchema)
        ));
    }
}

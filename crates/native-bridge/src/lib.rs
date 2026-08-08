//! Restricted native capabilities shared by Ember Tavern applications.

#![forbid(unsafe_code)]

mod adventure_play;
mod character_creation;
mod model_settings;
mod npc_dialogue;
mod quest_board;
mod save_archive;
mod settlement;
mod tavern_initialization;
#[cfg(test)]
mod windows_e2e;
mod world_creation;
pub use adventure_play::*;
pub use character_creation::*;
pub use model_settings::*;
pub use npc_dialogue::*;
pub use quest_board::*;
pub use save_archive::*;
pub use settlement::*;
pub use tavern_initialization::*;
pub use world_creation::*;

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use ember_platform_services::{AppInstanceLock, AppInstanceLockError, FileAppInstanceLock};
use rusqlite::{Connection, OpenFlags, OptionalExtension, TransactionBehavior, params};
use serde::Serialize;
use thiserror::Error;
use time::OffsetDateTime;
use time::format_description::FormatItem;
use time::format_description::well_known::Rfc3339;
use time::macros::format_description;
use uuid::Uuid;

const INITIAL_MIGRATION: &str = include_str!("../../../database/migrations/0001_initial.sql");
const CREDENTIAL_CLEANUP_MIGRATION: &str =
    include_str!("../../../database/migrations/0002_credential_cleanup_queue.sql");
const PROVIDER_PROBE_CONSISTENCY_MIGRATION: &str =
    include_str!("../../../database/migrations/0003_provider_probe_consistency.sql");
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
const RECOVERABLE_RESUME_STATES: &[&str] = &[
    "CREATING_WORLD",
    "REVIEWING_WORLD",
    "CREATING_CHARACTER",
    "GENERATING_TAVERN",
    "TAVERN",
    "ADVENTURE",
    "SETTLEMENT",
];

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CampaignSummary {
    pub id: String,
    pub state: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CampaignRecoverySnapshot {
    pub campaign: CampaignSummary,
    pub resume_state: String,
    pub unfinished_request_count: u64,
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
    #[error("save archive is invalid")]
    ArchiveInvalid,
    #[error("save archive conflicts with local state")]
    ArchiveConflict,
    #[error("save archive path is invalid")]
    ArchivePathInvalid,
    #[error("application coordination lock is unavailable")]
    AppLock(#[from] AppInstanceLockError),
    #[error("database changed while a destructive backup was being created")]
    ConcurrentModification,
}

/// Owns a platform database path without exposing SQL or file access to the WebView.
#[derive(Debug, Clone)]
pub struct CampaignStore {
    pub(crate) database_path: PathBuf,
    operation_lock: Arc<FileAppInstanceLock>,
}

impl CampaignStore {
    pub fn open(path: impl AsRef<Path>) -> Result<Self, CampaignStoreError> {
        let database_path = path.as_ref().to_path_buf();
        if let Some(parent) = database_path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let operation_lock = Arc::new(FileAppInstanceLock::new(operation_lock_path(
            &database_path,
        ))?);
        let _guard = operation_lock.acquire()?;
        if database_path.exists() {
            create_consistent_backup(&database_path)?;
        }
        let store = Self {
            database_path,
            operation_lock,
        };
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

    pub fn delete_campaign(&self, id: &str) -> Result<(), CampaignStoreError> {
        self.delete_campaign_with_backup_hook(id, || {})
    }

    fn delete_campaign_with_backup_hook(
        &self,
        id: &str,
        after_backup: impl FnOnce(),
    ) -> Result<(), CampaignStoreError> {
        validate_id(id)?;
        let _guard = self.operation_lock.acquire()?;
        let mut connection = self.connect()?;
        if campaign_state(&connection, id)?.is_none() {
            return Err(CampaignStoreError::NotFound);
        }
        let before_backup = database_data_version(&connection)?;
        create_consistent_backup(&self.database_path)?;
        after_backup();
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        if database_data_version(&transaction)? != before_backup {
            return Err(CampaignStoreError::ConcurrentModification);
        }
        if campaign_state(&transaction, id)?.is_none() {
            return Err(CampaignStoreError::NotFound);
        }
        let changed = transaction.execute("DELETE FROM campaigns WHERE id = ?1", [id])?;
        if changed != 1 {
            return Err(CampaignStoreError::NotFound);
        }
        transaction.commit()?;
        Ok(())
    }

    pub fn campaign_recovery(
        &self,
        id: &str,
    ) -> Result<CampaignRecoverySnapshot, CampaignStoreError> {
        validate_id(id)?;
        let connection = self.connect()?;
        let (campaign, resume_state) = connection
            .query_row(
                "SELECT id, state, created_at, updated_at, resume_state
                 FROM campaigns WHERE id = ?1",
                [id],
                |row| {
                    Ok((
                        CampaignSummary {
                            id: row.get(0)?,
                            state: row.get(1)?,
                            created_at: row.get(2)?,
                            updated_at: row.get(3)?,
                        },
                        row.get::<_, Option<String>>(4)?,
                    ))
                },
            )
            .optional()?
            .ok_or(CampaignStoreError::NotFound)?;
        if !matches!(
            campaign.state.as_str(),
            "GENERATION_FAILED" | "WAITING_FOR_MODEL" | "RECOVERY_REQUIRED"
        ) {
            return Err(CampaignStoreError::InvalidState);
        }
        let resume_state = resume_state.ok_or(CampaignStoreError::InvalidData)?;
        validate_resume_state(&resume_state)?;
        let unfinished_request_count = connection.query_row(
            "SELECT COUNT(*) FROM pending_ai_requests
             WHERE campaign_id = ?1 AND status NOT IN ('COMMITTED', 'CANCELLED')",
            [id],
            |row| row.get::<_, i64>(0),
        )?;
        let unfinished_request_count =
            u64::try_from(unfinished_request_count).map_err(|_| CampaignStoreError::InvalidData)?;
        Ok(CampaignRecoverySnapshot {
            campaign: validate_campaign(campaign)?,
            resume_state,
            unfinished_request_count,
        })
    }

    pub fn restore_campaign_after_failure(
        &self,
        id: &str,
    ) -> Result<CampaignSummary, CampaignStoreError> {
        validate_id(id)?;
        let _guard = self.operation_lock.acquire()?;
        let at = current_timestamp()?;
        let mut connection = self.connect()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let resume_state = transaction
            .query_row(
                "SELECT resume_state FROM campaigns
                 WHERE id = ?1 AND state IN ('GENERATION_FAILED', 'WAITING_FOR_MODEL', 'RECOVERY_REQUIRED')",
                [id],
                |row| row.get::<_, Option<String>>(0),
            )
            .optional()?
            .ok_or(CampaignStoreError::InvalidState)?
            .ok_or(CampaignStoreError::InvalidData)?;
        validate_resume_state(&resume_state)?;
        transaction.execute(
            "UPDATE pending_ai_requests SET status = 'CANCELLED', updated_at = ?1
             WHERE campaign_id = ?2 AND status NOT IN ('COMMITTED', 'CANCELLED')",
            params![at, id],
        )?;
        let changed = transaction.execute(
            "UPDATE campaigns SET state = ?1, resume_state = NULL, updated_at = ?2
             WHERE id = ?3 AND state IN ('GENERATION_FAILED', 'WAITING_FOR_MODEL', 'RECOVERY_REQUIRED')",
            params![resume_state, at, id],
        )?;
        if changed != 1 {
            return Err(CampaignStoreError::InvalidState);
        }
        let restored = load_campaign(&transaction, id)?.ok_or(CampaignStoreError::NotFound)?;
        transaction.commit()?;
        Ok(restored)
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

fn database_data_version(connection: &Connection) -> Result<i64, CampaignStoreError> {
    Ok(connection.query_row("PRAGMA data_version", [], |row| row.get(0))?)
}

fn operation_lock_path(database_path: &Path) -> PathBuf {
    let mut path = OsString::from(database_path.as_os_str());
    path.push(".operation.lock");
    PathBuf::from(path)
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
    if latest_version > 3 {
        return Err(CampaignStoreError::IncompatibleSchema);
    }

    for (version, name, sql) in [
        (1_i64, "initial", INITIAL_MIGRATION),
        (
            2_i64,
            "credential_cleanup_queue",
            CREDENTIAL_CLEANUP_MIGRATION,
        ),
        (
            3_i64,
            "provider_probe_consistency",
            PROVIDER_PROBE_CONSISTENCY_MIGRATION,
        ),
    ] {
        let applied_name = connection
            .query_row(
                "SELECT name FROM schema_migrations WHERE version = ?1",
                [version],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        if let Some(applied_name) = applied_name {
            if applied_name != name {
                return Err(CampaignStoreError::IncompatibleSchema);
            }
            continue;
        }

        let applied_at = current_timestamp()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        transaction.execute_batch(sql)?;
        transaction.execute(
            "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?1, ?2, ?3)",
            params![version, name, applied_at],
        )?;
        transaction.commit()?;
    }
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

fn validate_resume_state(state: &str) -> Result<(), CampaignStoreError> {
    if RECOVERABLE_RESUME_STATES.contains(&state) {
        Ok(())
    } else {
        Err(CampaignStoreError::InvalidData)
    }
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
    fn permanent_delete_removes_only_the_selected_campaign_after_backup() {
        let directory = tempfile::tempdir().expect("temp directory");
        let database_path = directory.path().join("ember-tavern.sqlite");
        let store = CampaignStore::open(&database_path).expect("open database");
        store
            .create_at("campaign-delete".to_owned(), FIRST_TIME.to_owned())
            .expect("create selected campaign");
        store
            .create_at("campaign-keep".to_owned(), SECOND_TIME.to_owned())
            .expect("create retained campaign");

        store
            .delete_campaign("campaign-delete")
            .expect("delete selected campaign");

        assert!(matches!(
            store.continue_campaign("campaign-delete"),
            Err(CampaignStoreError::NotFound)
        ));
        assert_eq!(store.list().expect("list campaigns").len(), 1);
        assert_eq!(store.list().expect("list campaigns")[0].id, "campaign-keep");
        assert!(
            backup_directory(&database_path)
                .read_dir()
                .expect("read backup directory")
                .any(|entry| entry
                    .expect("backup entry")
                    .path()
                    .extension()
                    .is_some_and(|ext| ext == "sqlite"))
        );
    }

    #[test]
    fn permanent_delete_aborts_when_another_store_writes_after_backup() {
        let directory = tempfile::tempdir().unwrap();
        let database_path = directory.path().join("delete-concurrency.sqlite");
        let first = CampaignStore::open(&database_path).unwrap();
        first
            .create_at("campaign-race".to_owned(), FIRST_TIME.to_owned())
            .unwrap();
        let second = CampaignStore::open(&database_path).unwrap();
        let concurrent_time = "2026-07-31T03:04:05.006Z";

        let result = first.delete_campaign_with_backup_hook("campaign-race", || {
            second
                .touch_at("campaign-race", concurrent_time.to_owned())
                .unwrap();
        });

        assert!(matches!(
            result,
            Err(CampaignStoreError::ConcurrentModification)
        ));
        let connection = first.connect().unwrap();
        let preserved: String = connection
            .query_row(
                "SELECT updated_at FROM campaigns WHERE id = 'campaign-race'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(preserved, concurrent_time);
    }

    #[test]
    fn recovery_cancels_unfinished_requests_and_restores_the_resume_state_atomically() {
        let directory = tempfile::tempdir().expect("temp directory");
        let store =
            CampaignStore::open(directory.path().join("recovery.sqlite")).expect("open database");
        store
            .create_at("campaign-recovery".to_owned(), FIRST_TIME.to_owned())
            .expect("create campaign");
        let connection = store.connect().expect("connect");
        connection
            .execute_batch(
                "UPDATE campaigns SET state = 'RECOVERY_REQUIRED', resume_state = 'CREATING_WORLD'
                   WHERE id = 'campaign-recovery';
                 INSERT INTO pending_ai_requests (
                   id, campaign_id, turn_id, idempotency_key, task, status, model_profile_id,
                   input_json, context_json, attempt_count, last_error_json, created_at, updated_at
                 ) VALUES (
                   'request-recovery', 'campaign-recovery', NULL, 'recovery-key', 'GENERATE_WORLD',
                   'SENDING', NULL, '{}', '{}', 1, NULL,
                   '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z'
                 );",
            )
            .expect("seed interrupted request");
        drop(connection);

        let issue = store
            .campaign_recovery("campaign-recovery")
            .expect("inspect recovery");
        assert_eq!(issue.resume_state, "CREATING_WORLD");
        assert_eq!(issue.unfinished_request_count, 1);

        let restored = store
            .restore_campaign_after_failure("campaign-recovery")
            .expect("restore campaign");
        assert_eq!(restored.state, "CREATING_WORLD");
        let connection = store.connect().expect("reconnect");
        assert_eq!(
            connection
                .query_row(
                    "SELECT status FROM pending_ai_requests WHERE id = 'request-recovery'",
                    [],
                    |row| row.get::<_, String>(0),
                )
                .expect("request status"),
            "CANCELLED"
        );

        assert!(matches!(
            validate_resume_state("ARCHIVED"),
            Err(CampaignStoreError::InvalidData)
        ));
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
                 INSERT INTO schema_migrations VALUES (4, 'future', '2026-07-31T01:02:03.004Z');",
            )
            .expect("seed future schema");
        drop(connection);

        assert!(matches!(
            CampaignStore::open(database_path),
            Err(CampaignStoreError::IncompatibleSchema)
        ));
    }
}

use std::collections::{BTreeMap, BTreeSet};
use std::fs::{self, OpenOptions};
use std::io::{Cursor, Read, Seek, Write};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use ember_platform_services::AppInstanceLock;
use regex::Regex;
use rusqlite::types::{Value as SqlValue, ValueRef};
use rusqlite::{
    Connection, OptionalExtension, Transaction, TransactionBehavior, params, params_from_iter,
};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Number, Value, json};
use sha2::{Digest, Sha256};
use uuid::Uuid;
use zip::read::ZipArchive;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipWriter};

use super::{
    CampaignStore, CampaignStoreError, CampaignSummary, create_consistent_backup,
    current_timestamp, database_data_version, load_campaign, validate_id, validate_timestamp,
};

const FORMAT_VERSION: u64 = 1;
const DATABASE_SCHEMA_VERSION: u64 = 1;
const LOCAL_DATABASE_SCHEMA_VERSION: i64 = 3;
const MAX_ARCHIVE_BYTES: u64 = 32 * 1024 * 1024;
const MAX_UNCOMPRESSED_BYTES: u64 = 64 * 1024 * 1024;
const MAX_COMPRESSION_RATIO: u64 = 100;
const MAX_JSON_DEPTH: usize = 64;
const MAX_JSON_ARRAY_LENGTH: usize = 100_000;
const MAX_JSON_STRING_BYTES: usize = 1_048_576;
const MAX_EVENT_RECORDS: usize = 100_000;
const MAX_GENERATION_RECORDS: usize = 20_000;
const MAX_TABLE_RECORDS: usize = 20_000;
const MAX_TOTAL_RECORDS: usize = 200_000;
const ENTRY_NAMES: [&str; 5] = [
    "manifest.json",
    "campaign.json",
    "events.ndjson",
    "generations.json",
    "checksum.json",
];
const CAMPAIGN_TABLES: [&str; 14] = [
    "world_bibles",
    "world_facts",
    "player_characters",
    "taverns",
    "npcs",
    "npc_knowledge",
    "npc_relationships",
    "quests",
    "adventures",
    "adventure_turns",
    "conversations",
    "messages",
    "items",
    "world_clocks",
];
const INSERT_ORDER: [&str; 14] = CAMPAIGN_TABLES;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CampaignArchiveImportMode {
    Create,
    Overwrite,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CampaignArchiveInspection {
    pub campaign_id: String,
    pub campaign_exists: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CampaignArchiveExportResult {
    pub campaign_id: String,
    pub path: String,
}

#[derive(Debug)]
struct ParsedArchive {
    campaign_id: String,
    campaign: Map<String, Value>,
    tables: BTreeMap<String, Vec<Map<String, Value>>>,
    events: Vec<Map<String, Value>>,
    generations: Vec<Map<String, Value>>,
}

impl CampaignStore {
    pub fn inspect_campaign_archive(
        &self,
        path: impl AsRef<Path>,
    ) -> Result<CampaignArchiveInspection, CampaignStoreError> {
        let bytes = read_archive_path(path.as_ref())?;
        let parsed = parse_archive(&bytes)?;
        let connection = self.connect()?;
        let campaign_exists = connection
            .query_row(
                "SELECT 1 FROM campaigns WHERE id = ?1",
                [&parsed.campaign_id],
                |_| Ok(()),
            )
            .optional()?
            .is_some();
        Ok(CampaignArchiveInspection {
            campaign_id: parsed.campaign_id,
            campaign_exists,
        })
    }

    pub fn export_campaign_archive(
        &self,
        campaign_id: &str,
        path: impl AsRef<Path>,
        generator_version: &str,
    ) -> Result<CampaignArchiveExportResult, CampaignStoreError> {
        validate_id(campaign_id)?;
        if generator_version.is_empty()
            || generator_version.trim() != generator_version
            || generator_version.len() > 100
        {
            return Err(CampaignStoreError::ArchiveInvalid);
        }
        self.export_campaign_archive_at(campaign_id, path, generator_version, &current_timestamp()?)
    }

    fn export_campaign_archive_at(
        &self,
        campaign_id: &str,
        path: impl AsRef<Path>,
        generator_version: &str,
        created_at: &str,
    ) -> Result<CampaignArchiveExportResult, CampaignStoreError> {
        validate_timestamp(created_at)?;
        let bytes = self.capture_archive(campaign_id, created_at, generator_version)?;
        let destination = validate_archive_destination(path.as_ref())?;
        publish_archive(&destination, &bytes)?;
        Ok(CampaignArchiveExportResult {
            campaign_id: campaign_id.to_owned(),
            path: destination.to_string_lossy().into_owned(),
        })
    }

    pub fn import_campaign_archive(
        &self,
        path: impl AsRef<Path>,
        mode: CampaignArchiveImportMode,
    ) -> Result<CampaignSummary, CampaignStoreError> {
        self.import_campaign_archive_with_backup_hook(path, mode, || {})
    }

    fn import_campaign_archive_with_backup_hook(
        &self,
        path: impl AsRef<Path>,
        mode: CampaignArchiveImportMode,
        after_backup: impl FnOnce(),
    ) -> Result<CampaignSummary, CampaignStoreError> {
        let bytes = read_archive_path(path.as_ref())?;
        let parsed = parse_archive(&bytes)?;
        let imported_at = current_timestamp()?;
        let _guard = self.operation_lock.acquire()?;
        let mut connection = self.connect()?;
        let exists = campaign_exists(&connection, &parsed.campaign_id)?;
        match mode {
            CampaignArchiveImportMode::Create if exists => {
                return Err(CampaignStoreError::ArchiveConflict);
            }
            CampaignArchiveImportMode::Overwrite if !exists => {
                return Err(CampaignStoreError::ArchiveConflict);
            }
            CampaignArchiveImportMode::Overwrite | CampaignArchiveImportMode::Create => {}
        }
        let before_backup = if matches!(mode, CampaignArchiveImportMode::Overwrite) {
            let version = database_data_version(&connection)?;
            create_consistent_backup(&self.database_path)?;
            after_backup();
            Some(version)
        } else {
            None
        };
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        if let Some(version) = before_backup
            && database_data_version(&transaction)? != version
        {
            return Err(CampaignStoreError::ConcurrentModification);
        }

        let current_exists = campaign_exists(&transaction, &parsed.campaign_id)?;
        if current_exists != matches!(mode, CampaignArchiveImportMode::Overwrite) {
            return Err(CampaignStoreError::ArchiveConflict);
        }
        transaction.execute_batch("PRAGMA defer_foreign_keys = ON")?;
        if matches!(mode, CampaignArchiveImportMode::Overwrite) {
            transaction.execute("DELETE FROM campaigns WHERE id = ?1", [&parsed.campaign_id])?;
        }
        insert_row(&transaction, "campaigns", &parsed.campaign)?;
        for row in &parsed.generations {
            insert_row(&transaction, "generation_records", row)?;
        }
        for table in INSERT_ORDER {
            let rows = parsed
                .tables
                .get(table)
                .ok_or(CampaignStoreError::ArchiveInvalid)?;
            for row in rows {
                insert_row(&transaction, table, row)?;
            }
        }
        for row in &parsed.events {
            insert_row(&transaction, "game_events", row)?;
        }
        assert_foreign_keys(&transaction)?;
        validate_imported_state(&transaction, &parsed)?;
        create_import_snapshot(&transaction, &parsed, &imported_at)?;
        assert_foreign_keys(&transaction)?;
        let campaign = load_campaign(&transaction, &parsed.campaign_id)?
            .ok_or(CampaignStoreError::ArchiveInvalid)?;
        transaction.commit()?;
        Ok(campaign)
    }

    fn capture_archive(
        &self,
        campaign_id: &str,
        created_at: &str,
        generator_version: &str,
    ) -> Result<Vec<u8>, CampaignStoreError> {
        let mut connection = self.connect()?;
        let transaction = connection.transaction()?;
        assert_database_ready(&transaction)?;
        let mut campaign = query_one_row(
            &transaction,
            "campaigns",
            "SELECT * FROM campaigns WHERE id = ?1",
            campaign_id,
        )?
        .ok_or(CampaignStoreError::NotFound)?;
        campaign.insert("default_model_profile_id".to_owned(), Value::Null);
        campaign.insert("fallback_model_profile_id".to_owned(), Value::Null);
        campaign.insert(
            "task_model_overrides_json".to_owned(),
            Value::String("{}".to_owned()),
        );
        let mut tables = Map::new();
        let mut total_records = 1_usize;
        for table in CAMPAIGN_TABLES {
            let rows = query_campaign_table(&transaction, table, campaign_id)?;
            validate_record_count(rows.len(), MAX_TABLE_RECORDS)?;
            total_records = total_records
                .checked_add(rows.len())
                .ok_or(CampaignStoreError::ArchiveInvalid)?;
            tables.insert(
                table.to_owned(),
                Value::Array(rows.into_iter().map(Value::Object).collect()),
            );
        }
        let events = query_rows(
            &transaction,
            "game_events",
            "SELECT * FROM game_events WHERE campaign_id = ?1 ORDER BY occurred_at, id",
            campaign_id,
        )?;
        validate_record_count(events.len(), MAX_EVENT_RECORDS)?;
        let mut generations = query_rows(
            &transaction,
            "generation_records",
            "SELECT * FROM generation_records WHERE campaign_id = ?1 ORDER BY started_at, id",
            campaign_id,
        )?;
        validate_record_count(generations.len(), MAX_GENERATION_RECORDS)?;
        total_records = total_records
            .checked_add(events.len())
            .and_then(|total| total.checked_add(generations.len()))
            .ok_or(CampaignStoreError::ArchiveInvalid)?;
        validate_record_count(total_records, MAX_TOTAL_RECORDS)?;
        for generation in &mut generations {
            generation.insert("model_profile_id".to_owned(), Value::Null);
        }
        transaction.commit()?;

        let manifest = json!({
            "application": "ember-tavern",
            "campaignId": campaign_id,
            "createdAt": created_at,
            "databaseSchemaVersion": DATABASE_SCHEMA_VERSION,
            "files": {
                "campaign.json": { "mediaType": "application/json", "records": 1 },
                "events.ndjson": { "mediaType": "application/x-ndjson", "records": events.len() },
                "generations.json": { "mediaType": "application/json", "records": generations.len() }
            },
            "formatVersion": FORMAT_VERSION,
            "generatorVersion": generator_version
        });
        let campaign_document = json!({
            "campaign": campaign,
            "campaignId": campaign_id,
            "databaseSchemaVersion": DATABASE_SCHEMA_VERSION,
            "formatVersion": FORMAT_VERSION,
            "tables": tables
        });
        let generation_document = json!({
            "campaignId": campaign_id,
            "databaseSchemaVersion": DATABASE_SCHEMA_VERSION,
            "formatVersion": FORMAT_VERSION,
            "records": generations
        });
        let mut files = BTreeMap::new();
        files.insert(
            "manifest.json".to_owned(),
            canonical_document_bytes(&manifest)?,
        );
        files.insert(
            "campaign.json".to_owned(),
            canonical_document_bytes(&campaign_document)?,
        );
        files.insert("events.ndjson".to_owned(), canonical_ndjson_bytes(&events)?);
        files.insert(
            "generations.json".to_owned(),
            canonical_document_bytes(&generation_document)?,
        );
        let checksum = json!({
            "algorithm": "SHA-256",
            "files": files.iter().map(|(name, bytes)| (name.clone(), Value::String(sha256(bytes)))).collect::<Map<_, _>>(),
            "formatVersion": FORMAT_VERSION
        });
        files.insert(
            "checksum.json".to_owned(),
            canonical_document_bytes(&checksum)?,
        );
        encode_zip(&files)
    }
}

fn query_campaign_table(
    connection: &Connection,
    table: &str,
    campaign_id: &str,
) -> Result<Vec<Map<String, Value>>, CampaignStoreError> {
    let sql = match table {
        "world_bibles" => "SELECT * FROM world_bibles WHERE campaign_id = ?1 ORDER BY campaign_id",
        "world_facts" => "SELECT * FROM world_facts WHERE campaign_id = ?1 ORDER BY id",
        "player_characters" => "SELECT * FROM player_characters WHERE campaign_id = ?1 ORDER BY id",
        "taverns" => "SELECT * FROM taverns WHERE campaign_id = ?1 ORDER BY id",
        "npcs" => "SELECT * FROM npcs WHERE campaign_id = ?1 ORDER BY id",
        "npc_knowledge" => {
            "SELECT npc_knowledge.* FROM npc_knowledge JOIN npcs ON npcs.id = npc_knowledge.npc_id WHERE npcs.campaign_id = ?1 ORDER BY npc_knowledge.npc_id"
        }
        "npc_relationships" => {
            "SELECT npc_relationships.* FROM npc_relationships JOIN npcs ON npcs.id = npc_relationships.npc_id WHERE npcs.campaign_id = ?1 ORDER BY npc_relationships.npc_id"
        }
        "quests" => "SELECT * FROM quests WHERE campaign_id = ?1 ORDER BY id",
        "adventures" => "SELECT * FROM adventures WHERE campaign_id = ?1 ORDER BY id",
        "adventure_turns" => {
            "SELECT adventure_turns.* FROM adventure_turns JOIN adventures ON adventures.id = adventure_turns.adventure_id WHERE adventures.campaign_id = ?1 ORDER BY adventure_turns.adventure_id, adventure_turns.turn_number, adventure_turns.id"
        }
        "conversations" => "SELECT * FROM conversations WHERE campaign_id = ?1 ORDER BY id",
        "messages" => {
            "SELECT messages.* FROM messages JOIN conversations ON conversations.id = messages.conversation_id WHERE conversations.campaign_id = ?1 ORDER BY messages.conversation_id, messages.sequence_number, messages.id"
        }
        "items" => "SELECT * FROM items WHERE campaign_id = ?1 ORDER BY id",
        "world_clocks" => "SELECT * FROM world_clocks WHERE campaign_id = ?1 ORDER BY id",
        _ => return Err(CampaignStoreError::ArchiveInvalid),
    };
    query_rows(connection, table, sql, campaign_id)
}

fn query_one_row(
    connection: &Connection,
    table: &str,
    sql: &str,
    campaign_id: &str,
) -> Result<Option<Map<String, Value>>, CampaignStoreError> {
    let mut rows = query_rows(connection, table, sql, campaign_id)?;
    if rows.len() > 1 {
        return Err(CampaignStoreError::ArchiveInvalid);
    }
    Ok(rows.pop())
}

fn query_rows(
    connection: &Connection,
    table: &str,
    sql: &str,
    campaign_id: &str,
) -> Result<Vec<Map<String, Value>>, CampaignStoreError> {
    let mut statement = connection.prepare(sql)?;
    let columns = statement
        .column_names()
        .into_iter()
        .map(str::to_owned)
        .collect::<Vec<_>>();
    let rows = statement.query_map([campaign_id], |row| {
        let mut result = Map::new();
        for (index, column) in columns.iter().enumerate() {
            let value = match row.get_ref(index)? {
                ValueRef::Null => Value::Null,
                ValueRef::Integer(value) => Value::Number(Number::from(value)),
                ValueRef::Real(_) | ValueRef::Blob(_) => {
                    return Err(rusqlite::Error::InvalidColumnType(
                        index,
                        column.clone(),
                        row.get_ref(index)?.data_type(),
                    ));
                }
                ValueRef::Text(value) => {
                    let text = std::str::from_utf8(value).map_err(|error| {
                        rusqlite::Error::FromSqlConversionFailure(
                            value.len(),
                            rusqlite::types::Type::Text,
                            Box::new(error),
                        )
                    })?;
                    Value::String(text.to_owned())
                }
            };
            result.insert(column.clone(), value);
        }
        Ok(result)
    })?;
    let mut rows = rows.collect::<Result<Vec<_>, _>>()?;
    for row in &mut rows {
        for (column, value) in row.iter_mut() {
            if is_json_column(table, column) && !value.is_null() {
                let normalized = normalize_json_text(
                    value.as_str().ok_or(CampaignStoreError::ArchiveInvalid)?,
                    table,
                    column,
                )?;
                *value = Value::String(normalized);
            }
            if table == "generation_records"
                && column == "raw_response_text"
                && let Some(text) = value.as_str()
            {
                scan_json_text_if_present(text)?;
            }
        }
        parse_stored_row(row, table)?;
    }
    Ok(rows)
}

fn encode_zip(files: &BTreeMap<String, Vec<u8>>) -> Result<Vec<u8>, CampaignStoreError> {
    let mut uncompressed_total = 0_u64;
    for name in ENTRY_NAMES {
        let bytes = files.get(name).ok_or(CampaignStoreError::ArchiveInvalid)?;
        assert_no_secret_text(
            std::str::from_utf8(bytes).map_err(|_| CampaignStoreError::ArchiveInvalid)?,
        )?;
        validate_archive_entry_resources(name, bytes.len() as u64, bytes.len() as u64)?;
        uncompressed_total = add_expanded_bytes(uncompressed_total, bytes.len() as u64)?;
    }
    let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
    for name in ENTRY_NAMES {
        let bytes = files.get(name).ok_or(CampaignStoreError::ArchiveInvalid)?;
        writer
            .start_file(name, options)
            .map_err(|_| CampaignStoreError::ArchiveInvalid)?;
        writer.write_all(bytes)?;
    }
    let bytes = writer
        .finish()
        .map_err(|_| CampaignStoreError::ArchiveInvalid)?
        .into_inner();
    if bytes.len() as u64 > MAX_ARCHIVE_BYTES {
        return Err(CampaignStoreError::ArchiveInvalid);
    }
    assert_no_secret_text(&String::from_utf8_lossy(&bytes))?;
    Ok(bytes)
}

fn parse_archive(bytes: &[u8]) -> Result<ParsedArchive, CampaignStoreError> {
    if bytes.len() < 22 || bytes.len() as u64 > MAX_ARCHIVE_BYTES {
        return Err(CampaignStoreError::ArchiveInvalid);
    }
    let mut archive =
        ZipArchive::new(Cursor::new(bytes)).map_err(|_| CampaignStoreError::ArchiveInvalid)?;
    if archive.len() != ENTRY_NAMES.len() {
        return Err(CampaignStoreError::ArchiveInvalid);
    }
    let allowed = ENTRY_NAMES.into_iter().collect::<BTreeSet<_>>();
    let mut seen = BTreeSet::new();
    let mut uncompressed_total = 0_u64;
    for index in 0..archive.len() {
        let file = archive
            .by_index(index)
            .map_err(|_| CampaignStoreError::ArchiveInvalid)?;
        let name = file.name().to_owned();
        if !allowed.contains(name.as_str())
            || !seen.insert(name.clone())
            || file.is_dir()
            || file.enclosed_name().is_none()
            || file
                .unix_mode()
                .is_some_and(|mode| mode & 0o170000 == 0o120000)
            || !matches!(
                file.compression(),
                CompressionMethod::Stored | CompressionMethod::Deflated
            )
        {
            return Err(CampaignStoreError::ArchiveInvalid);
        }
        uncompressed_total = add_expanded_bytes(uncompressed_total, file.size())?;
        validate_archive_entry_resources(&name, file.compressed_size(), file.size())?;
    }
    if seen.len() != ENTRY_NAMES.len() {
        return Err(CampaignStoreError::ArchiveInvalid);
    }

    let checksum = parse_canonical_document(&read_archive_entry(&mut archive, "checksum.json")?)?;
    let expected_checksums = validate_checksum_document(&checksum)?;
    let manifest = parse_canonical_document(&read_verified_archive_entry(
        &mut archive,
        &expected_checksums,
        "manifest.json",
    )?)?;
    require_exact_keys(
        &manifest,
        &[
            "application",
            "campaignId",
            "createdAt",
            "databaseSchemaVersion",
            "files",
            "formatVersion",
            "generatorVersion",
        ],
    )?;
    if manifest.get("application") != Some(&Value::String("ember-tavern".to_owned()))
        || manifest.get("formatVersion").and_then(Value::as_u64) != Some(FORMAT_VERSION)
    {
        return Err(CampaignStoreError::ArchiveInvalid);
    }
    let database_version = manifest
        .get("databaseSchemaVersion")
        .and_then(Value::as_u64)
        .ok_or(CampaignStoreError::ArchiveInvalid)?;
    if database_version != DATABASE_SCHEMA_VERSION {
        return Err(CampaignStoreError::IncompatibleSchema);
    }
    let campaign_id = require_text(manifest.get("campaignId"))?.to_owned();
    validate_id(&campaign_id)?;
    validate_timestamp(require_text(manifest.get("createdAt"))?)?;
    let generator = require_text(manifest.get("generatorVersion"))?;
    if generator.len() > 100 || generator.trim() != generator {
        return Err(CampaignStoreError::ArchiveInvalid);
    }

    let campaign_document = parse_canonical_document(&read_verified_archive_entry(
        &mut archive,
        &expected_checksums,
        "campaign.json",
    )?)?;
    let generation_document = parse_canonical_document(&read_verified_archive_entry(
        &mut archive,
        &expected_checksums,
        "generations.json",
    )?)?;
    validate_envelope(&campaign_document, &campaign_id, database_version)?;
    validate_envelope(&generation_document, &campaign_id, database_version)?;
    require_exact_keys(
        &campaign_document,
        &[
            "campaign",
            "campaignId",
            "databaseSchemaVersion",
            "formatVersion",
            "tables",
        ],
    )?;
    require_exact_keys(
        &generation_document,
        &[
            "campaignId",
            "databaseSchemaVersion",
            "formatVersion",
            "records",
        ],
    )?;
    let campaign = parse_stored_row(
        require_object(campaign_document.get("campaign"))?,
        "campaigns",
    )?;
    if campaign.get("id").and_then(Value::as_str) != Some(campaign_id.as_str())
        || campaign.get("default_model_profile_id") != Some(&Value::Null)
        || campaign.get("fallback_model_profile_id") != Some(&Value::Null)
        || campaign
            .get("task_model_overrides_json")
            .and_then(Value::as_str)
            != Some("{}")
    {
        return Err(CampaignStoreError::ArchiveInvalid);
    }
    let table_root = require_object(campaign_document.get("tables"))?;
    require_exact_keys(table_root, &CAMPAIGN_TABLES)?;
    let mut tables = BTreeMap::new();
    let mut total_records = 1_usize;
    for table in CAMPAIGN_TABLES {
        let values = require_array(table_root.get(table))?;
        validate_record_count(values.len(), MAX_TABLE_RECORDS)?;
        total_records = total_records
            .checked_add(values.len())
            .ok_or(CampaignStoreError::ArchiveInvalid)?;
        let rows = values
            .iter()
            .map(|value| parse_stored_row(require_object(Some(value))?, table))
            .collect::<Result<Vec<_>, _>>()?;
        for row in &rows {
            if row.contains_key("campaign_id")
                && row.get("campaign_id").and_then(Value::as_str) != Some(campaign_id.as_str())
            {
                return Err(CampaignStoreError::ArchiveInvalid);
            }
        }
        tables.insert(table.to_owned(), rows);
    }
    let generation_values = require_array(generation_document.get("records"))?;
    validate_record_count(generation_values.len(), MAX_GENERATION_RECORDS)?;
    total_records = total_records
        .checked_add(generation_values.len())
        .ok_or(CampaignStoreError::ArchiveInvalid)?;
    let generations = generation_values
        .iter()
        .map(|value| parse_stored_row(require_object(Some(value))?, "generation_records"))
        .collect::<Result<Vec<_>, _>>()?;
    for row in &generations {
        if row.get("campaign_id").and_then(Value::as_str) != Some(campaign_id.as_str())
            || row.get("model_profile_id") != Some(&Value::Null)
        {
            return Err(CampaignStoreError::ArchiveInvalid);
        }
    }
    let events = parse_events(
        &read_verified_archive_entry(&mut archive, &expected_checksums, "events.ndjson")?,
        &campaign_id,
    )?;
    total_records = total_records
        .checked_add(events.len())
        .ok_or(CampaignStoreError::ArchiveInvalid)?;
    if total_records > MAX_TOTAL_RECORDS {
        return Err(CampaignStoreError::ArchiveInvalid);
    }
    validate_manifest_counts(&manifest, events.len(), generations.len())?;
    Ok(ParsedArchive {
        campaign_id,
        campaign,
        tables,
        events,
        generations,
    })
}

fn parse_events(
    bytes: &[u8],
    campaign_id: &str,
) -> Result<Vec<Map<String, Value>>, CampaignStoreError> {
    if bytes.is_empty() {
        return Ok(Vec::new());
    }
    if !bytes.ends_with(b"\n") || bytes.starts_with(&[0xef, 0xbb, 0xbf]) {
        return Err(CampaignStoreError::ArchiveInvalid);
    }
    let text = std::str::from_utf8(bytes).map_err(|_| CampaignStoreError::ArchiveInvalid)?;
    let mut rows = Vec::new();
    for line in text[..text.len() - 1].split('\n') {
        validate_record_count(rows.len().saturating_add(1), MAX_EVENT_RECORDS)?;
        if line.is_empty() {
            return Err(CampaignStoreError::ArchiveInvalid);
        }
        validate_json_text_resources(line.as_bytes())?;
        let value: Value =
            serde_json::from_str(line).map_err(|_| CampaignStoreError::ArchiveInvalid)?;
        validate_json_value_resources(&value)?;
        if canonical_json_bytes(&value)? != line.as_bytes() {
            return Err(CampaignStoreError::ArchiveInvalid);
        }
        let row = parse_stored_row(require_object(Some(&value))?, "game_events")?;
        if row.get("campaign_id").and_then(Value::as_str) != Some(campaign_id) {
            return Err(CampaignStoreError::ArchiveInvalid);
        }
        rows.push(row);
    }
    Ok(rows)
}

fn validate_checksum_document(
    checksum: &Map<String, Value>,
) -> Result<BTreeMap<String, String>, CampaignStoreError> {
    require_exact_keys(checksum, &["algorithm", "files", "formatVersion"])?;
    if checksum.get("algorithm") != Some(&Value::String("SHA-256".to_owned()))
        || checksum.get("formatVersion").and_then(Value::as_u64) != Some(FORMAT_VERSION)
    {
        return Err(CampaignStoreError::ArchiveInvalid);
    }
    let expected_names = [
        "campaign.json",
        "events.ndjson",
        "generations.json",
        "manifest.json",
    ];
    let expected = require_object(checksum.get("files"))?;
    require_exact_keys(expected, &expected_names)?;
    let mut result = BTreeMap::new();
    for name in expected_names {
        let digest = require_text(expected.get(name))?;
        if digest.len() != 64
            || !digest
                .bytes()
                .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
        {
            return Err(CampaignStoreError::ArchiveInvalid);
        }
        result.insert(name.to_owned(), digest.to_owned());
    }
    Ok(result)
}

fn validate_manifest_counts(
    manifest: &Map<String, Value>,
    event_count: usize,
    generation_count: usize,
) -> Result<(), CampaignStoreError> {
    let files = require_object(manifest.get("files"))?;
    require_exact_keys(
        files,
        &["campaign.json", "events.ndjson", "generations.json"],
    )?;
    for (name, media_type, count) in [
        ("campaign.json", "application/json", 1_u64),
        ("events.ndjson", "application/x-ndjson", event_count as u64),
        (
            "generations.json",
            "application/json",
            generation_count as u64,
        ),
    ] {
        let entry = require_object(files.get(name))?;
        require_exact_keys(entry, &["mediaType", "records"])?;
        if entry.get("mediaType") != Some(&Value::String(media_type.to_owned()))
            || entry.get("records").and_then(Value::as_u64) != Some(count)
        {
            return Err(CampaignStoreError::ArchiveInvalid);
        }
    }
    Ok(())
}

fn validate_envelope(
    document: &Map<String, Value>,
    campaign_id: &str,
    database_version: u64,
) -> Result<(), CampaignStoreError> {
    if document.get("campaignId").and_then(Value::as_str) != Some(campaign_id)
        || document
            .get("databaseSchemaVersion")
            .and_then(Value::as_u64)
            != Some(database_version)
        || document.get("formatVersion").and_then(Value::as_u64) != Some(FORMAT_VERSION)
    {
        return Err(CampaignStoreError::ArchiveInvalid);
    }
    Ok(())
}

fn parse_stored_row(
    source: &Map<String, Value>,
    table: &str,
) -> Result<Map<String, Value>, CampaignStoreError> {
    let mut result = Map::new();
    for (column, value) in source {
        if !matches!(value, Value::Null | Value::String(_) | Value::Number(_))
            || value.as_number().is_some_and(|number| !number.is_i64())
        {
            return Err(CampaignStoreError::ArchiveInvalid);
        }
        if value
            .as_str()
            .is_some_and(|text| text.len() > MAX_JSON_STRING_BYTES)
        {
            return Err(CampaignStoreError::ArchiveInvalid);
        }
        if let Some(text) = value.as_str() {
            assert_no_secret_text(text)?;
        }
        if is_json_column(table, column) && !value.is_null() {
            let text = value.as_str().ok_or(CampaignStoreError::ArchiveInvalid)?;
            if normalize_json_text(text, table, column)? != text {
                return Err(CampaignStoreError::ArchiveInvalid);
            }
        }
        if !value.is_null() && (column == "id" || column.ends_with("_id")) {
            validate_id(value.as_str().ok_or(CampaignStoreError::ArchiveInvalid)?)?;
        }
        if !value.is_null() && column.ends_with("_at") {
            validate_timestamp(value.as_str().ok_or(CampaignStoreError::ArchiveInvalid)?)?;
        }
        if table == "generation_records"
            && column == "raw_response_text"
            && let Some(text) = value.as_str()
        {
            scan_json_text_if_present(text)?;
        }
        result.insert(column.clone(), value.clone());
    }
    Ok(result)
}

fn normalize_json_text(
    text: &str,
    table: &str,
    column: &str,
) -> Result<String, CampaignStoreError> {
    validate_json_text_resources(text.as_bytes())?;
    let value: Value =
        serde_json::from_str(text).map_err(|_| CampaignStoreError::ArchiveInvalid)?;
    validate_json_value_resources(&value)?;
    validate_json_container(table, column, &value)?;
    assert_no_secret_keys(&value)?;
    String::from_utf8(canonical_json_bytes(&value)?).map_err(|_| CampaignStoreError::ArchiveInvalid)
}

fn validate_json_container(
    table: &str,
    column: &str,
    value: &Value,
) -> Result<(), CampaignStoreError> {
    let object = matches!(
        (table, column),
        ("campaigns", "task_model_overrides_json")
            | ("world_facts", "detail_json")
            | (
                "player_characters",
                "content_boundaries_json" | "attributes_json" | "background_json"
            )
            | ("npcs", "visit_json")
            | ("quests", "content_json")
            | ("adventures", "plan_json" | "ending_json")
            | (
                "adventure_turns",
                "player_action_json" | "check_request_json" | "dice_result_json"
            )
            | ("items", "content_json" | "effect_json")
            | ("game_events", "payload_json")
            | (
                "generation_records",
                "request_json" | "validated_output_json" | "validation_error_json"
            )
    );
    if (object && !value.is_object()) || (!object && !value.is_array()) {
        return Err(CampaignStoreError::ArchiveInvalid);
    }
    Ok(())
}

fn scan_json_text_if_present(text: &str) -> Result<(), CampaignStoreError> {
    assert_no_secret_text(text)?;
    let trimmed = text.trim();
    if !(trimmed.starts_with('{') || trimmed.starts_with('[')) {
        return Ok(());
    }
    validate_json_text_resources(trimmed.as_bytes())?;
    if let Ok(value) = serde_json::from_str::<Value>(trimmed) {
        validate_json_value_resources(&value)?;
        assert_no_secret_keys(&value)?;
    }
    Ok(())
}

fn assert_no_secret_keys(value: &Value) -> Result<(), CampaignStoreError> {
    match value {
        Value::Array(values) => {
            for value in values {
                assert_no_secret_keys(value)?;
            }
        }
        Value::Object(values) => {
            for (key, value) in values {
                let normalized = key
                    .chars()
                    .filter(|character| !matches!(character, '_' | '-'))
                    .flat_map(char::to_lowercase)
                    .collect::<String>();
                if normalized.contains("apikey")
                    || matches!(
                        normalized.as_str(),
                        "authorization" | "bearer" | "cookie" | "password" | "token"
                    )
                    || normalized.contains("accesstoken")
                    || normalized.contains("secretkey")
                    || normalized.contains("credentialref")
                {
                    return Err(CampaignStoreError::ArchiveInvalid);
                }
                assert_no_secret_keys(value)?;
            }
        }
        Value::String(text) => assert_no_secret_text(text)?,
        _ => {}
    }
    Ok(())
}

fn assert_no_secret_text(text: &str) -> Result<(), CampaignStoreError> {
    if secret_patterns()
        .iter()
        .any(|pattern| pattern.is_match(text))
    {
        return Err(CampaignStoreError::ArchiveInvalid);
    }
    Ok(())
}

fn secret_patterns() -> &'static [Regex] {
    static PATTERNS: OnceLock<Vec<Regex>> = OnceLock::new();
    PATTERNS.get_or_init(|| {
        [
            r"(?i)\bcredential:v1:[0-9a-f]{8}-[0-9a-f-]{27,}\b",
            r"(?i)\bsk-(?:or-v1-|ant-api\d{2}-)?[a-z0-9_-]{8,}\b",
            r"(?i)\bAIza[0-9a-z_-]{20,}\b",
            r"\bAKIA[0-9A-Z]{16}\b",
            r"(?i)\bgh[pousr]_[0-9a-z]{20,}\b",
            r"(?i)\bxox[baprs]-[0-9a-z-]{12,}\b",
            r"(?i)\beyJ[0-9a-z_-]{8,}\.[0-9a-z_-]{8,}\.[0-9a-z_-]{8,}\b",
            r"(?i)\b(?:authorization|proxy-authorization)\s*[:=]\s*(?:bearer|basic)\s+[0-9a-z._~+/-]{8,}={0,2}",
            r"(?i)\bbearer\s+[0-9a-z._~+/-]{12,}={0,2}",
            r"(?i)\b(?:api[_ -]?key|access[_ -]?token|secret[_ -]?key|password|cookie)\s*[:=]\s*[0-9a-z._~+/-]{8,}={0,2}",
            r"\bTOP_SECRET_[0-9A-Z_]{8,}\b",
        ]
        .into_iter()
        .map(|pattern| Regex::new(pattern).expect("static secret pattern"))
        .collect()
    })
}

fn is_json_column(table: &str, column: &str) -> bool {
    matches!(
        (table, column),
        ("campaigns", "task_model_overrides_json")
            | (
                "world_bibles",
                "power_rules_json"
                    | "factions_json"
                    | "locations_json"
                    | "forbidden_elements_json"
                    | "story_hooks_json"
                    | "locked_fields_json"
            )
            | ("world_facts", "faction_ids_json" | "detail_json")
            | (
                "player_characters",
                "story_preferences_json"
                    | "content_boundaries_json"
                    | "attributes_json"
                    | "traits_json"
                    | "background_json"
                    | "initial_equipment_ids_json"
            )
            | ("taverns", "special_rules_json" | "changes_json")
            | ("npcs", "visit_json" | "memories_json")
            | (
                "npc_knowledge",
                "known_fact_ids_json"
                    | "suspected_fact_ids_json"
                    | "false_belief_fact_ids_json"
                    | "excluded_secret_fact_ids_json"
            )
            | (
                "quests",
                "content_json"
                    | "recommended_attributes_json"
                    | "related_npc_ids_json"
                    | "related_fact_ids_json"
            )
            | ("adventures", "plan_json" | "clues_json" | "ending_json")
            | (
                "adventure_turns",
                "speaker_npc_ids_json"
                    | "suggested_actions_json"
                    | "player_action_json"
                    | "check_request_json"
                    | "dice_result_json"
            )
            | ("items", "content_json" | "effect_json")
            | ("world_clocks", "stages_json")
            | ("game_events", "payload_json")
            | (
                "generation_records",
                "request_json" | "validated_output_json" | "validation_error_json"
            )
    )
}

fn insert_row(
    transaction: &Transaction<'_>,
    table: &str,
    row: &Map<String, Value>,
) -> Result<(), CampaignStoreError> {
    let mut columns = table_columns(transaction, table)?;
    columns.sort();
    let actual = row.keys().cloned().collect::<Vec<_>>();
    if columns != actual {
        return Err(CampaignStoreError::ArchiveInvalid);
    }
    let quoted = columns
        .iter()
        .map(|column| quote_identifier(column))
        .collect::<Vec<_>>();
    let placeholders = (1..=columns.len())
        .map(|index| format!("?{index}"))
        .collect::<Vec<_>>();
    let sql = format!(
        "INSERT INTO {} ({}) VALUES ({})",
        quote_identifier(table),
        quoted.join(", "),
        placeholders.join(", ")
    );
    let values = columns
        .iter()
        .map(|column| json_to_sql(row.get(column).expect("validated import column")))
        .collect::<Result<Vec<_>, _>>()?;
    transaction.execute(&sql, params_from_iter(values))?;
    Ok(())
}

fn table_columns(connection: &Connection, table: &str) -> Result<Vec<String>, CampaignStoreError> {
    if table != "campaigns"
        && table != "generation_records"
        && table != "game_events"
        && !CAMPAIGN_TABLES.contains(&table)
    {
        return Err(CampaignStoreError::ArchiveInvalid);
    }
    let sql = format!("PRAGMA table_info({})", quote_identifier(table));
    let mut statement = connection.prepare(&sql)?;
    let columns = statement
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<Result<Vec<_>, _>>()?;
    if columns.is_empty() {
        return Err(CampaignStoreError::ArchiveInvalid);
    }
    Ok(columns)
}

fn json_to_sql(value: &Value) -> Result<SqlValue, CampaignStoreError> {
    match value {
        Value::Null => Ok(SqlValue::Null),
        Value::String(value) => Ok(SqlValue::Text(value.clone())),
        Value::Number(value) => value
            .as_i64()
            .map(SqlValue::Integer)
            .ok_or(CampaignStoreError::ArchiveInvalid),
        _ => Err(CampaignStoreError::ArchiveInvalid),
    }
}

fn validate_imported_state(
    transaction: &Transaction<'_>,
    parsed: &ParsedArchive,
) -> Result<(), CampaignStoreError> {
    let campaign = load_campaign(transaction, &parsed.campaign_id)?
        .ok_or(CampaignStoreError::ArchiveInvalid)?;
    if campaign.id != parsed.campaign_id {
        return Err(CampaignStoreError::ArchiveInvalid);
    }
    for (table, rows) in &parsed.tables {
        let expected = i64::try_from(rows.len()).map_err(|_| CampaignStoreError::ArchiveInvalid)?;
        let actual = if rows
            .first()
            .is_some_and(|row| row.contains_key("campaign_id"))
        {
            transaction.query_row(
                &format!(
                    "SELECT COUNT(*) FROM {} WHERE campaign_id = ?1",
                    quote_identifier(table)
                ),
                [&parsed.campaign_id],
                |row| row.get::<_, i64>(0),
            )?
        } else {
            expected
        };
        if actual != expected {
            return Err(CampaignStoreError::ArchiveInvalid);
        }
    }
    Ok(())
}

fn create_import_snapshot(
    transaction: &Transaction<'_>,
    parsed: &ParsedArchive,
    imported_at: &str,
) -> Result<(), CampaignStoreError> {
    let mut tables = Map::new();
    for table in CAMPAIGN_TABLES {
        let rows = parsed
            .tables
            .get(table)
            .ok_or(CampaignStoreError::ArchiveInvalid)?;
        tables.insert(
            table.to_owned(),
            Value::Array(rows.iter().cloned().map(Value::Object).collect()),
        );
    }
    tables.insert(
        "game_events".to_owned(),
        Value::Array(parsed.events.iter().cloned().map(Value::Object).collect()),
    );
    let payload = json!({
        "formatVersion": FORMAT_VERSION,
        "campaignId": parsed.campaign_id,
        "campaign": parsed.campaign,
        "tables": tables
    });
    let bytes = canonical_json_bytes(&payload)?;
    let schema_version = parsed
        .campaign
        .get("schema_version")
        .and_then(Value::as_i64)
        .ok_or(CampaignStoreError::ArchiveInvalid)?;
    transaction.execute(
        "INSERT INTO save_snapshots (
           id, campaign_id, kind, reason, schema_version, payload, checksum_sha256, created_at
         ) VALUES (?1, ?2, 'IMPORT', ?3, ?4, ?5, ?6, ?7)",
        params![
            Uuid::new_v4().to_string(),
            parsed.campaign_id,
            format!("IMPORT:{imported_at}"),
            schema_version,
            bytes,
            sha256(&canonical_json_bytes(&payload)?),
            imported_at
        ],
    )?;
    Ok(())
}

fn assert_database_ready(connection: &Connection) -> Result<(), CampaignStoreError> {
    let integrity =
        connection.query_row("PRAGMA integrity_check", [], |row| row.get::<_, String>(0))?;
    if integrity != "ok" {
        return Err(CampaignStoreError::InvalidData);
    }
    assert_foreign_keys(connection)?;
    let schema = connection.query_row(
        "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
        [],
        |row| row.get::<_, i64>(0),
    )?;
    if schema != LOCAL_DATABASE_SCHEMA_VERSION {
        return Err(CampaignStoreError::IncompatibleSchema);
    }
    Ok(())
}

fn assert_foreign_keys(connection: &Connection) -> Result<(), CampaignStoreError> {
    let mut statement = connection.prepare("PRAGMA foreign_key_check")?;
    if statement.query([])?.next()?.is_some() {
        return Err(CampaignStoreError::ArchiveInvalid);
    }
    Ok(())
}

fn campaign_exists(connection: &Connection, campaign_id: &str) -> Result<bool, CampaignStoreError> {
    Ok(connection
        .query_row(
            "SELECT 1 FROM campaigns WHERE id = ?1",
            [campaign_id],
            |_| Ok(()),
        )
        .optional()?
        .is_some())
}

fn read_archive_path(path: &Path) -> Result<Vec<u8>, CampaignStoreError> {
    validate_archive_source(path)?;
    let metadata = fs::metadata(path)?;
    if !metadata.is_file() || metadata.len() > MAX_ARCHIVE_BYTES {
        return Err(CampaignStoreError::ArchivePathInvalid);
    }
    let bytes = fs::read(path)?;
    if bytes.len() as u64 != metadata.len() {
        return Err(CampaignStoreError::ArchiveInvalid);
    }
    Ok(bytes)
}

fn validate_archive_source(path: &Path) -> Result<(), CampaignStoreError> {
    if !path.is_absolute()
        || path
            .extension()
            .and_then(|value| value.to_str())
            .map(str::to_lowercase)
            != Some("emtavern".to_owned())
        || fs::symlink_metadata(path)?.file_type().is_symlink()
    {
        return Err(CampaignStoreError::ArchivePathInvalid);
    }
    Ok(())
}

fn validate_archive_destination(path: &Path) -> Result<PathBuf, CampaignStoreError> {
    if !path.is_absolute()
        || path
            .extension()
            .and_then(|value| value.to_str())
            .map(str::to_lowercase)
            != Some("emtavern".to_owned())
    {
        return Err(CampaignStoreError::ArchivePathInvalid);
    }
    let parent = path
        .parent()
        .ok_or(CampaignStoreError::ArchivePathInvalid)?;
    let canonical_parent = fs::canonicalize(parent)?;
    if !canonical_parent.is_dir() {
        return Err(CampaignStoreError::ArchivePathInvalid);
    }
    let file_name = path
        .file_name()
        .ok_or(CampaignStoreError::ArchivePathInvalid)?;
    let destination = canonical_parent.join(file_name);
    if destination.exists() && fs::symlink_metadata(&destination)?.file_type().is_symlink() {
        return Err(CampaignStoreError::ArchivePathInvalid);
    }
    Ok(destination)
}

fn publish_archive(path: &Path, bytes: &[u8]) -> Result<(), CampaignStoreError> {
    let parent = path
        .parent()
        .ok_or(CampaignStoreError::ArchivePathInvalid)?;
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or(CampaignStoreError::ArchivePathInvalid)?;
    let working = parent.join(format!(".{file_name}.{}.tmp", Uuid::new_v4()));
    let backup = parent.join(format!(".{file_name}.{}.bak", Uuid::new_v4()));
    let result = (|| {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&working)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        let had_destination = path.exists();
        if had_destination {
            if !fs::metadata(path)?.is_file() {
                return Err(CampaignStoreError::ArchivePathInvalid);
            }
            fs::rename(path, &backup)?;
        }
        if let Err(error) = fs::rename(&working, path) {
            if had_destination {
                let _ = fs::rename(&backup, path);
            }
            return Err(error.into());
        }
        let published = fs::read(path)?;
        if published != bytes {
            let _ = fs::remove_file(path);
            if had_destination {
                let _ = fs::rename(&backup, path);
            }
            return Err(CampaignStoreError::ArchiveInvalid);
        }
        if had_destination {
            fs::remove_file(&backup)?;
        }
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&working);
    }
    result
}

fn parse_canonical_document(bytes: &[u8]) -> Result<Map<String, Value>, CampaignStoreError> {
    if !bytes.ends_with(b"\n") || bytes.starts_with(&[0xef, 0xbb, 0xbf]) {
        return Err(CampaignStoreError::ArchiveInvalid);
    }
    let body = &bytes[..bytes.len() - 1];
    validate_json_text_resources(body)?;
    let value: Value =
        serde_json::from_slice(body).map_err(|_| CampaignStoreError::ArchiveInvalid)?;
    validate_json_value_resources(&value)?;
    if canonical_json_bytes(&value)? != body {
        return Err(CampaignStoreError::ArchiveInvalid);
    }
    require_object(Some(&value)).cloned()
}

fn canonical_document_bytes(value: &Value) -> Result<Vec<u8>, CampaignStoreError> {
    let mut bytes = canonical_json_bytes(value)?;
    bytes.push(b'\n');
    Ok(bytes)
}

fn canonical_ndjson_bytes(rows: &[Map<String, Value>]) -> Result<Vec<u8>, CampaignStoreError> {
    let mut bytes = Vec::new();
    for row in rows {
        bytes.extend(canonical_json_bytes(&Value::Object(row.clone()))?);
        bytes.push(b'\n');
    }
    Ok(bytes)
}

fn canonical_json_bytes(value: &Value) -> Result<Vec<u8>, CampaignStoreError> {
    validate_json_value_resources(value)?;
    let sorted = sort_json(value);
    serde_json::to_vec(&sorted).map_err(|_| CampaignStoreError::ArchiveInvalid)
}

fn sort_json(value: &Value) -> Value {
    match value {
        Value::Array(values) => Value::Array(values.iter().map(sort_json).collect()),
        Value::Object(values) => {
            let sorted = values
                .iter()
                .map(|(key, value)| (key.clone(), sort_json(value)))
                .collect::<BTreeMap<_, _>>();
            Value::Object(sorted.into_iter().collect())
        }
        _ => value.clone(),
    }
}

fn sha256(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn read_archive_entry<R: Read + Seek>(
    archive: &mut ZipArchive<R>,
    name: &str,
) -> Result<Vec<u8>, CampaignStoreError> {
    let file = archive
        .by_name(name)
        .map_err(|_| CampaignStoreError::ArchiveInvalid)?;
    validate_archive_entry_resources(name, file.compressed_size(), file.size())?;
    let expected_size = file.size();
    let mut contents = Vec::with_capacity(
        usize::try_from(expected_size).map_err(|_| CampaignStoreError::ArchiveInvalid)?,
    );
    file.take(expected_size.saturating_add(1))
        .read_to_end(&mut contents)
        .map_err(|_| CampaignStoreError::ArchiveInvalid)?;
    if contents.len() as u64 != expected_size {
        return Err(CampaignStoreError::ArchiveInvalid);
    }
    Ok(contents)
}

fn read_verified_archive_entry<R: Read + Seek>(
    archive: &mut ZipArchive<R>,
    expected: &BTreeMap<String, String>,
    name: &str,
) -> Result<Vec<u8>, CampaignStoreError> {
    let contents = read_archive_entry(archive, name)?;
    if expected.get(name).map(String::as_str) != Some(sha256(&contents).as_str()) {
        return Err(CampaignStoreError::ArchiveInvalid);
    }
    Ok(contents)
}

fn require_object(value: Option<&Value>) -> Result<&Map<String, Value>, CampaignStoreError> {
    value
        .and_then(Value::as_object)
        .ok_or(CampaignStoreError::ArchiveInvalid)
}

fn require_array(value: Option<&Value>) -> Result<&Vec<Value>, CampaignStoreError> {
    let values = value
        .and_then(Value::as_array)
        .ok_or(CampaignStoreError::ArchiveInvalid)?;
    if values.len() > MAX_JSON_ARRAY_LENGTH {
        return Err(CampaignStoreError::ArchiveInvalid);
    }
    Ok(values)
}

fn require_text(value: Option<&Value>) -> Result<&str, CampaignStoreError> {
    let text = value
        .and_then(Value::as_str)
        .ok_or(CampaignStoreError::ArchiveInvalid)?;
    if text.is_empty() || text.len() > MAX_JSON_STRING_BYTES {
        return Err(CampaignStoreError::ArchiveInvalid);
    }
    Ok(text)
}

fn entry_size_limit(name: &str) -> Result<u64, CampaignStoreError> {
    match name {
        "manifest.json" | "checksum.json" => Ok(64 * 1024),
        "campaign.json" => Ok(32 * 1024 * 1024),
        "events.ndjson" | "generations.json" => Ok(16 * 1024 * 1024),
        _ => Err(CampaignStoreError::ArchiveInvalid),
    }
}

fn validate_archive_entry_resources(
    name: &str,
    compressed_size: u64,
    uncompressed_size: u64,
) -> Result<u64, CampaignStoreError> {
    let limit = entry_size_limit(name)?;
    if uncompressed_size > limit
        || (uncompressed_size > 0
            && (compressed_size == 0
                || uncompressed_size > compressed_size.saturating_mul(MAX_COMPRESSION_RATIO)))
    {
        return Err(CampaignStoreError::ArchiveInvalid);
    }
    Ok(limit)
}

fn validate_record_count(count: usize, limit: usize) -> Result<(), CampaignStoreError> {
    if count > limit {
        return Err(CampaignStoreError::ArchiveInvalid);
    }
    Ok(())
}

fn add_expanded_bytes(total: u64, entry: u64) -> Result<u64, CampaignStoreError> {
    let next = total
        .checked_add(entry)
        .ok_or(CampaignStoreError::ArchiveInvalid)?;
    if next > MAX_UNCOMPRESSED_BYTES {
        return Err(CampaignStoreError::ArchiveInvalid);
    }
    Ok(next)
}

fn validate_json_text_resources(bytes: &[u8]) -> Result<(), CampaignStoreError> {
    let mut depth = 0_usize;
    let mut in_string = false;
    let mut escaped = false;
    let mut string_bytes = 0_usize;
    for byte in bytes {
        if in_string {
            if escaped {
                escaped = false;
            } else if *byte == b'\\' {
                escaped = true;
            } else if *byte == b'"' {
                in_string = false;
            }
            string_bytes = string_bytes.saturating_add(1);
            if string_bytes > MAX_JSON_STRING_BYTES.saturating_mul(6) {
                return Err(CampaignStoreError::ArchiveInvalid);
            }
        } else if *byte == b'"' {
            in_string = true;
            string_bytes = 0;
        } else if matches!(*byte, b'{' | b'[') {
            depth = depth
                .checked_add(1)
                .ok_or(CampaignStoreError::ArchiveInvalid)?;
            if depth > MAX_JSON_DEPTH {
                return Err(CampaignStoreError::ArchiveInvalid);
            }
        } else if matches!(*byte, b'}' | b']') {
            depth = depth.saturating_sub(1);
        }
    }
    Ok(())
}

fn validate_json_value_resources(value: &Value) -> Result<(), CampaignStoreError> {
    let mut pending = vec![(value, 1_usize)];
    while let Some((current, depth)) = pending.pop() {
        if depth > MAX_JSON_DEPTH {
            return Err(CampaignStoreError::ArchiveInvalid);
        }
        match current {
            Value::String(text) if text.len() > MAX_JSON_STRING_BYTES => {
                return Err(CampaignStoreError::ArchiveInvalid);
            }
            Value::Array(values) => {
                if values.len() > MAX_JSON_ARRAY_LENGTH {
                    return Err(CampaignStoreError::ArchiveInvalid);
                }
                pending.extend(values.iter().map(|entry| (entry, depth + 1)));
            }
            Value::Object(values) => {
                for (key, entry) in values {
                    if key.len() > MAX_JSON_STRING_BYTES {
                        return Err(CampaignStoreError::ArchiveInvalid);
                    }
                    pending.push((entry, depth + 1));
                }
            }
            _ => {}
        }
    }
    Ok(())
}

fn require_exact_keys(
    value: &Map<String, Value>,
    expected: &[&str],
) -> Result<(), CampaignStoreError> {
    let actual = value.keys().map(String::as_str).collect::<BTreeSet<_>>();
    let expected = expected.iter().copied().collect::<BTreeSet<_>>();
    if actual != expected {
        return Err(CampaignStoreError::ArchiveInvalid);
    }
    Ok(())
}

fn quote_identifier(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\"\""))
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIRST_TIME: &str = "2026-08-01T13:00:00.000Z";

    #[test]
    fn imports_the_typescript_v1_fixture_without_device_state() {
        let directory = tempfile::tempdir().expect("temp directory");
        let archive_path = directory.path().join("typescript-export-v1.emtavern");
        fs::write(
            &archive_path,
            include_bytes!(
                "../../../packages/persistence/test-fixtures/typescript-export-v1.emtavern"
            ),
        )
        .expect("write TypeScript fixture");
        let store = CampaignStore::open(directory.path().join("ember-tavern.sqlite"))
            .expect("open database");

        let imported = store
            .import_campaign_archive(&archive_path, CampaignArchiveImportMode::Create)
            .expect("import TypeScript fixture");
        assert_eq!(imported.id, "campaign-export");

        let connection = store.connect().expect("inspect imported fixture");
        assert_eq!(
            connection
                .query_row(
                    "SELECT statement FROM world_facts WHERE id = 'fact-export'",
                    [],
                    |row| row.get::<_, String>(0),
                )
                .expect("imported fact"),
            "The beacon is lit."
        );
        assert_eq!(
            connection
                .query_row("SELECT COUNT(*) FROM provider_configs", [], |row| {
                    row.get::<_, i64>(0)
                })
                .expect("provider count"),
            0
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT model_profile_id FROM generation_records WHERE id = 'generation-export'",
                    [],
                    |row| row.get::<_, Option<String>>(0),
                )
                .expect("portable generation model"),
            None
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT COUNT(*) FROM save_snapshots WHERE campaign_id = 'campaign-export' AND kind = 'IMPORT'",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .expect("import snapshot count"),
            1
        );
    }

    #[test]
    fn current_archive_interop_gate_imports_typescript_and_emits_rust() {
        let fallback = tempfile::tempdir().unwrap();
        let typescript_archive = std::env::var_os("EMBER_TS_ARCHIVE_INPUT")
            .map(PathBuf::from)
            .unwrap_or_else(|| {
                Path::new(env!("CARGO_MANIFEST_DIR"))
                    .join("../../packages/persistence/test-fixtures/typescript-export-v1.emtavern")
            });
        let rust_archive = std::env::var_os("EMBER_RUST_ARCHIVE_OUTPUT")
            .map(PathBuf::from)
            .unwrap_or_else(|| fallback.path().join("rust-export-v1.emtavern"));
        let work_directory = std::env::var_os("EMBER_ARCHIVE_INTEROP_WORK")
            .map(PathBuf::from)
            .unwrap_or_else(|| fallback.path().join("work"));
        fs::create_dir_all(&work_directory).unwrap();

        let importer = CampaignStore::open(work_directory.join("rust-import.sqlite")).unwrap();
        let imported = importer
            .import_campaign_archive(typescript_archive, CampaignArchiveImportMode::Create)
            .unwrap();
        assert_eq!(imported.id, "campaign-export");
        let connection = importer.connect().unwrap();
        let fact: String = connection
            .query_row(
                "SELECT statement FROM world_facts WHERE id = 'fact-export'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(fact, "The beacon is lit.");
        drop(connection);

        let exporter = CampaignStore::open(work_directory.join("rust-export.sqlite")).unwrap();
        exporter
            .create_at("campaign-transfer".to_owned(), FIRST_TIME.to_owned())
            .unwrap();
        let connection = exporter.connect().unwrap();
        connection
            .execute(
                "INSERT INTO world_facts (
                   id, campaign_id, kind, statement, location_id, faction_ids_json,
                   detail_json, supersedes_fact_id, created_at
                 ) VALUES ('fact-transfer', 'campaign-transfer', 'DEVELOPING_FACT',
                   'The bell is ringing.', NULL, '[]', '{}', NULL, ?1)",
                [FIRST_TIME],
            )
            .unwrap();
        drop(connection);
        exporter
            .export_campaign_archive_at(
                "campaign-transfer",
                rust_archive,
                "0.1.0",
                "2026-08-02T00:59:25.584Z",
            )
            .unwrap();
    }

    #[test]
    fn exports_deletes_imports_and_continues_a_native_campaign() {
        let directory = tempfile::tempdir().expect("temp directory");
        let database_path = directory.path().join("ember-tavern.sqlite");
        let archive_path = directory.path().join("campaign.emtavern");
        let store = CampaignStore::open(&database_path).expect("open database");
        store
            .create_at("campaign-transfer".to_owned(), FIRST_TIME.to_owned())
            .expect("create campaign");
        let connection = store.connect().expect("connect");
        connection
            .execute(
                "INSERT INTO world_facts (
                   id, campaign_id, kind, statement, location_id, faction_ids_json,
                   detail_json, supersedes_fact_id, created_at
                 ) VALUES ('fact-transfer', 'campaign-transfer', 'DEVELOPING_FACT',
                   'The bell is ringing.', NULL, '[]', '{}', NULL, ?1)",
                [FIRST_TIME],
            )
            .expect("seed fact");
        connection
            .execute(
                "INSERT INTO app_settings (key, value_json, updated_at)
                 VALUES ('private-transfer-setting',
                   '{\"apiKey\":\"TOP_SECRET_NATIVE_EXPORT\"}', ?1)",
                [FIRST_TIME],
            )
            .expect("seed private setting");
        drop(connection);

        fs::write(&archive_path, b"replace only after complete export").expect("seed old export");
        store
            .export_campaign_archive("campaign-transfer", &archive_path, "0.1.0")
            .expect("export archive");
        let archive = fs::read(&archive_path).expect("read archive");
        assert!(!String::from_utf8_lossy(&archive).contains("credential_ref"));
        assert!(!String::from_utf8_lossy(&archive).contains("TOP_SECRET_NATIVE_EXPORT"));
        assert!(
            fs::read_dir(directory.path())
                .expect("list export directory")
                .filter_map(Result::ok)
                .all(|entry| {
                    let name = entry.file_name().to_string_lossy().into_owned();
                    !name.ends_with(".tmp") && !name.ends_with(".bak")
                })
        );
        let connection = store.connect().expect("connect for delete");
        connection
            .execute("DELETE FROM campaigns WHERE id = 'campaign-transfer'", [])
            .expect("delete campaign");
        drop(connection);

        let inspection = store
            .inspect_campaign_archive(&archive_path)
            .expect("inspect archive");
        assert_eq!(inspection.campaign_id, "campaign-transfer");
        assert!(!inspection.campaign_exists);
        let imported = store
            .import_campaign_archive(&archive_path, CampaignArchiveImportMode::Create)
            .expect("import archive");
        assert_eq!(imported.id, "campaign-transfer");
        let continued = store
            .continue_campaign("campaign-transfer")
            .expect("continue imported campaign");
        assert!(continued.updated_at >= imported.updated_at);
        let connection = store.connect().expect("inspect import");
        assert_eq!(
            connection
                .query_row(
                    "SELECT statement FROM world_facts WHERE id = 'fact-transfer'",
                    [],
                    |row| row.get::<_, String>(0)
                )
                .expect("fact statement"),
            "The bell is ringing."
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT COUNT(*) FROM save_snapshots WHERE campaign_id = 'campaign-transfer' AND kind = 'IMPORT'",
                    [],
                    |row| row.get::<_, i64>(0)
                )
                .expect("snapshot count"),
            1
        );
    }

    #[test]
    fn overwrite_import_creates_backup_and_restores_exported_values() {
        let directory = tempfile::tempdir().expect("temp directory");
        let database_path = directory.path().join("ember-tavern.sqlite");
        let archive_path = directory.path().join("campaign.emtavern");
        let store = CampaignStore::open(&database_path).expect("open database");
        store
            .create_at("campaign-transfer".to_owned(), FIRST_TIME.to_owned())
            .expect("create campaign");
        store
            .export_campaign_archive("campaign-transfer", &archive_path, "0.1.0")
            .expect("export archive");
        let connection = store.connect().expect("connect");
        connection
            .execute(
                "UPDATE campaigns SET state = 'REVIEWING_WORLD' WHERE id = 'campaign-transfer'",
                [],
            )
            .expect("mutate campaign");
        drop(connection);

        let imported = store
            .import_campaign_archive(&archive_path, CampaignArchiveImportMode::Overwrite)
            .expect("overwrite archive");
        assert_eq!(imported.state, "CREATING_WORLD");
        let backup_count = fs::read_dir(super::super::backup_directory(&database_path))
            .expect("backup directory")
            .filter_map(Result::ok)
            .filter(|entry| {
                entry
                    .path()
                    .extension()
                    .is_some_and(|value| value == "sqlite")
            })
            .count();
        assert_eq!(backup_count, 1);
    }

    #[test]
    fn overwrite_import_aborts_when_another_store_writes_after_backup() {
        let directory = tempfile::tempdir().unwrap();
        let database_path = directory.path().join("overwrite-concurrency.sqlite");
        let archive_path = directory.path().join("campaign.emtavern");
        let first = CampaignStore::open(&database_path).unwrap();
        first
            .create_at("campaign-transfer".to_owned(), FIRST_TIME.to_owned())
            .unwrap();
        first
            .export_campaign_archive("campaign-transfer", &archive_path, "0.1.0")
            .unwrap();
        let second = CampaignStore::open(&database_path).unwrap();
        let concurrent_time = "2026-08-01T14:04:05.006Z";

        let result = first.import_campaign_archive_with_backup_hook(
            &archive_path,
            CampaignArchiveImportMode::Overwrite,
            || {
                second
                    .touch_at("campaign-transfer", concurrent_time.to_owned())
                    .unwrap();
            },
        );

        assert!(matches!(
            result,
            Err(CampaignStoreError::ConcurrentModification)
        ));
        let connection = first.connect().unwrap();
        let preserved: String = connection
            .query_row(
                "SELECT updated_at FROM campaigns WHERE id = 'campaign-transfer'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(preserved, concurrent_time);
    }

    #[test]
    fn corrupt_import_is_rejected_without_mutating_local_campaign() {
        let directory = tempfile::tempdir().expect("temp directory");
        let database_path = directory.path().join("ember-tavern.sqlite");
        let archive_path = directory.path().join("campaign.emtavern");
        let store = CampaignStore::open(&database_path).expect("open database");
        store
            .create_at("campaign-transfer".to_owned(), FIRST_TIME.to_owned())
            .expect("create campaign");
        store
            .export_campaign_archive("campaign-transfer", &archive_path, "0.1.0")
            .expect("export archive");
        let mut bytes = fs::read(&archive_path).expect("read archive");
        let middle = bytes.len() / 2;
        bytes[middle] ^= 1;
        fs::write(&archive_path, bytes).expect("corrupt archive");

        assert!(matches!(
            store.import_campaign_archive(&archive_path, CampaignArchiveImportMode::Overwrite),
            Err(CampaignStoreError::ArchiveInvalid)
        ));
        assert_eq!(store.list().expect("list campaigns").len(), 1);
        assert_eq!(
            store.list().expect("list campaigns")[0].state,
            "CREATING_WORLD"
        );
    }

    #[test]
    fn overwrite_backup_failure_preserves_the_existing_campaign() {
        let directory = tempfile::tempdir().expect("temp directory");
        let database_path = directory.path().join("ember-tavern.sqlite");
        let archive_path = directory.path().join("campaign.emtavern");
        let store = CampaignStore::open(&database_path).expect("open database");
        store
            .create_at("campaign-transfer".to_owned(), FIRST_TIME.to_owned())
            .expect("create campaign");
        store
            .export_campaign_archive("campaign-transfer", &archive_path, "0.1.0")
            .expect("export archive");
        let connection = store.connect().expect("connect");
        connection
            .execute(
                "UPDATE campaigns SET state = 'REVIEWING_WORLD' WHERE id = 'campaign-transfer'",
                [],
            )
            .expect("mutate campaign");
        drop(connection);
        fs::write(super::super::backup_directory(&database_path), b"occupied")
            .expect("occupy backup path");

        assert!(matches!(
            store.import_campaign_archive(&archive_path, CampaignArchiveImportMode::Overwrite),
            Err(CampaignStoreError::Io(_))
        ));
        assert_eq!(
            store.list().expect("list after failed backup")[0].state,
            "REVIEWING_WORLD"
        );
    }

    #[test]
    fn forbidden_generation_secret_rejects_export_without_replacing_destination() {
        let directory = tempfile::tempdir().expect("temp directory");
        let database_path = directory.path().join("ember-tavern.sqlite");
        let archive_path = directory.path().join("campaign.emtavern");
        let store = CampaignStore::open(&database_path).expect("open database");
        store
            .create_at("campaign-transfer".to_owned(), FIRST_TIME.to_owned())
            .expect("create campaign");
        let connection = store.connect().expect("connect");
        connection
            .execute(
                "INSERT INTO generation_records (
                   id, campaign_id, request_id, task, model_profile_id, prompt_version,
                   request_json, raw_response_text, validated_output_json,
                   validation_error_json, started_at, completed_at
                 ) VALUES (
                   'generation-secret', 'campaign-transfer', 'request-secret',
                   'GENERATE_WORLD', NULL, 1,
                   '{\"apiKey\":\"TOP_SECRET_NATIVE_EXPORT\"}', NULL, NULL, NULL, ?1, NULL
                 )",
                [FIRST_TIME],
            )
            .expect("seed forbidden generation");
        drop(connection);
        fs::write(&archive_path, b"original destination").expect("seed destination");

        assert!(matches!(
            store.export_campaign_archive("campaign-transfer", &archive_path, "0.1.0"),
            Err(CampaignStoreError::ArchiveInvalid)
        ));
        assert_eq!(
            fs::read(&archive_path).expect("read preserved destination"),
            b"original destination"
        );
    }

    #[test]
    fn archive_resource_limits_reject_bombs_and_pathological_json() {
        assert!(add_expanded_bytes(MAX_UNCOMPRESSED_BYTES - 1, 1).is_ok());
        assert!(add_expanded_bytes(MAX_UNCOMPRESSED_BYTES, 1).is_err());
        assert!(validate_archive_entry_resources("manifest.json", 1024, 64 * 1024 + 1).is_err());
        assert!(validate_archive_entry_resources("campaign.json", 1024, 1024 * 101).is_err());
        assert!(validate_record_count(MAX_EVENT_RECORDS, MAX_EVENT_RECORDS).is_ok());
        assert!(validate_record_count(MAX_EVENT_RECORDS + 1, MAX_EVENT_RECORDS).is_err());

        let deep = format!(
            "{}0{}",
            "[".repeat(MAX_JSON_DEPTH + 1),
            "]".repeat(MAX_JSON_DEPTH + 1)
        );
        assert!(validate_json_text_resources(deep.as_bytes()).is_err());
        assert!(
            validate_json_value_resources(&Value::Array(vec![
                Value::Null;
                MAX_JSON_ARRAY_LENGTH + 1
            ]))
            .is_err()
        );
        assert!(
            validate_json_value_resources(&Value::String("x".repeat(MAX_JSON_STRING_BYTES + 1)))
                .is_err()
        );

        let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
        for name in ENTRY_NAMES {
            writer.start_file(name, options).unwrap();
            if name == "campaign.json" {
                writer.write_all(&vec![b'a'; 1024 * 1024]).unwrap();
            } else {
                writer.write_all(b"{}\n").unwrap();
            }
        }
        let bomb = writer.finish().unwrap().into_inner();
        assert!(bomb.len() < 32 * 1024);
        assert!(matches!(
            parse_archive(&bomb),
            Err(CampaignStoreError::ArchiveInvalid)
        ));
    }

    #[test]
    fn secret_scanner_rejects_nested_values_plain_text_and_debug_material() {
        for secret in [
            "provider returned sk-or-v1-1234567890abcdef",
            "Provider echoed Authorization: Bearer abcdefghijklmnop",
            "eyJabcdefghijk.abcdefghijkl.abcdefghijkl",
            "TOP_SECRET_API_KEY_SHOULD_NOT_EXPORT",
        ] {
            assert!(assert_no_secret_text(secret).is_err());
        }
        assert!(
            assert_no_secret_keys(&json!({
                "message": {"detail": "sk-ant-api03-abcdefghijklmnop"}
            }))
            .is_err()
        );
        assert!(assert_no_secret_text("The innkeeper keeps a secret behind the hearth.").is_ok());

        let directory = tempfile::tempdir().expect("temp directory");
        let store = CampaignStore::open(directory.path().join("secret-scan.sqlite"))
            .expect("open database");
        store
            .create_at("campaign-secret-scan".to_owned(), FIRST_TIME.to_owned())
            .expect("create campaign");
        let connection = store.connect().expect("connect");
        connection
            .execute(
                "INSERT INTO generation_records (
                   id, campaign_id, request_id, task, model_profile_id, prompt_version,
                   request_json, raw_response_text, validated_output_json,
                   validation_error_json, started_at, completed_at
                 ) VALUES (
                   'generation-value-secret', 'campaign-secret-scan', 'request-value-secret',
                   'GENERATE_WORLD', NULL, 1,
                   '{\"message\":\"sk-or-v1-1234567890abcdef\"}', NULL, NULL, NULL, ?1, NULL
                 )",
                [FIRST_TIME],
            )
            .expect("seed nested secret value");
        drop(connection);
        assert!(matches!(
            store.capture_archive("campaign-secret-scan", FIRST_TIME, "0.2.0"),
            Err(CampaignStoreError::ArchiveInvalid)
        ));

        let connection = store.connect().expect("reconnect");
        connection
            .execute(
                "UPDATE generation_records
                 SET request_json = '{}',
                     raw_response_text = 'Authorization: Bearer abcdefghijklmnop'
                 WHERE id = 'generation-value-secret'",
                [],
            )
            .expect("seed plain response secret");
        drop(connection);
        assert!(matches!(
            store.capture_archive("campaign-secret-scan", FIRST_TIME, "0.2.0"),
            Err(CampaignStoreError::ArchiveInvalid)
        ));
    }
}

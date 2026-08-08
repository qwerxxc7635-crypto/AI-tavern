use ember_secure_http::ApprovedEndpoint;
use rusqlite::{OptionalExtension, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use time::{OffsetDateTime, format_description::well_known::Rfc3339};
use uuid::Uuid;

use crate::{CampaignStore, CampaignStoreError, current_timestamp};

const DEFAULT_MODEL_KEY: &str = "default_model_profile_id";
const FALLBACK_MODEL_KEY: &str = "fallback_model_profile_id";
const PRESETS: &[&str] = &["deepseek", "qwen", "openrouter", "ollama", "custom"];
const FIXED_PRESET_ENDPOINTS: &[(&str, &str)] = &[
    ("deepseek", "https://api.deepseek.com/"),
    ("qwen", "https://dashscope.aliyuncs.com/compatible-mode/v1/"),
    ("openrouter", "https://openrouter.ai/api/v1/"),
];
const MAX_SAFE_CONTEXT_TOKENS: u64 = 9_007_199_254_740_991;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ModelSettingsUpdate {
    pub preset_key: String,
    pub provider_display_name: String,
    pub base_url: Option<String>,
    pub endpoint_fingerprint: String,
    pub credential_ref: Option<String>,
    pub credential_action: CredentialAction,
    pub model_name: String,
    pub model_display_name: String,
    pub capabilities: ModelCapabilitiesRegistration,
    pub capability_source: CapabilitySource,
    pub probe_fingerprint: String,
    pub probe_receipt_id: String,
    pub use_as_default: bool,
    pub use_as_fallback: bool,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CapabilitySource {
    ProviderResponse,
    PresetMetadata,
    Unknown,
}

impl CapabilitySource {
    fn as_str(self) -> &'static str {
        match self {
            Self::ProviderResponse => "PROVIDER_RESPONSE",
            Self::PresetMetadata => "PRESET_METADATA",
            Self::Unknown => "UNKNOWN",
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CredentialAction {
    Keep,
    Replace,
    Clear,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CredentialCleanupReason {
    Replaced,
    Cleared,
    Rollback,
    Transient,
}

impl CredentialCleanupReason {
    fn as_str(self) -> &'static str {
        match self {
            Self::Replaced => "REPLACED",
            Self::Cleared => "CLEARED",
            Self::Rollback => "ROLLBACK",
            Self::Transient => "TRANSIENT",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PendingCredentialCleanup {
    pub credential_ref: String,
    pub attempts: i64,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ModelCapabilitiesRegistration {
    pub text: bool,
    pub streaming: bool,
    pub system_messages: bool,
    pub json_mode: bool,
    pub json_schema: bool,
    pub tool_calling: bool,
    pub reasoning: bool,
    pub context_window_tokens: Option<u64>,
    pub cost_status: String,
    pub checked_at: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelProfileView {
    pub id: String,
    pub provider_id: String,
    pub preset_key: String,
    pub provider_display_name: String,
    pub base_url: Option<String>,
    pub endpoint_fingerprint: Option<String>,
    pub has_credential: bool,
    pub model_name: String,
    pub model_display_name: String,
    pub capabilities: Option<ModelCapabilitiesRegistration>,
    pub capability_source: Option<CapabilitySource>,
    pub probe_fingerprint: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelSettingsSnapshot {
    pub profiles: Vec<ModelProfileView>,
    pub default_model_profile_id: Option<String>,
    pub fallback_model_profile_id: Option<String>,
    pub pending_credential_cleanup_count: i64,
}

impl CampaignStore {
    pub fn model_settings(&self) -> Result<ModelSettingsSnapshot, CampaignStoreError> {
        let connection = self.connect()?;
        let mut statement = connection.prepare(
            "SELECT m.id, p.id, p.preset_key, p.display_name, p.base_url,
                    p.credential_ref IS NOT NULL, m.model_name, m.display_name,
                    m.capabilities_json, m.capabilities_checked_at,
                    p.endpoint_fingerprint, m.capability_source, m.probe_fingerprint
             FROM model_profiles m
             JOIN provider_configs p ON p.id = m.provider_config_id
             WHERE p.enabled = 1 AND m.enabled = 1
             ORDER BY p.display_name, m.display_name, m.id",
        )?;
        let profiles = statement
            .query_map([], |row| {
                let capabilities_json: String = row.get(8)?;
                let capabilities_checked_at: Option<String> = row.get(9)?;
                let capabilities = if capabilities_json == "{}" {
                    if capabilities_checked_at.is_some() {
                        return Err(rusqlite::Error::InvalidQuery);
                    }
                    None
                } else {
                    let parsed: ModelCapabilitiesRegistration =
                        serde_json::from_str(&capabilities_json)
                            .map_err(|_| rusqlite::Error::InvalidQuery)?;
                    if capabilities_checked_at.as_deref() != Some(parsed.checked_at.as_str()) {
                        return Err(rusqlite::Error::InvalidQuery);
                    }
                    Some(parsed)
                };
                let capability_source = row
                    .get::<_, Option<String>>(11)?
                    .map(|value| match value.as_str() {
                        "PROVIDER_RESPONSE" => Ok(CapabilitySource::ProviderResponse),
                        "PRESET_METADATA" => Ok(CapabilitySource::PresetMetadata),
                        "UNKNOWN" => Ok(CapabilitySource::Unknown),
                        _ => Err(rusqlite::Error::InvalidQuery),
                    })
                    .transpose()?;
                Ok(ModelProfileView {
                    id: row.get(0)?,
                    provider_id: row.get(1)?,
                    preset_key: row.get(2)?,
                    provider_display_name: row.get(3)?,
                    base_url: row.get(4)?,
                    endpoint_fingerprint: row.get(10)?,
                    has_credential: row.get(5)?,
                    model_name: row.get(6)?,
                    model_display_name: row.get(7)?,
                    capabilities,
                    capability_source,
                    probe_fingerprint: row.get(12)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(ModelSettingsSnapshot {
            profiles,
            default_model_profile_id: read_setting(&connection, DEFAULT_MODEL_KEY)?,
            fallback_model_profile_id: read_setting(&connection, FALLBACK_MODEL_KEY)?,
            pending_credential_cleanup_count: connection.query_row(
                "SELECT COUNT(*) FROM credential_cleanup_queue",
                [],
                |row| row.get(0),
            )?,
        })
    }

    pub fn save_model_settings(
        &self,
        mut update: ModelSettingsUpdate,
    ) -> Result<ModelSettingsSnapshot, CampaignStoreError> {
        if let Some(base_url) = &mut update.base_url
            && !base_url.ends_with('/')
        {
            base_url.push('/');
        }
        validate_update(&update)?;
        let at = current_timestamp()?;
        let mut connection = self.connect()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let existing_provider = transaction
            .query_row(
                "SELECT id, credential_ref FROM provider_configs
                 WHERE preset_key = ?1 AND display_name = ?2",
                params![update.preset_key, update.provider_display_name],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?)),
            )
            .optional()?;
        let provider_id = existing_provider
            .as_ref()
            .map_or_else(|| Uuid::new_v4().to_string(), |provider| provider.0.clone());
        let old_credential_ref = existing_provider.and_then(|provider| provider.1);
        let next_credential_ref = match update.credential_action {
            CredentialAction::Keep => old_credential_ref.clone(),
            CredentialAction::Replace => update.credential_ref.clone(),
            CredentialAction::Clear => None,
        };
        if update.credential_action == CredentialAction::Replace
            && let Some(reference) = next_credential_ref.as_deref()
        {
            // A newly stored secret is staged for rollback by the platform command.
            // Claiming it in this transaction closes the crash window between vault
            // creation and provider persistence.
            transaction.execute(
                "DELETE FROM credential_cleanup_queue WHERE credential_ref = ?1",
                [reference],
            )?;
        }
        if old_credential_ref != next_credential_ref
            && let Some(reference) = old_credential_ref.as_deref()
        {
            enqueue_cleanup(
                &transaction,
                reference,
                match update.credential_action {
                    CredentialAction::Clear => CredentialCleanupReason::Cleared,
                    CredentialAction::Keep | CredentialAction::Replace => {
                        CredentialCleanupReason::Replaced
                    }
                },
                &at,
            )?;
        }
        let provider_type = if update.preset_key == "ollama" {
            "Local"
        } else {
            "OpenAI-Compatible"
        };
        transaction.execute(
            "UPDATE model_profiles SET enabled = 0, updated_at = ?1
             WHERE provider_config_id = ?2 AND enabled = 1",
            params![at, provider_id],
        )?;
        transaction.execute(
            "DELETE FROM app_settings
             WHERE key IN (?1, ?2)
               AND EXISTS (
                 SELECT 1 FROM model_profiles
                 WHERE provider_config_id = ?3
                   AND app_settings.value_json = json_quote(model_profiles.id)
               )",
            params![DEFAULT_MODEL_KEY, FALLBACK_MODEL_KEY, provider_id],
        )?;
        transaction.execute(
            "INSERT INTO provider_configs (
               id, provider_type, preset_key, display_name, base_url, credential_ref,
               options_json, enabled, created_at, updated_at, endpoint_fingerprint
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, '{}', 1, ?7, ?7, ?8)
             ON CONFLICT(preset_key, display_name) DO UPDATE SET
               base_url = excluded.base_url,
               credential_ref = excluded.credential_ref,
               endpoint_fingerprint = excluded.endpoint_fingerprint,
               enabled = 1,
               updated_at = excluded.updated_at",
            params![
                provider_id,
                provider_type,
                update.preset_key,
                update.provider_display_name,
                update.base_url,
                next_credential_ref,
                at,
                update.endpoint_fingerprint
            ],
        )?;
        let existing_profile = transaction
            .query_row(
                "SELECT id FROM model_profiles WHERE provider_config_id = ?1 AND model_name = ?2",
                params![provider_id, update.model_name],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        let profile_id = existing_profile.unwrap_or_else(|| Uuid::new_v4().to_string());
        let capabilities_json = serde_json::to_string(&update.capabilities)
            .map_err(|_| CampaignStoreError::InvalidData)?;
        transaction.execute(
            "INSERT INTO model_profiles (
               id, provider_config_id, model_name, display_name, capabilities_json,
               task_options_json, enabled, capabilities_checked_at, created_at, updated_at,
               capability_source, probe_fingerprint
             ) VALUES (?1, ?2, ?3, ?4, ?5, '{}', 1, ?6, ?7, ?7, ?8, ?9)
             ON CONFLICT(provider_config_id, model_name) DO UPDATE SET
               display_name = excluded.display_name,
               capabilities_json = excluded.capabilities_json,
               capabilities_checked_at = excluded.capabilities_checked_at,
               capability_source = excluded.capability_source,
               probe_fingerprint = excluded.probe_fingerprint,
               enabled = 1,
               updated_at = excluded.updated_at",
            params![
                profile_id,
                provider_id,
                update.model_name,
                update.model_display_name,
                capabilities_json,
                update.capabilities.checked_at,
                at,
                update.capability_source.as_str(),
                update.probe_fingerprint
            ],
        )?;
        if update.use_as_default {
            write_setting(&transaction, DEFAULT_MODEL_KEY, &profile_id, &at)?;
        }
        if update.use_as_fallback {
            write_setting(&transaction, FALLBACK_MODEL_KEY, &profile_id, &at)?;
        }
        transaction.commit()?;
        self.model_settings()
    }

    pub fn forget_model_credential(
        &self,
        profile_id: &str,
    ) -> Result<ModelSettingsSnapshot, CampaignStoreError> {
        Uuid::parse_str(profile_id).map_err(|_| CampaignStoreError::InvalidData)?;
        let mut connection = self.connect()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let provider = transaction
            .query_row(
                "SELECT p.id, p.credential_ref
                 FROM model_profiles m
                 JOIN provider_configs p ON p.id = m.provider_config_id
                 WHERE m.id = ?1 AND m.enabled = 1 AND p.enabled = 1",
                [profile_id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?)),
            )
            .optional()?
            .ok_or(CampaignStoreError::NotFound)?;
        let at = current_timestamp()?;
        transaction.execute(
            "UPDATE provider_configs SET credential_ref = NULL, updated_at = ?1 WHERE id = ?2",
            params![at, provider.0],
        )?;
        if let Some(reference) = provider.1.as_deref() {
            enqueue_cleanup(
                &transaction,
                reference,
                CredentialCleanupReason::Cleared,
                &at,
            )?;
        }
        transaction.commit()?;
        self.model_settings()
    }

    pub fn enqueue_credential_cleanup(
        &self,
        credential_ref: &str,
        reason: CredentialCleanupReason,
    ) -> Result<(), CampaignStoreError> {
        if !is_credential_ref(credential_ref) {
            return Err(CampaignStoreError::InvalidData);
        }
        let mut connection = self.connect()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        enqueue_cleanup(&transaction, credential_ref, reason, &current_timestamp()?)?;
        transaction.commit()?;
        Ok(())
    }

    pub fn pending_credential_cleanups(
        &self,
    ) -> Result<Vec<PendingCredentialCleanup>, CampaignStoreError> {
        let connection = self.connect()?;
        let mut statement = connection.prepare(
            "SELECT credential_ref, attempts FROM credential_cleanup_queue
             ORDER BY updated_at, credential_ref",
        )?;
        Ok(statement
            .query_map([], |row| {
                Ok(PendingCredentialCleanup {
                    credential_ref: row.get(0)?,
                    attempts: row.get(1)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?)
    }

    pub fn complete_credential_cleanup(
        &self,
        credential_ref: &str,
    ) -> Result<(), CampaignStoreError> {
        if !is_credential_ref(credential_ref) {
            return Err(CampaignStoreError::InvalidData);
        }
        let connection = self.connect()?;
        connection.execute(
            "DELETE FROM credential_cleanup_queue WHERE credential_ref = ?1",
            [credential_ref],
        )?;
        Ok(())
    }

    pub fn record_credential_cleanup_failure(
        &self,
        credential_ref: &str,
    ) -> Result<(), CampaignStoreError> {
        if !is_credential_ref(credential_ref) {
            return Err(CampaignStoreError::InvalidData);
        }
        let connection = self.connect()?;
        let changed = connection.execute(
            "UPDATE credential_cleanup_queue
             SET attempts = attempts + 1, updated_at = ?1
             WHERE credential_ref = ?2",
            params![current_timestamp()?, credential_ref],
        )?;
        if changed == 0 {
            return Err(CampaignStoreError::NotFound);
        }
        Ok(())
    }
}

fn validate_update(update: &ModelSettingsUpdate) -> Result<(), CampaignStoreError> {
    for value in [
        update.preset_key.as_str(),
        update.provider_display_name.as_str(),
        update.model_name.as_str(),
        update.model_display_name.as_str(),
    ] {
        if value.trim().is_empty() || value.trim() != value || value.len() > 256 {
            return Err(CampaignStoreError::InvalidData);
        }
    }
    if !PRESETS.contains(&update.preset_key.as_str())
        || update.base_url.is_none()
        || update
            .credential_ref
            .as_deref()
            .is_some_and(|value| !is_credential_ref(value))
        || update
            .base_url
            .as_deref()
            .is_some_and(|value| value.trim() != value || value.len() > 2048)
    {
        return Err(CampaignStoreError::InvalidData);
    }
    Uuid::parse_str(&update.probe_receipt_id).map_err(|_| CampaignStoreError::InvalidData)?;
    if FIXED_PRESET_ENDPOINTS.iter().any(|(preset, endpoint)| {
        update.preset_key == *preset && update.base_url.as_deref() != Some(*endpoint)
    }) {
        return Err(CampaignStoreError::InvalidData);
    }
    let expected_endpoint = model_endpoint_fingerprint(
        &update.preset_key,
        update
            .base_url
            .as_deref()
            .ok_or(CampaignStoreError::InvalidData)?,
    );
    if update.endpoint_fingerprint != expected_endpoint
        || update.probe_fingerprint
            != model_probe_fingerprint(
                &expected_endpoint,
                &update.model_name,
                update.capability_source,
                &update.capabilities,
            )?
    {
        return Err(CampaignStoreError::InvalidData);
    }
    match (update.credential_action, update.credential_ref.as_ref()) {
        (CredentialAction::Keep | CredentialAction::Clear, None)
        | (CredentialAction::Replace, Some(_)) => {}
        _ => return Err(CampaignStoreError::InvalidData),
    }
    if update.preset_key == "ollama" && update.credential_action == CredentialAction::Replace {
        return Err(CampaignStoreError::InvalidData);
    }
    if !matches!(
        update.capabilities.cost_status.as_str(),
        "FREE" | "PAID" | "UNKNOWN"
    ) || !has_strict_rfc3339_shape(&update.capabilities.checked_at)
        || OffsetDateTime::parse(&update.capabilities.checked_at, &Rfc3339).is_err()
        || update
            .capabilities
            .context_window_tokens
            .is_some_and(|value| value == 0 || value > MAX_SAFE_CONTEXT_TOKENS)
        || !update.capabilities.text
    {
        return Err(CampaignStoreError::InvalidData);
    }
    if update
        .base_url
        .as_deref()
        .is_some_and(|value| ApprovedEndpoint::parse(value).is_err())
    {
        return Err(CampaignStoreError::InvalidData);
    }
    Ok(())
}

pub fn model_endpoint_fingerprint(preset_key: &str, normalized_base_url: &str) -> String {
    hex_sha256(format!("endpoint:v1\n{preset_key}\n{normalized_base_url}").as_bytes())
}

pub fn model_probe_fingerprint(
    endpoint_fingerprint: &str,
    model_name: &str,
    source: CapabilitySource,
    capabilities: &ModelCapabilitiesRegistration,
) -> Result<String, CampaignStoreError> {
    let capabilities_json =
        serde_json::to_string(capabilities).map_err(|_| CampaignStoreError::InvalidData)?;
    Ok(hex_sha256(
        format!(
            "probe:v1\n{endpoint_fingerprint}\n{model_name}\n{}\n{capabilities_json}",
            source.as_str()
        )
        .as_bytes(),
    ))
}

fn hex_sha256(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn enqueue_cleanup(
    transaction: &rusqlite::Transaction<'_>,
    credential_ref: &str,
    reason: CredentialCleanupReason,
    at: &str,
) -> Result<(), CampaignStoreError> {
    if !is_credential_ref(credential_ref) {
        return Err(CampaignStoreError::InvalidData);
    }
    transaction.execute(
        "INSERT INTO credential_cleanup_queue (
           credential_ref, reason, attempts, created_at, updated_at
         ) VALUES (?1, ?2, 0, ?3, ?3)
         ON CONFLICT(credential_ref) DO UPDATE SET
           reason = excluded.reason, updated_at = excluded.updated_at",
        params![credential_ref, reason.as_str(), at],
    )?;
    Ok(())
}

fn has_strict_rfc3339_shape(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() < 20
        || bytes.get(4) != Some(&b'-')
        || bytes.get(7) != Some(&b'-')
        || bytes.get(10) != Some(&b'T')
        || bytes.get(13) != Some(&b':')
        || bytes.get(16) != Some(&b':')
    {
        return false;
    }
    let timezone_start = if bytes.last() == Some(&b'Z') {
        bytes.len() - 1
    } else if bytes.len() >= 25
        && matches!(bytes[bytes.len() - 6], b'+' | b'-')
        && bytes[bytes.len() - 3] == b':'
    {
        bytes.len() - 6
    } else {
        return false;
    };
    let digit_positions = [0, 1, 2, 3, 5, 6, 8, 9, 11, 12, 14, 15, 17, 18];
    if digit_positions
        .iter()
        .any(|index| !bytes.get(*index).is_some_and(u8::is_ascii_digit))
    {
        return false;
    }
    if timezone_start == 19 {
        return true;
    }
    timezone_start > 20
        && bytes.get(19) == Some(&b'.')
        && bytes[20..timezone_start].iter().all(u8::is_ascii_digit)
}

fn is_credential_ref(value: &str) -> bool {
    value
        .strip_prefix("credential:v1:")
        .and_then(|id| Uuid::parse_str(id).ok())
        .is_some()
}

fn read_setting(
    connection: &rusqlite::Connection,
    key: &str,
) -> Result<Option<String>, CampaignStoreError> {
    let value = connection
        .query_row(
            "SELECT value_json FROM app_settings WHERE key = ?1",
            [key],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    value
        .map(|json| {
            serde_json::from_str::<String>(&json).map_err(|_| CampaignStoreError::InvalidData)
        })
        .transpose()
}

fn write_setting(
    transaction: &rusqlite::Transaction<'_>,
    key: &str,
    profile_id: &str,
    at: &str,
) -> Result<(), CampaignStoreError> {
    let json = serde_json::to_string(profile_id).map_err(|_| CampaignStoreError::InvalidData)?;
    transaction.execute(
        "INSERT INTO app_settings (key, value_json, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at",
        params![key, json, at],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn settings_persist_without_changing_campaign_facts() {
        let directory = tempdir().unwrap();
        let store = CampaignStore::open(directory.path().join("settings.sqlite")).unwrap();
        let campaign = store.create_campaign().unwrap();
        let before = store.continue_campaign(&campaign.id).unwrap();
        let credential_ref = format!("credential:v1:{}", Uuid::new_v4());
        let mut update = settings_update("deepseek", "DeepSeek primary", "deepseek-v4-flash");
        update.credential_ref = Some(credential_ref);
        update.credential_action = CredentialAction::Replace;
        update.model_display_name = "DeepSeek V4 Flash".to_owned();
        update.capabilities.json_mode = true;
        update.capabilities.reasoning = true;
        update.capabilities.context_window_tokens = Some(1_048_576);
        update.use_as_default = true;
        update.use_as_fallback = true;
        refresh_probe_metadata(&mut update);
        let saved = store.save_model_settings(update).unwrap();
        assert_eq!(saved.profiles.len(), 1);
        assert_eq!(
            saved.default_model_profile_id,
            Some(saved.profiles[0].id.clone())
        );
        assert_eq!(
            saved.fallback_model_profile_id,
            saved.default_model_profile_id
        );

        let reopened = CampaignStore::open(directory.path().join("settings.sqlite")).unwrap();
        assert_eq!(reopened.model_settings().unwrap(), saved);
        let after = reopened.list().unwrap().pop().unwrap();
        assert_eq!(after.id, before.id);
        assert_eq!(after.state, before.state);
        assert_eq!(after.created_at, before.created_at);
        assert_eq!(after.updated_at, before.updated_at);
    }

    #[test]
    fn json_schema_capability_and_checked_time_round_trip() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("schema-capability.sqlite");
        let store = CampaignStore::open(&path).unwrap();
        let mut update = settings_update("custom", "Schema Provider", "schema-model");
        update.capabilities.json_mode = true;
        update.capabilities.json_schema = true;
        update.capabilities.checked_at = "2026-08-01T08:30:00+08:00".to_owned();
        refresh_probe_metadata(&mut update);

        let saved = store.save_model_settings(update).unwrap();
        assert_eq!(saved.profiles.len(), 1);
        assert_eq!(
            saved.profiles[0]
                .capabilities
                .as_ref()
                .map(|value| value.json_schema),
            Some(true)
        );
        assert_eq!(
            saved.profiles[0]
                .capabilities
                .as_ref()
                .map(|value| value.checked_at.as_str()),
            Some("2026-08-01T08:30:00+08:00")
        );

        let reopened = CampaignStore::open(path).unwrap();
        assert_eq!(reopened.model_settings().unwrap(), saved);
    }

    #[test]
    fn invalid_capability_registration_is_rejected_without_partial_provider_write() {
        let directory = tempdir().unwrap();
        let store =
            CampaignStore::open(directory.path().join("invalid-capability.sqlite")).unwrap();

        for invalid in ["not-a-time", "2026-08-01 00:00:00Z", "2026-08-01T00:00:00"] {
            let mut update = settings_update("custom", "Invalid Provider", invalid);
            update.capabilities.checked_at = invalid.to_owned();
            assert!(
                store.save_model_settings(update).is_err(),
                "accepted invalid RFC3339 timestamp: {invalid}"
            );
        }

        let mut zero = settings_update("custom", "Invalid Provider", "zero-context");
        zero.capabilities.context_window_tokens = Some(0);
        assert!(store.save_model_settings(zero).is_err());

        let mut oversized = settings_update("custom", "Invalid Provider", "large-context");
        oversized.capabilities.context_window_tokens = Some(MAX_SAFE_CONTEXT_TOKENS + 1);
        assert!(store.save_model_settings(oversized).is_err());

        let connection = store.connect().unwrap();
        let providers: i64 = connection
            .query_row("SELECT COUNT(*) FROM provider_configs", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(providers, 0);
    }

    #[test]
    fn provider_capabilities_remain_independent_and_legacy_empty_data_is_unregistered() {
        let directory = tempdir().unwrap();
        let store =
            CampaignStore::open(directory.path().join("provider-capabilities.sqlite")).unwrap();
        let mut schema = settings_update("custom", "Schema Provider", "schema-model");
        schema.capabilities.json_schema = true;
        refresh_probe_metadata(&mut schema);
        store.save_model_settings(schema).unwrap();
        let plain = settings_update("ollama", "Local Provider", "plain-model");
        store.save_model_settings(plain).unwrap();

        let connection = store.connect().unwrap();
        connection
            .execute(
                "INSERT INTO provider_configs (
                   id, provider_type, preset_key, display_name, base_url, credential_ref,
                   options_json, enabled, created_at, updated_at
                 ) VALUES ('legacy-provider', 'Local', 'ollama', 'Legacy Provider',
                           NULL, NULL, '{}', 1, '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z')",
                [],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO model_profiles (
                   id, provider_config_id, model_name, display_name, capabilities_json,
                   task_options_json, enabled, capabilities_checked_at, created_at, updated_at
                 ) VALUES ('legacy-profile', 'legacy-provider', 'legacy-model', 'Legacy Model',
                           '{}', '{}', 1, NULL, '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z')",
                [],
            )
            .unwrap();
        drop(connection);

        let snapshot = store.model_settings().unwrap();
        let schema = snapshot
            .profiles
            .iter()
            .find(|profile| profile.model_name == "schema-model")
            .unwrap();
        let plain = snapshot
            .profiles
            .iter()
            .find(|profile| profile.model_name == "plain-model")
            .unwrap();
        let legacy = snapshot
            .profiles
            .iter()
            .find(|profile| profile.model_name == "legacy-model")
            .unwrap();
        assert_eq!(
            schema.capabilities.as_ref().map(|value| value.json_schema),
            Some(true)
        );
        assert_eq!(
            plain.capabilities.as_ref().map(|value| value.json_schema),
            Some(false)
        );
        assert_eq!(legacy.capabilities, None);
    }

    #[test]
    fn capability_and_provider_updates_roll_back_together() {
        let directory = tempdir().unwrap();
        let store = CampaignStore::open(directory.path().join("atomic-capability.sqlite")).unwrap();
        let connection = store.connect().unwrap();
        connection
            .execute_batch(
                "CREATE TRIGGER reject_model_profile
                 BEFORE INSERT ON model_profiles
                 BEGIN
                   SELECT RAISE(ABORT, 'simulated model profile failure');
                 END;",
            )
            .unwrap();
        drop(connection);

        assert!(
            store
                .save_model_settings(settings_update("custom", "Atomic Provider", "atomic-model"))
                .is_err()
        );
        let connection = store.connect().unwrap();
        let providers: i64 = connection
            .query_row("SELECT COUNT(*) FROM provider_configs", [], |row| {
                row.get(0)
            })
            .unwrap();
        let profiles: i64 = connection
            .query_row("SELECT COUNT(*) FROM model_profiles", [], |row| row.get(0))
            .unwrap();
        assert_eq!((providers, profiles), (0, 0));
    }

    #[test]
    fn endpoint_switch_disables_old_profile_and_clears_default_and_fallback() {
        let directory = tempdir().unwrap();
        let store = CampaignStore::open(directory.path().join("endpoint-switch.sqlite")).unwrap();
        let mut original = settings_update("custom", "Switchable Provider", "old-model");
        original.use_as_default = true;
        original.use_as_fallback = true;
        let original_profile = store.save_model_settings(original).unwrap().profiles[0]
            .id
            .clone();

        let mut replacement = settings_update("custom", "Switchable Provider", "new-model");
        replacement.base_url = Some("http://127.0.0.1:22445/v1/".to_owned());
        refresh_probe_metadata(&mut replacement);
        let saved = store.save_model_settings(replacement).unwrap();

        assert_eq!(saved.profiles.len(), 1);
        assert_eq!(saved.profiles[0].model_name, "new-model");
        assert_ne!(saved.profiles[0].id, original_profile);
        assert_eq!(saved.default_model_profile_id, None);
        assert_eq!(saved.fallback_model_profile_id, None);
        let connection = store.connect().unwrap();
        let old_enabled: i64 = connection
            .query_row(
                "SELECT enabled FROM model_profiles WHERE id = ?1",
                [original_profile],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(old_enabled, 0);
    }

    #[test]
    fn stale_or_tampered_probe_fingerprints_are_rejected_before_writes() {
        let directory = tempdir().unwrap();
        let store = CampaignStore::open(directory.path().join("stale-probe.sqlite")).unwrap();
        let mut endpoint_changed = settings_update("custom", "Probe Provider", "model-a");
        endpoint_changed.base_url = Some("http://127.0.0.1:22445/v1/".to_owned());
        assert!(store.save_model_settings(endpoint_changed).is_err());

        let mut capability_changed = settings_update("custom", "Probe Provider", "model-a");
        capability_changed.capabilities.json_mode = true;
        assert!(store.save_model_settings(capability_changed).is_err());
        assert!(store.model_settings().unwrap().profiles.is_empty());
    }

    #[test]
    fn forgetting_a_credential_clears_the_provider_without_exposing_the_secret() {
        let directory = tempdir().unwrap();
        let store = CampaignStore::open(directory.path().join("forget-credential.sqlite")).unwrap();
        let credential_ref = format!("credential:v1:{}", Uuid::new_v4());
        let mut update = settings_update("custom", "Private Provider", "private-model");
        update.credential_ref = Some(credential_ref.clone());
        update.credential_action = CredentialAction::Replace;
        let saved = store.save_model_settings(update).unwrap();
        let profile_id = saved.profiles[0].id.clone();

        let snapshot = store.forget_model_credential(&profile_id).unwrap();

        assert!(!snapshot.profiles[0].has_credential);
        assert_eq!(snapshot.pending_credential_cleanup_count, 1);
        assert_eq!(
            store.pending_credential_cleanups().unwrap()[0].credential_ref,
            credential_ref
        );
        assert_eq!(snapshot.profiles[0].id, profile_id);
        assert!(matches!(
            store.forget_model_credential("not-a-profile-id"),
            Err(CampaignStoreError::InvalidData)
        ));
    }

    #[test]
    fn credential_replace_keep_clear_and_cleanup_recovery_are_durable() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("credential-lifecycle.sqlite");
        let store = CampaignStore::open(&path).unwrap();
        let first = format!("credential:v1:{}", Uuid::new_v4());
        let second = format!("credential:v1:{}", Uuid::new_v4());

        let mut create = settings_update("custom", "Lifecycle Provider", "lifecycle-model");
        create.credential_ref = Some(first.clone());
        create.credential_action = CredentialAction::Replace;
        store
            .enqueue_credential_cleanup(&first, CredentialCleanupReason::Rollback)
            .unwrap();
        store.save_model_settings(create).unwrap();
        assert!(store.pending_credential_cleanups().unwrap().is_empty());

        let keep = settings_update("custom", "Lifecycle Provider", "lifecycle-model");
        let kept = store.save_model_settings(keep).unwrap();
        assert!(kept.profiles[0].has_credential);
        assert_eq!(kept.pending_credential_cleanup_count, 0);

        let mut replace = settings_update("custom", "Lifecycle Provider", "lifecycle-model");
        replace.credential_ref = Some(second.clone());
        replace.credential_action = CredentialAction::Replace;
        store
            .enqueue_credential_cleanup(&second, CredentialCleanupReason::Rollback)
            .unwrap();
        let replaced = store.save_model_settings(replace).unwrap();
        assert_eq!(replaced.pending_credential_cleanup_count, 1);
        assert_eq!(
            store.pending_credential_cleanups().unwrap()[0].credential_ref,
            first
        );

        store.record_credential_cleanup_failure(&first).unwrap();
        assert_eq!(store.pending_credential_cleanups().unwrap()[0].attempts, 1);
        drop(store);

        let reopened = CampaignStore::open(&path).unwrap();
        assert_eq!(
            reopened.pending_credential_cleanups().unwrap()[0].attempts,
            1
        );
        reopened.complete_credential_cleanup(&first).unwrap();

        let mut clear = settings_update("custom", "Lifecycle Provider", "lifecycle-model");
        clear.credential_action = CredentialAction::Clear;
        let cleared = reopened.save_model_settings(clear).unwrap();
        assert!(!cleared.profiles[0].has_credential);
        assert_eq!(
            reopened.pending_credential_cleanups().unwrap()[0].credential_ref,
            second
        );
        reopened.complete_credential_cleanup(&second).unwrap();
        assert_eq!(
            reopened
                .model_settings()
                .unwrap()
                .pending_credential_cleanup_count,
            0
        );
    }

    #[test]
    fn credential_replacement_and_cleanup_enqueue_roll_back_together() {
        let directory = tempdir().unwrap();
        let store = CampaignStore::open(directory.path().join("credential-atomic.sqlite")).unwrap();
        let first = format!("credential:v1:{}", Uuid::new_v4());
        let second = format!("credential:v1:{}", Uuid::new_v4());
        let mut create = settings_update("custom", "Atomic Credential", "atomic-model");
        create.credential_ref = Some(first.clone());
        create.credential_action = CredentialAction::Replace;
        store.save_model_settings(create).unwrap();

        let connection = store.connect().unwrap();
        connection
            .execute_batch(
                "CREATE TRIGGER reject_model_update
                 BEFORE UPDATE ON model_profiles
                 BEGIN
                   SELECT RAISE(ABORT, 'simulated model update failure');
                 END;",
            )
            .unwrap();
        drop(connection);

        let mut replace = settings_update("custom", "Atomic Credential", "atomic-model");
        replace.credential_ref = Some(second);
        replace.credential_action = CredentialAction::Replace;
        assert!(store.save_model_settings(replace).is_err());

        let connection = store.connect().unwrap();
        let stored: String = connection
            .query_row(
                "SELECT credential_ref FROM provider_configs WHERE display_name = 'Atomic Credential'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let queued: i64 = connection
            .query_row("SELECT COUNT(*) FROM credential_cleanup_queue", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(stored, first);
        assert_eq!(queued, 0);
    }

    #[test]
    fn invalid_credential_actions_are_rejected_before_writes() {
        let directory = tempdir().unwrap();
        let store =
            CampaignStore::open(directory.path().join("credential-invalid.sqlite")).unwrap();
        let mut invalid = settings_update("custom", "Invalid Credential", "invalid-model");
        invalid.credential_ref = Some(format!("credential:v1:{}", Uuid::new_v4()));
        assert!(store.save_model_settings(invalid).is_err());

        let mut missing = settings_update("custom", "Invalid Credential", "invalid-model");
        missing.credential_action = CredentialAction::Replace;
        assert!(store.save_model_settings(missing).is_err());
        assert!(store.model_settings().unwrap().profiles.is_empty());
    }

    fn settings_update(
        preset_key: &str,
        provider_display_name: &str,
        model_name: &str,
    ) -> ModelSettingsUpdate {
        let base_url = match preset_key {
            "deepseek" => "https://api.deepseek.com/",
            "qwen" => "https://dashscope.aliyuncs.com/compatible-mode/v1/",
            "openrouter" => "https://openrouter.ai/api/v1/",
            "ollama" => "http://localhost:11434/v1/",
            _ => "http://127.0.0.1:11434/",
        }
        .to_owned();
        let mut update = ModelSettingsUpdate {
            preset_key: preset_key.to_owned(),
            provider_display_name: provider_display_name.to_owned(),
            base_url: Some(base_url),
            endpoint_fingerprint: String::new(),
            credential_ref: None,
            credential_action: CredentialAction::Keep,
            model_name: model_name.to_owned(),
            model_display_name: model_name.to_owned(),
            capabilities: ModelCapabilitiesRegistration {
                text: true,
                streaming: false,
                system_messages: true,
                json_mode: false,
                json_schema: false,
                tool_calling: false,
                reasoning: false,
                context_window_tokens: Some(32_768),
                cost_status: "UNKNOWN".to_owned(),
                checked_at: "2026-08-01T00:00:00Z".to_owned(),
            },
            capability_source: CapabilitySource::Unknown,
            probe_fingerprint: String::new(),
            probe_receipt_id: Uuid::new_v4().to_string(),
            use_as_default: false,
            use_as_fallback: false,
        };
        refresh_probe_metadata(&mut update);
        update
    }

    fn refresh_probe_metadata(update: &mut ModelSettingsUpdate) {
        update.endpoint_fingerprint =
            model_endpoint_fingerprint(&update.preset_key, update.base_url.as_deref().unwrap());
        update.probe_fingerprint = model_probe_fingerprint(
            &update.endpoint_fingerprint,
            &update.model_name,
            update.capability_source,
            &update.capabilities,
        )
        .unwrap();
    }
}

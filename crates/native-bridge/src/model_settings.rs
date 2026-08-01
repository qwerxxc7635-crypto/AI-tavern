use ember_secure_http::ApprovedEndpoint;
use rusqlite::{OptionalExtension, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{CampaignStore, CampaignStoreError, current_timestamp};

const DEFAULT_MODEL_KEY: &str = "default_model_profile_id";
const FALLBACK_MODEL_KEY: &str = "fallback_model_profile_id";
const PRESETS: &[&str] = &["deepseek", "qwen", "openrouter", "ollama", "custom"];

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ModelSettingsUpdate {
    pub preset_key: String,
    pub provider_display_name: String,
    pub base_url: Option<String>,
    pub credential_ref: Option<String>,
    pub model_name: String,
    pub model_display_name: String,
    pub use_as_default: bool,
    pub use_as_fallback: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelProfileView {
    pub id: String,
    pub provider_id: String,
    pub preset_key: String,
    pub provider_display_name: String,
    pub base_url: Option<String>,
    pub has_credential: bool,
    pub model_name: String,
    pub model_display_name: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelSettingsSnapshot {
    pub profiles: Vec<ModelProfileView>,
    pub default_model_profile_id: Option<String>,
    pub fallback_model_profile_id: Option<String>,
}

impl CampaignStore {
    pub fn model_settings(&self) -> Result<ModelSettingsSnapshot, CampaignStoreError> {
        let connection = self.connect()?;
        let mut statement = connection.prepare(
            "SELECT m.id, p.id, p.preset_key, p.display_name, p.base_url,
                    p.credential_ref IS NOT NULL, m.model_name, m.display_name
             FROM model_profiles m
             JOIN provider_configs p ON p.id = m.provider_config_id
             WHERE p.enabled = 1 AND m.enabled = 1
             ORDER BY p.display_name, m.display_name, m.id",
        )?;
        let profiles = statement
            .query_map([], |row| {
                Ok(ModelProfileView {
                    id: row.get(0)?,
                    provider_id: row.get(1)?,
                    preset_key: row.get(2)?,
                    provider_display_name: row.get(3)?,
                    base_url: row.get(4)?,
                    has_credential: row.get(5)?,
                    model_name: row.get(6)?,
                    model_display_name: row.get(7)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(ModelSettingsSnapshot {
            profiles,
            default_model_profile_id: read_setting(&connection, DEFAULT_MODEL_KEY)?,
            fallback_model_profile_id: read_setting(&connection, FALLBACK_MODEL_KEY)?,
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
                "SELECT id FROM provider_configs WHERE preset_key = ?1 AND display_name = ?2",
                params![update.preset_key, update.provider_display_name],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        let provider_id = existing_provider.unwrap_or_else(|| Uuid::new_v4().to_string());
        let provider_type = if update.preset_key == "ollama" {
            "Local"
        } else {
            "OpenAI-Compatible"
        };
        transaction.execute(
            "INSERT INTO provider_configs (
               id, provider_type, preset_key, display_name, base_url, credential_ref,
               options_json, enabled, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, '{}', 1, ?7, ?7)
             ON CONFLICT(preset_key, display_name) DO UPDATE SET
               base_url = excluded.base_url,
               credential_ref = excluded.credential_ref,
               enabled = 1,
               updated_at = excluded.updated_at",
            params![
                provider_id,
                provider_type,
                update.preset_key,
                update.provider_display_name,
                update.base_url,
                update.credential_ref,
                at
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
        transaction.execute(
            "INSERT INTO model_profiles (
               id, provider_config_id, model_name, display_name, capabilities_json,
               task_options_json, enabled, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, '{}', '{}', 1, ?5, ?5)
             ON CONFLICT(provider_config_id, model_name) DO UPDATE SET
               display_name = excluded.display_name,
               enabled = 1,
               updated_at = excluded.updated_at",
            params![
                profile_id,
                provider_id,
                update.model_name,
                update.model_display_name,
                at
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
        || (update.preset_key == "custom" && update.base_url.is_none())
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
    if update
        .base_url
        .as_deref()
        .is_some_and(|value| ApprovedEndpoint::parse(value).is_err())
    {
        return Err(CampaignStoreError::InvalidData);
    }
    Ok(())
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
        let saved = store
            .save_model_settings(ModelSettingsUpdate {
                preset_key: "deepseek".to_owned(),
                provider_display_name: "DeepSeek primary".to_owned(),
                base_url: Some("https://api.deepseek.com/".to_owned()),
                credential_ref: Some(credential_ref),
                model_name: "deepseek-v4-flash".to_owned(),
                model_display_name: "DeepSeek V4 Flash".to_owned(),
                use_as_default: true,
                use_as_fallback: true,
            })
            .unwrap();
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
}

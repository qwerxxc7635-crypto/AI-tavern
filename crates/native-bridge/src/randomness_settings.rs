use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};

use crate::{CampaignStore, CampaignStoreError, current_timestamp};

const RANDOMNESS_SETTINGS_KEY: &str = "randomness_profile_v1";

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RandomnessProfile {
    Conservative,
    Balanced,
    High,
    Custom,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RandomnessSettingsUpdate {
    pub profile: RandomnessProfile,
    pub custom_temperature: Option<f64>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RandomnessSettingsSnapshot {
    pub profile: RandomnessProfile,
    pub custom_temperature: Option<f64>,
    pub temperature: f64,
}

impl CampaignStore {
    pub fn randomness_settings(&self) -> Result<RandomnessSettingsSnapshot, CampaignStoreError> {
        let connection = self.connect()?;
        let stored = connection
            .query_row(
                "SELECT value_json FROM app_settings WHERE key = ?1",
                [RANDOMNESS_SETTINGS_KEY],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        match stored {
            Some(raw) => {
                let update: RandomnessSettingsUpdate =
                    serde_json::from_str(&raw).map_err(|_| CampaignStoreError::InvalidData)?;
                resolve_settings(update)
            }
            None => resolve_settings(RandomnessSettingsUpdate {
                profile: RandomnessProfile::Balanced,
                custom_temperature: None,
            }),
        }
    }

    pub fn save_randomness_settings(
        &self,
        update: RandomnessSettingsUpdate,
    ) -> Result<RandomnessSettingsSnapshot, CampaignStoreError> {
        let resolved = resolve_settings(update.clone())?;
        let value = serde_json::to_string(&update).map_err(|_| CampaignStoreError::InvalidData)?;
        let connection = self.connect()?;
        connection.execute(
            "INSERT INTO app_settings (key, value_json, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(key) DO UPDATE SET
               value_json = excluded.value_json,
               updated_at = excluded.updated_at",
            params![RANDOMNESS_SETTINGS_KEY, value, current_timestamp()?],
        )?;
        Ok(resolved)
    }
}

fn resolve_settings(
    update: RandomnessSettingsUpdate,
) -> Result<RandomnessSettingsSnapshot, CampaignStoreError> {
    let temperature = match (update.profile, update.custom_temperature) {
        (RandomnessProfile::Conservative, None) => 0.2,
        (RandomnessProfile::Balanced, None) => 0.7,
        (RandomnessProfile::High, None) => 1.1,
        (RandomnessProfile::Custom, Some(value))
            if value.is_finite() && (0.0..=2.0).contains(&value) =>
        {
            value
        }
        _ => return Err(CampaignStoreError::InvalidData),
    };
    Ok(RandomnessSettingsSnapshot {
        profile: update.profile,
        custom_temperature: update.custom_temperature,
        temperature,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_to_balanced_and_persists_all_four_profiles() {
        let directory = tempfile::tempdir().expect("tempdir");
        let store = CampaignStore::open(directory.path().join("campaign.sqlite")).expect("store");
        assert_eq!(
            store.randomness_settings().expect("default"),
            RandomnessSettingsSnapshot {
                profile: RandomnessProfile::Balanced,
                custom_temperature: None,
                temperature: 0.7,
            }
        );
        for (profile, custom_temperature, temperature) in [
            (RandomnessProfile::Conservative, None, 0.2),
            (RandomnessProfile::Balanced, None, 0.7),
            (RandomnessProfile::High, None, 1.1),
            (RandomnessProfile::Custom, Some(1.4), 1.4),
        ] {
            let saved = store
                .save_randomness_settings(RandomnessSettingsUpdate {
                    profile,
                    custom_temperature,
                })
                .expect("save");
            assert_eq!(saved.temperature, temperature);
            assert_eq!(store.randomness_settings().expect("reload"), saved);
        }
        let reopened = CampaignStore::open(directory.path().join("campaign.sqlite")).expect("open");
        assert_eq!(
            reopened.randomness_settings().expect("reopen"),
            RandomnessSettingsSnapshot {
                profile: RandomnessProfile::Custom,
                custom_temperature: Some(1.4),
                temperature: 1.4,
            }
        );
    }

    #[test]
    fn rejects_invalid_custom_and_preset_shapes_without_replacing_the_last_value() {
        let directory = tempfile::tempdir().expect("tempdir");
        let store = CampaignStore::open(directory.path().join("campaign.sqlite")).expect("store");
        let baseline = store
            .save_randomness_settings(RandomnessSettingsUpdate {
                profile: RandomnessProfile::Conservative,
                custom_temperature: None,
            })
            .expect("baseline");
        for invalid in [
            RandomnessSettingsUpdate {
                profile: RandomnessProfile::Custom,
                custom_temperature: None,
            },
            RandomnessSettingsUpdate {
                profile: RandomnessProfile::Custom,
                custom_temperature: Some(2.1),
            },
            RandomnessSettingsUpdate {
                profile: RandomnessProfile::High,
                custom_temperature: Some(1.1),
            },
        ] {
            assert!(matches!(
                store.save_randomness_settings(invalid),
                Err(CampaignStoreError::InvalidData)
            ));
            assert_eq!(store.randomness_settings().expect("unchanged"), baseline);
        }
    }
}

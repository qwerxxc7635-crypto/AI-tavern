use rusqlite::{OptionalExtension, TransactionBehavior, params};
use serde::{Deserialize, Serialize};

use crate::{CampaignStore, CampaignStoreError};

const SETTINGS_KEY: &str = "deepseek_cache_metrics_v1";
const MAX_METRICS: usize = 200;
const AI_TASKS: &[&str] = &[
    "GENERATE_WORLD",
    "REFINE_WORLD",
    "GENERATE_CHARACTER_TRAITS",
    "COMPLETE_CHARACTER_BACKGROUND",
    "GENERATE_TAVERN",
    "GENERATE_NPCS",
    "NPC_REPLY",
    "GENERATE_QUEST",
    "GENERATE_ADVENTURE_PLAN",
    "GENERATE_ADVENTURE_TURN",
    "RESOLVE_DICE_RESULT",
    "GENERATE_WORLD_EVENT",
    "SUMMARIZE_ADVENTURE",
    "EXTRACT_MEMORIES",
    "CHECK_CONSISTENCY",
];

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeepSeekCacheMetric {
    pub task_type: String,
    pub prompt_cache_hit_tokens: u64,
    pub prompt_cache_miss_tokens: u64,
    pub hit_ratio: f64,
    pub prefix_hash: String,
    pub recorded_at: String,
}

impl CampaignStore {
    pub fn record_deepseek_cache_metric(
        &self,
        task_type: &str,
        prompt_cache_hit_tokens: u64,
        prompt_cache_miss_tokens: u64,
        prefix_hash: &str,
        recorded_at: &str,
    ) -> Result<DeepSeekCacheMetric, CampaignStoreError> {
        let total = prompt_cache_hit_tokens
            .checked_add(prompt_cache_miss_tokens)
            .ok_or(CampaignStoreError::InvalidData)?;
        let metric = DeepSeekCacheMetric {
            task_type: task_type.to_owned(),
            prompt_cache_hit_tokens,
            prompt_cache_miss_tokens,
            hit_ratio: if total == 0 {
                0.0
            } else {
                prompt_cache_hit_tokens as f64 / total as f64
            },
            prefix_hash: prefix_hash.to_owned(),
            recorded_at: recorded_at.to_owned(),
        };
        validate_metric(&metric)?;
        let mut connection = self.connect()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let stored = transaction
            .query_row(
                "SELECT value_json FROM app_settings WHERE key = ?1",
                [SETTINGS_KEY],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        let mut metrics = match stored {
            None => Vec::new(),
            Some(json) => {
                let parsed: Vec<DeepSeekCacheMetric> =
                    serde_json::from_str(&json).map_err(|_| CampaignStoreError::InvalidData)?;
                if parsed.len() > MAX_METRICS {
                    return Err(CampaignStoreError::InvalidData);
                }
                for existing in &parsed {
                    validate_metric(existing)?;
                }
                parsed
            }
        };
        metrics.push(metric.clone());
        if metrics.len() > MAX_METRICS {
            metrics.drain(..metrics.len() - MAX_METRICS);
        }
        let json = serde_json::to_string(&metrics).map_err(|_| CampaignStoreError::InvalidData)?;
        transaction.execute(
            "INSERT INTO app_settings (key, value_json, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json,
                                            updated_at = excluded.updated_at",
            params![SETTINGS_KEY, json, recorded_at],
        )?;
        transaction.commit()?;
        Ok(metric)
    }

    pub fn deepseek_cache_metrics(&self) -> Result<Vec<DeepSeekCacheMetric>, CampaignStoreError> {
        let connection = self.connect()?;
        let stored = connection
            .query_row(
                "SELECT value_json FROM app_settings WHERE key = ?1",
                [SETTINGS_KEY],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        let metrics: Vec<DeepSeekCacheMetric> = stored
            .map(|json| serde_json::from_str(&json).map_err(|_| CampaignStoreError::InvalidData))
            .transpose()?
            .unwrap_or_default();
        if metrics.len() > MAX_METRICS {
            return Err(CampaignStoreError::InvalidData);
        }
        for metric in &metrics {
            validate_metric(metric)?;
        }
        Ok(metrics)
    }
}

fn validate_metric(metric: &DeepSeekCacheMetric) -> Result<(), CampaignStoreError> {
    let total = metric
        .prompt_cache_hit_tokens
        .checked_add(metric.prompt_cache_miss_tokens)
        .ok_or(CampaignStoreError::InvalidData)?;
    let ratio = if total == 0 {
        0.0
    } else {
        metric.prompt_cache_hit_tokens as f64 / total as f64
    };
    if !AI_TASKS.contains(&metric.task_type.as_str())
        || metric.hit_ratio != ratio
        || metric.prefix_hash.len() != 64
        || !metric
            .prefix_hash
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        || time::OffsetDateTime::parse(
            &metric.recorded_at,
            &time::format_description::well_known::Rfc3339,
        )
        .is_err()
    {
        return Err(CampaignStoreError::InvalidData);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn records_bounded_cache_telemetry_without_prompt_or_request_content() {
        let directory = tempdir().unwrap();
        let store = CampaignStore::open(directory.path().join("cache.sqlite")).unwrap();
        let metric = store
            .record_deepseek_cache_metric(
                "NPC_REPLY",
                768,
                256,
                &"a".repeat(64),
                "2026-08-12T00:00:00Z",
            )
            .unwrap();
        assert_eq!(metric.hit_ratio, 0.75);
        assert_eq!(store.deepseek_cache_metrics().unwrap(), vec![metric]);
        let text = serde_json::to_string(&store.deepseek_cache_metrics().unwrap()).unwrap();
        assert!(!text.contains("system contract"));
        assert!(!text.contains("player input"));
        assert!(!text.contains("credential:v1:"));
        assert!(!text.contains("requestId"));
    }

    #[test]
    fn rejects_invalid_task_hash_and_timestamp() {
        let directory = tempdir().unwrap();
        let store = CampaignStore::open(directory.path().join("invalid.sqlite")).unwrap();
        assert!(
            store
                .record_deepseek_cache_metric("UNKNOWN", 1, 0, "bad", "not-a-time")
                .is_err()
        );
    }
}

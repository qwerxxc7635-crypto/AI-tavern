use std::collections::HashSet;

use rusqlite::{Connection, OptionalExtension, Transaction, TransactionBehavior, params};
use serde::{Deserialize, Serialize};

use crate::{CampaignStore, CampaignStoreError, current_timestamp, validate_id};

const ERROR_KINDS: &[&str] = &[
    "PROVIDER",
    "GENERATION",
    "VALIDATION",
    "PERSISTENCE",
    "RULE",
    "NETWORK",
];

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NpcTimelineAttempt {
    pub id: String,
    pub sequence: i64,
    pub request_ids: Vec<String>,
    pub generation_record_ids: Vec<String>,
    pub idempotency_keys: Vec<String>,
    pub status: String,
    pub error_kind: Option<String>,
    pub error_code: Option<String>,
    pub retryable: Option<bool>,
    pub started_at: String,
    pub completed_at: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NpcTimelineOperation {
    pub id: String,
    pub operation_id: String,
    pub campaign_id: String,
    pub scope_kind: String,
    pub scope_id: String,
    pub player_intent: String,
    pub addressed_npc_id: Option<String>,
    pub hard_result_key: Option<String>,
    pub status: String,
    pub committed_ref_id: Option<String>,
    pub attempts: Vec<NpcTimelineAttempt>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NpcTimelineBegin {
    pub id: String,
    pub operation_id: String,
    pub campaign_id: String,
    pub scope_kind: String,
    pub scope_id: String,
    pub player_intent: String,
    pub addressed_npc_id: Option<String>,
    pub hard_result_key: Option<String>,
    pub attempt_id: String,
    pub request_ids: Vec<String>,
    pub generation_record_ids: Vec<String>,
    pub idempotency_keys: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NpcTimelineFail {
    pub campaign_id: String,
    pub operation_id: String,
    pub attempt_id: String,
    pub error_kind: String,
    pub error_code: String,
}

impl CampaignStore {
    pub fn latest_npc_timeline(
        &self,
        campaign_id: &str,
        scope_kind: &str,
        scope_id: &str,
    ) -> Result<Option<NpcTimelineOperation>, CampaignStoreError> {
        validate_scope(campaign_id, scope_kind, scope_id)?;
        let connection = self.connect()?;
        let id = connection
            .query_row(
                "SELECT id FROM npc_timeline_operations
                 WHERE campaign_id=?1 AND scope_kind=?2 AND scope_id=?3
                 ORDER BY rowid DESC LIMIT 1",
                params![campaign_id, scope_kind, scope_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        id.map(|id| load_operation(&connection, &id)).transpose()
    }

    pub fn begin_npc_timeline_attempt(
        &self,
        command: NpcTimelineBegin,
    ) -> Result<NpcTimelineOperation, CampaignStoreError> {
        validate_begin(&command)?;
        let mut connection = self.connect()?;
        let tx = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let at = current_timestamp()?;
        let existing_id = tx
            .query_row(
                "SELECT id FROM npc_timeline_operations WHERE operation_id=?1",
                [&command.operation_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        if let Some(id) = existing_id {
            let existing = load_operation(&tx, &id)?;
            validate_replay(&existing, &command)?;
            if existing.status == "COMMITTED" {
                return Ok(existing);
            }
            if matches!(existing.status.as_str(), "FAILED_FINAL" | "CANCELLED") {
                return Err(CampaignStoreError::InvalidState);
            }
            if let Some(started) = existing
                .attempts
                .iter()
                .find(|attempt| attempt.status == "STARTED")
            {
                fail_attempt(
                    &tx,
                    &id,
                    &started.id,
                    "GENERATION",
                    "APP_INTERRUPTED",
                    true,
                    &at,
                )?;
            }
            tx.execute(
                "UPDATE npc_timeline_operations
                 SET status='PENDING',updated_at=?1 WHERE id=?2 AND status='FAILED_RETRYABLE'",
                params![at, id],
            )?;
        } else {
            tx.execute(
                "INSERT INTO npc_timeline_operations(
                   id,operation_id,campaign_id,scope_kind,scope_id,player_intent,
                   addressed_npc_id,hard_result_key,status,committed_ref_id,created_at,updated_at
                 ) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,'PENDING',NULL,?9,?9)",
                params![
                    command.id,
                    command.operation_id,
                    command.campaign_id,
                    command.scope_kind,
                    command.scope_id,
                    command.player_intent,
                    command.addressed_npc_id,
                    command.hard_result_key,
                    at,
                ],
            )?;
        }
        if tx
            .query_row(
                "SELECT 1 FROM npc_timeline_attempts WHERE id=?1",
                [&command.attempt_id],
                |_| Ok(()),
            )
            .optional()?
            .is_some()
        {
            return Err(CampaignStoreError::InvalidState);
        }
        let sequence: i64 = tx.query_row(
            "SELECT COALESCE(MAX(sequence),0)+1 FROM npc_timeline_attempts WHERE operation_id=?1",
            [&command.id],
            |row| row.get(0),
        )?;
        tx.execute(
            "INSERT INTO npc_timeline_attempts(
               id,operation_id,sequence,request_ids_json,generation_record_ids_json,
               idempotency_keys_json,status,error_kind,error_code,retryable,started_at,completed_at
             ) VALUES(?1,?2,?3,?4,?5,?6,'STARTED',NULL,NULL,NULL,?7,NULL)",
            params![
                command.attempt_id,
                command.id,
                sequence,
                serde_json::to_string(&command.request_ids)
                    .map_err(|_| CampaignStoreError::InvalidData)?,
                serde_json::to_string(&command.generation_record_ids)
                    .map_err(|_| CampaignStoreError::InvalidData)?,
                serde_json::to_string(&command.idempotency_keys)
                    .map_err(|_| CampaignStoreError::InvalidData)?,
                at,
            ],
        )?;
        let result = load_operation(&tx, &command.id)?;
        tx.commit()?;
        Ok(result)
    }

    pub fn fail_npc_timeline_attempt(
        &self,
        command: NpcTimelineFail,
    ) -> Result<NpcTimelineOperation, CampaignStoreError> {
        validate_id(&command.campaign_id)?;
        validate_id(&command.operation_id)?;
        validate_id(&command.attempt_id)?;
        validate_failure(&command.error_kind, &command.error_code)?;
        let retryable = retryable_failure(&command.error_kind, &command.error_code);
        let mut connection = self.connect()?;
        let tx = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let operation_id: String = tx.query_row(
            "SELECT id FROM npc_timeline_operations
             WHERE operation_id=?1 AND campaign_id=?2",
            params![command.operation_id, command.campaign_id],
            |row| row.get(0),
        )?;
        let at = current_timestamp()?;
        fail_attempt(
            &tx,
            &operation_id,
            &command.attempt_id,
            &command.error_kind,
            &command.error_code,
            retryable,
            &at,
        )?;
        let result = load_operation(&tx, &operation_id)?;
        tx.commit()?;
        Ok(result)
    }
}

pub(crate) fn commit_npc_timeline(
    tx: &Transaction<'_>,
    operation_id: &str,
    attempt_id: &str,
    committed_ref_id: &str,
    generation_record_ids: &[String],
    at: &str,
) -> Result<(), CampaignStoreError> {
    validate_id(operation_id)?;
    validate_id(attempt_id)?;
    validate_id(committed_ref_id)?;
    let declared: (String, String, String) = tx.query_row(
        "SELECT request_ids_json,generation_record_ids_json,idempotency_keys_json
         FROM npc_timeline_attempts
         WHERE id=?1 AND operation_id=?2 AND status='STARTED'",
        params![attempt_id, operation_id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    )?;
    let request_ids: Vec<String> =
        serde_json::from_str(&declared.0).map_err(|_| CampaignStoreError::InvalidData)?;
    let declared_generations: Vec<String> =
        serde_json::from_str(&declared.1).map_err(|_| CampaignStoreError::InvalidData)?;
    let idempotency_keys: Vec<String> =
        serde_json::from_str(&declared.2).map_err(|_| CampaignStoreError::InvalidData)?;
    if declared_generations != generation_record_ids {
        return Err(CampaignStoreError::InvalidData);
    }
    let (scope_kind, scope_id, campaign_id): (String, String, String) = tx.query_row(
        "SELECT scope_kind,scope_id,campaign_id FROM npc_timeline_operations
         WHERE id=?1 AND status='PENDING'",
        [operation_id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    )?;
    let valid_reference = match scope_kind.as_str() {
        "NPC_DIALOGUE" => tx
            .query_row(
                "SELECT 1 FROM messages message
                 JOIN conversations conversation ON conversation.id=message.conversation_id
                 WHERE message.id=?1 AND message.role='NPC' AND conversation.kind='NPC'
                   AND conversation.npc_id=?2 AND conversation.campaign_id=?3",
                params![committed_ref_id, scope_id, campaign_id],
                |_| Ok(()),
            )
            .optional()?
            .is_some(),
        "TAVERN_SCENE" => tx
            .query_row(
                "SELECT 1 FROM tavern_scene_turns
                 WHERE id=?1 AND scene_id=?2 AND campaign_id=?3",
                params![committed_ref_id, scope_id, campaign_id],
                |_| Ok(()),
            )
            .optional()?
            .is_some(),
        _ => false,
    };
    if !valid_reference {
        return Err(CampaignStoreError::InvalidData);
    }
    for ((request_id, generation_id), idempotency_key) in request_ids
        .iter()
        .zip(declared_generations.iter())
        .zip(idempotency_keys.iter())
    {
        let audit: (String, String, String) = tx.query_row(
            "SELECT generation.request_id,pending.id,pending.idempotency_key
             FROM generation_records generation
             JOIN pending_ai_requests pending ON pending.id=generation.request_id
             WHERE generation.id=?1 AND generation.request_id=?2
               AND pending.status='COMMITTED'",
            params![generation_id, request_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )?;
        if audit.0 != *request_id || audit.1 != *request_id || audit.2 != *idempotency_key {
            return Err(CampaignStoreError::InvalidData);
        }
    }
    let changed = tx.execute(
        "UPDATE npc_timeline_attempts
         SET status='COMMITTED',completed_at=?1
         WHERE id=?2 AND operation_id=?3 AND status='STARTED'",
        params![at, attempt_id, operation_id],
    )?;
    if changed != 1 {
        return Err(CampaignStoreError::InvalidState);
    }
    let changed = tx.execute(
        "UPDATE npc_timeline_operations
         SET status='COMMITTED',committed_ref_id=?1,updated_at=?2
         WHERE id=?3 AND status='PENDING'",
        params![committed_ref_id, at, operation_id],
    )?;
    if changed != 1 {
        return Err(CampaignStoreError::InvalidState);
    }
    Ok(())
}

fn fail_attempt(
    tx: &Transaction<'_>,
    operation_id: &str,
    attempt_id: &str,
    kind: &str,
    code: &str,
    retryable: bool,
    at: &str,
) -> Result<(), CampaignStoreError> {
    let changed = tx.execute(
        "UPDATE npc_timeline_attempts
         SET status='FAILED',error_kind=?1,error_code=?2,retryable=?3,completed_at=?4
         WHERE id=?5 AND operation_id=?6 AND status='STARTED'",
        params![kind, code, retryable, at, attempt_id, operation_id],
    )?;
    if changed != 1 {
        return Err(CampaignStoreError::InvalidState);
    }
    tx.execute(
        "UPDATE npc_timeline_operations SET status=?1,updated_at=?2
         WHERE id=?3 AND status='PENDING'",
        params![
            if retryable {
                "FAILED_RETRYABLE"
            } else {
                "FAILED_FINAL"
            },
            at,
            operation_id
        ],
    )?;
    Ok(())
}

fn load_operation(
    connection: &Connection,
    id: &str,
) -> Result<NpcTimelineOperation, CampaignStoreError> {
    let mut operation = connection.query_row(
        "SELECT id,operation_id,campaign_id,scope_kind,scope_id,player_intent,
                addressed_npc_id,hard_result_key,status,committed_ref_id,created_at,updated_at
         FROM npc_timeline_operations WHERE id=?1",
        [id],
        |row| {
            Ok(NpcTimelineOperation {
                id: row.get(0)?,
                operation_id: row.get(1)?,
                campaign_id: row.get(2)?,
                scope_kind: row.get(3)?,
                scope_id: row.get(4)?,
                player_intent: row.get(5)?,
                addressed_npc_id: row.get(6)?,
                hard_result_key: row.get(7)?,
                status: row.get(8)?,
                committed_ref_id: row.get(9)?,
                attempts: Vec::new(),
                created_at: row.get(10)?,
                updated_at: row.get(11)?,
            })
        },
    )?;
    let mut statement = connection.prepare(
        "SELECT id,sequence,request_ids_json,generation_record_ids_json,idempotency_keys_json,
                status,error_kind,error_code,retryable,started_at,completed_at
         FROM npc_timeline_attempts WHERE operation_id=?1 ORDER BY sequence",
    )?;
    operation.attempts = statement
        .query_map([id], |row| {
            let requests: String = row.get(2)?;
            let generations: String = row.get(3)?;
            let keys: String = row.get(4)?;
            Ok(NpcTimelineAttempt {
                id: row.get(0)?,
                sequence: row.get(1)?,
                request_ids: parse_ids(&requests)?,
                generation_record_ids: parse_ids(&generations)?,
                idempotency_keys: parse_ids(&keys)?,
                status: row.get(5)?,
                error_kind: row.get(6)?,
                error_code: row.get(7)?,
                retryable: row.get::<_, Option<i64>>(8)?.map(|value| value == 1),
                started_at: row.get(9)?,
                completed_at: row.get(10)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(operation)
}

fn parse_ids(value: &str) -> Result<Vec<String>, rusqlite::Error> {
    serde_json::from_str(value).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(error))
    })
}

fn validate_begin(command: &NpcTimelineBegin) -> Result<(), CampaignStoreError> {
    validate_id(&command.id)?;
    validate_id(&command.operation_id)?;
    validate_scope(&command.campaign_id, &command.scope_kind, &command.scope_id)?;
    validate_id(&command.attempt_id)?;
    validate_text(&command.player_intent, 4_000)?;
    if command.addressed_npc_id.as_deref().is_some_and(invalid_id)
        || command.hard_result_key.as_deref().is_some_and(invalid_id)
        || command.request_ids.is_empty()
        || command.request_ids.len() > 6
        || command.request_ids.len() != command.generation_record_ids.len()
        || command.request_ids.len() != command.idempotency_keys.len()
    {
        return Err(CampaignStoreError::InvalidData);
    }
    for values in [
        &command.request_ids,
        &command.generation_record_ids,
        &command.idempotency_keys,
    ] {
        if values.iter().any(|id| invalid_id(id))
            || values.iter().collect::<HashSet<_>>().len() != values.len()
        {
            return Err(CampaignStoreError::InvalidData);
        }
    }
    Ok(())
}

fn validate_replay(
    existing: &NpcTimelineOperation,
    command: &NpcTimelineBegin,
) -> Result<(), CampaignStoreError> {
    if existing.id != command.id
        || existing.campaign_id != command.campaign_id
        || existing.scope_kind != command.scope_kind
        || existing.scope_id != command.scope_id
        || existing.player_intent != command.player_intent
        || existing.addressed_npc_id != command.addressed_npc_id
        || existing.hard_result_key != command.hard_result_key
    {
        return Err(CampaignStoreError::InvalidState);
    }
    Ok(())
}

fn validate_scope(
    campaign_id: &str,
    scope_kind: &str,
    scope_id: &str,
) -> Result<(), CampaignStoreError> {
    validate_id(campaign_id)?;
    validate_id(scope_id)?;
    if !matches!(scope_kind, "NPC_DIALOGUE" | "TAVERN_SCENE") {
        return Err(CampaignStoreError::InvalidData);
    }
    Ok(())
}

fn validate_failure(kind: &str, code: &str) -> Result<(), CampaignStoreError> {
    if !ERROR_KINDS.contains(&kind)
        || code.len() < 2
        || code.len() > 64
        || !code
            .bytes()
            .all(|byte| byte.is_ascii_uppercase() || byte.is_ascii_digit() || byte == b'_')
    {
        return Err(CampaignStoreError::InvalidData);
    }
    Ok(())
}

fn retryable_failure(kind: &str, code: &str) -> bool {
    code == "APP_INTERRUPTED"
        || code == "FACT_CONFLICT"
        || kind == "PROVIDER" && matches!(code, "RATE_LIMITED" | "PROVIDER_UNAVAILABLE")
        || kind == "NETWORK" && matches!(code, "TIMEOUT" | "NETWORK_FAILED")
        || kind == "VALIDATION"
            && (matches!(
                code,
                "INVALID_OUTPUT" | "REPETITION_DETECTED" | "SCHEMA_VALIDATION_FAILED"
            ) || code.starts_with("SCHEMA_"))
}

fn validate_text(value: &str, max: usize) -> Result<(), CampaignStoreError> {
    if value.trim().is_empty() || value.trim() != value || value.chars().count() > max {
        Err(CampaignStoreError::InvalidData)
    } else {
        Ok(())
    }
}

fn invalid_id(value: &str) -> bool {
    value.trim().is_empty() || value.trim() != value || value.len() > 200
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn crash_recovery_preserves_locked_intent_and_hard_result() {
        let directory = tempfile::tempdir().expect("temp directory");
        let store = CampaignStore::open(directory.path().join("ember-tavern.sqlite"))
            .expect("open database");
        seed_scope(&store);

        let first = store
            .begin_npc_timeline_attempt(begin("attempt-1", "request-1", "Ask the keeper."))
            .expect("begin timeline");
        assert_eq!(first.status, "PENDING");
        assert_eq!(first.hard_result_key.as_deref(), Some("d20-result-17"));

        let recovered = store
            .begin_npc_timeline_attempt(begin("attempt-2", "request-2", "Ask the keeper."))
            .expect("recover interrupted attempt");
        assert_eq!(recovered.attempts.len(), 2);
        assert_eq!(
            recovered.attempts[0].error_code.as_deref(),
            Some("APP_INTERRUPTED")
        );
        assert_eq!(recovered.attempts[0].retryable, Some(true));
        assert_eq!(recovered.attempts[1].status, "STARTED");

        let failed = store
            .fail_npc_timeline_attempt(NpcTimelineFail {
                campaign_id: "campaign-timeline".to_owned(),
                operation_id: "timeline-operation".to_owned(),
                attempt_id: "attempt-2".to_owned(),
                error_kind: "NETWORK".to_owned(),
                error_code: "TIMEOUT".to_owned(),
            })
            .expect("record retryable failure");
        assert_eq!(failed.status, "FAILED_RETRYABLE");

        assert!(matches!(
            store.begin_npc_timeline_attempt(begin(
                "attempt-mutated",
                "request-mutated",
                "Change the locked question."
            )),
            Err(CampaignStoreError::InvalidState)
        ));
        let retry = store
            .begin_npc_timeline_attempt(begin("attempt-3", "request-3", "Ask the keeper."))
            .expect("retry exact intent");
        assert_eq!(retry.id, first.id);
        assert_eq!(retry.hard_result_key, first.hard_result_key);
        assert_eq!(retry.attempts.len(), 3);
    }

    #[test]
    fn native_policy_seals_non_technical_failures() {
        let directory = tempfile::tempdir().expect("temp directory");
        let store = CampaignStore::open(directory.path().join("ember-tavern.sqlite"))
            .expect("open database");
        seed_scope(&store);
        store
            .begin_npc_timeline_attempt(begin("attempt-1", "request-1", "Ask the keeper."))
            .expect("begin timeline");
        let failed = store
            .fail_npc_timeline_attempt(NpcTimelineFail {
                campaign_id: "campaign-timeline".to_owned(),
                operation_id: "timeline-operation".to_owned(),
                attempt_id: "attempt-1".to_owned(),
                error_kind: "PROVIDER".to_owned(),
                error_code: "AUTHENTICATION_FAILED".to_owned(),
            })
            .expect("record final failure");
        assert_eq!(failed.status, "FAILED_FINAL");
        assert_eq!(failed.attempts[0].retryable, Some(false));
        assert!(matches!(
            store.begin_npc_timeline_attempt(begin("attempt-2", "request-2", "Ask the keeper.")),
            Err(CampaignStoreError::InvalidState)
        ));
    }

    fn seed_scope(store: &CampaignStore) {
        store
            .create_at(
                "campaign-timeline".to_owned(),
                "2026-08-24T01:00:00.000Z".to_owned(),
            )
            .expect("create campaign");
        let connection = store.connect().expect("connect");
        connection
            .execute_batch(
                r#"INSERT INTO world_constitutions(
                   campaign_id,schema_version,revision,status,world_type,era,technology,magic,
                   peoples_json,society,politics,economy,combat_scale,death_rules,career_rules,
                   equipment_rules,npc_rules,trait_rules,taboos_json,created_at,updated_at,locked_at
                 ) VALUES(
                   'campaign-timeline',1,1,'LOCKED','Fantasy','Late medieval','Steel','Rare',
                   '[]','Guilds','Council','Coin','Personal','Final','Open','Grounded','Persistent',
                   'Balanced','[]','2026-08-24T01:00:00.000Z','2026-08-24T01:00:00.000Z',
                   '2026-08-24T01:00:00.000Z'
                 );
                 INSERT INTO npc_lod_profiles(
                   id,campaign_id,schema_version,constitution_revision,lod,revision,profile_json,
                   generation_record_id,created_at,updated_at
                 ) VALUES(
                   'npc-keeper','campaign-timeline',1,1,1,1,
                   '{"kind":"NPC_LOD_PROFILE","schemaVersion":1,"id":"npc-keeper","campaignId":"campaign-timeline","constitutionRevision":1,"lod":1,"revision":1,"generationRecordId":null,"createdAt":"2026-08-24T01:00:00.000Z","updatedAt":"2026-08-24T01:00:00.000Z"}',
                   NULL,'2026-08-24T01:00:00.000Z','2026-08-24T01:00:00.000Z'
                 );"#,
            )
            .expect("seed timeline scope");
    }

    fn begin(attempt: &str, request: &str, intent: &str) -> NpcTimelineBegin {
        NpcTimelineBegin {
            id: "timeline-id".to_owned(),
            operation_id: "timeline-operation".to_owned(),
            campaign_id: "campaign-timeline".to_owned(),
            scope_kind: "NPC_DIALOGUE".to_owned(),
            scope_id: "npc-keeper".to_owned(),
            player_intent: intent.to_owned(),
            addressed_npc_id: Some("npc-keeper".to_owned()),
            hard_result_key: Some("d20-result-17".to_owned()),
            attempt_id: attempt.to_owned(),
            request_ids: vec![request.to_owned()],
            generation_record_ids: vec![format!("generation-{request}")],
            idempotency_keys: vec!["stable-idempotency-key".to_owned()],
        }
    }
}

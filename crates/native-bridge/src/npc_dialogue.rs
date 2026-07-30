use rusqlite::{Connection, OptionalExtension, Transaction, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use uuid::Uuid;

use crate::{
    CampaignStore, CampaignStoreError, TavernGenerationAudit, current_timestamp, validate_id,
};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DialogueNpcView {
    pub id: String,
    pub name: String,
    pub identity: String,
    pub appearance: String,
    pub personality: String,
    pub current_mood: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DialogueRelationshipView {
    pub trust: i64,
    pub closeness: i64,
    pub awe: i64,
    pub obligation: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DialogueMessageView {
    pub id: String,
    pub sequence_number: i64,
    pub role: String,
    pub content: String,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NpcDialogueSnapshot {
    pub campaign_id: String,
    pub conversation_id: Option<String>,
    pub npc: DialogueNpcView,
    pub relationship: DialogueRelationshipView,
    pub messages: Vec<DialogueMessageView>,
    pub suggested_topics: Vec<String>,
    pub generation_context: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NpcDialogueCommit {
    pub campaign_id: String,
    pub npc_id: String,
    pub player_message: String,
    pub generation: TavernGenerationAudit,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct NpcReplyOutput {
    reply: String,
    mood: String,
    suggested_topics: Vec<String>,
    memory_candidate: Option<String>,
    relationship_proposal: RelationshipProposal,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RelationshipProposal {
    trust: Option<i64>,
    closeness: Option<i64>,
    awe: Option<i64>,
    obligation: Option<i64>,
}

#[derive(Debug)]
struct DialogueNpcContext {
    view: DialogueNpcView,
    goal: String,
    secret: String,
    speech_style: String,
    current_status: String,
    memories_json: String,
}

impl CampaignStore {
    pub fn npc_dialogue_snapshot(
        &self,
        campaign_id: &str,
        npc_id: &str,
    ) -> Result<NpcDialogueSnapshot, CampaignStoreError> {
        validate_id(campaign_id)?;
        validate_id(npc_id)?;
        let connection = self.connect()?;
        load_snapshot(&connection, campaign_id, npc_id)
    }

    pub fn commit_npc_dialogue(
        &self,
        command: NpcDialogueCommit,
    ) -> Result<NpcDialogueSnapshot, CampaignStoreError> {
        validate_id(&command.campaign_id)?;
        validate_id(&command.npc_id)?;
        validate_text(&command.player_message, 4_000)?;
        validate_audit(&command.generation)?;
        let output: NpcReplyOutput =
            serde_json::from_value(command.generation.validated_output.clone())
                .map_err(|_| CampaignStoreError::InvalidData)?;
        validate_output(&output)?;

        let mut connection = self.connect()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        if replayed(
            &transaction,
            &command.generation.idempotency_key,
            &command.campaign_id,
            &command.npc_id,
        )? {
            let result = load_snapshot(&transaction, &command.campaign_id, &command.npc_id)?;
            transaction.commit()?;
            return Ok(result);
        }
        let expected_context =
            load_generation_context(&transaction, &command.campaign_id, &command.npc_id)?;
        let mut expected_input = expected_context.clone();
        expected_input
            .as_object_mut()
            .ok_or(CampaignStoreError::InvalidData)?
            .insert(
                "playerMessage".to_owned(),
                Value::String(command.player_message.clone()),
            );
        if command.generation.input != expected_input
            || command.generation.context != json!({ "npcId": command.npc_id })
        {
            return Err(CampaignStoreError::InvalidData);
        }

        let relationship = load_relationship(&transaction, &command.npc_id)?;
        let next_relationship = DialogueRelationshipView {
            trust: next_score(relationship.trust, output.relationship_proposal.trust)?,
            closeness: next_score(
                relationship.closeness,
                output.relationship_proposal.closeness,
            )?,
            awe: next_score(relationship.awe, output.relationship_proposal.awe)?,
            obligation: next_score(
                relationship.obligation,
                output.relationship_proposal.obligation,
            )?,
        };
        let at = current_timestamp()?;
        let conversation_id = conversation_id(&transaction, &command.campaign_id, &command.npc_id)?
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        transaction.execute(
            "INSERT OR IGNORE INTO conversations (
               id, campaign_id, kind, npc_id, adventure_id, created_at, updated_at
             ) VALUES (?1, ?2, 'NPC', ?3, NULL, ?4, ?4)",
            params![conversation_id, command.campaign_id, command.npc_id, at],
        )?;
        let next_sequence: i64 = transaction.query_row(
            "SELECT COALESCE(MAX(sequence_number), 0) + 1 FROM messages
             WHERE conversation_id = ?1",
            [&conversation_id],
            |row| row.get(0),
        )?;
        insert_generation(&transaction, &command.campaign_id, &command.generation, &at)?;
        transaction.execute(
            "INSERT INTO messages (
               id, conversation_id, sequence_number, role, speaker_npc_id,
               content, generation_record_id, created_at
             ) VALUES (?1, ?2, ?3, 'PLAYER', NULL, ?4, NULL, ?5)",
            params![
                Uuid::new_v4().to_string(),
                conversation_id,
                next_sequence,
                command.player_message,
                at,
            ],
        )?;
        transaction.execute(
            "INSERT INTO messages (
               id, conversation_id, sequence_number, role, speaker_npc_id,
               content, generation_record_id, created_at
             ) VALUES (?1, ?2, ?3, 'NPC', ?4, ?5, ?6, ?7)",
            params![
                Uuid::new_v4().to_string(),
                conversation_id,
                next_sequence + 1,
                command.npc_id,
                output.reply,
                command.generation.generation_record_id,
                at,
            ],
        )?;
        transaction.execute(
            "UPDATE conversations SET updated_at = ?1 WHERE id = ?2",
            params![at, conversation_id],
        )?;
        transaction.execute(
            "UPDATE npcs SET current_mood = ?1, updated_at = ?2
             WHERE id = ?3 AND campaign_id = ?4 AND current_status = 'ACTIVE'",
            params![output.mood, at, command.npc_id, command.campaign_id],
        )?;
        transaction.execute(
            "UPDATE npc_relationships
             SET trust = ?1, closeness = ?2, awe = ?3, obligation = ?4, updated_at = ?5
             WHERE npc_id = ?6",
            params![
                next_relationship.trust,
                next_relationship.closeness,
                next_relationship.awe,
                next_relationship.obligation,
                at,
                command.npc_id,
            ],
        )?;
        transaction.commit()?;
        self.npc_dialogue_snapshot(&command.campaign_id, &command.npc_id)
    }
}

fn load_snapshot(
    connection: &Connection,
    campaign_id: &str,
    npc_id: &str,
) -> Result<NpcDialogueSnapshot, CampaignStoreError> {
    let generation_context = load_generation_context(connection, campaign_id, npc_id)?;
    let npc = load_npc(connection, campaign_id, npc_id)?.view;
    let relationship = load_relationship(connection, npc_id)?;
    let conversation_id = conversation_id(connection, campaign_id, npc_id)?;
    let messages = match &conversation_id {
        Some(id) => load_messages(connection, id)?,
        None => Vec::new(),
    };
    let suggested_topics = match &conversation_id {
        Some(id) => load_suggested_topics(connection, id)?,
        None => Vec::new(),
    };
    Ok(NpcDialogueSnapshot {
        campaign_id: campaign_id.to_owned(),
        conversation_id,
        npc,
        relationship,
        messages,
        suggested_topics,
        generation_context,
    })
}

fn load_generation_context(
    connection: &Connection,
    campaign_id: &str,
    npc_id: &str,
) -> Result<Value, CampaignStoreError> {
    let state: String = connection
        .query_row(
            "SELECT state FROM campaigns WHERE id = ?1",
            [campaign_id],
            |row| row.get(0),
        )
        .optional()?
        .ok_or(CampaignStoreError::NotFound)?;
    if state != "TAVERN" {
        return Err(CampaignStoreError::InvalidState);
    }
    let (world_summary, current_region): (String, String) = connection
        .query_row(
            "SELECT summary, current_region FROM world_bibles WHERE campaign_id = ?1",
            [campaign_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?
        .ok_or(CampaignStoreError::InvalidData)?;
    let npc = load_npc(connection, campaign_id, npc_id)?;
    if npc.current_status != "ACTIVE" {
        return Err(CampaignStoreError::InvalidState);
    }
    let relationship = load_relationship(connection, npc_id)?;
    let (known, suspected, false_beliefs, excluded): (String, String, String, String) = connection
        .query_row(
            "SELECT known_fact_ids_json, suspected_fact_ids_json,
                    false_belief_fact_ids_json, excluded_secret_fact_ids_json
             FROM npc_knowledge WHERE npc_id = ?1",
            [npc_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .optional()?
        .ok_or(CampaignStoreError::InvalidData)?;
    let excluded = id_list(&excluded)?;
    let known_facts = fact_statements(connection, campaign_id, &id_list(&known)?, &excluded)?;
    let suspected_facts =
        fact_statements(connection, campaign_id, &id_list(&suspected)?, &excluded)?;
    let false_beliefs = fact_statements(
        connection,
        campaign_id,
        &id_list(&false_beliefs)?,
        &excluded,
    )?;
    let recent_messages = match conversation_id(connection, campaign_id, npc_id)? {
        Some(id) => load_messages(connection, &id)?
            .into_iter()
            .rev()
            .take(12)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .map(|message| json!({ "role": message.role, "content": message.content }))
            .collect(),
        None => Vec::new(),
    };
    let memories_value: Value =
        serde_json::from_str(&npc.memories_json).map_err(|_| CampaignStoreError::InvalidData)?;
    let long_term_memories = memories_value
        .as_array()
        .ok_or(CampaignStoreError::InvalidData)?
        .iter()
        .filter_map(|memory| {
            memory
                .as_object()
                .and_then(|record| record.get("summary"))
                .and_then(Value::as_str)
                .map(str::to_owned)
        })
        .rev()
        .take(8)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<Vec<_>>();
    Ok(json!({
        "worldSummary": world_summary,
        "currentRegion": current_region,
        "npc": {
            "id": npc.view.id,
            "name": npc.view.name,
            "identity": npc.view.identity,
            "personality": npc.view.personality,
            "goal": npc.goal,
            "currentMood": npc.view.current_mood,
            "appearance": npc.view.appearance,
            "secret": npc.secret,
            "speechStyle": npc.speech_style,
            "currentStatus": npc.current_status,
        },
        "relationship": relationship,
        "knownFacts": known_facts,
        "suspectedFacts": suspected_facts,
        "falseBeliefs": false_beliefs,
        "recentMessages": recent_messages,
        "longTermMemories": long_term_memories,
    }))
}

fn load_npc(
    connection: &Connection,
    campaign_id: &str,
    npc_id: &str,
) -> Result<DialogueNpcContext, CampaignStoreError> {
    connection
        .query_row(
            "SELECT id, name, identity, appearance, personality, current_mood,
                    goal, secret, speech_style, current_status, memories_json
             FROM npcs WHERE id = ?1 AND campaign_id = ?2",
            params![npc_id, campaign_id],
            |row| {
                Ok(DialogueNpcContext {
                    view: DialogueNpcView {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        identity: row.get(2)?,
                        appearance: row.get(3)?,
                        personality: row.get(4)?,
                        current_mood: row.get(5)?,
                    },
                    goal: row.get(6)?,
                    secret: row.get(7)?,
                    speech_style: row.get(8)?,
                    current_status: row.get(9)?,
                    memories_json: row.get(10)?,
                })
            },
        )
        .optional()?
        .ok_or(CampaignStoreError::NotFound)
}

fn load_relationship(
    connection: &Connection,
    npc_id: &str,
) -> Result<DialogueRelationshipView, CampaignStoreError> {
    connection
        .query_row(
            "SELECT trust, closeness, awe, obligation FROM npc_relationships WHERE npc_id = ?1",
            [npc_id],
            |row| {
                Ok(DialogueRelationshipView {
                    trust: row.get(0)?,
                    closeness: row.get(1)?,
                    awe: row.get(2)?,
                    obligation: row.get(3)?,
                })
            },
        )
        .optional()?
        .ok_or(CampaignStoreError::InvalidData)
}

fn conversation_id(
    connection: &Connection,
    campaign_id: &str,
    npc_id: &str,
) -> Result<Option<String>, CampaignStoreError> {
    connection
        .query_row(
            "SELECT id FROM conversations
             WHERE campaign_id = ?1 AND kind = 'NPC' AND npc_id = ?2
             ORDER BY created_at, id LIMIT 1",
            params![campaign_id, npc_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(Into::into)
}

fn load_messages(
    connection: &Connection,
    conversation_id: &str,
) -> Result<Vec<DialogueMessageView>, CampaignStoreError> {
    let mut statement = connection.prepare(
        "SELECT id, sequence_number, role, content, created_at
         FROM messages WHERE conversation_id = ?1 ORDER BY sequence_number",
    )?;
    Ok(statement
        .query_map([conversation_id], |row| {
            Ok(DialogueMessageView {
                id: row.get(0)?,
                sequence_number: row.get(1)?,
                role: row.get(2)?,
                content: row.get(3)?,
                created_at: row.get(4)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?)
}

fn load_suggested_topics(
    connection: &Connection,
    conversation_id: &str,
) -> Result<Vec<String>, CampaignStoreError> {
    let output = connection
        .query_row(
            "SELECT g.validated_output_json
             FROM messages m
             JOIN generation_records g ON g.id = m.generation_record_id
             WHERE m.conversation_id = ?1 AND m.role = 'NPC'
             ORDER BY m.sequence_number DESC LIMIT 1",
            [conversation_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    match output {
        None => Ok(Vec::new()),
        Some(value) => {
            let parsed: NpcReplyOutput =
                serde_json::from_str(&value).map_err(|_| CampaignStoreError::InvalidData)?;
            validate_output(&parsed)?;
            Ok(parsed.suggested_topics)
        }
    }
}

fn fact_statements(
    connection: &Connection,
    campaign_id: &str,
    ids: &[String],
    excluded: &[String],
) -> Result<Vec<String>, CampaignStoreError> {
    let mut statements = Vec::new();
    for id in ids {
        if excluded.contains(id) {
            continue;
        }
        if let Some(statement) = connection
            .query_row(
                "SELECT statement FROM world_facts WHERE id = ?1 AND campaign_id = ?2",
                params![id, campaign_id],
                |row| row.get(0),
            )
            .optional()?
        {
            statements.push(statement);
        }
    }
    Ok(statements)
}

fn id_list(value: &str) -> Result<Vec<String>, CampaignStoreError> {
    serde_json::from_str(value).map_err(|_| CampaignStoreError::InvalidData)
}

fn validate_audit(audit: &TavernGenerationAudit) -> Result<(), CampaignStoreError> {
    validate_id(&audit.request_id)?;
    validate_id(&audit.generation_record_id)?;
    validate_id(&audit.idempotency_key)?;
    let raw: Value = serde_json::from_str(&audit.raw_response_text)
        .map_err(|_| CampaignStoreError::InvalidData)?;
    if audit.prompt_version < 1
        || !audit.input.is_object()
        || audit
            .request
            .as_object()
            .and_then(|request| request.get("task"))
            .and_then(Value::as_str)
            != Some("NPC_REPLY")
        || raw != audit.validated_output
    {
        return Err(CampaignStoreError::InvalidData);
    }
    Ok(())
}

fn validate_output(output: &NpcReplyOutput) -> Result<(), CampaignStoreError> {
    validate_text(&output.reply, 4_000)?;
    validate_text(&output.mood, 200)?;
    if output.suggested_topics.len() > 5 {
        return Err(CampaignStoreError::InvalidData);
    }
    for topic in &output.suggested_topics {
        validate_text(topic, 4_000)?;
    }
    if let Some(memory) = &output.memory_candidate {
        validate_text(memory, 4_000)?;
    }
    for proposal in [
        output.relationship_proposal.trust,
        output.relationship_proposal.closeness,
        output.relationship_proposal.awe,
        output.relationship_proposal.obligation,
    ]
    .into_iter()
    .flatten()
    {
        if !(-1..=1).contains(&proposal) {
            return Err(CampaignStoreError::InvalidData);
        }
    }
    Ok(())
}

fn validate_text(value: &str, max: usize) -> Result<(), CampaignStoreError> {
    if value.is_empty() || value.trim() != value || value.chars().count() > max {
        Err(CampaignStoreError::InvalidData)
    } else {
        Ok(())
    }
}

fn next_score(current: i64, proposal: Option<i64>) -> Result<i64, CampaignStoreError> {
    let next = current + proposal.unwrap_or(0);
    if (-5..=5).contains(&next) {
        Ok(next)
    } else {
        Err(CampaignStoreError::InvalidData)
    }
}

fn insert_generation(
    transaction: &Transaction<'_>,
    campaign_id: &str,
    audit: &TavernGenerationAudit,
    at: &str,
) -> Result<(), CampaignStoreError> {
    transaction.execute(
        "INSERT INTO pending_ai_requests (
           id, campaign_id, turn_id, idempotency_key, task, status, model_profile_id,
           input_json, context_json, attempt_count, last_error_json, created_at, updated_at
         ) VALUES (?1, ?2, NULL, ?3, 'NPC_REPLY', 'COMMITTED', NULL, ?4, ?5, 1, NULL, ?6, ?6)",
        params![
            audit.request_id,
            campaign_id,
            audit.idempotency_key,
            audit.input.to_string(),
            audit.context.to_string(),
            at,
        ],
    )?;
    transaction.execute(
        "INSERT INTO generation_records (
           id, campaign_id, request_id, task, model_profile_id, prompt_version,
           request_json, raw_response_text, validated_output_json,
           validation_error_json, started_at, completed_at
         ) VALUES (?1, ?2, ?3, 'NPC_REPLY', NULL, ?4, ?5, ?6, ?7, NULL, ?8, ?8)",
        params![
            audit.generation_record_id,
            campaign_id,
            audit.request_id,
            audit.prompt_version,
            audit.request.to_string(),
            audit.raw_response_text,
            audit.validated_output.to_string(),
            at,
        ],
    )?;
    Ok(())
}

fn replayed(
    connection: &Connection,
    idempotency_key: &str,
    campaign_id: &str,
    npc_id: &str,
) -> Result<bool, CampaignStoreError> {
    let prior = connection
        .query_row(
            "SELECT campaign_id, task, status, input_json FROM pending_ai_requests
             WHERE idempotency_key = ?1",
            [idempotency_key],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                ))
            },
        )
        .optional()?;
    match prior {
        None => Ok(false),
        Some((stored_campaign, task, status, input))
            if stored_campaign == campaign_id
                && task == "NPC_REPLY"
                && status == "COMMITTED"
                && serde_json::from_str::<Value>(&input)
                    .ok()
                    .and_then(|value| value.get("npc")?.get("id")?.as_str().map(str::to_owned))
                    .as_deref()
                    == Some(npc_id) =>
        {
            Ok(true)
        }
        Some(_) => Err(CampaignStoreError::InvalidState),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn consecutive_dialogue_survives_reopen_with_order_and_relationship() {
        let directory = tempfile::tempdir().expect("temp directory");
        let database_path = directory.path().join("ember-tavern.sqlite");
        let store = CampaignStore::open(&database_path).expect("open database");
        seed_dialogue(&store);

        let initial = store
            .npc_dialogue_snapshot("campaign-dialogue", "npc-owner")
            .expect("initial dialogue");
        assert!(initial.messages.is_empty());
        let first = store
            .commit_npc_dialogue(command(&initial, 1, "Show me the cellar."))
            .expect("first reply");
        assert_eq!(first.messages.len(), 2);
        assert_eq!(first.relationship.trust, 1);
        drop(store);

        let reopened = CampaignStore::open(&database_path).expect("reopen database");
        let restored = reopened
            .npc_dialogue_snapshot("campaign-dialogue", "npc-owner")
            .expect("restore first reply");
        assert_eq!(restored.suggested_topics, vec!["The old tunnel"]);
        let second = reopened
            .commit_npc_dialogue(command(&restored, 2, "What is warm down there?"))
            .expect("second reply");
        assert_eq!(
            second
                .messages
                .iter()
                .map(|message| message.sequence_number)
                .collect::<Vec<_>>(),
            vec![1, 2, 3, 4]
        );
        assert_eq!(second.relationship.trust, 2);
        assert_eq!(second.npc.current_mood, "Wary");
    }

    #[test]
    fn rejects_tampered_generation_context_without_partial_writes() {
        let directory = tempfile::tempdir().expect("temp directory");
        let store =
            CampaignStore::open(directory.path().join("ember-tavern.sqlite")).expect("open");
        seed_dialogue(&store);
        let snapshot = store
            .npc_dialogue_snapshot("campaign-dialogue", "npc-owner")
            .expect("snapshot");
        let mut invalid = command(&snapshot, 1, "Hello.");
        invalid.generation.input["knownFacts"] = json!(["A fabricated fact."]);

        assert!(matches!(
            store.commit_npc_dialogue(invalid),
            Err(CampaignStoreError::InvalidData)
        ));
        let after = store
            .npc_dialogue_snapshot("campaign-dialogue", "npc-owner")
            .expect("unchanged snapshot");
        assert!(after.messages.is_empty());
        assert_eq!(after.relationship.trust, 0);
    }

    fn seed_dialogue(store: &CampaignStore) {
        let connection = store.connect().expect("connect");
        connection
            .execute_batch(
                "INSERT INTO campaigns (
                   id, schema_version, state, resume_state, created_at, updated_at
                 ) VALUES (
                   'campaign-dialogue', 1, 'TAVERN', NULL,
                   '2026-07-31T05:00:00.000Z', '2026-07-31T05:00:00.000Z'
                 );
                 INSERT INTO world_bibles (
                   campaign_id, schema_version, name, current_region, summary, core_conflict,
                   technology_level, power_rules_json, factions_json, locations_json,
                   narrative_style, forbidden_elements_json, tavern_reason, story_hooks_json,
                   locked_fields_json, created_at, updated_at
                 ) VALUES (
                   'campaign-dialogue', 1, 'Ember Coast', 'Ash Harbor',
                   'A storm-bound coast.', 'The beacon is fading.', 'Late medieval',
                   '[\"Magic leaves warmth.\"]', '[]', '[]', 'Grounded', '[]',
                   'Travelers gather here.', '[]', '[]',
                   '2026-07-31T05:00:00.000Z', '2026-07-31T05:00:00.000Z'
                 );
                 INSERT INTO player_characters (
                   id, campaign_id, name, gender, age, concept, story_preferences_json,
                   content_boundaries_json, class_archetype, class_display_name,
                   attributes_json, traits_json, personal_goal, background_json,
                   initial_equipment_ids_json, created_at, updated_at
                 ) VALUES (
                   'character-player', 'campaign-dialogue', 'Mara', NULL, NULL, 'Scout',
                   '[]', '[]', 'ROGUE', 'Scout',
                   '{\"strength\":1,\"agility\":2,\"knowledge\":2,\"insight\":1,\"charm\":1,\"willpower\":1}',
                   '[]', 'Find the road.', '{}', '[]',
                   '2026-07-31T05:00:00.000Z', '2026-07-31T05:00:00.000Z'
                 );
                 INSERT INTO taverns (
                   id, campaign_id, location_id, name, position, environment,
                   special_rules_json, long_term_problem, owner_npc_id, changes_json,
                   created_at, updated_at
                 ) VALUES (
                   'tavern-rest', 'campaign-dialogue', 'location-harbor', 'Ember Rest',
                   'Crossroads', 'Warm stone hall.', '[]', 'Cellar light.', NULL, '[]',
                   '2026-07-31T05:00:00.000Z', '2026-07-31T05:00:00.000Z'
                 );
                 INSERT INTO npcs (
                   id, campaign_id, tavern_id, residency, name, identity, appearance,
                   personality, goal, secret, speech_style, current_mood, current_status,
                   visit_json, memories_json, created_at, updated_at
                 ) VALUES (
                   'npc-owner', 'campaign-dialogue', 'tavern-rest', 'OWNER', 'Ilyra Venn',
                   'Innkeeper', 'A weathered red coat.', 'Practical and observant.',
                   'Keep the road open.', 'A tunnel reaches the lighthouse.',
                   'Measured statements.', 'Concerned', 'ACTIVE', NULL, '[]',
                   '2026-07-31T05:00:00.000Z', '2026-07-31T05:00:00.000Z'
                 );
                 UPDATE taverns SET owner_npc_id = 'npc-owner' WHERE id = 'tavern-rest';
                 INSERT INTO world_facts (
                   id, campaign_id, kind, statement, faction_ids_json, detail_json, created_at
                 ) VALUES (
                   'fact-known', 'campaign-dialogue', 'DEVELOPING_FACT',
                   'The cellar door is warm.', '[]', '{}', '2026-07-31T05:00:00.000Z'
                 );
                 INSERT INTO npc_knowledge (
                   npc_id, known_fact_ids_json, suspected_fact_ids_json,
                   false_belief_fact_ids_json, excluded_secret_fact_ids_json, updated_at
                 ) VALUES (
                   'npc-owner', '[\"fact-known\"]', '[]', '[]', '[]',
                   '2026-07-31T05:00:00.000Z'
                 );
                 INSERT INTO npc_relationships (
                   npc_id, player_character_id, trust, closeness, awe, obligation, updated_at
                 ) VALUES (
                   'npc-owner', 'character-player', 0, 0, 0, 0,
                   '2026-07-31T05:00:00.000Z'
                 );",
            )
            .expect("seed dialogue");
    }

    fn command(
        snapshot: &NpcDialogueSnapshot,
        index: usize,
        player_message: &str,
    ) -> NpcDialogueCommit {
        let output = json!({
            "reply": "Stay close and touch nothing warm.",
            "mood": "Wary",
            "suggestedTopics": ["The old tunnel"],
            "memoryCandidate": null,
            "relationshipProposal": { "trust": 1 }
        });
        let mut input = snapshot.generation_context.clone();
        input
            .as_object_mut()
            .expect("context object")
            .insert("playerMessage".to_owned(), json!(player_message));
        NpcDialogueCommit {
            campaign_id: "campaign-dialogue".to_owned(),
            npc_id: "npc-owner".to_owned(),
            player_message: player_message.to_owned(),
            generation: TavernGenerationAudit {
                request_id: format!("dialogue-request-{index}"),
                generation_record_id: format!("dialogue-generation-{index}"),
                idempotency_key: format!("dialogue-key-{index}"),
                prompt_version: 1,
                input,
                context: json!({ "npcId": "npc-owner" }),
                request: json!({ "task": "NPC_REPLY" }),
                raw_response_text: output.to_string(),
                validated_output: output,
            },
        }
    }
}

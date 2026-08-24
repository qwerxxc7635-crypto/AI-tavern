use rusqlite::{Connection, OptionalExtension, Transaction, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use uuid::Uuid;

use crate::{
    CampaignStore, CampaignStoreError, TavernGenerationAudit, current_timestamp,
    repetition::{find_repeated_phrase, find_repeated_phrase_against},
    validate_id,
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
    #[serde(default)]
    pub timeline_submission_id: Option<String>,
    #[serde(default)]
    pub timeline_attempt_id: Option<String>,
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
            return Err(if command.timeline_submission_id.is_some() {
                CampaignStoreError::FactConflict
            } else {
                CampaignStoreError::InvalidData
            });
        }

        let prior_conversation_id =
            conversation_id(&transaction, &command.campaign_id, &command.npc_id)?;
        let prior_npc_messages = match &prior_conversation_id {
            None => Vec::new(),
            Some(id) => load_messages(&transaction, id)?
                .into_iter()
                .filter(|message| message.role == "NPC")
                .map(|message| message.content)
                .collect::<Vec<_>>(),
        };
        if find_repeated_phrase_against(
            std::iter::once(output.reply.as_str())
                .chain(output.suggested_topics.iter().map(String::as_str))
                .chain(output.memory_candidate.iter().map(String::as_str)),
            prior_npc_messages.iter().map(String::as_str),
        )
        .is_some()
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
        let conversation_id = prior_conversation_id.unwrap_or_else(|| Uuid::new_v4().to_string());
        let player_message_id = Uuid::new_v4().to_string();
        let npc_message_id = Uuid::new_v4().to_string();
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
                player_message_id,
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
                npc_message_id,
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
        match (
            command.timeline_submission_id.as_deref(),
            command.timeline_attempt_id.as_deref(),
        ) {
            (Some(submission_id), Some(attempt_id)) => crate::commit_npc_timeline(
                &transaction,
                submission_id,
                attempt_id,
                &npc_message_id,
                std::slice::from_ref(&command.generation.generation_record_id),
                &at,
            )?,
            (None, None) => {}
            _ => return Err(CampaignStoreError::InvalidData),
        }
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
    let authorized_knowledge = load_actor_knowledge_entries(connection, campaign_id, npc_id)?;
    let knowledge = if authorized_knowledge.is_empty() {
        load_legacy_npc_knowledge_entries(connection, campaign_id, npc_id)?
    } else {
        authorized_knowledge
    };
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
    let memories = memories_value
        .as_array()
        .ok_or(CampaignStoreError::InvalidData)?;
    let mut validated_memories = Vec::with_capacity(memories.len());
    for memory in memories {
        let record = memory.as_object().ok_or(CampaignStoreError::InvalidData)?;
        if record.get("npcId").and_then(Value::as_str) != Some(npc_id) {
            return Err(CampaignStoreError::InvalidData);
        }
        let summary = record
            .get("summary")
            .and_then(Value::as_str)
            .ok_or(CampaignStoreError::InvalidData)?;
        validate_text(summary, 4_000)?;
        validated_memories.push(summary.to_owned());
    }
    let authorized_memories = load_actor_memories(connection, campaign_id, npc_id)?;
    let memory_source = if authorized_memories.is_empty() {
        validated_memories
    } else {
        authorized_memories
    };
    let long_term_memories = memory_source
        .into_iter()
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
        "knowledge": knowledge,
        "recentMessages": recent_messages,
        "longTermMemories": long_term_memories,
    }))
}

fn load_actor_memories(
    connection: &Connection,
    campaign_id: &str,
    npc_id: &str,
) -> Result<Vec<String>, CampaignStoreError> {
    let mut statement = connection.prepare(
        "SELECT memory.summary FROM knowledge_memories memory
         WHERE memory.campaign_id = ?1 AND memory.actor_type = 'NPC' AND memory.actor_id = ?2
         AND EXISTS (
           SELECT 1 FROM memory_artifact_sources source
           WHERE source.artifact_kind='LONG_TERM' AND source.artifact_id=memory.id
         )
         AND NOT EXISTS (
           SELECT 1 FROM memory_artifact_sources source
           WHERE source.artifact_kind='LONG_TERM' AND source.artifact_id=memory.id AND (
             (source.source_kind='KNOWLEDGE' AND NOT EXISTS (
               SELECT 1 FROM actor_knowledge knowledge
               WHERE knowledge.id=source.source_id AND knowledge.campaign_id=memory.campaign_id
                 AND knowledge.actor_type=memory.actor_type AND knowledge.actor_id=memory.actor_id
                 AND knowledge.revision=source.source_revision
             )) OR
             (source.source_kind='GAME_EVENT' AND NOT EXISTS (
               SELECT 1 FROM game_events event
               WHERE event.id=source.source_id AND event.campaign_id=memory.campaign_id
                 AND event.schema_version=source.source_revision
             )) OR source.source_kind NOT IN ('KNOWLEDGE','GAME_EVENT')
           )
         )
         ORDER BY created_at, id LIMIT 129",
    )?;
    let memories = statement
        .query_map(params![campaign_id, npc_id], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    if memories.len() > 128
        || memories
            .iter()
            .any(|summary| validate_text(summary, 4_000).is_err())
    {
        return Err(CampaignStoreError::InvalidData);
    }
    Ok(memories)
}

fn load_legacy_npc_knowledge_entries(
    connection: &Connection,
    campaign_id: &str,
    npc_id: &str,
) -> Result<Vec<Value>, CampaignStoreError> {
    let (known, suspected, false_beliefs, excluded, provenance): (
        String,
        String,
        String,
        String,
        String,
    ) = connection
        .query_row(
            "SELECT known_fact_ids_json, suspected_fact_ids_json,
                    false_belief_fact_ids_json, excluded_secret_fact_ids_json, provenance_json
             FROM npc_knowledge WHERE npc_id = ?1",
            [npc_id],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                ))
            },
        )
        .optional()?
        .ok_or(CampaignStoreError::InvalidData)?;
    let excluded = id_list(&excluded)?;
    let known = id_list(&known)?;
    let suspected = id_list(&suspected)?;
    let false_beliefs = id_list(&false_beliefs)?;
    validate_knowledge_provenance(
        connection,
        campaign_id,
        npc_id,
        KnowledgeFactSets {
            known: &known,
            suspected: &suspected,
            false_beliefs: &false_beliefs,
            excluded: &excluded,
        },
        &provenance,
    )?;
    let mut used = std::collections::HashSet::new();
    let mut knowledge = knowledge_entries(
        connection,
        campaign_id,
        npc_id,
        &known,
        &excluded,
        "KNOWN",
        &mut used,
    )?;
    knowledge.extend(knowledge_entries(
        connection,
        campaign_id,
        npc_id,
        &suspected,
        &excluded,
        "SUSPECTED",
        &mut used,
    )?);
    knowledge.extend(knowledge_entries(
        connection,
        campaign_id,
        npc_id,
        &false_beliefs,
        &excluded,
        "BELIEVED",
        &mut used,
    )?);
    Ok(knowledge)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StoredKnowledgeProvenance {
    fact_id: String,
    state: String,
    source: String,
    event_id: Option<String>,
    learned_at: String,
    confidence: f64,
}

pub(crate) struct KnowledgeFactSets<'a> {
    pub(crate) known: &'a [String],
    pub(crate) suspected: &'a [String],
    pub(crate) false_beliefs: &'a [String],
    pub(crate) excluded: &'a [String],
}

pub(crate) fn validate_knowledge_provenance(
    connection: &Connection,
    campaign_id: &str,
    npc_id: &str,
    facts: KnowledgeFactSets<'_>,
    raw: &str,
) -> Result<(), CampaignStoreError> {
    let mut expected = std::collections::HashMap::new();
    for (ids, state) in [
        (facts.known, "KNOWN"),
        (facts.suspected, "SUSPECTED"),
        (facts.false_beliefs, "BELIEVED"),
    ] {
        for fact_id in ids {
            if expected.insert(fact_id.as_str(), state).is_some()
                || facts.excluded.contains(fact_id)
            {
                return Err(CampaignStoreError::InvalidData);
            }
        }
    }
    let entries: Vec<StoredKnowledgeProvenance> =
        serde_json::from_str(raw).map_err(|_| CampaignStoreError::InvalidData)?;
    if entries.len() != expected.len() {
        return Err(CampaignStoreError::InvalidData);
    }
    let mut seen = std::collections::HashSet::new();
    for entry in entries {
        if !seen.insert(entry.fact_id.clone())
            || expected.get(entry.fact_id.as_str()).copied() != Some(entry.state.as_str())
            || !entry.confidence.is_finite()
            || !(0.0..=1.0).contains(&entry.confidence)
            || time::OffsetDateTime::parse(
                &entry.learned_at,
                &time::format_description::well_known::Rfc3339,
            )
            .is_err()
            || !matches!(
                entry.source.as_str(),
                "LOCAL_RULE" | "OBSERVATION" | "COMMUNICATION" | "INFERENCE" | "IMPORT"
            )
            || (!matches!(entry.source.as_str(), "LOCAL_RULE" | "IMPORT")
                && entry.event_id.is_none())
        {
            return Err(CampaignStoreError::InvalidData);
        }
        if let Some(event_id) = entry.event_id {
            let exists = connection
                .query_row(
                    "SELECT 1 FROM game_events WHERE id = ?1 AND campaign_id = ?2",
                    params![event_id, campaign_id],
                    |_| Ok(()),
                )
                .optional()?
                .is_some();
            if !exists {
                return Err(CampaignStoreError::InvalidData);
            }
        }
    }
    let npc_exists = connection
        .query_row(
            "SELECT 1 FROM npcs WHERE id = ?1 AND campaign_id = ?2",
            params![npc_id, campaign_id],
            |_| Ok(()),
        )
        .optional()?
        .is_some();
    if !npc_exists {
        return Err(CampaignStoreError::InvalidData);
    }
    Ok(())
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

fn knowledge_entries(
    connection: &Connection,
    campaign_id: &str,
    npc_id: &str,
    ids: &[String],
    excluded: &[String],
    state: &str,
    used: &mut std::collections::HashSet<String>,
) -> Result<Vec<Value>, CampaignStoreError> {
    let mut entries = Vec::new();
    for id in ids {
        if excluded.contains(id) {
            continue;
        }
        if !used.insert(id.clone()) {
            return Err(CampaignStoreError::InvalidData);
        }
        if used.len() > 100 {
            return Err(CampaignStoreError::InvalidData);
        }
        let fact = connection
            .query_row(
                "SELECT kind, statement, detail_json FROM world_facts
                 WHERE id = ?1 AND campaign_id = ?2",
                params![id, campaign_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                    ))
                },
            )
            .optional()?
            .ok_or(CampaignStoreError::InvalidData)?;
        let (kind, statement, detail_json) = fact;
        if state == "BELIEVED" {
            let detail: Value =
                serde_json::from_str(&detail_json).map_err(|_| CampaignStoreError::InvalidData)?;
            let belongs_to_actor = detail
                .get("believedByNpcIds")
                .and_then(Value::as_array)
                .is_some_and(|ids| ids.iter().any(|value| value.as_str() == Some(npc_id)));
            if kind != "FALSE_BELIEF" || !belongs_to_actor {
                return Err(CampaignStoreError::InvalidData);
            }
        } else if kind == "FALSE_BELIEF" {
            return Err(CampaignStoreError::InvalidData);
        }
        if kind == "RUMOR" {
            let detail: Value =
                serde_json::from_str(&detail_json).map_err(|_| CampaignStoreError::InvalidData)?;
            let claim_id = detail
                .get("claimId")
                .and_then(Value::as_str)
                .ok_or(CampaignStoreError::InvalidData)?;
            validate_id(claim_id)?;
            let source_npc_id = detail
                .get("sourceNpcId")
                .and_then(Value::as_str)
                .ok_or(CampaignStoreError::InvalidData)?;
            let source_exists = connection
                .query_row(
                    "SELECT 1 FROM npcs WHERE id = ?1 AND campaign_id = ?2",
                    params![source_npc_id, campaign_id],
                    |_| Ok(()),
                )
                .optional()?
                .is_some();
            let valid_basis = detail
                .get("sourceBasis")
                .and_then(Value::as_str)
                .is_some_and(|basis| {
                    matches!(
                        basis,
                        "WITNESS" | "HEARSAY" | "PERSONAL_BELIEF" | "FACTION_MESSAGE"
                    )
                });
            let valid_confidence = detail
                .get("confidence")
                .and_then(Value::as_f64)
                .is_some_and(|value| value.is_finite() && (0.0..=1.0).contains(&value));
            let valid_revision = detail
                .get("claimRevision")
                .and_then(Value::as_i64)
                .is_some_and(|value| value >= 1);
            if !source_exists || !valid_basis || !valid_confidence || !valid_revision {
                return Err(CampaignStoreError::InvalidData);
            }
        }
        let target_kind = if state == "KNOWN" && kind != "RUMOR" {
            "TRUTH"
        } else {
            "CLAIM"
        };
        entries.push(json!({
            "targetKind": target_kind,
            "state": state,
            "statement": statement,
        }));
    }
    Ok(entries)
}

fn load_actor_knowledge_entries(
    connection: &Connection,
    campaign_id: &str,
    npc_id: &str,
) -> Result<Vec<Value>, CampaignStoreError> {
    let mut statement = connection.prepare(
        "SELECT knowledge.target_kind, knowledge.knowledge_state,
                CASE WHEN knowledge.target_kind = 'TRUTH' THEN truths.subject ELSE claims.subject END,
                CASE WHEN knowledge.target_kind = 'TRUTH' THEN truths.predicate ELSE claims.predicate END,
                CASE WHEN knowledge.target_kind = 'TRUTH' THEN truths.object_json ELSE claims.object_json END
         FROM actor_knowledge AS knowledge
         LEFT JOIN world_truths AS truths
           ON knowledge.target_kind = 'TRUTH' AND truths.id = knowledge.truth_id
              AND truths.campaign_id = knowledge.campaign_id
         LEFT JOIN knowledge_claims AS claims
           ON knowledge.target_kind = 'CLAIM' AND claims.id = knowledge.claim_id
              AND claims.campaign_id = knowledge.campaign_id
         WHERE knowledge.campaign_id = ?1 AND knowledge.actor_type = 'NPC'
           AND knowledge.actor_id = ?2
         ORDER BY knowledge.id LIMIT 101",
    )?;
    let rows = statement
        .query_map(params![campaign_id, npc_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, Option<String>>(4)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    if rows.len() > 100 {
        return Err(CampaignStoreError::InvalidData);
    }
    rows.into_iter()
        .map(|(target_kind, state, subject, predicate, object_json)| {
            if !matches!(target_kind.as_str(), "TRUTH" | "CLAIM")
                || !matches!(state.as_str(), "KNOWN" | "SUSPECTED" | "BELIEVED")
            {
                return Err(CampaignStoreError::InvalidData);
            }
            let subject = subject.ok_or(CampaignStoreError::InvalidData)?;
            let predicate = predicate.ok_or(CampaignStoreError::InvalidData)?;
            validate_text(&subject, 256)?;
            validate_text(&predicate, 128)?;
            let object_json = object_json.ok_or(CampaignStoreError::InvalidData)?;
            let object: Value =
                serde_json::from_str(&object_json).map_err(|_| CampaignStoreError::InvalidData)?;
            let object =
                serde_json::to_string(&object).map_err(|_| CampaignStoreError::InvalidData)?;
            let statement = format!("{subject} {predicate} {object}");
            validate_text(&statement, 4_000)?;
            Ok(json!({
                "targetKind": target_kind,
                "state": state,
                "statement": statement,
            }))
        })
        .collect()
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
    if find_repeated_phrase(
        std::iter::once(output.reply.as_str())
            .chain(output.suggested_topics.iter().map(String::as_str))
            .chain(output.memory_candidate.iter().map(String::as_str)),
    )
    .is_some()
    {
        return Err(CampaignStoreError::InvalidData);
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
    use crate::NpcTimelineBegin;

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
    fn timeline_commit_is_atomic_append_only_and_not_regenerable() {
        let directory = tempfile::tempdir().expect("temp directory");
        let store =
            CampaignStore::open(directory.path().join("ember-tavern.sqlite")).expect("open");
        seed_dialogue(&store);
        seed_timeline_profile(&store);
        let snapshot = store
            .npc_dialogue_snapshot("campaign-dialogue", "npc-owner")
            .expect("snapshot");
        let mut dialogue = command(&snapshot, 1, "Show me the cellar.");
        let timeline = NpcTimelineBegin {
            id: "timeline-dialogue-id".to_owned(),
            operation_id: "timeline-dialogue-operation".to_owned(),
            campaign_id: "campaign-dialogue".to_owned(),
            scope_kind: "NPC_DIALOGUE".to_owned(),
            scope_id: "npc-owner".to_owned(),
            player_intent: dialogue.player_message.clone(),
            addressed_npc_id: Some("npc-owner".to_owned()),
            hard_result_key: None,
            attempt_id: "timeline-dialogue-attempt-1".to_owned(),
            request_ids: vec![dialogue.generation.request_id.clone()],
            generation_record_ids: vec![dialogue.generation.generation_record_id.clone()],
            idempotency_keys: vec![dialogue.generation.idempotency_key.clone()],
        };
        store
            .begin_npc_timeline_attempt(timeline)
            .expect("lock intent before generation commit");
        dialogue.timeline_submission_id = Some("timeline-dialogue-id".to_owned());
        dialogue.timeline_attempt_id = Some("timeline-dialogue-attempt-1".to_owned());
        let saved = store
            .commit_npc_dialogue(dialogue)
            .expect("atomic timeline commit");
        assert_eq!(saved.messages.len(), 2);
        let committed = store
            .latest_npc_timeline("campaign-dialogue", "NPC_DIALOGUE", "npc-owner")
            .expect("load timeline")
            .expect("timeline exists");
        assert_eq!(committed.status, "COMMITTED");
        assert_eq!(committed.attempts[0].status, "COMMITTED");
        assert_eq!(
            committed.committed_ref_id.as_deref(),
            Some(saved.messages[1].id.as_str())
        );

        let connection = store.connect().expect("connect");
        assert!(
            connection
                .execute(
                    "UPDATE messages SET content='rewritten' WHERE id=?1",
                    [&saved.messages[1].id]
                )
                .is_err()
        );
        assert!(
            connection
                .execute("DELETE FROM messages WHERE id=?1", [&saved.messages[0].id])
                .is_err()
        );
        drop(connection);

        let replay = store
            .begin_npc_timeline_attempt(NpcTimelineBegin {
                id: committed.id.clone(),
                operation_id: committed.operation_id.clone(),
                campaign_id: committed.campaign_id.clone(),
                scope_kind: committed.scope_kind.clone(),
                scope_id: committed.scope_id.clone(),
                player_intent: committed.player_intent.clone(),
                addressed_npc_id: committed.addressed_npc_id.clone(),
                hard_result_key: committed.hard_result_key.clone(),
                attempt_id: "timeline-dialogue-attempt-2".to_owned(),
                request_ids: vec!["dialogue-request-replay".to_owned()],
                generation_record_ids: vec!["dialogue-generation-replay".to_owned()],
                idempotency_keys: vec!["dialogue-key-1".to_owned()],
            })
            .expect("committed replay returns the sealed operation");
        assert_eq!(replay.status, "COMMITTED");
        assert_eq!(replay.attempts.len(), 1);
        store
            .delete_campaign("campaign-dialogue")
            .expect("campaign cascade can remove sealed timeline data");
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
        assert_eq!(
            snapshot.generation_context["knowledge"],
            json!([{
                "targetKind": "TRUTH",
                "state": "KNOWN",
                "statement": "The cellar door is warm."
            }])
        );
        assert!(
            !snapshot
                .generation_context
                .to_string()
                .contains("royal seal")
        );
        let mut invalid = command(&snapshot, 1, "Hello.");
        invalid.generation.input["knowledge"] = json!([{
            "targetKind": "TRUTH",
            "state": "KNOWN",
            "statement": "A fabricated fact."
        }]);

        assert!(matches!(
            store.commit_npc_dialogue(invalid),
            Err(CampaignStoreError::InvalidData)
        ));
        let mut repeated = command(&snapshot, 1, "Hello.");
        repeated.generation.validated_output["reply"] =
            json!("The abandoned lighthouse door must remain sealed until dawn.");
        repeated.generation.validated_output["memoryCandidate"] =
            json!("The abandoned lighthouse door must remain sealed until dawn.");
        repeated.generation.raw_response_text = repeated.generation.validated_output.to_string();
        assert!(matches!(
            store.commit_npc_dialogue(repeated),
            Err(CampaignStoreError::InvalidData)
        ));
        let first = store
            .commit_npc_dialogue(command(&snapshot, 1, "Show me the cellar."))
            .expect("first distinct reply");
        let mut repeated_history = command(&first, 2, "What should I avoid?");
        repeated_history.generation.validated_output["reply"] =
            json!("Stay close and touch nothing warm.");
        repeated_history.generation.raw_response_text =
            repeated_history.generation.validated_output.to_string();
        assert!(matches!(
            store.commit_npc_dialogue(repeated_history),
            Err(CampaignStoreError::InvalidData)
        ));
        let after = store
            .npc_dialogue_snapshot("campaign-dialogue", "npc-owner")
            .expect("unchanged snapshot");
        assert_eq!(after.messages.len(), 2);
        assert_eq!(after.relationship.trust, 1);
    }

    #[test]
    fn generic_actor_projection_replaces_legacy_fact_lists_without_secret_leakage() {
        let directory = tempfile::tempdir().expect("temp directory");
        let store =
            CampaignStore::open(directory.path().join("ember-tavern.sqlite")).expect("open");
        seed_dialogue(&store);
        let connection = store.connect().expect("connect");
        connection
            .execute_batch(
                "INSERT INTO world_truths (
                   id, campaign_id, subject, predicate, object_json, authority, visibility,
                   source_event_id, revision, created_at, updated_at
                 ) VALUES (
                   'truth-authorized', 'campaign-dialogue', 'sealed_route', 'opens_at',
                   '\"moonrise\"', 'LOCAL_RULE', 'SECRET', NULL, 1,
                   '2026-08-14T12:00:00.000Z', '2026-08-14T12:00:00.000Z'
                 ), (
                   'truth-ungranted', 'campaign-dialogue', 'royal_archive', 'contains',
                   '\"the hidden succession\"', 'LOCAL_RULE', 'SECRET', NULL, 1,
                   '2026-08-14T12:00:00.000Z', '2026-08-14T12:00:00.000Z'
                 );
                 INSERT INTO actor_knowledge (
                   id, campaign_id, actor_type, actor_id, target_kind, truth_id, claim_id,
                   knowledge_state, visibility, provenance_kind, provenance_source_id,
                   provenance_event_id, learned_at, confidence, revision, updated_at
                 ) VALUES (
                   'knowledge-authorized', 'campaign-dialogue', 'NPC', 'npc-owner',
                   'TRUTH', 'truth-authorized', NULL, 'KNOWN', 'ACTOR_PRIVATE',
                   'LOCAL_RULE', 'test-rule', NULL, '2026-08-14T12:00:00.000Z', 1.0, 1,
                   '2026-08-14T12:00:00.000Z'
                 );
                 INSERT INTO knowledge_memories (
                   id,campaign_id,actor_type,actor_id,summary,source_knowledge_ids_json,
                   source_event_ids_json,revision,created_at
                 ) VALUES (
                   'memory-authorized','campaign-dialogue','NPC','npc-owner',
                   'The sealed route opens at moonrise.','[\"knowledge-authorized\"]','[]',1,
                   '2026-08-14T12:00:00.000Z'
                 );
                 INSERT INTO memory_artifact_sources (
                   campaign_id,artifact_kind,artifact_id,ordinal,source_kind,source_id,
                   source_revision,source_hash,source_occurred_at
                 ) VALUES (
                   'campaign-dialogue','LONG_TERM','memory-authorized',0,'KNOWLEDGE',
                   'knowledge-authorized',1,
                   'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                   '2026-08-14T12:00:00.000Z'
                 );",
            )
            .expect("seed actor projection");
        drop(connection);

        let snapshot = store
            .npc_dialogue_snapshot("campaign-dialogue", "npc-owner")
            .expect("project actor knowledge");
        assert_eq!(
            snapshot.generation_context["knowledge"],
            json!([{
                "targetKind": "TRUTH",
                "state": "KNOWN",
                "statement": "sealed_route opens_at \"moonrise\""
            }])
        );
        assert_eq!(
            snapshot.generation_context["longTermMemories"],
            json!(["The sealed route opens at moonrise."])
        );
        let serialized = snapshot.generation_context.to_string();
        assert!(!serialized.contains("hidden succession"));
        assert!(!serialized.contains("cellar door is warm"));

        let connection = store.connect().expect("connect for source update");
        connection
            .execute(
                "UPDATE actor_knowledge SET revision=2,updated_at=?1 WHERE id='knowledge-authorized'",
                ["2026-08-14T12:10:00.000Z"],
            )
            .expect("advance source revision");
        drop(connection);
        let stale = store
            .npc_dialogue_snapshot("campaign-dialogue", "npc-owner")
            .expect("exclude stale memory");
        assert_eq!(stale.generation_context["longTermMemories"], json!([]));
    }

    #[test]
    fn rejects_knowledge_that_promotes_another_actor_false_belief() {
        let directory = tempfile::tempdir().expect("temp directory");
        let store =
            CampaignStore::open(directory.path().join("ember-tavern.sqlite")).expect("open");
        seed_dialogue(&store);
        let connection = store.connect().expect("connect");
        connection
            .execute_batch(
                "INSERT INTO world_facts (
                   id, campaign_id, kind, statement, faction_ids_json, detail_json, created_at
                 ) VALUES (
                   'fact-other-belief', 'campaign-dialogue', 'FALSE_BELIEF',
                   'The harbor is empty.', '[]', '{\"believedByNpcIds\":[\"npc-other\"]}',
                   '2026-07-31T05:00:00.000Z'
                 );
                 UPDATE npc_knowledge
                 SET false_belief_fact_ids_json = '[\"fact-other-belief\"]'
                 WHERE npc_id = 'npc-owner';",
            )
            .expect("seed invalid actor knowledge");
        drop(connection);

        assert!(matches!(
            store.npc_dialogue_snapshot("campaign-dialogue", "npc-owner"),
            Err(CampaignStoreError::InvalidData)
        ));
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
                 ), (
                   'fact-hidden', 'campaign-dialogue', 'DEVELOPING_FACT',
                   'A royal seal is hidden beneath the floor.', '[]', '{}',
                   '2026-07-31T05:00:00.000Z'
                 );
                 INSERT INTO npc_knowledge (
                   npc_id, known_fact_ids_json, suspected_fact_ids_json,
                   false_belief_fact_ids_json, excluded_secret_fact_ids_json,
                   provenance_json, updated_at
                 ) VALUES (
                   'npc-owner', '[\"fact-known\"]', '[]', '[]', '[]',
                   '[{\"factId\":\"fact-known\",\"state\":\"KNOWN\",\"source\":\"IMPORT\",\"eventId\":null,\"learnedAt\":\"2026-07-31T05:00:00.000Z\",\"confidence\":1}]',
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

    fn seed_timeline_profile(store: &CampaignStore) {
        let connection = store.connect().expect("connect");
        connection
            .execute_batch(
                r#"INSERT INTO world_constitutions(
                   campaign_id,schema_version,revision,status,world_type,era,technology,magic,
                   peoples_json,society,politics,economy,combat_scale,death_rules,career_rules,
                   equipment_rules,npc_rules,trait_rules,taboos_json,created_at,updated_at,locked_at
                 ) VALUES(
                   'campaign-dialogue',1,1,'LOCKED','Fantasy','Late medieval','Steel','Rare',
                   '[]','Guilds','Council','Coin','Personal','Final','Open','Grounded','Persistent',
                   'Balanced','[]','2026-07-31T05:00:00.000Z','2026-07-31T05:00:00.000Z',
                   '2026-07-31T05:00:00.000Z'
                 );
                 INSERT INTO npc_lod_profiles(
                   id,campaign_id,schema_version,constitution_revision,lod,revision,profile_json,
                   generation_record_id,created_at,updated_at
                 ) VALUES(
                   'npc-owner','campaign-dialogue',1,1,3,1,
                   '{"kind":"NPC_LOD_PROFILE","schemaVersion":1,"id":"npc-owner","campaignId":"campaign-dialogue","constitutionRevision":1,"lod":3,"revision":1,"generationRecordId":null,"createdAt":"2026-07-31T05:00:00.000Z","updatedAt":"2026-07-31T05:00:00.000Z"}',
                   NULL,'2026-07-31T05:00:00.000Z','2026-07-31T05:00:00.000Z'
                 );"#,
            )
            .expect("seed timeline profile");
    }

    fn command(
        snapshot: &NpcDialogueSnapshot,
        index: usize,
        player_message: &str,
    ) -> NpcDialogueCommit {
        let reply = if index == 1 {
            "Stay close and touch nothing warm."
        } else {
            "The cellar stones are cooling, so we can proceed."
        };
        let output = json!({
            "reply": reply,
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
                prompt_version: 3,
                input,
                context: json!({ "npcId": "npc-owner" }),
                request: json!({ "task": "NPC_REPLY" }),
                raw_response_text: output.to_string(),
                validated_output: output,
            },
            timeline_submission_id: None,
            timeline_attempt_id: None,
        }
    }
}

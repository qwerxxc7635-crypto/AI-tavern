use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::{
    CampaignStore, CampaignStoreError, QuestBoardSnapshot, TavernGenerationAudit,
    current_timestamp,
    quest_board::{
        QuestOutput, insert_generation, load_snapshot, load_source, validate_audit, validate_output,
    },
    repetition::quest_structure_signature,
    validate_id,
};

const SOURCE_KINDS: &[&str] = &[
    "NPC",
    "FACTION",
    "WORLD_EVENT",
    "DISCOVERY",
    "PLAYER_ACTION",
    "CONSEQUENCE",
];
const OPEN_QUEST_LIMIT: i64 = 12;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DynamicQuestSourceContext {
    pub kind: String,
    pub occurrence_id: String,
    pub entity_kind: String,
    pub entity_id: String,
    pub summary: String,
    pub actor_npc_id: Option<String>,
    pub visibility: String,
    pub player_intervened: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DynamicQuestRelevantFact {
    pub id: String,
    pub statement: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DynamicQuestBudget {
    pub policy_version: i64,
    pub open_quest_limit: i64,
    pub current_open_quests: i64,
    pub remaining_slots: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DynamicQuestConstitution {
    pub revision: i64,
    pub technology: String,
    pub magic: String,
    pub society: String,
    pub politics: String,
    pub economy: String,
    pub taboos: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DynamicQuestPreparation {
    pub campaign_id: String,
    pub source: DynamicQuestSourceContext,
    pub publisher_npc_id: String,
    pub relevant_facts: Vec<DynamicQuestRelevantFact>,
    pub constitution: DynamicQuestConstitution,
    pub budget: DynamicQuestBudget,
    pub initial_status: String,
    pub context_digest: String,
    pub existing_quest_id: Option<String>,
    pub input: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DynamicQuestPrepareCommand {
    pub campaign_id: String,
    pub source_kind: String,
    pub occurrence_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DynamicQuestCommitCommand {
    pub campaign_id: String,
    pub source_kind: String,
    pub occurrence_id: String,
    pub expected_context_digest: String,
    pub generation: TavernGenerationAudit,
}

struct SourceProjection {
    source: DynamicQuestSourceContext,
    relevant_facts: Vec<DynamicQuestRelevantFact>,
    snapshot: Value,
}

impl CampaignStore {
    pub fn prepare_dynamic_quest(
        &self,
        command: DynamicQuestPrepareCommand,
    ) -> Result<DynamicQuestPreparation, CampaignStoreError> {
        validate_source_command(
            &command.campaign_id,
            &command.source_kind,
            &command.occurrence_id,
        )?;
        prepare(
            &self.connect()?,
            &command.campaign_id,
            &command.source_kind,
            &command.occurrence_id,
        )
    }

    pub fn commit_dynamic_quest(
        &self,
        command: DynamicQuestCommitCommand,
    ) -> Result<QuestBoardSnapshot, CampaignStoreError> {
        validate_source_command(
            &command.campaign_id,
            &command.source_kind,
            &command.occurrence_id,
        )?;
        if command.expected_context_digest.len() != 64 {
            return Err(CampaignStoreError::InvalidData);
        }
        validate_id(&command.expected_context_digest)?;
        validate_audit(&command.generation)?;
        let output: QuestOutput =
            serde_json::from_value(command.generation.validated_output.clone())
                .map_err(|_| CampaignStoreError::InvalidData)?;
        validate_output(&output)?;
        let mut connection = self.connect()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        if let Some((_quest_id, generation_record_id, context_digest)) = transaction
            .query_row(
                "SELECT quest_id,generation_record_id,context_digest FROM dynamic_quest_sources
                 WHERE campaign_id=?1 AND source_kind=?2 AND occurrence_id=?3",
                params![
                    command.campaign_id,
                    command.source_kind,
                    command.occurrence_id
                ],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                    ))
                },
            )
            .optional()?
        {
            if generation_record_id != command.generation.generation_record_id
                || context_digest != command.expected_context_digest
            {
                return Err(CampaignStoreError::InvalidData);
            }
            let snapshot = load_snapshot(&transaction, &command.campaign_id)?;
            transaction.commit()?;
            return Ok(snapshot);
        }
        let prepared = prepare(
            &transaction,
            &command.campaign_id,
            &command.source_kind,
            &command.occurrence_id,
        )?;
        if prepared.context_digest != command.expected_context_digest
            || command.generation.input != prepared.input
            || command.generation.context
                != json!({
                    "campaignId": command.campaign_id,
                    "sourceKind": command.source_kind,
                    "occurrenceId": command.occurrence_id,
                    "contextDigest": prepared.context_digest,
                })
        {
            return Err(CampaignStoreError::InvalidData);
        }
        validate_dynamic_output(&output, &prepared)?;
        let at = current_timestamp()?;
        insert_generation(&transaction, &command.campaign_id, &command.generation, &at)?;
        let quest_id = format!("dynamic-quest:{}", Uuid::new_v4());
        transaction.execute(
            "INSERT INTO quest_pool_creation_intents
             (quest_id,campaign_id,status,reason,operation_id,created_at)
             VALUES (?1,?2,?3,?4,?5,?6)",
            params![
                quest_id,
                command.campaign_id,
                prepared.initial_status,
                format!(
                    "Dynamic {} source {} created the quest.",
                    command.source_kind, command.occurrence_id
                ),
                format!(
                    "quest:dynamic:{}:{}",
                    command.source_kind.to_lowercase(),
                    command.occurrence_id
                ),
                at
            ],
        )?;
        insert_quest(
            &transaction,
            &quest_id,
            &command.campaign_id,
            &prepared.publisher_npc_id,
            &output,
            &at,
        )?;
        insert_provenance(&transaction, &quest_id, &command, &prepared, &at)?;
        let snapshot = load_snapshot(&transaction, &command.campaign_id)?;
        transaction.commit()?;
        Ok(snapshot)
    }
}

fn prepare(
    connection: &Connection,
    campaign_id: &str,
    source_kind: &str,
    occurrence_id: &str,
) -> Result<DynamicQuestPreparation, CampaignStoreError> {
    let generation_source = load_source(connection, campaign_id)?;
    let projection = project_source(connection, campaign_id, source_kind, occurrence_id)?;
    let existing_quest_id = connection
        .query_row(
            "SELECT quest_id FROM dynamic_quest_sources
             WHERE campaign_id=?1 AND source_kind=?2 AND occurrence_id=?3",
            params![campaign_id, source_kind, occurrence_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    let budget = load_budget(connection, campaign_id)?;
    if existing_quest_id.is_none() && budget.remaining_slots < 1 {
        return Err(CampaignStoreError::InvalidState);
    }
    let constitution = load_constitution(connection, campaign_id)?;
    let publisher = projection
        .source
        .actor_npc_id
        .as_ref()
        .and_then(|id| {
            generation_source
                .available_npcs
                .iter()
                .find(|npc| &npc.id == id)
        })
        .or_else(|| generation_source.available_npcs.first())
        .ok_or(CampaignStoreError::InvalidData)?;
    let input = json!({
        "world": generation_source.world,
        "tavernName": generation_source.tavern_name,
        "publisher": publisher,
        "availableNpcs": generation_source.available_npcs,
        "playerConcept": generation_source.player_concept,
        "recentQuestTitles": generation_source.recent_quest_titles,
        "recentQuestStructures": generation_source.recent_quest_structures,
        "dynamicSource": projection.source,
        "relevantFacts": projection.relevant_facts,
        "constitution": constitution,
        "generationBudget": budget,
    });
    let context_digest = canonical_digest(&input)?;
    Ok(DynamicQuestPreparation {
        campaign_id: campaign_id.to_owned(),
        source: projection.source,
        publisher_npc_id: publisher.id.clone(),
        relevant_facts: projection.relevant_facts,
        constitution,
        budget,
        initial_status: initial_status(source_kind, &input)?,
        context_digest,
        existing_quest_id,
        input,
    })
}

fn project_source(
    connection: &Connection,
    campaign_id: &str,
    source_kind: &str,
    occurrence_id: &str,
) -> Result<SourceProjection, CampaignStoreError> {
    match source_kind {
        "NPC" => project_npc(connection, campaign_id, occurrence_id),
        "FACTION" => project_faction(connection, campaign_id, occurrence_id),
        "WORLD_EVENT" => project_world_event(connection, campaign_id, occurrence_id),
        "DISCOVERY" => project_discovery(connection, campaign_id, occurrence_id),
        "PLAYER_ACTION" => project_player_action(connection, campaign_id, occurrence_id),
        "CONSEQUENCE" => project_consequence(connection, campaign_id, occurrence_id),
        _ => Err(CampaignStoreError::InvalidData),
    }
}

fn project_npc(
    connection: &Connection,
    campaign_id: &str,
    occurrence_id: &str,
) -> Result<SourceProjection, CampaignStoreError> {
    let (npc_id, player_intent, reply, committed_ref_id) = connection
        .query_row(
            "SELECT operation.scope_id,operation.player_intent,message.content,operation.committed_ref_id
             FROM npc_timeline_operations operation
             JOIN messages message ON message.id=operation.committed_ref_id
             WHERE operation.id=?1 AND operation.campaign_id=?2
               AND operation.scope_kind='NPC_DIALOGUE' AND operation.status='COMMITTED'",
            params![occurrence_id, campaign_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?, row.get::<_, String>(3)?)),
        )
        .optional()?
        .ok_or(CampaignStoreError::NotFound)?;
    Ok(SourceProjection {
        source: DynamicQuestSourceContext {
            kind: "NPC".to_owned(),
            occurrence_id: occurrence_id.to_owned(),
            entity_kind: "NPC".to_owned(),
            entity_id: npc_id.clone(),
            summary: bounded_summary(&format!("{player_intent}\n{reply}"))?,
            actor_npc_id: Some(npc_id),
            visibility: "PLAYER_VISIBLE".to_owned(),
            player_intervened: false,
        },
        relevant_facts: Vec::new(),
        snapshot: json!({"playerIntent":player_intent,"reply":reply,"committedRefId":committed_ref_id}),
    })
}

fn project_faction(
    connection: &Connection,
    campaign_id: &str,
    occurrence_id: &str,
) -> Result<SourceProjection, CampaignStoreError> {
    let (faction_id, action_source, action_kind, summary, fact_id, proposal): (
        String,
        String,
        String,
        String,
        Option<String>,
        String,
    ) = connection
        .query_row(
            "SELECT faction_id,source,action_kind,summary,world_fact_id,proposal_json
             FROM faction_action_events WHERE id=?1 AND campaign_id=?2",
            params![occurrence_id, campaign_id],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                ))
            },
        )
        .optional()?
        .ok_or(CampaignStoreError::NotFound)?;
    let relevant_facts = fact_id
        .as_deref()
        .map(|id| load_fact(connection, campaign_id, id))
        .transpose()?
        .into_iter()
        .collect();
    Ok(SourceProjection {
        source: DynamicQuestSourceContext {
            kind: "FACTION".to_owned(),
            occurrence_id: occurrence_id.to_owned(),
            entity_kind: "FACTION".to_owned(),
            entity_id: faction_id,
            summary,
            actor_npc_id: None,
            visibility: if action_source == "PLAYER" {
                "PLAYER_VISIBLE"
            } else {
                "HIDDEN"
            }
            .to_owned(),
            player_intervened: false,
        },
        relevant_facts,
        snapshot: json!({
            "actionSource":action_source,
            "actionKind":action_kind,
            "proposal":serde_json::from_str::<Value>(&proposal).map_err(|_|CampaignStoreError::InvalidData)?,
        }),
    })
}

fn project_world_event(
    connection: &Connection,
    campaign_id: &str,
    occurrence_id: &str,
) -> Result<SourceProjection, CampaignStoreError> {
    let (event_type, payload) = load_event(connection, campaign_id, occurrence_id)?;
    if !["WORLD_CLOCK_ADVANCED", "ADVENTURE_COMPLETED"].contains(&event_type.as_str()) {
        return Err(CampaignStoreError::InvalidData);
    }
    Ok(SourceProjection {
        source: DynamicQuestSourceContext {
            kind: "WORLD_EVENT".to_owned(),
            occurrence_id: occurrence_id.to_owned(),
            entity_kind: "GAME_EVENT".to_owned(),
            entity_id: occurrence_id.to_owned(),
            summary: bounded_summary(&format!("{event_type}: {}", canonical_json(&payload)?))?,
            actor_npc_id: None,
            visibility: "PLAYER_VISIBLE".to_owned(),
            player_intervened: false,
        },
        relevant_facts: Vec::new(),
        snapshot: json!({"type":event_type,"payload":payload}),
    })
}

fn project_discovery(
    connection: &Connection,
    campaign_id: &str,
    occurrence_id: &str,
) -> Result<SourceProjection, CampaignStoreError> {
    let (event_type, payload) = load_event(connection, campaign_id, occurrence_id)?;
    if event_type != "FACT_DISCOVERED" {
        return Err(CampaignStoreError::InvalidData);
    }
    let fact_id = payload
        .get("worldFactId")
        .and_then(Value::as_str)
        .ok_or(CampaignStoreError::InvalidData)?;
    let fact = load_fact(connection, campaign_id, fact_id)?;
    Ok(SourceProjection {
        source: DynamicQuestSourceContext {
            kind: "DISCOVERY".to_owned(),
            occurrence_id: occurrence_id.to_owned(),
            entity_kind: "WORLD_FACT".to_owned(),
            entity_id: fact.id.clone(),
            summary: fact.statement.clone(),
            actor_npc_id: None,
            visibility: "PLAYER_VISIBLE".to_owned(),
            player_intervened: false,
        },
        relevant_facts: vec![fact],
        snapshot: json!({"eventType":event_type,"worldFactId":fact_id}),
    })
}

fn project_player_action(
    connection: &Connection,
    campaign_id: &str,
    occurrence_id: &str,
) -> Result<SourceProjection, CampaignStoreError> {
    let (event_type, payload) = load_event(connection, campaign_id, occurrence_id)?;
    if event_type != "PLAYER_ACTION_SUBMITTED" {
        return Err(CampaignStoreError::InvalidData);
    }
    let adventure_id = payload
        .get("adventureId")
        .and_then(Value::as_str)
        .ok_or(CampaignStoreError::InvalidData)?;
    let turn_id = payload
        .get("turnId")
        .and_then(Value::as_str)
        .ok_or(CampaignStoreError::InvalidData)?;
    let action = payload
        .get("action")
        .ok_or(CampaignStoreError::InvalidData)?;
    Ok(SourceProjection {
        source: DynamicQuestSourceContext {
            kind: "PLAYER_ACTION".to_owned(),
            occurrence_id: occurrence_id.to_owned(),
            entity_kind: "PLAYER_ACTION".to_owned(),
            entity_id: adventure_id.to_owned(),
            summary: bounded_summary(&format!("Player action: {}", canonical_json(action)?))?,
            actor_npc_id: None,
            visibility: "PLAYER_VISIBLE".to_owned(),
            player_intervened: true,
        },
        relevant_facts: Vec::new(),
        snapshot: json!({"action":action,"turnId":turn_id}),
    })
}

fn project_consequence(
    connection: &Connection,
    campaign_id: &str,
    occurrence_id: &str,
) -> Result<SourceProjection, CampaignStoreError> {
    let (trigger_kind, trigger_id, changes): (String, String, String) = connection
        .query_row(
            "SELECT trigger_kind,trigger_id,changes_json FROM quest_graph_evaluations
             WHERE operation_id=?1 AND campaign_id=?2 AND json_array_length(changes_json)>0",
            params![occurrence_id, campaign_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()?
        .ok_or(CampaignStoreError::NotFound)?;
    let changes: Value =
        serde_json::from_str(&changes).map_err(|_| CampaignStoreError::InvalidData)?;
    Ok(SourceProjection {
        source: DynamicQuestSourceContext {
            kind: "CONSEQUENCE".to_owned(),
            occurrence_id: occurrence_id.to_owned(),
            entity_kind: "QUEST_GRAPH".to_owned(),
            entity_id: trigger_id.clone(),
            summary: bounded_summary(&format!("Quest consequence: {}", canonical_json(&changes)?))?,
            actor_npc_id: None,
            visibility: "HIDDEN".to_owned(),
            player_intervened: false,
        },
        relevant_facts: Vec::new(),
        snapshot: json!({"triggerKind":trigger_kind,"changes":changes}),
    })
}

fn load_event(
    connection: &Connection,
    campaign_id: &str,
    event_id: &str,
) -> Result<(String, Value), CampaignStoreError> {
    let (event_type, payload): (String, String) = connection
        .query_row(
            "SELECT type,payload_json FROM game_events WHERE id=?1 AND campaign_id=?2",
            params![event_id, campaign_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?
        .ok_or(CampaignStoreError::NotFound)?;
    Ok((
        event_type,
        serde_json::from_str(&payload).map_err(|_| CampaignStoreError::InvalidData)?,
    ))
}

fn load_fact(
    connection: &Connection,
    campaign_id: &str,
    fact_id: &str,
) -> Result<DynamicQuestRelevantFact, CampaignStoreError> {
    connection
        .query_row(
            "SELECT id,statement FROM world_facts WHERE id=?1 AND campaign_id=?2",
            params![fact_id, campaign_id],
            |row| {
                Ok(DynamicQuestRelevantFact {
                    id: row.get(0)?,
                    statement: row.get(1)?,
                })
            },
        )
        .optional()?
        .ok_or(CampaignStoreError::NotFound)
}

fn load_budget(
    connection: &Connection,
    campaign_id: &str,
) -> Result<DynamicQuestBudget, CampaignStoreError> {
    let current_open_quests: i64 = connection.query_row(
        "SELECT COUNT(*) FROM quest_pool_states
         WHERE campaign_id=?1 AND status NOT IN ('COMPLETED','FAILED','EXPIRED','ABANDONED')",
        [campaign_id],
        |row| row.get(0),
    )?;
    Ok(DynamicQuestBudget {
        policy_version: 1,
        open_quest_limit: OPEN_QUEST_LIMIT,
        current_open_quests,
        remaining_slots: (OPEN_QUEST_LIMIT - current_open_quests).max(0),
    })
}

fn load_constitution(
    connection: &Connection,
    campaign_id: &str,
) -> Result<DynamicQuestConstitution, CampaignStoreError> {
    connection
        .query_row(
            "SELECT revision,technology,magic,society,politics,economy,taboos_json
             FROM world_constitutions WHERE campaign_id=?1 AND status='LOCKED'",
            [campaign_id],
            |row| {
                let taboos: String = row.get(6)?;
                Ok(DynamicQuestConstitution {
                    revision: row.get(0)?,
                    technology: row.get(1)?,
                    magic: row.get(2)?,
                    society: row.get(3)?,
                    politics: row.get(4)?,
                    economy: row.get(5)?,
                    taboos: serde_json::from_str(&taboos).map_err(json_error)?,
                })
            },
        )
        .optional()?
        .ok_or(CampaignStoreError::InvalidData)
}

fn initial_status(source_kind: &str, input: &Value) -> Result<String, CampaignStoreError> {
    let source = input
        .get("dynamicSource")
        .and_then(Value::as_object)
        .ok_or(CampaignStoreError::InvalidData)?;
    let visibility = source
        .get("visibility")
        .and_then(Value::as_str)
        .ok_or(CampaignStoreError::InvalidData)?;
    if visibility == "HIDDEN" {
        return Ok("HIDDEN".to_owned());
    }
    Ok(match source_kind {
        "PLAYER_ACTION" => "ACTIVE",
        "DISCOVERY" | "CONSEQUENCE" => "DISCOVERED",
        _ => "AVAILABLE",
    }
    .to_owned())
}

fn validate_dynamic_output(
    output: &QuestOutput,
    prepared: &DynamicQuestPreparation,
) -> Result<(), CampaignStoreError> {
    if output.related_npc_ids.iter().any(|id| {
        !prepared.input["availableNpcs"]
            .as_array()
            .into_iter()
            .flatten()
            .any(|npc| npc.get("id").and_then(Value::as_str) == Some(id))
    }) || output
        .related_fact_ids
        .iter()
        .any(|id| !prepared.relevant_facts.iter().any(|fact| &fact.id == id))
    {
        return Err(CampaignStoreError::InvalidData);
    }
    let structure = quest_structure_signature(
        &output.risk,
        &output.reward_tier,
        output.expected_turns.min,
        output.expected_turns.max,
        &output.recommended_attributes,
    );
    if prepared.input["recentQuestStructures"]
        .as_array()
        .into_iter()
        .flatten()
        .any(|value| value.as_str() == Some(&structure))
    {
        return Err(CampaignStoreError::InvalidData);
    }
    Ok(())
}

fn insert_quest(
    connection: &Connection,
    quest_id: &str,
    campaign_id: &str,
    publisher_npc_id: &str,
    output: &QuestOutput,
    at: &str,
) -> Result<(), CampaignStoreError> {
    connection.execute(
        "INSERT INTO quests (
           id,campaign_id,publisher_npc_id,content_json,status,risk,
           recommended_attributes_json,expected_turns_min,expected_turns_max,reward_tier,
           related_npc_ids_json,related_fact_ids_json,created_at,updated_at
         ) VALUES (?1,?2,?3,?4,'AVAILABLE',?5,?6,?7,?8,?9,?10,?11,?12,?12)",
        params![
            quest_id,
            campaign_id,
            publisher_npc_id,
            serde_json::to_string(&output.content).map_err(|_| CampaignStoreError::InvalidData)?,
            output.risk,
            serde_json::to_string(&output.recommended_attributes)
                .map_err(|_| CampaignStoreError::InvalidData)?,
            output.expected_turns.min,
            output.expected_turns.max,
            output.reward_tier,
            serde_json::to_string(&output.related_npc_ids)
                .map_err(|_| CampaignStoreError::InvalidData)?,
            serde_json::to_string(&output.related_fact_ids)
                .map_err(|_| CampaignStoreError::InvalidData)?,
            at
        ],
    )?;
    Ok(())
}

fn insert_provenance(
    connection: &Connection,
    quest_id: &str,
    command: &DynamicQuestCommitCommand,
    prepared: &DynamicQuestPreparation,
    at: &str,
) -> Result<(), CampaignStoreError> {
    let projection = project_source(
        connection,
        &command.campaign_id,
        &command.source_kind,
        &command.occurrence_id,
    )?;
    connection.execute(
        "INSERT INTO dynamic_quest_sources (
           quest_id,campaign_id,source_kind,occurrence_id,entity_kind,entity_id,actor_npc_id,
           visibility,player_intervened,source_summary,source_snapshot_json,
           relevant_fact_ids_json,context_digest,generation_record_id,budget_json,created_at
         ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16)",
        params![
            quest_id,
            command.campaign_id,
            prepared.source.kind,
            prepared.source.occurrence_id,
            prepared.source.entity_kind,
            prepared.source.entity_id,
            prepared.source.actor_npc_id,
            prepared.source.visibility,
            prepared.source.player_intervened as i64,
            prepared.source.summary,
            projection.snapshot.to_string(),
            serde_json::to_string(
                &prepared
                    .relevant_facts
                    .iter()
                    .map(|fact| &fact.id)
                    .collect::<Vec<_>>()
            )
            .map_err(|_| CampaignStoreError::InvalidData)?,
            prepared.context_digest,
            command.generation.generation_record_id,
            serde_json::to_string(&prepared.budget).map_err(|_| CampaignStoreError::InvalidData)?,
            at
        ],
    )?;
    Ok(())
}

fn validate_source_command(
    campaign_id: &str,
    source_kind: &str,
    occurrence_id: &str,
) -> Result<(), CampaignStoreError> {
    validate_id(campaign_id)?;
    validate_id(occurrence_id)?;
    if occurrence_id.chars().count() > 200 {
        return Err(CampaignStoreError::InvalidData);
    }
    if !SOURCE_KINDS.contains(&source_kind) {
        return Err(CampaignStoreError::InvalidData);
    }
    Ok(())
}

fn bounded_summary(value: &str) -> Result<String, CampaignStoreError> {
    let result = value.chars().take(4_000).collect::<String>();
    let result = result.trim();
    if result.is_empty() {
        Err(CampaignStoreError::InvalidData)
    } else {
        Ok(result.to_owned())
    }
}

fn canonical_digest(value: &Value) -> Result<String, CampaignStoreError> {
    Ok(format!(
        "{:x}",
        Sha256::digest(canonical_json(value)?.as_bytes())
    ))
}

fn canonical_json(value: &Value) -> Result<String, CampaignStoreError> {
    match value {
        Value::Null | Value::Bool(_) | Value::Number(_) | Value::String(_) => {
            serde_json::to_string(value).map_err(|_| CampaignStoreError::InvalidData)
        }
        Value::Array(values) => Ok(format!(
            "[{}]",
            values
                .iter()
                .map(canonical_json)
                .collect::<Result<Vec<_>, _>>()?
                .join(",")
        )),
        Value::Object(values) => {
            let mut entries = values.iter().collect::<Vec<_>>();
            entries.sort_by_key(|(key, _)| *key);
            Ok(format!(
                "{{{}}}",
                entries
                    .into_iter()
                    .map(|(key, entry)| {
                        Ok(format!(
                            "{}:{}",
                            serde_json::to_string(key)
                                .map_err(|_| CampaignStoreError::InvalidData)?,
                            canonical_json(entry)?
                        ))
                    })
                    .collect::<Result<Vec<_>, CampaignStoreError>>()?
                    .join(",")
            ))
        }
    }
}

fn json_error(error: serde_json::Error) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(error))
}

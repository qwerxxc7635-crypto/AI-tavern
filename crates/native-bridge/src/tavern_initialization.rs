use std::collections::HashSet;

use rusqlite::{Connection, OptionalExtension, Transaction, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use uuid::Uuid;

use crate::{CampaignStore, CampaignStoreError, current_timestamp, validate_id};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TavernWorldContext {
    pub name: String,
    pub current_region: String,
    pub summary: String,
    pub core_conflict: String,
    pub technology_level: String,
    pub power_rules: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TavernGenerationSource {
    pub player_character_id: String,
    pub location_id: String,
    pub world: TavernWorldContext,
    pub player_concept: String,
    pub desired_position: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TavernView {
    pub id: String,
    pub campaign_id: String,
    pub location_id: String,
    pub name: String,
    pub position: String,
    pub environment: String,
    pub special_rules: Vec<String>,
    pub long_term_problem: String,
    pub owner_npc_id: String,
    pub changes: Value,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TavernNpcView {
    pub id: String,
    pub residency: String,
    pub name: String,
    pub identity: String,
    pub appearance: String,
    pub personality: String,
    pub current_mood: String,
    pub current_status: String,
    pub visit_reason: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RumorView {
    pub id: String,
    pub claim_id: String,
    pub statement: String,
    pub source_npc_id: String,
    pub source_basis: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorldClockView {
    pub id: String,
    pub name: String,
    pub current: i64,
    pub max: i64,
    pub stages: Value,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TavernSnapshot {
    pub campaign_state: String,
    pub source: TavernGenerationSource,
    pub tavern: Option<TavernView>,
    pub npcs: Vec<TavernNpcView>,
    pub rumors: Vec<RumorView>,
    pub clocks: Vec<WorldClockView>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TavernGenerationCommit {
    pub campaign_id: String,
    pub generation: TavernGenerationAudit,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NpcRosterGenerationCommit {
    pub campaign_id: String,
    pub tavern_id: String,
    pub generation: TavernGenerationAudit,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TavernGenerationAudit {
    pub request_id: String,
    pub generation_record_id: String,
    pub idempotency_key: String,
    pub prompt_version: i64,
    pub input: Value,
    pub context: Value,
    pub request: Value,
    pub raw_response_text: String,
    pub validated_output: Value,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct NpcDraft {
    name: String,
    identity: String,
    appearance: String,
    personality: String,
    goal: String,
    secret: String,
    speech_style: String,
    current_mood: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct TavernOutput {
    name: String,
    position: String,
    environment: String,
    special_rules: Vec<String>,
    long_term_problem: String,
    owner: NpcDraft,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RosterNpcDraft {
    residency: String,
    #[serde(flatten)]
    profile: NpcDraft,
    visit_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RumorDraft {
    statement: String,
    source_npc_name: String,
    source_basis: String,
    confidence: f64,
    veracity: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct NpcRosterOutput {
    npcs: Vec<RosterNpcDraft>,
    rumors: Vec<RumorDraft>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredLocation {
    id: String,
    name: String,
}

impl CampaignStore {
    pub fn tavern_snapshot(&self, campaign_id: &str) -> Result<TavernSnapshot, CampaignStoreError> {
        validate_id(campaign_id)?;
        let connection = self.connect()?;
        load_snapshot(&connection, campaign_id)
    }

    pub fn commit_tavern_generation(
        &self,
        command: TavernGenerationCommit,
    ) -> Result<TavernSnapshot, CampaignStoreError> {
        validate_id(&command.campaign_id)?;
        validate_audit(&command.generation, "GENERATE_TAVERN")?;
        let output: TavernOutput =
            serde_json::from_value(command.generation.validated_output.clone())
                .map_err(|_| CampaignStoreError::InvalidData)?;
        validate_tavern_output(&output)?;

        let mut connection = self.connect()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        if replayed(
            &transaction,
            &command.generation.idempotency_key,
            &command.campaign_id,
            "GENERATE_TAVERN",
        )? {
            let result = load_snapshot(&transaction, &command.campaign_id)?;
            transaction.commit()?;
            return Ok(result);
        }
        if campaign_state(&transaction, &command.campaign_id)? != "GENERATING_TAVERN"
            || tavern_for_campaign(&transaction, &command.campaign_id)?.is_some()
        {
            return Err(CampaignStoreError::InvalidState);
        }
        let source = load_source(&transaction, &command.campaign_id)?;
        let expected_input = serde_json::json!({
            "world": source.world,
            "playerConcept": source.player_concept,
            "desiredPosition": source.desired_position,
        });
        let expected_context = serde_json::json!({ "source": source });
        if command.generation.input != expected_input
            || command.generation.context != expected_context
        {
            return Err(CampaignStoreError::InvalidData);
        }

        let at = current_timestamp()?;
        let tavern_id = Uuid::new_v4().to_string();
        let owner_id = Uuid::new_v4().to_string();
        transaction.execute(
            "INSERT INTO taverns (
               id, campaign_id, location_id, name, position, environment,
               special_rules_json, long_term_problem, owner_npc_id, changes_json,
               created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, '[]', ?10, ?10)",
            params![
                tavern_id,
                command.campaign_id,
                source.location_id,
                output.name,
                output.position,
                output.environment,
                to_json(&output.special_rules)?,
                output.long_term_problem,
                owner_id,
                at,
            ],
        )?;
        insert_npc(
            &transaction,
            NpcInsert {
                campaign_id: &command.campaign_id,
                tavern_id: &tavern_id,
                npc_id: &owner_id,
                residency: "OWNER",
                visit_reason: None,
                character_id: &source.player_character_id,
            },
            &output.owner,
            &[],
            &at,
        )?;
        insert_generation(
            &transaction,
            &command.campaign_id,
            "GENERATE_TAVERN",
            &command.generation,
            &at,
        )?;
        transaction.commit()?;
        self.tavern_snapshot(&command.campaign_id)
    }

    pub fn commit_npc_roster_generation(
        &self,
        command: NpcRosterGenerationCommit,
    ) -> Result<TavernSnapshot, CampaignStoreError> {
        validate_id(&command.campaign_id)?;
        validate_id(&command.tavern_id)?;
        validate_audit(&command.generation, "GENERATE_NPCS")?;
        let output: NpcRosterOutput =
            serde_json::from_value(command.generation.validated_output.clone())
                .map_err(|_| CampaignStoreError::InvalidData)?;
        validate_roster_output(&output)?;

        let mut connection = self.connect()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        if replayed(
            &transaction,
            &command.generation.idempotency_key,
            &command.campaign_id,
            "GENERATE_NPCS",
        )? {
            let result = load_snapshot(&transaction, &command.campaign_id)?;
            transaction.commit()?;
            return Ok(result);
        }
        if campaign_state(&transaction, &command.campaign_id)? != "GENERATING_TAVERN" {
            return Err(CampaignStoreError::InvalidState);
        }
        let source = load_source(&transaction, &command.campaign_id)?;
        let tavern = load_tavern(&transaction, &command.campaign_id)?
            .ok_or(CampaignStoreError::InvalidState)?;
        if tavern.id != command.tavern_id || load_npcs(&transaction, &tavern.id)?.len() != 1 {
            return Err(CampaignStoreError::InvalidState);
        }
        let owner = load_npcs(&transaction, &tavern.id)?
            .into_iter()
            .next()
            .ok_or(CampaignStoreError::InvalidData)?;
        if output.npcs.iter().any(|npc| npc.profile.name == owner.name) {
            return Err(CampaignStoreError::InvalidData);
        }
        let expected_input = serde_json::json!({
            "world": source.world,
            "tavern": {
                "name": tavern.name,
                "position": tavern.position,
                "environment": tavern.environment,
                "longTermProblem": tavern.long_term_problem,
            },
            "existingNpcNames": [owner.name],
            "requestedCount": 3,
        });
        let expected_context = serde_json::json!({
            "source": source,
            "tavernId": tavern.id,
        });
        if command.generation.input != expected_input
            || command.generation.context != expected_context
        {
            return Err(CampaignStoreError::InvalidData);
        }

        let at = current_timestamp()?;
        let npc_ids = output
            .npcs
            .iter()
            .map(|_| Uuid::new_v4().to_string())
            .collect::<Vec<_>>();
        let rumor_ids = output
            .rumors
            .iter()
            .map(|_| Uuid::new_v4().to_string())
            .collect::<Vec<_>>();
        for (index, npc) in output.npcs.iter().enumerate() {
            let known_rumors = output
                .rumors
                .iter()
                .enumerate()
                .filter(|(_, rumor)| rumor.source_npc_name == npc.profile.name)
                .map(|(rumor_index, rumor)| (rumor_ids[rumor_index].clone(), rumor.confidence))
                .collect::<Vec<_>>();
            insert_npc(
                &transaction,
                NpcInsert {
                    campaign_id: &command.campaign_id,
                    tavern_id: &tavern.id,
                    npc_id: &npc_ids[index],
                    residency: &npc.residency,
                    visit_reason: npc.visit_reason.as_deref(),
                    character_id: &source.player_character_id,
                },
                &npc.profile,
                &known_rumors,
                &at,
            )?;
        }
        for (index, rumor) in output.rumors.iter().enumerate() {
            let source_index = output
                .npcs
                .iter()
                .position(|npc| npc.profile.name == rumor.source_npc_name)
                .ok_or(CampaignStoreError::InvalidData)?;
            transaction.execute(
                "INSERT INTO world_facts (
                   id, campaign_id, kind, statement, location_id,
                   faction_ids_json, detail_json, supersedes_fact_id, created_at
                 ) VALUES (?1, ?2, 'RUMOR', ?3, ?4, '[]', ?5, NULL, ?6)",
                params![
                    rumor_ids[index],
                    command.campaign_id,
                    rumor.statement,
                    tavern.location_id,
                    serde_json::json!({
                        "claimId": format!("claim-{}", rumor_ids[index]),
                        "claimRevision": 1,
                        "confidence": rumor.confidence,
                        "veracity": rumor.veracity,
                        "sourceNpcId": npc_ids[source_index],
                        "sourceBasis": rumor.source_basis,
                    })
                    .to_string(),
                    at,
                ],
            )?;
        }
        insert_initial_clocks(
            &transaction,
            &command.campaign_id,
            &source.world.core_conflict,
            &tavern.long_term_problem,
            &at,
        )?;
        insert_generation(
            &transaction,
            &command.campaign_id,
            "GENERATE_NPCS",
            &command.generation,
            &at,
        )?;
        let changed = transaction.execute(
            "UPDATE campaigns SET state = 'TAVERN', resume_state = NULL, updated_at = ?1
             WHERE id = ?2 AND state = 'GENERATING_TAVERN'",
            params![at, command.campaign_id],
        )?;
        if changed != 1 {
            return Err(CampaignStoreError::InvalidState);
        }
        transaction.commit()?;
        self.tavern_snapshot(&command.campaign_id)
    }
}

fn load_snapshot(
    connection: &Connection,
    campaign_id: &str,
) -> Result<TavernSnapshot, CampaignStoreError> {
    let state = campaign_state(connection, campaign_id)?;
    let source = load_source(connection, campaign_id)?;
    let tavern = load_tavern(connection, campaign_id)?;
    let (npcs, rumors) = match &tavern {
        None => (Vec::new(), Vec::new()),
        Some(value) => (
            load_npcs(connection, &value.id)?,
            load_rumors(connection, campaign_id)?,
        ),
    };
    Ok(TavernSnapshot {
        campaign_state: state,
        source,
        tavern,
        npcs,
        rumors,
        clocks: load_clocks(connection, campaign_id)?,
    })
}

fn load_source(
    connection: &Connection,
    campaign_id: &str,
) -> Result<TavernGenerationSource, CampaignStoreError> {
    let character = connection
        .query_row(
            "SELECT id, concept FROM player_characters WHERE campaign_id = ?1",
            [campaign_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()?
        .ok_or(CampaignStoreError::InvalidData)?;
    connection
        .query_row(
            "SELECT name, current_region, summary, core_conflict, technology_level,
                    power_rules_json, locations_json
             FROM world_bibles WHERE campaign_id = ?1",
            [campaign_id],
            |row| {
                let current_region = row.get::<_, String>(1)?;
                let locations: Vec<StoredLocation> = from_json(row.get::<_, String>(6)?)?;
                let location = locations
                    .iter()
                    .find(|location| location.name == current_region)
                    .or_else(|| locations.first())
                    .ok_or(rusqlite::Error::InvalidQuery)?;
                Ok(TavernGenerationSource {
                    player_character_id: character.0.clone(),
                    location_id: location.id.clone(),
                    world: TavernWorldContext {
                        name: row.get(0)?,
                        current_region,
                        summary: row.get(2)?,
                        core_conflict: row.get(3)?,
                        technology_level: row.get(4)?,
                        power_rules: from_json(row.get::<_, String>(5)?)?,
                    },
                    player_concept: character.1.clone(),
                    desired_position: None,
                })
            },
        )
        .optional()?
        .ok_or(CampaignStoreError::InvalidData)
}

fn load_tavern(
    connection: &Connection,
    campaign_id: &str,
) -> Result<Option<TavernView>, CampaignStoreError> {
    connection
        .query_row(
            "SELECT id, campaign_id, location_id, name, position, environment,
                    special_rules_json, long_term_problem, owner_npc_id, changes_json, created_at, updated_at
             FROM taverns WHERE campaign_id = ?1",
            [campaign_id],
            |row| {
                Ok(TavernView {
                    id: row.get(0)?,
                    campaign_id: row.get(1)?,
                    location_id: row.get(2)?,
                    name: row.get(3)?,
                    position: row.get(4)?,
                    environment: row.get(5)?,
                    special_rules: from_json(row.get::<_, String>(6)?)?,
                    long_term_problem: row.get(7)?,
                    owner_npc_id: row.get(8)?,
                    changes: from_json(row.get::<_, String>(9)?)?,
                    created_at: row.get(10)?,
                    updated_at: row.get(11)?,
                })
            },
        )
        .optional()
        .map_err(Into::into)
}

fn load_npcs(
    connection: &Connection,
    tavern_id: &str,
) -> Result<Vec<TavernNpcView>, CampaignStoreError> {
    let mut statement = connection.prepare(
        "SELECT id, residency, name, identity, appearance, personality,
                current_mood, current_status, visit_json
         FROM npcs WHERE tavern_id = ?1
         ORDER BY CASE residency WHEN 'OWNER' THEN 0 WHEN 'RESIDENT' THEN 1 ELSE 2 END,
                  created_at, id",
    )?;
    statement
        .query_map([tavern_id], |row| {
            let visit_json = row.get::<_, Option<String>>(8)?;
            let visit_reason = visit_json
                .map(|json| -> rusqlite::Result<Option<String>> {
                    let value: Value = from_json(json)?;
                    Ok(value
                        .as_object()
                        .and_then(|record| record.get("visitReason"))
                        .and_then(Value::as_str)
                        .map(str::to_owned))
                })
                .transpose()?
                .flatten();
            Ok(TavernNpcView {
                id: row.get(0)?,
                residency: row.get(1)?,
                name: row.get(2)?,
                identity: row.get(3)?,
                appearance: row.get(4)?,
                personality: row.get(5)?,
                current_mood: row.get(6)?,
                current_status: row.get(7)?,
                visit_reason,
            })
        })?
        .collect::<Result<Vec<_>, _>>()
        .map_err(Into::into)
}

fn load_rumors(
    connection: &Connection,
    campaign_id: &str,
) -> Result<Vec<RumorView>, CampaignStoreError> {
    let mut statement = connection.prepare(
        "SELECT id, statement, detail_json FROM world_facts
         WHERE campaign_id = ?1 AND kind = 'RUMOR' ORDER BY created_at, id",
    )?;
    statement
        .query_map([campaign_id], |row| {
            let detail: Value = from_json(row.get::<_, String>(2)?)?;
            let source = detail
                .as_object()
                .and_then(|record| record.get("sourceNpcId"))
                .and_then(Value::as_str)
                .ok_or(rusqlite::Error::InvalidQuery)?;
            let claim_id = detail
                .as_object()
                .and_then(|record| record.get("claimId"))
                .and_then(Value::as_str)
                .ok_or(rusqlite::Error::InvalidQuery)?;
            let source_basis = detail
                .as_object()
                .and_then(|record| record.get("sourceBasis"))
                .and_then(Value::as_str)
                .filter(|value| {
                    matches!(
                        *value,
                        "WITNESS" | "HEARSAY" | "PERSONAL_BELIEF" | "FACTION_MESSAGE"
                    )
                })
                .ok_or(rusqlite::Error::InvalidQuery)?;
            let confidence = detail
                .as_object()
                .and_then(|record| record.get("confidence"))
                .and_then(Value::as_f64)
                .filter(|value| value.is_finite() && (0.0..=1.0).contains(value))
                .ok_or(rusqlite::Error::InvalidQuery)?;
            let revision = detail
                .as_object()
                .and_then(|record| record.get("claimRevision"))
                .and_then(Value::as_i64)
                .filter(|value| *value >= 1)
                .ok_or(rusqlite::Error::InvalidQuery)?;
            let _ = (confidence, revision);
            Ok(RumorView {
                id: row.get(0)?,
                claim_id: claim_id.to_owned(),
                statement: row.get(1)?,
                source_npc_id: source.to_owned(),
                source_basis: source_basis.to_owned(),
            })
        })?
        .collect::<Result<Vec<_>, _>>()
        .map_err(Into::into)
}

fn load_clocks(
    connection: &Connection,
    campaign_id: &str,
) -> Result<Vec<WorldClockView>, CampaignStoreError> {
    let mut statement = connection.prepare(
        "SELECT id, name, current, max, stages_json FROM world_clocks
         WHERE campaign_id = ?1 ORDER BY created_at, id",
    )?;
    statement
        .query_map([campaign_id], |row| {
            Ok(WorldClockView {
                id: row.get(0)?,
                name: row.get(1)?,
                current: row.get(2)?,
                max: row.get(3)?,
                stages: from_json(row.get::<_, String>(4)?)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()
        .map_err(Into::into)
}

struct NpcInsert<'a> {
    campaign_id: &'a str,
    tavern_id: &'a str,
    npc_id: &'a str,
    residency: &'a str,
    visit_reason: Option<&'a str>,
    character_id: &'a str,
}

fn insert_npc(
    transaction: &Transaction<'_>,
    insert: NpcInsert<'_>,
    npc: &NpcDraft,
    known_facts: &[(String, f64)],
    at: &str,
) -> Result<(), CampaignStoreError> {
    let visit = insert.visit_reason.map(|reason| {
        serde_json::json!({
            "npcId": insert.npc_id,
            "tavernId": insert.tavern_id,
            "visitReason": reason,
            "arrivedAt": at,
            "plannedDepartureAt": null,
        })
        .to_string()
    });
    transaction.execute(
        "INSERT INTO npcs (
           id, campaign_id, tavern_id, residency, name, identity, appearance,
           personality, goal, secret, speech_style, current_mood, current_status,
           visit_json, memories_json, created_at, updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, 'ACTIVE', ?13, '[]', ?14, ?14)",
        params![
            insert.npc_id,
            insert.campaign_id,
            insert.tavern_id,
            insert.residency,
            npc.name,
            npc.identity,
            npc.appearance,
            npc.personality,
            npc.goal,
            npc.secret,
            npc.speech_style,
            npc.current_mood,
            visit,
            at,
        ],
    )?;
    transaction.execute(
        "INSERT INTO npc_knowledge (
           npc_id, known_fact_ids_json, suspected_fact_ids_json,
           false_belief_fact_ids_json, excluded_secret_fact_ids_json,
           provenance_json, updated_at
         ) VALUES (?1, ?2, '[]', '[]', '[]', ?3, ?4)",
        params![
            insert.npc_id,
            to_json(
                &known_facts
                    .iter()
                    .map(|(fact_id, _)| fact_id)
                    .collect::<Vec<_>>()
            )?,
            to_json(
                &known_facts
                    .iter()
                    .map(|(fact_id, confidence)| json!({
                        "factId": fact_id,
                        "state": "KNOWN",
                        "source": "LOCAL_RULE",
                        "eventId": null,
                        "learnedAt": at,
                        "confidence": confidence
                    }))
                    .collect::<Vec<_>>()
            )?,
            at
        ],
    )?;
    transaction.execute(
        "INSERT INTO npc_relationships (
           npc_id, player_character_id, trust, closeness, awe, obligation, updated_at
         ) VALUES (?1, ?2, 0, 0, 0, 0, ?3)",
        params![insert.npc_id, insert.character_id, at],
    )?;
    Ok(())
}

fn insert_initial_clocks(
    transaction: &Transaction<'_>,
    campaign_id: &str,
    core_conflict: &str,
    tavern_problem: &str,
    at: &str,
) -> Result<(), CampaignStoreError> {
    if transaction.query_row(
        "SELECT COUNT(*) FROM world_clocks WHERE campaign_id = ?1",
        [campaign_id],
        |row| row.get::<_, i64>(0),
    )? != 0
    {
        return Err(CampaignStoreError::InvalidState);
    }
    let story_hooks: Vec<String> = from_json(transaction.query_row(
        "SELECT story_hooks_json FROM world_bibles WHERE campaign_id = ?1",
        [campaign_id],
        |row| row.get(0),
    )?)?;
    let regional_development = story_hooks.first().ok_or(CampaignStoreError::InvalidData)?;
    let clocks = [
        ("世界冲突", core_conflict),
        ("酒馆长期问题", tavern_problem),
        ("区域局势", regional_development.as_str()),
    ];
    for (name, development) in clocks {
        transaction.execute(
            "INSERT INTO world_clocks (
               id, campaign_id, name, current, max, stages_json, created_at, updated_at
             ) VALUES (?1, ?2, ?3, 0, 6, ?4, ?5, ?5)",
            params![
                Uuid::new_v4().to_string(),
                campaign_id,
                name,
                serde_json::json!([
                    {"at": 2, "title": "迹象浮现"},
                    {"at": 4, "title": development},
                    {"at": 6, "title": "局势爆发"}
                ])
                .to_string(),
                at,
            ],
        )?;
    }
    Ok(())
}

fn validate_audit(
    audit: &TavernGenerationAudit,
    expected_task: &str,
) -> Result<(), CampaignStoreError> {
    validate_id(&audit.request_id)?;
    validate_id(&audit.generation_record_id)?;
    validate_id(&audit.idempotency_key)?;
    let raw: Value = serde_json::from_str(&audit.raw_response_text)
        .map_err(|_| CampaignStoreError::InvalidData)?;
    if audit.prompt_version < 1
        || !audit.input.is_object()
        || !audit.context.is_object()
        || audit
            .request
            .as_object()
            .and_then(|request| request.get("task"))
            .and_then(Value::as_str)
            != Some(expected_task)
        || raw != audit.validated_output
    {
        return Err(CampaignStoreError::InvalidData);
    }
    Ok(())
}

fn validate_tavern_output(output: &TavernOutput) -> Result<(), CampaignStoreError> {
    validate_text(&output.name, 200)?;
    validate_text(&output.position, 200)?;
    validate_text(&output.environment, 4_000)?;
    validate_text(&output.long_term_problem, 4_000)?;
    validate_text_list(&output.special_rules, 0, 20, 4_000)?;
    validate_npc(&output.owner)
}

fn validate_roster_output(output: &NpcRosterOutput) -> Result<(), CampaignStoreError> {
    if output.npcs.len() != 3
        || output
            .npcs
            .iter()
            .filter(|npc| npc.residency == "RESIDENT")
            .count()
            != 2
        || output
            .npcs
            .iter()
            .filter(|npc| npc.residency == "TEMPORARY_VISITOR")
            .count()
            != 1
        || output.rumors.len() != 3
    {
        return Err(CampaignStoreError::InvalidData);
    }
    let mut names = HashSet::new();
    for npc in &output.npcs {
        validate_npc(&npc.profile)?;
        if !names.insert(npc.profile.name.as_str())
            || (npc.residency == "TEMPORARY_VISITOR") != npc.visit_reason.is_some()
        {
            return Err(CampaignStoreError::InvalidData);
        }
        if let Some(reason) = &npc.visit_reason {
            validate_text(reason, 4_000)?;
        }
    }
    for rumor in &output.rumors {
        validate_text(&rumor.statement, 4_000)?;
        if !names.contains(rumor.source_npc_name.as_str())
            || !matches!(
                rumor.source_basis.as_str(),
                "WITNESS" | "HEARSAY" | "PERSONAL_BELIEF" | "FACTION_MESSAGE"
            )
            || !rumor.confidence.is_finite()
            || !(0.0..=1.0).contains(&rumor.confidence)
            || !["UNKNOWN", "TRUE", "PARTIAL", "FALSE"].contains(&rumor.veracity.as_str())
        {
            return Err(CampaignStoreError::InvalidData);
        }
    }
    Ok(())
}

fn validate_npc(npc: &NpcDraft) -> Result<(), CampaignStoreError> {
    validate_text(&npc.name, 200)?;
    validate_text(&npc.identity, 200)?;
    validate_text(&npc.appearance, 4_000)?;
    validate_text(&npc.personality, 4_000)?;
    validate_text(&npc.goal, 4_000)?;
    validate_text(&npc.secret, 4_000)?;
    validate_text(&npc.speech_style, 4_000)?;
    validate_text(&npc.current_mood, 200)
}

fn validate_text(value: &str, max: usize) -> Result<(), CampaignStoreError> {
    if value.is_empty() || value.trim() != value || value.chars().count() > max {
        return Err(CampaignStoreError::InvalidData);
    }
    Ok(())
}

fn validate_text_list(
    values: &[String],
    min: usize,
    max: usize,
    text_max: usize,
) -> Result<(), CampaignStoreError> {
    if values.len() < min || values.len() > max {
        return Err(CampaignStoreError::InvalidData);
    }
    values
        .iter()
        .try_for_each(|value| validate_text(value, text_max))
}

fn insert_generation(
    transaction: &Transaction<'_>,
    campaign_id: &str,
    task: &str,
    audit: &TavernGenerationAudit,
    at: &str,
) -> Result<(), CampaignStoreError> {
    transaction.execute(
        "INSERT INTO pending_ai_requests (
           id, campaign_id, turn_id, idempotency_key, task, status, model_profile_id,
           input_json, context_json, attempt_count, last_error_json, created_at, updated_at
         ) VALUES (?1, ?2, NULL, ?3, ?4, 'COMMITTED', NULL, ?5, ?6, 1, NULL, ?7, ?7)",
        params![
            audit.request_id,
            campaign_id,
            audit.idempotency_key,
            task,
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
         ) VALUES (?1, ?2, ?3, ?4, NULL, ?5, ?6, ?7, ?8, NULL, ?9, ?9)",
        params![
            audit.generation_record_id,
            campaign_id,
            audit.request_id,
            task,
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
    task: &str,
) -> Result<bool, CampaignStoreError> {
    let prior = connection
        .query_row(
            "SELECT campaign_id, task, status FROM pending_ai_requests
             WHERE idempotency_key = ?1",
            [idempotency_key],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            },
        )
        .optional()?;
    match prior {
        None => Ok(false),
        Some((stored_campaign, stored_task, status))
            if stored_campaign == campaign_id && stored_task == task && status == "COMMITTED" =>
        {
            Ok(true)
        }
        Some(_) => Err(CampaignStoreError::InvalidState),
    }
}

fn campaign_state(
    connection: &Connection,
    campaign_id: &str,
) -> Result<String, CampaignStoreError> {
    connection
        .query_row(
            "SELECT state FROM campaigns WHERE id = ?1",
            [campaign_id],
            |row| row.get(0),
        )
        .optional()?
        .ok_or(CampaignStoreError::NotFound)
}

fn tavern_for_campaign(
    connection: &Connection,
    campaign_id: &str,
) -> Result<Option<String>, CampaignStoreError> {
    connection
        .query_row(
            "SELECT id FROM taverns WHERE campaign_id = ?1",
            [campaign_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(Into::into)
}

fn to_json(value: &impl Serialize) -> Result<String, CampaignStoreError> {
    serde_json::to_string(value).map_err(|_| CampaignStoreError::InvalidData)
}

fn from_json<T: for<'de> Deserialize<'de>>(value: String) -> rusqlite::Result<T> {
    serde_json::from_str(&value).map_err(|_| rusqlite::Error::InvalidQuery)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn initializes_tavern_roster_rumors_and_clocks_across_reopen() {
        let directory = tempfile::tempdir().expect("temp directory");
        let database_path = directory.path().join("ember-tavern.sqlite");
        let store = CampaignStore::open(&database_path).expect("open database");
        seed_tavern_campaign(&store);

        let tavern = store
            .commit_tavern_generation(tavern_command(&store))
            .expect("commit tavern");
        assert_eq!(tavern.npcs.len(), 1);
        assert_eq!(tavern.npcs[0].residency, "OWNER");
        drop(store);

        let reopened = CampaignStore::open(&database_path).expect("reopen after tavern");
        let resumed = reopened
            .tavern_snapshot("campaign-tavern")
            .expect("resume roster generation");
        let tavern_id = resumed.tavern.expect("stored tavern").id;
        let completed = reopened
            .commit_npc_roster_generation(roster_command(&reopened, tavern_id))
            .expect("commit roster");
        assert_eq!(completed.campaign_state, "TAVERN");
        assert_eq!(completed.npcs.len(), 4);
        assert_eq!(
            completed
                .npcs
                .iter()
                .filter(|npc| npc.residency == "RESIDENT")
                .count(),
            2
        );
        assert_eq!(
            completed
                .npcs
                .iter()
                .filter(|npc| npc.residency == "TEMPORARY_VISITOR")
                .count(),
            1
        );
        assert_eq!(completed.rumors.len(), 3);
        assert!(completed.rumors.iter().all(|rumor| {
            rumor.claim_id.starts_with("claim-")
                && matches!(
                    rumor.source_basis.as_str(),
                    "WITNESS" | "HEARSAY" | "PERSONAL_BELIEF" | "FACTION_MESSAGE"
                )
        }));
        assert!(
            !serde_json::to_string(&completed.rumors)
                .expect("serialize player rumor view")
                .contains("veracity")
        );
        assert_eq!(completed.clocks.len(), 3);
        assert!(
            completed
                .clocks
                .iter()
                .all(|clock| clock.current == 0 && clock.max == 6)
        );
        drop(reopened);

        let final_store = CampaignStore::open(database_path).expect("reopen complete tavern");
        let restored = final_store
            .tavern_snapshot("campaign-tavern")
            .expect("restore tavern");
        assert_eq!(restored.npcs, completed.npcs);
        assert_eq!(restored.rumors, completed.rumors);
        assert_eq!(restored.clocks, completed.clocks);
        let connection = final_store.connect().expect("inspect provenance");
        let mut statement = connection
            .prepare("SELECT provenance_json FROM npc_knowledge ORDER BY npc_id")
            .expect("prepare provenance query");
        let rows = statement
            .query_map([], |row| row.get::<_, String>(0))
            .expect("query provenance")
            .collect::<Result<Vec<_>, _>>()
            .expect("collect provenance");
        assert_eq!(rows.len(), 4);
        assert!(rows.iter().all(|row| {
            serde_json::from_str::<Vec<Value>>(row).is_ok_and(|entries| {
                entries.iter().all(|entry| {
                    entry["source"] == "LOCAL_RULE"
                        && entry["state"] == "KNOWN"
                        && entry["eventId"].is_null()
                        && entry["learnedAt"].as_str().is_some()
                        && entry["confidence"]
                            .as_f64()
                            .is_some_and(|value| (0.0..=1.0).contains(&value))
                })
            })
        }));
    }

    #[test]
    fn rejects_tampered_generation_and_invalid_roster_without_partial_writes() {
        let directory = tempfile::tempdir().expect("temp directory");
        let store =
            CampaignStore::open(directory.path().join("ember-tavern.sqlite")).expect("open");
        seed_tavern_campaign(&store);
        let mut tampered = tavern_command(&store);
        tampered.generation.raw_response_text = "{}".to_owned();
        assert!(matches!(
            store.commit_tavern_generation(tampered),
            Err(CampaignStoreError::InvalidData)
        ));
        assert!(
            store
                .tavern_snapshot("campaign-tavern")
                .expect("snapshot")
                .tavern
                .is_none()
        );

        let created = store
            .commit_tavern_generation(tavern_command(&store))
            .expect("valid tavern");
        let mut invalid = roster_command(&store, created.tavern.expect("tavern").id);
        invalid.generation.validated_output["npcs"][0]["residency"] =
            Value::String("TEMPORARY_VISITOR".to_owned());
        invalid.generation.raw_response_text = invalid.generation.validated_output.to_string();
        assert!(matches!(
            store.commit_npc_roster_generation(invalid),
            Err(CampaignStoreError::InvalidData)
        ));
        let tavern_id = store
            .tavern_snapshot("campaign-tavern")
            .expect("snapshot after invalid residency")
            .tavern
            .expect("tavern")
            .id;
        let mut duplicate_owner = roster_command(&store, tavern_id.clone());
        duplicate_owner.generation.validated_output["npcs"][0]["name"] =
            Value::String("Ilyra Venn".to_owned());
        duplicate_owner.generation.raw_response_text =
            duplicate_owner.generation.validated_output.to_string();
        assert!(matches!(
            store.commit_npc_roster_generation(duplicate_owner),
            Err(CampaignStoreError::InvalidData)
        ));
        let mut invalid_rumor_source = roster_command(&store, tavern_id);
        invalid_rumor_source.generation.validated_output["rumors"][0]["confidence"] = json!(2.0);
        invalid_rumor_source.generation.raw_response_text =
            invalid_rumor_source.generation.validated_output.to_string();
        assert!(matches!(
            store.commit_npc_roster_generation(invalid_rumor_source),
            Err(CampaignStoreError::InvalidData)
        ));
        let snapshot = store
            .tavern_snapshot("campaign-tavern")
            .expect("unchanged snapshot");
        assert_eq!(snapshot.campaign_state, "GENERATING_TAVERN");
        assert_eq!(snapshot.npcs.len(), 1);
        assert!(snapshot.rumors.is_empty());
        assert!(snapshot.clocks.is_empty());
    }

    fn seed_tavern_campaign(store: &CampaignStore) {
        store
            .create_at(
                "campaign-tavern".to_owned(),
                "2026-07-31T01:00:00.000Z".to_owned(),
            )
            .expect("create campaign");
        let connection = store.connect().expect("connection");
        connection
            .execute(
                "UPDATE campaigns SET state = 'GENERATING_TAVERN'
                 WHERE id = 'campaign-tavern'",
                [],
            )
            .expect("advance campaign");
        connection
            .execute(
                "INSERT INTO world_bibles (
                   campaign_id, schema_version, name, current_region, summary, core_conflict,
                   technology_level, power_rules_json, factions_json, locations_json,
                   narrative_style, forbidden_elements_json, tavern_reason, story_hooks_json,
                   locked_fields_json, created_at, updated_at
                 ) VALUES (
                   'campaign-tavern', 1, 'Ember Coast', 'Ash Harbor', 'A storm-bound coast.',
                   'The lighthouse has gone dark.', 'Early industrial', '[\"Weather magic has a cost.\"]',
                   '[]', '[{\"id\":\"location-harbor\",\"name\":\"Ash Harbor\",\"description\":\"A port.\",\"parentId\":null,\"factionIds\":[]}]',
                   'Grounded mystery.', '[]', 'Travelers wait out storms.',
                   '[\"A light moves beneath the harbor.\"]', '[]',
                   '2026-07-31T01:00:00.000Z', '2026-07-31T01:00:00.000Z'
                 )",
                [],
            )
            .expect("insert world");
        connection
            .execute(
                "INSERT INTO player_characters (
                   id, campaign_id, name, gender, age, concept, story_preferences_json,
                   content_boundaries_json, class_archetype, class_display_name,
                   attributes_json, traits_json, personal_goal, background_json,
                   initial_equipment_ids_json, created_at, updated_at
                 ) VALUES (
                   'character-tavern', 'campaign-tavern', 'Mira', NULL, 27, 'Curious scout',
                   '[\"Exploration\"]',
                   '{\"allowHorror\":false,\"allowPermanentDeath\":false,\"allowRomance\":true,\"allowBetrayal\":true,\"excludedContent\":[]}',
                   'ROGUE', 'Wayfinder',
                   '{\"physique\":2,\"agility\":4,\"knowledge\":3,\"charisma\":1}',
                   '[]', 'Find a lost sibling.',
                   '{\"birthplace\":\"North Road\"}', '[]',
                   '2026-07-31T01:00:00.000Z', '2026-07-31T01:00:00.000Z'
                 )",
                [],
            )
            .expect("insert character");
    }

    fn tavern_command(store: &CampaignStore) -> TavernGenerationCommit {
        let source = store
            .tavern_snapshot("campaign-tavern")
            .expect("source")
            .source;
        let output = serde_json::json!({
            "name": "Ember Rest",
            "position": "The harbor crossroads",
            "environment": "A warm stone hall filled with salt air.",
            "specialRules": ["Weapons remain sheathed beside the common fire."],
            "longTermProblem": "A strange light appears beneath the cellar.",
            "owner": npc_json("Ilyra Venn"),
        });
        TavernGenerationCommit {
            campaign_id: "campaign-tavern".to_owned(),
            generation: audit(
                "tavern",
                "GENERATE_TAVERN",
                serde_json::json!({
                    "world": source.world,
                    "playerConcept": source.player_concept,
                    "desiredPosition": source.desired_position,
                }),
                serde_json::json!({"source": source}),
                output,
            ),
        }
    }

    fn roster_command(store: &CampaignStore, tavern_id: String) -> NpcRosterGenerationCommit {
        let snapshot = store.tavern_snapshot("campaign-tavern").expect("snapshot");
        let source = snapshot.source;
        let tavern = snapshot.tavern.expect("tavern");
        let owner = snapshot.npcs.first().expect("owner");
        let output = serde_json::json!({
            "npcs": [
                roster_npc("RESIDENT", "Tomas Reed", Value::Null),
                roster_npc("RESIDENT", "Nessa Vale", Value::Null),
                roster_npc(
                    "TEMPORARY_VISITOR",
                    "Sera Holt",
                    Value::String("Waiting for the causeway.".to_owned()),
                ),
            ],
            "rumors": [
                {"statement":"A light moves below the cellar.","sourceNpcName":"Tomas Reed","sourceBasis":"WITNESS","confidence":0.9,"veracity":"TRUE"},
                {"statement":"The guild pays for tunnel maps.","sourceNpcName":"Nessa Vale","sourceBasis":"FACTION_MESSAGE","confidence":0.6,"veracity":"PARTIAL"},
                {"statement":"The courier crossed alone.","sourceNpcName":"Sera Holt","sourceBasis":"HEARSAY","confidence":0.4,"veracity":"UNKNOWN"},
            ],
        });
        NpcRosterGenerationCommit {
            campaign_id: "campaign-tavern".to_owned(),
            tavern_id: tavern_id.clone(),
            generation: audit(
                "npcs",
                "GENERATE_NPCS",
                serde_json::json!({
                    "world": source.world,
                    "tavern": {
                        "name": tavern.name,
                        "position": tavern.position,
                        "environment": tavern.environment,
                        "longTermProblem": tavern.long_term_problem,
                    },
                    "existingNpcNames": [owner.name],
                    "requestedCount": 3,
                }),
                serde_json::json!({"source": source, "tavernId": tavern_id}),
                output,
            ),
        }
    }

    fn npc_json(name: &str) -> Value {
        serde_json::json!({
            "name": name,
            "identity": "Traveler",
            "appearance": "Weathered clothes.",
            "personality": "Observant and practical.",
            "goal": "Keep the road open.",
            "secret": "Knows a hidden route.",
            "speechStyle": "Measured questions.",
            "currentMood": "Concerned",
        })
    }

    fn roster_npc(residency: &str, name: &str, visit_reason: Value) -> Value {
        let mut npc = npc_json(name);
        npc["residency"] = Value::String(residency.to_owned());
        npc["visitReason"] = visit_reason;
        npc
    }

    fn audit(
        suffix: &str,
        task: &str,
        input: Value,
        context: Value,
        output: Value,
    ) -> TavernGenerationAudit {
        TavernGenerationAudit {
            request_id: format!("request-{suffix}"),
            generation_record_id: format!("generation-{suffix}"),
            idempotency_key: format!("tavern:{suffix}"),
            prompt_version: 1,
            input,
            context,
            request: serde_json::json!({"task": task}),
            raw_response_text: output.to_string(),
            validated_output: output,
        }
    }
}

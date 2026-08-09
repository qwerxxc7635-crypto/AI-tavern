use rusqlite::{Connection, OptionalExtension, Transaction, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use uuid::Uuid;

use crate::{
    CampaignStore, CampaignStoreError, TavernGenerationAudit, current_timestamp,
    repetition::find_repeated_phrase, repetition::quest_structure_signature, validate_id,
};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuestWorldContext {
    pub name: String,
    pub current_region: String,
    pub summary: String,
    pub core_conflict: String,
    pub technology_level: String,
    pub power_rules: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuestNpcBrief {
    pub id: String,
    pub name: String,
    pub identity: String,
    pub personality: String,
    pub goal: String,
    pub current_mood: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuestGenerationSource {
    pub tavern_id: String,
    pub tavern_name: String,
    pub player_character_id: String,
    pub player_concept: String,
    pub world: QuestWorldContext,
    pub available_npcs: Vec<QuestNpcBrief>,
    pub recent_quest_titles: Vec<String>,
    pub recent_quest_structures: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuestContentView {
    pub title: String,
    pub summary: String,
    pub objective: String,
    pub failure_cost: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuestView {
    pub id: String,
    pub publisher_npc_id: String,
    pub publisher_name: String,
    pub content: QuestContentView,
    pub status: String,
    pub risk: String,
    pub recommended_attributes: Vec<String>,
    pub expected_turns_min: i64,
    pub expected_turns_max: i64,
    pub reward_tier: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuestBoardSnapshot {
    pub campaign_id: String,
    pub campaign_state: String,
    pub source: QuestGenerationSource,
    pub quests: Vec<QuestView>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QuestGenerationCommit {
    pub campaign_id: String,
    pub publisher_npc_id: String,
    pub generation: TavernGenerationAudit,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct QuestContent {
    title: String,
    summary: String,
    objective: String,
    #[serde(rename = "failureCost")]
    failure_cost: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct QuestOutput {
    content: QuestContent,
    risk: String,
    recommended_attributes: Vec<String>,
    expected_turns: TurnRange,
    reward_tier: String,
    related_npc_ids: Vec<String>,
    related_fact_ids: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct TurnRange {
    min: i64,
    max: i64,
}

impl CampaignStore {
    pub fn quest_board_snapshot(
        &self,
        campaign_id: &str,
    ) -> Result<QuestBoardSnapshot, CampaignStoreError> {
        validate_id(campaign_id)?;
        let connection = self.connect()?;
        load_snapshot(&connection, campaign_id)
    }

    pub fn commit_quest_generation(
        &self,
        command: QuestGenerationCommit,
    ) -> Result<QuestBoardSnapshot, CampaignStoreError> {
        validate_id(&command.campaign_id)?;
        validate_id(&command.publisher_npc_id)?;
        validate_audit(&command.generation)?;
        let output: QuestOutput =
            serde_json::from_value(command.generation.validated_output.clone())
                .map_err(|_| CampaignStoreError::InvalidData)?;
        validate_output(&output)?;

        let mut connection = self.connect()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        if replayed(
            &transaction,
            &command.generation.idempotency_key,
            &command.campaign_id,
            &command.publisher_npc_id,
        )? {
            let result = load_snapshot(&transaction, &command.campaign_id)?;
            transaction.commit()?;
            return Ok(result);
        }
        let source = load_source(&transaction, &command.campaign_id)?;
        if !source
            .available_npcs
            .iter()
            .any(|npc| npc.id == command.publisher_npc_id)
        {
            return Err(CampaignStoreError::InvalidData);
        }
        let publisher = source
            .available_npcs
            .iter()
            .find(|npc| npc.id == command.publisher_npc_id)
            .ok_or(CampaignStoreError::InvalidData)?;
        let expected_input = json!({
            "world": source.world,
            "tavernName": source.tavern_name,
            "publisher": publisher,
            "availableNpcs": source.available_npcs,
            "playerConcept": source.player_concept,
            "recentQuestTitles": source.recent_quest_titles,
            "recentQuestStructures": source.recent_quest_structures,
        });
        if command.generation.input != expected_input
            || command.generation.context
                != json!({
                    "tavernId": source.tavern_id,
                    "playerCharacterId": source.player_character_id,
                    "publisherNpcId": command.publisher_npc_id,
                })
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
        if source.recent_quest_structures.contains(&structure) {
            return Err(CampaignStoreError::InvalidData);
        }
        validate_references(&transaction, &command.campaign_id, &source, &output)?;

        let at = current_timestamp()?;
        insert_generation(&transaction, &command.campaign_id, &command.generation, &at)?;
        transaction.execute(
            "INSERT INTO quests (
               id, campaign_id, publisher_npc_id, content_json, status, risk,
               recommended_attributes_json, expected_turns_min, expected_turns_max,
               reward_tier, related_npc_ids_json, related_fact_ids_json, created_at, updated_at
             ) VALUES (
               ?1, ?2, ?3, ?4, 'AVAILABLE', ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?12
             )",
            params![
                Uuid::new_v4().to_string(),
                command.campaign_id,
                command.publisher_npc_id,
                serde_json::to_string(&output.content)
                    .map_err(|_| CampaignStoreError::InvalidData)?,
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
                at,
            ],
        )?;
        transaction.commit()?;
        self.quest_board_snapshot(&command.campaign_id)
    }

    pub fn accept_quest(
        &self,
        campaign_id: &str,
        quest_id: &str,
    ) -> Result<QuestBoardSnapshot, CampaignStoreError> {
        validate_id(campaign_id)?;
        validate_id(quest_id)?;
        let mut connection = self.connect()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        require_tavern_campaign(&transaction, campaign_id)?;
        let status = transaction
            .query_row(
                "SELECT status FROM quests WHERE id = ?1 AND campaign_id = ?2",
                params![quest_id, campaign_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?
            .ok_or(CampaignStoreError::NotFound)?;
        if status == "ACCEPTED" {
            let result = load_snapshot(&transaction, campaign_id)?;
            transaction.commit()?;
            return Ok(result);
        }
        if status != "AVAILABLE" {
            return Err(CampaignStoreError::InvalidState);
        }
        let active: i64 = transaction.query_row(
            "SELECT COUNT(*) FROM quests
             WHERE campaign_id = ?1 AND status IN ('ACCEPTED', 'ACTIVE')",
            [campaign_id],
            |row| row.get(0),
        )?;
        if active != 0 {
            return Err(CampaignStoreError::InvalidState);
        }
        let at = current_timestamp()?;
        transaction.execute(
            "UPDATE quests SET status = 'ACCEPTED', updated_at = ?1
             WHERE id = ?2 AND campaign_id = ?3 AND status = 'AVAILABLE'",
            params![at, quest_id, campaign_id],
        )?;
        transaction.execute(
            "UPDATE campaigns SET updated_at = ?1 WHERE id = ?2",
            params![at, campaign_id],
        )?;
        let result = load_snapshot(&transaction, campaign_id)?;
        transaction.commit()?;
        Ok(result)
    }
}

fn load_snapshot(
    connection: &Connection,
    campaign_id: &str,
) -> Result<QuestBoardSnapshot, CampaignStoreError> {
    let campaign_state = require_tavern_campaign(connection, campaign_id)?;
    Ok(QuestBoardSnapshot {
        campaign_id: campaign_id.to_owned(),
        campaign_state,
        source: load_source(connection, campaign_id)?,
        quests: load_quests(connection, campaign_id)?,
    })
}

fn load_source(
    connection: &Connection,
    campaign_id: &str,
) -> Result<QuestGenerationSource, CampaignStoreError> {
    require_tavern_campaign(connection, campaign_id)?;
    let world = connection
        .query_row(
            "SELECT name, current_region, summary, core_conflict, technology_level,
                    power_rules_json
             FROM world_bibles WHERE campaign_id = ?1",
            [campaign_id],
            |row| {
                Ok(QuestWorldContext {
                    name: row.get(0)?,
                    current_region: row.get(1)?,
                    summary: row.get(2)?,
                    core_conflict: row.get(3)?,
                    technology_level: row.get(4)?,
                    power_rules: from_json(row.get(5)?)?,
                })
            },
        )
        .optional()?
        .ok_or(CampaignStoreError::InvalidData)?;
    let (tavern_id, tavern_name): (String, String) = connection
        .query_row(
            "SELECT id, name FROM taverns WHERE campaign_id = ?1",
            [campaign_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?
        .ok_or(CampaignStoreError::InvalidData)?;
    let (player_character_id, player_concept): (String, String) = connection
        .query_row(
            "SELECT id, concept FROM player_characters WHERE campaign_id = ?1",
            [campaign_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?
        .ok_or(CampaignStoreError::InvalidData)?;
    let mut statement = connection.prepare(
        "SELECT id, name, identity, personality, goal, current_mood
         FROM npcs
         WHERE campaign_id = ?1 AND tavern_id = ?2 AND current_status = 'ACTIVE'
         ORDER BY CASE residency WHEN 'OWNER' THEN 0 WHEN 'RESIDENT' THEN 1 ELSE 2 END,
                  created_at, id",
    )?;
    let available_npcs = statement
        .query_map(params![campaign_id, tavern_id], |row| {
            Ok(QuestNpcBrief {
                id: row.get(0)?,
                name: row.get(1)?,
                identity: row.get(2)?,
                personality: row.get(3)?,
                goal: row.get(4)?,
                current_mood: row.get(5)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    if available_npcs.is_empty() {
        return Err(CampaignStoreError::InvalidData);
    }
    let recent_quests = load_quests(connection, campaign_id)?
        .into_iter()
        .rev()
        .take(20)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<Vec<_>>();
    let recent_quest_titles = recent_quests
        .iter()
        .map(|quest| quest.content.title.clone())
        .collect();
    let recent_quest_structures = recent_quests
        .iter()
        .map(|quest| {
            quest_structure_signature(
                &quest.risk,
                &quest.reward_tier,
                quest.expected_turns_min,
                quest.expected_turns_max,
                &quest.recommended_attributes,
            )
        })
        .collect();
    Ok(QuestGenerationSource {
        tavern_id,
        tavern_name,
        player_character_id,
        player_concept,
        world,
        available_npcs,
        recent_quest_titles,
        recent_quest_structures,
    })
}

fn load_quests(
    connection: &Connection,
    campaign_id: &str,
) -> Result<Vec<QuestView>, CampaignStoreError> {
    let mut statement = connection.prepare(
        "SELECT q.id, q.publisher_npc_id, n.name, q.content_json, q.status, q.risk,
                q.recommended_attributes_json, q.expected_turns_min, q.expected_turns_max,
                q.reward_tier, q.created_at, q.updated_at
         FROM quests q
         JOIN npcs n ON n.id = q.publisher_npc_id
         WHERE q.campaign_id = ?1
         ORDER BY q.created_at, q.id",
    )?;
    Ok(statement
        .query_map([campaign_id], |row| {
            let content: QuestContent = from_json(row.get(3)?)?;
            Ok(QuestView {
                id: row.get(0)?,
                publisher_npc_id: row.get(1)?,
                publisher_name: row.get(2)?,
                content: QuestContentView {
                    title: content.title,
                    summary: content.summary,
                    objective: content.objective,
                    failure_cost: content.failure_cost,
                },
                status: row.get(4)?,
                risk: row.get(5)?,
                recommended_attributes: from_json(row.get(6)?)?,
                expected_turns_min: row.get(7)?,
                expected_turns_max: row.get(8)?,
                reward_tier: row.get(9)?,
                created_at: row.get(10)?,
                updated_at: row.get(11)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?)
}

fn require_tavern_campaign(
    connection: &Connection,
    campaign_id: &str,
) -> Result<String, CampaignStoreError> {
    let state = connection
        .query_row(
            "SELECT state FROM campaigns WHERE id = ?1",
            [campaign_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .ok_or(CampaignStoreError::NotFound)?;
    if state == "TAVERN" {
        Ok(state)
    } else {
        Err(CampaignStoreError::InvalidState)
    }
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
            != Some("GENERATE_QUEST")
        || raw != audit.validated_output
    {
        return Err(CampaignStoreError::InvalidData);
    }
    Ok(())
}

fn validate_output(output: &QuestOutput) -> Result<(), CampaignStoreError> {
    for value in [
        &output.content.title,
        &output.content.summary,
        &output.content.objective,
        &output.content.failure_cost,
    ] {
        validate_text(value, 4_000)?;
    }
    if find_repeated_phrase([
        output.content.title.as_str(),
        output.content.summary.as_str(),
        output.content.objective.as_str(),
        output.content.failure_cost.as_str(),
    ])
    .is_some()
    {
        return Err(CampaignStoreError::InvalidData);
    }
    if !["LOW", "MODERATE", "HIGH", "EXTREME"].contains(&output.risk.as_str())
        || !["BASIC", "NOTABLE", "RARE", "LEGENDARY"].contains(&output.reward_tier.as_str())
        || output.expected_turns.min < 8
        || output.expected_turns.max > 12
        || output.expected_turns.max < output.expected_turns.min
        || output.recommended_attributes.is_empty()
        || output.recommended_attributes.len() > 4
    {
        return Err(CampaignStoreError::InvalidData);
    }
    for attribute in &output.recommended_attributes {
        if !["physique", "agility", "knowledge", "charisma"].contains(&attribute.as_str()) {
            return Err(CampaignStoreError::InvalidData);
        }
    }
    for id in output
        .related_npc_ids
        .iter()
        .chain(output.related_fact_ids.iter())
    {
        validate_id(id)?;
    }
    Ok(())
}

fn validate_references(
    connection: &Connection,
    campaign_id: &str,
    source: &QuestGenerationSource,
    output: &QuestOutput,
) -> Result<(), CampaignStoreError> {
    if output
        .related_npc_ids
        .iter()
        .any(|id| !source.available_npcs.iter().any(|npc| &npc.id == id))
    {
        return Err(CampaignStoreError::InvalidData);
    }
    for id in &output.related_fact_ids {
        let exists = connection
            .query_row(
                "SELECT 1 FROM world_facts WHERE id = ?1 AND campaign_id = ?2",
                params![id, campaign_id],
                |_| Ok(()),
            )
            .optional()?
            .is_some();
        if !exists {
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
         ) VALUES (?1, ?2, NULL, ?3, 'GENERATE_QUEST', 'COMMITTED', NULL, ?4, ?5, 1, NULL, ?6, ?6)",
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
         ) VALUES (?1, ?2, ?3, 'GENERATE_QUEST', NULL, ?4, ?5, ?6, ?7, NULL, ?8, ?8)",
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
    publisher_npc_id: &str,
) -> Result<bool, CampaignStoreError> {
    let prior = connection
        .query_row(
            "SELECT campaign_id, task, status, context_json FROM pending_ai_requests
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
        Some((stored_campaign, task, status, context))
            if stored_campaign == campaign_id
                && task == "GENERATE_QUEST"
                && status == "COMMITTED"
                && serde_json::from_str::<Value>(&context)
                    .ok()
                    .and_then(|value| value.get("publisherNpcId")?.as_str().map(str::to_owned))
                    .as_deref()
                    == Some(publisher_npc_id) =>
        {
            Ok(true)
        }
        Some(_) => Err(CampaignStoreError::InvalidState),
    }
}

fn from_json<T: for<'de> Deserialize<'de>>(value: String) -> rusqlite::Result<T> {
    serde_json::from_str(&value).map_err(|_| rusqlite::Error::InvalidQuery)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generates_two_quests_accepts_one_and_restores_after_reopen() {
        let directory = tempfile::tempdir().expect("temp directory");
        let database_path = directory.path().join("ember-tavern.sqlite");
        let store = CampaignStore::open(&database_path).expect("open database");
        seed_board(&store);
        let initial = store
            .quest_board_snapshot("campaign-quests")
            .expect("initial board");
        let first = store
            .commit_quest_generation(command(&initial, "npc-owner", 1))
            .expect("first quest");
        let second = store
            .commit_quest_generation(command(&first, "npc-resident", 2))
            .expect("second quest");
        assert_eq!(second.quests.len(), 2);
        let first_id = second.quests[0].id.clone();
        let second_id = second.quests[1].id.clone();
        drop(store);

        let reopened = CampaignStore::open(&database_path).expect("reopen database");
        let restored = reopened
            .quest_board_snapshot("campaign-quests")
            .expect("restore board");
        assert_eq!(restored.quests.len(), 2);
        let accepted = reopened
            .accept_quest("campaign-quests", &first_id)
            .expect("accept first");
        assert_eq!(accepted.quests[0].status, "ACCEPTED");
        assert!(matches!(
            reopened.accept_quest("campaign-quests", &second_id),
            Err(CampaignStoreError::InvalidState)
        ));
        drop(reopened);

        let reopened_again = CampaignStore::open(&database_path).expect("reopen accepted");
        assert_eq!(
            reopened_again
                .quest_board_snapshot("campaign-quests")
                .expect("accepted board")
                .quests[0]
                .status,
            "ACCEPTED"
        );
    }

    #[test]
    fn rejects_tampered_quest_generation_without_partial_writes() {
        let directory = tempfile::tempdir().expect("temp directory");
        let store =
            CampaignStore::open(directory.path().join("ember-tavern.sqlite")).expect("open");
        seed_board(&store);
        let snapshot = store
            .quest_board_snapshot("campaign-quests")
            .expect("initial board");
        let mut invalid = command(&snapshot, "npc-owner", 1);
        invalid.generation.input["playerConcept"] = json!("Fabricated concept");

        assert!(matches!(
            store.commit_quest_generation(invalid),
            Err(CampaignStoreError::InvalidData)
        ));
        assert!(
            store
                .quest_board_snapshot("campaign-quests")
                .expect("unchanged board")
                .quests
                .is_empty()
        );

        let first = store
            .commit_quest_generation(command(&snapshot, "npc-owner", 1))
            .expect("first distinct quest");
        let mut repeated = command(&first, "npc-owner", 2);
        repeated.generation.validated_output["risk"] = json!("MODERATE");
        repeated.generation.validated_output["recommendedAttributes"] =
            json!(["knowledge", "agility"]);
        repeated.generation.validated_output["expectedTurns"] = json!({ "min": 8, "max": 12 });
        repeated.generation.validated_output["rewardTier"] = json!("NOTABLE");
        repeated.generation.raw_response_text = repeated.generation.validated_output.to_string();
        assert!(matches!(
            store.commit_quest_generation(repeated),
            Err(CampaignStoreError::InvalidData)
        ));
        assert_eq!(
            store
                .quest_board_snapshot("campaign-quests")
                .expect("board after repeated structure")
                .quests
                .len(),
            1
        );
    }

    fn seed_board(store: &CampaignStore) {
        let connection = store.connect().expect("connect");
        connection
            .execute_batch(
                "INSERT INTO campaigns (
                   id, schema_version, state, resume_state, created_at, updated_at
                 ) VALUES (
                   'campaign-quests', 1, 'TAVERN', NULL,
                   '2026-07-31T06:00:00.000Z', '2026-07-31T06:00:00.000Z'
                 );
                 INSERT INTO world_bibles (
                   campaign_id, schema_version, name, current_region, summary, core_conflict,
                   technology_level, power_rules_json, factions_json, locations_json,
                   narrative_style, forbidden_elements_json, tavern_reason, story_hooks_json,
                   locked_fields_json, created_at, updated_at
                 ) VALUES (
                   'campaign-quests', 1, 'Ember Coast', 'Ash Harbor',
                   'A storm-bound coast.', 'The beacon is fading.', 'Late medieval',
                   '[\"Magic leaves warmth.\"]', '[]', '[]', 'Grounded', '[]',
                   'Travelers gather here.', '[]', '[]',
                   '2026-07-31T06:00:00.000Z', '2026-07-31T06:00:00.000Z'
                 );
                 INSERT INTO player_characters (
                   id, campaign_id, name, gender, age, concept, story_preferences_json,
                   content_boundaries_json, class_archetype, class_display_name,
                   attributes_json, traits_json, personal_goal, background_json,
                   initial_equipment_ids_json, created_at, updated_at
                 ) VALUES (
                   'character-player', 'campaign-quests', 'Mara', NULL, NULL, 'Curious scout',
                   '[]', '[]', 'ROGUE', 'Scout',
                   '{\"physique\":2,\"agility\":4,\"knowledge\":3,\"charisma\":1}',
                   '[]', 'Find the road.', '{}', '[]',
                   '2026-07-31T06:00:00.000Z', '2026-07-31T06:00:00.000Z'
                 );
                 INSERT INTO taverns (
                   id, campaign_id, location_id, name, position, environment,
                   special_rules_json, long_term_problem, owner_npc_id, changes_json,
                   created_at, updated_at
                 ) VALUES (
                   'tavern-rest', 'campaign-quests', 'location-harbor', 'Ember Rest',
                   'Crossroads', 'Warm stone hall.', '[]', 'Cellar light.', NULL, '[]',
                   '2026-07-31T06:00:00.000Z', '2026-07-31T06:00:00.000Z'
                 );
                 INSERT INTO npcs (
                   id, campaign_id, tavern_id, residency, name, identity, appearance,
                   personality, goal, secret, speech_style, current_mood, current_status,
                   visit_json, memories_json, created_at, updated_at
                 ) VALUES
                 (
                   'npc-owner', 'campaign-quests', 'tavern-rest', 'OWNER', 'Ilyra Venn',
                   'Innkeeper', 'A red coat.', 'Observant.', 'Keep the road open.',
                   'Tunnel secret.', 'Measured.', 'Concerned', 'ACTIVE', NULL, '[]',
                   '2026-07-31T06:00:00.000Z', '2026-07-31T06:00:00.000Z'
                 ),
                 (
                   'npc-resident', 'campaign-quests', 'tavern-rest', 'RESIDENT', 'Tomas Reed',
                   'Cartographer', 'Ink-stained hands.', 'Skeptical.', 'Map the tunnels.',
                   'Entered once.', 'Precise.', 'Curious', 'ACTIVE', NULL, '[]',
                   '2026-07-31T06:00:01.000Z', '2026-07-31T06:00:01.000Z'
                 );
                 UPDATE taverns SET owner_npc_id = 'npc-owner' WHERE id = 'tavern-rest';",
            )
            .expect("seed quest board");
    }

    fn command(
        snapshot: &QuestBoardSnapshot,
        publisher_npc_id: &str,
        index: usize,
    ) -> QuestGenerationCommit {
        let publisher = snapshot
            .source
            .available_npcs
            .iter()
            .find(|npc| npc.id == publisher_npc_id)
            .expect("publisher");
        let input = json!({
            "world": snapshot.source.world,
            "tavernName": snapshot.source.tavern_name,
            "publisher": publisher,
            "availableNpcs": snapshot.source.available_npcs,
            "playerConcept": snapshot.source.player_concept,
            "recentQuestTitles": snapshot.source.recent_quest_titles,
            "recentQuestStructures": snapshot.source.recent_quest_structures,
        });
        let output = if index == 1 {
            json!({
                "content": {
                    "title": "The Fading Beacon",
                    "summary": "Investigate the failing lighthouse.",
                    "objective": "Restore the beacon.",
                    "failureCost": "Ships remain trapped."
                },
                "risk": "MODERATE",
                "recommendedAttributes": ["knowledge", "agility"],
                "expectedTurns": { "min": 8, "max": 12 },
                "rewardTier": "NOTABLE",
                "relatedNpcIds": [],
                "relatedFactIds": []
            })
        } else {
            json!({
                "content": {
                    "title": "The Broken Causeway",
                    "summary": "Escort the harbor masons at low tide.",
                    "objective": "Recover the missing signal bell.",
                    "failureCost": "The inland road remains cut off."
                },
                "risk": "HIGH",
                "recommendedAttributes": ["physique", "charisma"],
                "expectedTurns": { "min": 9, "max": 12 },
                "rewardTier": "RARE",
                "relatedNpcIds": [],
                "relatedFactIds": []
            })
        };
        QuestGenerationCommit {
            campaign_id: "campaign-quests".to_owned(),
            publisher_npc_id: publisher_npc_id.to_owned(),
            generation: TavernGenerationAudit {
                request_id: format!("quest-request-{index}"),
                generation_record_id: format!("quest-generation-{index}"),
                idempotency_key: format!("quest-key-{index}"),
                prompt_version: 2,
                input,
                context: json!({
                    "tavernId": snapshot.source.tavern_id,
                    "playerCharacterId": snapshot.source.player_character_id,
                    "publisherNpcId": publisher_npc_id,
                }),
                request: json!({ "task": "GENERATE_QUEST" }),
                raw_response_text: output.to_string(),
                validated_output: output,
            },
        }
    }
}

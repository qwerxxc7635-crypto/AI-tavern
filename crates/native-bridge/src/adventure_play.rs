use rusqlite::{Connection, OptionalExtension, Transaction, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use uuid::Uuid;

use crate::{
    CampaignStore, CampaignStoreError, TavernGenerationAudit, current_timestamp, validate_id,
};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdventureSnapshot {
    pub campaign_id: String,
    pub campaign_state: String,
    pub adventure_id: Option<String>,
    pub state: Option<String>,
    pub current_turn_number: i64,
    pub plan_input: Value,
    pub player: Value,
    pub quest: Value,
    pub clocks: Vec<Value>,
    pub items: Vec<Value>,
    pub clues: Vec<Value>,
    pub turns: Vec<Value>,
    pub current_scene: String,
    pub suggested_actions: Vec<String>,
    pub turn_generation_context: Option<Value>,
    pub dice_generation_input: Option<Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AdventurePlanCommit {
    pub campaign_id: String,
    pub quest_id: String,
    pub generation: TavernGenerationAudit,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AdventureActionSubmit {
    pub campaign_id: String,
    pub adventure_id: String,
    pub player_action: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AdventureTurnCommit {
    pub campaign_id: String,
    pub adventure_id: String,
    pub generation: TavernGenerationAudit,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AdventureDiceCommit {
    pub campaign_id: String,
    pub adventure_id: String,
    pub generation: TavernGenerationAudit,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PlanOutput {
    objective: String,
    risk: String,
    expected_turns: TurnRange,
    core_scenes: Vec<String>,
    necessary_clues: Vec<PlanClue>,
    major_obstacles: Vec<String>,
    possible_endings: Vec<String>,
    failure_cost: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct TurnRange {
    min: i64,
    max: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PlanClue {
    title: String,
    description: String,
    is_core: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct TurnOutput {
    scene_text: String,
    speaker_npc_ids: Vec<String>,
    suggested_actions: Vec<SuggestedAction>,
    check_request: Option<CheckProposal>,
    discovered_clues: Vec<String>,
    state_patch_proposals: Vec<Value>,
    adventure_state: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct SuggestedAction {
    text: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct CheckProposal {
    attribute: String,
    difficulty: i64,
    reason: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DiceOutput {
    narration: String,
    consequence: String,
    state_patch_proposals: Vec<Value>,
}

impl CampaignStore {
    pub fn adventure_snapshot(
        &self,
        campaign_id: &str,
        quest_id: Option<&str>,
    ) -> Result<AdventureSnapshot, CampaignStoreError> {
        validate_id(campaign_id)?;
        if let Some(id) = quest_id {
            validate_id(id)?;
        }
        let connection = self.connect()?;
        load_snapshot(&connection, campaign_id, quest_id)
    }

    pub fn commit_adventure_plan(
        &self,
        command: AdventurePlanCommit,
    ) -> Result<AdventureSnapshot, CampaignStoreError> {
        validate_id(&command.campaign_id)?;
        validate_id(&command.quest_id)?;
        validate_audit(&command.generation, "GENERATE_ADVENTURE_PLAN")?;
        let output: PlanOutput =
            serde_json::from_value(command.generation.validated_output.clone())
                .map_err(|_| CampaignStoreError::InvalidData)?;
        validate_plan(&output)?;
        let mut connection = self.connect()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        if campaign_state(&transaction, &command.campaign_id)? != "TAVERN" {
            return Err(CampaignStoreError::InvalidState);
        }
        if active_adventure_id(&transaction, &command.campaign_id)?.is_some() {
            return Err(CampaignStoreError::InvalidState);
        }
        let expected_input = plan_input(&transaction, &command.campaign_id, &command.quest_id)?;
        if command.generation.input != expected_input
            || command.generation.context
                != json!({
                    "questId": command.quest_id,
                    "playerCharacterId": player_character_id(&transaction, &command.campaign_id)?,
                })
        {
            return Err(CampaignStoreError::InvalidData);
        }
        let quest = quest_data(&transaction, &command.campaign_id, &command.quest_id)?;
        let expected_risk = text_field(&quest, "risk")?;
        let expected_turns = record_field(&quest, "expectedTurns")?;
        if output.risk != expected_risk
            || expected_turns.get("min").and_then(Value::as_i64) != Some(output.expected_turns.min)
            || expected_turns.get("max").and_then(Value::as_i64) != Some(output.expected_turns.max)
            || output
                .necessary_clues
                .iter()
                .filter(|clue| clue.is_core)
                .count()
                < 3
            || output.possible_endings.len() < 2
        {
            return Err(CampaignStoreError::InvalidData);
        }
        let at = current_timestamp()?;
        let adventure_id = Uuid::new_v4().to_string();
        let clues = output
            .necessary_clues
            .iter()
            .map(|clue| {
                json!({
                    "id": Uuid::new_v4().to_string(),
                    "adventureId": adventure_id,
                    "title": clue.title,
                    "description": clue.description,
                    "isCore": clue.is_core,
                    "discoveredInTurnId": null,
                })
            })
            .collect::<Vec<_>>();
        let plan = json!({
            "adventureId": adventure_id,
            "objective": output.objective,
            "risk": output.risk,
            "expectedTurns": output.expected_turns,
            "coreScenes": output.core_scenes,
            "necessaryClueIds": clues.iter().filter_map(|clue| clue.get("id")).collect::<Vec<_>>(),
            "majorObstacles": output.major_obstacles,
            "possibleEndings": output.possible_endings,
            "failureCost": output.failure_cost,
        });
        insert_generation(
            &transaction,
            &command.campaign_id,
            None,
            "GENERATE_ADVENTURE_PLAN",
            &command.generation,
            &at,
        )?;
        transaction.execute(
            "INSERT INTO adventures (
               id, campaign_id, quest_id, state, plan_json, current_turn_number,
               clues_json, ending_json, created_at, updated_at
             ) VALUES (?1, ?2, ?3, 'PREPARING', ?4, 0, ?5, NULL, ?6, ?6)",
            params![
                adventure_id,
                command.campaign_id,
                command.quest_id,
                plan.to_string(),
                Value::Array(clues).to_string(),
                at,
            ],
        )?;
        transaction.commit()?;
        self.adventure_snapshot(&command.campaign_id, Some(&command.quest_id))
    }

    pub fn start_adventure(
        &self,
        campaign_id: &str,
        adventure_id: &str,
    ) -> Result<AdventureSnapshot, CampaignStoreError> {
        validate_id(campaign_id)?;
        validate_id(adventure_id)?;
        let mut connection = self.connect()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        if campaign_state(&transaction, campaign_id)? != "TAVERN" {
            return Err(CampaignStoreError::InvalidState);
        }
        let quest_id = adventure_quest(&transaction, campaign_id, adventure_id, "PREPARING")?;
        let at = current_timestamp()?;
        transaction.execute(
            "UPDATE adventures SET state = 'SCENE', updated_at = ?1
             WHERE id = ?2 AND campaign_id = ?3 AND state = 'PREPARING'",
            params![at, adventure_id, campaign_id],
        )?;
        transaction.execute(
            "UPDATE quests SET status = 'ACTIVE', updated_at = ?1
             WHERE id = ?2 AND campaign_id = ?3 AND status = 'ACCEPTED'",
            params![at, quest_id, campaign_id],
        )?;
        transaction.execute(
            "UPDATE campaigns SET state = 'ADVENTURE', updated_at = ?1
             WHERE id = ?2 AND state = 'TAVERN'",
            params![at, campaign_id],
        )?;
        transaction.commit()?;
        self.adventure_snapshot(campaign_id, Some(&quest_id))
    }

    pub fn submit_adventure_action(
        &self,
        command: AdventureActionSubmit,
    ) -> Result<AdventureSnapshot, CampaignStoreError> {
        validate_id(&command.campaign_id)?;
        validate_id(&command.adventure_id)?;
        validate_text(&command.player_action, 4_000)?;
        let mut connection = self.connect()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        require_adventure_state(
            &transaction,
            &command.campaign_id,
            &command.adventure_id,
            "SCENE",
        )?;
        let snapshot = load_snapshot(
            &transaction,
            &command.campaign_id,
            Some(&adventure_quest_any(
                &transaction,
                &command.campaign_id,
                &command.adventure_id,
            )?),
        )?;
        let at = current_timestamp()?;
        let turn_id = Uuid::new_v4().to_string();
        transaction.execute(
            "INSERT INTO adventure_turns (
               id, adventure_id, turn_number, scene_text, speaker_npc_ids_json,
               suggested_actions_json, player_action_json, check_request_json,
               dice_result_json, created_at, resolved_at
             ) VALUES (?1, ?2, ?3, ?4, '[]', '[]', ?5, NULL, NULL, ?6, NULL)",
            params![
                turn_id,
                command.adventure_id,
                snapshot.current_turn_number + 1,
                snapshot.current_scene,
                json!({ "kind": "FREEFORM", "text": command.player_action }).to_string(),
                at,
            ],
        )?;
        transaction.execute(
            "UPDATE adventures SET state = 'WAITING_FOR_PLAYER', updated_at = ?1
             WHERE id = ?2",
            params![at, command.adventure_id],
        )?;
        transaction.commit()?;
        self.adventure_snapshot(&command.campaign_id, None)
    }

    pub fn commit_adventure_turn(
        &self,
        command: AdventureTurnCommit,
    ) -> Result<AdventureSnapshot, CampaignStoreError> {
        validate_id(&command.campaign_id)?;
        validate_id(&command.adventure_id)?;
        validate_audit(&command.generation, "GENERATE_ADVENTURE_TURN")?;
        let output: TurnOutput =
            serde_json::from_value(command.generation.validated_output.clone())
                .map_err(|_| CampaignStoreError::InvalidData)?;
        validate_turn_output(&output)?;
        let mut connection = self.connect()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        require_adventure_state(
            &transaction,
            &command.campaign_id,
            &command.adventure_id,
            "WAITING_FOR_PLAYER",
        )?;
        let turn = pending_turn(&transaction, &command.adventure_id)?;
        let expected_input =
            turn_generation_context(&transaction, &command.campaign_id, &command.adventure_id)?;
        if command.generation.input != expected_input
            || command.generation.context
                != json!({ "adventureId": command.adventure_id, "turnId": turn.id })
        {
            return Err(CampaignStoreError::InvalidData);
        }
        validate_turn_references(
            &transaction,
            &command.campaign_id,
            &command.adventure_id,
            &output,
        )?;
        let at = current_timestamp()?;
        let check_request = output.check_request.as_ref().map(|check| {
            json!({
                "id": Uuid::new_v4().to_string(),
                "turnId": turn.id,
                "attribute": check.attribute,
                "difficulty": check.difficulty,
                "reason": check.reason,
            })
        });
        let next_state = if check_request.is_some() {
            "CHECK_REQUIRED"
        } else if output.adventure_state == "ENDING" {
            "ENDING"
        } else {
            "SCENE"
        };
        let suggested_actions = output
            .suggested_actions
            .iter()
            .map(|action| {
                json!({
                    "kind": "SUGGESTED",
                    "optionId": Uuid::new_v4().to_string(),
                    "text": action.text,
                })
            })
            .collect::<Vec<_>>();
        let mut clues = load_clues(&transaction, &command.adventure_id)?;
        for title in &output.discovered_clues {
            if let Some(clue) = clues
                .iter_mut()
                .find(|clue| clue.get("title").and_then(Value::as_str) == Some(title.as_str()))
                && clue.get("discoveredInTurnId").is_some_and(Value::is_null)
            {
                clue.as_object_mut()
                    .ok_or(CampaignStoreError::InvalidData)?
                    .insert("discoveredInTurnId".to_owned(), json!(turn.id));
            }
        }
        apply_fact_patches(
            &transaction,
            &command.campaign_id,
            &output.state_patch_proposals,
            &at,
        )?;
        insert_generation(
            &transaction,
            &command.campaign_id,
            Some(&turn.id),
            "GENERATE_ADVENTURE_TURN",
            &command.generation,
            &at,
        )?;
        transaction.execute(
            "UPDATE adventure_turns
             SET scene_text = ?1, speaker_npc_ids_json = ?2, suggested_actions_json = ?3,
                 check_request_json = ?4, resolved_at = ?5
             WHERE id = ?6",
            params![
                output.scene_text,
                Value::Array(output.speaker_npc_ids.iter().map(|id| json!(id)).collect())
                    .to_string(),
                Value::Array(suggested_actions).to_string(),
                check_request.as_ref().map(Value::to_string),
                if check_request.is_none() {
                    Some(at.as_str())
                } else {
                    None
                },
                turn.id,
            ],
        )?;
        transaction.execute(
            "UPDATE adventures
             SET state = ?1, current_turn_number = ?2, clues_json = ?3, updated_at = ?4
             WHERE id = ?5",
            params![
                next_state,
                turn.turn_number,
                Value::Array(clues).to_string(),
                at,
                command.adventure_id,
            ],
        )?;
        insert_event(
            &transaction,
            &command.campaign_id,
            "PLAYER_ACTION_SUBMITTED",
            json!({ "adventureId": command.adventure_id, "turnId": turn.id }),
            &at,
        )?;
        transaction.commit()?;
        self.adventure_snapshot(&command.campaign_id, None)
    }

    pub fn roll_adventure_check(
        &self,
        campaign_id: &str,
        adventure_id: &str,
    ) -> Result<AdventureSnapshot, CampaignStoreError> {
        validate_id(campaign_id)?;
        validate_id(adventure_id)?;
        let mut connection = self.connect()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        require_adventure_state(&transaction, campaign_id, adventure_id, "CHECK_REQUIRED")?;
        let turn = latest_turn(&transaction, adventure_id)?;
        let check: Value = turn.check_request.ok_or(CampaignStoreError::InvalidData)?;
        let attribute = text_field(&check, "attribute")?;
        let difficulty = integer_field(&check, "difficulty")?;
        let character = character_data(&transaction, campaign_id)?;
        let attributes = record_field(&character, "attributes")?;
        let attribute_value = attributes
            .get(&attribute)
            .and_then(Value::as_i64)
            .ok_or(CampaignStoreError::InvalidData)?;
        let equipment_modifier = equipment_modifier(&transaction, campaign_id, &attribute)?;
        let random = Uuid::new_v4();
        let natural_roll = i64::from(random.as_bytes()[0] % 20) + 1;
        let total = natural_roll + attribute_value + equipment_modifier;
        let dice = json!({
            "checkRequestId": text_field(&check, "id")?,
            "naturalRoll": natural_roll,
            "attributeValue": attribute_value,
            "equipmentModifier": equipment_modifier,
            "statusModifier": 0,
            "total": total,
            "difficulty": difficulty,
            "success": total >= difficulty,
            "criticalSuccess": natural_roll == 20,
            "criticalFailure": natural_roll == 1,
        });
        let at = current_timestamp()?;
        transaction.execute(
            "UPDATE adventure_turns SET dice_result_json = ?1 WHERE id = ?2",
            params![dice.to_string(), turn.id],
        )?;
        transaction.execute(
            "UPDATE adventures SET state = 'RESOLVING', updated_at = ?1 WHERE id = ?2",
            params![at, adventure_id],
        )?;
        insert_event(
            &transaction,
            campaign_id,
            "DICE_ROLLED",
            json!({ "adventureId": adventure_id, "turnId": turn.id, "result": dice }),
            &at,
        )?;
        transaction.commit()?;
        self.adventure_snapshot(campaign_id, None)
    }

    pub fn commit_adventure_dice(
        &self,
        command: AdventureDiceCommit,
    ) -> Result<AdventureSnapshot, CampaignStoreError> {
        validate_id(&command.campaign_id)?;
        validate_id(&command.adventure_id)?;
        validate_audit(&command.generation, "RESOLVE_DICE_RESULT")?;
        let output: DiceOutput =
            serde_json::from_value(command.generation.validated_output.clone())
                .map_err(|_| CampaignStoreError::InvalidData)?;
        validate_text(&output.narration, 4_000)?;
        validate_text(&output.consequence, 4_000)?;
        let mut connection = self.connect()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        require_adventure_state(
            &transaction,
            &command.campaign_id,
            &command.adventure_id,
            "RESOLVING",
        )?;
        let turn = latest_turn(&transaction, &command.adventure_id)?;
        let expected_input = dice_generation_input(&turn)?;
        if command.generation.input != expected_input
            || command.generation.context
                != json!({ "adventureId": command.adventure_id, "turnId": turn.id })
        {
            return Err(CampaignStoreError::InvalidData);
        }
        let at = current_timestamp()?;
        apply_fact_patches(
            &transaction,
            &command.campaign_id,
            &output.state_patch_proposals,
            &at,
        )?;
        insert_generation(
            &transaction,
            &command.campaign_id,
            Some(&turn.id),
            "RESOLVE_DICE_RESULT",
            &command.generation,
            &at,
        )?;
        let combined = format!(
            "{}\n\n{}\n{}",
            turn.scene_text, output.narration, output.consequence
        );
        transaction.execute(
            "UPDATE adventure_turns SET scene_text = ?1, resolved_at = ?2 WHERE id = ?3",
            params![combined, at, turn.id],
        )?;
        transaction.execute(
            "UPDATE adventures SET state = 'SCENE', updated_at = ?1 WHERE id = ?2",
            params![at, command.adventure_id],
        )?;
        transaction.commit()?;
        self.adventure_snapshot(&command.campaign_id, None)
    }
}

#[derive(Debug)]
struct StoredTurn {
    id: String,
    turn_number: i64,
    scene_text: String,
    player_action: Value,
    check_request: Option<Value>,
    dice_result: Option<Value>,
}

fn load_snapshot(
    connection: &Connection,
    campaign_id: &str,
    requested_quest_id: Option<&str>,
) -> Result<AdventureSnapshot, CampaignStoreError> {
    let campaign_state = campaign_state(connection, campaign_id)?;
    let active = active_adventure(connection, campaign_id)?;
    let quest_id = match &active {
        Some((_, quest_id, _, _)) => quest_id.clone(),
        None => requested_quest_id
            .map(str::to_owned)
            .or_else(|| accepted_quest_id(connection, campaign_id).ok().flatten())
            .ok_or(CampaignStoreError::NotFound)?,
    };
    let player = character_data(connection, campaign_id)?;
    let quest = quest_data(connection, campaign_id, &quest_id)?;
    let plan_input = plan_input(connection, campaign_id, &quest_id)?;
    let clocks = load_json_rows(
        connection,
        "SELECT json_object(
           'id', id, 'name', name, 'current', current, 'max', max, 'stages', json(stages_json)
         ) FROM world_clocks WHERE campaign_id = ?1 ORDER BY created_at, id",
        campaign_id,
    )?;
    let items = load_items(connection, campaign_id)?;
    let Some((adventure_id, _, state, current_turn_number)) = active else {
        return Ok(AdventureSnapshot {
            campaign_id: campaign_id.to_owned(),
            campaign_state,
            adventure_id: None,
            state: None,
            current_turn_number: 0,
            plan_input,
            player,
            quest: quest.clone(),
            clocks,
            items,
            clues: Vec::new(),
            turns: Vec::new(),
            current_scene: text_field(&record_field(&quest, "content")?, "summary")?,
            suggested_actions: Vec::new(),
            turn_generation_context: None,
            dice_generation_input: None,
        });
    };
    let clues = load_clues(connection, &adventure_id)?;
    let turns = load_turn_views(connection, &adventure_id)?;
    let latest = latest_turn(connection, &adventure_id).ok();
    let current_scene = latest
        .as_ref()
        .map(|turn| turn.scene_text.clone())
        .unwrap_or(text_field(&record_field(&quest, "content")?, "summary")?);
    let suggested_actions = turns
        .last()
        .and_then(|turn| turn.get("suggestedActions"))
        .and_then(Value::as_array)
        .map(|actions| {
            actions
                .iter()
                .filter_map(|action| {
                    action
                        .get("text")
                        .and_then(Value::as_str)
                        .map(str::to_owned)
                })
                .collect()
        })
        .unwrap_or_default();
    let turn_generation_context = if state == "WAITING_FOR_PLAYER" {
        Some(turn_generation_context(
            connection,
            campaign_id,
            &adventure_id,
        )?)
    } else {
        None
    };
    let dice_generation_input = if state == "RESOLVING" {
        Some(dice_generation_input(
            latest.as_ref().ok_or(CampaignStoreError::InvalidData)?,
        )?)
    } else {
        None
    };
    Ok(AdventureSnapshot {
        campaign_id: campaign_id.to_owned(),
        campaign_state,
        adventure_id: Some(adventure_id),
        state: Some(state),
        current_turn_number,
        plan_input,
        player,
        quest,
        clocks,
        items,
        clues,
        turns,
        current_scene,
        suggested_actions,
        turn_generation_context,
        dice_generation_input,
    })
}

fn plan_input(
    connection: &Connection,
    campaign_id: &str,
    quest_id: &str,
) -> Result<Value, CampaignStoreError> {
    let world = world_context(connection, campaign_id)?;
    let quest = quest_data(connection, campaign_id, quest_id)?;
    if text_field(&quest, "status")? != "ACCEPTED"
        && !["ADVENTURE"].contains(&campaign_state(connection, campaign_id)?.as_str())
    {
        return Err(CampaignStoreError::InvalidState);
    }
    let character = character_data(connection, campaign_id)?;
    let content = record_field(&quest, "content")?;
    let expected = record_field(&quest, "expectedTurns")?;
    let fact_ids = array_field(&quest, "relatedFactIds")?;
    let mut relevant_facts = Vec::new();
    for id in fact_ids.iter().filter_map(Value::as_str) {
        if let Some(statement) = connection
            .query_row(
                "SELECT statement FROM world_facts WHERE id = ?1 AND campaign_id = ?2",
                params![id, campaign_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?
        {
            relevant_facts.push(statement);
        }
    }
    Ok(json!({
        "world": world,
        "quest": {
            "id": quest_id,
            "content": content,
            "risk": text_field(&quest, "risk")?,
            "expectedTurns": expected,
        },
        "playerSummary": format!(
            "{}: {}; {}",
            text_field(&character, "name")?,
            text_field(&character, "concept")?,
            text_field(&character, "personalGoal")?,
        ),
        "relevantFacts": relevant_facts,
    }))
}

fn turn_generation_context(
    connection: &Connection,
    campaign_id: &str,
    adventure_id: &str,
) -> Result<Value, CampaignStoreError> {
    let turn = pending_turn(connection, adventure_id)?;
    let quest_id = adventure_quest_any(connection, campaign_id, adventure_id)?;
    let quest = quest_data(connection, campaign_id, &quest_id)?;
    let character = character_data(connection, campaign_id)?;
    let character_traits = array_field(&character, "traits")?
        .iter()
        .map(|character_trait| {
            Ok(json!({
                "name": text_field(character_trait, "name")?,
                "description": text_field(character_trait, "description")?,
            }))
        })
        .collect::<Result<Vec<_>, CampaignStoreError>>()?;
    let plan: Value = connection.query_row(
        "SELECT plan_json FROM adventures WHERE id = ?1",
        [adventure_id],
        |row| from_json(row.get(0)?),
    )?;
    let clues = load_clues(connection, adventure_id)?;
    let necessary = clues
        .iter()
        .map(|clue| {
            format!(
                "{}: {}",
                clue.get("title").and_then(Value::as_str).unwrap_or(""),
                clue.get("description")
                    .and_then(Value::as_str)
                    .unwrap_or("")
            )
        })
        .collect::<Vec<_>>();
    let turns = load_turn_views(connection, adventure_id)?;
    let recent_turns = turns
        .iter()
        .rev()
        .take(8)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .map(|turn| {
            format!(
                "Turn {}: {} Player: {}",
                turn.get("turnNumber").and_then(Value::as_i64).unwrap_or(0),
                turn.get("sceneText").and_then(Value::as_str).unwrap_or(""),
                turn.get("playerAction")
                    .and_then(Value::as_str)
                    .unwrap_or("")
            )
        })
        .collect::<Vec<_>>();
    let discovered = clues
        .iter()
        .filter(|clue| {
            clue.get("discoveredInTurnId")
                .is_some_and(|value| !value.is_null())
        })
        .map(|clue| {
            format!(
                "{}: {}",
                clue.get("title").and_then(Value::as_str).unwrap_or(""),
                clue.get("description")
                    .and_then(Value::as_str)
                    .unwrap_or("")
            )
        })
        .collect::<Vec<_>>();
    let related_npcs = related_npcs(connection, campaign_id, &quest)?;
    Ok(json!({
        "adventureId": adventure_id,
        "worldRules": array_field(&world_context(connection, campaign_id)?, "powerRules")?,
        "playerCharacter": {
            "id": text_field(&character, "id")?,
            "name": text_field(&character, "name")?,
            "concept": text_field(&character, "concept")?,
            "classDisplayName": text_field(&character, "classDisplayName")?,
            "attributes": record_field(&character, "attributes")?,
            "traits": character_traits,
            "personalGoal": text_field(&character, "personalGoal")?,
        },
        "quest": {
            "id": quest_id,
            "content": record_field(&quest, "content")?,
            "status": text_field(&quest, "status")?,
            "risk": text_field(&quest, "risk")?,
            "rewardTier": text_field(&quest, "rewardTier")?,
        },
        "adventurePlan": {
            "objective": text_field(&plan, "objective")?,
            "risk": text_field(&plan, "risk")?,
            "expectedTurns": record_field(&plan, "expectedTurns")?,
            "coreScenes": array_field(&plan, "coreScenes")?,
            "necessaryClues": necessary,
            "majorObstacles": array_field(&plan, "majorObstacles")?,
            "possibleEndings": array_field(&plan, "possibleEndings")?,
            "failureCost": text_field(&plan, "failureCost")?,
        },
        "currentTurnNumber": integer_field(
            &json!({ "value": connection.query_row::<i64, _, _>(
                "SELECT current_turn_number FROM adventures WHERE id = ?1",
                [adventure_id],
                |row| row.get(0),
            )? }),
            "value"
        )?,
        "currentScene": turn.scene_text,
        "longTermSummary": null,
        "recentTurns": recent_turns,
        "discoveredClues": discovered,
        "relatedNpcs": related_npcs,
        "playerAction": action_text(&turn.player_action)?,
    }))
}

fn dice_generation_input(turn: &StoredTurn) -> Result<Value, CampaignStoreError> {
    let check = turn
        .check_request
        .as_ref()
        .ok_or(CampaignStoreError::InvalidData)?;
    let dice = turn
        .dice_result
        .as_ref()
        .ok_or(CampaignStoreError::InvalidData)?;
    Ok(json!({
        "scene": turn.scene_text,
        "action": action_text(&turn.player_action)?,
        "attribute": text_field(check, "attribute")?,
        "difficulty": integer_field(check, "difficulty")?,
        "total": integer_field(dice, "total")?,
        "success": dice.get("success").and_then(Value::as_bool).ok_or(CampaignStoreError::InvalidData)?,
    }))
}

fn world_context(connection: &Connection, campaign_id: &str) -> Result<Value, CampaignStoreError> {
    connection
        .query_row(
            "SELECT name, current_region, summary, core_conflict, technology_level,
                    power_rules_json
             FROM world_bibles WHERE campaign_id = ?1",
            [campaign_id],
            |row| {
                Ok(json!({
                    "name": row.get::<_, String>(0)?,
                    "currentRegion": row.get::<_, String>(1)?,
                    "summary": row.get::<_, String>(2)?,
                    "coreConflict": row.get::<_, String>(3)?,
                    "technologyLevel": row.get::<_, String>(4)?,
                    "powerRules": from_json::<Value>(row.get(5)?)?,
                }))
            },
        )
        .optional()?
        .ok_or(CampaignStoreError::InvalidData)
}

fn character_data(connection: &Connection, campaign_id: &str) -> Result<Value, CampaignStoreError> {
    connection
        .query_row(
            "SELECT id, name, concept, class_display_name, attributes_json, traits_json,
                    personal_goal
             FROM player_characters WHERE campaign_id = ?1",
            [campaign_id],
            |row| {
                Ok(json!({
                    "id": row.get::<_, String>(0)?,
                    "name": row.get::<_, String>(1)?,
                    "concept": row.get::<_, String>(2)?,
                    "classDisplayName": row.get::<_, String>(3)?,
                    "attributes": from_json::<Value>(row.get(4)?)?,
                    "traits": from_json::<Value>(row.get(5)?)?,
                    "personalGoal": row.get::<_, String>(6)?,
                }))
            },
        )
        .optional()?
        .ok_or(CampaignStoreError::InvalidData)
}

fn quest_data(
    connection: &Connection,
    campaign_id: &str,
    quest_id: &str,
) -> Result<Value, CampaignStoreError> {
    connection
        .query_row(
            "SELECT id, publisher_npc_id, content_json, status, risk, recommended_attributes_json,
                    expected_turns_min, expected_turns_max, reward_tier,
                    related_npc_ids_json, related_fact_ids_json
             FROM quests WHERE id = ?1 AND campaign_id = ?2",
            params![quest_id, campaign_id],
            |row| {
                Ok(json!({
                    "id": row.get::<_, String>(0)?,
                    "publisherNpcId": row.get::<_, String>(1)?,
                    "content": from_json::<Value>(row.get(2)?)?,
                    "status": row.get::<_, String>(3)?,
                    "risk": row.get::<_, String>(4)?,
                    "recommendedAttributes": from_json::<Value>(row.get(5)?)?,
                    "expectedTurns": {
                        "min": row.get::<_, i64>(6)?,
                        "max": row.get::<_, i64>(7)?,
                    },
                    "rewardTier": row.get::<_, String>(8)?,
                    "relatedNpcIds": from_json::<Value>(row.get(9)?)?,
                    "relatedFactIds": from_json::<Value>(row.get(10)?)?,
                }))
            },
        )
        .optional()?
        .ok_or(CampaignStoreError::NotFound)
}

fn related_npcs(
    connection: &Connection,
    campaign_id: &str,
    quest: &Value,
) -> Result<Vec<Value>, CampaignStoreError> {
    let mut result = Vec::new();
    for id in array_field(quest, "relatedNpcIds")?
        .iter()
        .filter_map(Value::as_str)
    {
        let npc = connection
            .query_row(
                "SELECT id, name, identity, personality, goal, current_mood
                 FROM npcs WHERE id = ?1 AND campaign_id = ?2",
                params![id, campaign_id],
                |row| {
                    Ok(json!({
                        "id": row.get::<_, String>(0)?,
                        "name": row.get::<_, String>(1)?,
                        "identity": row.get::<_, String>(2)?,
                        "personality": row.get::<_, String>(3)?,
                        "goal": row.get::<_, String>(4)?,
                        "currentMood": row.get::<_, String>(5)?,
                    }))
                },
            )
            .optional()?
            .ok_or(CampaignStoreError::InvalidData)?;
        result.push(npc);
    }
    Ok(result)
}

fn load_items(
    connection: &Connection,
    campaign_id: &str,
) -> Result<Vec<Value>, CampaignStoreError> {
    let mut statement = connection.prepare(
        "SELECT id, content_json, effect_json, reward_tier
         FROM items WHERE campaign_id = ?1 ORDER BY created_at, id",
    )?;
    Ok(statement
        .query_map([campaign_id], |row| {
            Ok(json!({
                "id": row.get::<_, String>(0)?,
                "content": from_json::<Value>(row.get(1)?)?,
                "effect": from_json::<Value>(row.get(2)?)?,
                "rewardTier": row.get::<_, String>(3)?,
            }))
        })?
        .collect::<Result<Vec<_>, _>>()?)
}

fn load_json_rows(
    connection: &Connection,
    sql: &str,
    campaign_id: &str,
) -> Result<Vec<Value>, CampaignStoreError> {
    let mut statement = connection.prepare(sql)?;
    Ok(statement
        .query_map([campaign_id], |row| from_json(row.get(0)?))?
        .collect::<Result<Vec<_>, _>>()?)
}

fn load_clues(
    connection: &Connection,
    adventure_id: &str,
) -> Result<Vec<Value>, CampaignStoreError> {
    connection
        .query_row(
            "SELECT clues_json FROM adventures WHERE id = ?1",
            [adventure_id],
            |row| from_json(row.get(0)?),
        )
        .optional()?
        .ok_or(CampaignStoreError::NotFound)
}

fn load_turn_views(
    connection: &Connection,
    adventure_id: &str,
) -> Result<Vec<Value>, CampaignStoreError> {
    let mut statement = connection.prepare(
        "SELECT id, turn_number, scene_text, player_action_json, suggested_actions_json,
                check_request_json, dice_result_json, resolved_at
         FROM adventure_turns WHERE adventure_id = ?1 ORDER BY turn_number",
    )?;
    Ok(statement
        .query_map([adventure_id], |row| {
            let player_action: Value = from_json(row.get(3)?)?;
            Ok(json!({
                "id": row.get::<_, String>(0)?,
                "turnNumber": row.get::<_, i64>(1)?,
                "sceneText": row.get::<_, String>(2)?,
                "playerAction": action_text_sql(&player_action)?,
                "suggestedActions": from_json::<Value>(row.get(4)?)?,
                "checkRequest": row.get::<_, Option<String>>(5)?.map(from_json::<Value>).transpose()?,
                "diceResult": row.get::<_, Option<String>>(6)?.map(from_json::<Value>).transpose()?,
                "resolved": row.get::<_, Option<String>>(7)?.is_some(),
            }))
        })?
        .collect::<Result<Vec<_>, _>>()?)
}

fn latest_turn(
    connection: &Connection,
    adventure_id: &str,
) -> Result<StoredTurn, CampaignStoreError> {
    connection
        .query_row(
            "SELECT id, turn_number, scene_text, player_action_json,
                    check_request_json, dice_result_json
             FROM adventure_turns WHERE adventure_id = ?1
             ORDER BY turn_number DESC LIMIT 1",
            [adventure_id],
            |row| {
                Ok(StoredTurn {
                    id: row.get(0)?,
                    turn_number: row.get(1)?,
                    scene_text: row.get(2)?,
                    player_action: from_json(row.get(3)?)?,
                    check_request: row
                        .get::<_, Option<String>>(4)?
                        .map(from_json)
                        .transpose()?,
                    dice_result: row
                        .get::<_, Option<String>>(5)?
                        .map(from_json)
                        .transpose()?,
                })
            },
        )
        .optional()?
        .ok_or(CampaignStoreError::NotFound)
}

fn pending_turn(
    connection: &Connection,
    adventure_id: &str,
) -> Result<StoredTurn, CampaignStoreError> {
    let turn = latest_turn(connection, adventure_id)?;
    if turn.check_request.is_none() && turn.dice_result.is_none() {
        Ok(turn)
    } else {
        Err(CampaignStoreError::InvalidState)
    }
}

fn active_adventure(
    connection: &Connection,
    campaign_id: &str,
) -> Result<Option<(String, String, String, i64)>, CampaignStoreError> {
    connection
        .query_row(
            "SELECT id, quest_id, state, current_turn_number
             FROM adventures WHERE campaign_id = ?1 AND state <> 'SETTLED'",
            [campaign_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .optional()
        .map_err(Into::into)
}

fn active_adventure_id(
    connection: &Connection,
    campaign_id: &str,
) -> Result<Option<String>, CampaignStoreError> {
    Ok(active_adventure(connection, campaign_id)?.map(|value| value.0))
}

fn accepted_quest_id(
    connection: &Connection,
    campaign_id: &str,
) -> Result<Option<String>, CampaignStoreError> {
    connection
        .query_row(
            "SELECT id FROM quests WHERE campaign_id = ?1 AND status IN ('ACCEPTED', 'ACTIVE')
             ORDER BY updated_at DESC LIMIT 1",
            [campaign_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(Into::into)
}

fn player_character_id(
    connection: &Connection,
    campaign_id: &str,
) -> Result<String, CampaignStoreError> {
    connection
        .query_row(
            "SELECT id FROM player_characters WHERE campaign_id = ?1",
            [campaign_id],
            |row| row.get(0),
        )
        .optional()?
        .ok_or(CampaignStoreError::InvalidData)
}

fn adventure_quest(
    connection: &Connection,
    campaign_id: &str,
    adventure_id: &str,
    state: &str,
) -> Result<String, CampaignStoreError> {
    connection
        .query_row(
            "SELECT quest_id FROM adventures
             WHERE id = ?1 AND campaign_id = ?2 AND state = ?3",
            params![adventure_id, campaign_id, state],
            |row| row.get(0),
        )
        .optional()?
        .ok_or(CampaignStoreError::InvalidState)
}

fn adventure_quest_any(
    connection: &Connection,
    campaign_id: &str,
    adventure_id: &str,
) -> Result<String, CampaignStoreError> {
    connection
        .query_row(
            "SELECT quest_id FROM adventures WHERE id = ?1 AND campaign_id = ?2",
            params![adventure_id, campaign_id],
            |row| row.get(0),
        )
        .optional()?
        .ok_or(CampaignStoreError::NotFound)
}

fn require_adventure_state(
    connection: &Connection,
    campaign_id: &str,
    adventure_id: &str,
    state: &str,
) -> Result<(), CampaignStoreError> {
    let stored = connection
        .query_row(
            "SELECT state FROM adventures WHERE id = ?1 AND campaign_id = ?2",
            params![adventure_id, campaign_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .ok_or(CampaignStoreError::NotFound)?;
    if stored == state {
        Ok(())
    } else {
        Err(CampaignStoreError::InvalidState)
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

fn validate_plan(output: &PlanOutput) -> Result<(), CampaignStoreError> {
    for text in output
        .core_scenes
        .iter()
        .chain(output.major_obstacles.iter())
        .chain(output.possible_endings.iter())
        .chain([&output.objective, &output.failure_cost])
    {
        validate_text(text, 4_000)?;
    }
    if output.expected_turns.min < 8
        || output.expected_turns.max > 12
        || output.expected_turns.max < output.expected_turns.min
        || output.core_scenes.is_empty()
        || output.necessary_clues.is_empty()
    {
        return Err(CampaignStoreError::InvalidData);
    }
    for clue in &output.necessary_clues {
        validate_text(&clue.title, 200)?;
        validate_text(&clue.description, 4_000)?;
    }
    Ok(())
}

fn validate_turn_output(output: &TurnOutput) -> Result<(), CampaignStoreError> {
    validate_text(&output.scene_text, 4_000)?;
    if output.suggested_actions.len() > 5
        || !["SCENE", "WAITING_FOR_PLAYER", "CHECK_REQUIRED", "ENDING"]
            .contains(&output.adventure_state.as_str())
        || (output.check_request.is_some() != (output.adventure_state == "CHECK_REQUIRED"))
    {
        return Err(CampaignStoreError::InvalidData);
    }
    for action in &output.suggested_actions {
        validate_text(&action.text, 4_000)?;
    }
    if let Some(check) = &output.check_request {
        if !["physique", "agility", "knowledge", "charisma"].contains(&check.attribute.as_str())
            || ![8, 11, 14, 17].contains(&check.difficulty)
        {
            return Err(CampaignStoreError::InvalidData);
        }
        validate_text(&check.reason, 4_000)?;
    }
    Ok(())
}

fn validate_turn_references(
    connection: &Connection,
    campaign_id: &str,
    adventure_id: &str,
    output: &TurnOutput,
) -> Result<(), CampaignStoreError> {
    let quest_id = adventure_quest_any(connection, campaign_id, adventure_id)?;
    let quest = quest_data(connection, campaign_id, &quest_id)?;
    let allowed_npcs = array_field(&quest, "relatedNpcIds")?;
    if output.speaker_npc_ids.iter().any(|id| {
        !allowed_npcs
            .iter()
            .any(|allowed| allowed.as_str() == Some(id))
    }) {
        return Err(CampaignStoreError::InvalidData);
    }
    let clues = load_clues(connection, adventure_id)?;
    if output.discovered_clues.iter().any(|title| {
        !clues
            .iter()
            .any(|clue| clue.get("title").and_then(Value::as_str) == Some(title))
    }) {
        return Err(CampaignStoreError::InvalidData);
    }
    Ok(())
}

fn apply_fact_patches(
    transaction: &Transaction<'_>,
    campaign_id: &str,
    proposals: &[Value],
    at: &str,
) -> Result<(), CampaignStoreError> {
    for proposal in proposals {
        if text_field(proposal, "kind")? != "FACT"
            || proposal.get("targetId") != Some(&Value::Null)
            || text_field(proposal, "rationale")?.is_empty()
        {
            return Err(CampaignStoreError::InvalidData);
        }
        let payload = record_field(proposal, "payload")?;
        let statement = text_field(&payload, "statement")?;
        validate_text(&statement, 4_000)?;
        transaction.execute(
            "INSERT INTO world_facts (
               id, campaign_id, kind, statement, location_id, faction_ids_json,
               detail_json, supersedes_fact_id, created_at
             ) VALUES (?1, ?2, 'DEVELOPING_FACT', ?3, NULL, '[]', '{}', NULL, ?4)",
            params![Uuid::new_v4().to_string(), campaign_id, statement, at],
        )?;
    }
    Ok(())
}

fn equipment_modifier(
    connection: &Connection,
    campaign_id: &str,
    attribute: &str,
) -> Result<i64, CampaignStoreError> {
    let mut statement = connection.prepare(
        "SELECT effect_json FROM items WHERE campaign_id = ?1 AND owner_character_id IS NOT NULL",
    )?;
    let effects = statement
        .query_map([campaign_id], |row| from_json::<Value>(row.get(0)?))?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(effects
        .iter()
        .filter(|effect| {
            effect.get("kind").and_then(Value::as_str) == Some("CHECK_MODIFIER")
                && effect.get("attribute").and_then(Value::as_str) == Some(attribute)
        })
        .filter_map(|effect| effect.get("modifier").and_then(Value::as_i64))
        .sum())
}

fn validate_audit(audit: &TavernGenerationAudit, task: &str) -> Result<(), CampaignStoreError> {
    validate_id(&audit.request_id)?;
    validate_id(&audit.generation_record_id)?;
    validate_id(&audit.idempotency_key)?;
    let raw: Value = serde_json::from_str(&audit.raw_response_text)
        .map_err(|_| CampaignStoreError::InvalidData)?;
    if audit.prompt_version < 1
        || !audit.input.is_object()
        || audit.request.get("task").and_then(Value::as_str) != Some(task)
        || raw != audit.validated_output
    {
        return Err(CampaignStoreError::InvalidData);
    }
    Ok(())
}

fn insert_generation(
    transaction: &Transaction<'_>,
    campaign_id: &str,
    turn_id: Option<&str>,
    task: &str,
    audit: &TavernGenerationAudit,
    at: &str,
) -> Result<(), CampaignStoreError> {
    transaction.execute(
        "INSERT INTO pending_ai_requests (
           id, campaign_id, turn_id, idempotency_key, task, status, model_profile_id,
           input_json, context_json, attempt_count, last_error_json, created_at, updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, 'COMMITTED', NULL, ?6, ?7, 1, NULL, ?8, ?8)",
        params![
            audit.request_id,
            campaign_id,
            turn_id,
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

fn insert_event(
    transaction: &Transaction<'_>,
    campaign_id: &str,
    event_type: &str,
    payload: Value,
    at: &str,
) -> Result<(), CampaignStoreError> {
    transaction.execute(
        "INSERT INTO game_events (
           id, campaign_id, schema_version, type, payload_json, occurred_at
         ) VALUES (?1, ?2, 1, ?3, ?4, ?5)",
        params![
            Uuid::new_v4().to_string(),
            campaign_id,
            event_type,
            payload.to_string(),
            at,
        ],
    )?;
    Ok(())
}

fn action_text(value: &Value) -> Result<String, CampaignStoreError> {
    let kind = text_field(value, "kind")?;
    match kind.as_str() {
        "SUGGESTED" | "FREEFORM" => text_field(value, "text"),
        "USE_ITEM" => text_field(value, "intent"),
        "EXIT_ADVENTURE" => text_field(value, "reason"),
        _ => Err(CampaignStoreError::InvalidData),
    }
}

fn action_text_sql(value: &Value) -> rusqlite::Result<String> {
    action_text(value).map_err(|_| rusqlite::Error::InvalidQuery)
}

fn record_field(value: &Value, name: &str) -> Result<Value, CampaignStoreError> {
    value
        .get(name)
        .and_then(Value::as_object)
        .cloned()
        .map(Value::Object)
        .ok_or(CampaignStoreError::InvalidData)
}

fn array_field(value: &Value, name: &str) -> Result<Vec<Value>, CampaignStoreError> {
    value
        .get(name)
        .and_then(Value::as_array)
        .cloned()
        .ok_or(CampaignStoreError::InvalidData)
}

fn text_field(value: &Value, name: &str) -> Result<String, CampaignStoreError> {
    value
        .get(name)
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or(CampaignStoreError::InvalidData)
}

fn integer_field(value: &Value, name: &str) -> Result<i64, CampaignStoreError> {
    value
        .get(name)
        .and_then(Value::as_i64)
        .ok_or(CampaignStoreError::InvalidData)
}

fn validate_text(value: &str, max: usize) -> Result<(), CampaignStoreError> {
    if value.is_empty() || value.trim() != value || value.chars().count() > max {
        Err(CampaignStoreError::InvalidData)
    } else {
        Ok(())
    }
}

fn from_json<T: for<'de> Deserialize<'de>>(value: String) -> rusqlite::Result<T> {
    serde_json::from_str(&value).map_err(|_| rusqlite::Error::InvalidQuery)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn completes_eight_turns_with_checks_and_restores_the_ending() {
        let directory = tempfile::tempdir().expect("temp directory");
        let database_path = directory.path().join("ember-tavern.sqlite");
        let store = CampaignStore::open(&database_path).expect("open database");
        seed_adventure(&store);

        let initial = store
            .adventure_snapshot("campaign-adventure", Some("quest-beacon"))
            .expect("initial snapshot");
        let prepared = store
            .commit_adventure_plan(AdventurePlanCommit {
                campaign_id: "campaign-adventure".to_owned(),
                quest_id: "quest-beacon".to_owned(),
                generation: audit(
                    "GENERATE_ADVENTURE_PLAN",
                    initial.plan_input,
                    json!({
                        "questId": "quest-beacon",
                        "playerCharacterId": "character-player",
                    }),
                    plan_output(),
                    0,
                ),
            })
            .expect("prepare adventure");
        let adventure_id = prepared.adventure_id.expect("adventure id");
        let mut snapshot = store
            .start_adventure("campaign-adventure", &adventure_id)
            .expect("start adventure");

        for turn_number in 1..=8 {
            let pending = store
                .submit_adventure_action(AdventureActionSubmit {
                    campaign_id: "campaign-adventure".to_owned(),
                    adventure_id: adventure_id.clone(),
                    player_action: format!("Take action {turn_number}"),
                })
                .expect("submit action");
            let context_traits = pending
                .turn_generation_context
                .as_ref()
                .and_then(|context| context.get("playerCharacter"))
                .and_then(|player| player.get("traits"))
                .and_then(Value::as_array)
                .expect("minimal character traits");
            assert!(context_traits.iter().all(|character_trait| {
                character_trait.get("name").is_some()
                    && character_trait.get("description").is_some()
                    && character_trait.get("id").is_none()
            }));
            let turn_id = pending
                .turns
                .last()
                .and_then(|turn| turn.get("id"))
                .and_then(Value::as_str)
                .expect("turn id")
                .to_owned();
            let ending = turn_number == 8;
            snapshot = store
                .commit_adventure_turn(AdventureTurnCommit {
                    campaign_id: "campaign-adventure".to_owned(),
                    adventure_id: adventure_id.clone(),
                    generation: audit(
                        "GENERATE_ADVENTURE_TURN",
                        pending.turn_generation_context.expect("turn context"),
                        json!({ "adventureId": adventure_id, "turnId": turn_id }),
                        turn_output(ending),
                        turn_number,
                    ),
                })
                .expect("commit turn");
            if !ending {
                assert_eq!(snapshot.state.as_deref(), Some("CHECK_REQUIRED"));
                let rolled = store
                    .roll_adventure_check("campaign-adventure", &adventure_id)
                    .expect("roll check");
                snapshot = store
                    .commit_adventure_dice(AdventureDiceCommit {
                        campaign_id: "campaign-adventure".to_owned(),
                        adventure_id: adventure_id.clone(),
                        generation: audit(
                            "RESOLVE_DICE_RESULT",
                            rolled.dice_generation_input.expect("dice input"),
                            json!({ "adventureId": adventure_id, "turnId": turn_id }),
                            json!({
                                "narration": "The hidden catch yields.",
                                "consequence": "The path ahead opens.",
                                "statePatchProposals": [],
                            }),
                            turn_number,
                        ),
                    })
                    .expect("commit dice");
                assert_eq!(snapshot.state.as_deref(), Some("SCENE"));
            }
        }

        assert_eq!(snapshot.state.as_deref(), Some("ENDING"));
        assert_eq!(snapshot.current_turn_number, 8);
        assert_eq!(snapshot.turns.len(), 8);
        drop(store);

        let reopened = CampaignStore::open(database_path).expect("reopen database");
        let restored = reopened
            .adventure_snapshot("campaign-adventure", None)
            .expect("restore ending");
        assert_eq!(restored.state.as_deref(), Some("ENDING"));
        assert_eq!(restored.current_turn_number, 8);
        assert_eq!(restored.turns.len(), 8);
    }

    fn plan_output() -> Value {
        json!({
            "objective": "Restore the beacon.",
            "risk": "MODERATE",
            "expectedTurns": { "min": 8, "max": 12 },
            "coreScenes": ["Open the cellar.", "Cross the causeway.", "Reach the beacon."],
            "necessaryClues": [
                { "title": "Scorched Lens", "description": "Burned from inside.", "isCore": true },
                { "title": "Tide Ledger", "description": "A deliberate schedule.", "isCore": true },
                { "title": "Keeper Signet", "description": "The keeper sealed it.", "isCore": true }
            ],
            "majorObstacles": ["A rusted lock."],
            "possibleEndings": ["The beacon is restored.", "The harbor evacuates."],
            "failureCost": "Ships remain trapped."
        })
    }

    fn turn_output(ending: bool) -> Value {
        if ending {
            json!({
                "sceneText": "The beacon catches as the storm breaks.",
                "speakerNpcIds": [],
                "suggestedActions": [],
                "checkRequest": null,
                "discoveredClues": [],
                "statePatchProposals": [],
                "adventureState": "ENDING"
            })
        } else {
            json!({
                "sceneText": "Warm light leaks through the old cellar lock.",
                "speakerNpcIds": [],
                "suggestedActions": [{ "text": "Study the lock." }],
                "checkRequest": {
                    "attribute": "knowledge",
                    "difficulty": 11,
                    "reason": "Identify the hidden mechanism."
                },
                "discoveredClues": ["Scorched Lens"],
                "statePatchProposals": [],
                "adventureState": "CHECK_REQUIRED"
            })
        }
    }

    fn audit(
        task: &str,
        input: Value,
        context: Value,
        output: Value,
        index: i64,
    ) -> TavernGenerationAudit {
        TavernGenerationAudit {
            request_id: format!("adventure-request-{task}-{index}"),
            generation_record_id: format!("adventure-generation-{task}-{index}"),
            idempotency_key: format!("adventure:{task}:{index}"),
            prompt_version: 1,
            input,
            context,
            request: json!({ "task": task }),
            raw_response_text: output.to_string(),
            validated_output: output,
        }
    }

    fn seed_adventure(store: &CampaignStore) {
        let connection = store.connect().expect("connect");
        connection
            .execute_batch(
                "INSERT INTO campaigns (
                   id, schema_version, state, resume_state, created_at, updated_at
                 ) VALUES (
                   'campaign-adventure', 1, 'TAVERN', NULL,
                   '2026-07-31T06:00:00.000Z', '2026-07-31T06:00:00.000Z'
                 );
                 INSERT INTO world_bibles (
                   campaign_id, schema_version, name, current_region, summary, core_conflict,
                   technology_level, power_rules_json, factions_json, locations_json,
                   narrative_style, forbidden_elements_json, tavern_reason, story_hooks_json,
                   locked_fields_json, created_at, updated_at
                 ) VALUES (
                   'campaign-adventure', 1, 'Ember Coast', 'Ash Harbor',
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
                   'character-player', 'campaign-adventure', 'Mara', NULL, NULL, 'Curious scout',
                   '[]', '[]', 'ROGUE', 'Scout',
                   '{\"physique\":2,\"agility\":4,\"knowledge\":3,\"charisma\":1}',
                   '[{\"name\":\"Keen Eye\",\"description\":\"Notices details.\"},{\"name\":\"Sure Step\",\"description\":\"Moves safely.\"}]',
                   'Find the road.', '{}', '[]',
                   '2026-07-31T06:00:00.000Z', '2026-07-31T06:00:00.000Z'
                 );
                 INSERT INTO taverns (
                   id, campaign_id, location_id, name, position, environment,
                   special_rules_json, long_term_problem, owner_npc_id, changes_json,
                   created_at, updated_at
                 ) VALUES (
                   'tavern-rest', 'campaign-adventure', 'location-harbor', 'Ember Rest',
                   'Crossroads', 'Warm stone hall.', '[]', 'Cellar light.', NULL, '[]',
                   '2026-07-31T06:00:00.000Z', '2026-07-31T06:00:00.000Z'
                 );
                 INSERT INTO npcs (
                   id, campaign_id, tavern_id, residency, name, identity, appearance,
                   personality, goal, secret, speech_style, current_mood, current_status,
                   visit_json, memories_json, created_at, updated_at
                 ) VALUES (
                   'npc-owner', 'campaign-adventure', 'tavern-rest', 'OWNER', 'Ilyra Venn',
                   'Innkeeper', 'A red coat.', 'Observant.', 'Keep the road open.',
                   'Tunnel secret.', 'Measured.', 'Concerned', 'ACTIVE', NULL, '[]',
                   '2026-07-31T06:00:00.000Z', '2026-07-31T06:00:00.000Z'
                 );
                 UPDATE taverns SET owner_npc_id = 'npc-owner' WHERE id = 'tavern-rest';
                 INSERT INTO quests (
                   id, campaign_id, publisher_npc_id, content_json, status, risk,
                   recommended_attributes_json, expected_turns_min, expected_turns_max,
                   reward_tier, related_npc_ids_json, related_fact_ids_json, created_at, updated_at
                 ) VALUES (
                   'quest-beacon', 'campaign-adventure', 'npc-owner',
                   '{\"title\":\"The Fading Beacon\",\"summary\":\"Investigate the failing lighthouse.\",\"objective\":\"Restore the beacon.\",\"failureCost\":\"Ships remain trapped.\"}',
                   'ACCEPTED', 'MODERATE', '[\"knowledge\",\"agility\"]', 8, 12,
                   'NOTABLE', '[]', '[]',
                   '2026-07-31T06:00:00.000Z', '2026-07-31T06:00:00.000Z'
                 );",
            )
            .expect("seed adventure");
    }
}

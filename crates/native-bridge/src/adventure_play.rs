use rusqlite::{Connection, OptionalExtension, Transaction, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use uuid::Uuid;

use crate::npc_dialogue::validate_knowledge_provenance;
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
    pub scene_frame: Option<Value>,
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
    pub action_mode: String,
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
        let participants = scene_participants(&transaction, &command.campaign_id, &[])?;
        let location = array_field(&plan, "coreScenes")?
            .first()
            .and_then(Value::as_str)
            .ok_or(CampaignStoreError::InvalidData)?
            .to_owned();
        let return_event_id = match latest_game_event_id(
            &transaction,
            &command.campaign_id,
            Some("QUEST_ACCEPTED"),
        ) {
            Ok(event_id) => event_id,
            Err(CampaignStoreError::NotFound) => insert_event(
                &transaction,
                &command.campaign_id,
                "QUEST_ACCEPTED",
                json!({ "questId": command.quest_id, "adventureId": adventure_id }),
                &at,
            )?,
            Err(error) => return Err(error),
        };
        write_scene_frame(
            &transaction,
            &command.campaign_id,
            &adventure_id,
            &command.generation.idempotency_key,
            &format!("{adventure_id}:scene:0"),
            &location,
            participants,
            Vec::new(),
            Vec::new(),
            &location,
            &return_event_id,
            &at,
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
        validate_action_mode(&command.action_mode)?;
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
                json!({
                    "kind": "FREEFORM",
                    "mode": command.action_mode,
                    "text": command.player_action,
                })
                .to_string(),
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
        let affordances = suggested_actions
            .iter()
            .map(|action| {
                Ok(json!({
                    "id": text_field(action, "optionId")?,
                    "label": text_field(action, "text")?,
                    "preconditions": [],
                }))
            })
            .collect::<Result<Vec<_>, CampaignStoreError>>()?;
        let pending_consequences = match check_request.as_ref() {
            Some(check) => vec![json!({
                "id": text_field(check, "id")?,
                "trigger": "CHECK_REQUIRED",
                "payload": check,
            })],
            None => Vec::new(),
        };
        let participants =
            scene_participants(&transaction, &command.campaign_id, &output.speaker_npc_ids)?;
        let location = scene_location(&transaction, &command.adventure_id, turn.turn_number)?;
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
        let return_event_id = insert_event(
            &transaction,
            &command.campaign_id,
            "PLAYER_ACTION_SUBMITTED",
            json!({ "adventureId": command.adventure_id, "turnId": turn.id }),
            &at,
        )?;
        write_scene_frame(
            &transaction,
            &command.campaign_id,
            &command.adventure_id,
            &command.generation.idempotency_key,
            &turn.id,
            &location,
            participants,
            affordances,
            pending_consequences,
            &output.scene_text,
            &return_event_id,
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
        let dice = resolve_d20_hard_logic(
            &text_field(&check, "id")?,
            roll_unbiased_d20(),
            attribute_value,
            equipment_modifier,
            0,
            difficulty,
        )?;
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
        let current_frame = load_scene_frame(&transaction, &command.adventure_id)?;
        let return_event_id =
            latest_game_event_id(&transaction, &command.campaign_id, Some("DICE_ROLLED"))?;
        write_scene_frame(
            &transaction,
            &command.campaign_id,
            &command.adventure_id,
            &command.generation.idempotency_key,
            &text_field(&current_frame, "sceneId")?,
            &text_field(&current_frame, "location")?,
            array_field(&current_frame, "participants")?,
            array_field(&current_frame, "affordances")?,
            Vec::new(),
            &combined,
            &return_event_id,
            &at,
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
            scene_frame: None,
            suggested_actions: Vec::new(),
            turn_generation_context: None,
            dice_generation_input: None,
        });
    };
    let clues = load_clues(connection, &adventure_id)?;
    let turns = load_turn_views(connection, &adventure_id)?;
    let latest = latest_turn(connection, &adventure_id).ok();
    let scene_frame = Some(load_scene_frame(connection, &adventure_id)?);
    let current_scene = text_field(
        &record_field(
            scene_frame
                .as_ref()
                .ok_or(CampaignStoreError::InvalidData)?,
            "returnPoint",
        )?,
        "summary",
    )?;
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
        scene_frame,
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

pub(crate) fn load_scene_frame(
    connection: &Connection,
    adventure_id: &str,
) -> Result<Value, CampaignStoreError> {
    if let Some(frame) = load_persisted_scene_frame(connection, adventure_id)? {
        validate_scene_frame(&frame)?;
        validate_scene_frame_projection(connection, adventure_id, &frame)?;
        return Ok(frame);
    }
    let (campaign_id, current_turn_number): (String, i64) = connection
        .query_row(
            "SELECT campaign_id, current_turn_number FROM adventures WHERE id = ?1",
            [adventure_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?
        .ok_or(CampaignStoreError::NotFound)?;
    let latest = latest_turn(connection, adventure_id).ok();
    let speaker_ids = latest
        .as_ref()
        .map(|turn| turn_speaker_ids(connection, &turn.id))
        .transpose()?
        .unwrap_or_default();
    let participants = scene_participants(connection, &campaign_id, &speaker_ids)?;
    let location = scene_location(connection, adventure_id, current_turn_number.max(1))?;
    let event_id = match latest_game_event_id(connection, &campaign_id, None) {
        Ok(event_id) => event_id,
        Err(CampaignStoreError::NotFound) => adventure_id.to_owned(),
        Err(error) => return Err(error),
    };
    let summary = latest
        .map(|turn| turn.scene_text)
        .unwrap_or_else(|| location.clone());
    Ok(json!({
        "sceneId": format!("{adventure_id}:legacy"),
        "location": location,
        "participants": participants,
        "pressure": scene_pressure(connection, &campaign_id)?,
        "affordances": [],
        "pendingConsequences": [],
        "returnPoint": { "eventId": event_id, "summary": summary },
        "revision": 1,
    }))
}

fn load_persisted_scene_frame(
    connection: &Connection,
    adventure_id: &str,
) -> Result<Option<Value>, CampaignStoreError> {
    let row = connection
        .query_row(
            "SELECT scene_id, location, participants_json, pressure_json, affordances_json,
                    pending_consequences_json, return_point_json, revision
             FROM scene_frames WHERE adventure_id = ?1",
            [adventure_id],
            |row| {
                Ok(json!({
                    "sceneId": row.get::<_, String>(0)?,
                    "location": row.get::<_, String>(1)?,
                    "participants": from_json::<Value>(row.get(2)?)?,
                    "pressure": from_json::<Value>(row.get(3)?)?,
                    "affordances": from_json::<Value>(row.get(4)?)?,
                    "pendingConsequences": from_json::<Value>(row.get(5)?)?,
                    "returnPoint": from_json::<Value>(row.get(6)?)?,
                    "revision": row.get::<_, i64>(7)?,
                }))
            },
        )
        .optional()?;
    Ok(row)
}

#[allow(clippy::too_many_arguments)]
fn write_scene_frame(
    transaction: &Transaction<'_>,
    campaign_id: &str,
    adventure_id: &str,
    operation_id: &str,
    scene_id: &str,
    location: &str,
    participants: Vec<Value>,
    affordances: Vec<Value>,
    pending_consequences: Vec<Value>,
    summary: &str,
    return_event_id: &str,
    at: &str,
) -> Result<Value, CampaignStoreError> {
    validate_id(operation_id)?;
    validate_id(scene_id)?;
    validate_text(location, 4_000)?;
    validate_text(summary, 12_000)?;
    validate_id(return_event_id)?;
    if !adventure_exists(transaction, campaign_id, adventure_id)? {
        return Err(CampaignStoreError::NotFound);
    }
    let revision = transaction.query_row(
        "SELECT COALESCE(MAX(revision) + 1, 1) FROM (
           SELECT revision FROM event_ledger
           WHERE aggregate_type = 'SCENE' AND aggregate_id = ?1
           UNION ALL
           SELECT revision FROM scene_frames WHERE adventure_id = ?1
         )",
        [adventure_id],
        |row| row.get::<_, i64>(0),
    )?;
    let frame = json!({
        "sceneId": scene_id,
        "location": location,
        "participants": participants,
        "pressure": scene_pressure(transaction, campaign_id)?,
        "affordances": affordances,
        "pendingConsequences": pending_consequences,
        "returnPoint": { "eventId": return_event_id, "summary": summary },
        "revision": revision,
    });
    validate_scene_frame(&frame)?;
    let return_point = record_field(&frame, "returnPoint")?;
    let changed = transaction.execute(
        "INSERT INTO scene_frames (
           adventure_id, campaign_id, scene_id, location, participants_json, pressure_json,
           affordances_json, pending_consequences_json, return_point_json, revision, updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
         ON CONFLICT(adventure_id) DO UPDATE SET
           scene_id = excluded.scene_id,
           location = excluded.location,
           participants_json = excluded.participants_json,
           pressure_json = excluded.pressure_json,
           affordances_json = excluded.affordances_json,
           pending_consequences_json = excluded.pending_consequences_json,
           return_point_json = excluded.return_point_json,
           revision = excluded.revision,
           updated_at = excluded.updated_at
         WHERE scene_frames.campaign_id = excluded.campaign_id
           AND scene_frames.revision + 1 = excluded.revision",
        params![
            adventure_id,
            campaign_id,
            scene_id,
            location,
            Value::Array(array_field(&frame, "participants")?).to_string(),
            Value::Array(array_field(&frame, "pressure")?).to_string(),
            Value::Array(array_field(&frame, "affordances")?).to_string(),
            Value::Array(array_field(&frame, "pendingConsequences")?).to_string(),
            return_point.to_string(),
            revision,
            at,
        ],
    )?;
    if changed != 1 {
        return Err(CampaignStoreError::InvalidState);
    }
    transaction.execute(
        "INSERT INTO event_ledger (
           id, campaign_id, event_type, operation_id, aggregate_type, aggregate_id,
           revision, payload_json, payload_version, source, occurred_at
         ) VALUES (?1, ?2, 'SCENE_COMMITTED', ?3, 'SCENE', ?4, ?5, ?6, 1, 'SYSTEM', ?7)",
        params![
            Uuid::new_v4().to_string(),
            campaign_id,
            operation_id,
            adventure_id,
            revision,
            frame.to_string(),
            at,
        ],
    )?;
    Ok(frame)
}

fn validate_scene_frame(frame: &Value) -> Result<(), CampaignStoreError> {
    let root = frame.as_object().ok_or(CampaignStoreError::InvalidData)?;
    if root.len() != 8
        || ![
            "sceneId",
            "location",
            "participants",
            "pressure",
            "affordances",
            "pendingConsequences",
            "returnPoint",
            "revision",
        ]
        .iter()
        .all(|key| root.contains_key(*key))
    {
        return Err(CampaignStoreError::InvalidData);
    }
    validate_id(&text_field(frame, "sceneId")?)?;
    validate_text(&text_field(frame, "location")?, 4_000)?;
    let revision = integer_field(frame, "revision")?;
    let participants = array_field(frame, "participants")?;
    let pressure = array_field(frame, "pressure")?;
    let affordances = array_field(frame, "affordances")?;
    let pending = array_field(frame, "pendingConsequences")?;
    if revision < 1
        || participants.is_empty()
        || participants.len() > 30
        || pressure.len() > 30
        || affordances.len() > 10
        || pending.len() > 20
    {
        return Err(CampaignStoreError::InvalidData);
    }
    let mut participant_ids = std::collections::HashSet::new();
    for participant in participants {
        let id = participant
            .as_str()
            .ok_or(CampaignStoreError::InvalidData)?;
        validate_id(id)?;
        if !participant_ids.insert(id.to_owned()) {
            return Err(CampaignStoreError::InvalidData);
        }
    }
    for value in pressure {
        if value.as_object().is_none_or(|record| record.len() != 3) {
            return Err(CampaignStoreError::InvalidData);
        }
        validate_id(&text_field(&value, "id")?)?;
        validate_text(&text_field(&value, "kind")?, 200)?;
        if integer_field(&value, "level")? < 0 {
            return Err(CampaignStoreError::InvalidData);
        }
    }
    for value in affordances {
        if value.as_object().is_none_or(|record| record.len() != 3) {
            return Err(CampaignStoreError::InvalidData);
        }
        validate_id(&text_field(&value, "id")?)?;
        validate_text(&text_field(&value, "label")?, 4_000)?;
        let preconditions = array_field(&value, "preconditions")?;
        if preconditions.len() > 20 {
            return Err(CampaignStoreError::InvalidData);
        }
        for precondition in preconditions {
            validate_text(
                precondition
                    .as_str()
                    .ok_or(CampaignStoreError::InvalidData)?,
                4_000,
            )?;
        }
    }
    for value in pending {
        if value.as_object().is_none_or(|record| record.len() != 3) {
            return Err(CampaignStoreError::InvalidData);
        }
        validate_id(&text_field(&value, "id")?)?;
        validate_text(&text_field(&value, "trigger")?, 200)?;
        value
            .get("payload")
            .ok_or(CampaignStoreError::InvalidData)?;
    }
    let return_point = record_field(frame, "returnPoint")?;
    if return_point
        .as_object()
        .is_none_or(|record| record.len() != 2)
    {
        return Err(CampaignStoreError::InvalidData);
    }
    validate_id(&text_field(&return_point, "eventId")?)?;
    validate_text(&text_field(&return_point, "summary")?, 12_000)?;
    Ok(())
}

fn validate_scene_frame_projection(
    connection: &Connection,
    adventure_id: &str,
    frame: &Value,
) -> Result<(), CampaignStoreError> {
    let ledger = connection
        .query_row(
            "SELECT revision, payload_json FROM event_ledger
             WHERE aggregate_type = 'SCENE' AND aggregate_id = ?1
             ORDER BY revision DESC LIMIT 1",
            [adventure_id],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()?;
    if let Some((revision, payload)) = ledger {
        let ledger_frame: Value =
            serde_json::from_str(&payload).map_err(|_| CampaignStoreError::InvalidData)?;
        if revision != integer_field(frame, "revision")? || ledger_frame != *frame {
            return Err(CampaignStoreError::InvalidData);
        }
    }
    let return_point = record_field(frame, "returnPoint")?;
    let event_id = text_field(&return_point, "eventId")?;
    if connection
        .query_row(
            "SELECT 1 FROM game_events
             JOIN adventures ON adventures.id = ?2
             WHERE game_events.id = ?1
               AND game_events.campaign_id = adventures.campaign_id",
            params![event_id, adventure_id],
            |_| Ok(()),
        )
        .optional()?
        .is_none()
    {
        return Err(CampaignStoreError::InvalidData);
    }
    Ok(())
}

fn scene_participants(
    connection: &Connection,
    campaign_id: &str,
    npc_ids: &[String],
) -> Result<Vec<Value>, CampaignStoreError> {
    let mut values = vec![player_character_id(connection, campaign_id)?];
    for id in npc_ids {
        validate_id(id)?;
        if !values.contains(id) {
            values.push(id.clone());
        }
    }
    Ok(values.into_iter().map(Value::String).collect())
}

fn scene_pressure(
    connection: &Connection,
    campaign_id: &str,
) -> Result<Vec<Value>, CampaignStoreError> {
    let mut statement = connection.prepare(
        "SELECT id, current FROM world_clocks WHERE campaign_id = ?1 AND current > 0
         ORDER BY created_at, id LIMIT 30",
    )?;
    Ok(statement
        .query_map([campaign_id], |row| {
            Ok(json!({
                "id": row.get::<_, String>(0)?,
                "kind": "WORLD_CLOCK",
                "level": row.get::<_, i64>(1)?,
            }))
        })?
        .collect::<Result<Vec<_>, _>>()?)
}

fn scene_location(
    connection: &Connection,
    adventure_id: &str,
    turn_number: i64,
) -> Result<String, CampaignStoreError> {
    let plan: Value = connection.query_row(
        "SELECT plan_json FROM adventures WHERE id = ?1",
        [adventure_id],
        |row| from_json(row.get(0)?),
    )?;
    let scenes = array_field(&plan, "coreScenes")?;
    let index = usize::try_from(turn_number.saturating_sub(1)).unwrap_or(0);
    scenes
        .get(index.min(scenes.len().saturating_sub(1)))
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or(CampaignStoreError::InvalidData)
}

fn turn_speaker_ids(
    connection: &Connection,
    turn_id: &str,
) -> Result<Vec<String>, CampaignStoreError> {
    let raw: String = connection.query_row(
        "SELECT speaker_npc_ids_json FROM adventure_turns WHERE id = ?1",
        [turn_id],
        |row| row.get(0),
    )?;
    serde_json::from_str(&raw).map_err(|_| CampaignStoreError::InvalidData)
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
        "sceneFrame": load_scene_frame(connection, adventure_id)?,
        "longTermSummary": null,
        "recentTurns": recent_turns,
        "discoveredClues": discovered,
        "relatedNpcs": related_npcs,
        "knownFacts": adventure_known_facts(connection, campaign_id, &quest)?,
        "npcKnowledge": adventure_npc_knowledge(connection, campaign_id, &quest)?,
        "playerActionMode": action_mode(&turn.player_action)?,
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
    let hard = validate_stored_dice_result(dice)?;
    if hard.check_request_id != text_field(check, "id")?
        || hard.dc != integer_field(check, "difficulty")?
    {
        return Err(CampaignStoreError::InvalidData);
    }
    Ok(json!({
        "scene": turn.scene_text,
        "action": action_text(&turn.player_action)?,
        "attribute": text_field(check, "attribute")?,
        "raw": hard.raw,
        "modifier": hard.modifier,
        "total": hard.total,
        "dc": hard.dc,
        "result": hard.result,
    }))
}

struct StoredD20HardResult {
    check_request_id: String,
    raw: i64,
    modifier: i64,
    total: i64,
    dc: i64,
    result: String,
}

fn validate_stored_dice_result(dice: &Value) -> Result<StoredD20HardResult, CampaignStoreError> {
    let check_request_id = text_field(dice, "checkRequestId")?;
    let raw = consistent_integer(dice, &["raw", "naturalRoll", "d20"])?;
    let attribute_modifier = consistent_integer(dice, &["attributeModifier", "attributeValue"])?;
    let equipment_modifier = integer_field(dice, "equipmentModifier")?;
    let status_modifier = integer_field(dice, "statusModifier")?;
    let computed_modifier = attribute_modifier
        .checked_add(equipment_modifier)
        .and_then(|value| value.checked_add(status_modifier))
        .ok_or(CampaignStoreError::InvalidData)?;
    if let Some(value) = dice.get("modifier") {
        let modifier = value.as_i64().ok_or(CampaignStoreError::InvalidData)?;
        if modifier != computed_modifier {
            return Err(CampaignStoreError::InvalidData);
        }
    }
    let total = integer_field(dice, "total")?;
    let dc = consistent_integer(dice, &["dc", "difficulty"])?;
    let expected_success = total >= dc;
    let result = match dice.get("result") {
        Some(value) => match value.as_str() {
            Some("SUCCESS") => "SUCCESS",
            Some("FAILURE") => "FAILURE",
            _ => return Err(CampaignStoreError::InvalidData),
        },
        None => {
            if dice
                .get("success")
                .and_then(Value::as_bool)
                .ok_or(CampaignStoreError::InvalidData)?
            {
                "SUCCESS"
            } else {
                "FAILURE"
            }
        }
    };
    if let Some(value) = dice.get("success") {
        let success = value.as_bool().ok_or(CampaignStoreError::InvalidData)?;
        if success != (result == "SUCCESS") {
            return Err(CampaignStoreError::InvalidData);
        }
    }
    if !(1..=20).contains(&raw)
        || !(1..=5).contains(&attribute_modifier)
        || ![8, 11, 14, 17].contains(&dc)
        || raw.checked_add(computed_modifier) != Some(total)
        || expected_success != (result == "SUCCESS")
    {
        return Err(CampaignStoreError::InvalidData);
    }
    Ok(StoredD20HardResult {
        check_request_id,
        raw,
        modifier: computed_modifier,
        total,
        dc,
        result: result.to_owned(),
    })
}

fn consistent_integer(value: &Value, fields: &[&str]) -> Result<i64, CampaignStoreError> {
    let mut values = Vec::new();
    for field in fields {
        if let Some(candidate) = value.get(field) {
            values.push(candidate.as_i64().ok_or(CampaignStoreError::InvalidData)?);
        }
    }
    let first = *values.first().ok_or(CampaignStoreError::InvalidData)?;
    if values.iter().all(|candidate| *candidate == first) {
        Ok(first)
    } else {
        Err(CampaignStoreError::InvalidData)
    }
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

fn adventure_known_facts(
    connection: &Connection,
    campaign_id: &str,
    quest: &Value,
) -> Result<Vec<Value>, CampaignStoreError> {
    let mut ids = array_field(quest, "relatedFactIds")?
        .into_iter()
        .filter_map(|value| value.as_str().map(str::to_owned))
        .collect::<Vec<_>>();
    let mut locked = connection.prepare(
        "SELECT id FROM world_facts
         WHERE campaign_id = ?1 AND kind = 'LOCKED_RULE' ORDER BY created_at, id LIMIT 30",
    )?;
    ids.extend(
        locked
            .query_map([campaign_id], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?,
    );
    ids.sort();
    ids.dedup();
    let mut result = Vec::new();
    for id in ids.into_iter().take(30) {
        let fact = connection
            .query_row(
                "SELECT id, kind, statement FROM world_facts
                 WHERE id = ?1 AND campaign_id = ?2 AND kind <> 'FALSE_BELIEF'",
                params![id, campaign_id],
                |row| {
                    Ok(json!({
                        "id": row.get::<_, String>(0)?,
                        "kind": row.get::<_, String>(1)?,
                        "statement": row.get::<_, String>(2)?,
                    }))
                },
            )
            .optional()?;
        if let Some(fact) = fact {
            result.push(fact);
        }
    }
    Ok(result)
}

fn adventure_npc_knowledge(
    connection: &Connection,
    campaign_id: &str,
    quest: &Value,
) -> Result<Vec<Value>, CampaignStoreError> {
    let mut result = Vec::new();
    for npc_id in array_field(quest, "relatedNpcIds")?
        .into_iter()
        .filter_map(|value| value.as_str().map(str::to_owned))
        .take(12)
    {
        let knowledge = connection
            .query_row(
                "SELECT known_fact_ids_json, suspected_fact_ids_json,
                        false_belief_fact_ids_json, excluded_secret_fact_ids_json, provenance_json
                 FROM npc_knowledge
                 JOIN npcs ON npcs.id = npc_knowledge.npc_id
                 WHERE npc_knowledge.npc_id = ?1 AND npcs.campaign_id = ?2",
                params![npc_id, campaign_id],
                |row| {
                    Ok((
                        from_json::<Vec<String>>(row.get(0)?)?,
                        from_json::<Vec<String>>(row.get(1)?)?,
                        from_json::<Vec<String>>(row.get(2)?)?,
                        from_json::<Vec<String>>(row.get(3)?)?,
                        row.get::<_, String>(4)?,
                    ))
                },
            )
            .optional()?;
        if let Some((known, suspected, false_beliefs, excluded, provenance)) = knowledge {
            validate_knowledge_provenance(
                connection,
                campaign_id,
                &npc_id,
                &known,
                &suspected,
                &false_beliefs,
                &excluded,
                &provenance,
            )?;
            let excluded = excluded
                .into_iter()
                .collect::<std::collections::HashSet<_>>();
            result.push(json!({
                "npcId": npc_id,
                "knownFacts": fact_statements(connection, campaign_id, &known, &excluded)?,
                "suspectedFacts": fact_statements(connection, campaign_id, &suspected, &excluded)?,
                "falseBeliefs": fact_statements(connection, campaign_id, &false_beliefs, &excluded)?,
            }));
        }
    }
    Ok(result)
}

fn fact_statements(
    connection: &Connection,
    campaign_id: &str,
    ids: &[String],
    excluded: &std::collections::HashSet<String>,
) -> Result<Vec<String>, CampaignStoreError> {
    let mut statements = Vec::new();
    for id in ids.iter().filter(|id| !excluded.contains(*id)).take(30) {
        if let Some(statement) = connection
            .query_row(
                "SELECT statement FROM world_facts WHERE id = ?1 AND campaign_id = ?2",
                params![id, campaign_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?
        {
            statements.push(statement);
        }
    }
    Ok(statements)
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
                "actionMode": action_mode_sql(&player_action)?,
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

fn adventure_exists(
    connection: &Connection,
    campaign_id: &str,
    adventure_id: &str,
) -> Result<bool, CampaignStoreError> {
    Ok(connection
        .query_row(
            "SELECT 1 FROM adventures WHERE id = ?1 AND campaign_id = ?2",
            params![adventure_id, campaign_id],
            |_| Ok(()),
        )
        .optional()?
        .is_some())
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
    let suggestion_count = output.suggested_actions.len();
    if (output.adventure_state == "ENDING" && suggestion_count != 0)
        || (output.adventure_state != "ENDING" && !(3..=5).contains(&suggestion_count))
        || !["SCENE", "WAITING_FOR_PLAYER", "CHECK_REQUIRED", "ENDING"]
            .contains(&output.adventure_state.as_str())
        || (output.check_request.is_some() != (output.adventure_state == "CHECK_REQUIRED"))
    {
        return Err(CampaignStoreError::InvalidData);
    }
    let mut suggestions = std::collections::HashSet::new();
    for action in &output.suggested_actions {
        validate_text(&action.text, 4_000)?;
        if !suggestions.insert(action.text.trim().to_lowercase()) {
            return Err(CampaignStoreError::InvalidData);
        }
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
    effects
        .iter()
        .filter(|effect| {
            effect.get("kind").and_then(Value::as_str) == Some("CHECK_MODIFIER")
                && effect.get("attribute").and_then(Value::as_str) == Some(attribute)
        })
        .filter_map(|effect| effect.get("modifier").and_then(Value::as_i64))
        .try_fold(0_i64, |total, modifier| {
            total
                .checked_add(modifier)
                .ok_or(CampaignStoreError::InvalidData)
        })
}

fn roll_unbiased_d20() -> i64 {
    loop {
        let byte = Uuid::new_v4().as_bytes()[0];
        if byte < 240 {
            return i64::from(byte % 20) + 1;
        }
    }
}

fn resolve_d20_hard_logic(
    check_request_id: &str,
    raw: i64,
    attribute_modifier: i64,
    equipment_modifier: i64,
    status_modifier: i64,
    dc: i64,
) -> Result<Value, CampaignStoreError> {
    validate_id(check_request_id)?;
    if !(1..=20).contains(&raw)
        || !(1..=5).contains(&attribute_modifier)
        || ![8, 11, 14, 17].contains(&dc)
    {
        return Err(CampaignStoreError::InvalidData);
    }
    let modifier = attribute_modifier
        .checked_add(equipment_modifier)
        .and_then(|value| value.checked_add(status_modifier))
        .ok_or(CampaignStoreError::InvalidData)?;
    let total = raw
        .checked_add(modifier)
        .ok_or(CampaignStoreError::InvalidData)?;
    let success = total >= dc;
    Ok(json!({
        "checkRequestId": check_request_id,
        "raw": raw,
        "modifier": modifier,
        "total": total,
        "dc": dc,
        "result": if success { "SUCCESS" } else { "FAILURE" },
        "naturalRoll": raw,
        "attributeValue": attribute_modifier,
        "attributeModifier": attribute_modifier,
        "equipmentModifier": equipment_modifier,
        "statusModifier": status_modifier,
        "difficulty": dc,
        "success": success,
        "criticalSuccess": raw == 20,
        "criticalFailure": raw == 1,
    }))
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
) -> Result<String, CampaignStoreError> {
    let id = Uuid::new_v4().to_string();
    transaction.execute(
        "INSERT INTO game_events (
           id, campaign_id, schema_version, type, payload_json, occurred_at
         ) VALUES (?1, ?2, 1, ?3, ?4, ?5)",
        params![id, campaign_id, event_type, payload.to_string(), at,],
    )?;
    Ok(id)
}

fn latest_game_event_id(
    connection: &Connection,
    campaign_id: &str,
    event_type: Option<&str>,
) -> Result<String, CampaignStoreError> {
    let result = match event_type {
        Some(kind) => connection
            .query_row(
                "SELECT id FROM game_events WHERE campaign_id = ?1 AND type = ?2
                 ORDER BY occurred_at DESC, id DESC LIMIT 1",
                params![campaign_id, kind],
                |row| row.get::<_, String>(0),
            )
            .optional()?,
        None => connection
            .query_row(
                "SELECT id FROM game_events WHERE campaign_id = ?1
                 ORDER BY occurred_at DESC, id DESC LIMIT 1",
                [campaign_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?,
    };
    result.ok_or(CampaignStoreError::NotFound)
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

fn validate_action_mode(mode: &str) -> Result<(), CampaignStoreError> {
    if matches!(mode, "ACTION" | "DIALOGUE" | "OBSERVE") {
        Ok(())
    } else {
        Err(CampaignStoreError::InvalidData)
    }
}

fn action_mode(value: &Value) -> Result<String, CampaignStoreError> {
    let mode = value
        .get("mode")
        .and_then(Value::as_str)
        .unwrap_or("ACTION");
    validate_action_mode(mode)?;
    Ok(mode.to_owned())
}

fn action_mode_sql(value: &Value) -> rusqlite::Result<String> {
    action_mode(value).map_err(|_| rusqlite::Error::InvalidQuery)
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
    use crate::CampaignArchiveImportMode;

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
        let initial_frame = snapshot.scene_frame.as_ref().expect("initial scene frame");
        assert_eq!(
            integer_field(initial_frame, "revision").expect("initial revision"),
            1
        );
        assert!(
            !array_field(initial_frame, "participants")
                .expect("initial participants")
                .is_empty()
        );
        assert!(matches!(
            store.submit_adventure_action(AdventureActionSubmit {
                campaign_id: "campaign-adventure".to_owned(),
                adventure_id: adventure_id.clone(),
                action_mode: "INVALID".to_owned(),
                player_action: "This must not be stored.".to_owned(),
            }),
            Err(CampaignStoreError::InvalidData)
        ));
        assert!(
            store
                .adventure_snapshot("campaign-adventure", None)
                .expect("snapshot after invalid mode")
                .turns
                .is_empty()
        );

        for turn_number in 1..=8 {
            let action_mode = match turn_number % 3 {
                1 => "ACTION",
                2 => "DIALOGUE",
                _ => "OBSERVE",
            };
            let pending = store
                .submit_adventure_action(AdventureActionSubmit {
                    campaign_id: "campaign-adventure".to_owned(),
                    adventure_id: adventure_id.clone(),
                    action_mode: action_mode.to_owned(),
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
            assert_eq!(
                pending
                    .turn_generation_context
                    .as_ref()
                    .and_then(|context| context.get("sceneFrame")),
                pending.scene_frame.as_ref(),
                "provider context must use the persisted frame"
            );
            assert_eq!(
                pending
                    .turn_generation_context
                    .as_ref()
                    .and_then(|context| context.get("playerActionMode"))
                    .and_then(Value::as_str),
                Some(action_mode)
            );
            assert_eq!(
                pending
                    .turn_generation_context
                    .as_ref()
                    .and_then(|context| context.get("knownFacts"))
                    .and_then(Value::as_array)
                    .map(Vec::len),
                Some(1)
            );
            assert_eq!(
                pending
                    .turn_generation_context
                    .as_ref()
                    .and_then(|context| context.get("npcKnowledge"))
                    .and_then(Value::as_array)
                    .map(Vec::len),
                Some(1)
            );
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
                assert_eq!(
                    array_field(
                        snapshot.scene_frame.as_ref().expect("check scene frame"),
                        "pendingConsequences"
                    )
                    .expect("pending consequences")
                    .len(),
                    1
                );
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
                assert!(
                    array_field(
                        snapshot.scene_frame.as_ref().expect("resolved scene frame"),
                        "pendingConsequences"
                    )
                    .expect("resolved consequences")
                    .is_empty()
                );
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
        let restored_frame = restored.scene_frame.as_ref().expect("restored scene frame");
        assert_eq!(
            integer_field(restored_frame, "revision").expect("restored revision"),
            16
        );
        let connection = reopened.connect().expect("scene ledger connection");
        assert_eq!(
            connection
                .query_row(
                    "SELECT COUNT(*) FROM event_ledger
                     WHERE aggregate_type = 'SCENE' AND aggregate_id = ?1",
                    [&adventure_id],
                    |row| row.get::<_, i64>(0)
                )
                .expect("scene ledger count"),
            16
        );
        drop(connection);
        let archive_path = directory.path().join("scene-frame.emtavern");
        reopened
            .export_campaign_archive("campaign-adventure", &archive_path, "0.2.0")
            .expect("export scene frame");
        let imported_store = CampaignStore::open(directory.path().join("imported.sqlite"))
            .expect("open import database");
        imported_store
            .import_campaign_archive(&archive_path, CampaignArchiveImportMode::Create)
            .expect("import scene frame");
        assert_eq!(
            imported_store
                .adventure_snapshot("campaign-adventure", None)
                .expect("imported adventure")
                .scene_frame,
            restored.scene_frame
        );
        let mut imported_connection = imported_store.connect().expect("imported connection");
        let imported_transaction = imported_connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .expect("imported transaction");
        let imported_frame =
            load_scene_frame(&imported_transaction, &adventure_id).expect("imported scene frame");
        let return_event_id = text_field(
            &record_field(&imported_frame, "returnPoint").expect("imported return point"),
            "eventId",
        )
        .expect("imported return event");
        let continued_frame = write_scene_frame(
            &imported_transaction,
            "campaign-adventure",
            &adventure_id,
            "operation-imported-scene-continuation",
            &text_field(&imported_frame, "sceneId").expect("imported scene id"),
            &text_field(&imported_frame, "location").expect("imported location"),
            array_field(&imported_frame, "participants").expect("imported participants"),
            array_field(&imported_frame, "affordances").expect("imported affordances"),
            Vec::new(),
            "The imported scene remains recoverable.",
            &return_event_id,
            "2026-07-31T06:30:00.000Z",
        )
        .expect("continue imported scene");
        assert_eq!(
            integer_field(&continued_frame, "revision").expect("continued revision"),
            17
        );
        assert_eq!(
            imported_transaction
                .query_row(
                    "SELECT revision FROM event_ledger
                     WHERE aggregate_type = 'SCENE' AND aggregate_id = ?1",
                    [&adventure_id],
                    |row| row.get::<_, i64>(0),
                )
                .expect("imported scene ledger baseline"),
            17
        );
        imported_transaction.commit().expect("commit continuation");
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
                "suggestedActions": [
                    { "text": "Study the lock." },
                    { "text": "Ask Ilyra about the old key." },
                    { "text": "Observe the warm marks on the frame." }
                ],
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

    #[test]
    fn rejects_invalid_adventure_suggestion_sets() {
        let mut too_few = turn_output(false);
        too_few["suggestedActions"] = json!([
            { "text": "Study the lock." },
            { "text": "Ask Ilyra about the old key." }
        ]);
        let too_few: TurnOutput = serde_json::from_value(too_few).expect("turn output");
        assert!(validate_turn_output(&too_few).is_err());

        let mut duplicate = turn_output(false);
        duplicate["suggestedActions"] = json!([
            { "text": "Study the lock." },
            { "text": "Ask Ilyra about the old key." },
            { "text": "  STUDY THE LOCK.  " }
        ]);
        let duplicate: TurnOutput = serde_json::from_value(duplicate).expect("turn output");
        assert!(validate_turn_output(&duplicate).is_err());

        let ending: TurnOutput =
            serde_json::from_value(turn_output(true)).expect("ending turn output");
        assert!(validate_turn_output(&ending).is_ok());
    }

    #[test]
    fn resolves_d20_hard_logic_before_any_narration() {
        let success = resolve_d20_hard_logic("check-one", 10, 3, 2, -1, 14)
            .expect("resolve successful check");
        assert_eq!(integer_field(&success, "raw").expect("raw"), 10);
        assert_eq!(integer_field(&success, "modifier").expect("modifier"), 4);
        assert_eq!(integer_field(&success, "total").expect("total"), 14);
        assert_eq!(integer_field(&success, "dc").expect("dc"), 14);
        assert_eq!(text_field(&success, "result").expect("result"), "SUCCESS");
        assert!(validate_stored_dice_result(&success).is_ok());

        let mut contradictory = success.clone();
        contradictory["total"] = json!(13);
        assert!(validate_stored_dice_result(&contradictory).is_err());
        contradictory = success.clone();
        contradictory["result"] = json!(false);
        assert!(validate_stored_dice_result(&contradictory).is_err());

        let legacy = json!({
            "checkRequestId": "check-legacy",
            "naturalRoll": 9,
            "attributeValue": 2,
            "equipmentModifier": 0,
            "statusModifier": 0,
            "total": 11,
            "difficulty": 14,
            "success": false
        });
        assert!(validate_stored_dice_result(&legacy).is_ok());

        let failure =
            resolve_d20_hard_logic("check-two", 9, 3, 1, 0, 14).expect("resolve failed check");
        assert_eq!(integer_field(&failure, "total").expect("total"), 13);
        assert_eq!(text_field(&failure, "result").expect("result"), "FAILURE");

        assert!(resolve_d20_hard_logic("check-invalid", 0, 3, 0, 0, 11).is_err());
        assert!(resolve_d20_hard_logic("check-invalid", 10, 6, 0, 0, 11).is_err());
        assert!(resolve_d20_hard_logic("check-invalid", 10, 3, 0, 0, 12).is_err());
        assert!(resolve_d20_hard_logic("check-overflow", 20, 5, i64::MAX, 0, 17,).is_err());
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
                 INSERT INTO world_facts (
                   id, campaign_id, kind, statement, location_id, faction_ids_json,
                   detail_json, supersedes_fact_id, created_at
                 ) VALUES (
                   'fact-warm-lock', 'campaign-adventure', 'DEVELOPING_FACT',
                   'The cellar lock radiates a faint warmth.', NULL, '[]', '{}', NULL,
                   '2026-07-31T06:00:00.000Z'
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
                   '[]', '{}', 'ROGUE', 'Scout',
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
                 INSERT INTO npc_knowledge (
                   npc_id, known_fact_ids_json, suspected_fact_ids_json,
                   false_belief_fact_ids_json, excluded_secret_fact_ids_json,
                   provenance_json, updated_at
                 ) VALUES (
                   'npc-owner', '[\"fact-warm-lock\"]', '[]', '[]', '[]',
                   '[{\"factId\":\"fact-warm-lock\",\"state\":\"KNOWN\",\"source\":\"IMPORT\",\"eventId\":null,\"learnedAt\":\"2026-07-31T06:00:00.000Z\",\"confidence\":1}]',
                   '2026-07-31T06:00:00.000Z'
                 );
                 INSERT INTO quests (
                   id, campaign_id, publisher_npc_id, content_json, status, risk,
                   recommended_attributes_json, expected_turns_min, expected_turns_max,
                   reward_tier, related_npc_ids_json, related_fact_ids_json, created_at, updated_at
                 ) VALUES (
                   'quest-beacon', 'campaign-adventure', 'npc-owner',
                   '{\"title\":\"The Fading Beacon\",\"summary\":\"Investigate the failing lighthouse.\",\"objective\":\"Restore the beacon.\",\"failureCost\":\"Ships remain trapped.\"}',
                   'ACCEPTED', 'MODERATE', '[\"knowledge\",\"agility\"]', 8, 12,
                   'NOTABLE', '[\"npc-owner\"]', '[\"fact-warm-lock\"]',
                   '2026-07-31T06:00:00.000Z', '2026-07-31T06:00:00.000Z'
                 );",
            )
            .expect("seed adventure");
    }
}

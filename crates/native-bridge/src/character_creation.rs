use std::collections::HashSet;

use rusqlite::{Connection, OptionalExtension, Transaction, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

use crate::{CampaignStore, CampaignStoreError, current_timestamp, validate_id};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CharacterAttributes {
    pub physique: i64,
    pub agility: i64,
    pub knowledge: i64,
    pub charisma: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CharacterContentBoundaries {
    pub allow_horror: bool,
    pub allow_permanent_death: bool,
    pub allow_romance: bool,
    pub allow_betrayal: bool,
    pub excluded_content: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CharacterDraftInput {
    pub id: String,
    pub campaign_id: String,
    pub name: String,
    pub gender: Option<String>,
    pub age: Option<i64>,
    pub concept: String,
    pub story_preferences: Vec<String>,
    pub content_boundaries: CharacterContentBoundaries,
    pub class_archetype: String,
    pub class_display_name: String,
    pub attributes: CharacterAttributes,
    pub personal_goal: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CharacterTraitDraft {
    pub name: String,
    pub description: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CharacterTraitView {
    pub id: String,
    pub name: String,
    pub description: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CharacterBackgroundView {
    pub birthplace: String,
    pub formative_experience: String,
    pub adventure_motivation: String,
    pub secret: String,
    pub important_person: String,
    pub tavern_arrival_reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EquipmentDraft {
    pub name: String,
    pub description: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EquipmentView {
    pub id: String,
    pub name: String,
    pub description: String,
    pub effect: Value,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerCharacterView {
    #[serde(flatten)]
    pub draft: CharacterDraftInput,
    pub traits: Vec<CharacterTraitView>,
    pub background: CharacterBackgroundView,
    pub initial_equipment: Vec<EquipmentView>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CharacterCreationSnapshot {
    pub campaign_state: String,
    pub draft: Option<CharacterDraftInput>,
    pub trait_generation_record_id: Option<String>,
    pub trait_candidates: Vec<CharacterTraitView>,
    pub character: Option<PlayerCharacterView>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CharacterTraitGenerationCommit {
    pub campaign_id: String,
    pub character: CharacterDraftInput,
    pub generation: CharacterGenerationAudit,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CharacterCompletionCommit {
    pub campaign_id: String,
    pub character: CharacterDraftInput,
    pub trait_generation_record_id: String,
    pub selected_traits: Vec<CharacterTraitView>,
    pub generation: CharacterGenerationAudit,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CharacterGenerationAudit {
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

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct TraitOutput {
    traits: Vec<CharacterTraitDraft>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BackgroundOutput {
    #[serde(flatten)]
    background: CharacterBackgroundView,
    initial_equipment: Vec<EquipmentDraft>,
}

impl CampaignStore {
    pub fn character_creation_snapshot(
        &self,
        campaign_id: &str,
    ) -> Result<CharacterCreationSnapshot, CampaignStoreError> {
        validate_id(campaign_id)?;
        let connection = self.connect()?;
        character_snapshot(&connection, campaign_id)
    }

    pub fn commit_character_traits(
        &self,
        command: CharacterTraitGenerationCommit,
    ) -> Result<CharacterCreationSnapshot, CampaignStoreError> {
        validate_character_draft(&command.character, &command.campaign_id)?;
        validate_generation_audit(&command.generation, "GENERATE_CHARACTER_TRAITS")?;
        validate_trait_generation_context(&command)?;
        let output: TraitOutput =
            serde_json::from_value(command.generation.validated_output.clone())
                .map_err(|_| CampaignStoreError::InvalidData)?;
        validate_trait_drafts(&output.traits)?;

        let mut connection = self.connect()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        if replayed(
            &transaction,
            &command.generation.idempotency_key,
            &command.campaign_id,
            "GENERATE_CHARACTER_TRAITS",
        )? {
            let result = character_snapshot(&transaction, &command.campaign_id)?;
            transaction.commit()?;
            return Ok(result);
        }
        if require_campaign_state(&transaction, &command.campaign_id)? != "CREATING_CHARACTER"
            || character_exists(&transaction, &command.campaign_id)?
        {
            return Err(CampaignStoreError::InvalidState);
        }
        let at = current_timestamp()?;
        insert_generation(
            &transaction,
            &command.campaign_id,
            "GENERATE_CHARACTER_TRAITS",
            &command.generation,
            &at,
        )?;
        transaction.commit()?;
        self.character_creation_snapshot(&command.campaign_id)
    }

    pub fn commit_character_completion(
        &self,
        command: CharacterCompletionCommit,
    ) -> Result<CharacterCreationSnapshot, CampaignStoreError> {
        validate_character_draft(&command.character, &command.campaign_id)?;
        validate_generation_audit(&command.generation, "COMPLETE_CHARACTER_BACKGROUND")?;
        validate_background_generation_context(&command)?;
        validate_id(&command.trait_generation_record_id)?;
        let output: BackgroundOutput =
            serde_json::from_value(command.generation.validated_output.clone())
                .map_err(|_| CampaignStoreError::InvalidData)?;
        validate_background(&output)?;
        let mut connection = self.connect()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        if replayed(
            &transaction,
            &command.generation.idempotency_key,
            &command.campaign_id,
            "COMPLETE_CHARACTER_BACKGROUND",
        )? {
            let result = character_snapshot(&transaction, &command.campaign_id)?;
            transaction.commit()?;
            return Ok(result);
        }
        if require_campaign_state(&transaction, &command.campaign_id)? != "CREATING_CHARACTER"
            || character_exists(&transaction, &command.campaign_id)?
        {
            return Err(CampaignStoreError::InvalidState);
        }
        validate_selected_traits(
            &transaction,
            &command.campaign_id,
            &command.trait_generation_record_id,
            &command.selected_traits,
        )?;

        let at = current_timestamp()?;
        let equipment = build_equipment(&command.character, &output.initial_equipment);
        insert_character(
            &transaction,
            &command.character,
            &command.selected_traits,
            &output.background,
            &equipment,
            &at,
        )?;
        insert_generation(
            &transaction,
            &command.campaign_id,
            "COMPLETE_CHARACTER_BACKGROUND",
            &command.generation,
            &at,
        )?;
        let changed = transaction.execute(
            "UPDATE campaigns SET state = 'GENERATING_TAVERN', resume_state = NULL, updated_at = ?1
             WHERE id = ?2 AND state = 'CREATING_CHARACTER'",
            params![at, command.campaign_id],
        )?;
        if changed != 1 {
            return Err(CampaignStoreError::InvalidState);
        }
        transaction.commit()?;
        self.character_creation_snapshot(&command.campaign_id)
    }
}

fn validate_character_draft(
    draft: &CharacterDraftInput,
    campaign_id: &str,
) -> Result<(), CampaignStoreError> {
    validate_id(campaign_id)?;
    validate_id(&draft.id)?;
    if draft.campaign_id != campaign_id {
        return Err(CampaignStoreError::InvalidData);
    }
    validate_text(&draft.name, 200)?;
    if let Some(gender) = &draft.gender {
        validate_text(gender, 200)?;
    }
    if draft.age.is_some_and(|age| age < 0) {
        return Err(CampaignStoreError::InvalidData);
    }
    validate_text(&draft.concept, 4_000)?;
    validate_text_list(&draft.story_preferences, 0, 30, 4_000)?;
    validate_text_list(&draft.content_boundaries.excluded_content, 0, 30, 4_000)?;
    if !["WARRIOR", "ROGUE", "SCHOLAR", "DIPLOMAT"].contains(&draft.class_archetype.as_str()) {
        return Err(CampaignStoreError::InvalidData);
    }
    validate_text(&draft.class_display_name, 200)?;
    validate_text(&draft.personal_goal, 4_000)?;
    let values = [
        draft.attributes.physique,
        draft.attributes.agility,
        draft.attributes.knowledge,
        draft.attributes.charisma,
    ];
    if values.iter().any(|value| !(1..=5).contains(value)) || values.iter().sum::<i64>() != 10 {
        return Err(CampaignStoreError::InvalidData);
    }
    Ok(())
}

fn validate_generation_audit(
    audit: &CharacterGenerationAudit,
    expected_task: &str,
) -> Result<(), CampaignStoreError> {
    validate_id(&audit.request_id)?;
    validate_id(&audit.generation_record_id)?;
    validate_id(&audit.idempotency_key)?;
    if audit.prompt_version < 1
        || audit.raw_response_text.trim().is_empty()
        || audit.raw_response_text.len() > 1_000_000
        || !audit.input.is_object()
        || !audit.context.is_object()
        || audit
            .request
            .as_object()
            .and_then(|request| request.get("task"))
            .and_then(Value::as_str)
            != Some(expected_task)
    {
        return Err(CampaignStoreError::InvalidData);
    }
    let raw_output: Value = serde_json::from_str(&audit.raw_response_text)
        .map_err(|_| CampaignStoreError::InvalidData)?;
    if raw_output != audit.validated_output {
        return Err(CampaignStoreError::InvalidData);
    }
    Ok(())
}

fn validate_trait_generation_context(
    command: &CharacterTraitGenerationCommit,
) -> Result<(), CampaignStoreError> {
    let expected_input = serde_json::json!({
        "concept": command.character.concept,
        "classArchetype": command.character.class_archetype,
        "personalGoal": command.character.personal_goal,
        "storyPreferences": command.character.story_preferences,
    });
    let expected_context = serde_json::json!({ "character": command.character });
    if command.generation.input != expected_input || command.generation.context != expected_context
    {
        return Err(CampaignStoreError::InvalidData);
    }
    Ok(())
}

fn validate_background_generation_context(
    command: &CharacterCompletionCommit,
) -> Result<(), CampaignStoreError> {
    let traits = command
        .selected_traits
        .iter()
        .map(|trait_value| {
            serde_json::json!({
                "name": trait_value.name,
                "description": trait_value.description,
            })
        })
        .collect::<Vec<_>>();
    let expected_input = serde_json::json!({
        "name": command.character.name,
        "concept": command.character.concept,
        "classDisplayName": command.character.class_display_name,
        "personalGoal": command.character.personal_goal,
        "traits": traits,
    });
    let expected_context = serde_json::json!({
        "character": command.character,
        "selectedTraits": command.selected_traits,
        "traitGenerationRecordId": command.trait_generation_record_id,
    });
    if command.generation.input != expected_input || command.generation.context != expected_context
    {
        return Err(CampaignStoreError::InvalidData);
    }
    Ok(())
}

fn validate_trait_drafts(traits: &[CharacterTraitDraft]) -> Result<(), CampaignStoreError> {
    if traits.len() != 6 {
        return Err(CampaignStoreError::InvalidData);
    }
    let mut names = HashSet::new();
    for trait_value in traits {
        validate_text(&trait_value.name, 200)?;
        validate_text(&trait_value.description, 4_000)?;
        if !names.insert(trait_value.name.as_str()) {
            return Err(CampaignStoreError::InvalidData);
        }
    }
    Ok(())
}

fn validate_background(output: &BackgroundOutput) -> Result<(), CampaignStoreError> {
    validate_text(&output.background.birthplace, 200)?;
    validate_text(&output.background.formative_experience, 4_000)?;
    validate_text(&output.background.adventure_motivation, 4_000)?;
    validate_text(&output.background.secret, 4_000)?;
    validate_text(&output.background.important_person, 4_000)?;
    validate_text(&output.background.tavern_arrival_reason, 4_000)?;
    if output.initial_equipment.is_empty() || output.initial_equipment.len() > 4 {
        return Err(CampaignStoreError::InvalidData);
    }
    for item in &output.initial_equipment {
        validate_text(&item.name, 200)?;
        validate_text(&item.description, 4_000)?;
    }
    Ok(())
}

fn replayed(
    connection: &Connection,
    key: &str,
    campaign_id: &str,
    task: &str,
) -> Result<bool, CampaignStoreError> {
    let request = connection
        .query_row(
            "SELECT campaign_id, task, status FROM pending_ai_requests WHERE idempotency_key = ?1",
            [key],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            },
        )
        .optional()?;
    match request {
        None => Ok(false),
        Some((stored_campaign, stored_task, status))
            if stored_campaign == campaign_id && stored_task == task && status == "COMMITTED" =>
        {
            Ok(true)
        }
        Some(_) => Err(CampaignStoreError::InvalidState),
    }
}

fn insert_generation(
    transaction: &Transaction<'_>,
    campaign_id: &str,
    task: &str,
    audit: &CharacterGenerationAudit,
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
            serde_json::to_string(&audit.input).map_err(|_| CampaignStoreError::InvalidData)?,
            serde_json::to_string(&audit.context).map_err(|_| CampaignStoreError::InvalidData)?,
            at
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
            serde_json::to_string(&audit.request).map_err(|_| CampaignStoreError::InvalidData)?,
            audit.raw_response_text,
            serde_json::to_string(&audit.validated_output)
                .map_err(|_| CampaignStoreError::InvalidData)?,
            at
        ],
    )?;
    Ok(())
}

fn validate_selected_traits(
    connection: &Connection,
    campaign_id: &str,
    generation_record_id: &str,
    selected: &[CharacterTraitView],
) -> Result<(), CampaignStoreError> {
    if selected.len() != 2 || selected[0].id == selected[1].id {
        return Err(CampaignStoreError::InvalidData);
    }
    let output: String = connection
        .query_row(
            "SELECT g.validated_output_json
             FROM generation_records g
             JOIN pending_ai_requests p ON p.id = g.request_id
             WHERE g.id = ?1 AND g.campaign_id = ?2
               AND g.task = 'GENERATE_CHARACTER_TRAITS' AND p.status = 'COMMITTED'",
            params![generation_record_id, campaign_id],
            |row| row.get(0),
        )
        .optional()?
        .ok_or(CampaignStoreError::InvalidData)?;
    let candidates: TraitOutput =
        serde_json::from_str(&output).map_err(|_| CampaignStoreError::InvalidData)?;
    validate_trait_drafts(&candidates.traits)?;
    for selected_trait in selected {
        validate_id(&selected_trait.id)?;
        let index = candidates
            .traits
            .iter()
            .position(|candidate| {
                candidate.name == selected_trait.name
                    && candidate.description == selected_trait.description
            })
            .ok_or(CampaignStoreError::InvalidData)?;
        if selected_trait.id != trait_id(generation_record_id, index) {
            return Err(CampaignStoreError::InvalidData);
        }
    }
    Ok(())
}

fn build_equipment(
    character: &CharacterDraftInput,
    drafts: &[EquipmentDraft],
) -> Vec<EquipmentView> {
    let primary = match character.class_archetype.as_str() {
        "WARRIOR" => "physique",
        "ROGUE" => "agility",
        "SCHOLAR" => "knowledge",
        "DIPLOMAT" => "charisma",
        _ => unreachable!("validated class archetype"),
    };
    drafts
        .iter()
        .enumerate()
        .map(|(index, item)| EquipmentView {
            id: Uuid::new_v4().to_string(),
            name: item.name.clone(),
            description: item.description.clone(),
            effect: if index == 0 {
                serde_json::json!({
                    "kind": "CHECK_MODIFIER",
                    "attribute": primary,
                    "modifier": 1
                })
            } else {
                serde_json::json!({"kind": "NONE"})
            },
        })
        .collect()
}

fn insert_character(
    transaction: &Transaction<'_>,
    character: &CharacterDraftInput,
    traits: &[CharacterTraitView],
    background: &CharacterBackgroundView,
    equipment: &[EquipmentView],
    at: &str,
) -> Result<(), CampaignStoreError> {
    transaction.execute(
        "INSERT INTO player_characters (
           id, campaign_id, name, gender, age, concept, story_preferences_json,
           content_boundaries_json, class_archetype, class_display_name, attributes_json,
           traits_json, personal_goal, background_json, initial_equipment_ids_json,
           created_at, updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?16)",
        params![
            character.id,
            character.campaign_id,
            character.name,
            character.gender,
            character.age,
            character.concept,
            json(&character.story_preferences)?,
            json(&character.content_boundaries)?,
            character.class_archetype,
            character.class_display_name,
            json(&character.attributes)?,
            json(&traits)?,
            character.personal_goal,
            json(background)?,
            json(&equipment.iter().map(|item| &item.id).collect::<Vec<_>>())?,
            at
        ],
    )?;
    for item in equipment {
        transaction.execute(
            "INSERT INTO items (
               id, campaign_id, owner_character_id, source_adventure_id,
               content_json, reward_tier, effect_json, created_at
             ) VALUES (?1, ?2, ?3, NULL, ?4, 'BASIC', ?5, ?6)",
            params![
                item.id,
                character.campaign_id,
                character.id,
                serde_json::to_string(&serde_json::json!({
                    "name": item.name,
                    "description": item.description
                }))
                .map_err(|_| CampaignStoreError::InvalidData)?,
                serde_json::to_string(&item.effect).map_err(|_| CampaignStoreError::InvalidData)?,
                at
            ],
        )?;
    }
    Ok(())
}

fn character_snapshot(
    connection: &Connection,
    campaign_id: &str,
) -> Result<CharacterCreationSnapshot, CampaignStoreError> {
    let state = require_campaign_state(connection, campaign_id)?;
    let character = load_character(connection, campaign_id)?;
    let latest = load_latest_traits(connection, campaign_id)?;
    let (trait_generation_record_id, trait_candidates, generated_draft) = latest
        .map(|(record, traits, draft)| (Some(record), traits, Some(draft)))
        .unwrap_or((None, Vec::new(), None));
    let draft = character
        .as_ref()
        .map(|value| value.draft.clone())
        .or(generated_draft);
    Ok(CharacterCreationSnapshot {
        campaign_state: state,
        draft,
        trait_generation_record_id,
        trait_candidates,
        character,
    })
}

fn load_latest_traits(
    connection: &Connection,
    campaign_id: &str,
) -> Result<Option<(String, Vec<CharacterTraitView>, CharacterDraftInput)>, CampaignStoreError> {
    let row = connection
        .query_row(
            "SELECT g.id, g.validated_output_json, p.context_json
             FROM generation_records g
             JOIN pending_ai_requests p ON p.id = g.request_id
             WHERE g.campaign_id = ?1 AND g.task = 'GENERATE_CHARACTER_TRAITS'
               AND p.status = 'COMMITTED'
             ORDER BY g.completed_at DESC, g.id DESC LIMIT 1",
            [campaign_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            },
        )
        .optional()?;
    row.map(|(record_id, raw, context_raw)| {
        let output: TraitOutput =
            serde_json::from_str(&raw).map_err(|_| CampaignStoreError::InvalidData)?;
        validate_trait_drafts(&output.traits)?;
        let traits = output
            .traits
            .into_iter()
            .enumerate()
            .map(|(index, value)| CharacterTraitView {
                id: trait_id(&record_id, index),
                name: value.name,
                description: value.description,
            })
            .collect();
        let context: Value =
            serde_json::from_str(&context_raw).map_err(|_| CampaignStoreError::InvalidData)?;
        let draft: CharacterDraftInput = serde_json::from_value(
            context
                .as_object()
                .and_then(|value| value.get("character"))
                .cloned()
                .ok_or(CampaignStoreError::InvalidData)?,
        )
        .map_err(|_| CampaignStoreError::InvalidData)?;
        validate_character_draft(&draft, campaign_id)?;
        Ok((record_id, traits, draft))
    })
    .transpose()
}

fn load_character(
    connection: &Connection,
    campaign_id: &str,
) -> Result<Option<PlayerCharacterView>, CampaignStoreError> {
    let row = connection
        .query_row(
            "SELECT id, name, gender, age, concept, story_preferences_json,
                    content_boundaries_json, class_archetype, class_display_name,
                    attributes_json, traits_json, personal_goal, background_json,
                    initial_equipment_ids_json, created_at, updated_at
             FROM player_characters WHERE campaign_id = ?1",
            [campaign_id],
            |row| {
                Ok((
                    CharacterDraftInput {
                        id: row.get(0)?,
                        campaign_id: campaign_id.to_owned(),
                        name: row.get(1)?,
                        gender: row.get(2)?,
                        age: row.get(3)?,
                        concept: row.get(4)?,
                        story_preferences: from_json(row.get::<_, String>(5)?)?,
                        content_boundaries: from_json(row.get::<_, String>(6)?)?,
                        class_archetype: row.get(7)?,
                        class_display_name: row.get(8)?,
                        attributes: from_json(row.get::<_, String>(9)?)?,
                        personal_goal: row.get(11)?,
                    },
                    from_json::<Vec<CharacterTraitView>>(row.get::<_, String>(10)?)?,
                    from_json::<CharacterBackgroundView>(row.get::<_, String>(12)?)?,
                    from_json::<Vec<String>>(row.get::<_, String>(13)?)?,
                    row.get::<_, String>(14)?,
                    row.get::<_, String>(15)?,
                ))
            },
        )
        .optional()?;
    row.map(
        |(draft, traits, background, equipment_ids, created_at, updated_at)| {
            validate_character_draft(&draft, campaign_id)?;
            let equipment = load_equipment(connection, &draft.id, &equipment_ids)?;
            Ok(PlayerCharacterView {
                draft,
                traits,
                background,
                initial_equipment: equipment,
                created_at,
                updated_at,
            })
        },
    )
    .transpose()
}

fn load_equipment(
    connection: &Connection,
    character_id: &str,
    equipment_ids: &[String],
) -> Result<Vec<EquipmentView>, CampaignStoreError> {
    let mut equipment = Vec::with_capacity(equipment_ids.len());
    for id in equipment_ids {
        validate_id(id)?;
        let item = connection
            .query_row(
                "SELECT id, content_json, effect_json FROM items
                 WHERE id = ?1 AND owner_character_id = ?2",
                params![id, character_id],
                |row| {
                    let content: Value = from_json(row.get::<_, String>(1)?)?;
                    let record = content.as_object().ok_or(rusqlite::Error::InvalidQuery)?;
                    Ok(EquipmentView {
                        id: row.get(0)?,
                        name: record
                            .get("name")
                            .and_then(Value::as_str)
                            .ok_or(rusqlite::Error::InvalidQuery)?
                            .to_owned(),
                        description: record
                            .get("description")
                            .and_then(Value::as_str)
                            .ok_or(rusqlite::Error::InvalidQuery)?
                            .to_owned(),
                        effect: from_json(row.get::<_, String>(2)?)?,
                    })
                },
            )
            .optional()?
            .ok_or(CampaignStoreError::InvalidData)?;
        equipment.push(item);
    }
    Ok(equipment)
}

fn character_exists(
    connection: &Connection,
    campaign_id: &str,
) -> Result<bool, CampaignStoreError> {
    Ok(connection
        .query_row(
            "SELECT 1 FROM player_characters WHERE campaign_id = ?1",
            [campaign_id],
            |_| Ok(()),
        )
        .optional()?
        .is_some())
}

fn require_campaign_state(
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

fn trait_id(generation_record_id: &str, index: usize) -> String {
    format!("{generation_record_id}:trait:{index}")
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

fn json(value: &impl Serialize) -> Result<String, CampaignStoreError> {
    serde_json::to_string(value).map_err(|_| CampaignStoreError::InvalidData)
}

fn from_json<T: for<'de> Deserialize<'de>>(value: String) -> rusqlite::Result<T> {
    serde_json::from_str(&value).map_err(|_| rusqlite::Error::InvalidQuery)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn completes_character_with_program_owned_equipment_and_survives_reopen() {
        let directory = tempfile::tempdir().expect("temp directory");
        let database_path = directory.path().join("ember-tavern.sqlite");
        let store = CampaignStore::open(&database_path).expect("open database");
        seed_character_campaign(&store);
        let traits = store
            .commit_character_traits(trait_command())
            .expect("generate traits");
        assert_eq!(traits.trait_candidates.len(), 6);
        drop(store);

        let reopened = CampaignStore::open(&database_path).expect("reopen after trait generation");
        let resumed = reopened
            .character_creation_snapshot("campaign-character")
            .expect("resume trait selection");
        assert_eq!(resumed.draft, Some(draft()));
        assert_eq!(resumed.trait_candidates, traits.trait_candidates);
        let selected = resumed.trait_candidates[..2].to_vec();
        let completed = reopened
            .commit_character_completion(background_command(
                resumed.trait_generation_record_id.expect("trait record id"),
                selected,
            ))
            .expect("complete character");
        assert_eq!(completed.campaign_state, "GENERATING_TAVERN");
        let character = completed.character.expect("character");
        assert_eq!(character.initial_equipment.len(), 2);
        assert_eq!(
            character.initial_equipment[0].effect,
            serde_json::json!({
                "kind": "CHECK_MODIFIER",
                "attribute": "agility",
                "modifier": 1
            })
        );
        drop(reopened);

        let reopened = CampaignStore::open(database_path).expect("reopen completed character");
        assert_eq!(
            reopened
                .character_creation_snapshot("campaign-character")
                .expect("reload")
                .campaign_state,
            "GENERATING_TAVERN"
        );
    }

    #[test]
    fn rejects_illegal_attributes_and_unoffered_traits_without_writes() {
        let directory = tempfile::tempdir().expect("temp directory");
        let database_path = directory.path().join("ember-tavern.sqlite");
        let store = CampaignStore::open(&database_path).expect("open database");
        seed_character_campaign(&store);
        let mut tampered = trait_command();
        tampered.generation.raw_response_text = r#"{"traits":[]}"#.to_owned();
        assert!(matches!(
            store.commit_character_traits(tampered),
            Err(CampaignStoreError::InvalidData)
        ));
        let mut invalid = trait_command();
        invalid.character.attributes.physique = 5;
        assert!(matches!(
            store.commit_character_traits(invalid),
            Err(CampaignStoreError::InvalidData)
        ));
        let traits = store
            .commit_character_traits(trait_command())
            .expect("generate traits");
        let mut selected = traits.trait_candidates[..2].to_vec();
        selected[0].name = "Invented trait".to_owned();
        assert!(matches!(
            store.commit_character_completion(background_command(
                traits.trait_generation_record_id.expect("trait record id"),
                selected
            )),
            Err(CampaignStoreError::InvalidData)
        ));
        assert!(
            store
                .character_creation_snapshot("campaign-character")
                .expect("snapshot")
                .character
                .is_none()
        );
    }

    fn seed_character_campaign(store: &CampaignStore) {
        store
            .create_at(
                "campaign-character".to_owned(),
                "2026-07-29T01:00:00.000Z".to_owned(),
            )
            .expect("create campaign");
        let connection = store.connect().expect("connection");
        connection
            .execute(
                "UPDATE campaigns SET state = 'CREATING_CHARACTER' WHERE id = 'campaign-character'",
                [],
            )
            .expect("advance campaign");
    }

    fn draft() -> CharacterDraftInput {
        CharacterDraftInput {
            id: "character-mira".to_owned(),
            campaign_id: "campaign-character".to_owned(),
            name: "Mira".to_owned(),
            gender: None,
            age: Some(27),
            concept: "Curious scout".to_owned(),
            story_preferences: vec!["Exploration".to_owned()],
            content_boundaries: CharacterContentBoundaries {
                allow_horror: false,
                allow_permanent_death: false,
                allow_romance: true,
                allow_betrayal: true,
                excluded_content: Vec::new(),
            },
            class_archetype: "ROGUE".to_owned(),
            class_display_name: "Wayfinder".to_owned(),
            attributes: CharacterAttributes {
                physique: 2,
                agility: 4,
                knowledge: 3,
                charisma: 1,
            },
            personal_goal: "Find a lost sibling.".to_owned(),
        }
    }

    fn trait_command() -> CharacterTraitGenerationCommit {
        let output = serde_json::json!({
            "traits": [
                {"name":"Keen Listener","description":"Notices quiet changes."},
                {"name":"Roadwise","description":"Reads signs on the road."},
                {"name":"Steady Hands","description":"Works calmly under pressure."},
                {"name":"Harborwise","description":"Knows port customs."},
                {"name":"Quiet Courage","description":"Acts despite fear."},
                {"name":"Old Maps","description":"Recognizes forgotten routes."}
            ]
        });
        let character = draft();
        let mut generation = audit("traits", "GENERATE_CHARACTER_TRAITS", output);
        generation.input = serde_json::json!({
            "concept": character.concept,
            "classArchetype": character.class_archetype,
            "personalGoal": character.personal_goal,
            "storyPreferences": character.story_preferences,
        });
        CharacterTraitGenerationCommit {
            campaign_id: "campaign-character".to_owned(),
            character,
            generation,
        }
    }

    fn background_command(
        trait_record: String,
        selected: Vec<CharacterTraitView>,
    ) -> CharacterCompletionCommit {
        let output = serde_json::json!({
            "birthplace":"The North Road",
            "formativeExperience":"Survived a winter crossing.",
            "adventureMotivation":"Protect travelers.",
            "secret":"Followed a false beacon.",
            "importantPerson":"A missing sibling.",
            "tavernArrivalReason":"Seeking the last caravan.",
            "initialEquipment":[
                {"name":"Trail Compass","description":"A weathered brass compass."},
                {"name":"Travel Cloak","description":"A waxed cloak."}
            ]
        });
        let character = draft();
        let mut generation = audit("background", "COMPLETE_CHARACTER_BACKGROUND", output);
        generation.input = serde_json::json!({
            "name": character.name,
            "concept": character.concept,
            "classDisplayName": character.class_display_name,
            "personalGoal": character.personal_goal,
            "traits": selected.iter().map(|trait_value| serde_json::json!({
                "name": trait_value.name,
                "description": trait_value.description,
            })).collect::<Vec<_>>(),
        });
        generation.context = serde_json::json!({
            "character": character,
            "selectedTraits": selected,
            "traitGenerationRecordId": trait_record,
        });
        CharacterCompletionCommit {
            campaign_id: "campaign-character".to_owned(),
            character,
            trait_generation_record_id: trait_record,
            selected_traits: selected,
            generation,
        }
    }

    fn audit(suffix: &str, task: &str, output: Value) -> CharacterGenerationAudit {
        CharacterGenerationAudit {
            request_id: format!("request-{suffix}"),
            generation_record_id: format!("generation-{suffix}"),
            idempotency_key: format!("character:{suffix}"),
            prompt_version: 2,
            input: serde_json::json!({"concept":"Curious scout"}),
            context: serde_json::json!({"character": draft()}),
            request: serde_json::json!({"task":task}),
            raw_response_text: serde_json::to_string(&output).expect("raw output"),
            validated_output: output,
        }
    }
}

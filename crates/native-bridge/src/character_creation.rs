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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CharacterCandidateView {
    pub id: String,
    pub kind: String,
    pub draft: CharacterDraftInput,
    pub trait_generation_record_id: String,
    pub trait_candidates: Vec<CharacterTraitView>,
    pub selected_traits: Vec<CharacterTraitView>,
    pub background: Option<CharacterBackgroundView>,
    pub initial_equipment: Vec<EquipmentView>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CharacterCreationSnapshot {
    pub campaign_state: String,
    pub draft: Option<CharacterDraftInput>,
    pub trait_generation_record_id: Option<String>,
    pub trait_candidates: Vec<CharacterTraitView>,
    pub candidate: Option<CharacterCandidateView>,
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
pub struct CharacterCandidateConfirm {
    pub campaign_id: String,
    pub candidate_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StoredCharacterCandidate {
    view: CharacterCandidateView,
    generation: CharacterGenerationAudit,
    trait_generation: Option<CharacterGenerationAudit>,
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
        if candidate_replayed(
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
        let supersedes =
            load_latest_candidate(&transaction, &command.campaign_id)?.map(|stored| stored.view.id);
        let candidate = build_trait_candidate(&command, output, &at);
        insert_candidate(
            &transaction,
            &command.campaign_id,
            "GENERATE_CHARACTER_TRAITS",
            &command.generation,
            &candidate,
            supersedes.as_deref(),
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
        if candidate_replayed(
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
        let source_candidate_id = candidate_id(&command.trait_generation_record_id);
        let candidate = CharacterCandidateView {
            id: candidate_id(&command.generation.generation_record_id),
            kind: "COMPLETE_CHARACTER".to_owned(),
            draft: command.character.clone(),
            trait_generation_record_id: command.trait_generation_record_id.clone(),
            trait_candidates: load_trait_candidates(
                &transaction,
                &command.campaign_id,
                &command.trait_generation_record_id,
            )?,
            selected_traits: command.selected_traits.clone(),
            background: Some(output.background),
            initial_equipment: equipment,
        };
        insert_candidate(
            &transaction,
            &command.campaign_id,
            "COMPLETE_CHARACTER_BACKGROUND",
            &command.generation,
            &candidate,
            Some(&source_candidate_id),
            &at,
        )?;
        transaction.commit()?;
        self.character_creation_snapshot(&command.campaign_id)
    }

    pub fn confirm_character_candidate(
        &self,
        command: CharacterCandidateConfirm,
    ) -> Result<CharacterCreationSnapshot, CampaignStoreError> {
        validate_id(&command.campaign_id)?;
        validate_id(&command.candidate_id)?;
        let mut connection = self.connect()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let existing_status = transaction
            .query_row(
                "SELECT status FROM ai_candidates WHERE id = ?1 AND campaign_id = ?2",
                params![command.candidate_id, command.campaign_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        if existing_status.as_deref() == Some("ACCEPTED") {
            if character_exists(&transaction, &command.campaign_id)? {
                let result = character_snapshot(&transaction, &command.campaign_id)?;
                transaction.commit()?;
                return Ok(result);
            }
            return Err(CampaignStoreError::InvalidData);
        }
        if require_campaign_state(&transaction, &command.campaign_id)? != "CREATING_CHARACTER"
            || character_exists(&transaction, &command.campaign_id)?
        {
            return Err(CampaignStoreError::InvalidState);
        }
        let stored = load_candidate_by_id(
            &transaction,
            &command.campaign_id,
            &command.candidate_id,
            true,
        )?
        .ok_or(CampaignStoreError::InvalidState)?;
        let candidate = &stored.view;
        if candidate.kind != "COMPLETE_CHARACTER" {
            return Err(CampaignStoreError::InvalidState);
        }
        let background = candidate
            .background
            .as_ref()
            .ok_or(CampaignStoreError::InvalidData)?;
        validate_character_candidate(candidate, &command.campaign_id)?;
        validate_stored_candidate_context(&stored)?;
        let at = current_timestamp()?;
        insert_character(
            &transaction,
            &candidate.draft,
            &candidate.selected_traits,
            background,
            &candidate.initial_equipment,
            &at,
        )?;
        commit_candidate_generations(&transaction, &stored, &at)?;
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

fn candidate_id(generation_record_id: &str) -> String {
    format!("character-candidate-{generation_record_id}")
}

fn build_trait_candidate(
    command: &CharacterTraitGenerationCommit,
    output: TraitOutput,
    _at: &str,
) -> CharacterCandidateView {
    let traits = output
        .traits
        .into_iter()
        .enumerate()
        .map(|(index, value)| CharacterTraitView {
            id: trait_id(&command.generation.generation_record_id, index),
            name: value.name,
            description: value.description,
        })
        .collect();
    CharacterCandidateView {
        id: candidate_id(&command.generation.generation_record_id),
        kind: "CHARACTER_TRAITS".to_owned(),
        draft: command.character.clone(),
        trait_generation_record_id: command.generation.generation_record_id.clone(),
        trait_candidates: traits,
        selected_traits: Vec::new(),
        background: None,
        initial_equipment: Vec::new(),
    }
}

fn insert_candidate(
    transaction: &Transaction<'_>,
    campaign_id: &str,
    task: &str,
    generation: &CharacterGenerationAudit,
    candidate: &CharacterCandidateView,
    supersedes: Option<&str>,
    at: &str,
) -> Result<(), CampaignStoreError> {
    let trait_generation = match (candidate.kind.as_str(), supersedes) {
        ("COMPLETE_CHARACTER", Some(source_id)) => Some(
            load_candidate_by_id(transaction, campaign_id, source_id, true)?
                .ok_or(CampaignStoreError::InvalidData)?
                .generation,
        ),
        _ => None,
    };
    let stored = StoredCharacterCandidate {
        view: candidate.clone(),
        generation: generation.clone(),
        trait_generation,
    };
    let provenance = serde_json::json!({
        "revisionKind": if supersedes.is_some() { "REGENERATE" } else { "INITIAL" },
        "requestId": generation.request_id,
        "providerId": "windows-offline-fake",
        "modelName": generation.request.get("modelName").and_then(Value::as_str).unwrap_or("ember-fake-v1"),
        "resolvedModelFingerprint": "offline-fake:ember-fake-v1",
        "contextManifestHash": generation.idempotency_key,
    });
    transaction.execute(
        "INSERT INTO ai_candidates (
           id, campaign_id, operation_id, task, generation_record_id, payload_json,
           validation_json, provenance_json, expected_revision, status,
           supersedes_candidate_id, superseded_by_candidate_id, created_at, updated_at
         ) VALUES (?1, ?2, ?3, ?4, NULL, ?5, ?6, ?7, 0, 'PROPOSED', ?8, NULL, ?9, ?9)",
        params![
            candidate.id,
            campaign_id,
            generation.idempotency_key,
            task,
            json(&stored)?,
            serde_json::to_string(&serde_json::json!({
                "schemaValid": true,
                "domainValid": true,
                "validatedAt": at,
                "checks": ["ai-output-schema", "character-domain-rules", "campaign-boundary"]
            }))
            .map_err(|_| CampaignStoreError::InvalidData)?,
            serde_json::to_string(&provenance).map_err(|_| CampaignStoreError::InvalidData)?,
            supersedes,
            at,
        ],
    )?;
    if let Some(source_id) = supersedes {
        let changed = transaction.execute(
            "UPDATE ai_candidates
             SET status = 'SUPERSEDED', superseded_by_candidate_id = ?1, updated_at = ?2
             WHERE id = ?3 AND campaign_id = ?4 AND status = 'PROPOSED'",
            params![candidate.id, at, source_id, campaign_id],
        )?;
        if changed != 1 {
            return Err(CampaignStoreError::InvalidState);
        }
    }
    Ok(())
}

fn load_candidate_by_id(
    connection: &Connection,
    campaign_id: &str,
    id: &str,
    require_proposed: bool,
) -> Result<Option<StoredCharacterCandidate>, CampaignStoreError> {
    let row = connection
        .query_row(
            "SELECT payload_json FROM ai_candidates
             WHERE id = ?1 AND campaign_id = ?2 AND expected_revision = 0
               AND (?3 = 0 OR status = 'PROPOSED')",
            params![id, campaign_id, i64::from(require_proposed)],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    row.map(|raw| {
        let stored: StoredCharacterCandidate =
            serde_json::from_str(&raw).map_err(|_| CampaignStoreError::InvalidData)?;
        validate_character_candidate(&stored.view, campaign_id)?;
        Ok(stored)
    })
    .transpose()
}

fn load_latest_candidate(
    connection: &Connection,
    campaign_id: &str,
) -> Result<Option<StoredCharacterCandidate>, CampaignStoreError> {
    let id = connection
        .query_row(
            "SELECT id FROM ai_candidates
             WHERE campaign_id = ?1 AND status = 'PROPOSED'
               AND task IN ('GENERATE_CHARACTER_TRAITS', 'COMPLETE_CHARACTER_BACKGROUND')
             ORDER BY updated_at DESC, id DESC LIMIT 1",
            [campaign_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    id.map(|value| load_candidate_by_id(connection, campaign_id, &value, true))
        .transpose()
        .map(|value| value.flatten())
}

fn validate_character_candidate(
    candidate: &CharacterCandidateView,
    campaign_id: &str,
) -> Result<(), CampaignStoreError> {
    validate_id(&candidate.id)?;
    validate_character_draft(&candidate.draft, campaign_id)?;
    validate_id(&candidate.trait_generation_record_id)?;
    if candidate.trait_candidates.len() != 6 {
        return Err(CampaignStoreError::InvalidData);
    }
    for value in &candidate.trait_candidates {
        validate_id(&value.id)?;
        validate_text(&value.name, 200)?;
        validate_text(&value.description, 4_000)?;
    }
    let offered = candidate
        .trait_candidates
        .iter()
        .map(|value| value.id.as_str())
        .collect::<HashSet<_>>();
    if offered.len() != candidate.trait_candidates.len()
        || candidate
            .selected_traits
            .iter()
            .any(|value| !offered.contains(value.id.as_str()))
    {
        return Err(CampaignStoreError::InvalidData);
    }
    for item in &candidate.initial_equipment {
        validate_id(&item.id)?;
        validate_text(&item.name, 200)?;
        validate_text(&item.description, 4_000)?;
        let valid_effect = item.effect == serde_json::json!({"kind": "NONE"})
            || item.effect.as_object().is_some_and(|effect| {
                effect.get("kind").and_then(Value::as_str) == Some("CHECK_MODIFIER")
                    && effect.get("modifier").and_then(Value::as_i64) == Some(1)
                    && effect
                        .get("attribute")
                        .and_then(Value::as_str)
                        .is_some_and(|value| {
                            ["physique", "agility", "knowledge", "charisma"].contains(&value)
                        })
                    && effect.len() == 3
            });
        if !valid_effect {
            return Err(CampaignStoreError::InvalidData);
        }
    }
    match candidate.kind.as_str() {
        "CHARACTER_TRAITS"
            if candidate.selected_traits.is_empty()
                && candidate.background.is_none()
                && candidate.initial_equipment.is_empty() => {}
        "COMPLETE_CHARACTER"
            if candidate.selected_traits.len() == 2
                && candidate.background.is_some()
                && !candidate.initial_equipment.is_empty()
                && candidate.initial_equipment.len() <= 4 => {}
        _ => return Err(CampaignStoreError::InvalidData),
    }
    Ok(())
}

fn validate_stored_candidate_context(
    stored: &StoredCharacterCandidate,
) -> Result<(), CampaignStoreError> {
    let trait_generation = stored
        .trait_generation
        .as_ref()
        .ok_or(CampaignStoreError::InvalidData)?;
    let expected_trait_input = serde_json::json!({
        "concept": stored.view.draft.concept,
        "classArchetype": stored.view.draft.class_archetype,
        "personalGoal": stored.view.draft.personal_goal,
        "storyPreferences": stored.view.draft.story_preferences,
    });
    let expected_trait_context = serde_json::json!({ "character": stored.view.draft });
    let selected = stored
        .view
        .selected_traits
        .iter()
        .map(|value| {
            serde_json::json!({
                "name": value.name,
                "description": value.description,
            })
        })
        .collect::<Vec<_>>();
    let expected_background_input = serde_json::json!({
        "name": stored.view.draft.name,
        "concept": stored.view.draft.concept,
        "classDisplayName": stored.view.draft.class_display_name,
        "personalGoal": stored.view.draft.personal_goal,
        "traits": selected,
    });
    let expected_background_context = serde_json::json!({
        "character": stored.view.draft,
        "selectedTraits": stored.view.selected_traits,
        "traitGenerationRecordId": stored.view.trait_generation_record_id,
    });
    if trait_generation.input != expected_trait_input
        || trait_generation.context != expected_trait_context
        || stored.generation.input != expected_background_input
        || stored.generation.context != expected_background_context
    {
        return Err(CampaignStoreError::InvalidData);
    }
    Ok(())
}

fn candidate_replayed(
    connection: &Connection,
    key: &str,
    campaign_id: &str,
    task: &str,
) -> Result<bool, CampaignStoreError> {
    let candidate = connection
        .query_row(
            "SELECT campaign_id, task FROM ai_candidates WHERE operation_id = ?1",
            [key],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()?;
    match candidate {
        Some((stored_campaign, stored_task))
            if stored_campaign == campaign_id && stored_task == task =>
        {
            Ok(true)
        }
        Some(_) => Err(CampaignStoreError::InvalidState),
        None => replayed(connection, key, campaign_id, task),
    }
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
    let candidates = load_trait_candidates(connection, campaign_id, generation_record_id)?;
    for selected_trait in selected {
        validate_id(&selected_trait.id)?;
        let index = candidates
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

fn load_trait_candidates(
    connection: &Connection,
    campaign_id: &str,
    generation_record_id: &str,
) -> Result<Vec<CharacterTraitView>, CampaignStoreError> {
    let stored = load_candidate_by_id(
        connection,
        campaign_id,
        &candidate_id(generation_record_id),
        true,
    )?
    .ok_or(CampaignStoreError::InvalidData)?;
    if stored.view.kind != "CHARACTER_TRAITS"
        || stored.view.trait_generation_record_id != generation_record_id
    {
        return Err(CampaignStoreError::InvalidData);
    }
    Ok(stored.view.trait_candidates)
}

fn commit_candidate_generations(
    transaction: &Transaction<'_>,
    stored: &StoredCharacterCandidate,
    at: &str,
) -> Result<(), CampaignStoreError> {
    let trait_generation = stored
        .trait_generation
        .as_ref()
        .ok_or(CampaignStoreError::InvalidData)?;
    validate_generation_audit(trait_generation, "GENERATE_CHARACTER_TRAITS")?;
    validate_generation_audit(&stored.generation, "COMPLETE_CHARACTER_BACKGROUND")?;
    insert_generation(
        transaction,
        &stored.view.draft.campaign_id,
        "GENERATE_CHARACTER_TRAITS",
        trait_generation,
        at,
    )?;
    insert_generation(
        transaction,
        &stored.view.draft.campaign_id,
        "COMPLETE_CHARACTER_BACKGROUND",
        &stored.generation,
        at,
    )?;
    let changed = transaction.execute(
        "UPDATE ai_candidates
         SET status = 'ACCEPTED', generation_record_id = ?1, updated_at = ?2
         WHERE id = ?3 AND campaign_id = ?4 AND status = 'PROPOSED'",
        params![
            stored.generation.generation_record_id,
            at,
            stored.view.id,
            stored.view.draft.campaign_id
        ],
    )?;
    if changed != 1 {
        return Err(CampaignStoreError::InvalidState);
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
    let candidate = load_latest_candidate(connection, campaign_id)?.map(|stored| stored.view);
    let (trait_generation_record_id, trait_candidates, generated_draft) = candidate
        .as_ref()
        .map(|value| {
            (
                Some(value.trait_generation_record_id.clone()),
                value.trait_candidates.clone(),
                Some(value.draft.clone()),
            )
        })
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
        candidate,
        character,
    })
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
        let proposed = reopened
            .commit_character_completion(background_command(
                resumed.trait_generation_record_id.expect("trait record id"),
                selected,
            ))
            .expect("propose complete character");
        assert_eq!(proposed.campaign_state, "CREATING_CHARACTER");
        assert!(proposed.character.is_none());
        let connection = reopened.connect().expect("candidate boundary connection");
        assert_eq!(
            connection
                .query_row("SELECT COUNT(*) FROM player_characters", [], |row| row
                    .get::<_, i64>(0))
                .expect("character count"),
            0
        );
        assert_eq!(
            connection
                .query_row("SELECT COUNT(*) FROM items", [], |row| row.get::<_, i64>(0))
                .expect("item count"),
            0
        );
        assert_eq!(
            connection
                .query_row("SELECT COUNT(*) FROM generation_records", [], |row| row
                    .get::<_, i64>(0))
                .expect("generation count"),
            0
        );
        drop(connection);
        assert!(matches!(
            reopened.export_campaign_archive(
                "campaign-character",
                directory.path().join("unconfirmed.emtavern"),
                "0.2.0"
            ),
            Err(CampaignStoreError::UnconfirmedCandidate)
        ));
        let candidate_id = proposed.candidate.expect("complete candidate").id;
        let completed = reopened
            .confirm_character_candidate(CharacterCandidateConfirm {
                campaign_id: "campaign-character".to_owned(),
                candidate_id: candidate_id.clone(),
            })
            .expect("confirm character");
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
        let connection = reopened.connect().expect("confirmed evidence connection");
        assert_eq!(
            connection
                .query_row("SELECT COUNT(*) FROM generation_records", [], |row| row
                    .get::<_, i64>(0))
                .expect("committed generation count"),
            2
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT status FROM ai_candidates WHERE id = ?1",
                    [&candidate_id],
                    |row| row.get::<_, String>(0)
                )
                .expect("candidate status"),
            "ACCEPTED"
        );
        drop(connection);
        assert_eq!(
            reopened
                .confirm_character_candidate(CharacterCandidateConfirm {
                    campaign_id: "campaign-character".to_owned(),
                    candidate_id,
                })
                .expect("idempotent confirmation")
                .campaign_state,
            "GENERATING_TAVERN"
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

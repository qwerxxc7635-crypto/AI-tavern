use std::collections::{HashMap, HashSet};

use rusqlite::{Connection, OptionalExtension, Transaction, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};

use crate::{
    CampaignStore, CampaignStoreError, CharacterGenerationAudit, career_pool_generation_context,
    current_timestamp, insert_character_generation, load_career_pool_value,
    validate_character_career_reference, validate_character_generation_audit, validate_id,
    validate_timestamp,
};

const LOCKABLE_FIELDS: &[&str] = &[
    "name",
    "nickname",
    "gender",
    "age",
    "identity",
    "ancestry",
    "birthplace",
    "socialClass",
    "faith",
    "appearance",
    "personality",
    "values",
    "goals",
    "fears",
    "secrets",
    "family",
    "education",
    "importantPeople",
    "enemies",
    "experiences",
    "concept",
    "storyPreferences",
    "contentBoundaries",
    "career",
    "attributes",
    "derivedAttributes",
    "skills",
    "proficiencies",
    "abilities",
    "languages",
    "wealth",
    "equipmentIds",
    "reputations",
    "relationships",
    "traits",
    "statuses",
    "legacyBackground",
];

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UniversalCharacterDraft {
    pub kind: String,
    pub schema_version: i64,
    pub id: String,
    pub campaign_id: String,
    pub name: String,
    pub nickname: Option<String>,
    pub gender: Option<String>,
    pub age: Option<i64>,
    pub identity: String,
    pub ancestry: Option<String>,
    pub birthplace: Option<String>,
    pub social_class: Option<String>,
    pub faith: Option<String>,
    pub appearance: String,
    pub personality: String,
    pub values: Vec<String>,
    pub goals: Vec<String>,
    pub fears: Vec<String>,
    pub secrets: Vec<String>,
    pub family: Vec<String>,
    pub education: Vec<String>,
    pub important_people: Vec<String>,
    pub enemies: Vec<String>,
    pub experiences: Vec<String>,
    pub concept: String,
    pub story_preferences: Vec<String>,
    pub content_boundaries: UniversalCharacterBoundaries,
    pub career: UniversalCharacterCareer,
    pub attributes: UniversalCharacterAttributes,
    pub derived_attributes: Vec<Value>,
    pub skills: Vec<String>,
    pub proficiencies: Vec<String>,
    pub abilities: Vec<String>,
    pub languages: Vec<String>,
    pub wealth: i64,
    pub equipment_ids: Vec<String>,
    pub reputations: Vec<Value>,
    pub relationships: Vec<Value>,
    pub traits: Vec<UniversalCharacterTrait>,
    pub statuses: Vec<String>,
    pub legacy_background: UniversalCharacterBackground,
    pub extensions: Vec<CharacterExtensionValues>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UniversalCharacterBoundaries {
    pub allow_horror: bool,
    pub allow_permanent_death: bool,
    pub allow_romance: bool,
    pub allow_betrayal: bool,
    pub excluded_content: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UniversalCharacterCareer {
    pub id: Option<String>,
    pub display_name: String,
    pub legacy_archetype: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct UniversalCharacterAttributes {
    pub physique: i64,
    pub agility: i64,
    pub knowledge: i64,
    pub charisma: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct UniversalCharacterTrait {
    pub id: String,
    pub name: String,
    pub description: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub point_profile: Option<TraitPointProfile>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TraitPointProfile {
    #[serde(rename = "type")]
    pub trait_type: String,
    pub positive_effect: Option<String>,
    pub negative_effect: Option<String>,
    pub buff_points: i64,
    pub debuff_points: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub positive_balance: Option<TraitEffectBalanceDeclaration>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub negative_balance: Option<TraitEffectBalanceDeclaration>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TraitEffectBalanceDeclaration {
    pub frequency: String,
    pub environment: String,
    pub combat: String,
    pub social: String,
    pub narrative: String,
    pub economy: String,
    pub permanence: String,
    pub avoidability: String,
    pub rarity: String,
    pub condition: String,
    pub mechanic_tags: Vec<String>,
    pub grants_tags: Vec<String>,
    pub requires_tags: Vec<String>,
    pub neutralizes_tags: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UniversalCharacterBackground {
    pub birthplace: String,
    pub formative_experience: String,
    pub adventure_motivation: String,
    pub secret: String,
    pub important_person: String,
    pub tavern_arrival_reason: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CharacterExtensionValues {
    pub namespace: String,
    pub schema_version: i64,
    pub values: Map<String, Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CharacterCreationSessionView {
    pub kind: String,
    pub schema_version: i64,
    pub id: String,
    pub campaign_id: String,
    pub character_id: String,
    pub constitution_revision: i64,
    pub mode: String,
    pub status: String,
    pub concept_input: Option<String>,
    pub draft: UniversalCharacterDraft,
    pub locked_fields: Vec<String>,
    pub generation_record_id: Option<String>,
    pub revision: i64,
    pub created_at: String,
    pub updated_at: String,
    pub cancelled_at: Option<String>,
    pub confirmed_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UniversalCharacterCreationSnapshot {
    pub campaign_id: String,
    pub campaign_state: String,
    pub constitution_revision: i64,
    pub constitution: Value,
    pub extension_definitions: Vec<Value>,
    pub career_pool: Option<Value>,
    pub session: Option<CharacterCreationSessionView>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UniversalCharacterCreationStart {
    pub session_id: String,
    pub character_id: String,
    pub campaign_id: String,
    pub mode: String,
    pub concept_input: Option<String>,
    pub story_preferences: Vec<String>,
    pub content_boundaries: UniversalCharacterBoundaries,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UniversalCharacterCreationSave {
    pub campaign_id: String,
    pub expected_revision: i64,
    pub session: CharacterCreationSessionView,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UniversalCharacterQuickCommit {
    pub campaign_id: String,
    pub expected_revision: i64,
    pub generation: CharacterGenerationAudit,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UniversalCharacterCreationConfirm {
    pub campaign_id: String,
    pub expected_revision: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct QuickCharacterOutput {
    name: String,
    nickname: Option<String>,
    gender: Option<String>,
    age: Option<i64>,
    identity: String,
    ancestry: Option<String>,
    birthplace: Option<String>,
    social_class: Option<String>,
    faith: Option<String>,
    appearance: String,
    personality: String,
    values: Vec<String>,
    goals: Vec<String>,
    fears: Vec<String>,
    secrets: Vec<String>,
    family: Vec<String>,
    education: Vec<String>,
    important_people: Vec<String>,
    enemies: Vec<String>,
    experiences: Vec<String>,
    career: QuickCareer,
    attribute_priority: Vec<String>,
    proficiencies: Vec<String>,
    abilities: Vec<String>,
    languages: Vec<String>,
    traits: Vec<QuickTrait>,
    legacy_background: UniversalCharacterBackground,
    extensions: Vec<CharacterExtensionValues>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct QuickCareer {
    id: String,
    display_name: String,
    legacy_archetype: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct QuickTrait {
    name: String,
    description: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ExtensionDefinition {
    kind: String,
    schema_version: i64,
    campaign_id: String,
    namespace: String,
    display_name: String,
    constitution_revision: i64,
    fields: Vec<ExtensionField>,
    revision: i64,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "SCREAMING_SNAKE_CASE")]
enum ExtensionField {
    Text {
        key: String,
        label: String,
        required: bool,
        #[serde(rename = "maxLength")]
        max_length: i64,
    },
    Integer {
        key: String,
        label: String,
        required: bool,
        minimum: f64,
        maximum: f64,
    },
    Number {
        key: String,
        label: String,
        required: bool,
        minimum: f64,
        maximum: f64,
    },
    Boolean {
        key: String,
        label: String,
        required: bool,
    },
    Enum {
        key: String,
        label: String,
        required: bool,
        options: Vec<String>,
    },
    TextList {
        key: String,
        label: String,
        required: bool,
        #[serde(rename = "maxItems")]
        max_items: i64,
        #[serde(rename = "itemMaxLength")]
        item_max_length: i64,
    },
}

impl CampaignStore {
    pub fn universal_character_creation_snapshot(
        &self,
        campaign_id: &str,
    ) -> Result<UniversalCharacterCreationSnapshot, CampaignStoreError> {
        validate_id(campaign_id)?;
        let connection = self.connect()?;
        creation_snapshot(&connection, campaign_id)
    }

    pub fn start_universal_character_creation(
        &self,
        command: UniversalCharacterCreationStart,
    ) -> Result<UniversalCharacterCreationSnapshot, CampaignStoreError> {
        validate_id(&command.session_id)?;
        validate_id(&command.character_id)?;
        validate_id(&command.campaign_id)?;
        validate_mode(&command.mode)?;
        validate_optional_text(command.concept_input.as_deref(), 4_000)?;
        if command.mode == "QUICK" && command.concept_input.is_none() {
            return Err(CampaignStoreError::InvalidData);
        }
        validate_text_list(&command.story_preferences, 32, 4_000, false)?;
        validate_boundaries(&command.content_boundaries)?;
        let mut connection = self.connect()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        if let Some(existing) = load_session(&transaction, &command.campaign_id)? {
            validate_session(&transaction, &existing, false)?;
            transaction.commit()?;
            return self.universal_character_creation_snapshot(&command.campaign_id);
        }
        require_creation_campaign(&transaction, &command.campaign_id)?;
        if load_career_pool_value(&transaction, &command.campaign_id)?.is_none() {
            return Err(CampaignStoreError::InvalidState);
        }
        if character_exists(&transaction, &command.campaign_id)? {
            return Err(CampaignStoreError::InvalidState);
        }
        let constitution_revision =
            locked_constitution_revision(&transaction, &command.campaign_id)?;
        let at = current_timestamp()?;
        let draft = blank_draft(&command);
        let session = CharacterCreationSessionView {
            kind: "CHARACTER_CREATION_SESSION".to_owned(),
            schema_version: 1,
            id: command.session_id,
            campaign_id: command.campaign_id.clone(),
            character_id: command.character_id,
            constitution_revision,
            mode: command.mode,
            status: "ACTIVE".to_owned(),
            concept_input: command.concept_input,
            draft,
            locked_fields: Vec::new(),
            generation_record_id: None,
            revision: 1,
            created_at: at.clone(),
            updated_at: at,
            cancelled_at: None,
            confirmed_at: None,
        };
        validate_session(&transaction, &session, false)?;
        insert_session(&transaction, &session)?;
        transaction.commit()?;
        self.universal_character_creation_snapshot(&command.campaign_id)
    }

    pub fn save_universal_character_creation(
        &self,
        command: UniversalCharacterCreationSave,
    ) -> Result<UniversalCharacterCreationSnapshot, CampaignStoreError> {
        validate_id(&command.campaign_id)?;
        if command.expected_revision < 1 {
            return Err(CampaignStoreError::InvalidData);
        }
        let mut connection = self.connect()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let current = load_session(&transaction, &command.campaign_id)?
            .ok_or(CampaignStoreError::NotFound)?;
        let mut next = command.session;
        let at = current_timestamp()?;
        next.updated_at = at.clone();
        next.cancelled_at = if next.status == "CANCELLED" {
            Some(at)
        } else {
            None
        };
        validate_session_update(&transaction, &current, &next, command.expected_revision)?;
        update_session(&transaction, &next, command.expected_revision)?;
        transaction.commit()?;
        self.universal_character_creation_snapshot(&command.campaign_id)
    }

    pub fn commit_universal_quick_character(
        &self,
        command: UniversalCharacterQuickCommit,
    ) -> Result<UniversalCharacterCreationSnapshot, CampaignStoreError> {
        validate_id(&command.campaign_id)?;
        validate_character_generation_audit(&command.generation, "GENERATE_QUICK_CHARACTER")?;
        let output: QuickCharacterOutput =
            serde_json::from_value(command.generation.validated_output.clone())
                .map_err(|_| CampaignStoreError::InvalidData)?;
        let mut connection = self.connect()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        if let Some(existing) = replayed_quick_generation(
            &transaction,
            &command.campaign_id,
            &command.generation.idempotency_key,
        )? {
            transaction.commit()?;
            return creation_snapshot(&connection, &existing);
        }
        let current = load_session(&transaction, &command.campaign_id)?
            .ok_or(CampaignStoreError::NotFound)?;
        if current.revision != command.expected_revision
            || current.mode != "QUICK"
            || current.status == "CANCELLED"
            || current.status == "CONFIRMED"
        {
            return Err(CampaignStoreError::InvalidState);
        }
        validate_quick_generation_context(&transaction, &current, &command.generation)?;
        validate_character_career_reference(
            &transaction,
            &current.campaign_id,
            Some(&output.career.id),
            &output.career.display_name,
            Some(&output.career.legacy_archetype),
        )?;
        let mut draft =
            build_quick_draft(&current, output, &command.generation.generation_record_id)?;
        preserve_locked_values(&current.draft, &mut draft, &current.locked_fields)?;
        let definitions = load_definitions(&transaction, &current.campaign_id)?;
        validate_draft(&draft, &definitions, true)?;
        let at = current_timestamp()?;
        insert_character_generation(
            &transaction,
            &command.campaign_id,
            "GENERATE_QUICK_CHARACTER",
            &command.generation,
            &at,
        )?;
        let mut next = current;
        next.draft = draft;
        next.status = "READY_TO_CONFIRM".to_owned();
        next.generation_record_id = Some(command.generation.generation_record_id);
        next.revision += 1;
        next.updated_at = at;
        next.cancelled_at = None;
        validate_session(&transaction, &next, true)?;
        update_session(&transaction, &next, command.expected_revision)?;
        transaction.commit()?;
        self.universal_character_creation_snapshot(&command.campaign_id)
    }

    pub fn confirm_universal_character_creation(
        &self,
        command: UniversalCharacterCreationConfirm,
    ) -> Result<UniversalCharacterCreationSnapshot, CampaignStoreError> {
        validate_id(&command.campaign_id)?;
        let mut connection = self.connect()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let current = load_session(&transaction, &command.campaign_id)?
            .ok_or(CampaignStoreError::NotFound)?;
        if current.status == "CONFIRMED" {
            if command.expected_revision == current.revision
                || command.expected_revision + 1 == current.revision
            {
                transaction.commit()?;
                return self.universal_character_creation_snapshot(&command.campaign_id);
            }
            return Err(CampaignStoreError::InvalidState);
        }
        if current.revision != command.expected_revision || current.status != "READY_TO_CONFIRM" {
            return Err(CampaignStoreError::InvalidState);
        }
        require_creation_campaign(&transaction, &command.campaign_id)?;
        let definitions = load_definitions(&transaction, &command.campaign_id)?;
        validate_draft(&current.draft, &definitions, true)?;
        if current.mode == "QUICK" {
            validate_quick_provenance(&transaction, &current)?;
        }
        let at = current_timestamp()?;
        insert_formal_character(&transaction, &current.draft, &at)?;
        update_universal_profile(&transaction, &current.draft, &at)?;
        let mut confirmed = current;
        confirmed.status = "CONFIRMED".to_owned();
        confirmed.revision += 1;
        confirmed.updated_at = at.clone();
        confirmed.cancelled_at = None;
        confirmed.confirmed_at = Some(at.clone());
        update_session(&transaction, &confirmed, command.expected_revision)?;
        let changed = transaction.execute(
            "UPDATE campaigns SET state = 'GENERATING_TAVERN', resume_state = NULL, updated_at = ?1
             WHERE id = ?2 AND state = 'CREATING_CHARACTER'",
            params![at, command.campaign_id],
        )?;
        if changed != 1 {
            return Err(CampaignStoreError::InvalidState);
        }
        transaction.commit()?;
        self.universal_character_creation_snapshot(&command.campaign_id)
    }
}

fn creation_snapshot(
    connection: &Connection,
    campaign_id: &str,
) -> Result<UniversalCharacterCreationSnapshot, CampaignStoreError> {
    let campaign_state = connection
        .query_row(
            "SELECT state FROM campaigns WHERE id = ?1",
            [campaign_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .ok_or(CampaignStoreError::NotFound)?;
    Ok(UniversalCharacterCreationSnapshot {
        campaign_id: campaign_id.to_owned(),
        campaign_state,
        constitution_revision: locked_constitution_revision(connection, campaign_id)?,
        constitution: load_constitution_context(connection, campaign_id)?,
        extension_definitions: load_definition_values(connection, campaign_id)?,
        career_pool: load_career_pool_value(connection, campaign_id)?,
        session: load_session(connection, campaign_id)?,
    })
}

fn blank_draft(command: &UniversalCharacterCreationStart) -> UniversalCharacterDraft {
    UniversalCharacterDraft {
        kind: "UNIVERSAL_CHARACTER_DRAFT".to_owned(),
        schema_version: 1,
        id: command.character_id.clone(),
        campaign_id: command.campaign_id.clone(),
        name: String::new(),
        nickname: None,
        gender: None,
        age: None,
        identity: String::new(),
        ancestry: None,
        birthplace: None,
        social_class: None,
        faith: None,
        appearance: String::new(),
        personality: String::new(),
        values: Vec::new(),
        goals: Vec::new(),
        fears: Vec::new(),
        secrets: Vec::new(),
        family: Vec::new(),
        education: Vec::new(),
        important_people: Vec::new(),
        enemies: Vec::new(),
        experiences: Vec::new(),
        concept: command.concept_input.clone().unwrap_or_default(),
        story_preferences: command.story_preferences.clone(),
        content_boundaries: command.content_boundaries.clone(),
        career: UniversalCharacterCareer {
            id: None,
            display_name: String::new(),
            legacy_archetype: Some("WARRIOR".to_owned()),
        },
        attributes: UniversalCharacterAttributes {
            physique: 3,
            agility: 3,
            knowledge: 2,
            charisma: 2,
        },
        derived_attributes: Vec::new(),
        skills: Vec::new(),
        proficiencies: Vec::new(),
        abilities: Vec::new(),
        languages: Vec::new(),
        wealth: 0,
        equipment_ids: Vec::new(),
        reputations: Vec::new(),
        relationships: Vec::new(),
        traits: Vec::new(),
        statuses: Vec::new(),
        legacy_background: UniversalCharacterBackground {
            birthplace: String::new(),
            formative_experience: String::new(),
            adventure_motivation: String::new(),
            secret: String::new(),
            important_person: String::new(),
            tavern_arrival_reason: String::new(),
        },
        extensions: Vec::new(),
    }
}

fn build_quick_draft(
    session: &CharacterCreationSessionView,
    output: QuickCharacterOutput,
    generation_id: &str,
) -> Result<UniversalCharacterDraft, CampaignStoreError> {
    validate_id(generation_id)?;
    if output.attribute_priority.len() != 4
        || output
            .attribute_priority
            .iter()
            .collect::<HashSet<_>>()
            .len()
            != 4
        || output.attribute_priority.iter().any(|value| {
            !["physique", "agility", "knowledge", "charisma"].contains(&value.as_str())
        })
        || output.traits.len() != 2
    {
        return Err(CampaignStoreError::InvalidData);
    }
    let score = |name: &str| {
        output
            .attribute_priority
            .iter()
            .position(|value| value == name)
            .map(|index| 4 - index as i64)
            .ok_or(CampaignStoreError::InvalidData)
    };
    let birthplace = output
        .birthplace
        .clone()
        .or_else(|| Some(output.legacy_background.birthplace.clone()));
    Ok(UniversalCharacterDraft {
        kind: "UNIVERSAL_CHARACTER_DRAFT".to_owned(),
        schema_version: 1,
        id: session.character_id.clone(),
        campaign_id: session.campaign_id.clone(),
        name: output.name,
        nickname: output.nickname,
        gender: output.gender,
        age: output.age,
        identity: output.identity,
        ancestry: output.ancestry,
        birthplace,
        social_class: output.social_class,
        faith: output.faith,
        appearance: output.appearance,
        personality: output.personality,
        values: output.values,
        goals: output.goals,
        fears: output.fears,
        secrets: output.secrets,
        family: output.family,
        education: output.education,
        important_people: output.important_people,
        enemies: output.enemies,
        experiences: output.experiences,
        concept: session
            .concept_input
            .clone()
            .ok_or(CampaignStoreError::InvalidData)?,
        story_preferences: session.draft.story_preferences.clone(),
        content_boundaries: session.draft.content_boundaries.clone(),
        career: UniversalCharacterCareer {
            id: Some(output.career.id),
            display_name: output.career.display_name,
            legacy_archetype: Some(output.career.legacy_archetype),
        },
        attributes: UniversalCharacterAttributes {
            physique: score("physique")?,
            agility: score("agility")?,
            knowledge: score("knowledge")?,
            charisma: score("charisma")?,
        },
        derived_attributes: Vec::new(),
        skills: Vec::new(),
        proficiencies: output.proficiencies,
        abilities: output.abilities,
        languages: output.languages,
        wealth: 0,
        equipment_ids: Vec::new(),
        reputations: Vec::new(),
        relationships: Vec::new(),
        traits: output
            .traits
            .into_iter()
            .enumerate()
            .map(|(index, value)| UniversalCharacterTrait {
                id: format!("quick-trait-{generation_id}-{}", index + 1),
                name: value.name,
                description: value.description,
                point_profile: Some(narrative_trait_point_profile()),
            })
            .collect(),
        statuses: Vec::new(),
        legacy_background: output.legacy_background,
        extensions: output.extensions,
    })
}

fn validate_session_update(
    connection: &Connection,
    current: &CharacterCreationSessionView,
    next: &CharacterCreationSessionView,
    expected_revision: i64,
) -> Result<(), CampaignStoreError> {
    if current.revision != expected_revision
        || next.revision != expected_revision + 1
        || current.id != next.id
        || current.campaign_id != next.campaign_id
        || current.character_id != next.character_id
        || current.constitution_revision != next.constitution_revision
        || current.created_at != next.created_at
        || current.generation_record_id != next.generation_record_id
        || current.status == "CONFIRMED"
        || next.campaign_id != current.campaign_id
    {
        return Err(CampaignStoreError::InvalidState);
    }
    if current.status == "CANCELLED"
        && !["ACTIVE", "READY_TO_CONFIRM"].contains(&next.status.as_str())
    {
        return Err(CampaignStoreError::InvalidState);
    }
    if current.status != "CANCELLED"
        && !["ACTIVE", "READY_TO_CONFIRM", "CANCELLED"].contains(&next.status.as_str())
    {
        return Err(CampaignStoreError::InvalidState);
    }
    assert_locked_preserved(&current.draft, &next.draft, &current.locked_fields)?;
    validate_session(connection, next, next.status == "READY_TO_CONFIRM")
}

fn validate_session(
    connection: &Connection,
    session: &CharacterCreationSessionView,
    require_complete: bool,
) -> Result<(), CampaignStoreError> {
    if session.kind != "CHARACTER_CREATION_SESSION"
        || session.schema_version != 1
        || session.revision < 1
        || session.draft.id != session.character_id
        || session.draft.campaign_id != session.campaign_id
    {
        return Err(CampaignStoreError::InvalidData);
    }
    validate_id(&session.id)?;
    validate_id(&session.campaign_id)?;
    validate_id(&session.character_id)?;
    validate_mode(&session.mode)?;
    if !["ACTIVE", "READY_TO_CONFIRM", "CANCELLED", "CONFIRMED"].contains(&session.status.as_str())
    {
        return Err(CampaignStoreError::InvalidData);
    }
    validate_optional_text(session.concept_input.as_deref(), 4_000)?;
    if session.mode == "QUICK" && session.concept_input.is_none() {
        return Err(CampaignStoreError::InvalidData);
    }
    validate_timestamp(&session.created_at)?;
    validate_timestamp(&session.updated_at)?;
    if session.updated_at < session.created_at {
        return Err(CampaignStoreError::InvalidData);
    }
    if let Some(value) = &session.cancelled_at {
        validate_timestamp(value)?;
    }
    if let Some(value) = &session.confirmed_at {
        validate_timestamp(value)?;
    }
    if (session.status == "CANCELLED") != session.cancelled_at.is_some()
        || (session.status == "CONFIRMED") != session.confirmed_at.is_some()
        || (session.status == "CONFIRMED" && session.cancelled_at.is_some())
        || (session.mode == "QUICK"
            && ["READY_TO_CONFIRM", "CONFIRMED"].contains(&session.status.as_str())
            && session.generation_record_id.is_none())
    {
        return Err(CampaignStoreError::InvalidData);
    }
    let expected_revision = locked_constitution_revision(connection, &session.campaign_id)?;
    if session.constitution_revision != expected_revision {
        return Err(CampaignStoreError::InvalidData);
    }
    let definitions = load_definitions(connection, &session.campaign_id)?;
    validate_locked_fields(&session.locked_fields, &definitions)?;
    validate_draft(&session.draft, &definitions, require_complete)?;
    if require_complete {
        validate_character_career_reference(
            connection,
            &session.campaign_id,
            session.draft.career.id.as_deref(),
            &session.draft.career.display_name,
            session.draft.career.legacy_archetype.as_deref(),
        )?;
    }
    Ok(())
}

fn validate_draft(
    draft: &UniversalCharacterDraft,
    definitions: &[ExtensionDefinition],
    complete: bool,
) -> Result<(), CampaignStoreError> {
    if draft.kind != "UNIVERSAL_CHARACTER_DRAFT" || draft.schema_version != 1 {
        return Err(CampaignStoreError::InvalidData);
    }
    validate_id(&draft.id)?;
    validate_id(&draft.campaign_id)?;
    validate_draft_text(&draft.name, 120, !complete)?;
    validate_draft_text(&draft.identity, 1_000, !complete)?;
    validate_draft_text(&draft.concept, 4_000, !complete)?;
    validate_draft_text(&draft.career.display_name, 240, !complete)?;
    for value in [
        draft.nickname.as_deref(),
        draft.gender.as_deref(),
        draft.ancestry.as_deref(),
        draft.birthplace.as_deref(),
        draft.social_class.as_deref(),
        draft.faith.as_deref(),
        draft.career.id.as_deref(),
    ] {
        validate_optional_text(value, 1_000)?;
    }
    if draft
        .age
        .is_some_and(|value| !(0..=10_000).contains(&value))
    {
        return Err(CampaignStoreError::InvalidData);
    }
    validate_draft_text(&draft.appearance, 4_000, !complete)?;
    validate_draft_text(&draft.personality, 4_000, !complete)?;
    for list in [
        &draft.values,
        &draft.goals,
        &draft.fears,
        &draft.secrets,
        &draft.family,
        &draft.education,
        &draft.important_people,
        &draft.enemies,
        &draft.experiences,
        &draft.story_preferences,
        &draft.proficiencies,
        &draft.abilities,
        &draft.languages,
    ] {
        validate_text_list(list, 128, 4_000, false)?;
    }
    validate_boundaries(&draft.content_boundaries)?;
    let attributes = [
        draft.attributes.physique,
        draft.attributes.agility,
        draft.attributes.knowledge,
        draft.attributes.charisma,
    ];
    if attributes.iter().any(|value| !(1..=5).contains(value))
        || attributes.iter().sum::<i64>() != 10
        || !(0..=1_000_000_000).contains(&draft.wealth)
    {
        return Err(CampaignStoreError::InvalidData);
    }
    validate_text_list(&draft.skills, 128, 4_000, false)?;
    validate_text_list(&draft.statuses, 128, 4_000, false)?;
    if draft.traits.len() > 32 {
        return Err(CampaignStoreError::InvalidData);
    }
    let mut trait_ids = HashSet::new();
    let mut trait_point_net = 0_i64;
    for value in &draft.traits {
        validate_id(&value.id)?;
        validate_draft_text(&value.name, 120, false)?;
        validate_draft_text(&value.description, 4_000, false)?;
        if !trait_ids.insert(&value.id) {
            return Err(CampaignStoreError::InvalidData);
        }
        trait_point_net += validate_trait_point_profile(value.point_profile.as_ref(), complete)?;
    }
    for value in [
        &draft.legacy_background.birthplace,
        &draft.legacy_background.formative_experience,
        &draft.legacy_background.adventure_motivation,
        &draft.legacy_background.secret,
        &draft.legacy_background.important_person,
        &draft.legacy_background.tavern_arrival_reason,
    ] {
        validate_draft_text(value, 4_000, !complete)?;
    }
    validate_extension_values(draft, definitions, complete)?;
    if complete {
        validate_trait_synergy(&draft.traits)?;
    }
    if complete
        && (draft.goals.is_empty()
            || trait_point_net != 0
            || !["WARRIOR", "ROGUE", "SCHOLAR", "DIPLOMAT"]
                .contains(&draft.career.legacy_archetype.as_deref().unwrap_or_default())
            || !draft.derived_attributes.is_empty()
            || !draft.skills.is_empty()
            || draft.wealth != 0
            || !draft.equipment_ids.is_empty()
            || !draft.reputations.is_empty()
            || !draft.relationships.is_empty()
            || !draft.statuses.is_empty())
    {
        return Err(CampaignStoreError::InvalidData);
    }
    Ok(())
}

fn validate_extension_values(
    draft: &UniversalCharacterDraft,
    definitions: &[ExtensionDefinition],
    complete: bool,
) -> Result<(), CampaignStoreError> {
    let definition_map = definitions
        .iter()
        .map(|value| (value.namespace.as_str(), value))
        .collect::<HashMap<_, _>>();
    let mut supplied = HashSet::new();
    for extension in &draft.extensions {
        let definition = definition_map
            .get(extension.namespace.as_str())
            .ok_or(CampaignStoreError::InvalidData)?;
        if extension.schema_version != 1 || !supplied.insert(extension.namespace.as_str()) {
            return Err(CampaignStoreError::InvalidData);
        }
        for key in extension.values.keys() {
            if !definition.fields.iter().any(|field| field.key() == key) {
                return Err(CampaignStoreError::InvalidData);
            }
        }
        for field in &definition.fields {
            match extension.values.get(field.key()) {
                Some(value) => field.validate_value(value)?,
                None if complete && field.required() => {
                    return Err(CampaignStoreError::InvalidData);
                }
                None => {}
            }
        }
    }
    if complete
        && definitions.iter().any(|definition| {
            definition.fields.iter().any(ExtensionField::required)
                && !supplied.contains(definition.namespace.as_str())
        })
    {
        return Err(CampaignStoreError::InvalidData);
    }
    Ok(())
}

impl ExtensionField {
    fn key(&self) -> &str {
        match self {
            Self::Text { key, .. }
            | Self::Integer { key, .. }
            | Self::Number { key, .. }
            | Self::Boolean { key, .. }
            | Self::Enum { key, .. }
            | Self::TextList { key, .. } => key,
        }
    }

    fn required(&self) -> bool {
        match self {
            Self::Text { required, .. }
            | Self::Integer { required, .. }
            | Self::Number { required, .. }
            | Self::Boolean { required, .. }
            | Self::Enum { required, .. }
            | Self::TextList { required, .. } => *required,
        }
    }

    fn validate_value(&self, value: &Value) -> Result<(), CampaignStoreError> {
        match self {
            Self::Text { max_length, .. } => value
                .as_str()
                .filter(|text| !text.is_empty() && text.len() <= *max_length as usize)
                .map(|_| ())
                .ok_or(CampaignStoreError::InvalidData),
            Self::Integer {
                minimum, maximum, ..
            } => value
                .as_i64()
                .map(|number| number as f64)
                .filter(|number| number >= minimum && number <= maximum)
                .map(|_| ())
                .ok_or(CampaignStoreError::InvalidData),
            Self::Number {
                minimum, maximum, ..
            } => value
                .as_f64()
                .filter(|number| number.is_finite() && number >= minimum && number <= maximum)
                .map(|_| ())
                .ok_or(CampaignStoreError::InvalidData),
            Self::Boolean { .. } => value
                .as_bool()
                .map(|_| ())
                .ok_or(CampaignStoreError::InvalidData),
            Self::Enum { options, .. } => value
                .as_str()
                .filter(|text| options.iter().any(|option| option == text))
                .map(|_| ())
                .ok_or(CampaignStoreError::InvalidData),
            Self::TextList {
                max_items,
                item_max_length,
                ..
            } => value
                .as_array()
                .filter(|items| {
                    items.len() <= *max_items as usize
                        && items.iter().all(|item| {
                            item.as_str().is_some_and(|text| {
                                !text.is_empty() && text.len() <= *item_max_length as usize
                            })
                        })
                })
                .map(|_| ())
                .ok_or(CampaignStoreError::InvalidData),
        }
    }
}

fn validate_locked_fields(
    values: &[String],
    definitions: &[ExtensionDefinition],
) -> Result<(), CampaignStoreError> {
    if values.len() > 128 || values.iter().collect::<HashSet<_>>().len() != values.len() {
        return Err(CampaignStoreError::InvalidData);
    }
    let dynamic = definitions
        .iter()
        .flat_map(|definition| {
            definition
                .fields
                .iter()
                .map(move |field| format!("extensions.{}.{}", definition.namespace, field.key()))
        })
        .collect::<HashSet<_>>();
    if values
        .iter()
        .any(|value| !LOCKABLE_FIELDS.contains(&value.as_str()) && !dynamic.contains(value))
    {
        return Err(CampaignStoreError::InvalidData);
    }
    Ok(())
}

fn assert_locked_preserved(
    current: &UniversalCharacterDraft,
    next: &UniversalCharacterDraft,
    locked_fields: &[String],
) -> Result<(), CampaignStoreError> {
    let current = serde_json::to_value(current).map_err(|_| CampaignStoreError::InvalidData)?;
    let next = serde_json::to_value(next).map_err(|_| CampaignStoreError::InvalidData)?;
    for field in locked_fields {
        if read_locked_value(&current, field) != read_locked_value(&next, field) {
            return Err(CampaignStoreError::InvalidData);
        }
    }
    Ok(())
}

fn preserve_locked_values(
    current: &UniversalCharacterDraft,
    next: &mut UniversalCharacterDraft,
    locked_fields: &[String],
) -> Result<(), CampaignStoreError> {
    let current_value =
        serde_json::to_value(current).map_err(|_| CampaignStoreError::InvalidData)?;
    let mut next_value =
        serde_json::to_value(&*next).map_err(|_| CampaignStoreError::InvalidData)?;
    for field in locked_fields {
        let value = read_locked_value(&current_value, field).cloned();
        write_locked_value(&mut next_value, field, value)?;
    }
    *next = serde_json::from_value(next_value).map_err(|_| CampaignStoreError::InvalidData)?;
    Ok(())
}

fn read_locked_value<'a>(value: &'a Value, field: &str) -> Option<&'a Value> {
    if let Some(path) = field.strip_prefix("extensions.") {
        let (namespace, key) = path.split_once('.')?;
        return value
            .get("extensions")?
            .as_array()?
            .iter()
            .find(|extension| {
                extension.get("namespace").and_then(Value::as_str) == Some(namespace)
            })?
            .get("values")?
            .get(key);
    }
    value.get(field)
}

fn write_locked_value(
    value: &mut Value,
    field: &str,
    locked: Option<Value>,
) -> Result<(), CampaignStoreError> {
    if let Some(path) = field.strip_prefix("extensions.") {
        let (namespace, key) = path
            .split_once('.')
            .ok_or(CampaignStoreError::InvalidData)?;
        let extensions = value
            .get_mut("extensions")
            .and_then(Value::as_array_mut)
            .ok_or(CampaignStoreError::InvalidData)?;
        let target = extensions.iter_mut().find(|extension| {
            extension.get("namespace").and_then(Value::as_str) == Some(namespace)
        });
        match (target, locked) {
            (Some(extension), Some(item)) => {
                extension
                    .get_mut("values")
                    .and_then(Value::as_object_mut)
                    .ok_or(CampaignStoreError::InvalidData)?
                    .insert(key.to_owned(), item);
            }
            (Some(extension), None) => {
                extension
                    .get_mut("values")
                    .and_then(Value::as_object_mut)
                    .ok_or(CampaignStoreError::InvalidData)?
                    .remove(key);
            }
            (None, None) => {}
            (None, Some(_)) => return Err(CampaignStoreError::InvalidData),
        }
        return Ok(());
    }
    let object = value
        .as_object_mut()
        .ok_or(CampaignStoreError::InvalidData)?;
    let locked = locked.ok_or(CampaignStoreError::InvalidData)?;
    object.insert(field.to_owned(), locked);
    Ok(())
}

fn validate_quick_generation_context(
    connection: &Connection,
    session: &CharacterCreationSessionView,
    audit: &CharacterGenerationAudit,
) -> Result<(), CampaignStoreError> {
    let context = json!({
        "sessionId": session.id,
        "characterId": session.character_id,
        "constitutionRevision": session.constitution_revision,
        "lockedFields": session.locked_fields,
    });
    if audit.context != context {
        return Err(CampaignStoreError::InvalidData);
    }
    let definitions = load_definitions(connection, &session.campaign_id)?;
    let definition_context = definitions
        .iter()
        .map(|definition| {
            json!({
                "namespace": definition.namespace,
                "displayName": definition.display_name,
                "schemaVersion": definition.schema_version,
                "fields": definition.fields,
            })
        })
        .collect::<Vec<_>>();
    let expected = json!({
        "concept": session.concept_input,
        "storyPreferences": session.draft.story_preferences,
        "contentBoundaries": session.draft.content_boundaries,
        "constitution": load_constitution_context(connection, &session.campaign_id)?,
        "extensionDefinitions": definition_context,
        "careerPool": career_pool_generation_context(connection, &session.campaign_id)?,
    });
    if audit.input != expected {
        return Err(CampaignStoreError::InvalidData);
    }
    Ok(())
}

fn validate_quick_provenance(
    connection: &Connection,
    session: &CharacterCreationSessionView,
) -> Result<(), CampaignStoreError> {
    let id = session
        .generation_record_id
        .as_deref()
        .ok_or(CampaignStoreError::InvalidData)?;
    let valid = connection.query_row(
        "SELECT COUNT(*) FROM generation_records
             WHERE id = ?1 AND campaign_id = ?2 AND task = 'GENERATE_QUICK_CHARACTER'
               AND validated_output_json IS NOT NULL AND validation_error_json IS NULL",
        params![id, session.campaign_id],
        |row| row.get::<_, i64>(0),
    )?;
    if valid != 1 {
        return Err(CampaignStoreError::InvalidData);
    }
    Ok(())
}

fn insert_formal_character(
    transaction: &Transaction<'_>,
    draft: &UniversalCharacterDraft,
    at: &str,
) -> Result<(), CampaignStoreError> {
    let archetype = draft
        .career
        .legacy_archetype
        .as_deref()
        .ok_or(CampaignStoreError::InvalidData)?;
    let personal_goal = draft.goals.first().ok_or(CampaignStoreError::InvalidData)?;
    transaction.execute(
        "INSERT INTO player_characters (
           id, campaign_id, name, gender, age, concept,
           story_preferences_json, content_boundaries_json,
           class_archetype, class_display_name, attributes_json, traits_json,
           personal_goal, background_json, initial_equipment_ids_json,
           created_at, updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, '[]', ?15, ?15)",
        params![
            draft.id,
            draft.campaign_id,
            draft.name,
            draft.gender,
            draft.age,
            draft.concept,
            to_json(&draft.story_preferences)?,
            to_json(&draft.content_boundaries)?,
            archetype,
            draft.career.display_name,
            to_json(&draft.attributes)?,
            to_json(&draft.traits)?,
            personal_goal,
            to_json(&draft.legacy_background)?,
            at,
        ],
    )?;
    Ok(())
}

fn update_universal_profile(
    transaction: &Transaction<'_>,
    draft: &UniversalCharacterDraft,
    at: &str,
) -> Result<(), CampaignStoreError> {
    // Patch only V0.3 additions so the trigger-created V0.2-compatible JSON objects retain
    // their exact SQLite representation; base-attribute immutability remains enforced.
    let mut patch = json!({
        "revision": 2,
        "identity": draft.identity,
        "appearance": draft.appearance,
        "personality": draft.personality,
        "values": draft.values,
        "goals": draft.goals,
        "fears": draft.fears,
        "secrets": draft.secrets,
        "family": draft.family,
        "education": draft.education,
        "importantPeople": draft.important_people,
        "enemies": draft.enemies,
        "experiences": draft.experiences,
        "derivedAttributes": draft.derived_attributes,
        "skills": draft.skills,
        "proficiencies": draft.proficiencies,
        "abilities": draft.abilities,
        "languages": draft.languages,
        "wealth": draft.wealth,
        "reputations": draft.reputations,
        "relationships": draft.relationships,
        "statuses": draft.statuses,
        "extensions": draft.extensions,
        "updatedAt": at,
    });
    let patch_object = patch
        .as_object_mut()
        .ok_or(CampaignStoreError::InvalidData)?;
    for (key, value) in [
        ("nickname", draft.nickname.as_ref()),
        ("ancestry", draft.ancestry.as_ref()),
        ("birthplace", draft.birthplace.as_ref()),
        ("socialClass", draft.social_class.as_ref()),
        ("faith", draft.faith.as_ref()),
    ] {
        if let Some(value) = value {
            patch_object.insert(key.to_owned(), Value::String(value.clone()));
        }
    }
    let changed = transaction.execute(
        "UPDATE universal_character_profiles
         SET profile_json = json_patch(profile_json, ?1), revision = 2, updated_at = ?2
         WHERE player_character_id = ?3 AND revision = 1",
        params![to_json(&patch)?, at, draft.id],
    )?;
    if changed != 1 {
        return Err(CampaignStoreError::InvalidData);
    }
    Ok(())
}

fn insert_session(
    transaction: &Transaction<'_>,
    session: &CharacterCreationSessionView,
) -> Result<(), CampaignStoreError> {
    transaction.execute(
        "INSERT INTO character_creation_sessions (
           id, campaign_id, character_id, schema_version, constitution_revision,
           mode, status, concept_input, draft_json, locked_fields_json,
           generation_record_id, revision, created_at, updated_at, cancelled_at, confirmed_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)",
        params![
            session.id,
            session.campaign_id,
            session.character_id,
            session.schema_version,
            session.constitution_revision,
            session.mode,
            session.status,
            session.concept_input,
            to_json(&session.draft)?,
            to_json(&session.locked_fields)?,
            session.generation_record_id,
            session.revision,
            session.created_at,
            session.updated_at,
            session.cancelled_at,
            session.confirmed_at,
        ],
    )?;
    Ok(())
}

fn update_session(
    transaction: &Transaction<'_>,
    session: &CharacterCreationSessionView,
    expected_revision: i64,
) -> Result<(), CampaignStoreError> {
    let changed = transaction.execute(
        "UPDATE character_creation_sessions SET
           mode = ?1, status = ?2, concept_input = ?3, draft_json = ?4,
           locked_fields_json = ?5, generation_record_id = ?6, revision = ?7,
           updated_at = ?8, cancelled_at = ?9, confirmed_at = ?10
         WHERE id = ?11 AND campaign_id = ?12 AND revision = ?13",
        params![
            session.mode,
            session.status,
            session.concept_input,
            to_json(&session.draft)?,
            to_json(&session.locked_fields)?,
            session.generation_record_id,
            session.revision,
            session.updated_at,
            session.cancelled_at,
            session.confirmed_at,
            session.id,
            session.campaign_id,
            expected_revision,
        ],
    )?;
    if changed != 1 {
        return Err(CampaignStoreError::InvalidState);
    }
    Ok(())
}

fn load_session(
    connection: &Connection,
    campaign_id: &str,
) -> Result<Option<CharacterCreationSessionView>, CampaignStoreError> {
    connection
        .query_row(
            "SELECT id, campaign_id, character_id, schema_version, constitution_revision,
                    mode, status, concept_input, draft_json, locked_fields_json,
                    generation_record_id, revision, created_at, updated_at, cancelled_at, confirmed_at
             FROM character_creation_sessions WHERE campaign_id = ?1",
            [campaign_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, i64>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, String>(6)?,
                    row.get::<_, Option<String>>(7)?,
                    row.get::<_, String>(8)?,
                    row.get::<_, String>(9)?,
                    row.get::<_, Option<String>>(10)?,
                    row.get::<_, i64>(11)?,
                    row.get::<_, String>(12)?,
                    row.get::<_, String>(13)?,
                    row.get::<_, Option<String>>(14)?,
                    row.get::<_, Option<String>>(15)?,
                ))
            },
        )
        .optional()?
        .map(|value| {
            Ok(CharacterCreationSessionView {
                kind: "CHARACTER_CREATION_SESSION".to_owned(),
                schema_version: value.3,
                id: value.0,
                campaign_id: value.1,
                character_id: value.2,
                constitution_revision: value.4,
                mode: value.5,
                status: value.6,
                concept_input: value.7,
                draft: serde_json::from_str(&value.8)
                    .map_err(|_| CampaignStoreError::InvalidData)?,
                locked_fields: serde_json::from_str(&value.9)
                    .map_err(|_| CampaignStoreError::InvalidData)?,
                generation_record_id: value.10,
                revision: value.11,
                created_at: value.12,
                updated_at: value.13,
                cancelled_at: value.14,
                confirmed_at: value.15,
            })
        })
        .transpose()
}

fn load_definition_values(
    connection: &Connection,
    campaign_id: &str,
) -> Result<Vec<Value>, CampaignStoreError> {
    let mut statement = connection.prepare(
        "SELECT definition_json FROM character_extension_definitions
         WHERE campaign_id = ?1 ORDER BY namespace LIMIT 17",
    )?;
    let values = statement
        .query_map([campaign_id], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    if values.len() > 16 {
        return Err(CampaignStoreError::InvalidData);
    }
    values
        .into_iter()
        .map(|value| serde_json::from_str(&value).map_err(|_| CampaignStoreError::InvalidData))
        .collect()
}

fn load_definitions(
    connection: &Connection,
    campaign_id: &str,
) -> Result<Vec<ExtensionDefinition>, CampaignStoreError> {
    let constitution_revision = locked_constitution_revision(connection, campaign_id)?;
    load_definition_values(connection, campaign_id)?
        .into_iter()
        .map(|value| {
            let definition: ExtensionDefinition =
                serde_json::from_value(value).map_err(|_| CampaignStoreError::InvalidData)?;
            if definition.kind != "WORLD_CHARACTER_EXTENSION_DEFINITION"
                || definition.schema_version != 1
                || definition.campaign_id != campaign_id
                || definition.constitution_revision != constitution_revision
                || definition.fields.is_empty()
                || definition.fields.len() > 32
                || definition.revision < 1
                || definition.display_name.trim().is_empty()
            {
                return Err(CampaignStoreError::InvalidData);
            }
            validate_timestamp(&definition.created_at)?;
            validate_timestamp(&definition.updated_at)?;
            Ok(definition)
        })
        .collect()
}

fn load_constitution_context(
    connection: &Connection,
    campaign_id: &str,
) -> Result<Value, CampaignStoreError> {
    connection
        .query_row(
            "SELECT world_type, era, technology, magic, peoples_json, society, politics,
                    economy, combat_scale, death_rules, career_rules, equipment_rules,
                    npc_rules, trait_rules, taboos_json
             FROM world_constitutions WHERE campaign_id = ?1 AND status = 'LOCKED'",
            [campaign_id],
            |row| {
                Ok(json!({
                    "schemaVersion": 1,
                    "worldType": row.get::<_, String>(0)?,
                    "era": row.get::<_, String>(1)?,
                    "technology": row.get::<_, String>(2)?,
                    "magic": row.get::<_, String>(3)?,
                    "peoples": parse_json(&row.get::<_, String>(4)?)?,
                    "society": row.get::<_, String>(5)?,
                    "politics": row.get::<_, String>(6)?,
                    "economy": row.get::<_, String>(7)?,
                    "combatScale": row.get::<_, String>(8)?,
                    "deathRules": row.get::<_, String>(9)?,
                    "careerRules": row.get::<_, String>(10)?,
                    "equipmentRules": row.get::<_, String>(11)?,
                    "npcRules": row.get::<_, String>(12)?,
                    "traitRules": row.get::<_, String>(13)?,
                    "taboos": parse_json(&row.get::<_, String>(14)?)?,
                }))
            },
        )
        .optional()?
        .ok_or(CampaignStoreError::InvalidState)
}

fn locked_constitution_revision(
    connection: &Connection,
    campaign_id: &str,
) -> Result<i64, CampaignStoreError> {
    connection
        .query_row(
            "SELECT revision FROM world_constitutions
             WHERE campaign_id = ?1 AND status = 'LOCKED'",
            [campaign_id],
            |row| row.get(0),
        )
        .optional()?
        .ok_or(CampaignStoreError::InvalidState)
}

fn require_creation_campaign(
    connection: &Connection,
    campaign_id: &str,
) -> Result<(), CampaignStoreError> {
    let state = connection
        .query_row(
            "SELECT state FROM campaigns WHERE id = ?1",
            [campaign_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .ok_or(CampaignStoreError::NotFound)?;
    if state != "CREATING_CHARACTER" {
        return Err(CampaignStoreError::InvalidState);
    }
    Ok(())
}

fn character_exists(
    connection: &Connection,
    campaign_id: &str,
) -> Result<bool, CampaignStoreError> {
    Ok(connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM player_characters WHERE campaign_id = ?1)",
        [campaign_id],
        |row| row.get::<_, i64>(0),
    )? == 1)
}

fn replayed_quick_generation(
    connection: &Connection,
    campaign_id: &str,
    idempotency_key: &str,
) -> Result<Option<String>, CampaignStoreError> {
    let row = connection
        .query_row(
            "SELECT campaign_id, status FROM pending_ai_requests WHERE idempotency_key = ?1",
            [idempotency_key],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()?;
    match row {
        None => Ok(None),
        Some((stored_campaign, status))
            if stored_campaign == campaign_id && status == "COMMITTED" =>
        {
            Ok(Some(stored_campaign))
        }
        Some(_) => Err(CampaignStoreError::InvalidState),
    }
}

fn validate_mode(value: &str) -> Result<(), CampaignStoreError> {
    if ["QUICK", "ADVANCED"].contains(&value) {
        Ok(())
    } else {
        Err(CampaignStoreError::InvalidData)
    }
}

fn validate_boundaries(value: &UniversalCharacterBoundaries) -> Result<(), CampaignStoreError> {
    validate_text_list(&value.excluded_content, 128, 4_000, false)
}

fn narrative_trait_point_profile() -> TraitPointProfile {
    TraitPointProfile {
        trait_type: "NARRATIVE".to_owned(),
        positive_effect: None,
        negative_effect: None,
        buff_points: 0,
        debuff_points: 0,
        positive_balance: None,
        negative_balance: None,
    }
}

fn validate_trait_point_profile(
    value: Option<&TraitPointProfile>,
    complete: bool,
) -> Result<i64, CampaignStoreError> {
    let narrative = narrative_trait_point_profile();
    let profile = value.unwrap_or(&narrative);
    validate_optional_text(profile.positive_effect.as_deref(), 4_000)?;
    validate_optional_text(profile.negative_effect.as_deref(), 4_000)?;
    let valid = match profile.trait_type.as_str() {
        "BUFF" => {
            profile.positive_effect.is_some()
                && profile.negative_effect.is_none()
                && (-5..=-1).contains(&profile.buff_points)
                && profile.debuff_points == 0
                && profile.negative_balance.is_none()
        }
        "DEBUFF" => {
            profile.positive_effect.is_none()
                && profile.negative_effect.is_some()
                && profile.buff_points == 0
                && (1..=5).contains(&profile.debuff_points)
                && profile.positive_balance.is_none()
        }
        "MIXED" => {
            profile.positive_effect.is_some()
                && profile.negative_effect.is_some()
                && (-5..=-1).contains(&profile.buff_points)
                && (1..=5).contains(&profile.debuff_points)
        }
        "NARRATIVE" => {
            profile.positive_effect.is_none()
                && profile.negative_effect.is_none()
                && profile.buff_points == 0
                && profile.debuff_points == 0
                && profile.positive_balance.is_none()
                && profile.negative_balance.is_none()
        }
        _ => false,
    };
    if !valid {
        return Err(CampaignStoreError::InvalidData);
    }
    if let Some(balance) = profile.positive_balance.as_ref() {
        let recommended = validate_trait_balance_declaration(balance)?;
        if complete && -profile.buff_points != recommended {
            return Err(CampaignStoreError::InvalidData);
        }
    } else if complete && matches!(profile.trait_type.as_str(), "BUFF" | "MIXED") {
        return Err(CampaignStoreError::InvalidData);
    }
    if let Some(balance) = profile.negative_balance.as_ref() {
        let recommended = validate_trait_balance_declaration(balance)?;
        if complete && profile.debuff_points != recommended {
            return Err(CampaignStoreError::InvalidData);
        }
    } else if complete && matches!(profile.trait_type.as_str(), "DEBUFF" | "MIXED") {
        return Err(CampaignStoreError::InvalidData);
    }
    Ok(profile.buff_points + profile.debuff_points)
}

fn validate_trait_balance_declaration(
    value: &TraitEffectBalanceDeclaration,
) -> Result<i64, CampaignStoreError> {
    let scores = [
        enum_index(
            &value.frequency,
            &["RARE", "OCCASIONAL", "COMMON", "CONSTANT"],
        )?,
        enum_index(
            &value.environment,
            &["SINGLE_SCENE", "LIMITED", "BROAD", "UNIVERSAL"],
        )?,
        enum_index(&value.combat, &["NONE", "MINOR", "MAJOR", "DOMINANT"])?,
        enum_index(&value.social, &["NONE", "MINOR", "MAJOR", "DOMINANT"])?,
        enum_index(&value.narrative, &["NONE", "MINOR", "MAJOR", "DOMINANT"])?,
        enum_index(&value.economy, &["NONE", "MINOR", "MAJOR", "DOMINANT"])?,
        enum_index(
            &value.permanence,
            &["MOMENTARY", "SCENE", "PERSISTENT", "PERMANENT"],
        )?,
        enum_index(
            &value.avoidability,
            &["EASY", "COSTLY", "HARD", "IMPOSSIBLE"],
        )?,
        enum_index(&value.rarity, &["COMMON", "UNCOMMON", "RARE", "UNIQUE"])?,
        enum_index(
            &value.condition,
            &["STRICT", "SPECIFIC", "BROAD", "UNCONDITIONAL"],
        )?,
    ];
    if scores[2..=5].iter().all(|score| *score == 0) {
        return Err(CampaignStoreError::InvalidData);
    }
    validate_trait_tags(&value.mechanic_tags, false)?;
    validate_trait_tags(&value.grants_tags, true)?;
    validate_trait_tags(&value.requires_tags, true)?;
    validate_trait_tags(&value.neutralizes_tags, true)?;
    if (value.condition == "UNCONDITIONAL") != value.requires_tags.is_empty() {
        return Err(CampaignStoreError::InvalidData);
    }
    Ok((scores.iter().sum::<i64>() / 6 + 1).min(5))
}

fn validate_trait_tags(values: &[String], allow_empty: bool) -> Result<(), CampaignStoreError> {
    if values.len() > 8 || (!allow_empty && values.is_empty()) {
        return Err(CampaignStoreError::InvalidData);
    }
    let mut unique = HashSet::new();
    for value in values {
        if value.trim() != value
            || value.is_empty()
            || value.chars().count() > 48
            || !value
                .chars()
                .all(|character| character.is_alphanumeric() || matches!(character, '_' | '-'))
            || !unique.insert(value)
        {
            return Err(CampaignStoreError::InvalidData);
        }
    }
    Ok(())
}

fn enum_index(value: &str, values: &[&str]) -> Result<i64, CampaignStoreError> {
    values
        .iter()
        .position(|candidate| *candidate == value)
        .map(|index| index as i64)
        .ok_or(CampaignStoreError::InvalidData)
}

fn validate_trait_synergy(traits: &[UniversalCharacterTrait]) -> Result<(), CampaignStoreError> {
    let positives = traits
        .iter()
        .filter_map(|value| value.point_profile.as_ref()?.positive_balance.as_ref())
        .collect::<Vec<_>>();
    let negatives = traits
        .iter()
        .filter_map(|value| value.point_profile.as_ref()?.negative_balance.as_ref())
        .collect::<Vec<_>>();
    for positive in &positives {
        for negative in &negatives {
            if intersects(&positive.neutralizes_tags, &negative.mechanic_tags) {
                return Err(CampaignStoreError::InvalidData);
            }
        }
    }
    let granted = positives
        .iter()
        .flat_map(|value| value.grants_tags.iter().map(String::as_str))
        .collect::<HashSet<_>>();
    for value in &positives {
        let bypassed = value
            .requires_tags
            .iter()
            .any(|tag| granted.contains(tag.as_str()));
        if bypassed {
            let current = validate_trait_balance_declaration(value)?;
            let mut unconditional = (*value).clone();
            unconditional.condition = "UNCONDITIONAL".to_owned();
            unconditional.requires_tags.clear();
            if validate_trait_balance_declaration(&unconditional)? > current {
                return Err(CampaignStoreError::InvalidData);
            }
        }
    }
    for left in 0..positives.len() {
        for right in (left + 1)..positives.len() {
            if intersects(
                &positives[left].grants_tags,
                &positives[right].requires_tags,
            ) && intersects(
                &positives[right].grants_tags,
                &positives[left].requires_tags,
            ) {
                return Err(CampaignStoreError::InvalidData);
            }
        }
    }
    Ok(())
}

fn intersects(left: &[String], right: &[String]) -> bool {
    let right = right.iter().collect::<HashSet<_>>();
    left.iter().any(|value| right.contains(value))
}

fn validate_draft_text(
    value: &str,
    maximum: usize,
    allow_empty: bool,
) -> Result<(), CampaignStoreError> {
    if (!allow_empty && value.is_empty()) || value.trim() != value || value.len() > maximum {
        Err(CampaignStoreError::InvalidData)
    } else {
        Ok(())
    }
}

fn validate_optional_text(value: Option<&str>, maximum: usize) -> Result<(), CampaignStoreError> {
    value.map_or(Ok(()), |text| validate_draft_text(text, maximum, false))
}

fn validate_text_list(
    values: &[String],
    maximum_items: usize,
    maximum_length: usize,
    require_nonempty: bool,
) -> Result<(), CampaignStoreError> {
    if (require_nonempty && values.is_empty())
        || values.len() > maximum_items
        || values
            .iter()
            .any(|value| value.is_empty() || value.trim() != value || value.len() > maximum_length)
        || values.iter().collect::<HashSet<_>>().len() != values.len()
    {
        Err(CampaignStoreError::InvalidData)
    } else {
        Ok(())
    }
}

fn parse_json(value: &str) -> rusqlite::Result<Value> {
    serde_json::from_str(value).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(
            value.len(),
            rusqlite::types::Type::Text,
            Box::new(error),
        )
    })
}

fn to_json(value: &impl Serialize) -> Result<String, CampaignStoreError> {
    serde_json::to_string(value).map_err(|_| CampaignStoreError::InvalidData)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quick_creation_validates_commits_reopens_and_confirms_once() {
        let directory = tempfile::tempdir().expect("temp directory");
        let path = directory.path().join("quick-character.sqlite");
        let store = CampaignStore::open(&path).expect("open");
        seed_campaign(&store, "campaign-quick-v3");
        let started = store
            .start_universal_character_creation(start_command(
                "campaign-quick-v3",
                "QUICK",
                Some("A world-walking scholar."),
            ))
            .expect("start quick");
        let session = started.session.expect("session");
        let audit = quick_audit(&session, &started.constitution);
        let ready = store
            .commit_universal_quick_character(UniversalCharacterQuickCommit {
                campaign_id: session.campaign_id.clone(),
                expected_revision: session.revision,
                generation: audit.clone(),
            })
            .expect("commit quick");
        assert_eq!(
            ready.session.as_ref().map(|value| value.status.as_str()),
            Some("READY_TO_CONFIRM")
        );
        let replayed = store
            .commit_universal_quick_character(UniversalCharacterQuickCommit {
                campaign_id: session.campaign_id.clone(),
                expected_revision: session.revision,
                generation: audit,
            })
            .expect("replay quick");
        assert_eq!(replayed, ready);
        drop(store);

        let reopened = CampaignStore::open(&path).expect("reopen");
        let current = reopened
            .universal_character_creation_snapshot("campaign-quick-v3")
            .expect("restore");
        let revision = current.session.expect("session").revision;
        let confirmed = reopened
            .confirm_universal_character_creation(UniversalCharacterCreationConfirm {
                campaign_id: "campaign-quick-v3".to_owned(),
                expected_revision: revision,
            })
            .expect("confirm");
        assert_eq!(confirmed.campaign_state, "GENERATING_TAVERN");
        assert_eq!(
            confirmed
                .session
                .as_ref()
                .map(|value| value.status.as_str()),
            Some("CONFIRMED")
        );
        let connection = reopened.connect().expect("connection");
        let profile = connection
            .query_row(
                "SELECT profile_json FROM universal_character_profiles WHERE campaign_id = ?1",
                ["campaign-quick-v3"],
                |row| row.get::<_, String>(0),
            )
            .expect("profile");
        let profile: Value = serde_json::from_str(&profile).expect("profile JSON");
        assert_eq!(
            profile.get("nickname").and_then(Value::as_str),
            Some("Ember")
        );
        assert_eq!(profile.get("revision").and_then(Value::as_i64), Some(2));
    }

    #[test]
    fn advanced_session_preserves_locked_fields_and_rejects_revision_bypass() {
        let directory = tempfile::tempdir().expect("temp directory");
        let store =
            CampaignStore::open(directory.path().join("advanced-character.sqlite")).expect("open");
        seed_campaign(&store, "campaign-advanced-v3");
        let started = store
            .start_universal_character_creation(start_command(
                "campaign-advanced-v3",
                "ADVANCED",
                None,
            ))
            .expect("start advanced");
        let mut session = started.session.expect("session");
        let expected = session.revision;
        session.draft.name = "Mira".to_owned();
        session.locked_fields = vec!["name".to_owned()];
        session.revision += 1;
        session.updated_at = session.created_at.clone();
        let saved = store
            .save_universal_character_creation(UniversalCharacterCreationSave {
                campaign_id: session.campaign_id.clone(),
                expected_revision: expected,
                session,
            })
            .expect("save");
        let saved_session = saved.session.expect("saved session");
        assert_ne!(saved_session.updated_at, saved_session.created_at);

        let mut forged_provenance = saved_session.clone();
        forged_provenance.generation_record_id = Some("forged-generation".to_owned());
        forged_provenance.revision += 1;
        assert!(matches!(
            store.save_universal_character_creation(UniversalCharacterCreationSave {
                campaign_id: forged_provenance.campaign_id.clone(),
                expected_revision: saved_session.revision,
                session: forged_provenance,
            }),
            Err(CampaignStoreError::InvalidState)
        ));

        let mut tampered = saved_session;
        let expected = tampered.revision;
        tampered.draft.name = "Another name".to_owned();
        tampered.revision += 1;
        tampered.updated_at = current_timestamp().expect("timestamp");
        assert!(matches!(
            store.save_universal_character_creation(UniversalCharacterCreationSave {
                campaign_id: tampered.campaign_id.clone(),
                expected_revision: expected,
                session: tampered,
            }),
            Err(CampaignStoreError::InvalidData)
        ));
        let restored = store
            .universal_character_creation_snapshot("campaign-advanced-v3")
            .expect("restore")
            .session
            .expect("session");
        assert_eq!(restored.draft.name, "Mira");
        assert_eq!(restored.revision, expected);
    }

    #[test]
    fn trait_points_reject_non_zero_and_allow_an_empty_confirmed_collection() {
        let directory = tempfile::tempdir().expect("temp directory");
        let store =
            CampaignStore::open(directory.path().join("trait-points.sqlite")).expect("open");
        seed_campaign(&store, "campaign-trait-points");
        let started = store
            .start_universal_character_creation(start_command(
                "campaign-trait-points",
                "QUICK",
                Some("A balanced wanderer."),
            ))
            .expect("start");
        let session = started.session.expect("session");
        let ready = store
            .commit_universal_quick_character(UniversalCharacterQuickCommit {
                campaign_id: session.campaign_id.clone(),
                expected_revision: session.revision,
                generation: quick_audit(&session, &started.constitution),
            })
            .expect("generate")
            .session
            .expect("ready session");

        let mut unbalanced = ready.clone();
        unbalanced.draft.traits[0].point_profile = Some(TraitPointProfile {
            trait_type: "BUFF".to_owned(),
            positive_effect: Some("看清黑暗中的道路。".to_owned()),
            negative_effect: None,
            buff_points: -1,
            debuff_points: 0,
            positive_balance: Some(minimal_trait_balance("侦察", "昏暗")),
            negative_balance: None,
        });
        unbalanced.revision += 1;
        assert!(matches!(
            store.save_universal_character_creation(UniversalCharacterCreationSave {
                campaign_id: unbalanced.campaign_id.clone(),
                expected_revision: ready.revision,
                session: unbalanced,
            }),
            Err(CampaignStoreError::InvalidData)
        ));

        let mut balanced = ready;
        balanced.draft.traits[0].point_profile = Some(TraitPointProfile {
            trait_type: "BUFF".to_owned(),
            positive_effect: Some("看清黑暗中的道路。".to_owned()),
            negative_effect: None,
            buff_points: -1,
            debuff_points: 0,
            positive_balance: Some(minimal_trait_balance("侦察", "昏暗")),
            negative_balance: None,
        });
        balanced.draft.traits[1].point_profile = Some(TraitPointProfile {
            trait_type: "DEBUFF".to_owned(),
            positive_effect: None,
            negative_effect: Some("无法忽视求助。".to_owned()),
            buff_points: 0,
            debuff_points: 1,
            positive_balance: None,
            negative_balance: Some(minimal_trait_balance("救援冲动", "求助")),
        });
        balanced.revision += 1;
        let saved_balanced = store
            .save_universal_character_creation(UniversalCharacterCreationSave {
                campaign_id: balanced.campaign_id.clone(),
                expected_revision: balanced.revision - 1,
                session: balanced,
            })
            .expect("save balanced dimensions")
            .session
            .expect("balanced session");

        let mut exploit = saved_balanced.clone();
        exploit
            .draft
            .traits
            .first_mut()
            .and_then(|value| value.point_profile.as_mut())
            .and_then(|value| value.positive_balance.as_mut())
            .expect("positive balance")
            .neutralizes_tags = vec!["救援冲动".to_owned()];
        exploit.revision += 1;
        assert!(matches!(
            store.save_universal_character_creation(UniversalCharacterCreationSave {
                campaign_id: exploit.campaign_id.clone(),
                expected_revision: saved_balanced.revision,
                session: exploit,
            }),
            Err(CampaignStoreError::InvalidData)
        ));

        let mut empty = saved_balanced;
        let expected_revision = empty.revision;
        empty.draft.traits.clear();
        empty.revision += 1;
        let saved = store
            .save_universal_character_creation(UniversalCharacterCreationSave {
                campaign_id: empty.campaign_id.clone(),
                expected_revision,
                session: empty,
            })
            .expect("save empty")
            .session
            .expect("saved empty");
        let confirmed = store
            .confirm_universal_character_creation(UniversalCharacterCreationConfirm {
                campaign_id: saved.campaign_id,
                expected_revision: saved.revision,
            })
            .expect("confirm empty");
        assert!(
            confirmed
                .session
                .expect("confirmed session")
                .draft
                .traits
                .is_empty()
        );
    }

    #[test]
    fn trait_balance_tiers_cover_all_dimensions_with_transparent_boundaries() {
        let low = minimal_trait_balance("线索", "昏暗");
        assert_eq!(
            validate_trait_balance_declaration(&low).expect("low tier"),
            1
        );

        let mut environment = low.clone();
        environment.frequency = "CONSTANT".to_owned();
        environment.environment = "BROAD".to_owned();
        assert_eq!(
            validate_trait_balance_declaration(&environment).expect("environment tier"),
            2
        );

        let mut maximum = low;
        maximum.frequency = "CONSTANT".to_owned();
        maximum.environment = "UNIVERSAL".to_owned();
        maximum.combat = "DOMINANT".to_owned();
        maximum.social = "DOMINANT".to_owned();
        maximum.narrative = "DOMINANT".to_owned();
        maximum.economy = "DOMINANT".to_owned();
        maximum.permanence = "PERMANENT".to_owned();
        maximum.avoidability = "IMPOSSIBLE".to_owned();
        maximum.rarity = "UNIQUE".to_owned();
        maximum.condition = "UNCONDITIONAL".to_owned();
        maximum.requires_tags.clear();
        assert_eq!(
            validate_trait_balance_declaration(&maximum).expect("maximum tier"),
            5
        );

        maximum.requires_tags.push("不应存在".to_owned());
        assert!(matches!(
            validate_trait_balance_declaration(&maximum),
            Err(CampaignStoreError::InvalidData)
        ));
    }

    fn minimal_trait_balance(tag: &str, requirement: &str) -> TraitEffectBalanceDeclaration {
        TraitEffectBalanceDeclaration {
            frequency: "RARE".to_owned(),
            environment: "SINGLE_SCENE".to_owned(),
            combat: "MINOR".to_owned(),
            social: "NONE".to_owned(),
            narrative: "NONE".to_owned(),
            economy: "NONE".to_owned(),
            permanence: "MOMENTARY".to_owned(),
            avoidability: "EASY".to_owned(),
            rarity: "COMMON".to_owned(),
            condition: "STRICT".to_owned(),
            mechanic_tags: vec![tag.to_owned()],
            grants_tags: Vec::new(),
            requires_tags: vec![requirement.to_owned()],
            neutralizes_tags: Vec::new(),
        }
    }

    fn seed_campaign(store: &CampaignStore, id: &str) {
        store
            .create_at(id.to_owned(), "2026-08-20T02:00:00.000Z".to_owned())
            .expect("create campaign");
        let connection = store.connect().expect("connection");
        connection
            .execute(
                "INSERT INTO world_constitutions (
                   campaign_id, schema_version, revision, status, world_type, era, technology,
                   magic, peoples_json, society, politics, economy, combat_scale, death_rules,
                   career_rules, equipment_rules, npc_rules, trait_rules, taboos_json,
                   created_at, updated_at, locked_at
                 ) VALUES (?1, 1, 1, 'LOCKED', 'Low heroic fantasy', 'Late medieval sail age',
                   'Late medieval', 'Magic always leaves a warm trace.', '[\"Coastal humans\"]',
                   'Harbor guilds connect isolated settlements.',
                   'Local councils negotiate with navigation guilds.',
                   'Fishing, coastal trade, and beacon tolls.', 'Personal conflict.',
                   'Death is permanent.', 'Careers arise from local guilds.',
                   'Equipment follows grounded craft.', 'NPC motives follow bounded knowledge.',
                   'Traits require local validation.', '[]', ?2, ?2, ?2)",
                params![id, "2026-08-20T02:00:00.000Z"],
            )
            .expect("constitution");
        connection
            .execute(
                "UPDATE campaigns SET state = 'CREATING_CHARACTER' WHERE id = ?1",
                [id],
            )
            .expect("advance campaign");
        let pool = json!({
            "kind": "CAREER_POOL",
            "schemaVersion": 1,
            "campaignId": id,
            "constitutionRevision": 1,
            "careers": [{
                "kind": "CAREER_DEFINITION",
                "schemaVersion": 1,
                "id": "career-world-walker",
                "campaignId": id,
                "constitutionRevision": 1,
                "name": "World Walker",
                "rarity": "RARE",
                "role": "Maps roads that should not exist.",
                "skills": ["Cartography"],
                "equipmentTags": ["Compass"],
                "socialPosition": "Independent guild scholar",
                "relationshipHooks": ["Owes the harbor academy"],
                "risks": ["Accused of trespass"],
                "requirements": ["Academy training"],
                "constitutionEvidence": {
                    "careerRules": "Careers arise from local guilds.",
                    "society": "Harbor guilds connect isolated settlements.",
                    "technology": "Late medieval",
                    "economy": "Fishing, coastal trade, and beacon tolls."
                },
                "legacyArchetype": "SCHOLAR",
                "source": "INITIAL_GENERATION",
                "generationRecordId": "generation-career-world-walker",
                "createdAt": "2026-08-20T02:00:00.000Z"
            }],
            "revision": 1,
            "createdAt": "2026-08-20T02:00:00.000Z",
            "updatedAt": "2026-08-20T02:00:00.000Z"
        });
        connection
            .execute(
                "INSERT INTO career_pools (
                   campaign_id, schema_version, constitution_revision, pool_json,
                   revision, created_at, updated_at
                 ) VALUES (?1, 1, 1, ?2, 1, ?3, ?3)",
                params![id, pool.to_string(), "2026-08-20T02:00:00.000Z"],
            )
            .expect("career pool");
    }

    fn start_command(
        campaign_id: &str,
        mode: &str,
        concept_input: Option<&str>,
    ) -> UniversalCharacterCreationStart {
        UniversalCharacterCreationStart {
            session_id: format!("session-{campaign_id}"),
            character_id: format!("character-{campaign_id}"),
            campaign_id: campaign_id.to_owned(),
            mode: mode.to_owned(),
            concept_input: concept_input.map(str::to_owned),
            story_preferences: vec!["Exploration".to_owned()],
            content_boundaries: UniversalCharacterBoundaries {
                allow_horror: true,
                allow_permanent_death: false,
                allow_romance: true,
                allow_betrayal: true,
                excluded_content: Vec::new(),
            },
        }
    }

    fn quick_audit(
        session: &CharacterCreationSessionView,
        constitution: &Value,
    ) -> CharacterGenerationAudit {
        let output = quick_output();
        CharacterGenerationAudit {
            request_id: "request-quick-v3".to_owned(),
            generation_record_id: "generation-quick-v3".to_owned(),
            idempotency_key: "character:quick:v3".to_owned(),
            prompt_version: 1,
            input: json!({
                "concept": session.concept_input,
                "storyPreferences": session.draft.story_preferences,
                "contentBoundaries": session.draft.content_boundaries,
                "constitution": constitution,
                "extensionDefinitions": [],
                "careerPool": [{
                    "id": "career-world-walker",
                    "name": "World Walker",
                    "rarity": "RARE",
                    "role": "Maps roads that should not exist.",
                    "requirements": ["Academy training"],
                    "legacyArchetype": "SCHOLAR"
                }],
            }),
            context: json!({
                "sessionId": session.id,
                "characterId": session.character_id,
                "constitutionRevision": session.constitution_revision,
                "lockedFields": session.locked_fields,
            }),
            request: json!({
                "task": "GENERATE_QUICK_CHARACTER",
                "modelName": "ember-fake-v1"
            }),
            raw_response_text: output.to_string(),
            validated_output: output,
        }
    }

    fn quick_output() -> Value {
        json!({
            "name": "Mira Vale",
            "nickname": "Ember",
            "gender": null,
            "age": 27,
            "identity": "A world-walking scholar following a compass that remembers lost roads.",
            "ancestry": "Coastal human",
            "birthplace": "Ash Harbor",
            "socialClass": "Guild apprentice",
            "faith": null,
            "appearance": "A soot-dark coat and a brass compass.",
            "personality": "Curious, measured, and unable to leave a contradiction unexplored.",
            "values": ["Truth", "Safe passage"],
            "goals": ["Find the ember road"],
            "fears": ["Leading companions onto a false path"],
            "secrets": ["The compass answers to her blood"],
            "family": ["The Vale household"],
            "education": ["Harbor Academy cartography"],
            "importantPeople": ["Professor Aven"],
            "enemies": ["The Ash Cartographer"],
            "experiences": ["Survived a skyquake"],
            "career": {
                "id": "career-world-walker",
                "displayName": "World Walker",
                "legacyArchetype": "SCHOLAR"
            },
            "attributePriority": ["knowledge", "agility", "charisma", "physique"],
            "proficiencies": ["Cartography"],
            "abilities": ["Read the road"],
            "languages": ["Common"],
            "traits": [
                {"name": "Observant", "description": "Notices small inconsistencies."},
                {"name": "Restless", "description": "Cannot leave a mystery alone."}
            ],
            "legacyBackground": {
                "birthplace": "Ash Harbor",
                "formativeExperience": "Survived a skyquake while mapping the north road.",
                "adventureMotivation": "Find the ember road before another traveler disappears.",
                "secret": "The compass answers to her blood.",
                "importantPerson": "Professor Aven",
                "tavernArrivalReason": "The compass points beneath Ember Rest."
            },
            "extensions": []
        })
    }
}

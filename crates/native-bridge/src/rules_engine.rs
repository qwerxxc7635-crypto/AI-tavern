use std::collections::{BTreeMap, HashSet};

use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{
    CampaignStore, CampaignStoreError, CharacterAttributes,
    quest_pool::{
        transition_allowed as quest_transition_allowed, transition_quest_pool_in_transaction,
    },
    validate_id, validate_timestamp,
};

const MAX_HIT_POINTS: i64 = 999;
const MAX_MONEY: i64 = 1_000_000_000;
const MAX_GAME_MINUTES: i64 = 9_007_199_254_740_000;
const MAX_RULE_VALUE: i64 = 999_999;
const MAX_SKILLS: usize = 64;
const MAX_STATUSES: usize = 32;
const MAX_EQUIPPED: usize = 16;
const MAX_TRAIT_MODIFIERS: usize = 32;
const MAX_RESOURCES: usize = 32;

type QuestStatusSnapshot = (String, String);
type QuestTransition = (Option<QuestStatusSnapshot>, Option<QuestStatusSnapshot>);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RulesAuthority {
    LocalRule,
    PlayerAction,
    System,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RuleSkill {
    pub key: String,
    pub value: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RuleStatusKind {
    Buff,
    Debuff,
    Neutral,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RuleStatus {
    pub id: String,
    pub kind: RuleStatusKind,
    pub label: String,
    pub attribute_modifiers: BTreeMap<String, i64>,
    pub expires_at_game_minute: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RuleResource {
    pub key: String,
    pub current: i64,
    pub max: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum TraitTargetKind {
    Attribute,
    Skill,
    Resource,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TraitModifierTarget {
    pub kind: TraitTargetKind,
    pub key: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TraitRuleModifier {
    pub trait_id: String,
    pub target: TraitModifierTarget,
    pub modifier: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HitPoints {
    pub current: i64,
    pub max: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CharacterRulesState {
    pub schema_version: i64,
    pub campaign_id: String,
    pub player_character_id: String,
    pub base_attributes: CharacterAttributes,
    pub skills: Vec<RuleSkill>,
    pub hit_points: HitPoints,
    pub statuses: Vec<RuleStatus>,
    pub equipped_item_ids: Vec<String>,
    pub money: i64,
    pub game_time_minutes: i64,
    pub trait_modifiers: Vec<TraitRuleModifier>,
    pub resources: Vec<RuleResource>,
    pub revision: i64,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum RulesAction {
    TakeDamage {
        amount: i64,
    },
    RecoverHp {
        amount: i64,
    },
    DefineSkill {
        skill: RuleSkill,
    },
    ChangeSkill {
        #[serde(rename = "skillKey")]
        skill_key: String,
        delta: i64,
    },
    AddStatus {
        status: RuleStatus,
    },
    RemoveStatus {
        #[serde(rename = "statusId")]
        status_id: String,
    },
    EquipItem {
        #[serde(rename = "itemId")]
        item_id: String,
    },
    UnequipItem {
        #[serde(rename = "itemId")]
        item_id: String,
    },
    ChangeMoney {
        delta: i64,
    },
    AdvanceTime {
        minutes: i64,
    },
    DefineResource {
        resource: RuleResource,
    },
    ChangeResource {
        #[serde(rename = "resourceKey")]
        resource_key: String,
        delta: i64,
    },
    SetTraitModifier {
        #[serde(rename = "traitId")]
        trait_id: String,
        target: TraitModifierTarget,
        modifier: i64,
    },
    RemoveTraitModifier {
        #[serde(rename = "traitId")]
        trait_id: String,
    },
    TransitionQuest {
        #[serde(rename = "questId")]
        quest_id: String,
        status: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RulesCommand {
    pub campaign_id: String,
    pub player_character_id: String,
    pub authority: RulesAuthority,
    #[serde(flatten)]
    pub action: RulesAction,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RulesApplyCommand {
    pub event_id: String,
    pub idempotency_key: String,
    pub expected_revision: i64,
    pub occurred_at: String,
    pub command: RulesCommand,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RulesCommitStatus {
    Committed,
    AlreadyCommitted,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RulesCommitReceipt {
    pub status: RulesCommitStatus,
    pub event_id: String,
    pub idempotency_key: String,
    pub before_revision: i64,
    pub after_revision: i64,
    pub state: CharacterRulesState,
    pub quest_before_status: Option<String>,
    pub quest_after_status: Option<String>,
    pub occurred_at: String,
}

impl CampaignStore {
    pub fn character_rules_state(
        &self,
        player_character_id: &str,
    ) -> Result<CharacterRulesState, CampaignStoreError> {
        validate_id(player_character_id)?;
        let connection = self.connect()?;
        load_state(&connection, player_character_id)?.ok_or(CampaignStoreError::NotFound)
    }

    pub fn apply_rules_command(
        &self,
        input: RulesApplyCommand,
    ) -> Result<RulesCommitReceipt, CampaignStoreError> {
        validate_id(&input.event_id)?;
        validate_id(&input.idempotency_key)?;
        validate_id(&input.command.campaign_id)?;
        validate_id(&input.command.player_character_id)?;
        validate_timestamp(&input.occurred_at)?;
        if input.expected_revision < 1 {
            return Err(CampaignStoreError::InvalidData);
        }
        let command_json = canonical_json(&input.command)?;
        let mut connection = self.connect()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        if let Some((stored_command, campaign_id, character_id)) = transaction
            .query_row(
                "SELECT command_json, campaign_id, player_character_id
                 FROM rules_events WHERE idempotency_key = ?1",
                [&input.idempotency_key],
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
            if stored_command != command_json
                || campaign_id != input.command.campaign_id
                || character_id != input.command.player_character_id
            {
                return Err(CampaignStoreError::InvalidData);
            }
            let receipt = load_receipt(
                &transaction,
                &input.idempotency_key,
                RulesCommitStatus::AlreadyCommitted,
            )?
            .ok_or(CampaignStoreError::InvalidData)?;
            transaction.commit()?;
            return Ok(receipt);
        }

        let before = load_state(&transaction, &input.command.player_character_id)?
            .ok_or(CampaignStoreError::NotFound)?;
        if before.campaign_id != input.command.campaign_id
            || before.revision != input.expected_revision
        {
            return Err(CampaignStoreError::InvalidState);
        }
        let mut after = before.clone();
        let (quest_before, quest_after) =
            apply_action(&transaction, &mut after, &input.command, &input.occurred_at)?;
        after.revision = before
            .revision
            .checked_add(1)
            .ok_or(CampaignStoreError::InvalidData)?;
        after.updated_at.clone_from(&input.occurred_at);
        validate_state(&after)?;

        let changed = transaction.execute(
            "UPDATE character_rule_states SET
               skills_json = ?1, hp_current = ?2, hp_max = ?3, statuses_json = ?4,
               equipped_item_ids_json = ?5, money = ?6, game_time_minutes = ?7,
               trait_modifiers_json = ?8, resources_json = ?9, revision = ?10, updated_at = ?11
             WHERE player_character_id = ?12 AND campaign_id = ?13 AND revision = ?14",
            params![
                json(&after.skills)?,
                after.hit_points.current,
                after.hit_points.max,
                json(&after.statuses)?,
                json(&after.equipped_item_ids)?,
                after.money,
                after.game_time_minutes,
                json(&after.trait_modifiers)?,
                json(&after.resources)?,
                after.revision,
                after.updated_at,
                after.player_character_id,
                after.campaign_id,
                before.revision,
            ],
        )?;
        if changed != 1 {
            return Err(CampaignStoreError::InvalidState);
        }
        if let Some((quest_id, status)) = &quest_after {
            transition_quest_pool_in_transaction(
                &transaction,
                &input.command.campaign_id,
                quest_id,
                None,
                quest_before.as_ref().map(|(_, value)| value.as_str()),
                status,
                "LOCAL_RULE",
                "Rules Engine applied a validated quest transition",
                &format!("quest:rules:{}", input.idempotency_key),
                &input.occurred_at,
            )?;
        }

        transaction.execute(
            "INSERT INTO rules_events (
               id, campaign_id, player_character_id, idempotency_key, source, command_kind,
               command_json, before_revision, after_revision, state_before_json, state_after_json,
               quest_before_status, quest_after_status, occurred_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
            params![
                input.event_id,
                input.command.campaign_id,
                input.command.player_character_id,
                input.idempotency_key,
                authority_name(input.command.authority),
                action_name(&input.command.action),
                command_json,
                before.revision,
                after.revision,
                json(&before)?,
                json(&after)?,
                quest_before.as_ref().map(|(_, status)| status),
                quest_after.as_ref().map(|(_, status)| status),
                input.occurred_at,
            ],
        )?;
        let receipt = RulesCommitReceipt {
            status: RulesCommitStatus::Committed,
            event_id: input.event_id,
            idempotency_key: input.idempotency_key,
            before_revision: before.revision,
            after_revision: after.revision,
            state: after,
            quest_before_status: quest_before.map(|(_, status)| status),
            quest_after_status: quest_after.map(|(_, status)| status),
            occurred_at: input.occurred_at,
        };
        transaction.commit()?;
        Ok(receipt)
    }
}

fn apply_action(
    connection: &Connection,
    state: &mut CharacterRulesState,
    command: &RulesCommand,
    occurred_at: &str,
) -> Result<QuestTransition, CampaignStoreError> {
    let no_quest = || Ok((None, None));
    match &command.action {
        RulesAction::TakeDamage { amount } => {
            positive(*amount)?;
            let current = state.hit_points.current.saturating_sub(*amount).max(0);
            if current == state.hit_points.current {
                return Err(CampaignStoreError::InvalidState);
            }
            state.hit_points.current = current;
            no_quest()
        }
        RulesAction::RecoverHp { amount } => {
            positive(*amount)?;
            let current = state
                .hit_points
                .current
                .checked_add(*amount)
                .unwrap_or(i64::MAX)
                .min(state.hit_points.max);
            if current == state.hit_points.current {
                return Err(CampaignStoreError::InvalidState);
            }
            state.hit_points.current = current;
            no_quest()
        }
        RulesAction::DefineSkill { skill } => {
            require_system(command.authority)?;
            validate_skill(skill)?;
            if state.skills.len() >= MAX_SKILLS
                || state.skills.iter().any(|item| item.key == skill.key)
            {
                return Err(CampaignStoreError::InvalidData);
            }
            state.skills.push(skill.clone());
            no_quest()
        }
        RulesAction::ChangeSkill { skill_key, delta } => {
            unit_delta(*delta)?;
            let skill = state
                .skills
                .iter_mut()
                .find(|skill| skill.key == *skill_key)
                .ok_or(CampaignStoreError::NotFound)?;
            skill.value = skill
                .value
                .checked_add(*delta)
                .ok_or(CampaignStoreError::InvalidData)?;
            within(skill.value, 0, 20)?;
            no_quest()
        }
        RulesAction::AddStatus { status } => {
            validate_status(status)?;
            if status
                .expires_at_game_minute
                .is_some_and(|expiry| expiry <= state.game_time_minutes)
                || state.statuses.len() >= MAX_STATUSES
                || state.statuses.iter().any(|item| item.id == status.id)
            {
                return Err(CampaignStoreError::InvalidData);
            }
            state.statuses.push(status.clone());
            no_quest()
        }
        RulesAction::RemoveStatus { status_id } => {
            validate_id(status_id)?;
            let previous = state.statuses.len();
            state.statuses.retain(|status| status.id != *status_id);
            if state.statuses.len() == previous {
                return Err(CampaignStoreError::NotFound);
            }
            no_quest()
        }
        RulesAction::EquipItem { item_id } => {
            validate_id(item_id)?;
            let owned = connection
                .query_row(
                    "SELECT 1 FROM items
                     WHERE id = ?1 AND campaign_id = ?2 AND owner_character_id = ?3",
                    params![item_id, state.campaign_id, state.player_character_id],
                    |_| Ok(()),
                )
                .optional()?
                .is_some();
            if !owned
                || state.equipped_item_ids.len() >= MAX_EQUIPPED
                || state.equipped_item_ids.contains(item_id)
            {
                return Err(CampaignStoreError::InvalidState);
            }
            state.equipped_item_ids.push(item_id.clone());
            no_quest()
        }
        RulesAction::UnequipItem { item_id } => {
            let previous = state.equipped_item_ids.len();
            state.equipped_item_ids.retain(|id| id != item_id);
            if previous == state.equipped_item_ids.len() {
                return Err(CampaignStoreError::NotFound);
            }
            no_quest()
        }
        RulesAction::ChangeMoney { delta } => {
            bounded_delta(*delta)?;
            state.money = state
                .money
                .checked_add(*delta)
                .ok_or(CampaignStoreError::InvalidData)?;
            within(state.money, 0, MAX_MONEY)?;
            no_quest()
        }
        RulesAction::AdvanceTime { minutes } => {
            within(*minutes, 1, 10_080)?;
            state.game_time_minutes = state
                .game_time_minutes
                .checked_add(*minutes)
                .ok_or(CampaignStoreError::InvalidData)?;
            within(state.game_time_minutes, 0, MAX_GAME_MINUTES)?;
            state.statuses.retain(|status| {
                status
                    .expires_at_game_minute
                    .is_none_or(|expiry| expiry > state.game_time_minutes)
            });
            no_quest()
        }
        RulesAction::DefineResource { resource } => {
            require_system(command.authority)?;
            validate_resource(resource)?;
            if state.resources.len() >= MAX_RESOURCES
                || state.resources.iter().any(|item| item.key == resource.key)
            {
                return Err(CampaignStoreError::InvalidData);
            }
            state.resources.push(resource.clone());
            no_quest()
        }
        RulesAction::ChangeResource {
            resource_key,
            delta,
        } => {
            bounded_delta(*delta)?;
            let modifier = state
                .trait_modifiers
                .iter()
                .filter(|item| {
                    item.target.kind == TraitTargetKind::Resource
                        && item.target.key == *resource_key
                })
                .map(|item| item.modifier)
                .sum::<i64>();
            let resource = state
                .resources
                .iter_mut()
                .find(|resource| resource.key == *resource_key)
                .ok_or(CampaignStoreError::NotFound)?;
            let max = resource.max.saturating_add(modifier).max(0);
            resource.current = resource
                .current
                .checked_add(*delta)
                .ok_or(CampaignStoreError::InvalidData)?;
            within(resource.current, 0, max)?;
            no_quest()
        }
        RulesAction::SetTraitModifier {
            trait_id,
            target,
            modifier,
        } => {
            require_system(command.authority)?;
            let value = TraitRuleModifier {
                trait_id: trait_id.clone(),
                target: target.clone(),
                modifier: *modifier,
            };
            validate_trait_modifier(&value)?;
            let existing = state
                .trait_modifiers
                .iter_mut()
                .find(|item| item.trait_id == *trait_id && item.target == *target);
            if let Some(existing) = existing {
                *existing = value;
            } else {
                if state.trait_modifiers.len() >= MAX_TRAIT_MODIFIERS {
                    return Err(CampaignStoreError::InvalidData);
                }
                state.trait_modifiers.push(value);
            }
            no_quest()
        }
        RulesAction::RemoveTraitModifier { trait_id } => {
            require_system(command.authority)?;
            let previous = state.trait_modifiers.len();
            state
                .trait_modifiers
                .retain(|modifier| modifier.trait_id != *trait_id);
            if previous == state.trait_modifiers.len() {
                return Err(CampaignStoreError::NotFound);
            }
            no_quest()
        }
        RulesAction::TransitionQuest { quest_id, status } => {
            validate_id(quest_id)?;
            validate_quest_status(status)?;
            let before = connection
                .query_row(
                    "SELECT status FROM quest_pool_states WHERE quest_id = ?1 AND campaign_id = ?2",
                    params![quest_id, state.campaign_id],
                    |row| row.get::<_, String>(0),
                )
                .optional()?
                .ok_or(CampaignStoreError::NotFound)?;
            if !quest_transition_allowed(&before, status) {
                return Err(CampaignStoreError::InvalidState);
            }
            validate_timestamp(occurred_at)?;
            Ok((
                Some((quest_id.clone(), before)),
                Some((quest_id.clone(), status.clone())),
            ))
        }
    }
}

pub(crate) fn load_state(
    connection: &Connection,
    player_character_id: &str,
) -> Result<Option<CharacterRulesState>, CampaignStoreError> {
    let state = connection
        .query_row(
            "SELECT schema_version, campaign_id, player_character_id, base_attributes_json,
                    skills_json, hp_current, hp_max, statuses_json, equipped_item_ids_json,
                    money, game_time_minutes, trait_modifiers_json, resources_json,
                    revision, updated_at
             FROM character_rule_states WHERE player_character_id = ?1",
            [player_character_id],
            |row| {
                let attributes_json = row.get::<_, String>(3)?;
                let skills_json = row.get::<_, String>(4)?;
                let statuses_json = row.get::<_, String>(7)?;
                let equipped_json = row.get::<_, String>(8)?;
                let traits_json = row.get::<_, String>(11)?;
                let resources_json = row.get::<_, String>(12)?;
                Ok(CharacterRulesState {
                    schema_version: row.get(0)?,
                    campaign_id: row.get(1)?,
                    player_character_id: row.get(2)?,
                    base_attributes: parse_json(&attributes_json)?,
                    skills: parse_json(&skills_json)?,
                    hit_points: HitPoints {
                        current: row.get(5)?,
                        max: row.get(6)?,
                    },
                    statuses: parse_json(&statuses_json)?,
                    equipped_item_ids: parse_json(&equipped_json)?,
                    money: row.get(9)?,
                    game_time_minutes: row.get(10)?,
                    trait_modifiers: parse_json(&traits_json)?,
                    resources: parse_json(&resources_json)?,
                    revision: row.get(13)?,
                    updated_at: row.get(14)?,
                })
            },
        )
        .optional()?;
    if let Some(state) = &state {
        validate_state(state)?;
    }
    Ok(state)
}

pub(crate) fn character_check_modifiers(
    connection: &Connection,
    campaign_id: &str,
    attribute: &str,
) -> Result<(i64, i64), CampaignStoreError> {
    if !attribute_name(attribute) {
        return Err(CampaignStoreError::InvalidData);
    }
    let player_character_id = connection
        .query_row(
            "SELECT player_character_id FROM character_rule_states WHERE campaign_id = ?1",
            [campaign_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .ok_or(CampaignStoreError::NotFound)?;
    let state =
        load_state(connection, &player_character_id)?.ok_or(CampaignStoreError::NotFound)?;
    let attribute_value = match attribute {
        "physique" => state.base_attributes.physique,
        "agility" => state.base_attributes.agility,
        "knowledge" => state.base_attributes.knowledge,
        "charisma" => state.base_attributes.charisma,
        _ => return Err(CampaignStoreError::InvalidData),
    };
    let status_modifier = state
        .statuses
        .iter()
        .filter_map(|status| status.attribute_modifiers.get(attribute))
        .chain(state.trait_modifiers.iter().filter_map(|modifier| {
            (modifier.target.kind == TraitTargetKind::Attribute && modifier.target.key == attribute)
                .then_some(&modifier.modifier)
        }))
        .try_fold(0_i64, |sum, modifier| {
            sum.checked_add(*modifier)
                .ok_or(CampaignStoreError::InvalidData)
        })?;
    Ok((attribute_value, status_modifier))
}

fn load_receipt(
    connection: &Connection,
    key: &str,
    status: RulesCommitStatus,
) -> Result<Option<RulesCommitReceipt>, CampaignStoreError> {
    connection
        .query_row(
            "SELECT id, idempotency_key, before_revision, after_revision, state_after_json,
                    quest_before_status, quest_after_status, occurred_at
             FROM rules_events WHERE idempotency_key = ?1",
            [key],
            |row| {
                let state_json = row.get::<_, String>(4)?;
                Ok(RulesCommitReceipt {
                    status,
                    event_id: row.get(0)?,
                    idempotency_key: row.get(1)?,
                    before_revision: row.get(2)?,
                    after_revision: row.get(3)?,
                    state: parse_json(&state_json)?,
                    quest_before_status: row.get(5)?,
                    quest_after_status: row.get(6)?,
                    occurred_at: row.get(7)?,
                })
            },
        )
        .optional()
        .map_err(Into::into)
}

fn validate_state(state: &CharacterRulesState) -> Result<(), CampaignStoreError> {
    if state.schema_version != 1
        || state.revision < 1
        || state.hit_points.max < 1
        || state.hit_points.max > MAX_HIT_POINTS
        || !(0..=state.hit_points.max).contains(&state.hit_points.current)
        || !(0..=MAX_MONEY).contains(&state.money)
        || !(0..=MAX_GAME_MINUTES).contains(&state.game_time_minutes)
        || state.skills.len() > MAX_SKILLS
        || state.statuses.len() > MAX_STATUSES
        || state.equipped_item_ids.len() > MAX_EQUIPPED
        || state.trait_modifiers.len() > MAX_TRAIT_MODIFIERS
        || state.resources.len() > MAX_RESOURCES
    {
        return Err(CampaignStoreError::InvalidData);
    }
    validate_id(&state.campaign_id)?;
    validate_id(&state.player_character_id)?;
    validate_timestamp(&state.updated_at)?;
    validate_attributes(&state.base_attributes)?;
    unique(&state.skills, |value| &value.key)?;
    for skill in &state.skills {
        validate_skill(skill)?;
    }
    unique(&state.statuses, |value| &value.id)?;
    for status in &state.statuses {
        validate_status(status)?;
    }
    unique(&state.equipped_item_ids, |value| value)?;
    unique(&state.resources, |value| &value.key)?;
    for resource in &state.resources {
        validate_resource(resource)?;
        let modifier = state
            .trait_modifiers
            .iter()
            .filter(|item| {
                item.target.kind == TraitTargetKind::Resource && item.target.key == resource.key
            })
            .map(|item| item.modifier)
            .sum::<i64>();
        if resource.current > resource.max.saturating_add(modifier).max(0) {
            return Err(CampaignStoreError::InvalidData);
        }
    }
    let mut trait_keys = HashSet::new();
    for modifier in &state.trait_modifiers {
        validate_trait_modifier(modifier)?;
        match modifier.target.kind {
            TraitTargetKind::Skill
                if !state
                    .skills
                    .iter()
                    .any(|skill| skill.key == modifier.target.key) =>
            {
                return Err(CampaignStoreError::InvalidData);
            }
            TraitTargetKind::Resource
                if !state
                    .resources
                    .iter()
                    .any(|resource| resource.key == modifier.target.key) =>
            {
                return Err(CampaignStoreError::InvalidData);
            }
            _ => {}
        }
        if !trait_keys.insert(format!(
            "{}:{:?}:{}",
            modifier.trait_id, modifier.target.kind, modifier.target.key
        )) {
            return Err(CampaignStoreError::InvalidData);
        }
    }
    for skill in &state.skills {
        let modifier = state
            .trait_modifiers
            .iter()
            .filter(|item| {
                item.target.kind == TraitTargetKind::Skill && item.target.key == skill.key
            })
            .map(|item| item.modifier)
            .sum::<i64>();
        within(skill.value.saturating_add(modifier), 0, 20)?;
    }
    Ok(())
}

fn validate_attributes(value: &CharacterAttributes) -> Result<(), CampaignStoreError> {
    let values = [
        value.physique,
        value.agility,
        value.knowledge,
        value.charisma,
    ];
    if values.iter().any(|value| !(1..=5).contains(value)) || values.iter().sum::<i64>() != 10 {
        return Err(CampaignStoreError::InvalidData);
    }
    Ok(())
}

fn validate_skill(value: &RuleSkill) -> Result<(), CampaignStoreError> {
    validate_key(&value.key)?;
    within(value.value, 0, 20)
}

fn validate_status(value: &RuleStatus) -> Result<(), CampaignStoreError> {
    validate_id(&value.id)?;
    if value.label.is_empty() || value.label.trim() != value.label || value.label.len() > 128 {
        return Err(CampaignStoreError::InvalidData);
    }
    if value
        .expires_at_game_minute
        .is_some_and(|expiry| !(1..=MAX_GAME_MINUTES).contains(&expiry))
    {
        return Err(CampaignStoreError::InvalidData);
    }
    for (key, modifier) in &value.attribute_modifiers {
        if !attribute_name(key) || !(-5..=5).contains(modifier) || *modifier == 0 {
            return Err(CampaignStoreError::InvalidData);
        }
    }
    Ok(())
}

fn validate_resource(value: &RuleResource) -> Result<(), CampaignStoreError> {
    validate_key(&value.key)?;
    within(value.max, 1, MAX_RULE_VALUE)?;
    within(value.current, 0, value.max)
}

fn validate_trait_modifier(value: &TraitRuleModifier) -> Result<(), CampaignStoreError> {
    validate_id(&value.trait_id)?;
    if value.modifier == 0 || !(-5..=5).contains(&value.modifier) {
        return Err(CampaignStoreError::InvalidData);
    }
    match value.target.kind {
        TraitTargetKind::Attribute if attribute_name(&value.target.key) => Ok(()),
        TraitTargetKind::Skill | TraitTargetKind::Resource => validate_key(&value.target.key),
        TraitTargetKind::Attribute => Err(CampaignStoreError::InvalidData),
    }
}

fn require_system(authority: RulesAuthority) -> Result<(), CampaignStoreError> {
    if authority == RulesAuthority::PlayerAction {
        Err(CampaignStoreError::InvalidState)
    } else {
        Ok(())
    }
}

fn authority_name(value: RulesAuthority) -> &'static str {
    match value {
        RulesAuthority::LocalRule => "LOCAL_RULE",
        RulesAuthority::PlayerAction => "PLAYER_ACTION",
        RulesAuthority::System => "SYSTEM",
    }
}

fn action_name(value: &RulesAction) -> &'static str {
    match value {
        RulesAction::TakeDamage { .. } => "TAKE_DAMAGE",
        RulesAction::RecoverHp { .. } => "RECOVER_HP",
        RulesAction::DefineSkill { .. } => "DEFINE_SKILL",
        RulesAction::ChangeSkill { .. } => "CHANGE_SKILL",
        RulesAction::AddStatus { .. } => "ADD_STATUS",
        RulesAction::RemoveStatus { .. } => "REMOVE_STATUS",
        RulesAction::EquipItem { .. } => "EQUIP_ITEM",
        RulesAction::UnequipItem { .. } => "UNEQUIP_ITEM",
        RulesAction::ChangeMoney { .. } => "CHANGE_MONEY",
        RulesAction::AdvanceTime { .. } => "ADVANCE_TIME",
        RulesAction::DefineResource { .. } => "DEFINE_RESOURCE",
        RulesAction::ChangeResource { .. } => "CHANGE_RESOURCE",
        RulesAction::SetTraitModifier { .. } => "SET_TRAIT_MODIFIER",
        RulesAction::RemoveTraitModifier { .. } => "REMOVE_TRAIT_MODIFIER",
        RulesAction::TransitionQuest { .. } => "TRANSITION_QUEST",
    }
}

fn validate_quest_status(value: &str) -> Result<(), CampaignStoreError> {
    if [
        "HIDDEN",
        "DISCOVERED",
        "AVAILABLE",
        "ACCEPTED",
        "ACTIVE",
        "BLOCKED",
        "UPDATED",
        "COMPLETED",
        "FAILED",
        "EXPIRED",
        "ABANDONED",
    ]
    .contains(&value)
    {
        Ok(())
    } else {
        Err(CampaignStoreError::InvalidData)
    }
}

fn unique<T>(values: &[T], key: impl Fn(&T) -> &String) -> Result<(), CampaignStoreError> {
    let mut seen = HashSet::new();
    if values.iter().all(|value| seen.insert(key(value))) {
        Ok(())
    } else {
        Err(CampaignStoreError::InvalidData)
    }
}

fn attribute_name(value: &str) -> bool {
    ["physique", "agility", "knowledge", "charisma"].contains(&value)
}

fn validate_key(value: &str) -> Result<(), CampaignStoreError> {
    let valid = !value.is_empty()
        && value.len() <= 64
        && value.as_bytes()[0].is_ascii_lowercase()
        && value.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || b"._-".contains(&byte)
        });
    if valid {
        Ok(())
    } else {
        Err(CampaignStoreError::InvalidData)
    }
}

fn positive(value: i64) -> Result<(), CampaignStoreError> {
    within(value, 1, MAX_RULE_VALUE)
}

fn bounded_delta(value: i64) -> Result<(), CampaignStoreError> {
    if value == 0 || value.unsigned_abs() > MAX_RULE_VALUE as u64 {
        Err(CampaignStoreError::InvalidData)
    } else {
        Ok(())
    }
}

fn unit_delta(value: i64) -> Result<(), CampaignStoreError> {
    if matches!(value, -1 | 1) {
        Ok(())
    } else {
        Err(CampaignStoreError::InvalidData)
    }
}

fn within(value: i64, min: i64, max: i64) -> Result<(), CampaignStoreError> {
    if (min..=max).contains(&value) {
        Ok(())
    } else {
        Err(CampaignStoreError::InvalidData)
    }
}

fn json(value: &impl Serialize) -> Result<String, CampaignStoreError> {
    serde_json::to_string(value).map_err(|_| CampaignStoreError::InvalidData)
}

fn canonical_json(value: &impl Serialize) -> Result<String, CampaignStoreError> {
    let value = serde_json::to_value(value).map_err(|_| CampaignStoreError::InvalidData)?;
    serde_json::to_string(&sort_json(value)).map_err(|_| CampaignStoreError::InvalidData)
}

fn sort_json(value: Value) -> Value {
    match value {
        Value::Array(values) => Value::Array(values.into_iter().map(sort_json).collect()),
        Value::Object(values) => Value::Object(
            values
                .into_iter()
                .map(|(key, value)| (key, sort_json(value)))
                .collect::<BTreeMap<_, _>>()
                .into_iter()
                .collect(),
        ),
        other => other,
    }
}

fn parse_json<T: for<'de> Deserialize<'de>>(value: &str) -> rusqlite::Result<T> {
    serde_json::from_str(value).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(
            value.len(),
            rusqlite::types::Type::Text,
            Box::new(error),
        )
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_rules_commit_is_atomic_idempotent_and_survives_reopen() {
        let directory = tempfile::tempdir().expect("temp directory");
        let path = directory.path().join("rules.sqlite");
        let store = CampaignStore::open(&path).expect("open");
        store
            .create_at(
                "campaign-rules-native".to_owned(),
                "2026-08-14T05:00:00.000Z".to_owned(),
            )
            .expect("campaign");
        insert_character(&store);
        let command = RulesApplyCommand {
            event_id: "rules-event-native".to_owned(),
            idempotency_key: "rules-key-native".to_owned(),
            expected_revision: 1,
            occurred_at: "2026-08-14T05:01:00.000Z".to_owned(),
            command: RulesCommand {
                campaign_id: "campaign-rules-native".to_owned(),
                player_character_id: "character-rules-native".to_owned(),
                authority: RulesAuthority::LocalRule,
                action: RulesAction::ChangeMoney { delta: 25 },
            },
        };
        let committed = store.apply_rules_command(command.clone()).expect("commit");
        assert_eq!(committed.status, RulesCommitStatus::Committed);
        assert_eq!(committed.state.money, 25);
        let replay = store.apply_rules_command(command).expect("replay");
        assert_eq!(replay.status, RulesCommitStatus::AlreadyCommitted);
        assert_eq!(replay.after_revision, 2);
        drop(store);

        let reopened = CampaignStore::open(&path).expect("reopen");
        let state = reopened
            .character_rules_state("character-rules-native")
            .expect("state");
        assert_eq!(state.money, 25);
        assert_eq!(state.revision, 2);
    }

    #[test]
    fn invalid_rule_and_event_collision_roll_back_state() {
        let directory = tempfile::tempdir().expect("temp directory");
        let store = CampaignStore::open(directory.path().join("rules.sqlite")).expect("open");
        store
            .create_at(
                "campaign-rules-native".to_owned(),
                "2026-08-14T05:00:00.000Z".to_owned(),
            )
            .expect("campaign");
        insert_character(&store);
        let base = RulesCommand {
            campaign_id: "campaign-rules-native".to_owned(),
            player_character_id: "character-rules-native".to_owned(),
            authority: RulesAuthority::LocalRule,
            action: RulesAction::TakeDamage { amount: 3 },
        };
        store
            .apply_rules_command(RulesApplyCommand {
                event_id: "rules-event-native".to_owned(),
                idempotency_key: "rules-key-first".to_owned(),
                expected_revision: 1,
                occurred_at: "2026-08-14T05:01:00.000Z".to_owned(),
                command: base,
            })
            .expect("first");
        let collision = store.apply_rules_command(RulesApplyCommand {
            event_id: "rules-event-native".to_owned(),
            idempotency_key: "rules-key-second".to_owned(),
            expected_revision: 2,
            occurred_at: "2026-08-14T05:02:00.000Z".to_owned(),
            command: RulesCommand {
                campaign_id: "campaign-rules-native".to_owned(),
                player_character_id: "character-rules-native".to_owned(),
                authority: RulesAuthority::LocalRule,
                action: RulesAction::ChangeMoney { delta: 50 },
            },
        });
        assert!(collision.is_err());
        let state = store
            .character_rules_state("character-rules-native")
            .expect("state");
        assert_eq!(state.hit_points.current, 7);
        assert_eq!(state.money, 0);
        assert_eq!(state.revision, 2);
    }

    #[test]
    fn d20_modifiers_use_rule_status_traits_and_only_equipped_owned_items() {
        let directory = tempfile::tempdir().expect("temp directory");
        let store = CampaignStore::open(directory.path().join("rules.sqlite")).expect("open");
        store
            .create_at(
                "campaign-rules-native".to_owned(),
                "2026-08-14T05:00:00.000Z".to_owned(),
            )
            .expect("campaign");
        insert_character(&store);
        let connection = store.connect().expect("connect");
        connection
            .execute(
                "INSERT INTO items (
                   id, campaign_id, owner_character_id, source_adventure_id,
                   content_json, reward_tier, effect_json, created_at
                 ) VALUES (?1, ?2, ?3, NULL, ?4, 'BASIC', ?5, ?6)",
                params![
                    "item-rules-native",
                    "campaign-rules-native",
                    "character-rules-native",
                    r#"{"name":"Lens","description":"Clear"}"#,
                    r#"{"kind":"CHECK_MODIFIER","attribute":"knowledge","modifier":2}"#,
                    "2026-08-14T05:00:00.000Z",
                ],
            )
            .expect("item");
        drop(connection);

        apply_test_action(
            &store,
            1,
            "status",
            RulesAuthority::System,
            RulesAction::AddStatus {
                status: RuleStatus {
                    id: "status-focused".to_owned(),
                    kind: RuleStatusKind::Buff,
                    label: "Focused".to_owned(),
                    attribute_modifiers: BTreeMap::from([("knowledge".to_owned(), 1)]),
                    expires_at_game_minute: None,
                },
            },
        );
        apply_test_action(
            &store,
            2,
            "trait",
            RulesAuthority::System,
            RulesAction::SetTraitModifier {
                trait_id: "trait-one".to_owned(),
                target: TraitModifierTarget {
                    kind: TraitTargetKind::Attribute,
                    key: "knowledge".to_owned(),
                },
                modifier: 1,
            },
        );
        apply_test_action(
            &store,
            3,
            "equip",
            RulesAuthority::PlayerAction,
            RulesAction::EquipItem {
                item_id: "item-rules-native".to_owned(),
            },
        );
        let connection = store.connect().expect("connect");
        assert_eq!(
            character_check_modifiers(&connection, "campaign-rules-native", "knowledge")
                .expect("modifiers"),
            (3, 2)
        );
        assert_eq!(
            crate::adventure_play::equipment_modifier(
                &connection,
                "campaign-rules-native",
                "knowledge"
            )
            .expect("equipment modifier"),
            2
        );
    }

    #[test]
    fn native_command_deserialization_rejects_unknown_fields_and_ai_authority() {
        let extra = serde_json::from_value::<RulesCommand>(serde_json::json!({
            "campaignId": "campaign-rules-native",
            "playerCharacterId": "character-rules-native",
            "authority": "LOCAL_RULE",
            "kind": "CHANGE_MONEY",
            "delta": 1,
            "narrativeAmount": 999
        }));
        assert!(extra.is_err());
        let ai = serde_json::from_value::<RulesCommand>(serde_json::json!({
            "campaignId": "campaign-rules-native",
            "playerCharacterId": "character-rules-native",
            "authority": "AI",
            "kind": "CHANGE_MONEY",
            "delta": 1
        }));
        assert!(ai.is_err());
    }

    fn apply_test_action(
        store: &CampaignStore,
        expected_revision: i64,
        suffix: &str,
        authority: RulesAuthority,
        action: RulesAction,
    ) {
        store
            .apply_rules_command(RulesApplyCommand {
                event_id: format!("rules-event-{suffix}"),
                idempotency_key: format!("rules-key-{suffix}"),
                expected_revision,
                occurred_at: format!("2026-08-14T05:0{expected_revision}:00.000Z"),
                command: RulesCommand {
                    campaign_id: "campaign-rules-native".to_owned(),
                    player_character_id: "character-rules-native".to_owned(),
                    authority,
                    action,
                },
            })
            .expect("rules action");
    }

    fn insert_character(store: &CampaignStore) {
        let connection = store.connect().expect("connect");
        connection
            .execute(
                "INSERT INTO player_characters (
                   id, campaign_id, name, gender, age, concept, story_preferences_json,
                   content_boundaries_json, class_archetype, class_display_name, attributes_json,
                   traits_json, personal_goal, background_json, initial_equipment_ids_json,
                   created_at, updated_at
                 ) VALUES (?1, ?2, 'Hero', NULL, NULL, 'Rules', '[]', ?3, 'SCHOLAR',
                           'Scholar', ?4, ?5, 'Verify', ?6, '[]', ?7, ?7)",
                params![
                    "character-rules-native",
                    "campaign-rules-native",
                    r#"{"allowHorror":true,"allowPermanentDeath":false,"allowRomance":false,"allowBetrayal":true,"excludedContent":[]}"#,
                    r#"{"physique":3,"agility":2,"knowledge":3,"charisma":2}"#,
                    r#"[{"id":"trait-one","name":"One","description":"One"},{"id":"trait-two","name":"Two","description":"Two"}]"#,
                    r#"{"birthplace":"A","formativeExperience":"B","adventureMotivation":"C","secret":"D","importantPerson":"E","tavernArrivalReason":"F"}"#,
                    "2026-08-14T05:00:00.000Z",
                ],
            )
            .expect("character");
    }
}

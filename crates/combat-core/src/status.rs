use std::{error::Error, fmt};

use serde::{Deserialize, Serialize};

use crate::{
    DurationClock, EffectDefinition, GameplayTagCatalog, GameplayTagCatalogError, GameplayTagId,
    StatusRuntime,
};

pub const CURRENT_STATUS_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum StatusStackMode {
    Add,
    Replace,
    HighestOnly,
    IndependentStacks,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum StatusRefreshPolicy {
    KeepExisting,
    RefreshDuration,
    ExtendDuration,
    ReplaceDuration,
    IndependentDuration,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum StatusActivationPolicy {
    NextClock,
    CurrentClock,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum StatusTickPhase {
    OwnerTurnStart,
    OwnerTurnEnd,
    RoundStart,
    RoundEnd,
    None,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum StatusExpiryPhase {
    OwnerTurnEnd,
    RoundEnd,
    ExplicitRuleHook { hook_id: String },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StatusDurationDefinition {
    pub clock: DurationClock,
    pub duration: Option<i64>,
    pub activation_policy: StatusActivationPolicy,
    pub expiry_phase: StatusExpiryPhase,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum StatusTriggerHook {
    BattleStart,
    RoundStart,
    TurnStart,
    BeforeAction,
    AfterAction,
    BeforeRoll,
    AfterRoll,
    HitConfirmed,
    MissConfirmed,
    CriticalConfirmed,
    BeforeDamage,
    BeforeStatusApply,
    DamageApplied,
    StatusApplied,
    StatusRemoved,
    TargetDefeated,
    OnKill,
    TurnEnd,
    RoundEnd,
    BattleEnd,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StatusTriggerDefinition {
    pub trigger_id: String,
    pub hook: StatusTriggerHook,
    pub priority: i32,
    pub effects: Vec<EffectDefinition>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StatusDefinition {
    pub status_schema_version: u32,
    pub status_definition_id: String,
    pub tags: Vec<GameplayTagId>,
    pub stack_group_id: String,
    pub stack_mode: StatusStackMode,
    pub max_stacks: i64,
    pub duration: StatusDurationDefinition,
    pub refresh_policy: StatusRefreshPolicy,
    pub priority: i32,
    pub tick_phase: StatusTickPhase,
    pub dispel_tags: Vec<GameplayTagId>,
    pub immunity_tags: Vec<GameplayTagId>,
    pub effects: Vec<EffectDefinition>,
    pub triggers: Vec<StatusTriggerDefinition>,
    pub strength_rank: Option<i64>,
}

pub struct StatusSchemaValidator;

impl StatusSchemaValidator {
    pub fn validate_definition(
        definition: &StatusDefinition,
        tag_catalog: &GameplayTagCatalog,
    ) -> Result<(), StatusSchemaError> {
        validate_version(definition.status_schema_version)?;
        validate_stable_id(&definition.status_definition_id, "statusDefinitionId")?;
        validate_stable_id(&definition.stack_group_id, "stackGroupId")?;
        if definition.max_stacks <= 0 {
            return Err(schema_error(
                StatusSchemaErrorCode::InvalidMaxStacks,
                "maxStacks",
            ));
        }
        validate_tag_set(tag_catalog, &definition.tags, "tags")?;
        validate_tag_set(tag_catalog, &definition.dispel_tags, "dispelTags")?;
        validate_tag_set(tag_catalog, &definition.immunity_tags, "immunityTags")?;
        validate_duration(&definition.duration)?;
        validate_triggers(&definition.triggers)?;
        Ok(())
    }

    /// Runtime shape validation only. Merge cross-products are intentionally
    /// owned by M4-T03's StatusMergePolicy, not inferred here.
    pub fn validate_runtime(instance: &StatusRuntime) -> Result<(), StatusSchemaError> {
        validate_version(instance.status_schema_version)?;
        validate_stable_id(&instance.status_instance_id, "statusInstanceId")?;
        validate_stable_id(&instance.status_definition_id, "statusDefinitionId")?;
        validate_stable_id(&instance.stack_group_id, "stackGroupId")?;
        if let Some(source_id) = &instance.source_combatant_id {
            validate_stable_id(source_id, "sourceCombatantId")?;
        }
        if instance.stack_count <= 0 || instance.application_sequence == 0 {
            return Err(schema_error(
                StatusSchemaErrorCode::InvalidRuntimeInstance,
                &instance.status_instance_id,
            ));
        }
        if instance.tick_eligible_clock_index < instance.activation_clock_index {
            return Err(schema_error(
                StatusSchemaErrorCode::InvalidRuntimeInstance,
                &instance.status_instance_id,
            ));
        }
        if instance
            .last_duration_advanced_clock_index
            .is_some_and(|index| {
                index < instance.activation_clock_index
                    || instance.duration_clock == DurationClock::Permanent
            })
        {
            return Err(schema_error(
                StatusSchemaErrorCode::InvalidRuntimeInstance,
                &instance.status_instance_id,
            ));
        }
        match (instance.duration_clock, instance.remaining_duration) {
            (DurationClock::Permanent, None)
                if instance.activation_clock_index == 0
                    && instance.tick_eligible_clock_index == 0
                    && instance.last_duration_advanced_clock_index.is_none() => {}
            (DurationClock::OwnerTurn | DurationClock::Round, Some(value))
                if value > 0 && instance.activation_clock_index > 0 => {}
            _ => {
                return Err(schema_error(
                    StatusSchemaErrorCode::InvalidDuration,
                    &instance.status_instance_id,
                ));
            }
        }
        Ok(())
    }

    pub fn validate_runtime_collection(
        instances: &[StatusRuntime],
    ) -> Result<(), StatusSchemaError> {
        let mut previous: Option<(u64, &str)> = None;
        for instance in instances {
            Self::validate_runtime(instance)?;
            let key = (
                instance.application_sequence,
                instance.status_instance_id.as_str(),
            );
            if previous.is_some_and(|value| value >= key) {
                return Err(schema_error(
                    StatusSchemaErrorCode::NonCanonicalRuntimeOrder,
                    &instance.status_instance_id,
                ));
            }
            previous = Some(key);
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StatusSchemaErrorCode {
    UnsupportedSchemaVersion,
    InvalidStableId,
    InvalidMaxStacks,
    InvalidTagSet,
    InvalidDuration,
    InvalidTrigger,
    DuplicateTriggerId,
    InvalidRuntimeInstance,
    NonCanonicalRuntimeOrder,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StatusSchemaError {
    pub code: StatusSchemaErrorCode,
    pub subject: String,
}

impl fmt::Display for StatusSchemaError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "status schema validation failed for {}: {:?}",
            self.subject, self.code
        )
    }
}

impl Error for StatusSchemaError {}

fn validate_version(version: u32) -> Result<(), StatusSchemaError> {
    if version != CURRENT_STATUS_SCHEMA_VERSION {
        return Err(schema_error(
            StatusSchemaErrorCode::UnsupportedSchemaVersion,
            "statusSchemaVersion",
        ));
    }
    Ok(())
}

fn validate_duration(duration: &StatusDurationDefinition) -> Result<(), StatusSchemaError> {
    match (duration.clock, duration.duration) {
        (DurationClock::Permanent, None) => {}
        (DurationClock::OwnerTurn | DurationClock::Round, Some(value)) if value > 0 => {}
        _ => {
            return Err(schema_error(
                StatusSchemaErrorCode::InvalidDuration,
                "duration",
            ));
        }
    }
    if let StatusExpiryPhase::ExplicitRuleHook { hook_id } = &duration.expiry_phase {
        validate_stable_id(hook_id, "expiryPhase.hookId")?;
    }
    Ok(())
}

fn validate_tag_set(
    catalog: &GameplayTagCatalog,
    tags: &[GameplayTagId],
    subject: &str,
) -> Result<(), StatusSchemaError> {
    catalog
        .require_all_known(tags)
        .map_err(|error: GameplayTagCatalogError| {
            schema_error(
                StatusSchemaErrorCode::InvalidTagSet,
                format!("{subject}:{}:{:?}", error.subject, error.code),
            )
        })
}

fn validate_triggers(triggers: &[StatusTriggerDefinition]) -> Result<(), StatusSchemaError> {
    let mut previous: Option<&str> = None;
    for trigger in triggers {
        validate_stable_id(&trigger.trigger_id, "triggerId")?;
        if trigger.effects.is_empty() {
            return Err(schema_error(
                StatusSchemaErrorCode::InvalidTrigger,
                &trigger.trigger_id,
            ));
        }
        if previous.is_some_and(|value| value >= trigger.trigger_id.as_str()) {
            return Err(schema_error(
                if previous == Some(trigger.trigger_id.as_str()) {
                    StatusSchemaErrorCode::DuplicateTriggerId
                } else {
                    StatusSchemaErrorCode::InvalidTrigger
                },
                &trigger.trigger_id,
            ));
        }
        previous = Some(&trigger.trigger_id);
    }
    Ok(())
}

fn validate_stable_id(value: &str, subject: &str) -> Result<(), StatusSchemaError> {
    if value.is_empty()
        || value.len() > 128
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b':' | b'-'))
    {
        return Err(schema_error(
            StatusSchemaErrorCode::InvalidStableId,
            subject,
        ));
    }
    Ok(())
}

fn schema_error(code: StatusSchemaErrorCode, subject: impl Into<String>) -> StatusSchemaError {
    StatusSchemaError {
        code,
        subject: subject.into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{CombatFixed, EffectAmount, GameplayTagCatalog, StatusRuntime};

    #[test]
    fn definition_round_trips_every_versioned_status_field() {
        let catalog = GameplayTagCatalog::v0_4_1();
        let definition = complete_definition();
        StatusSchemaValidator::validate_definition(&definition, &catalog).unwrap();

        let encoded = serde_json::to_string(&definition).unwrap();
        let decoded: StatusDefinition = serde_json::from_str(&encoded).unwrap();
        assert_eq!(decoded, definition);
        assert!(encoded.contains("\"statusSchemaVersion\":1"));
        assert!(encoded.contains("\"stackMode\":\"ADD\""));
        assert!(encoded.contains("\"refreshPolicy\":\"REFRESH_DURATION\""));
        assert!(encoded.contains("\"tickPhase\":\"OWNER_TURN_START\""));
        assert!(encoded.contains("\"strengthRank\":7"));
    }

    #[test]
    fn runtime_record_round_trips_clock_identity_and_application_order() {
        let runtime = runtime("status-instance-a", 4);
        StatusSchemaValidator::validate_runtime(&runtime).unwrap();
        let encoded = serde_json::to_string(&runtime).unwrap();
        let decoded: StatusRuntime = serde_json::from_str(&encoded).unwrap();
        assert_eq!(decoded, runtime);
        assert!(encoded.contains("\"activationClockIndex\":12"));
        assert!(encoded.contains("\"appliedRoundIndex\":3"));
        assert!(encoded.contains("\"appliedOwnerTurnIndex\":8"));
    }

    #[test]
    fn schema_rejects_unknown_versions_ids_tags_duration_and_trigger_shapes() {
        let catalog = GameplayTagCatalog::v0_4_1();
        let mut version = complete_definition();
        version.status_schema_version = 2;
        assert_eq!(
            definition_error(&version, &catalog),
            StatusSchemaErrorCode::UnsupportedSchemaVersion
        );

        let mut id = complete_definition();
        id.stack_group_id = "bad group".into();
        assert_eq!(
            definition_error(&id, &catalog),
            StatusSchemaErrorCode::InvalidStableId
        );

        let mut tag = complete_definition();
        tag.tags = vec![GameplayTagId::new("Status.Unknown").unwrap()];
        assert_eq!(
            definition_error(&tag, &catalog),
            StatusSchemaErrorCode::InvalidTagSet
        );

        let mut duration = complete_definition();
        duration.duration.duration = Some(0);
        assert_eq!(
            definition_error(&duration, &catalog),
            StatusSchemaErrorCode::InvalidDuration
        );

        let mut trigger = complete_definition();
        trigger.triggers[0].effects.clear();
        assert_eq!(
            definition_error(&trigger, &catalog),
            StatusSchemaErrorCode::InvalidTrigger
        );
    }

    #[test]
    fn runtime_collection_requires_canonical_application_sequence_then_id() {
        let ordered = vec![
            runtime("status-a", 4),
            runtime("status-b", 4),
            runtime("status-c", 5),
        ];
        StatusSchemaValidator::validate_runtime_collection(&ordered).unwrap();

        let reversed = vec![runtime("status-c", 5), runtime("status-a", 4)];
        assert_eq!(
            StatusSchemaValidator::validate_runtime_collection(&reversed)
                .unwrap_err()
                .code,
            StatusSchemaErrorCode::NonCanonicalRuntimeOrder
        );

        let duplicate = vec![runtime("status-a", 4), runtime("status-a", 4)];
        assert_eq!(
            StatusSchemaValidator::validate_runtime_collection(&duplicate)
                .unwrap_err()
                .code,
            StatusSchemaErrorCode::NonCanonicalRuntimeOrder
        );
    }

    #[test]
    fn runtime_shape_rejects_zero_stack_sequence_and_clock_duration_mismatch() {
        let mut stack = runtime("status-a", 1);
        stack.stack_count = 0;
        assert_eq!(
            StatusSchemaValidator::validate_runtime(&stack)
                .unwrap_err()
                .code,
            StatusSchemaErrorCode::InvalidRuntimeInstance
        );

        let mut sequence = runtime("status-a", 1);
        sequence.application_sequence = 0;
        assert_eq!(
            StatusSchemaValidator::validate_runtime(&sequence)
                .unwrap_err()
                .code,
            StatusSchemaErrorCode::InvalidRuntimeInstance
        );

        let mut permanent = runtime("status-a", 1);
        permanent.duration_clock = DurationClock::Permanent;
        assert_eq!(
            StatusSchemaValidator::validate_runtime(&permanent)
                .unwrap_err()
                .code,
            StatusSchemaErrorCode::InvalidDuration
        );
        permanent.remaining_duration = None;
        permanent.activation_clock_index = 0;
        permanent.tick_eligible_clock_index = 0;
        StatusSchemaValidator::validate_runtime(&permanent).unwrap();

        let mut premature_tick = runtime("status-a", 1);
        premature_tick.tick_eligible_clock_index = premature_tick.activation_clock_index - 1;
        assert_eq!(
            StatusSchemaValidator::validate_runtime(&premature_tick)
                .unwrap_err()
                .code,
            StatusSchemaErrorCode::InvalidRuntimeInstance
        );
    }

    #[test]
    fn exact_tagged_unions_reject_runtime_code_and_unknown_semantics() {
        assert!(serde_json::from_str::<StatusStackMode>("\"SCRIPTED\"").is_err());
        assert!(serde_json::from_str::<StatusRefreshPolicy>("\"RESET_RANDOMLY\"").is_err());
        assert!(serde_json::from_str::<StatusTriggerHook>("\"ARBITRARY_EVENT\"").is_err());

        let mut value = serde_json::to_value(complete_definition()).unwrap();
        value["runtimeCode"] = serde_json::json!("target.hp -= 10");
        assert!(serde_json::from_value::<StatusDefinition>(value).is_err());
    }

    fn definition_error(
        definition: &StatusDefinition,
        catalog: &GameplayTagCatalog,
    ) -> StatusSchemaErrorCode {
        StatusSchemaValidator::validate_definition(definition, catalog)
            .unwrap_err()
            .code
    }

    fn complete_definition() -> StatusDefinition {
        StatusDefinition {
            status_schema_version: CURRENT_STATUS_SCHEMA_VERSION,
            status_definition_id: "status-burning".into(),
            tags: vec![GameplayTagId::new("Status.Burning").unwrap()],
            stack_group_id: "burning".into(),
            stack_mode: StatusStackMode::Add,
            max_stacks: 3,
            duration: StatusDurationDefinition {
                clock: DurationClock::OwnerTurn,
                duration: Some(2),
                activation_policy: StatusActivationPolicy::NextClock,
                expiry_phase: StatusExpiryPhase::OwnerTurnEnd,
            },
            refresh_policy: StatusRefreshPolicy::RefreshDuration,
            priority: 20,
            tick_phase: StatusTickPhase::OwnerTurnStart,
            dispel_tags: vec![GameplayTagId::new("Element.Fire").unwrap()],
            immunity_tags: vec![GameplayTagId::new("Character.Mechanical").unwrap()],
            effects: vec![EffectDefinition::DealDamage {
                channel_id: crate::DamageChannelId::new("fire").unwrap(),
                raw_damage: CombatFixed::from_scaled(2_000_000),
            }],
            triggers: vec![StatusTriggerDefinition {
                trigger_id: "burning-tick".into(),
                hook: StatusTriggerHook::TurnStart,
                priority: 20,
                effects: vec![EffectDefinition::Heal {
                    amount: EffectAmount::Flat { amount: 1 },
                }],
            }],
            strength_rank: Some(7),
        }
    }

    fn runtime(id: &str, sequence: u64) -> StatusRuntime {
        StatusRuntime {
            status_schema_version: CURRENT_STATUS_SCHEMA_VERSION,
            status_instance_id: id.into(),
            status_definition_id: "status-burning".into(),
            source_combatant_id: Some("caster-a".into()),
            stack_group_id: "burning".into(),
            stack_count: 2,
            remaining_duration: Some(2),
            duration_clock: DurationClock::OwnerTurn,
            application_sequence: sequence,
            activation_clock_index: 12,
            applied_round_index: 3,
            applied_owner_turn_index: Some(8),
            tick_eligible_clock_index: 12,
            last_duration_advanced_clock_index: None,
            strength_rank: Some(7),
        }
    }
}

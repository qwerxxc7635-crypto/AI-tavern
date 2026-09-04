use std::{error::Error, fmt};

use serde::{Deserialize, Serialize};

use crate::{
    CombatCommandEnvelope, CombatCommandPayload, CombatState, CombatantRuntime, CombatantState,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PreconditionTiming {
    Submission,
    ExecutionRevalidation,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PreconditionRuleSpec {
    pub rule_id: String,
    pub revalidate_before_resolution: bool,
    pub rule: PreconditionRule,
}

impl PreconditionRuleSpec {
    #[must_use]
    pub fn with_default_timing(rule_id: impl Into<String>, rule: PreconditionRule) -> Self {
        Self {
            rule_id: rule_id.into(),
            revalidate_before_resolution: rule.default_revalidation(),
            rule,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "SCREAMING_SNAKE_CASE",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum PreconditionRule {
    SourceControlsActor,
    StableInputPoint,
    ReservationOwned,
    ActorExists,
    ActorMayAct,
    AbilityExists,
    AbilityEnabled,
    TargetExists,
    TargetLegal,
    ActionPointsAtLeast { amount: i64 },
    ReactionChargesAtLeast { amount: i64 },
    ResourceAtLeast { resource_id: String, amount: i64 },
    ItemQuantityAtLeast { item_id: String, amount: i64 },
    CooldownReady,
    NormalOwnerTurnUsesBelow { maximum: i64 },
    BattleUsesBelow { maximum: i64 },
    BasicAttackCountBelow { maximum: i64 },
    OnceCounterUnused { counter_id: String },
    ActorHasTag { tag_id: String },
    ActorLacksTag { tag_id: String },
    TargetHasTag { tag_id: String },
    TargetLacksTag { tag_id: String },
    ResourceAfterGainAtMostHardMax { resource_id: String, gain: i64 },
}

impl PreconditionRule {
    #[must_use]
    pub const fn default_revalidation(&self) -> bool {
        !matches!(
            self,
            Self::SourceControlsActor
                | Self::StableInputPoint
                | Self::ActionPointsAtLeast { .. }
                | Self::ReactionChargesAtLeast { .. }
                | Self::ResourceAtLeast { .. }
                | Self::ItemQuantityAtLeast { .. }
        )
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EntityTagFacts {
    pub entity_id: String,
    pub tag_ids: Vec<String>,
}

/// Read-only inputs for the one precondition evaluator. Combat numbers are read
/// directly from the authoritative state. Catalog/tag/target/inventory owners
/// provide typed projections; the evaluator never mutates or persists them.
#[derive(Debug)]
pub struct PreconditionEvaluationContext<'a> {
    pub state: &'a CombatState,
    pub command: &'a CombatCommandEnvelope,
    pub effective_target_id: Option<&'a str>,
    pub source_controls_actor: bool,
    pub stable_input_point: bool,
    pub reservation_id: Option<&'a str>,
    pub known_ability_ids: &'a [String],
    pub disabled_ability_ids: &'a [String],
    pub legal_target_ids: &'a [String],
    pub entity_tags: &'a [EntityTagFacts],
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PreconditionFailureCode {
    SourceNotAuthorized,
    UnstableInputPoint,
    ReservationNotOwned,
    ActorMissing,
    ActorCannotAct,
    AbilityMissing,
    AbilityDisabled,
    TargetMissing,
    TargetIllegal,
    InsufficientActionPoints,
    InsufficientReactionCharges,
    ResourceMissing,
    InsufficientResource,
    ItemMissing,
    InsufficientItemQuantity,
    CooldownActive,
    NormalOwnerTurnUsageExhausted,
    BattleUsageExhausted,
    BasicAttackUsageExhausted,
    OnceCounterAlreadyUsed,
    RequiredActorTagMissing,
    ForbiddenActorTagPresent,
    RequiredTargetTagMissing,
    ForbiddenTargetTagPresent,
    ResourceHardLimitExceeded,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PreconditionFailure {
    pub rule_id: String,
    pub code: PreconditionFailureCode,
    pub subject_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PreconditionEvaluation {
    pub timing: PreconditionTiming,
    pub evaluated_rule_ids: Vec<String>,
    pub failures: Vec<PreconditionFailure>,
}

impl PreconditionEvaluation {
    #[must_use]
    pub fn passed(&self) -> bool {
        self.failures.is_empty()
    }
}

pub struct PreconditionRuleSystem;

impl PreconditionRuleSystem {
    pub fn evaluate(
        timing: PreconditionTiming,
        rules: &[PreconditionRuleSpec],
        context: &PreconditionEvaluationContext<'_>,
    ) -> Result<PreconditionEvaluation, PreconditionDefinitionError> {
        validate_rule_set(rules)?;
        let mut evaluated_rule_ids = Vec::new();
        let mut failures = Vec::new();
        for spec in rules {
            if timing == PreconditionTiming::ExecutionRevalidation
                && !spec.revalidate_before_resolution
            {
                continue;
            }
            evaluated_rule_ids.push(spec.rule_id.clone());
            if let Some((code, subject_id)) = evaluate_rule(&spec.rule, context) {
                failures.push(PreconditionFailure {
                    rule_id: spec.rule_id.clone(),
                    code,
                    subject_id,
                });
            }
        }
        Ok(PreconditionEvaluation {
            timing,
            evaluated_rule_ids,
            failures,
        })
    }
}

fn evaluate_rule(
    rule: &PreconditionRule,
    context: &PreconditionEvaluationContext<'_>,
) -> Option<(PreconditionFailureCode, Option<String>)> {
    let actor = actor(context);
    let ability_id = ability_id(context.command);
    let target_id = context.effective_target_id;
    match rule {
        PreconditionRule::SourceControlsActor => failure_if(
            !context.source_controls_actor,
            PreconditionFailureCode::SourceNotAuthorized,
            Some(context.command.actor_id.clone()),
        ),
        PreconditionRule::StableInputPoint => failure_if(
            !context.stable_input_point,
            PreconditionFailureCode::UnstableInputPoint,
            None,
        ),
        PreconditionRule::ReservationOwned => {
            let owned = context.reservation_id.is_some_and(|reservation_id| {
                context.state.cost_reservations.iter().any(|reservation| {
                    reservation.reservation_id == reservation_id
                        && reservation.command_id == context.command.command_id
                        && reservation.status == crate::CostReservationStatus::Reserved
                })
            });
            failure_if(
                !owned,
                PreconditionFailureCode::ReservationNotOwned,
                context.reservation_id.map(str::to_owned),
            )
        }
        PreconditionRule::ActorExists => failure_if(
            actor.is_none(),
            PreconditionFailureCode::ActorMissing,
            Some(context.command.actor_id.clone()),
        ),
        PreconditionRule::ActorMayAct => failure_if(
            !actor.is_some_and(|value| value.state == CombatantState::Active),
            PreconditionFailureCode::ActorCannotAct,
            Some(context.command.actor_id.clone()),
        ),
        PreconditionRule::AbilityExists => failure_if(
            !ability_id.is_some_and(|id| context.known_ability_ids.iter().any(|value| value == id)),
            PreconditionFailureCode::AbilityMissing,
            ability_id.map(str::to_owned),
        ),
        PreconditionRule::AbilityEnabled => failure_if(
            ability_id
                .is_none_or(|id| context.disabled_ability_ids.iter().any(|value| value == id)),
            PreconditionFailureCode::AbilityDisabled,
            ability_id.map(str::to_owned),
        ),
        PreconditionRule::TargetExists => {
            failure_if(
                target_id.is_none_or(|id| {
                    !context.state.combatants.iter().any(|value| {
                        value.combatant_id == id && value.state != CombatantState::Removed
                    })
                }),
                PreconditionFailureCode::TargetMissing,
                target_id.map(str::to_owned),
            )
        }
        PreconditionRule::TargetLegal => failure_if(
            target_id.is_none_or(|id| !context.legal_target_ids.iter().any(|value| value == id)),
            PreconditionFailureCode::TargetIllegal,
            target_id.map(str::to_owned),
        ),
        PreconditionRule::ActionPointsAtLeast { amount } => failure_if(
            !actor.is_some_and(|value| value.action_points >= *amount),
            PreconditionFailureCode::InsufficientActionPoints,
            Some(context.command.actor_id.clone()),
        ),
        PreconditionRule::ReactionChargesAtLeast { amount } => failure_if(
            !actor.is_some_and(|value| value.reaction_charges >= *amount),
            PreconditionFailureCode::InsufficientReactionCharges,
            Some(context.command.actor_id.clone()),
        ),
        PreconditionRule::ResourceAtLeast {
            resource_id,
            amount,
        } => match actor.and_then(|value| resource(value, resource_id)) {
            None => Some((
                PreconditionFailureCode::ResourceMissing,
                Some(resource_id.clone()),
            )),
            Some(value) => failure_if(
                value.current < *amount,
                PreconditionFailureCode::InsufficientResource,
                Some(resource_id.clone()),
            ),
        },
        PreconditionRule::ItemQuantityAtLeast { item_id, amount } => {
            match context.state.combat_inventory.iter().find(|value| {
                value.owner_id == context.command.actor_id && value.item_id == *item_id
            }) {
                None => Some((PreconditionFailureCode::ItemMissing, Some(item_id.clone()))),
                Some(value) => failure_if(
                    value.current_quantity < *amount,
                    PreconditionFailureCode::InsufficientItemQuantity,
                    Some(item_id.clone()),
                ),
            }
        }
        PreconditionRule::CooldownReady => match ability_usage(actor, ability_id) {
            Some(usage) => failure_if(
                usage.cooldown_remaining != 0,
                PreconditionFailureCode::CooldownActive,
                ability_id.map(str::to_owned),
            ),
            None => failure_if(
                ability_id.is_none(),
                PreconditionFailureCode::AbilityMissing,
                None,
            ),
        },
        PreconditionRule::NormalOwnerTurnUsesBelow { maximum } => {
            let exhausted = ability_usage(actor, ability_id)
                .is_some_and(|usage| usage.uses_this_normal_owner_turn >= *maximum);
            failure_if(
                exhausted || ability_id.is_none(),
                PreconditionFailureCode::NormalOwnerTurnUsageExhausted,
                ability_id.map(str::to_owned),
            )
        }
        PreconditionRule::BattleUsesBelow { maximum } => {
            let exhausted = ability_usage(actor, ability_id)
                .is_some_and(|usage| usage.uses_this_battle >= *maximum);
            failure_if(
                exhausted || ability_id.is_none(),
                PreconditionFailureCode::BattleUsageExhausted,
                ability_id.map(str::to_owned),
            )
        }
        PreconditionRule::BasicAttackCountBelow { maximum } => failure_if(
            !actor.is_some_and(|value| value.basic_attack_count_this_normal_owner_turn < *maximum),
            PreconditionFailureCode::BasicAttackUsageExhausted,
            Some(context.command.actor_id.clone()),
        ),
        PreconditionRule::OnceCounterUnused { counter_id } => failure_if(
            !actor.is_some_and(|value| {
                value
                    .once_usage_counters
                    .iter()
                    .any(|counter| counter.counter_id == *counter_id && counter.uses == 0)
            }),
            PreconditionFailureCode::OnceCounterAlreadyUsed,
            Some(counter_id.clone()),
        ),
        PreconditionRule::ActorHasTag { tag_id } => tag_failure(
            context,
            &context.command.actor_id,
            tag_id,
            true,
            PreconditionFailureCode::RequiredActorTagMissing,
        ),
        PreconditionRule::ActorLacksTag { tag_id } => tag_failure(
            context,
            &context.command.actor_id,
            tag_id,
            false,
            PreconditionFailureCode::ForbiddenActorTagPresent,
        ),
        PreconditionRule::TargetHasTag { tag_id } => target_id.map_or_else(
            || Some((PreconditionFailureCode::TargetMissing, None)),
            |id| {
                tag_failure(
                    context,
                    id,
                    tag_id,
                    true,
                    PreconditionFailureCode::RequiredTargetTagMissing,
                )
            },
        ),
        PreconditionRule::TargetLacksTag { tag_id } => target_id.map_or_else(
            || Some((PreconditionFailureCode::TargetMissing, None)),
            |id| {
                tag_failure(
                    context,
                    id,
                    tag_id,
                    false,
                    PreconditionFailureCode::ForbiddenTargetTagPresent,
                )
            },
        ),
        PreconditionRule::ResourceAfterGainAtMostHardMax { resource_id, gain } => {
            let within_limit = actor
                .and_then(|value| resource(value, resource_id))
                .and_then(|value| value.hard_max_value.zip(value.current.checked_add(*gain)))
                .is_some_and(|(hard_max, after)| after <= hard_max);
            failure_if(
                !within_limit,
                PreconditionFailureCode::ResourceHardLimitExceeded,
                Some(resource_id.clone()),
            )
        }
    }
}

fn actor<'a>(context: &'a PreconditionEvaluationContext<'_>) -> Option<&'a CombatantRuntime> {
    context
        .state
        .combatants
        .iter()
        .find(|value| value.combatant_id == context.command.actor_id)
}

fn ability_id(command: &CombatCommandEnvelope) -> Option<&str> {
    match &command.payload {
        CombatCommandPayload::UseAbility { ability_id, .. } => Some(ability_id),
        _ => None,
    }
}

fn ability_usage<'a>(
    actor: Option<&'a CombatantRuntime>,
    ability_id: Option<&str>,
) -> Option<&'a crate::AbilityUsageState> {
    let ability_id = ability_id?;
    actor?
        .ability_usage
        .iter()
        .find(|value| value.ability_id == ability_id)
}

fn resource<'a>(
    actor: &'a CombatantRuntime,
    resource_id: &str,
) -> Option<&'a crate::ResourceState> {
    actor
        .resources
        .iter()
        .find(|value| value.resource_id == resource_id)
}

fn tag_failure(
    context: &PreconditionEvaluationContext<'_>,
    entity_id: &str,
    tag_id: &str,
    must_be_present: bool,
    code: PreconditionFailureCode,
) -> Option<(PreconditionFailureCode, Option<String>)> {
    let present = context
        .entity_tags
        .iter()
        .find(|value| value.entity_id == entity_id)
        .is_some_and(|value| value.tag_ids.iter().any(|tag| tag == tag_id));
    failure_if(present != must_be_present, code, Some(entity_id.to_owned()))
}

fn failure_if(
    failed: bool,
    code: PreconditionFailureCode,
    subject_id: Option<String>,
) -> Option<(PreconditionFailureCode, Option<String>)> {
    failed.then_some((code, subject_id))
}

fn validate_rule_set(rules: &[PreconditionRuleSpec]) -> Result<(), PreconditionDefinitionError> {
    for (index, spec) in rules.iter().enumerate() {
        validate_stable_id(&spec.rule_id).map_err(|code| PreconditionDefinitionError {
            code,
            rule_id: spec.rule_id.clone(),
        })?;
        if rules[..index]
            .iter()
            .any(|previous| previous.rule_id == spec.rule_id)
        {
            return Err(PreconditionDefinitionError {
                code: PreconditionDefinitionErrorCode::DuplicateRuleId,
                rule_id: spec.rule_id.clone(),
            });
        }
        validate_rule(&spec.rule).map_err(|code| PreconditionDefinitionError {
            code,
            rule_id: spec.rule_id.clone(),
        })?;
    }
    Ok(())
}

fn validate_rule(rule: &PreconditionRule) -> Result<(), PreconditionDefinitionErrorCode> {
    match rule {
        PreconditionRule::ActionPointsAtLeast { amount }
        | PreconditionRule::ReactionChargesAtLeast { amount }
        | PreconditionRule::NormalOwnerTurnUsesBelow { maximum: amount }
        | PreconditionRule::BattleUsesBelow { maximum: amount } => validate_non_negative(*amount),
        PreconditionRule::ResourceAtLeast {
            resource_id,
            amount,
        }
        | PreconditionRule::ItemQuantityAtLeast {
            item_id: resource_id,
            amount,
        } => {
            validate_stable_id(resource_id)?;
            validate_non_negative(*amount)
        }
        PreconditionRule::ResourceAfterGainAtMostHardMax { resource_id, gain } => {
            validate_stable_id(resource_id)?;
            validate_non_negative(*gain)
        }
        PreconditionRule::ActorHasTag { tag_id }
        | PreconditionRule::ActorLacksTag { tag_id }
        | PreconditionRule::TargetHasTag { tag_id }
        | PreconditionRule::TargetLacksTag { tag_id } => validate_stable_id(tag_id),
        PreconditionRule::OnceCounterUnused { counter_id } => validate_stable_id(counter_id),
        PreconditionRule::SourceControlsActor
        | PreconditionRule::StableInputPoint
        | PreconditionRule::ReservationOwned
        | PreconditionRule::ActorExists
        | PreconditionRule::ActorMayAct
        | PreconditionRule::AbilityExists
        | PreconditionRule::AbilityEnabled
        | PreconditionRule::TargetExists
        | PreconditionRule::TargetLegal
        | PreconditionRule::CooldownReady => Ok(()),
        PreconditionRule::BasicAttackCountBelow { maximum } => validate_non_negative(*maximum),
    }
}

fn validate_non_negative(value: i64) -> Result<(), PreconditionDefinitionErrorCode> {
    if value < 0 {
        Err(PreconditionDefinitionErrorCode::InvalidNumericBound)
    } else {
        Ok(())
    }
}

fn validate_stable_id(value: &str) -> Result<(), PreconditionDefinitionErrorCode> {
    if value.is_empty()
        || value.len() > 128
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b':' | b'-'))
    {
        Err(PreconditionDefinitionErrorCode::InvalidStableId)
    } else {
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PreconditionDefinitionErrorCode {
    InvalidStableId,
    InvalidNumericBound,
    DuplicateRuleId,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PreconditionDefinitionError {
    pub code: PreconditionDefinitionErrorCode,
    pub rule_id: String,
}

impl fmt::Display for PreconditionDefinitionError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("combat precondition definition is invalid")
    }
}

impl Error for PreconditionDefinitionError {}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        AbilityUsageState, CURRENT_COMBAT_VERSIONS, CombatCommandSource, CombatPhase, CombatRng,
        CombatSide, ObjectiveRuntimeState, ProvisionalRuntimeDelta, ReinforcementRuntimeState,
        RoundRuntimeState,
    };

    #[test]
    fn submission_and_execution_use_the_same_rules_with_timing_metadata() {
        let state = fixture_state();
        let command = fixture_command();
        let known = vec!["ability-strike".to_owned()];
        let legal = vec!["enemy-1".to_owned()];
        let tags = vec![EntityTagFacts {
            entity_id: "actor-1".to_owned(),
            tag_ids: vec!["weapon-ready".to_owned()],
        }];
        let context = context(&state, &command, &known, &legal, &tags);
        let rules = rules();

        let submission =
            PreconditionRuleSystem::evaluate(PreconditionTiming::Submission, &rules, &context)
                .unwrap();
        let execution = PreconditionRuleSystem::evaluate(
            PreconditionTiming::ExecutionRevalidation,
            &rules,
            &context,
        )
        .unwrap();

        assert!(submission.passed());
        assert!(execution.passed());
        assert_eq!(submission.evaluated_rule_ids.len(), rules.len());
        assert!(
            execution.evaluated_rule_ids.len() < submission.evaluated_rule_ids.len(),
            "submission-only authority and locked balance checks must not be repeated"
        );
        assert_eq!(state.rng, fixture_state().rng);
    }

    #[test]
    fn preaction_state_changes_fail_execution_before_resolution() {
        let mut state = fixture_state();
        let command = fixture_command();
        let known = vec!["ability-strike".to_owned()];
        let legal = vec!["enemy-1".to_owned()];
        let tags = vec![EntityTagFacts {
            entity_id: "actor-1".to_owned(),
            tag_ids: vec!["weapon-ready".to_owned()],
        }];
        state.combatants[0].state = CombatantState::Downed;
        state.combatants[0].ability_usage[0].cooldown_remaining = 1;
        let disabled = vec!["ability-strike".to_owned()];
        let context = PreconditionEvaluationContext {
            disabled_ability_ids: &disabled,
            ..context(&state, &command, &known, &legal, &tags)
        };

        let evaluation = PreconditionRuleSystem::evaluate(
            PreconditionTiming::ExecutionRevalidation,
            &rules(),
            &context,
        )
        .unwrap();
        let codes: Vec<_> = evaluation
            .failures
            .iter()
            .map(|failure| failure.code)
            .collect();
        assert!(codes.contains(&PreconditionFailureCode::ActorCannotAct));
        assert!(codes.contains(&PreconditionFailureCode::AbilityDisabled));
        assert!(codes.contains(&PreconditionFailureCode::CooldownActive));
    }

    #[test]
    fn redirected_target_uses_effective_legal_target_not_original_input() {
        let state = fixture_state();
        let command = fixture_command();
        let known = vec!["ability-strike".to_owned()];
        let legal = vec!["enemy-2".to_owned()];
        let tags = vec![];
        let mut context = context(&state, &command, &known, &legal, &tags);
        context.effective_target_id = Some("enemy-2");
        let target_rules = vec![
            PreconditionRuleSpec::with_default_timing(
                "target-exists",
                PreconditionRule::TargetExists,
            ),
            PreconditionRuleSpec::with_default_timing(
                "target-legal",
                PreconditionRule::TargetLegal,
            ),
        ];
        assert!(
            PreconditionRuleSystem::evaluate(
                PreconditionTiming::ExecutionRevalidation,
                &target_rules,
                &context,
            )
            .unwrap()
            .passed()
        );
    }

    #[test]
    fn structured_failures_cover_cost_tag_target_and_usage_rules() {
        let mut state = fixture_state();
        let command = fixture_command();
        state.combatants[0].action_points = 0;
        state.combatants[0].resources[1].current = 9;
        state.combat_inventory[0].current_quantity = 0;
        state.combatants[0].ability_usage[0].uses_this_normal_owner_turn = 1;
        state.combatants[0].ability_usage[0].uses_this_battle = 3;
        let known = vec!["ability-strike".to_owned()];
        let legal = vec![];
        let tags = vec![EntityTagFacts {
            entity_id: "actor-1".to_owned(),
            tag_ids: vec!["silenced".to_owned()],
        }];
        let context = context(&state, &command, &known, &legal, &tags);
        let evaluation =
            PreconditionRuleSystem::evaluate(PreconditionTiming::Submission, &rules(), &context)
                .unwrap();
        let codes: Vec<_> = evaluation
            .failures
            .iter()
            .map(|failure| failure.code)
            .collect();
        for expected in [
            PreconditionFailureCode::TargetIllegal,
            PreconditionFailureCode::InsufficientActionPoints,
            PreconditionFailureCode::InsufficientItemQuantity,
            PreconditionFailureCode::NormalOwnerTurnUsageExhausted,
            PreconditionFailureCode::BattleUsageExhausted,
            PreconditionFailureCode::RequiredActorTagMissing,
            PreconditionFailureCode::ForbiddenActorTagPresent,
            PreconditionFailureCode::ResourceHardLimitExceeded,
        ] {
            assert!(codes.contains(&expected), "missing {expected:?}");
        }
    }

    #[test]
    fn missing_entities_and_resources_fail_closed_without_panics() {
        let state = fixture_state();
        let mut command = fixture_command();
        command.actor_id = "missing-actor".to_owned();
        let empty: Vec<String> = vec![];
        let tags = vec![];
        let context = context(&state, &command, &empty, &empty, &tags);
        let evaluation = PreconditionRuleSystem::evaluate(
            PreconditionTiming::Submission,
            &[
                PreconditionRuleSpec::with_default_timing(
                    "actor-exists",
                    PreconditionRule::ActorExists,
                ),
                PreconditionRuleSpec::with_default_timing(
                    "mana",
                    PreconditionRule::ResourceAtLeast {
                        resource_id: "mana".to_owned(),
                        amount: 1,
                    },
                ),
            ],
            &context,
        )
        .unwrap();
        assert_eq!(evaluation.failures.len(), 2);
        assert_eq!(
            evaluation.failures[0].code,
            PreconditionFailureCode::ActorMissing
        );
        assert_eq!(
            evaluation.failures[1].code,
            PreconditionFailureCode::ResourceMissing
        );
    }

    #[test]
    fn malformed_and_duplicate_rule_definitions_are_rejected() {
        let state = fixture_state();
        let command = fixture_command();
        let empty: Vec<String> = vec![];
        let tags = vec![];
        let context = context(&state, &command, &empty, &empty, &tags);
        for rules in [
            vec![PreconditionRuleSpec::with_default_timing(
                "bad id",
                PreconditionRule::ActorExists,
            )],
            vec![
                PreconditionRuleSpec::with_default_timing("same", PreconditionRule::ActorExists),
                PreconditionRuleSpec::with_default_timing("same", PreconditionRule::ActorMayAct),
            ],
            vec![PreconditionRuleSpec::with_default_timing(
                "negative-cost",
                PreconditionRule::ActionPointsAtLeast { amount: -1 },
            )],
        ] {
            assert!(
                PreconditionRuleSystem::evaluate(PreconditionTiming::Submission, &rules, &context,)
                    .is_err()
            );
        }
    }

    #[test]
    fn evaluation_and_serialization_preserve_declared_rule_order() {
        let state = fixture_state();
        let command = fixture_command();
        let empty: Vec<String> = vec![];
        let tags = vec![];
        let context = context(&state, &command, &empty, &empty, &tags);
        let rules = vec![
            PreconditionRuleSpec::with_default_timing("first", PreconditionRule::AbilityExists),
            PreconditionRuleSpec::with_default_timing("second", PreconditionRule::TargetLegal),
        ];
        let first =
            PreconditionRuleSystem::evaluate(PreconditionTiming::Submission, &rules, &context)
                .unwrap();
        let second =
            PreconditionRuleSystem::evaluate(PreconditionTiming::Submission, &rules, &context)
                .unwrap();
        assert_eq!(first, second);
        assert_eq!(first.evaluated_rule_ids, vec!["first", "second"]);
        assert_eq!(
            serde_json::to_string(&first).unwrap(),
            serde_json::to_string(&second).unwrap()
        );
    }

    fn rules() -> Vec<PreconditionRuleSpec> {
        [
            ("source", PreconditionRule::SourceControlsActor),
            ("stable", PreconditionRule::StableInputPoint),
            ("actor", PreconditionRule::ActorExists),
            ("actor-active", PreconditionRule::ActorMayAct),
            ("ability", PreconditionRule::AbilityExists),
            ("ability-enabled", PreconditionRule::AbilityEnabled),
            ("target", PreconditionRule::TargetExists),
            ("target-legal", PreconditionRule::TargetLegal),
            ("ap", PreconditionRule::ActionPointsAtLeast { amount: 1 }),
            (
                "mana",
                PreconditionRule::ResourceAtLeast {
                    resource_id: "mana".to_owned(),
                    amount: 1,
                },
            ),
            (
                "arrow",
                PreconditionRule::ItemQuantityAtLeast {
                    item_id: "item-arrow".to_owned(),
                    amount: 1,
                },
            ),
            ("cooldown", PreconditionRule::CooldownReady),
            (
                "turn-usage",
                PreconditionRule::NormalOwnerTurnUsesBelow { maximum: 1 },
            ),
            (
                "battle-usage",
                PreconditionRule::BattleUsesBelow { maximum: 3 },
            ),
            (
                "required-tag",
                PreconditionRule::ActorHasTag {
                    tag_id: "weapon-ready".to_owned(),
                },
            ),
            (
                "forbidden-tag",
                PreconditionRule::ActorLacksTag {
                    tag_id: "silenced".to_owned(),
                },
            ),
            (
                "heat-limit",
                PreconditionRule::ResourceAfterGainAtMostHardMax {
                    resource_id: "heat".to_owned(),
                    gain: 2,
                },
            ),
        ]
        .into_iter()
        .map(|(id, rule)| PreconditionRuleSpec::with_default_timing(id, rule))
        .collect()
    }

    fn context<'a>(
        state: &'a CombatState,
        command: &'a CombatCommandEnvelope,
        known: &'a [String],
        legal: &'a [String],
        tags: &'a [EntityTagFacts],
    ) -> PreconditionEvaluationContext<'a> {
        PreconditionEvaluationContext {
            state,
            command,
            effective_target_id: Some("enemy-1"),
            source_controls_actor: true,
            stable_input_point: true,
            reservation_id: None,
            known_ability_ids: known,
            disabled_ability_ids: &[],
            legal_target_ids: legal,
            entity_tags: tags,
        }
    }

    fn fixture_command() -> CombatCommandEnvelope {
        CombatCommandEnvelope {
            command_id: "command-1".to_owned(),
            source: CombatCommandSource::Player {
                controller_id: "player-main".to_owned(),
            },
            actor_id: "actor-1".to_owned(),
            versions: CURRENT_COMBAT_VERSIONS,
            payload: CombatCommandPayload::UseAbility {
                ability_id: "ability-strike".to_owned(),
                target_id: Some("enemy-1".to_owned()),
            },
        }
    }

    fn fixture_state() -> CombatState {
        let rng = CombatRng::new(
            "0123456789abcdef0123456789abcdef",
            "combat-precondition-fixture",
            CURRENT_COMBAT_VERSIONS.rng_contract_version,
        )
        .unwrap()
        .snapshot();
        CombatState {
            combat_instance_id: "combat-precondition-fixture".to_owned(),
            versions: CURRENT_COMBAT_VERSIONS,
            random_seed: "0123456789abcdef0123456789abcdef".to_owned(),
            revision: 1,
            last_committed_sequence: 0,
            phase: CombatPhase::Action,
            combatants: vec![
                combatant("actor-1", CombatSide::Player),
                combatant("enemy-1", CombatSide::Hostile),
                combatant("enemy-2", CombatSide::Hostile),
            ],
            formal_party_member_ids: vec![],
            combat_inventory: vec![crate::CombatInventoryItemState {
                owner_id: "actor-1".to_owned(),
                item_id: "item-arrow".to_owned(),
                current_quantity: 2,
            }],
            cost_reservations: vec![],
            resolution_context: None,
            timeline: vec![],
            round: RoundRuntimeState {
                round_number: 1,
                completed_round_count: 0,
                active_combatant_id: Some("actor-1".to_owned()),
                extra_turn_resume_phase: None,
                roster: vec![crate::RoundRosterEntry {
                    combatant_id: "actor-1".to_owned(),
                    normal_turn_slot: 0,
                    status: crate::RoundRosterStatus::Pending,
                }],
            },
            objectives: ObjectiveRuntimeState {
                objectives: vec![],
                required_objective_ids: vec![],
                completed_objective_ids: vec![],
                failed_objective_ids: vec![],
                committed_signals: vec![],
                failure_records: vec![],
            },
            reinforcements: ReinforcementRuntimeState {
                reinforcements: vec![],
            },
            provisional_delta: ProvisionalRuntimeDelta {
                revision: 0,
                entries: vec![],
            },
            scheduler: None,
            pending_reaction: None,
            result_candidates: vec![],
            terminal_priority_policy: crate::TerminalPriorityPolicy::default(),
            confirmed_result_candidate_id: None,
            confirmed_result: None,
            rng,
        }
    }

    fn combatant(id: &str, side: CombatSide) -> CombatantRuntime {
        CombatantRuntime {
            combatant_id: id.to_owned(),
            definition_id: format!("definition-{id}"),
            side,
            state: CombatantState::Active,
            hit_points: 10,
            max_hit_points: 10,
            shield: 0,
            max_shield: 0,
            action_points: 2,
            max_action_points: 2,
            reaction_charges: 1,
            max_reaction_charges: 1,
            resources: vec![
                crate::ResourceState {
                    resource_id: "mana".to_owned(),
                    current: 3,
                    min_value: 0,
                    max_value: 3,
                    overheat_threshold: None,
                    hard_max_value: None,
                },
                crate::ResourceState {
                    resource_id: "heat".to_owned(),
                    current: 7,
                    min_value: 0,
                    max_value: 8,
                    overheat_threshold: Some(8),
                    hard_max_value: Some(10),
                },
            ],
            statuses: vec![],
            ability_usage: vec![AbilityUsageState {
                ability_id: "ability-strike".to_owned(),
                cooldown_remaining: 0,
                uses_this_normal_owner_turn: 0,
                uses_this_battle: 0,
            }],
            basic_attack_count_this_normal_owner_turn: 0,
            once_usage_counters: vec![],
            normal_owner_turn_index: 0,
            initiative_result: 10,
            initiative_base_stat: 2,
            last_committed_timeline_order: None,
            solo_recovery_available: false,
        }
    }
}

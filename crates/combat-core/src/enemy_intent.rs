use std::{collections::BTreeSet, error::Error, fmt};

use crate::{
    BaseUtilityProfile, CombatPhase, CombatSide, CombatState, CombatStateInvariantValidator,
    EnemyIntentCategory, EnemyIntentPlan, EnemyIntentReplanReason, EnemyIntentReplanRecord,
    EnemyIntentTelegraphLevel, EventSchedulerStatus, LegalUtilityCommand, ReactionWindowStatus,
    SharedUtilityEvaluator, UtilityActionCategory, UtilityEvaluationError,
    UtilityEvaluationRequest, UtilityIntentConstraints, UtilityPersonality, UtilityPreferences,
    UtilityStrategy,
};

const INTENT_PREFERENCE_BONUS: i64 = 100;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EnemyIntentCandidate {
    pub command: LegalUtilityCommand,
    pub intent_category: EnemyIntentCategory,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EnemyIntentProfileInput<'a> {
    pub enemy_id: &'a str,
    pub candidates: &'a [EnemyIntentCandidate],
    pub base_profile: &'a BaseUtilityProfile,
    pub personality: &'a UtilityPersonality,
    pub strategy: Option<&'a UtilityStrategy>,
    pub preferences: &'a UtilityPreferences,
    pub intent_constraints: &'a UtilityIntentConstraints,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EnemyIntentRoundStartRequest<'a> {
    pub enemies: Vec<EnemyIntentProfileInput<'a>>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EnemyIntentReplanRequest<'a> {
    pub enemy: EnemyIntentProfileInput<'a>,
    pub reason: EnemyIntentReplanReason,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EnemyIntentErrorCode {
    NotRoundStartStablePoint,
    NotStableReplanPoint,
    InvalidEnemyInputs,
    MissingLegalCommand,
    InvalidCategoryMapping,
    ReplanNotAllowed,
    SequenceExhausted,
    UtilityEvaluation,
    InvalidCommittedState,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EnemyIntentError {
    pub code: EnemyIntentErrorCode,
    pub subject: String,
}

impl fmt::Display for EnemyIntentError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "enemy intent planning failed for {}: {:?}",
            self.subject, self.code
        )
    }
}

impl Error for EnemyIntentError {}

pub struct EnemyIntentPlanner;

impl EnemyIntentPlanner {
    pub fn refresh_round_start(
        state: &mut CombatState,
        request: EnemyIntentRoundStartRequest<'_>,
    ) -> Result<Vec<EnemyIntentPlan>, EnemyIntentError> {
        if state.phase != CombatPhase::RoundStart || !stable_point(state) {
            return Err(intent_error(
                EnemyIntentErrorCode::NotRoundStartStablePoint,
                "roundStart",
            ));
        }
        CombatStateInvariantValidator::validate(state).map_err(|_| {
            intent_error(EnemyIntentErrorCode::InvalidCommittedState, "combatState")
        })?;
        let ordered_enemy_ids = ordered_active_enemies(state);
        validate_inputs(&ordered_enemy_ids, &request.enemies)?;
        let mut working = state.clone();
        let mut next_sequence = maximum_intent_sequence(&working.enemy_intents);
        let mut plans = Vec::with_capacity(ordered_enemy_ids.len());
        for enemy_id in ordered_enemy_ids {
            let input = request
                .enemies
                .iter()
                .find(|input| input.enemy_id == enemy_id)
                .ok_or_else(|| intent_error(EnemyIntentErrorCode::InvalidEnemyInputs, &enemy_id))?;
            next_sequence = next_sequence.checked_add(1).ok_or_else(|| {
                intent_error(EnemyIntentErrorCode::SequenceExhausted, "createdSequence")
            })?;
            let previous_records = working
                .enemy_intents
                .iter()
                .find(|plan| plan.enemy_id == enemy_id)
                .map_or_else(Vec::new, |plan| plan.replan_records.clone());
            plans.push(build_plan(
                &working,
                input,
                next_sequence,
                previous_records,
            )?);
        }
        working.enemy_intents = plans.clone();
        working.revision = working.revision.checked_add(1).ok_or_else(|| {
            intent_error(EnemyIntentErrorCode::SequenceExhausted, "combatRevision")
        })?;
        CombatStateInvariantValidator::validate(&working).map_err(|_| {
            intent_error(EnemyIntentErrorCode::InvalidCommittedState, "enemyIntents")
        })?;
        *state = working;
        Ok(plans)
    }

    pub fn replan(
        state: &mut CombatState,
        request: EnemyIntentReplanRequest<'_>,
    ) -> Result<EnemyIntentPlan, EnemyIntentError> {
        if !matches!(state.phase, CombatPhase::RoundStart | CombatPhase::Stable)
            || !stable_point(state)
        {
            return Err(intent_error(
                EnemyIntentErrorCode::NotStableReplanPoint,
                request.enemy.enemy_id,
            ));
        }
        CombatStateInvariantValidator::validate(state).map_err(|_| {
            intent_error(EnemyIntentErrorCode::InvalidCommittedState, "combatState")
        })?;
        validate_inputs(
            &[request.enemy.enemy_id.to_owned()],
            std::slice::from_ref(&request.enemy),
        )?;
        let current = state
            .enemy_intents
            .iter()
            .find(|plan| plan.enemy_id == request.enemy.enemy_id)
            .ok_or_else(|| {
                intent_error(
                    EnemyIntentErrorCode::ReplanNotAllowed,
                    request.enemy.enemy_id,
                )
            })?;
        validate_replan_reason(current, &request)?;
        let sequence = maximum_intent_sequence(&state.enemy_intents)
            .checked_add(1)
            .ok_or_else(|| {
                intent_error(EnemyIntentErrorCode::SequenceExhausted, "createdSequence")
            })?;
        let mut records = current.replan_records.clone();
        let mut next = build_plan(state, &request.enemy, sequence, records.clone())?;
        records.push(EnemyIntentReplanRecord {
            sequence,
            reason: request.reason,
            previous_category: current.intent_category,
            next_category: next.intent_category,
            debug_message_zh_cn: format!(
                "敌人调整了行动意图：{} → {}",
                current.intent_category.label_zh_cn(),
                next.intent_category.label_zh_cn()
            ),
        });
        next.replan_records = records;

        let mut working = state.clone();
        let slot = working
            .enemy_intents
            .iter_mut()
            .find(|plan| plan.enemy_id == request.enemy.enemy_id)
            .ok_or_else(|| {
                intent_error(
                    EnemyIntentErrorCode::ReplanNotAllowed,
                    request.enemy.enemy_id,
                )
            })?;
        *slot = next.clone();
        working.revision = working.revision.checked_add(1).ok_or_else(|| {
            intent_error(EnemyIntentErrorCode::SequenceExhausted, "combatRevision")
        })?;
        CombatStateInvariantValidator::validate(&working).map_err(|_| {
            intent_error(EnemyIntentErrorCode::InvalidCommittedState, "enemyIntents")
        })?;
        *state = working;
        Ok(next)
    }
}

impl EnemyIntentPlan {
    #[must_use]
    pub fn utility_constraints(&self) -> UtilityIntentConstraints {
        UtilityIntentConstraints {
            allowed_categories: vec![],
            preferred_category: Some(self.preferred_utility_category),
            preferred_category_bonus: INTENT_PREFERENCE_BONUS,
            non_preferred_category_penalty: 0,
        }
    }
}

fn build_plan(
    state: &CombatState,
    input: &EnemyIntentProfileInput<'_>,
    sequence: u64,
    replan_records: Vec<EnemyIntentReplanRecord>,
) -> Result<EnemyIntentPlan, EnemyIntentError> {
    validate_candidates(input)?;
    let commands: Vec<_> = input
        .candidates
        .iter()
        .map(|candidate| candidate.command.clone())
        .collect();
    let evaluation = SharedUtilityEvaluator::evaluate(&UtilityEvaluationRequest {
        state,
        actor_id: input.enemy_id,
        legal_commands: &commands,
        base_profile: input.base_profile,
        personality: input.personality,
        strategy: input.strategy,
        preferences: input.preferences,
        intent_constraints: input.intent_constraints,
    })
    .map_err(map_utility)?;
    let selected = evaluation
        .candidates
        .first()
        .ok_or_else(|| intent_error(EnemyIntentErrorCode::MissingLegalCommand, input.enemy_id))?;
    let mapped = input
        .candidates
        .iter()
        .find(|candidate| candidate.command == selected.command)
        .ok_or_else(|| intent_error(EnemyIntentErrorCode::InvalidEnemyInputs, input.enemy_id))?;
    let gap = evaluation.candidates.get(1).map_or(i64::MAX, |second| {
        selected
            .score
            .total_score
            .saturating_sub(second.score.total_score)
    });
    let telegraph_level = if gap >= 50 {
        EnemyIntentTelegraphLevel::High
    } else if gap >= 10 {
        EnemyIntentTelegraphLevel::Medium
    } else {
        EnemyIntentTelegraphLevel::Low
    };
    Ok(EnemyIntentPlan {
        enemy_id: input.enemy_id.to_owned(),
        intent_category: mapped.intent_category,
        preferred_utility_category: selected.command.category,
        display_label_zh_cn: mapped.intent_category.label_zh_cn().to_owned(),
        target_hint: Some(selected.command.target_id.clone()),
        telegraph_level,
        created_sequence: sequence,
        created_round: state.round.round_number,
        replan_records,
    })
}

fn validate_inputs(
    ordered_enemy_ids: &[String],
    inputs: &[EnemyIntentProfileInput<'_>],
) -> Result<(), EnemyIntentError> {
    let mut ids = BTreeSet::new();
    if inputs.len() != ordered_enemy_ids.len()
        || inputs.iter().any(|input| {
            !ids.insert(input.enemy_id)
                || !ordered_enemy_ids
                    .iter()
                    .any(|enemy_id| enemy_id == input.enemy_id)
        })
    {
        return Err(intent_error(
            EnemyIntentErrorCode::InvalidEnemyInputs,
            "enemies",
        ));
    }
    Ok(())
}

fn validate_candidates(input: &EnemyIntentProfileInput<'_>) -> Result<(), EnemyIntentError> {
    for candidate in input.candidates {
        if !category_mapping_is_valid(candidate.intent_category, candidate.command.category) {
            return Err(intent_error(
                EnemyIntentErrorCode::InvalidCategoryMapping,
                &candidate.command.ability_id,
            ));
        }
    }
    Ok(())
}

fn validate_replan_reason(
    current: &EnemyIntentPlan,
    request: &EnemyIntentReplanRequest<'_>,
) -> Result<(), EnemyIntentError> {
    let has_matching_category = request
        .enemy
        .candidates
        .iter()
        .any(|candidate| candidate.intent_category == current.intent_category);
    let target_still_legal = current.target_hint.as_ref().is_some_and(|target| {
        request
            .enemy
            .candidates
            .iter()
            .any(|candidate| candidate.command.target_id == *target)
    });
    let allowed = match request.reason {
        EnemyIntentReplanReason::NoMatchingLegalCommand => !has_matching_category,
        EnemyIntentReplanReason::TargetLegalityChanged => !target_still_legal,
        EnemyIntentReplanReason::ExplicitTrigger
        | EnemyIntentReplanReason::BossPhaseTransition
        | EnemyIntentReplanReason::EncounterScript => true,
    };
    if allowed {
        Ok(())
    } else {
        Err(intent_error(
            EnemyIntentErrorCode::ReplanNotAllowed,
            request.enemy.enemy_id,
        ))
    }
}

fn category_mapping_is_valid(intent: EnemyIntentCategory, utility: UtilityActionCategory) -> bool {
    matches!(
        (intent, utility),
        (EnemyIntentCategory::Attack, UtilityActionCategory::Damage)
            | (EnemyIntentCategory::Charge, UtilityActionCategory::Resource)
            | (EnemyIntentCategory::Control, UtilityActionCategory::Control)
            | (EnemyIntentCategory::Defend, UtilityActionCategory::Defense)
            | (EnemyIntentCategory::Heal, UtilityActionCategory::Heal)
            | (
                EnemyIntentCategory::Ritual | EnemyIntentCategory::Special,
                _
            )
    )
}

fn ordered_active_enemies(state: &CombatState) -> Vec<String> {
    let active_hostiles: BTreeSet<_> = state
        .combatants
        .iter()
        .filter(|combatant| {
            combatant.side == CombatSide::Hostile
                && combatant.state == crate::CombatantState::Active
        })
        .map(|combatant| combatant.combatant_id.clone())
        .collect();
    let mut ordered = Vec::new();
    for entry in &state.timeline {
        if active_hostiles.contains(&entry.combatant_id) && !ordered.contains(&entry.combatant_id) {
            ordered.push(entry.combatant_id.clone());
        }
    }
    for enemy_id in active_hostiles {
        if !ordered.contains(&enemy_id) {
            ordered.push(enemy_id);
        }
    }
    ordered
}

fn maximum_intent_sequence(plans: &[EnemyIntentPlan]) -> u64 {
    plans
        .iter()
        .flat_map(|plan| {
            std::iter::once(plan.created_sequence)
                .chain(plan.replan_records.iter().map(|record| record.sequence))
        })
        .max()
        .unwrap_or(0)
}

fn stable_point(state: &CombatState) -> bool {
    state.resolution_context.is_none()
        && !state
            .pending_reaction
            .as_ref()
            .is_some_and(|window| window.status == ReactionWindowStatus::Unresolved)
        && state.scheduler.as_ref().is_none_or(|scheduler| {
            scheduler.status == EventSchedulerStatus::Active
                && scheduler.queue.is_empty()
                && scheduler.current_item.is_none()
        })
}

fn map_utility(error: UtilityEvaluationError) -> EnemyIntentError {
    intent_error(EnemyIntentErrorCode::UtilityEvaluation, error.subject)
}

fn intent_error(code: EnemyIntentErrorCode, subject: impl Into<String>) -> EnemyIntentError {
    EnemyIntentError {
        code,
        subject: subject.into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        AcceptedCommandLedger, CURRENT_COMBAT_VERSIONS, CombatRng, CombatantRuntime,
        CombatantState, EnemyAiController, EnemyAiDecisionRequest, EnemyAiLegalCommand,
        EnemyAiSubmissionFacts, HardCcDrRuntime, ObjectiveRuntimeState, ProvisionalRuntimeDelta,
        ReinforcementRuntimeState, ResourceState, RoundRuntimeState, ShieldRechargeRuntime,
        TerminalPriorityPolicy, TimelineEntry, UtilityCandidateProjection,
        UtilityWeightAdjustments, UtilityWeights,
    };

    const SEED: &str = "55667788990011223344aabbccddeeff";

    #[test]
    fn first_round_refresh_orders_enemies_by_timeline_and_creates_chinese_visible_state_without_rng()
     {
        let mut state = state();
        let rng_before = state.rng.clone();
        let layers = layers();
        let a = candidates_a();
        let b = candidates_b();
        let plans = EnemyIntentPlanner::refresh_round_start(
            &mut state,
            EnemyIntentRoundStartRequest {
                enemies: vec![input("enemy-a", &a, &layers), input("enemy-b", &b, &layers)],
            },
        )
        .unwrap();

        assert_eq!(
            plans
                .iter()
                .map(|plan| plan.enemy_id.as_str())
                .collect::<Vec<_>>(),
            ["enemy-b", "enemy-a"]
        );
        assert_eq!(plans[0].intent_category, EnemyIntentCategory::Heal);
        assert_eq!(plans[0].display_label_zh_cn, "治疗");
        assert_eq!(plans[1].intent_category, EnemyIntentCategory::Attack);
        assert_eq!(plans[1].display_label_zh_cn, "攻击");
        assert!(plans.iter().all(|plan| plan.created_round == 1));
        assert!(plans.iter().all(|plan| plan.replan_records.is_empty()));
        assert_eq!(state.rng, rng_before);
        assert_eq!(
            [
                EnemyIntentCategory::Attack,
                EnemyIntentCategory::Charge,
                EnemyIntentCategory::Control,
                EnemyIntentCategory::Defend,
                EnemyIntentCategory::Heal,
                EnemyIntentCategory::Ritual,
                EnemyIntentCategory::Special,
            ]
            .map(EnemyIntentCategory::label_zh_cn),
            ["攻击", "蓄力", "控制", "防御", "治疗", "仪式", "特殊行动"]
        );
    }

    #[test]
    fn refresh_is_deterministic_under_input_and_candidate_reordering() {
        let layers = layers();
        let a = candidates_a();
        let b = candidates_b();
        let mut first_state = state();
        EnemyIntentPlanner::refresh_round_start(
            &mut first_state,
            EnemyIntentRoundStartRequest {
                enemies: vec![input("enemy-a", &a, &layers), input("enemy-b", &b, &layers)],
            },
        )
        .unwrap();

        let mut reversed_a = a.clone();
        reversed_a.reverse();
        let mut reversed_b = b.clone();
        reversed_b.reverse();
        let mut second_state = state();
        EnemyIntentPlanner::refresh_round_start(
            &mut second_state,
            EnemyIntentRoundStartRequest {
                enemies: vec![
                    input("enemy-b", &reversed_b, &layers),
                    input("enemy-a", &reversed_a, &layers),
                ],
            },
        )
        .unwrap();
        assert_eq!(first_state, second_state);
        assert_eq!(
            serde_json::to_vec(&first_state.enemy_intents).unwrap(),
            serde_json::to_vec(&second_state.enemy_intents).unwrap()
        );
    }

    #[test]
    fn generated_plan_drives_actual_enemy_utility_preference_and_replayable_command() {
        let mut state = state();
        let layers = layers();
        let a = candidates_a();
        let b = candidates_b();
        EnemyIntentPlanner::refresh_round_start(
            &mut state,
            EnemyIntentRoundStartRequest {
                enemies: vec![input("enemy-b", &b, &layers), input("enemy-a", &a, &layers)],
            },
        )
        .unwrap();
        let plan = state
            .enemy_intents
            .iter()
            .find(|plan| plan.enemy_id == "enemy-a")
            .unwrap()
            .clone();
        let constraints = plan.utility_constraints();
        let legal: Vec<_> = a
            .iter()
            .enumerate()
            .map(|(index, candidate)| legal_ai(index, candidate.command.clone()))
            .collect();
        let mut ledger = AcceptedCommandLedger::new();
        let decision = EnemyAiController::decide_and_submit(
            &mut state,
            &mut ledger,
            EnemyAiDecisionRequest {
                actor_id: "enemy-a",
                legal_commands: &legal,
                base_profile: &layers.0,
                personality: &layers.1,
                strategy: Some(&layers.2),
                preferences: &layers.3,
                intent_constraints: &constraints,
                random_equal_score_tie_break: false,
            },
        )
        .unwrap();
        assert_eq!(
            decision.selected.command.category,
            plan.preferred_utility_category
        );
        assert_eq!(
            decision.selected.command.category,
            UtilityActionCategory::Damage
        );
        ledger
            .validate_replay(
                &decision.accepted.command.command,
                &decision.accepted.command.command.replay_envelope(),
            )
            .unwrap();
    }

    #[test]
    fn replan_requires_a_frozen_reason_and_records_chinese_debug_metadata() {
        let mut state = state();
        let layers = layers();
        let a = candidates_a();
        let b = candidates_b();
        EnemyIntentPlanner::refresh_round_start(
            &mut state,
            EnemyIntentRoundStartRequest {
                enemies: vec![input("enemy-a", &a, &layers), input("enemy-b", &b, &layers)],
            },
        )
        .unwrap();
        let defend = vec![candidate(
            "ability.guard",
            "enemy-a",
            UtilityActionCategory::Defense,
            EnemyIntentCategory::Defend,
            0,
            0,
            8,
        )];
        let replanned = EnemyIntentPlanner::replan(
            &mut state,
            EnemyIntentReplanRequest {
                enemy: input("enemy-a", &defend, &layers),
                reason: EnemyIntentReplanReason::NoMatchingLegalCommand,
            },
        )
        .unwrap();
        assert_eq!(replanned.intent_category, EnemyIntentCategory::Defend);
        assert_eq!(replanned.display_label_zh_cn, "防御");
        assert_eq!(replanned.replan_records.len(), 1);
        assert_eq!(
            replanned.replan_records[0].debug_message_zh_cn,
            "敌人调整了行动意图：攻击 → 防御"
        );

        let before = state.clone();
        assert_eq!(
            EnemyIntentPlanner::replan(
                &mut state,
                EnemyIntentReplanRequest {
                    enemy: input("enemy-a", &defend, &layers),
                    reason: EnemyIntentReplanReason::NoMatchingLegalCommand,
                },
            )
            .unwrap_err()
            .code,
            EnemyIntentErrorCode::ReplanNotAllowed
        );
        assert_eq!(state, before);

        state.round.round_number = 2;
        state.round.completed_round_count = 1;
        let refreshed = EnemyIntentPlanner::refresh_round_start(
            &mut state,
            EnemyIntentRoundStartRequest {
                enemies: vec![input("enemy-a", &a, &layers), input("enemy-b", &b, &layers)],
            },
        )
        .unwrap();
        let refreshed_a = refreshed
            .iter()
            .find(|plan| plan.enemy_id == "enemy-a")
            .unwrap();
        assert_eq!(refreshed_a.intent_category, EnemyIntentCategory::Attack);
        assert_eq!(refreshed_a.created_round, 2);
        assert_eq!(refreshed_a.replan_records.len(), 1);
        assert!(refreshed_a.created_sequence > refreshed_a.replan_records[0].sequence);
    }

    #[test]
    fn wrong_lifecycle_incomplete_inputs_and_invalid_mapping_fail_atomically() {
        let layers = layers();
        let a = candidates_a();
        let mut stable_state = state();
        stable_state.phase = CombatPhase::Stable;
        let stable_before = stable_state.clone();
        assert_eq!(
            EnemyIntentPlanner::refresh_round_start(
                &mut stable_state,
                EnemyIntentRoundStartRequest {
                    enemies: vec![input("enemy-a", &a, &layers)],
                },
            )
            .unwrap_err()
            .code,
            EnemyIntentErrorCode::NotRoundStartStablePoint
        );
        assert_eq!(stable_state, stable_before);

        let mut incomplete_state = state();
        let incomplete_before = incomplete_state.clone();
        assert_eq!(
            EnemyIntentPlanner::refresh_round_start(
                &mut incomplete_state,
                EnemyIntentRoundStartRequest {
                    enemies: vec![input("enemy-a", &a, &layers)],
                },
            )
            .unwrap_err()
            .code,
            EnemyIntentErrorCode::InvalidEnemyInputs
        );
        assert_eq!(incomplete_state, incomplete_before);

        let mut invalid_state = state();
        let invalid_before = invalid_state.clone();
        let invalid = vec![candidate(
            "ability.bad-map",
            "hero",
            UtilityActionCategory::Damage,
            EnemyIntentCategory::Heal,
            3,
            0,
            0,
        )];
        let b = candidates_b();
        assert_eq!(
            EnemyIntentPlanner::refresh_round_start(
                &mut invalid_state,
                EnemyIntentRoundStartRequest {
                    enemies: vec![
                        input("enemy-a", &invalid, &layers),
                        input("enemy-b", &b, &layers),
                    ],
                },
            )
            .unwrap_err()
            .code,
            EnemyIntentErrorCode::InvalidCategoryMapping
        );
        assert_eq!(invalid_state, invalid_before);
    }

    #[test]
    fn invariant_rejects_tampered_visible_intent_metadata() {
        let mut state = state();
        let layers = layers();
        let a = candidates_a();
        let b = candidates_b();
        EnemyIntentPlanner::refresh_round_start(
            &mut state,
            EnemyIntentRoundStartRequest {
                enemies: vec![input("enemy-a", &a, &layers), input("enemy-b", &b, &layers)],
            },
        )
        .unwrap();
        state.enemy_intents[0].display_label_zh_cn = "未知意图".to_owned();

        assert_eq!(
            CombatStateInvariantValidator::validate(&state)
                .unwrap_err()
                .code,
            crate::CombatStateInvariantCode::EnemyIntentRuntimeInvalid
        );
    }

    type Layers = (
        BaseUtilityProfile,
        UtilityPersonality,
        UtilityStrategy,
        UtilityPreferences,
        UtilityIntentConstraints,
    );

    fn layers() -> Layers {
        (
            BaseUtilityProfile {
                profile_id: "profile.intent".to_owned(),
                weights: UtilityWeights {
                    damage: 100,
                    kill: 0,
                    control: 100,
                    heal: 100,
                    defense: 100,
                    resource: 100,
                    risk: 0,
                    intent: 100,
                },
            },
            UtilityPersonality {
                personality_id: "personality.intent".to_owned(),
                adjustments: UtilityWeightAdjustments::default(),
            },
            UtilityStrategy {
                strategy_id: "strategy.intent".to_owned(),
                adjustments: UtilityWeightAdjustments::default(),
            },
            UtilityPreferences {
                preferred_tags: vec![],
                avoided_tags: vec![],
                preferred_tag_bonus: 0,
                avoided_tag_penalty: 0,
            },
            UtilityIntentConstraints {
                allowed_categories: vec![],
                preferred_category: None,
                preferred_category_bonus: 0,
                non_preferred_category_penalty: 0,
            },
        )
    }

    fn input<'a>(
        enemy_id: &'a str,
        candidates: &'a [EnemyIntentCandidate],
        layers: &'a Layers,
    ) -> EnemyIntentProfileInput<'a> {
        EnemyIntentProfileInput {
            enemy_id,
            candidates,
            base_profile: &layers.0,
            personality: &layers.1,
            strategy: Some(&layers.2),
            preferences: &layers.3,
            intent_constraints: &layers.4,
        }
    }

    fn candidates_a() -> Vec<EnemyIntentCandidate> {
        vec![
            candidate(
                "ability.attack",
                "hero",
                UtilityActionCategory::Damage,
                EnemyIntentCategory::Attack,
                8,
                0,
                0,
            ),
            candidate(
                "ability.control",
                "hero",
                UtilityActionCategory::Control,
                EnemyIntentCategory::Control,
                0,
                0,
                0,
            ),
        ]
    }

    fn candidates_b() -> Vec<EnemyIntentCandidate> {
        vec![
            candidate(
                "ability.heal",
                "enemy-b",
                UtilityActionCategory::Heal,
                EnemyIntentCategory::Heal,
                0,
                6,
                0,
            ),
            candidate(
                "ability.attack",
                "hero",
                UtilityActionCategory::Damage,
                EnemyIntentCategory::Attack,
                1,
                0,
                0,
            ),
        ]
    }

    fn candidate(
        ability_id: &str,
        target_id: &str,
        utility_category: UtilityActionCategory,
        intent_category: EnemyIntentCategory,
        damage: i64,
        heal: i64,
        defense: i64,
    ) -> EnemyIntentCandidate {
        EnemyIntentCandidate {
            command: LegalUtilityCommand {
                ability_id: ability_id.to_owned(),
                target_id: target_id.to_owned(),
                category: utility_category,
                tags: vec![],
                tactical_priority: 0,
                projection: UtilityCandidateProjection {
                    damage_amount: damage,
                    healing_amount: heal,
                    defense_amount: defense,
                    resource_amount: 0,
                    control_basis_points: if utility_category == UtilityActionCategory::Control {
                        500
                    } else {
                        0
                    },
                    risk_basis_points: 0,
                    base_intent_score: 0,
                },
            },
            intent_category,
        }
    }

    fn legal_ai(index: usize, command: LegalUtilityCommand) -> EnemyAiLegalCommand {
        EnemyAiLegalCommand {
            command_id: format!("enemy-a-command-{index}"),
            submission: EnemyAiSubmissionFacts {
                known_ability_ids: vec![command.ability_id.clone()],
                disabled_ability_ids: vec![],
                legal_target_ids: vec![command.target_id.clone()],
                entity_tags: vec![],
                ability_preconditions: vec![],
                costs: vec![],
                parent_reservation_id: None,
            },
            utility: command,
        }
    }

    fn state() -> CombatState {
        CombatState {
            combat_instance_id: "combat-enemy-intent".to_owned(),
            versions: CURRENT_COMBAT_VERSIONS,
            random_seed: SEED.to_owned(),
            revision: 1,
            last_committed_sequence: 0,
            phase: CombatPhase::RoundStart,
            combatants: vec![
                combatant("enemy-a", CombatSide::Hostile, 10),
                combatant("enemy-b", CombatSide::Hostile, 4),
                combatant("hero", CombatSide::Player, 10),
            ],
            formal_party_member_ids: vec!["hero".to_owned()],
            combat_inventory: vec![],
            cost_reservations: vec![],
            resolution_context: None,
            timeline: vec![
                timeline("enemy-b", 20),
                timeline("enemy-a", 15),
                timeline("hero", 10),
            ],
            round: RoundRuntimeState {
                round_number: 1,
                completed_round_count: 0,
                active_combatant_id: None,
                extra_turn_resume_phase: None,
                roster: vec![],
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
            enemy_intents: vec![],
            result_candidates: vec![],
            terminal_priority_policy: TerminalPriorityPolicy::default(),
            confirmed_result_candidate_id: None,
            confirmed_result: None,
            rng: CombatRng::new(
                SEED,
                "combat-enemy-intent",
                CURRENT_COMBAT_VERSIONS.rng_contract_version,
            )
            .unwrap()
            .snapshot(),
        }
    }

    fn timeline(combatant_id: &str, initiative_result: i64) -> TimelineEntry {
        TimelineEntry {
            combatant_id: combatant_id.to_owned(),
            initiative_result,
            initiative_base_stat: 0,
            is_extra_turn: false,
            source_sequence: 1,
        }
    }

    fn combatant(id: &str, side: CombatSide, hit_points: i64) -> CombatantRuntime {
        CombatantRuntime {
            combatant_id: id.to_owned(),
            definition_id: format!("definition-{id}"),
            side,
            state: CombatantState::Active,
            hit_points,
            max_hit_points: 10,
            shield: 0,
            max_shield: 0,
            action_points: 3,
            max_action_points: 3,
            reaction_charges: 1,
            max_reaction_charges: 1,
            resources: vec![ResourceState {
                resource_id: "energy".to_owned(),
                current: 5,
                min_value: 0,
                max_value: 10,
                overheat_threshold: None,
                hard_max_value: None,
            }],
            statuses: vec![],
            ability_usage: vec![],
            basic_attack_count_this_normal_owner_turn: 0,
            once_usage_counters: vec![],
            normal_owner_turn_index: 0,
            hard_cc_dr: HardCcDrRuntime::default(),
            shield_recharge: ShieldRechargeRuntime::default(),
            initiative_result: 10,
            initiative_base_stat: 2,
            last_committed_timeline_order: None,
            solo_recovery_available: false,
        }
    }
}

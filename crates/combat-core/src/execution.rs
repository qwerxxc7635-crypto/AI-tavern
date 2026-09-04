use std::{error::Error, fmt};

use serde::{Deserialize, Serialize};

use crate::{
    CombatCommandPayload, CombatState, CostReservationError, CostReservationModel,
    CostReservationReceipt, EntityTagFacts, PreconditionDefinitionError, PreconditionEvaluation,
    PreconditionEvaluationContext, PreconditionRule, PreconditionRuleSpec, PreconditionRuleSystem,
    PreconditionTiming, ResolutionContext, ResolutionContextError, ResolutionContextLifecycle,
    ResolutionContextStatus, UsageCounterScope, submission::mandatory_command_rules,
};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OnceUsageCommit {
    pub counter_id: String,
    pub scope: UsageCounterScope,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AbilityUsageCommitPlan {
    pub ability_id: String,
    pub cooldown_turns: Option<i64>,
    pub increment_uses_this_normal_owner_turn: bool,
    pub increment_uses_this_battle: bool,
    pub increment_basic_attack_count: bool,
    pub once_counters: Vec<OnceUsageCommit>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExecutionRevalidationRequest {
    pub known_ability_ids: Vec<String>,
    pub disabled_ability_ids: Vec<String>,
    pub legal_target_ids: Vec<String>,
    pub entity_tags: Vec<EntityTagFacts>,
    pub ability_preconditions: Vec<PreconditionRuleSpec>,
    pub usage_commit: Option<AbilityUsageCommitPlan>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ExecutionRevalidationOutcome {
    ReadyForResolution {
        preconditions: PreconditionEvaluation,
        context: ResolutionContext,
        cost_commit: Option<CostReservationReceipt>,
    },
    CancelledBeforeResolution {
        preconditions: PreconditionEvaluation,
        context: ResolutionContext,
        cost_disposition: Option<CostReservationReceipt>,
    },
}

#[derive(Debug)]
pub enum ExecutionRevalidationError {
    Context(ResolutionContextError),
    ContextNotReady,
    PreconditionDefinition(PreconditionDefinitionError),
    Cost(CostReservationError),
    InvalidUsagePlan { path: String },
    NumericOverflow,
    StateInvariant,
}

impl fmt::Display for ExecutionRevalidationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("combat execution revalidation failed")
    }
}

impl Error for ExecutionRevalidationError {}

pub struct ExecutionRevalidationService;

impl ExecutionRevalidationService {
    pub fn revalidate_and_commit(
        state: &mut CombatState,
        request: ExecutionRevalidationRequest,
    ) -> Result<ExecutionRevalidationOutcome, ExecutionRevalidationError> {
        ResolutionContextLifecycle::validate_state(state)
            .map_err(ExecutionRevalidationError::Context)?;
        let context = state
            .resolution_context
            .as_ref()
            .filter(|context| {
                context.status == ResolutionContextStatus::ReadyForExecutionRevalidation
            })
            .cloned()
            .ok_or(ExecutionRevalidationError::ContextNotReady)?;
        validate_usage_plan(&context, request.usage_commit.as_ref())?;

        let envelope = context.command.replay_envelope();
        let rules = execution_rules(&context, &request.ability_preconditions);
        let evaluation_context = PreconditionEvaluationContext {
            state,
            command: &envelope,
            effective_target_id: context.effective_target_ids.first().map(String::as_str),
            source_controls_actor: false,
            stable_input_point: false,
            reservation_id: context.reservation_id.as_deref(),
            known_ability_ids: &request.known_ability_ids,
            disabled_ability_ids: &request.disabled_ability_ids,
            legal_target_ids: &request.legal_target_ids,
            entity_tags: &request.entity_tags,
        };
        let preconditions = PreconditionRuleSystem::evaluate(
            PreconditionTiming::ExecutionRevalidation,
            &rules,
            &evaluation_context,
        )
        .map_err(ExecutionRevalidationError::PreconditionDefinition)?;
        let rng_before = state.rng.clone();

        if !preconditions.passed() {
            let mut working = state.clone();
            let mut cancelled_context = working
                .resolution_context
                .take()
                .ok_or(ExecutionRevalidationError::ContextNotReady)?;
            let cost_disposition = context
                .reservation_id
                .as_deref()
                .map(|reservation_id| {
                    CostReservationModel::cancel_before_resolution(&mut working, reservation_id)
                        .map_err(ExecutionRevalidationError::Cost)
                })
                .transpose()?;
            if cost_disposition.is_none() {
                bump_revision(&mut working)?;
            }
            cancelled_context.status = ResolutionContextStatus::CancelledBeforeResolution;
            working
                .validate_for_commit()
                .map_err(|_| ExecutionRevalidationError::StateInvariant)?;
            debug_assert_eq!(working.rng, rng_before);
            *state = working;
            return Ok(ExecutionRevalidationOutcome::CancelledBeforeResolution {
                preconditions,
                context: cancelled_context,
                cost_disposition,
            });
        }

        let mut working = state.clone();
        let active = working
            .resolution_context
            .as_mut()
            .ok_or(ExecutionRevalidationError::ContextNotReady)?;
        active.status = ResolutionContextStatus::ResolutionStarted;
        active.rng_checkpoint = working.rng.clone();
        let cost_commit = context
            .reservation_id
            .as_deref()
            .map(|reservation_id| {
                CostReservationModel::commit(&mut working, reservation_id)
                    .map_err(ExecutionRevalidationError::Cost)
            })
            .transpose()?;
        if let Some(plan) = &request.usage_commit {
            apply_usage_commit(&mut working, &context, plan)?;
        }
        if cost_commit.is_none() {
            bump_revision(&mut working)?;
        }
        let committed_context = working
            .resolution_context
            .clone()
            .ok_or(ExecutionRevalidationError::ContextNotReady)?;
        working
            .validate_for_commit()
            .map_err(|_| ExecutionRevalidationError::StateInvariant)?;
        debug_assert_eq!(working.rng, rng_before);
        *state = working;
        Ok(ExecutionRevalidationOutcome::ReadyForResolution {
            preconditions,
            context: committed_context,
            cost_commit,
        })
    }
}

fn execution_rules(
    context: &ResolutionContext,
    ability_rules: &[PreconditionRuleSpec],
) -> Vec<PreconditionRuleSpec> {
    let mut rules = mandatory_command_rules(
        &context.command.payload,
        !context.effective_target_ids.is_empty(),
    );
    if context.reservation_id.is_some() {
        rules.push(rule(
            "execution.reservation-owned",
            PreconditionRule::ReservationOwned,
        ));
    }
    rules.extend(ability_rules.iter().cloned());
    rules
}

fn rule(rule_id: &str, value: PreconditionRule) -> PreconditionRuleSpec {
    PreconditionRuleSpec::with_default_timing(rule_id, value)
}

fn validate_usage_plan(
    context: &ResolutionContext,
    plan: Option<&AbilityUsageCommitPlan>,
) -> Result<(), ExecutionRevalidationError> {
    let command_ability = match &context.command.payload {
        CombatCommandPayload::UseAbility { ability_id, .. } => Some(ability_id.as_str()),
        _ => None,
    };
    match (command_ability, plan) {
        (None, None) => return Ok(()),
        (Some(_), None) => return Ok(()),
        (Some(expected), Some(plan)) if expected == plan.ability_id => {}
        _ => return Err(invalid_usage("abilityId")),
    }
    let Some(plan) = plan else {
        return Ok(());
    };
    if plan.cooldown_turns.is_some_and(|value| value < 0) {
        return Err(invalid_usage("cooldownTurns"));
    }
    for (index, counter) in plan.once_counters.iter().enumerate() {
        if counter.counter_id.is_empty()
            || plan.once_counters[..index]
                .iter()
                .any(|previous| previous.counter_id == counter.counter_id)
        {
            return Err(invalid_usage("onceCounters"));
        }
    }
    Ok(())
}

fn apply_usage_commit(
    state: &mut CombatState,
    context: &ResolutionContext,
    plan: &AbilityUsageCommitPlan,
) -> Result<(), ExecutionRevalidationError> {
    let actor = state
        .combatants
        .iter_mut()
        .find(|actor| actor.combatant_id == context.command.actor_id)
        .ok_or_else(|| invalid_usage("actorId"))?;
    let touches_ability_usage = plan.cooldown_turns.is_some()
        || plan.increment_uses_this_normal_owner_turn
        || plan.increment_uses_this_battle;
    if touches_ability_usage {
        let usage = actor
            .ability_usage
            .iter_mut()
            .find(|usage| usage.ability_id == plan.ability_id)
            .ok_or_else(|| invalid_usage("abilityUsage"))?;
        if let Some(cooldown) = plan.cooldown_turns {
            usage.cooldown_remaining = cooldown;
        }
        if plan.increment_uses_this_normal_owner_turn {
            usage.uses_this_normal_owner_turn = usage
                .uses_this_normal_owner_turn
                .checked_add(1)
                .ok_or(ExecutionRevalidationError::NumericOverflow)?;
        }
        if plan.increment_uses_this_battle {
            usage.uses_this_battle = usage
                .uses_this_battle
                .checked_add(1)
                .ok_or(ExecutionRevalidationError::NumericOverflow)?;
        }
    }
    if plan.increment_basic_attack_count {
        actor.basic_attack_count_this_normal_owner_turn = actor
            .basic_attack_count_this_normal_owner_turn
            .checked_add(1)
            .ok_or(ExecutionRevalidationError::NumericOverflow)?;
    }
    for requested in &plan.once_counters {
        let counter = actor
            .once_usage_counters
            .iter_mut()
            .find(|counter| {
                counter.counter_id == requested.counter_id && counter.scope == requested.scope
            })
            .ok_or_else(|| invalid_usage("onceCounters"))?;
        if counter.uses != 0 {
            return Err(invalid_usage("onceCounters.uses"));
        }
        counter.uses = 1;
    }
    Ok(())
}

fn bump_revision(state: &mut CombatState) -> Result<(), ExecutionRevalidationError> {
    state.revision = state
        .revision
        .checked_add(1)
        .ok_or(ExecutionRevalidationError::NumericOverflow)?;
    Ok(())
}

fn invalid_usage(path: &str) -> ExecutionRevalidationError {
    ExecutionRevalidationError::InvalidUsagePlan {
        path: path.to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        AbilityUsageState, AcceptedCombatCommand, AcceptedCommandSource, CURRENT_COMBAT_VERSIONS,
        CombatCommandPayload, CombatCostAsset, CombatCostRequestLine, CombatInventoryItemState,
        CombatPhase, CombatRng, CombatSide, CombatantRuntime, CombatantState,
        CostReservationRequest, CostReservationStatus, HookPhase, ObjectiveRuntimeState,
        ProvisionalRuntimeDelta, ReinforcementRuntimeState, ResourceState, RoundRuntimeState,
        UsageCounterState,
    };

    const SEED: &str = "0123456789abcdef0123456789abcdef";

    #[test]
    fn pass_atomically_commits_cost_cooldown_usage_map_and_once_counters_before_rng() {
        let mut state = prepared(false);
        let rng_before = state.rng.clone();
        let outcome =
            ExecutionRevalidationService::revalidate_and_commit(&mut state, request()).unwrap();
        let ExecutionRevalidationOutcome::ReadyForResolution {
            preconditions,
            context,
            cost_commit,
        } = outcome
        else {
            panic!("expected ready outcome")
        };
        assert!(preconditions.passed());
        assert_eq!(context.status, ResolutionContextStatus::ResolutionStarted);
        assert_eq!(
            cost_commit.unwrap().record.status,
            CostReservationStatus::Committed
        );
        let actor = &state.combatants[0];
        assert_eq!(actor.action_points, 1);
        assert_eq!(actor.ability_usage[0].cooldown_remaining, 2);
        assert_eq!(actor.ability_usage[0].uses_this_normal_owner_turn, 1);
        assert_eq!(actor.ability_usage[0].uses_this_battle, 1);
        assert_eq!(actor.basic_attack_count_this_normal_owner_turn, 1);
        assert!(
            actor
                .once_usage_counters
                .iter()
                .all(|counter| counter.uses == 1)
        );
        assert_eq!(state.rng, rng_before);
    }

    #[test]
    fn dynamic_failure_cancels_releases_cost_and_never_commits_usage_or_rng() {
        let mut state = prepared(false);
        state.combatants[0].state = CombatantState::Downed;
        state.combatants[0].hit_points = 0;
        let rng_before = state.rng.clone();
        let outcome =
            ExecutionRevalidationService::revalidate_and_commit(&mut state, request()).unwrap();
        let ExecutionRevalidationOutcome::CancelledBeforeResolution {
            preconditions,
            context,
            cost_disposition,
        } = outcome
        else {
            panic!("expected cancel outcome")
        };
        assert!(!preconditions.passed());
        assert_eq!(
            context.status,
            ResolutionContextStatus::CancelledBeforeResolution
        );
        assert_eq!(
            cost_disposition.unwrap().record.status,
            CostReservationStatus::Released
        );
        assert!(state.resolution_context.is_none());
        assert_eq!(state.combatants[0].action_points, 2);
        assert_eq!(state.combatants[0].ability_usage[0].cooldown_remaining, 0);
        assert_eq!(state.combatants[0].ability_usage[0].uses_this_battle, 0);
        assert_eq!(state.rng, rng_before);
    }

    #[test]
    fn interrupt_cost_may_commit_on_cancel_but_usage_still_does_not() {
        let mut state = prepared(true);
        state.combatants[1].state = CombatantState::Removed;
        let rng_before = state.rng.clone();
        let outcome =
            ExecutionRevalidationService::revalidate_and_commit(&mut state, request()).unwrap();
        let ExecutionRevalidationOutcome::CancelledBeforeResolution {
            cost_disposition, ..
        } = outcome
        else {
            panic!("expected cancel outcome")
        };
        assert_eq!(
            cost_disposition.unwrap().record.status,
            CostReservationStatus::Interrupted
        );
        assert_eq!(state.combatants[0].action_points, 1);
        assert_eq!(
            state.combatants[0].ability_usage[0].uses_this_normal_owner_turn,
            0
        );
        assert_eq!(
            state.combatants[0].basic_attack_count_this_normal_owner_turn,
            0
        );
        assert_eq!(state.rng, rng_before);
    }

    #[test]
    fn redirected_target_is_revalidated_against_current_legal_targets() {
        let mut state = prepared(false);
        state
            .resolution_context
            .as_mut()
            .unwrap()
            .effective_target_ids[0] = "enemy-2".to_owned();
        state
            .resolution_context
            .as_mut()
            .unwrap()
            .target_redirects
            .push(crate::TargetRedirectRecord {
                sequence: 1,
                from_target_id: "enemy-1".to_owned(),
                to_target_id: "enemy-2".to_owned(),
                rule_id: "redirect-rule".to_owned(),
            });
        let mut facts = request();
        facts.legal_target_ids = vec!["enemy-1".to_owned()];
        let outcome =
            ExecutionRevalidationService::revalidate_and_commit(&mut state, facts).unwrap();
        let ExecutionRevalidationOutcome::CancelledBeforeResolution { preconditions, .. } = outcome
        else {
            panic!("expected cancel outcome")
        };
        assert!(
            preconditions
                .failures
                .iter()
                .any(|failure| { failure.code == crate::PreconditionFailureCode::TargetIllegal })
        );
    }

    #[test]
    fn atomic_usage_error_leaves_reserved_ready_context_unchanged() {
        let mut state = prepared(false);
        let before = state.clone();
        let mut invalid = request();
        invalid.usage_commit.as_mut().unwrap().once_counters[0].counter_id =
            "missing-counter".to_owned();
        invalid
            .ability_preconditions
            .retain(|rule| !matches!(rule.rule, PreconditionRule::OnceCounterUnused { .. }));
        assert!(matches!(
            ExecutionRevalidationService::revalidate_and_commit(&mut state, invalid),
            Err(ExecutionRevalidationError::InvalidUsagePlan { .. })
        ));
        assert_eq!(state, before);
    }

    #[test]
    fn committed_costs_remain_for_miss_save_success_and_post_resolution_immunity() {
        let mut state = prepared(false);
        ExecutionRevalidationService::revalidate_and_commit(&mut state, request()).unwrap();
        let committed = state.clone();
        for _outcome in ["MISS", "SAVE_SUCCESS", "IMMUNITY"] {
            assert_eq!(state.combatants[0].action_points, 1);
            assert_eq!(
                state.cost_reservations[0].status,
                CostReservationStatus::Committed
            );
            assert_eq!(state, committed);
        }
    }

    fn request() -> ExecutionRevalidationRequest {
        ExecutionRevalidationRequest {
            known_ability_ids: vec!["ability-strike".to_owned()],
            disabled_ability_ids: vec![],
            legal_target_ids: vec!["enemy-1".to_owned(), "enemy-2".to_owned()],
            entity_tags: vec![],
            ability_preconditions: vec![
                rule("ability.cooldown", PreconditionRule::CooldownReady),
                rule(
                    "ability.turn-usage",
                    PreconditionRule::NormalOwnerTurnUsesBelow { maximum: 1 },
                ),
                rule(
                    "ability.battle-usage",
                    PreconditionRule::BattleUsesBelow { maximum: 2 },
                ),
                rule(
                    "ability.map",
                    PreconditionRule::BasicAttackCountBelow { maximum: 3 },
                ),
                rule(
                    "ability.once-owner",
                    PreconditionRule::OnceCounterUnused {
                        counter_id: "once-owner".to_owned(),
                    },
                ),
            ],
            usage_commit: Some(AbilityUsageCommitPlan {
                ability_id: "ability-strike".to_owned(),
                cooldown_turns: Some(2),
                increment_uses_this_normal_owner_turn: true,
                increment_uses_this_battle: true,
                increment_basic_attack_count: true,
                once_counters: vec![
                    OnceUsageCommit {
                        counter_id: "once-owner".to_owned(),
                        scope: UsageCounterScope::OwnerTurn,
                    },
                    OnceUsageCommit {
                        counter_id: "once-round".to_owned(),
                        scope: UsageCounterScope::Round,
                    },
                    OnceUsageCommit {
                        counter_id: "once-battle".to_owned(),
                        scope: UsageCounterScope::Battle,
                    },
                ],
            }),
        }
    }

    fn prepared(consume_on_interrupt: bool) -> CombatState {
        let mut state = fixture_state();
        CostReservationModel::reserve(
            &mut state,
            CostReservationRequest {
                reservation_id: "command-1".to_owned(),
                command_id: "command-1".to_owned(),
                parent_reservation_id: None,
                costs: vec![CombatCostRequestLine {
                    cost_id: "ap".to_owned(),
                    asset: CombatCostAsset::ActionPoints {
                        combatant_id: "actor-1".to_owned(),
                    },
                    amount: 1,
                    consume_cost_on_interrupt: consume_on_interrupt,
                }],
            },
        )
        .unwrap();
        ResolutionContextLifecycle::create(
            &mut state,
            accepted_command(),
            "chain-1".to_owned(),
            Some("command-1".to_owned()),
        )
        .unwrap();
        ResolutionContextLifecycle::complete_hook(
            &mut state,
            HookPhase::PreAction,
            HookPhase::BeforeRoll,
        )
        .unwrap();
        ResolutionContextLifecycle::mark_ready_for_revalidation(&mut state).unwrap();
        state
    }

    fn accepted_command() -> AcceptedCombatCommand {
        AcceptedCombatCommand {
            accepted_sequence: 1,
            command_id: "command-1".to_owned(),
            source: AcceptedCommandSource::Player {
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
        let combatant = |id: &str, side| CombatantRuntime {
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
            resources: vec![ResourceState {
                resource_id: "mana".to_owned(),
                current: 3,
                min_value: 0,
                max_value: 3,
                overheat_threshold: None,
                hard_max_value: None,
            }],
            statuses: vec![],
            ability_usage: vec![AbilityUsageState {
                ability_id: "ability-strike".to_owned(),
                cooldown_remaining: 0,
                uses_this_normal_owner_turn: 0,
                uses_this_battle: 0,
            }],
            basic_attack_count_this_normal_owner_turn: 0,
            once_usage_counters: vec![
                UsageCounterState {
                    counter_id: "once-owner".to_owned(),
                    scope: UsageCounterScope::OwnerTurn,
                    uses: 0,
                },
                UsageCounterState {
                    counter_id: "once-round".to_owned(),
                    scope: UsageCounterScope::Round,
                    uses: 0,
                },
                UsageCounterState {
                    counter_id: "once-battle".to_owned(),
                    scope: UsageCounterScope::Battle,
                    uses: 0,
                },
            ],
            normal_owner_turn_index: 0,
            hard_cc_dr: crate::HardCcDrRuntime::default(),
            initiative_result: 10,
            initiative_base_stat: 2,
            last_committed_timeline_order: None,
            solo_recovery_available: false,
        };
        CombatState {
            combat_instance_id: "combat-execution-fixture".to_owned(),
            versions: CURRENT_COMBAT_VERSIONS,
            random_seed: SEED.to_owned(),
            revision: 1,
            last_committed_sequence: 0,
            phase: CombatPhase::Action,
            combatants: vec![
                combatant("actor-1", CombatSide::Player),
                combatant("enemy-1", CombatSide::Hostile),
                combatant("enemy-2", CombatSide::Hostile),
            ],
            formal_party_member_ids: vec![],
            combat_inventory: vec![CombatInventoryItemState {
                owner_id: "actor-1".to_owned(),
                item_id: "item-arrow".to_owned(),
                current_quantity: 1,
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
            rng: CombatRng::new(
                SEED,
                "combat-execution-fixture",
                CURRENT_COMBAT_VERSIONS.rng_contract_version,
            )
            .unwrap()
            .snapshot(),
        }
    }
}

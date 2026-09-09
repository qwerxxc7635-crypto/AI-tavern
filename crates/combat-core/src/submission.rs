use std::{error::Error, fmt};

use serde::{Deserialize, Serialize};

use crate::{
    AcceptedCommandLedger, AcceptedCommandReceipt, CombatCommandBoundaryError,
    CombatCommandEnvelope, CombatCommandPayload, CombatCommandSource, CombatCostAsset,
    CombatCostRequestLine, CombatState, CommandAcceptanceStatus, CostReservationError,
    CostReservationModel, CostReservationReceipt, CostReservationRequest, EntityTagFacts,
    ExternalInputActivity, ExternalInputBarrier, ExternalInputBarrierError,
    PreconditionDefinitionError, PreconditionEvaluation, PreconditionEvaluationContext,
    PreconditionRule, PreconditionRuleSpec, PreconditionRuleSystem, PreconditionTiming,
};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "SCREAMING_SNAKE_CASE",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum CombatControlAuthority {
    Player { controller_id: String },
    UtilityAi,
    Test { test_case_id: String },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CombatControlAssignment {
    pub combatant_id: String,
    pub authority: CombatControlAuthority,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CombatSubmissionRequest {
    pub envelope: CombatCommandEnvelope,
    pub control_assignments: Vec<CombatControlAssignment>,
    pub stable_input_point: bool,
    pub utility_ai_evaluation_in_progress: bool,
    pub known_ability_ids: Vec<String>,
    pub disabled_ability_ids: Vec<String>,
    pub legal_target_ids: Vec<String>,
    pub entity_tags: Vec<EntityTagFacts>,
    pub ability_preconditions: Vec<PreconditionRuleSpec>,
    pub costs: Vec<CombatCostRequestLine>,
    pub parent_reservation_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CombatSubmissionAccepted {
    pub command: AcceptedCommandReceipt,
    pub preconditions: PreconditionEvaluation,
    pub reservation: Option<CostReservationReceipt>,
}

#[derive(Debug)]
pub enum CombatSubmissionError {
    CommandBoundary(CombatCommandBoundaryError),
    ExternalInputBarrier(ExternalInputBarrierError),
    PreconditionDefinition(PreconditionDefinitionError),
    PreconditionsFailed(PreconditionEvaluation),
    CostReservation(CostReservationError),
    InvalidSubmissionFacts { path: String },
    InconsistentIdempotentRetry { command_id: String },
}

impl fmt::Display for CombatSubmissionError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("combat command submission failed")
    }
}

impl Error for CombatSubmissionError {}

pub struct CombatSubmissionService;

impl CombatSubmissionService {
    pub fn submit(
        state: &mut CombatState,
        accepted_commands: &mut AcceptedCommandLedger,
        request: CombatSubmissionRequest,
    ) -> Result<CombatSubmissionAccepted, CombatSubmissionError> {
        validate_submission_facts(&request)?;
        let mut working_state = state.clone();
        let mut working_commands = accepted_commands.clone();
        let command = working_commands
            .accept_external(request.envelope.clone())
            .map_err(CombatSubmissionError::CommandBoundary)?;
        if command.status == CommandAcceptanceStatus::AlreadyAccepted {
            let existing_reservation = working_state
                .cost_reservations
                .iter()
                .find(|record| record.command_id == request.envelope.command_id);
            if request.costs.is_empty() != existing_reservation.is_none() {
                return Err(CombatSubmissionError::InconsistentIdempotentRetry {
                    command_id: request.envelope.command_id,
                });
            }
            let reservation = if request.costs.is_empty() {
                None
            } else {
                Some(
                    CostReservationModel::reserve(
                        &mut working_state,
                        CostReservationRequest {
                            reservation_id: request.envelope.command_id.clone(),
                            command_id: request.envelope.command_id.clone(),
                            parent_reservation_id: request.parent_reservation_id,
                            costs: request.costs,
                        },
                    )
                    .map_err(CombatSubmissionError::CostReservation)?,
                )
            };
            return Ok(CombatSubmissionAccepted {
                command,
                preconditions: PreconditionEvaluation {
                    timing: PreconditionTiming::Submission,
                    evaluated_rule_ids: vec![],
                    failures: vec![],
                },
                reservation,
            });
        }
        ExternalInputBarrier::validate(
            state,
            &request.envelope,
            ExternalInputActivity {
                utility_ai_evaluation_in_progress: request.utility_ai_evaluation_in_progress,
            },
        )
        .map_err(CombatSubmissionError::ExternalInputBarrier)?;
        let source_controls_actor = source_controls_actor(
            &working_state,
            &request.envelope.source,
            &request.envelope.actor_id,
            &request.control_assignments,
        );
        let rules = submission_rules(&request);
        let effective_target_id = selected_target_id(&request.envelope);
        let context = PreconditionEvaluationContext {
            state: &working_state,
            command: &request.envelope,
            effective_target_id,
            source_controls_actor,
            stable_input_point: request.stable_input_point,
            reservation_id: None,
            known_ability_ids: &request.known_ability_ids,
            disabled_ability_ids: &request.disabled_ability_ids,
            legal_target_ids: &request.legal_target_ids,
            entity_tags: &request.entity_tags,
        };
        let preconditions =
            PreconditionRuleSystem::evaluate(PreconditionTiming::Submission, &rules, &context)
                .map_err(CombatSubmissionError::PreconditionDefinition)?;
        if !preconditions.passed() {
            return Err(CombatSubmissionError::PreconditionsFailed(preconditions));
        }

        let existing_reservation = working_state
            .cost_reservations
            .iter()
            .find(|record| record.command_id == request.envelope.command_id);
        if existing_reservation.is_some() {
            return Err(CombatSubmissionError::InconsistentIdempotentRetry {
                command_id: request.envelope.command_id,
            });
        }

        let reservation = if request.costs.is_empty() {
            None
        } else {
            Some(
                CostReservationModel::reserve(
                    &mut working_state,
                    CostReservationRequest {
                        reservation_id: request.envelope.command_id.clone(),
                        command_id: request.envelope.command_id.clone(),
                        parent_reservation_id: request.parent_reservation_id,
                        costs: request.costs,
                    },
                )
                .map_err(CombatSubmissionError::CostReservation)?,
            )
        };

        *state = working_state;
        *accepted_commands = working_commands;
        Ok(CombatSubmissionAccepted {
            command,
            preconditions,
            reservation,
        })
    }
}

fn submission_rules(request: &CombatSubmissionRequest) -> Vec<PreconditionRuleSpec> {
    let mut rules = mandatory_command_rules(
        &request.envelope.payload,
        selected_target_id(&request.envelope).is_some(),
    );
    for (index, cost) in request.costs.iter().enumerate() {
        let rule = match &cost.asset {
            CombatCostAsset::ActionPoints { .. } => PreconditionRule::ActionPointsAtLeast {
                amount: cost.amount,
            },
            CombatCostAsset::ReactionCharge { .. } => PreconditionRule::ReactionChargesAtLeast {
                amount: cost.amount,
            },
            CombatCostAsset::Resource { resource_id, .. } => PreconditionRule::ResourceAtLeast {
                resource_id: resource_id.clone(),
                amount: cost.amount,
            },
            CombatCostAsset::Item { item_id, .. } => PreconditionRule::ItemQuantityAtLeast {
                item_id: item_id.clone(),
                amount: cost.amount,
            },
        };
        rules.push(system_rule(&format!("submission.cost.{index}"), rule));
    }
    rules.extend(request.ability_preconditions.iter().cloned());
    rules
}

pub(crate) fn mandatory_command_rules(
    payload: &CombatCommandPayload,
    has_effective_target: bool,
) -> Vec<PreconditionRuleSpec> {
    let mut rules = vec![
        system_rule(
            "submission.source-controls-actor",
            PreconditionRule::SourceControlsActor,
        ),
        system_rule(
            "submission.stable-input-point",
            PreconditionRule::StableInputPoint,
        ),
        system_rule("submission.actor-exists", PreconditionRule::ActorExists),
        system_rule("submission.actor-may-act", PreconditionRule::ActorMayAct),
    ];
    if matches!(payload, CombatCommandPayload::UseAbility { .. }) {
        rules.push(system_rule(
            "submission.ability-exists",
            PreconditionRule::AbilityExists,
        ));
        rules.push(system_rule(
            "submission.ability-enabled",
            PreconditionRule::AbilityEnabled,
        ));
        if has_effective_target {
            rules.push(system_rule(
                "submission.target-exists",
                PreconditionRule::TargetExists,
            ));
            rules.push(system_rule(
                "submission.target-legal",
                PreconditionRule::TargetLegal,
            ));
        }
    }
    rules
}

fn system_rule(rule_id: &str, rule: PreconditionRule) -> PreconditionRuleSpec {
    PreconditionRuleSpec::with_default_timing(rule_id, rule)
}

fn selected_target_id(envelope: &CombatCommandEnvelope) -> Option<&str> {
    match &envelope.payload {
        CombatCommandPayload::UseAbility { target_id, .. } => target_id.as_deref(),
        _ => None,
    }
}

fn source_controls_actor(
    state: &CombatState,
    source: &CombatCommandSource,
    actor_id: &str,
    assignments: &[CombatControlAssignment],
) -> bool {
    let Some(actor) = state
        .combatants
        .iter()
        .find(|combatant| combatant.combatant_id == actor_id)
    else {
        return false;
    };
    let Some(assignment) = assignments
        .iter()
        .find(|assignment| assignment.combatant_id == actor_id)
    else {
        return false;
    };
    (actor.side == crate::CombatSide::Player
        && matches!(
            (source, &assignment.authority),
            (
                CombatCommandSource::Player { controller_id: left },
                CombatControlAuthority::Player { controller_id: right }
            ) if left == right
        ))
        || (actor.side != crate::CombatSide::Player
            && matches!(
                (source, &assignment.authority),
                (
                    CombatCommandSource::UtilityAi,
                    CombatControlAuthority::UtilityAi
                )
            ))
        || matches!(
            (source, &assignment.authority),
            (
                CombatCommandSource::Test { test_case_id: left },
                CombatControlAuthority::Test { test_case_id: right }
            ) if left == right
        )
}

fn validate_submission_facts(
    request: &CombatSubmissionRequest,
) -> Result<(), CombatSubmissionError> {
    for (index, assignment) in request.control_assignments.iter().enumerate() {
        if request.control_assignments[..index]
            .iter()
            .any(|previous| previous.combatant_id == assignment.combatant_id)
        {
            return Err(invalid_facts("controlAssignments"));
        }
    }
    for cost in &request.costs {
        let owner_id = match &cost.asset {
            CombatCostAsset::ActionPoints { combatant_id }
            | CombatCostAsset::ReactionCharge { combatant_id }
            | CombatCostAsset::Resource { combatant_id, .. } => combatant_id,
            CombatCostAsset::Item { owner_id, .. } => owner_id,
        };
        if owner_id != &request.envelope.actor_id {
            return Err(invalid_facts("costs.asset.owner"));
        }
    }
    if !matches!(
        request.envelope.payload,
        CombatCommandPayload::UseAbility { .. }
    ) && !request.ability_preconditions.is_empty()
    {
        return Err(invalid_facts("abilityPreconditions"));
    }
    Ok(())
}

fn invalid_facts(path: &str) -> CombatSubmissionError {
    CombatSubmissionError::InvalidSubmissionFacts {
        path: path.to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        AbilityUsageState, AcceptedCommandSource, CURRENT_COMBAT_VERSIONS,
        CombatInventoryItemState, CombatPhase, CombatRng, CombatSide, CombatantRuntime,
        CombatantState, EventSchedulerCheckpoint, EventSchedulerStatus, ObjectiveRuntimeState,
        ProvisionalRuntimeDelta, ReinforcementRuntimeState, ResourceState, RoundRuntimeState,
        SchedulerItem, SchedulerItemKind,
    };

    const SEED: &str = "0123456789abcdef0123456789abcdef";

    #[test]
    fn valid_submission_accepts_command_and_reserves_without_deducting() {
        let mut state = fixture_state();
        let before_rng = state.rng.clone();
        let mut ledger = AcceptedCommandLedger::new();
        let result = CombatSubmissionService::submit(&mut state, &mut ledger, request()).unwrap();
        assert_eq!(result.command.status, CommandAcceptanceStatus::Accepted);
        assert!(result.preconditions.passed());
        assert_eq!(result.reservation.unwrap().record.command_id, "command-1");
        assert_eq!(ledger.commands().len(), 1);
        assert_eq!(state.cost_reservations.len(), 1);
        assert_eq!(state.combatants[0].action_points, 2);
        assert_eq!(state.rng, before_rng);
    }

    #[test]
    fn authority_stability_actor_ability_and_target_failures_are_structured_and_atomic() {
        type SubmissionMutation = Box<dyn Fn(&mut CombatSubmissionRequest)>;
        let cases: Vec<SubmissionMutation> = vec![
            Box::new(|request| request.control_assignments.clear()),
            Box::new(|request| request.stable_input_point = false),
            Box::new(|request| {
                request.envelope.actor_id = "missing-actor".to_owned();
                request.control_assignments[0].combatant_id = "missing-actor".to_owned();
                request.costs[0].asset = CombatCostAsset::ActionPoints {
                    combatant_id: "missing-actor".to_owned(),
                };
            }),
            Box::new(|request| request.known_ability_ids.clear()),
            Box::new(|request| request.legal_target_ids.clear()),
        ];
        for mutate in cases {
            let mut state = fixture_state();
            let before = state.clone();
            let mut ledger = AcceptedCommandLedger::new();
            let mut submission = request();
            mutate(&mut submission);
            assert!(matches!(
                CombatSubmissionService::submit(&mut state, &mut ledger, submission),
                Err(CombatSubmissionError::PreconditionsFailed(_))
            ));
            assert_eq!(state, before);
            assert!(ledger.commands().is_empty());
        }
    }

    #[test]
    fn declared_costs_cannot_bypass_automatic_balance_preconditions() {
        let mut state = fixture_state();
        state.combatants[0].action_points = 0;
        let before = state.clone();
        let mut ledger = AcceptedCommandLedger::new();
        let error =
            CombatSubmissionService::submit(&mut state, &mut ledger, request()).unwrap_err();
        let CombatSubmissionError::PreconditionsFailed(result) = error else {
            panic!("expected precondition failure")
        };
        assert!(result.failures.iter().any(
            |failure| failure.code == crate::PreconditionFailureCode::InsufficientActionPoints
        ));
        assert_eq!(state, before);
        assert!(ledger.commands().is_empty());
    }

    #[test]
    fn reservation_conflict_rolls_back_command_acceptance_and_rng() {
        let mut state = fixture_state();
        let existing = CostReservationRequest {
            reservation_id: "existing".to_owned(),
            command_id: "existing-command".to_owned(),
            parent_reservation_id: None,
            costs: vec![CombatCostRequestLine {
                cost_id: "ap".to_owned(),
                asset: ap(),
                amount: 2,
                consume_cost_on_interrupt: false,
            }],
        };
        CostReservationModel::reserve(&mut state, existing).unwrap();
        let before = state.clone();
        let mut ledger = AcceptedCommandLedger::new();
        assert!(matches!(
            CombatSubmissionService::submit(&mut state, &mut ledger, request()),
            Err(CombatSubmissionError::CostReservation(_))
        ));
        assert_eq!(state, before);
        assert!(ledger.commands().is_empty());
    }

    #[test]
    fn retry_is_idempotent_across_accepted_history_and_reservation() {
        let mut state = fixture_state();
        let mut ledger = AcceptedCommandLedger::new();
        CombatSubmissionService::submit(&mut state, &mut ledger, request()).unwrap();
        let revision = state.revision;
        let retried = CombatSubmissionService::submit(&mut state, &mut ledger, request()).unwrap();
        assert_eq!(
            retried.command.status,
            CommandAcceptanceStatus::AlreadyAccepted
        );
        assert_eq!(
            retried.reservation.unwrap().status,
            crate::CostReservationMutationStatus::AlreadyApplied
        );
        assert_eq!(state.revision, revision);
        assert_eq!(ledger.commands().len(), 1);
        assert_eq!(state.cost_reservations.len(), 1);
    }

    #[test]
    fn exact_retry_remains_idempotent_after_the_external_barrier_closes() {
        let mut state = fixture_state();
        let mut ledger = AcceptedCommandLedger::new();
        let first = CombatSubmissionService::submit(&mut state, &mut ledger, request()).unwrap();
        state.scheduler = Some(active_scheduler());
        let state_before_retry = state.clone();
        let retry = CombatSubmissionService::submit(&mut state, &mut ledger, request()).unwrap();
        assert_eq!(
            retry.command.status,
            CommandAcceptanceStatus::AlreadyAccepted
        );
        assert_eq!(retry.command.command, first.command.command);
        assert!(retry.preconditions.evaluated_rule_ids.is_empty());
        assert_eq!(state, state_before_retry);
        assert_eq!(ledger.commands().len(), 1);
    }

    #[test]
    fn utility_ai_requires_utility_control_and_zero_cost_commands_share_the_boundary() {
        let mut state = fixture_state();
        state.combatants[0].side = CombatSide::Companion;
        let mut ledger = AcceptedCommandLedger::new();
        let mut utility = request();
        utility.envelope.command_id = "command-ai".to_owned();
        utility.envelope.source = CombatCommandSource::UtilityAi;
        utility.control_assignments[0].authority = CombatControlAuthority::UtilityAi;
        utility.costs.clear();
        utility.ability_preconditions.clear();
        utility.envelope.payload = CombatCommandPayload::EndTurn;
        utility.known_ability_ids.clear();
        utility.legal_target_ids.clear();
        let result = CombatSubmissionService::submit(&mut state, &mut ledger, utility).unwrap();
        assert!(result.reservation.is_none());
        assert_eq!(
            ledger.commands()[0].source,
            AcceptedCommandSource::UtilityAi
        );
    }

    #[test]
    fn player_and_utility_sources_cannot_take_over_each_others_combatants() {
        let mut companion_state = fixture_state();
        companion_state.combatants[0].side = CombatSide::Companion;
        let companion_before = companion_state.clone();
        let mut companion_ledger = AcceptedCommandLedger::new();
        assert!(matches!(
            CombatSubmissionService::submit(&mut companion_state, &mut companion_ledger, request(),),
            Err(CombatSubmissionError::PreconditionsFailed(_))
        ));
        assert_eq!(companion_state, companion_before);
        assert!(companion_ledger.commands().is_empty());

        let mut player_state = fixture_state();
        let player_before = player_state.clone();
        let mut player_ledger = AcceptedCommandLedger::new();
        let mut utility_request = request();
        utility_request.envelope.source = CombatCommandSource::UtilityAi;
        utility_request.control_assignments[0].authority = CombatControlAuthority::UtilityAi;
        assert!(matches!(
            CombatSubmissionService::submit(&mut player_state, &mut player_ledger, utility_request,),
            Err(CombatSubmissionError::PreconditionsFailed(_))
        ));
        assert_eq!(player_state, player_before);
        assert!(player_ledger.commands().is_empty());
    }

    #[test]
    fn malformed_boundary_and_cost_ownership_never_mutate_inputs() {
        let mut state = fixture_state();
        let before = state.clone();
        let mut ledger = AcceptedCommandLedger::new();
        let mut malformed = request();
        malformed.envelope.command_id = "bad id".to_owned();
        assert!(matches!(
            CombatSubmissionService::submit(&mut state, &mut ledger, malformed),
            Err(CombatSubmissionError::CommandBoundary(_))
        ));
        let mut wrong_owner = request();
        wrong_owner.costs[0].asset = CombatCostAsset::ActionPoints {
            combatant_id: "enemy-1".to_owned(),
        };
        assert!(matches!(
            CombatSubmissionService::submit(&mut state, &mut ledger, wrong_owner),
            Err(CombatSubmissionError::InvalidSubmissionFacts { .. })
        ));
        assert_eq!(state, before);
        assert!(ledger.commands().is_empty());
    }

    fn request() -> CombatSubmissionRequest {
        CombatSubmissionRequest {
            envelope: CombatCommandEnvelope {
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
            },
            control_assignments: vec![CombatControlAssignment {
                combatant_id: "actor-1".to_owned(),
                authority: CombatControlAuthority::Player {
                    controller_id: "player-main".to_owned(),
                },
            }],
            stable_input_point: true,
            utility_ai_evaluation_in_progress: false,
            known_ability_ids: vec!["ability-strike".to_owned()],
            disabled_ability_ids: vec![],
            legal_target_ids: vec!["enemy-1".to_owned()],
            entity_tags: vec![],
            ability_preconditions: vec![PreconditionRuleSpec::with_default_timing(
                "ability.cooldown",
                PreconditionRule::CooldownReady,
            )],
            costs: vec![CombatCostRequestLine {
                cost_id: "ap".to_owned(),
                asset: ap(),
                amount: 1,
                consume_cost_on_interrupt: false,
            }],
            parent_reservation_id: None,
        }
    }

    fn ap() -> CombatCostAsset {
        CombatCostAsset::ActionPoints {
            combatant_id: "actor-1".to_owned(),
        }
    }

    fn active_scheduler() -> EventSchedulerCheckpoint {
        EventSchedulerCheckpoint {
            event_chain_id: "event-chain-active".to_owned(),
            status: EventSchedulerStatus::Active,
            engine_failure: None,
            executed_event_count: 0,
            queue: vec![],
            current_item: Some(SchedulerItem {
                kind: SchedulerItemKind::Trigger,
                event_chain_id: "event-chain-active".to_owned(),
                depth: 1,
                phase_priority: 0,
                explicit_priority: 0,
                source_initiative_order: 0,
                source_stable_id: "actor-1".to_owned(),
                effect_stable_id: "effect-active".to_owned(),
                sequence: 1,
                execution_counted: false,
            }),
            next_sequence: 2,
            max_trigger_depth: 8,
            max_event_count: 64,
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
            once_usage_counters: vec![],
            normal_owner_turn_index: 0,
            hard_cc_dr: crate::HardCcDrRuntime::default(),
            shield_recharge: crate::ShieldRechargeRuntime::default(),
            initiative_result: 10,
            initiative_base_stat: 2,
            last_committed_timeline_order: None,
            solo_recovery_available: false,
        };
        CombatState {
            combat_instance_id: "combat-submission-fixture".to_owned(),
            versions: CURRENT_COMBAT_VERSIONS,
            random_seed: SEED.to_owned(),
            revision: 1,
            last_committed_sequence: 0,
            phase: CombatPhase::Action,
            combatants: vec![
                combatant("actor-1", CombatSide::Player),
                combatant("enemy-1", CombatSide::Hostile),
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
                "combat-submission-fixture",
                CURRENT_COMBAT_VERSIONS.rng_contract_version,
            )
            .unwrap()
            .snapshot(),
        }
    }
}

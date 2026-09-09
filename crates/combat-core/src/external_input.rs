use std::{collections::VecDeque, error::Error, fmt};

use crate::{
    AcceptedCommandReceipt, CombatCommandEnvelope, CombatCommandPayload, CombatState,
    EventSchedulerStatus, ReactionWindowStatus,
};

const MAX_SAFE_SEQUENCE: u64 = 9_007_199_254_740_991;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct ExternalInputActivity {
    pub utility_ai_evaluation_in_progress: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExternalInputBarrierErrorCode {
    EventChainActive,
    ResolutionExecuting,
    PendingReactionOnly,
    ReactionWindowMismatch,
    UtilityAiEvaluationInProgress,
    QueueSequenceExhausted,
    QueueIdempotencyConflict,
    QueueFrontMismatch,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExternalInputBarrierError {
    pub code: ExternalInputBarrierErrorCode,
    pub subject: String,
}

impl fmt::Display for ExternalInputBarrierError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("external combat input barrier rejected command")
    }
}

impl Error for ExternalInputBarrierError {}

pub struct ExternalInputBarrier;

impl ExternalInputBarrier {
    pub fn validate(
        state: &CombatState,
        envelope: &CombatCommandEnvelope,
        activity: ExternalInputActivity,
    ) -> Result<(), ExternalInputBarrierError> {
        let unresolved_window = state
            .pending_reaction
            .as_ref()
            .filter(|window| window.status == ReactionWindowStatus::Unresolved);
        if let Some(window) = unresolved_window {
            return match &envelope.payload {
                CombatCommandPayload::ResolveReaction {
                    reaction_window_id, ..
                } if reaction_window_id == &window.window_id => Ok(()),
                CombatCommandPayload::ResolveReaction {
                    reaction_window_id, ..
                } => Err(barrier_error(
                    ExternalInputBarrierErrorCode::ReactionWindowMismatch,
                    reaction_window_id,
                )),
                _ => Err(barrier_error(
                    ExternalInputBarrierErrorCode::PendingReactionOnly,
                    &window.window_id,
                )),
            };
        }
        if let CombatCommandPayload::ResolveReaction {
            reaction_window_id, ..
        } = &envelope.payload
        {
            if state.pending_reaction.is_some() {
                return Ok(());
            }
            return Err(barrier_error(
                ExternalInputBarrierErrorCode::ReactionWindowMismatch,
                reaction_window_id,
            ));
        }
        if !scheduler_is_quiescent(state) {
            return Err(barrier_error(
                ExternalInputBarrierErrorCode::EventChainActive,
                &envelope.command_id,
            ));
        }
        if state.resolution_context.is_some() {
            return Err(barrier_error(
                ExternalInputBarrierErrorCode::ResolutionExecuting,
                &envelope.command_id,
            ));
        }
        if activity.utility_ai_evaluation_in_progress
            && matches!(
                envelope.payload,
                CombatCommandPayload::SetTacticalStrategy { .. }
                    | CombatCommandPayload::SetTacticalPreference { .. }
            )
        {
            return Err(barrier_error(
                ExternalInputBarrierErrorCode::UtilityAiEvaluationInProgress,
                &envelope.command_id,
            ));
        }
        Ok(())
    }
}

fn scheduler_is_quiescent(state: &CombatState) -> bool {
    state.scheduler.as_ref().is_none_or(|scheduler| {
        scheduler.status == EventSchedulerStatus::Active
            && scheduler.queue.is_empty()
            && scheduler.current_item.is_none()
    })
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QueuedExternalInput {
    pub arrival_sequence: u64,
    pub envelope: CombatCommandEnvelope,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ExternalInputQueue {
    next_arrival_sequence: u64,
    pending: VecDeque<QueuedExternalInput>,
}

impl ExternalInputQueue {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    pub fn enqueue(
        &mut self,
        envelope: CombatCommandEnvelope,
    ) -> Result<QueuedExternalInput, ExternalInputBarrierError> {
        if let Some(existing) = self
            .pending
            .iter()
            .find(|queued| queued.envelope.command_id == envelope.command_id)
        {
            return if existing.envelope == envelope {
                Ok(existing.clone())
            } else {
                Err(barrier_error(
                    ExternalInputBarrierErrorCode::QueueIdempotencyConflict,
                    &envelope.command_id,
                ))
            };
        }
        if self.next_arrival_sequence >= MAX_SAFE_SEQUENCE {
            return Err(barrier_error(
                ExternalInputBarrierErrorCode::QueueSequenceExhausted,
                "arrivalSequence",
            ));
        }
        self.next_arrival_sequence += 1;
        let queued = QueuedExternalInput {
            arrival_sequence: self.next_arrival_sequence,
            envelope,
        };
        self.pending.push_back(queued.clone());
        Ok(queued)
    }

    pub fn front_ready(
        &self,
        state: &CombatState,
        activity: ExternalInputActivity,
    ) -> Result<Option<&QueuedExternalInput>, ExternalInputBarrierError> {
        let Some(front) = self.pending.front() else {
            return Ok(None);
        };
        ExternalInputBarrier::validate(state, &front.envelope, activity)?;
        Ok(Some(front))
    }

    pub fn complete_front(
        &mut self,
        receipt: &AcceptedCommandReceipt,
    ) -> Result<QueuedExternalInput, ExternalInputBarrierError> {
        let Some(front) = self.pending.front() else {
            return Err(barrier_error(
                ExternalInputBarrierErrorCode::QueueFrontMismatch,
                &receipt.command.command_id,
            ));
        };
        if front.envelope.command_id != receipt.command.command_id {
            return Err(barrier_error(
                ExternalInputBarrierErrorCode::QueueFrontMismatch,
                &receipt.command.command_id,
            ));
        }
        self.pending.pop_front().ok_or_else(|| {
            barrier_error(
                ExternalInputBarrierErrorCode::QueueFrontMismatch,
                &receipt.command.command_id,
            )
        })
    }

    #[must_use]
    pub fn pending(&self) -> &VecDeque<QueuedExternalInput> {
        &self.pending
    }
}

fn barrier_error(
    code: ExternalInputBarrierErrorCode,
    subject: impl Into<String>,
) -> ExternalInputBarrierError {
    ExternalInputBarrierError {
        code,
        subject: subject.into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        AcceptedCommandLedger, CURRENT_COMBAT_VERSIONS, CombatCommandSource, CombatPhase,
        CombatRng, CombatSide, CombatantRuntime, CombatantState, CostCommitState,
        EventSchedulerCheckpoint, HookPhase, ObjectiveRuntimeState, PendingReactionWindow,
        ProvisionalRuntimeDelta, ReactionDecisionChoice, ReinforcementRuntimeState,
        ResolutionContext, ResolutionContextStatus, ResourceState, RoundRuntimeState,
        SchedulerItem, SchedulerItemKind, ShieldRechargeRuntime, TerminalPriorityPolicy,
    };

    const SEED: &str = "44556677889900112233aabbccddeeff";

    #[test]
    fn quiescent_barrier_allows_commands_but_freezes_tactical_changes_during_utility_scoring() {
        let state = state();
        let tactical = tactical_envelope("tactical-1");
        ExternalInputBarrier::validate(&state, &tactical, ExternalInputActivity::default())
            .unwrap();
        assert_eq!(
            ExternalInputBarrier::validate(
                &state,
                &tactical,
                ExternalInputActivity {
                    utility_ai_evaluation_in_progress: true,
                },
            )
            .unwrap_err()
            .code,
            ExternalInputBarrierErrorCode::UtilityAiEvaluationInProgress
        );
        ExternalInputBarrier::validate(
            &state,
            &ability_envelope("ability-1"),
            ExternalInputActivity {
                utility_ai_evaluation_in_progress: true,
            },
        )
        .unwrap();
    }

    #[test]
    fn active_event_chain_and_resolution_context_close_the_normal_barrier() {
        let mut event_state = state();
        event_state.scheduler = Some(scheduler_with_queue());
        assert_eq!(
            ExternalInputBarrier::validate(
                &event_state,
                &ability_envelope("event-blocked"),
                ExternalInputActivity::default(),
            )
            .unwrap_err()
            .code,
            ExternalInputBarrierErrorCode::EventChainActive
        );

        let mut resolution_state = state();
        let mut ledger = AcceptedCommandLedger::new();
        let accepted = ledger
            .accept_external(ability_envelope("resolving-command"))
            .unwrap()
            .command;
        resolution_state.resolution_context = Some(ResolutionContext {
            context_id: accepted.command_id.clone(),
            accepted_sequence: accepted.accepted_sequence,
            command: accepted,
            status: ResolutionContextStatus::ExecutingHooks,
            current_hook_phase: HookPhase::PreAction,
            completed_hook_phases: vec![],
            original_target_ids: vec!["enemy".to_owned()],
            effective_target_ids: vec!["enemy".to_owned()],
            target_redirects: vec![],
            reservation_id: None,
            event_chain_id: "event-chain-resolution".to_owned(),
            rng_checkpoint: resolution_state.rng.clone(),
            resolved_rolls: vec![],
            suspensions: vec![],
        });
        assert_eq!(
            ExternalInputBarrier::validate(
                &resolution_state,
                &ability_envelope("resolution-blocked"),
                ExternalInputActivity::default(),
            )
            .unwrap_err()
            .code,
            ExternalInputBarrierErrorCode::ResolutionExecuting
        );
    }

    #[test]
    fn unresolved_reaction_accepts_only_the_matching_resolve_command() {
        let mut state = state();
        state.pending_reaction = Some(pending_window());
        let matching = reaction_envelope("reaction-choice", "window-1");
        ExternalInputBarrier::validate(&state, &matching, ExternalInputActivity::default())
            .unwrap();
        assert_eq!(
            ExternalInputBarrier::validate(
                &state,
                &reaction_envelope("wrong-window", "window-2"),
                ExternalInputActivity::default(),
            )
            .unwrap_err()
            .code,
            ExternalInputBarrierErrorCode::ReactionWindowMismatch
        );
        assert_eq!(
            ExternalInputBarrier::validate(
                &state,
                &tactical_envelope("tactical-blocked"),
                ExternalInputActivity::default(),
            )
            .unwrap_err()
            .code,
            ExternalInputBarrierErrorCode::PendingReactionOnly
        );
    }

    #[test]
    fn fifo_queue_preserves_arrival_order_until_each_front_is_accepted() {
        let state = state();
        let mut queue = ExternalInputQueue::new();
        let first = tactical_envelope("command-z");
        let second = tactical_envelope("command-a");
        assert_eq!(queue.enqueue(first.clone()).unwrap().arrival_sequence, 1);
        assert_eq!(queue.enqueue(second.clone()).unwrap().arrival_sequence, 2);
        assert_eq!(queue.enqueue(first.clone()).unwrap().arrival_sequence, 1);
        let mut conflicting = first.clone();
        conflicting.actor_id = "other-player".to_owned();
        assert_eq!(
            queue.enqueue(conflicting).unwrap_err().code,
            ExternalInputBarrierErrorCode::QueueIdempotencyConflict
        );

        let mut ledger = AcceptedCommandLedger::new();
        for expected_id in ["command-z", "command-a"] {
            let ready = queue
                .front_ready(&state, ExternalInputActivity::default())
                .unwrap()
                .unwrap()
                .clone();
            assert_eq!(ready.envelope.command_id, expected_id);
            let receipt = ledger.accept_external(ready.envelope).unwrap();
            queue.complete_front(&receipt).unwrap();
        }
        assert!(queue.pending().is_empty());
        assert_eq!(ledger.commands()[0].command_id, "command-z");
        assert_eq!(ledger.commands()[1].command_id, "command-a");
        assert_eq!(ledger.commands()[0].accepted_sequence, 1);
        assert_eq!(ledger.commands()[1].accepted_sequence, 2);
    }

    #[test]
    fn blocked_queue_front_remains_pending_without_accepted_sequence() {
        let mut state = state();
        state.pending_reaction = Some(pending_window());
        let mut queue = ExternalInputQueue::new();
        queue.enqueue(tactical_envelope("queued-tactical")).unwrap();
        assert_eq!(
            queue
                .front_ready(&state, ExternalInputActivity::default())
                .unwrap_err()
                .code,
            ExternalInputBarrierErrorCode::PendingReactionOnly
        );
        assert_eq!(queue.pending().len(), 1);
        let ledger = AcceptedCommandLedger::new();
        assert!(ledger.commands().is_empty());
    }

    fn tactical_envelope(command_id: &str) -> CombatCommandEnvelope {
        CombatCommandEnvelope {
            command_id: command_id.to_owned(),
            source: CombatCommandSource::Player {
                controller_id: "controller-main".to_owned(),
            },
            actor_id: "hero".to_owned(),
            versions: CURRENT_COMBAT_VERSIONS,
            payload: CombatCommandPayload::SetTacticalStrategy {
                companion_id: "companion".to_owned(),
                strategy_id: "BALANCED".to_owned(),
            },
        }
    }

    fn ability_envelope(command_id: &str) -> CombatCommandEnvelope {
        CombatCommandEnvelope {
            command_id: command_id.to_owned(),
            source: CombatCommandSource::Player {
                controller_id: "controller-main".to_owned(),
            },
            actor_id: "hero".to_owned(),
            versions: CURRENT_COMBAT_VERSIONS,
            payload: CombatCommandPayload::UseAbility {
                ability_id: "ability.attack".to_owned(),
                target_id: Some("enemy".to_owned()),
            },
        }
    }

    fn reaction_envelope(command_id: &str, window_id: &str) -> CombatCommandEnvelope {
        CombatCommandEnvelope {
            command_id: command_id.to_owned(),
            source: CombatCommandSource::Player {
                controller_id: "controller-main".to_owned(),
            },
            actor_id: "hero".to_owned(),
            versions: CURRENT_COMBAT_VERSIONS,
            payload: CombatCommandPayload::ResolveReaction {
                reaction_window_id: window_id.to_owned(),
                choice: ReactionDecisionChoice::Skip,
                selected_reaction_id: None,
            },
        }
    }

    fn scheduler_with_queue() -> EventSchedulerCheckpoint {
        EventSchedulerCheckpoint {
            event_chain_id: "event-chain-active".to_owned(),
            status: EventSchedulerStatus::Active,
            engine_failure: None,
            executed_event_count: 0,
            queue: vec![SchedulerItem {
                kind: SchedulerItemKind::Trigger,
                event_chain_id: "event-chain-active".to_owned(),
                depth: 1,
                phase_priority: 0,
                explicit_priority: 0,
                source_initiative_order: 0,
                source_stable_id: "hero".to_owned(),
                effect_stable_id: "effect-1".to_owned(),
                sequence: 1,
                execution_counted: false,
            }],
            current_item: None,
            next_sequence: 2,
            max_trigger_depth: 8,
            max_event_count: 64,
        }
    }

    fn pending_window() -> PendingReactionWindow {
        PendingReactionWindow {
            window_id: "window-1".to_owned(),
            resolution_context_id: "context-1".to_owned(),
            source_command_id: "source-command".to_owned(),
            actor_id: "hero".to_owned(),
            target_ids: vec!["enemy".to_owned()],
            ability_id: Some("ability.attack".to_owned()),
            event_chain_id: "event-chain-reaction".to_owned(),
            hook_phase: HookPhase::PreEffect,
            eligible_reaction_ids: vec!["reaction-1".to_owned()],
            eligible_items: vec![],
            selected_reaction_id: None,
            status: ReactionWindowStatus::Unresolved,
            cost_state: CostCommitState::Reserved,
            resolved_rolls: vec![],
            sequence_number: 1,
            accepted_reaction_decision_command_id: None,
        }
    }

    fn state() -> CombatState {
        CombatState {
            combat_instance_id: "combat-external-input".to_owned(),
            versions: CURRENT_COMBAT_VERSIONS,
            random_seed: SEED.to_owned(),
            revision: 1,
            last_committed_sequence: 0,
            phase: CombatPhase::Action,
            combatants: vec![
                combatant("companion", CombatSide::Companion),
                combatant("enemy", CombatSide::Hostile),
                combatant("hero", CombatSide::Player),
            ],
            formal_party_member_ids: vec!["companion".to_owned(), "hero".to_owned()],
            combat_inventory: vec![],
            cost_reservations: vec![],
            resolution_context: None,
            timeline: vec![],
            round: RoundRuntimeState {
                round_number: 1,
                completed_round_count: 0,
                active_combatant_id: Some("hero".to_owned()),
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
            result_candidates: vec![],
            terminal_priority_policy: TerminalPriorityPolicy::default(),
            confirmed_result_candidate_id: None,
            confirmed_result: None,
            rng: CombatRng::new(
                SEED,
                "combat-external-input",
                CURRENT_COMBAT_VERSIONS.rng_contract_version,
            )
            .unwrap()
            .snapshot(),
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
            hard_cc_dr: crate::HardCcDrRuntime::default(),
            shield_recharge: ShieldRechargeRuntime::default(),
            initiative_result: 10,
            initiative_base_stat: 2,
            last_committed_timeline_order: None,
            solo_recovery_available: false,
        }
    }
}

use std::{cmp::Ordering, error::Error, fmt};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::{
    AcceptedCommandLedger, AcceptedCommandSource, CanonicalEventChainScheduler,
    CombatCommandEnvelope, CombatCommandPayload, CombatControlAssignment, CombatControlAuthority,
    CombatCostAsset, CombatCostRequestLine, CombatInventoryItemState, CombatRngSnapshot,
    CombatState, CombatVersionSet, CostCommitState, CostReservationModel, CostReservationRecord,
    CostReservationRequest, EffectDefinition, EventSchedulerCheckpoint, HookPhase,
    PendingReactionItem, PendingReactionWindow, ReactionDecisionChoice, ReactionWindowStatus,
    ResolutionContext, ResolutionContextLifecycle, ResourceState, SchedulerCandidate,
    SchedulerExecutionGateOutcome, SchedulerItem, SchedulerItemKind,
};

pub const CURRENT_REACTION_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ReactionExecutionMode {
    Auto,
    Ask,
    AiEvaluate,
    Disabled,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReactionDefinition {
    pub reaction_schema_version: u32,
    pub reaction_id: String,
    pub hook_phase: HookPhase,
    pub priority: i32,
    pub mode: ReactionExecutionMode,
    pub costs: Vec<CombatCostRequestLine>,
    pub effects: Vec<EffectDefinition>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReactionBinding {
    pub owner_combatant_id: String,
    pub definition: ReactionDefinition,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UtilityReactionDecision {
    pub owner_combatant_id: String,
    pub reaction_id: String,
    pub trigger: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReactionExecutionPermit {
    pub item: SchedulerItem,
    pub owner_combatant_id: String,
    pub reaction_id: String,
    pub effects: Vec<EffectDefinition>,
    pub reservation_id: String,
    pub resumed: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReactionRouteOutcome {
    Skipped {
        item: SchedulerItem,
    },
    ReadyToExecute(ReactionExecutionPermit),
    AskWindowOpened(PendingReactionWindow),
    UtilityDecisionRequired {
        owner_combatant_id: String,
        reaction_id: String,
    },
    EngineFailure(crate::LoopGuardEngineFailure),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReactionDecisionStatus {
    AcceptedTrigger,
    AcceptedSkip,
    AlreadyResolved,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReactionDecisionOutcome {
    pub status: ReactionDecisionStatus,
    pub permit: Option<ReactionExecutionPermit>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PendingReactionSnapshot {
    pub window: PendingReactionWindow,
    pub scheduler: EventSchedulerCheckpoint,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResolutionContextSnapshot {
    pub context: ResolutionContext,
    pub rng: CombatRngSnapshot,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CombatantCostSnapshot {
    pub combatant_id: String,
    pub action_points: i64,
    pub reaction_charges: i64,
    pub resources: Vec<ResourceState>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CostSnapshot {
    pub combatants: Vec<CombatantCostSnapshot>,
    pub inventory: Vec<CombatInventoryItemState>,
    pub reservations: Vec<CostReservationRecord>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReactionContinuationSnapshot {
    pub versions: CombatVersionSet,
    pub state_revision: u64,
    pub pending: PendingReactionSnapshot,
    pub resolution: ResolutionContextSnapshot,
    pub costs: CostSnapshot,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReactionRuleErrorCode {
    InvalidDefinition,
    DuplicateBinding,
    MissingBinding,
    WrongSchedulerItemKind,
    InvalidOwnership,
    InvalidUtilityDecision,
    MissingResolutionContext,
    ReactionWindowConflict,
    InvalidReactionDecision,
    SchedulerFailure,
    CostFailure,
    CommandFailure,
    ContextFailure,
    StateInvariantViolation,
    SequenceExhausted,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReactionRuleError {
    pub code: ReactionRuleErrorCode,
    pub subject_id: String,
}

impl fmt::Display for ReactionRuleError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "reaction core failed for {}: {:?}",
            self.subject_id, self.code
        )
    }
}

impl Error for ReactionRuleError {}

pub struct CanonicalReactionCore;

impl CanonicalReactionCore {
    pub fn validate_state(state: &CombatState) -> Result<(), ReactionRuleError> {
        let Some(window) = &state.pending_reaction else {
            return Ok(());
        };
        let context = state.resolution_context.as_ref().ok_or_else(|| {
            rule_error(
                ReactionRuleErrorCode::StateInvariantViolation,
                &window.window_id,
            )
        })?;
        let scheduler = state.scheduler.as_ref().ok_or_else(|| {
            rule_error(
                ReactionRuleErrorCode::StateInvariantViolation,
                &window.window_id,
            )
        })?;
        let items_match = !window.eligible_items.is_empty()
            && window.eligible_items.len() == window.eligible_reaction_ids.len()
            && window
                .eligible_items
                .iter()
                .enumerate()
                .all(|(index, pending)| {
                    pending.reaction_id == pending.scheduler_item.effect_stable_id
                        && window.eligible_reaction_ids[index] == pending.reaction_id
                        && pending.scheduler_item.kind == SchedulerItemKind::Reaction
                        && pending.scheduler_item.event_chain_id == window.event_chain_id
                        && !pending.scheduler_item.execution_counted
                        && pending.scheduler_item.depth > 0
                        && pending.scheduler_item.sequence > 0
                        && pending.scheduler_item.sequence < scheduler.next_sequence
                        && pending.scheduler_item.phase_priority
                            == hook_phase_priority(window.hook_phase)
                        && pending.scheduler_item.source_initiative_order
                            <= crate::NON_COMBATANT_INITIATIVE_ORDER
                        && valid_stable_id(&pending.reaction_id)
                        && !window.eligible_items[..index].iter().any(|prior| {
                            prior.scheduler_item.sequence == pending.scheduler_item.sequence
                        })
                        && (index == 0
                            || (same_ask_prefix(
                                &window.eligible_items[0].scheduler_item,
                                &pending.scheduler_item,
                            ) && scheduler_item_cmp(
                                &window.eligible_items[index - 1].scheduler_item,
                                &pending.scheduler_item,
                            )
                            .is_lt()))
                });
        let base_matches = items_match
            && valid_stable_id(&window.window_id)
            && state.combatants.iter().any(|owner| {
                owner.combatant_id == window.actor_id && owner.side == crate::CombatSide::Player
            })
            && window.sequence_number == window.eligible_items[0].scheduler_item.sequence
            && window.actor_id == window.eligible_items[0].scheduler_item.source_stable_id
            && window.resolution_context_id == context.context_id
            && window.source_command_id == context.command.command_id
            && window.event_chain_id == context.event_chain_id
            && window.event_chain_id == scheduler.event_chain_id
            && window.hook_phase == context.current_hook_phase;
        let suspended_sequences_absent = window.eligible_items.iter().all(|pending| {
            scheduler
                .current_item
                .as_ref()
                .is_none_or(|item| item.sequence != pending.scheduler_item.sequence)
                && scheduler
                    .queue
                    .iter()
                    .all(|item| item.sequence != pending.scheduler_item.sequence)
        });
        let lifecycle_matches = match window.status {
            ReactionWindowStatus::Unresolved => {
                context.status == crate::ResolutionContextStatus::SuspendedForReaction
                    && scheduler.current_item.is_none()
                    && window.selected_reaction_id.is_none()
                    && window.accepted_reaction_decision_command_id.is_none()
                    && window.cost_state == CostCommitState::Reserved
                    && suspended_sequences_absent
                    && context.suspensions.last().is_some_and(|suspension| {
                        suspension.reaction_window_id == window.window_id && !suspension.resumed
                    })
            }
            ReactionWindowStatus::ResolvedSkip => {
                context.status == crate::ResolutionContextStatus::ExecutingHooks
                    && scheduler.current_item.is_none()
                    && window.selected_reaction_id.is_none()
                    && window.accepted_reaction_decision_command_id.is_some()
                    && window.cost_state == CostCommitState::Released
                    && suspended_sequences_absent
            }
            ReactionWindowStatus::ResolvedTrigger => {
                let selected_id = window.selected_reaction_id.as_deref();
                let selected_item = window
                    .eligible_items
                    .iter()
                    .find(|pending| Some(pending.reaction_id.as_str()) == selected_id);
                let selected_is_current = selected_item.is_some_and(|pending| {
                    scheduler
                        .current_item
                        .as_ref()
                        .is_some_and(|item| same_pending_item(item, &pending.scheduler_item, true))
                });
                let selected_is_absent = selected_item.is_some_and(|pending| {
                    scheduler
                        .current_item
                        .as_ref()
                        .is_none_or(|item| item.sequence != pending.scheduler_item.sequence)
                        && scheduler
                            .queue
                            .iter()
                            .all(|item| item.sequence != pending.scheduler_item.sequence)
                });
                let unselected_placements_match = window.eligible_items.iter().all(|pending| {
                    let in_current = scheduler
                        .current_item
                        .as_ref()
                        .is_some_and(|item| same_pending_item(item, &pending.scheduler_item, true));
                    let in_queue = scheduler
                        .queue
                        .iter()
                        .any(|item| same_pending_item(item, &pending.scheduler_item, false));
                    if selected_id == Some(pending.reaction_id.as_str()) {
                        true
                    } else {
                        !in_current && in_queue
                    }
                });
                let selected_placement_matches = match window.cost_state {
                    CostCommitState::Reserved => {
                        selected_is_current
                            || selected_is_absent
                                && scheduler.current_item.is_none()
                                && scheduler.status == crate::EventSchedulerStatus::EngineFailure
                    }
                    CostCommitState::Committed => {
                        selected_is_current
                            && scheduler
                                .current_item
                                .as_ref()
                                .is_some_and(|item| item.execution_counted)
                            || selected_is_absent && scheduler.current_item.is_none()
                    }
                    CostCommitState::Released => {
                        selected_is_absent
                            && scheduler.current_item.is_none()
                            && scheduler.status == crate::EventSchedulerStatus::EngineFailure
                    }
                };
                context.status == crate::ResolutionContextStatus::ExecutingHooks
                    && window
                        .selected_reaction_id
                        .as_ref()
                        .is_some_and(|selected| window.eligible_reaction_ids.contains(selected))
                    && window.accepted_reaction_decision_command_id.is_some()
                    && selected_placement_matches
                    && unselected_placements_match
            }
        };
        if !base_matches || !lifecycle_matches {
            return Err(rule_error(
                ReactionRuleErrorCode::StateInvariantViolation,
                &window.window_id,
            ));
        }
        Ok(())
    }

    pub fn continuation_snapshot(
        state: &CombatState,
    ) -> Result<ReactionContinuationSnapshot, ReactionRuleError> {
        state.validate_for_commit().map_err(|_| {
            rule_error(
                ReactionRuleErrorCode::StateInvariantViolation,
                "reaction-continuation",
            )
        })?;
        let window = state
            .pending_reaction
            .clone()
            .ok_or_else(|| rule_error(ReactionRuleErrorCode::ReactionWindowConflict, "window"))?;
        let scheduler = state.scheduler.clone().ok_or_else(|| {
            rule_error(
                ReactionRuleErrorCode::StateInvariantViolation,
                &window.window_id,
            )
        })?;
        let context = state.resolution_context.clone().ok_or_else(|| {
            rule_error(
                ReactionRuleErrorCode::StateInvariantViolation,
                &window.window_id,
            )
        })?;
        Ok(ReactionContinuationSnapshot {
            versions: state.versions,
            state_revision: state.revision,
            pending: PendingReactionSnapshot { window, scheduler },
            resolution: ResolutionContextSnapshot {
                context,
                rng: state.rng.clone(),
            },
            costs: CostSnapshot {
                combatants: state
                    .combatants
                    .iter()
                    .map(|combatant| CombatantCostSnapshot {
                        combatant_id: combatant.combatant_id.clone(),
                        action_points: combatant.action_points,
                        reaction_charges: combatant.reaction_charges,
                        resources: combatant.resources.clone(),
                    })
                    .collect(),
                inventory: state.combat_inventory.clone(),
                reservations: state.cost_reservations.clone(),
            },
        })
    }

    pub fn enqueue_roots(
        state: &mut CombatState,
        bindings: &[ReactionBinding],
    ) -> Result<Vec<SchedulerItem>, ReactionRuleError> {
        validate_bindings(state, bindings)?;
        let candidates = eligible_candidates(state, bindings)?;
        CanonicalEventChainScheduler::enqueue_roots(state, candidates)
            .map_err(|error| rule_error(ReactionRuleErrorCode::SchedulerFailure, error.subject_id))
    }

    pub fn complete_current_with_children(
        state: &mut CombatState,
        bindings: &[ReactionBinding],
    ) -> Result<Vec<SchedulerItem>, ReactionRuleError> {
        validate_bindings(state, bindings)?;
        let candidates = eligible_candidates(state, bindings)?;
        CanonicalEventChainScheduler::complete_current_with_children(state, candidates)
            .map_err(|error| rule_error(ReactionRuleErrorCode::SchedulerFailure, error.subject_id))
    }

    pub fn route_current(
        state: &mut CombatState,
        bindings: &[ReactionBinding],
        assignments: &[CombatControlAssignment],
        utility_decision: Option<&UtilityReactionDecision>,
    ) -> Result<ReactionRouteOutcome, ReactionRuleError> {
        validate_bindings(state, bindings)?;
        Self::validate_state(state)?;
        if state
            .pending_reaction
            .as_ref()
            .is_some_and(|window| window.status == ReactionWindowStatus::Unresolved)
        {
            return Err(rule_error(
                ReactionRuleErrorCode::ReactionWindowConflict,
                "pending-reaction",
            ));
        }
        let current = current_reaction_item(state)?;
        let binding = binding_for_item(bindings, &current).ok_or_else(|| {
            rule_error(
                ReactionRuleErrorCode::MissingBinding,
                &current.effect_stable_id,
            )
        })?;
        if current.execution_counted {
            return execute_current(state, binding);
        }
        let authority = authority_for(assignments, &binding.owner_combatant_id)?;
        if !current.execution_counted && !binding_is_currently_eligible(state, binding)? {
            return skip_current(state);
        }

        match execution_route(state, binding, authority)? {
            RuntimeRoute::Skip => skip_current(state),
            RuntimeRoute::Execute => execute_current(state, binding),
            RuntimeRoute::AskPlayer => open_ask_window(state, bindings, assignments),
            RuntimeRoute::UtilityAi => match utility_decision {
                None => Ok(ReactionRouteOutcome::UtilityDecisionRequired {
                    owner_combatant_id: binding.owner_combatant_id.clone(),
                    reaction_id: binding.definition.reaction_id.clone(),
                }),
                Some(decision)
                    if decision.owner_combatant_id == binding.owner_combatant_id
                        && decision.reaction_id == binding.definition.reaction_id =>
                {
                    if decision.trigger {
                        execute_current(state, binding)
                    } else {
                        skip_current(state)
                    }
                }
                Some(_) => Err(rule_error(
                    ReactionRuleErrorCode::InvalidUtilityDecision,
                    &binding.definition.reaction_id,
                )),
            },
        }
    }

    pub fn resolve_ask_window(
        state: &mut CombatState,
        accepted_commands: &mut AcceptedCommandLedger,
        envelope: CombatCommandEnvelope,
        bindings: &[ReactionBinding],
        assignments: &[CombatControlAssignment],
    ) -> Result<ReactionDecisionOutcome, ReactionRuleError> {
        validate_bindings(state, bindings)?;
        Self::validate_state(state)?;
        let mut working_commands = accepted_commands.clone();
        let receipt = working_commands
            .accept_external(envelope.clone())
            .map_err(|error| rule_error(ReactionRuleErrorCode::CommandFailure, error.path))?;
        let Some(window) = state.pending_reaction.clone() else {
            if receipt.status == crate::CommandAcceptanceStatus::AlreadyAccepted
                && matches!(
                    &envelope.payload,
                    CombatCommandPayload::ResolveReaction { .. }
                )
            {
                *accepted_commands = working_commands;
                return Ok(ReactionDecisionOutcome {
                    status: ReactionDecisionStatus::AlreadyResolved,
                    permit: None,
                });
            }
            return Err(rule_error(
                ReactionRuleErrorCode::ReactionWindowConflict,
                "window",
            ));
        };

        if window.status != ReactionWindowStatus::Unresolved {
            if window.accepted_reaction_decision_command_id.as_deref()
                == Some(envelope.command_id.as_str())
            {
                *accepted_commands = working_commands;
                return Ok(ReactionDecisionOutcome {
                    status: ReactionDecisionStatus::AlreadyResolved,
                    permit: None,
                });
            }
            return Err(rule_error(
                ReactionRuleErrorCode::ReactionWindowConflict,
                &window.window_id,
            ));
        }
        validate_player_decision(&window, &receipt.command.source, &envelope, assignments)?;
        let CombatCommandPayload::ResolveReaction {
            reaction_window_id,
            choice,
            selected_reaction_id,
        } = &envelope.payload
        else {
            return Err(rule_error(
                ReactionRuleErrorCode::InvalidReactionDecision,
                &envelope.command_id,
            ));
        };
        if reaction_window_id != &window.window_id {
            return Err(rule_error(
                ReactionRuleErrorCode::InvalidReactionDecision,
                reaction_window_id,
            ));
        }

        let selected_id = match choice {
            ReactionDecisionChoice::Skip => None,
            ReactionDecisionChoice::Trigger => {
                Some(selected_reaction_id.as_deref().ok_or_else(|| {
                    rule_error(
                        ReactionRuleErrorCode::InvalidReactionDecision,
                        &window.window_id,
                    )
                })?)
            }
        };
        if selected_id
            .is_some_and(|selected| !window.eligible_reaction_ids.iter().any(|id| id == selected))
        {
            return Err(rule_error(
                ReactionRuleErrorCode::InvalidReactionDecision,
                selected_id.unwrap_or_default(),
            ));
        }

        let mut working = state.clone();
        mark_window_resolved(
            &mut working,
            if choice == &ReactionDecisionChoice::Skip {
                ReactionWindowStatus::ResolvedSkip
            } else {
                ReactionWindowStatus::ResolvedTrigger
            },
            selected_id,
            &envelope.command_id,
            if choice == &ReactionDecisionChoice::Skip {
                CostCommitState::Released
            } else {
                CostCommitState::Reserved
            },
        )?;
        if let Some(selected_id) = selected_id {
            restore_selected_item(&mut working, &window, selected_id)?;
        }
        ResolutionContextLifecycle::resume_from_ask(&mut working, &window.window_id)
            .map_err(|error| rule_error(ReactionRuleErrorCode::ContextFailure, error.subject_id))?;
        let outcome = match choice {
            ReactionDecisionChoice::Skip => ReactionDecisionOutcome {
                status: ReactionDecisionStatus::AcceptedSkip,
                permit: None,
            },
            ReactionDecisionChoice::Trigger => {
                let selected_id = selected_id.expect("trigger decision validated selected id");
                let selected = current_reaction_item(&working)?;
                let binding = binding_for_item(bindings, &selected).ok_or_else(|| {
                    rule_error(ReactionRuleErrorCode::MissingBinding, selected_id)
                })?;
                let (permit, cost_state) = match execute_current(&mut working, binding)? {
                    ReactionRouteOutcome::ReadyToExecute(permit) => {
                        (Some(permit), CostCommitState::Committed)
                    }
                    ReactionRouteOutcome::Skipped { .. } => {
                        return Err(rule_error(
                            ReactionRuleErrorCode::InvalidReactionDecision,
                            selected_id,
                        ));
                    }
                    ReactionRouteOutcome::EngineFailure(_) => (None, CostCommitState::Released),
                    _ => unreachable!("execution route has a closed outcome"),
                };
                mark_window_resolved(
                    &mut working,
                    ReactionWindowStatus::ResolvedTrigger,
                    Some(selected_id),
                    &envelope.command_id,
                    cost_state,
                )?;
                ReactionDecisionOutcome {
                    status: ReactionDecisionStatus::AcceptedTrigger,
                    permit,
                }
            }
        };
        validate_working_state(&working, &window.window_id)?;
        *state = working;
        *accepted_commands = working_commands;
        Ok(outcome)
    }

    pub fn clear_resolved_window(state: &mut CombatState) -> Result<(), ReactionRuleError> {
        Self::validate_state(state)?;
        let window = state
            .pending_reaction
            .as_ref()
            .ok_or_else(|| rule_error(ReactionRuleErrorCode::ReactionWindowConflict, "window"))?;
        if window.status == ReactionWindowStatus::Unresolved
            || state
                .scheduler
                .as_ref()
                .is_some_and(|scheduler| scheduler.current_item.is_some())
        {
            return Err(rule_error(
                ReactionRuleErrorCode::ReactionWindowConflict,
                &window.window_id,
            ));
        }
        let mut working = state.clone();
        let subject = window.window_id.clone();
        working.pending_reaction = None;
        bump_revision(&mut working, &subject)?;
        validate_working_state(&working, &subject)?;
        *state = working;
        Ok(())
    }
}

enum RuntimeRoute {
    Execute,
    AskPlayer,
    UtilityAi,
    Skip,
}

fn execution_route(
    state: &CombatState,
    binding: &ReactionBinding,
    authority: &CombatControlAuthority,
) -> Result<RuntimeRoute, ReactionRuleError> {
    let owner = state
        .combatants
        .iter()
        .find(|combatant| combatant.combatant_id == binding.owner_combatant_id)
        .ok_or_else(|| {
            rule_error(
                ReactionRuleErrorCode::InvalidOwnership,
                &binding.owner_combatant_id,
            )
        })?;
    if owner.state != crate::CombatantState::Active {
        return Ok(RuntimeRoute::Skip);
    }
    let route = match binding.definition.mode {
        ReactionExecutionMode::Disabled => RuntimeRoute::Skip,
        ReactionExecutionMode::Auto => RuntimeRoute::Execute,
        ReactionExecutionMode::AiEvaluate => RuntimeRoute::UtilityAi,
        ReactionExecutionMode::Ask => match authority {
            CombatControlAuthority::Player { .. } if owner.side == crate::CombatSide::Player => {
                RuntimeRoute::AskPlayer
            }
            CombatControlAuthority::UtilityAi => RuntimeRoute::UtilityAi,
            CombatControlAuthority::Test { .. } => RuntimeRoute::Execute,
            CombatControlAuthority::Player { .. } => {
                return Err(rule_error(
                    ReactionRuleErrorCode::InvalidOwnership,
                    &binding.owner_combatant_id,
                ));
            }
        },
    };
    Ok(route)
}

fn execute_current(
    state: &mut CombatState,
    binding: &ReactionBinding,
) -> Result<ReactionRouteOutcome, ReactionRuleError> {
    let item = current_reaction_item(state)?;
    let reservation_id = reaction_execution_id(&item);
    let request = CostReservationRequest {
        reservation_id: reservation_id.clone(),
        command_id: reservation_id.clone(),
        parent_reservation_id: state
            .resolution_context
            .as_ref()
            .and_then(|context| context.reservation_id.clone()),
        costs: binding.definition.costs.clone(),
    };
    if item.execution_counted
        && state
            .cost_reservations
            .iter()
            .find(|record| record.reservation_id == reservation_id)
            .is_none_or(|record| record.status != crate::CostReservationStatus::Committed)
    {
        return Err(rule_error(
            ReactionRuleErrorCode::CostFailure,
            &reservation_id,
        ));
    }

    let mut availability_probe = state.clone();
    if !reservation_is_available(CostReservationModel::reserve(
        &mut availability_probe,
        request.clone(),
    ))? {
        return skip_current(state);
    }

    let mut working = state.clone();
    let gate = CanonicalEventChainScheduler::gate_current_for_execution(&mut working, true)
        .map_err(|error| rule_error(ReactionRuleErrorCode::SchedulerFailure, error.subject_id))?;
    let (item, resumed) = match gate {
        SchedulerExecutionGateOutcome::Skipped { item } => {
            return Ok(ReactionRouteOutcome::Skipped { item });
        }
        SchedulerExecutionGateOutcome::EngineFailure { failure } => {
            *state = working;
            return Ok(ReactionRouteOutcome::EngineFailure(failure));
        }
        SchedulerExecutionGateOutcome::ReadyToExecute { item, resumed } => (item, resumed),
    };
    if !resumed {
        CostReservationModel::reserve(&mut working, request)
            .and_then(|_| CostReservationModel::commit(&mut working, &reservation_id))
            .map_err(|error| rule_error(ReactionRuleErrorCode::CostFailure, error.subject_id))?;
    }
    let permit = ReactionExecutionPermit {
        item,
        owner_combatant_id: binding.owner_combatant_id.clone(),
        reaction_id: binding.definition.reaction_id.clone(),
        effects: binding.definition.effects.clone(),
        reservation_id,
        resumed,
    };
    *state = working;
    Ok(ReactionRouteOutcome::ReadyToExecute(permit))
}

fn skip_current(state: &mut CombatState) -> Result<ReactionRouteOutcome, ReactionRuleError> {
    CanonicalEventChainScheduler::gate_current_for_execution(state, false)
        .map(|outcome| match outcome {
            SchedulerExecutionGateOutcome::Skipped { item } => {
                ReactionRouteOutcome::Skipped { item }
            }
            SchedulerExecutionGateOutcome::ReadyToExecute { .. }
            | SchedulerExecutionGateOutcome::EngineFailure { .. } => {
                unreachable!("ineligible scheduler gate always skips")
            }
        })
        .map_err(|error| rule_error(ReactionRuleErrorCode::SchedulerFailure, error.subject_id))
}

fn open_ask_window(
    state: &mut CombatState,
    bindings: &[ReactionBinding],
    assignments: &[CombatControlAssignment],
) -> Result<ReactionRouteOutcome, ReactionRuleError> {
    if state.pending_reaction.is_some() {
        return Err(rule_error(
            ReactionRuleErrorCode::ReactionWindowConflict,
            "pending-reaction",
        ));
    }
    let context = state
        .resolution_context
        .clone()
        .ok_or_else(|| rule_error(ReactionRuleErrorCode::MissingResolutionContext, "context"))?;
    let first = current_reaction_item(state)?;
    if first.event_chain_id != context.event_chain_id
        || first.phase_priority != hook_phase_priority(context.current_hook_phase)
    {
        return Err(rule_error(
            ReactionRuleErrorCode::ContextFailure,
            &context.context_id,
        ));
    }
    let mut grouped = vec![first.clone()];
    let scheduler = state
        .scheduler
        .as_ref()
        .expect("current item requires scheduler");
    for item in &scheduler.queue {
        if !same_ask_prefix(&first, item) || !is_player_ask(state, item, bindings, assignments) {
            break;
        }
        grouped.push(item.clone());
    }
    let window_id = scheduler_identity("reaction-window", &first);
    let mut working = state.clone();
    ResolutionContextLifecycle::suspend_for_ask(&mut working, &window_id)
        .map_err(|error| rule_error(ReactionRuleErrorCode::ContextFailure, error.subject_id))?;
    let scheduler = working.scheduler.as_mut().expect("scheduler was checked");
    scheduler.current_item = None;
    scheduler.queue.drain(..grouped.len().saturating_sub(1));
    let ability_id = match &context.command.payload {
        CombatCommandPayload::UseAbility { ability_id, .. } => Some(ability_id.clone()),
        _ => None,
    };
    let window = PendingReactionWindow {
        window_id: window_id.clone(),
        resolution_context_id: context.context_id,
        source_command_id: context.command.command_id,
        actor_id: first.source_stable_id.clone(),
        target_ids: context.effective_target_ids,
        ability_id,
        event_chain_id: first.event_chain_id.clone(),
        hook_phase: context.current_hook_phase,
        eligible_reaction_ids: grouped
            .iter()
            .map(|item| item.effect_stable_id.clone())
            .collect(),
        eligible_items: grouped
            .into_iter()
            .map(|item| PendingReactionItem {
                reaction_id: item.effect_stable_id.clone(),
                scheduler_item: item,
            })
            .collect(),
        selected_reaction_id: None,
        status: ReactionWindowStatus::Unresolved,
        cost_state: CostCommitState::Reserved,
        resolved_rolls: context
            .resolved_rolls
            .iter()
            .map(|roll| i64::from(roll.value))
            .collect(),
        sequence_number: first.sequence,
        accepted_reaction_decision_command_id: None,
    };
    working.pending_reaction = Some(window.clone());
    bump_revision(&mut working, &window_id)?;
    validate_working_state(&working, &window_id)?;
    *state = working;
    Ok(ReactionRouteOutcome::AskWindowOpened(window))
}

fn restore_selected_item(
    state: &mut CombatState,
    window: &PendingReactionWindow,
    selected_id: &str,
) -> Result<(), ReactionRuleError> {
    let selected = window
        .eligible_items
        .iter()
        .find(|item| item.reaction_id == selected_id)
        .ok_or_else(|| rule_error(ReactionRuleErrorCode::InvalidReactionDecision, selected_id))?;
    let scheduler = state.scheduler.as_mut().ok_or_else(|| {
        rule_error(
            ReactionRuleErrorCode::SchedulerFailure,
            &window.event_chain_id,
        )
    })?;
    if scheduler.current_item.is_some() {
        return Err(rule_error(
            ReactionRuleErrorCode::SchedulerFailure,
            &window.event_chain_id,
        ));
    }
    scheduler.current_item = Some(selected.scheduler_item.clone());
    scheduler.queue.extend(
        window
            .eligible_items
            .iter()
            .filter(|item| item.reaction_id != selected_id)
            .map(|item| item.scheduler_item.clone()),
    );
    scheduler.queue.sort_by(scheduler_item_cmp);
    Ok(())
}

fn mark_window_resolved(
    state: &mut CombatState,
    status: ReactionWindowStatus,
    selected_reaction_id: Option<&str>,
    command_id: &str,
    cost_state: CostCommitState,
) -> Result<(), ReactionRuleError> {
    let window = state
        .pending_reaction
        .as_mut()
        .ok_or_else(|| rule_error(ReactionRuleErrorCode::ReactionWindowConflict, "window"))?;
    window.status = status;
    window.selected_reaction_id = selected_reaction_id.map(str::to_owned);
    window.accepted_reaction_decision_command_id = Some(command_id.to_owned());
    window.cost_state = cost_state;
    bump_revision(state, command_id)
}

fn validate_player_decision(
    window: &PendingReactionWindow,
    source: &AcceptedCommandSource,
    envelope: &CombatCommandEnvelope,
    assignments: &[CombatControlAssignment],
) -> Result<(), ReactionRuleError> {
    let AcceptedCommandSource::Player { controller_id } = source else {
        return Err(rule_error(
            ReactionRuleErrorCode::InvalidOwnership,
            &window.actor_id,
        ));
    };
    let CombatControlAuthority::Player {
        controller_id: assigned,
    } = authority_for(assignments, &window.actor_id)?
    else {
        return Err(rule_error(
            ReactionRuleErrorCode::InvalidOwnership,
            &window.actor_id,
        ));
    };
    if assigned != controller_id || envelope.actor_id != window.actor_id {
        return Err(rule_error(
            ReactionRuleErrorCode::InvalidOwnership,
            &window.actor_id,
        ));
    }
    Ok(())
}

fn validate_bindings(
    state: &CombatState,
    bindings: &[ReactionBinding],
) -> Result<(), ReactionRuleError> {
    for (index, binding) in bindings.iter().enumerate() {
        let definition = &binding.definition;
        if definition.reaction_schema_version != CURRENT_REACTION_SCHEMA_VERSION
            || definition.reaction_id.is_empty()
            || !valid_stable_id(&definition.reaction_id)
            || definition.effects.is_empty()
            || !state
                .combatants
                .iter()
                .any(|combatant| combatant.combatant_id == binding.owner_combatant_id)
            || bindings[..index].iter().any(|prior| {
                prior.owner_combatant_id == binding.owner_combatant_id
                    && prior.definition.reaction_id == definition.reaction_id
            })
        {
            return Err(rule_error(
                if bindings[..index].iter().any(|prior| {
                    prior.owner_combatant_id == binding.owner_combatant_id
                        && prior.definition.reaction_id == definition.reaction_id
                }) {
                    ReactionRuleErrorCode::DuplicateBinding
                } else {
                    ReactionRuleErrorCode::InvalidDefinition
                },
                &definition.reaction_id,
            ));
        }
        let mut reaction_charge_lines = 0;
        for (cost_index, cost) in definition.costs.iter().enumerate() {
            if cost.amount <= 0
                || !valid_stable_id(&cost.cost_id)
                || !valid_cost_asset(&cost.asset)
                || !cost_belongs_to(&cost.asset, &binding.owner_combatant_id)
                || definition.costs[..cost_index]
                    .iter()
                    .any(|prior| prior.cost_id == cost.cost_id || prior.asset == cost.asset)
            {
                return Err(rule_error(
                    ReactionRuleErrorCode::InvalidDefinition,
                    &definition.reaction_id,
                ));
            }
            if matches!(cost.asset, CombatCostAsset::ReactionCharge { .. }) {
                reaction_charge_lines += 1;
            }
        }
        if reaction_charge_lines != 1 {
            return Err(rule_error(
                ReactionRuleErrorCode::InvalidDefinition,
                &definition.reaction_id,
            ));
        }
    }
    Ok(())
}

fn cost_belongs_to(asset: &CombatCostAsset, owner_id: &str) -> bool {
    match asset {
        CombatCostAsset::ActionPoints { combatant_id }
        | CombatCostAsset::Resource { combatant_id, .. }
        | CombatCostAsset::ReactionCharge { combatant_id } => combatant_id == owner_id,
        CombatCostAsset::Item {
            owner_id: value, ..
        } => value == owner_id,
    }
}

fn valid_cost_asset(asset: &CombatCostAsset) -> bool {
    match asset {
        CombatCostAsset::ActionPoints { combatant_id }
        | CombatCostAsset::ReactionCharge { combatant_id } => valid_stable_id(combatant_id),
        CombatCostAsset::Resource {
            combatant_id,
            resource_id,
        } => valid_stable_id(combatant_id) && valid_stable_id(resource_id),
        CombatCostAsset::Item { owner_id, item_id } => {
            valid_stable_id(owner_id) && valid_stable_id(item_id)
        }
    }
}

fn eligible_candidates(
    state: &CombatState,
    bindings: &[ReactionBinding],
) -> Result<Vec<SchedulerCandidate>, ReactionRuleError> {
    let mut candidates = Vec::new();
    for binding in bindings {
        if binding.definition.mode != ReactionExecutionMode::Disabled
            && binding_is_currently_eligible(state, binding)?
        {
            candidates.push(candidate(binding));
        }
    }
    Ok(candidates)
}

fn reservation_is_available(
    result: Result<crate::CostReservationReceipt, crate::CostReservationError>,
) -> Result<bool, ReactionRuleError> {
    match result {
        Ok(_) => Ok(true),
        Err(error) if error.code == crate::CostReservationErrorCode::InsufficientAvailable => {
            Ok(false)
        }
        Err(error) => Err(rule_error(
            ReactionRuleErrorCode::CostFailure,
            error.subject_id,
        )),
    }
}

fn binding_is_currently_eligible(
    state: &CombatState,
    binding: &ReactionBinding,
) -> Result<bool, ReactionRuleError> {
    if state
        .combatants
        .iter()
        .find(|combatant| combatant.combatant_id == binding.owner_combatant_id)
        .is_none_or(|combatant| combatant.state != crate::CombatantState::Active)
    {
        return Ok(false);
    }
    let mut hasher = Sha256::new();
    hasher.update(binding.owner_combatant_id.as_bytes());
    hasher.update([0]);
    hasher.update(binding.definition.reaction_id.as_bytes());
    let probe_id = format!("reaction-probe:{:x}", hasher.finalize());
    let mut probe = state.clone();
    reservation_is_available(CostReservationModel::reserve(
        &mut probe,
        CostReservationRequest {
            reservation_id: probe_id.clone(),
            command_id: probe_id,
            parent_reservation_id: state
                .resolution_context
                .as_ref()
                .and_then(|context| context.reservation_id.clone()),
            costs: binding.definition.costs.clone(),
        },
    ))
}

fn valid_stable_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b':' | b'-'))
}

fn candidate(binding: &ReactionBinding) -> SchedulerCandidate {
    SchedulerCandidate {
        kind: SchedulerItemKind::Reaction,
        phase_priority: hook_phase_priority(binding.definition.hook_phase),
        explicit_priority: binding.definition.priority,
        source_stable_id: binding.owner_combatant_id.clone(),
        effect_stable_id: binding.definition.reaction_id.clone(),
    }
}

fn binding_for_item<'a>(
    bindings: &'a [ReactionBinding],
    item: &SchedulerItem,
) -> Option<&'a ReactionBinding> {
    bindings.iter().find(|binding| {
        binding.owner_combatant_id == item.source_stable_id
            && binding.definition.reaction_id == item.effect_stable_id
            && hook_phase_priority(binding.definition.hook_phase) == item.phase_priority
            && binding.definition.priority == item.explicit_priority
    })
}

fn current_reaction_item(state: &CombatState) -> Result<SchedulerItem, ReactionRuleError> {
    let item = state
        .scheduler
        .as_ref()
        .and_then(|scheduler| scheduler.current_item.clone())
        .ok_or_else(|| rule_error(ReactionRuleErrorCode::SchedulerFailure, "current-item"))?;
    if item.kind != SchedulerItemKind::Reaction {
        return Err(rule_error(
            ReactionRuleErrorCode::WrongSchedulerItemKind,
            &item.effect_stable_id,
        ));
    }
    Ok(item)
}

fn authority_for<'a>(
    assignments: &'a [CombatControlAssignment],
    owner_id: &str,
) -> Result<&'a CombatControlAuthority, ReactionRuleError> {
    let mut matches = assignments
        .iter()
        .filter(|assignment| assignment.combatant_id == owner_id);
    let assignment = matches
        .next()
        .ok_or_else(|| rule_error(ReactionRuleErrorCode::InvalidOwnership, owner_id))?;
    if matches.next().is_some() {
        return Err(rule_error(
            ReactionRuleErrorCode::InvalidOwnership,
            owner_id,
        ));
    }
    Ok(&assignment.authority)
}

fn is_player_ask(
    state: &CombatState,
    item: &SchedulerItem,
    bindings: &[ReactionBinding],
    assignments: &[CombatControlAssignment],
) -> bool {
    binding_for_item(bindings, item).is_some_and(|binding| {
        binding.definition.mode == ReactionExecutionMode::Ask
            && authority_for(assignments, &binding.owner_combatant_id)
                .ok()
                .and_then(|authority| execution_route(state, binding, authority).ok())
                .is_some_and(|route| matches!(route, RuntimeRoute::AskPlayer))
    })
}

fn same_ask_prefix(first: &SchedulerItem, next: &SchedulerItem) -> bool {
    next.kind == SchedulerItemKind::Reaction
        && first.phase_priority == next.phase_priority
        && first.explicit_priority == next.explicit_priority
        && first.source_initiative_order == next.source_initiative_order
        && first.source_stable_id == next.source_stable_id
}

fn same_pending_item(
    actual: &SchedulerItem,
    suspended: &SchedulerItem,
    may_be_counted: bool,
) -> bool {
    actual.kind == suspended.kind
        && actual.event_chain_id == suspended.event_chain_id
        && actual.depth == suspended.depth
        && actual.phase_priority == suspended.phase_priority
        && actual.explicit_priority == suspended.explicit_priority
        && actual.source_initiative_order == suspended.source_initiative_order
        && actual.source_stable_id == suspended.source_stable_id
        && actual.effect_stable_id == suspended.effect_stable_id
        && actual.sequence == suspended.sequence
        && (actual.execution_counted == suspended.execution_counted
            || may_be_counted && actual.execution_counted && !suspended.execution_counted)
}

fn scheduler_item_cmp(left: &SchedulerItem, right: &SchedulerItem) -> Ordering {
    crate::scheduler::canonical_cmp(left, right)
}

const fn hook_phase_priority(phase: HookPhase) -> i32 {
    match phase {
        HookPhase::RoundStart => 200,
        HookPhase::OwnerTurnStart => 300,
        HookPhase::PreAction => 400,
        HookPhase::BeforeRoll => 500,
        HookPhase::AfterRoll => 600,
        HookPhase::Outcome => 700,
        HookPhase::PreEffect => 800,
        HookPhase::PostEffect => 900,
        HookPhase::OwnerTurnEnd => 1_100,
        HookPhase::RoundEnd => 1_200,
    }
}

fn reaction_execution_id(item: &SchedulerItem) -> String {
    scheduler_identity("reaction", item)
}

fn scheduler_identity(domain: &str, item: &SchedulerItem) -> String {
    let mut hasher = Sha256::new();
    hasher.update(domain.as_bytes());
    hasher.update([0]);
    hasher.update(item.event_chain_id.as_bytes());
    hasher.update([0]);
    hasher.update(item.sequence.to_be_bytes());
    format!("{domain}:{:x}", hasher.finalize())
}

fn validate_working_state(state: &CombatState, subject: &str) -> Result<(), ReactionRuleError> {
    CanonicalReactionCore::validate_state(state)?;
    CanonicalEventChainScheduler::validate_state(state)
        .map_err(|_| rule_error(ReactionRuleErrorCode::StateInvariantViolation, subject))?;
    state
        .validate_for_commit()
        .map_err(|_| rule_error(ReactionRuleErrorCode::StateInvariantViolation, subject))
}

fn bump_revision(state: &mut CombatState, subject: &str) -> Result<(), ReactionRuleError> {
    state.revision = state
        .revision
        .checked_add(1)
        .ok_or_else(|| rule_error(ReactionRuleErrorCode::SequenceExhausted, subject))?;
    Ok(())
}

fn rule_error(code: ReactionRuleErrorCode, subject_id: impl Into<String>) -> ReactionRuleError {
    ReactionRuleError {
        code,
        subject_id: subject_id.into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        AbilityUsageState, AcceptedCommandLedger, CURRENT_COMBAT_VERSIONS, CombatCommandEnvelope,
        CombatPhase, CombatRng, CombatSide, CombatantRuntime, CombatantState,
        CommandAcceptanceStatus, EffectAmount, ObjectiveRuntimeState, ProvisionalRuntimeDelta,
        ReinforcementRuntimeState, RoundRosterEntry, RoundRosterStatus, RoundRuntimeState,
        TimelineEntry,
    };

    const SEED: &str = "0123456789abcdef0123456789abcdef";

    #[test]
    fn auto_reaction_enters_scheduler_commits_charge_then_releases_effects() {
        let (mut state, _ledger) = prepared_state();
        let bindings = vec![binding(
            "actor-a",
            "reaction-auto",
            ReactionExecutionMode::Auto,
            1,
        )];
        enqueue_and_dequeue(&mut state, &bindings);
        let rng_before = state.rng.clone();

        let ReactionRouteOutcome::ReadyToExecute(permit) =
            CanonicalReactionCore::route_current(&mut state, &bindings, &assignments(), None)
                .unwrap()
        else {
            panic!("expected execution permit")
        };
        assert_eq!(permit.reaction_id, "reaction-auto");
        assert_eq!(permit.effects.len(), 1);
        assert_eq!(state.combatants[0].reaction_charges, 0);
        assert_eq!(state.scheduler.as_ref().unwrap().executed_event_count, 1);
        assert_eq!(state.rng, rng_before);
    }

    #[test]
    fn disabled_is_not_enqueued_and_depleted_charge_skips_without_cost_or_count() {
        let (mut state, _ledger) = prepared_state();
        let disabled = binding(
            "actor-a",
            "reaction-disabled",
            ReactionExecutionMode::Disabled,
            1,
        );
        assert!(
            CanonicalReactionCore::enqueue_roots(&mut state, &[disabled])
                .unwrap()
                .is_empty()
        );

        let active = binding("actor-a", "reaction-auto", ReactionExecutionMode::Auto, 1);
        CanonicalReactionCore::enqueue_roots(&mut state, std::slice::from_ref(&active)).unwrap();
        CanonicalEventChainScheduler::dequeue_next(&mut state)
            .unwrap()
            .unwrap();
        state.combatants[0].reaction_charges = 0;
        let before_costs = state.cost_reservations.clone();
        assert!(matches!(
            CanonicalReactionCore::route_current(&mut state, &[active], &assignments(), None)
                .unwrap(),
            ReactionRouteOutcome::Skipped { .. }
        ));
        assert_eq!(state.cost_reservations, before_costs);
        assert_eq!(state.scheduler.as_ref().unwrap().executed_event_count, 0);
    }

    #[test]
    fn utility_owned_ask_never_opens_player_window_and_requires_typed_decision() {
        let (mut state, _ledger) = prepared_state();
        let bindings = vec![binding(
            "actor-b",
            "reaction-guard",
            ReactionExecutionMode::Ask,
            1,
        )];
        enqueue_and_dequeue(&mut state, &bindings);

        assert_eq!(
            CanonicalReactionCore::route_current(&mut state, &bindings, &assignments(), None)
                .unwrap(),
            ReactionRouteOutcome::UtilityDecisionRequired {
                owner_combatant_id: "actor-b".into(),
                reaction_id: "reaction-guard".into(),
            }
        );
        assert!(state.pending_reaction.is_none());
        assert!(matches!(
            CanonicalReactionCore::route_current(
                &mut state,
                &bindings,
                &assignments(),
                Some(&UtilityReactionDecision {
                    owner_combatant_id: "actor-b".into(),
                    reaction_id: "reaction-guard".into(),
                    trigger: false,
                })
            )
            .unwrap(),
            ReactionRouteOutcome::Skipped { .. }
        ));
        assert_eq!(state.combatants[1].reaction_charges, 1);
    }

    #[test]
    fn ask_window_suspends_and_restores_exact_context_queue_and_rng() {
        let (mut state, _ledger) = prepared_state();
        let bindings = vec![binding(
            "actor-a",
            "reaction-ask",
            ReactionExecutionMode::Ask,
            1,
        )];
        enqueue_and_dequeue(&mut state, &bindings);
        let rng_before = state.rng.clone();

        let ReactionRouteOutcome::AskWindowOpened(window) =
            CanonicalReactionCore::route_current(&mut state, &bindings, &assignments(), None)
                .unwrap()
        else {
            panic!("expected ask window")
        };
        assert_eq!(window.eligible_reaction_ids, vec!["reaction-ask"]);
        assert_eq!(window.eligible_items[0].scheduler_item.depth, 1);
        assert!(state.scheduler.as_ref().unwrap().current_item.is_none());
        assert_eq!(state.rng, rng_before);
        assert_eq!(
            state.resolution_context.as_ref().unwrap().status,
            crate::ResolutionContextStatus::SuspendedForReaction
        );
        let contract = CanonicalReactionCore::continuation_snapshot(&state).unwrap();
        let encoded = serde_json::to_vec(&contract).unwrap();
        let decoded: ReactionContinuationSnapshot = serde_json::from_slice(&encoded).unwrap();
        assert_eq!(decoded, contract);
        let restored = state.snapshot().unwrap().verify_and_restore().unwrap();
        assert_eq!(restored, state);
    }

    #[test]
    fn multi_ask_snapshot_continues_deterministically_and_accepts_trigger_exactly_once() {
        let (mut state, mut ledger) = prepared_state();
        let bindings = vec![
            binding("actor-a", "reaction-a", ReactionExecutionMode::Ask, 1),
            binding("actor-a", "reaction-b", ReactionExecutionMode::Ask, 1),
        ];
        enqueue_and_dequeue(&mut state, &bindings);
        let ReactionRouteOutcome::AskWindowOpened(window) =
            CanonicalReactionCore::route_current(&mut state, &bindings, &assignments(), None)
                .unwrap()
        else {
            panic!("expected ask window")
        };
        assert_eq!(
            window.eligible_reaction_ids,
            vec!["reaction-a", "reaction-b"]
        );
        let first_sequence = window.eligible_items[0].scheduler_item.sequence;
        let rng_before = state.rng.clone();
        let completed_hooks_before = state
            .resolution_context
            .as_ref()
            .unwrap()
            .completed_hook_phases
            .clone();
        let contract_before = CanonicalReactionCore::continuation_snapshot(&state).unwrap();
        let mut restored = state.snapshot().unwrap().verify_and_restore().unwrap();
        assert_eq!(
            CanonicalReactionCore::continuation_snapshot(&restored).unwrap(),
            contract_before
        );
        let mut restored_ledger = ledger.clone();
        let envelope = decision_envelope(
            "decision-1",
            &window.window_id,
            ReactionDecisionChoice::Trigger,
            Some("reaction-b"),
        );

        let original_outcome = CanonicalReactionCore::resolve_ask_window(
            &mut state,
            &mut ledger,
            envelope.clone(),
            &bindings,
            &assignments(),
        )
        .unwrap();
        let restored_outcome = CanonicalReactionCore::resolve_ask_window(
            &mut restored,
            &mut restored_ledger,
            envelope.clone(),
            &bindings,
            &assignments(),
        )
        .unwrap();
        assert_eq!(original_outcome, restored_outcome);
        assert_eq!(
            original_outcome.status,
            ReactionDecisionStatus::AcceptedTrigger
        );
        assert_eq!(original_outcome.permit.unwrap().reaction_id, "reaction-b");
        assert_eq!(restored, state);
        assert_eq!(restored_ledger, ledger);
        assert_eq!(state.rng, rng_before);
        assert_eq!(
            state
                .resolution_context
                .as_ref()
                .unwrap()
                .completed_hook_phases,
            completed_hooks_before
        );
        assert!(
            state
                .resolution_context
                .as_ref()
                .unwrap()
                .suspensions
                .last()
                .unwrap()
                .resumed
        );
        assert_eq!(state.combatants[0].reaction_charges, 0);
        let resolved_contract = CanonicalReactionCore::continuation_snapshot(&state).unwrap();
        assert_eq!(
            serde_json::from_slice::<ReactionContinuationSnapshot>(
                &serde_json::to_vec(&resolved_contract).unwrap()
            )
            .unwrap(),
            resolved_contract
        );
        assert_eq!(
            state.scheduler.as_ref().unwrap().queue[0].sequence,
            first_sequence
        );
        assert_eq!(
            state
                .cost_reservations
                .iter()
                .filter(|record| record.status == crate::CostReservationStatus::Committed)
                .count(),
            1
        );

        let before_replay = state.clone();
        assert_eq!(
            CanonicalReactionCore::resolve_ask_window(
                &mut state,
                &mut ledger,
                envelope,
                &bindings,
                &assignments(),
            )
            .unwrap()
            .status,
            ReactionDecisionStatus::AlreadyResolved
        );
        assert_eq!(state, before_replay);
        let reservation_count = state.cost_reservations.len();
        assert!(matches!(
            CanonicalReactionCore::route_current(&mut state, &bindings, &assignments(), None)
                .unwrap(),
            ReactionRouteOutcome::ReadyToExecute(ReactionExecutionPermit { resumed: true, .. })
        ));
        assert_eq!(state.cost_reservations.len(), reservation_count);
        assert_eq!(state.combatants[0].reaction_charges, 0);
        CanonicalEventChainScheduler::complete_current(&mut state).unwrap();
        CanonicalReactionCore::clear_resolved_window(&mut state).unwrap();
        CanonicalEventChainScheduler::dequeue_next(&mut state)
            .unwrap()
            .unwrap();
        let rng_before_skip = state.rng.clone();
        let costs_before_skip = state.cost_reservations.clone();
        assert!(matches!(
            CanonicalReactionCore::route_current(&mut state, &bindings, &assignments(), None)
                .unwrap(),
            ReactionRouteOutcome::Skipped { .. }
        ));
        assert_eq!(state.rng, rng_before_skip);
        assert_eq!(state.cost_reservations, costs_before_skip);
    }

    #[test]
    fn skip_discards_only_the_window_items_and_rejects_a_conflicting_decision() {
        let (mut state, mut ledger) = prepared_state();
        let bindings = vec![binding(
            "actor-a",
            "reaction-ask",
            ReactionExecutionMode::Ask,
            1,
        )];
        enqueue_and_dequeue(&mut state, &bindings);
        let ReactionRouteOutcome::AskWindowOpened(window) =
            CanonicalReactionCore::route_current(&mut state, &bindings, &assignments(), None)
                .unwrap()
        else {
            panic!("expected ask window")
        };
        let skip_command = decision_envelope(
            "decision-skip",
            &window.window_id,
            ReactionDecisionChoice::Skip,
            None,
        );
        let outcome = CanonicalReactionCore::resolve_ask_window(
            &mut state,
            &mut ledger,
            skip_command.clone(),
            &bindings,
            &assignments(),
        )
        .unwrap();
        assert_eq!(outcome.status, ReactionDecisionStatus::AcceptedSkip);
        assert_eq!(state.combatants[0].reaction_charges, 1);
        assert_eq!(state.scheduler.as_ref().unwrap().executed_event_count, 0);
        let before = state.clone();
        assert_eq!(
            CanonicalReactionCore::resolve_ask_window(
                &mut state,
                &mut ledger,
                decision_envelope(
                    "decision-conflict",
                    &window.window_id,
                    ReactionDecisionChoice::Skip,
                    None,
                ),
                &bindings,
                &assignments(),
            )
            .unwrap_err()
            .code,
            ReactionRuleErrorCode::ReactionWindowConflict
        );
        assert_eq!(state, before);
        CanonicalReactionCore::clear_resolved_window(&mut state).unwrap();
        assert!(state.pending_reaction.is_none());
        assert_eq!(
            CanonicalReactionCore::resolve_ask_window(
                &mut state,
                &mut ledger,
                skip_command,
                &bindings,
                &assignments(),
            )
            .unwrap()
            .status,
            ReactionDecisionStatus::AlreadyResolved
        );
    }

    #[test]
    fn multiple_charges_allow_a_later_listed_item_to_open_a_new_window() {
        let (mut state, mut ledger) = prepared_state();
        state.combatants[0].reaction_charges = 2;
        state.combatants[0].max_reaction_charges = 2;
        let bindings = vec![
            binding("actor-a", "reaction-a", ReactionExecutionMode::Ask, 1),
            binding("actor-a", "reaction-b", ReactionExecutionMode::Ask, 1),
        ];
        enqueue_and_dequeue(&mut state, &bindings);
        let ReactionRouteOutcome::AskWindowOpened(window) =
            CanonicalReactionCore::route_current(&mut state, &bindings, &assignments(), None)
                .unwrap()
        else {
            panic!("expected ask window")
        };
        CanonicalReactionCore::resolve_ask_window(
            &mut state,
            &mut ledger,
            decision_envelope(
                "decision-first",
                &window.window_id,
                ReactionDecisionChoice::Trigger,
                Some("reaction-a"),
            ),
            &bindings,
            &assignments(),
        )
        .unwrap();
        CanonicalEventChainScheduler::complete_current(&mut state).unwrap();
        CanonicalReactionCore::clear_resolved_window(&mut state).unwrap();
        assert_eq!(state.combatants[0].reaction_charges, 1);
        CanonicalEventChainScheduler::dequeue_next(&mut state)
            .unwrap()
            .unwrap();
        assert!(matches!(
            CanonicalReactionCore::route_current(&mut state, &bindings, &assignments(), None)
                .unwrap(),
            ReactionRouteOutcome::AskWindowOpened(_)
        ));
    }

    #[test]
    fn auto_then_ask_share_canonical_queue_and_consume_two_available_charges() {
        let (mut state, mut ledger) = prepared_state();
        state.combatants[0].reaction_charges = 2;
        state.combatants[0].max_reaction_charges = 2;
        let bindings = vec![
            binding("actor-a", "reaction-a-auto", ReactionExecutionMode::Auto, 1),
            binding("actor-a", "reaction-b-ask", ReactionExecutionMode::Ask, 1),
        ];
        enqueue_and_dequeue(&mut state, &bindings);
        assert!(matches!(
            CanonicalReactionCore::route_current(&mut state, &bindings, &assignments(), None)
                .unwrap(),
            ReactionRouteOutcome::ReadyToExecute(ReactionExecutionPermit {
                reaction_id,
                ..
            }) if reaction_id == "reaction-a-auto"
        ));
        CanonicalEventChainScheduler::complete_current(&mut state).unwrap();
        CanonicalEventChainScheduler::dequeue_next(&mut state)
            .unwrap()
            .unwrap();
        let ReactionRouteOutcome::AskWindowOpened(window) =
            CanonicalReactionCore::route_current(&mut state, &bindings, &assignments(), None)
                .unwrap()
        else {
            panic!("expected ask window")
        };
        assert_eq!(window.eligible_reaction_ids, vec!["reaction-b-ask"]);
        CanonicalReactionCore::resolve_ask_window(
            &mut state,
            &mut ledger,
            decision_envelope(
                "decision-after-auto",
                &window.window_id,
                ReactionDecisionChoice::Trigger,
                Some("reaction-b-ask"),
            ),
            &bindings,
            &assignments(),
        )
        .unwrap();
        assert_eq!(state.combatants[0].reaction_charges, 0);
        assert_eq!(state.scheduler.as_ref().unwrap().executed_event_count, 2);
    }

    #[test]
    fn ask_trigger_loop_guard_failure_releases_without_cost_or_rng() {
        let (mut state, mut ledger) = prepared_state();
        let bindings = vec![binding(
            "actor-a",
            "reaction-ask",
            ReactionExecutionMode::Ask,
            1,
        )];
        enqueue_and_dequeue(&mut state, &bindings);
        state.scheduler.as_mut().unwrap().max_event_count = 0;
        let ReactionRouteOutcome::AskWindowOpened(window) =
            CanonicalReactionCore::route_current(&mut state, &bindings, &assignments(), None)
                .unwrap()
        else {
            panic!("expected ask window")
        };
        let rng_before = state.rng.clone();
        let outcome = CanonicalReactionCore::resolve_ask_window(
            &mut state,
            &mut ledger,
            decision_envelope(
                "decision-overflow",
                &window.window_id,
                ReactionDecisionChoice::Trigger,
                Some("reaction-ask"),
            ),
            &bindings,
            &assignments(),
        )
        .unwrap();
        assert_eq!(outcome.status, ReactionDecisionStatus::AcceptedTrigger);
        assert!(outcome.permit.is_none());
        assert_eq!(
            state.pending_reaction.as_ref().unwrap().cost_state,
            CostCommitState::Released
        );
        assert_eq!(state.combatants[0].reaction_charges, 1);
        assert!(state.cost_reservations.is_empty());
        assert_eq!(state.rng, rng_before);
        assert_eq!(
            state.snapshot().unwrap().verify_and_restore().unwrap(),
            state
        );
    }

    #[test]
    fn companion_cannot_gain_player_prompt_through_a_bad_player_assignment() {
        let (mut state, _ledger) = prepared_state();
        let bindings = vec![binding(
            "actor-b",
            "reaction-ask",
            ReactionExecutionMode::Ask,
            1,
        )];
        enqueue_and_dequeue(&mut state, &bindings);
        let bad_assignments = vec![CombatControlAssignment {
            combatant_id: "actor-b".into(),
            authority: CombatControlAuthority::Player {
                controller_id: "controller-a".into(),
            },
        }];
        let before = state.clone();
        assert_eq!(
            CanonicalReactionCore::route_current(&mut state, &bindings, &bad_assignments, None)
                .unwrap_err()
                .code,
            ReactionRuleErrorCode::InvalidOwnership
        );
        assert_eq!(state, before);
    }

    #[test]
    fn malformed_binding_without_exact_owner_charge_cost_fails_before_enqueue() {
        let (mut state, _ledger) = prepared_state();
        let mut malformed = binding("actor-a", "reaction-bad", ReactionExecutionMode::Auto, 1);
        malformed.definition.costs.clear();
        let before = state.clone();
        assert_eq!(
            CanonicalReactionCore::enqueue_roots(&mut state, &[malformed])
                .unwrap_err()
                .code,
            ReactionRuleErrorCode::InvalidDefinition
        );
        assert_eq!(state, before);
    }

    #[test]
    fn single_ask_window_blocks_the_shared_scheduler_until_decided() {
        let (mut state, _ledger) = prepared_state();
        let bindings = vec![
            binding("actor-a", "reaction-a", ReactionExecutionMode::Ask, 1),
            binding("actor-a", "reaction-b", ReactionExecutionMode::Auto, 1),
            binding("actor-a", "reaction-c", ReactionExecutionMode::Ask, 1),
        ];
        enqueue_and_dequeue(&mut state, &bindings);
        let ReactionRouteOutcome::AskWindowOpened(window) =
            CanonicalReactionCore::route_current(&mut state, &bindings, &assignments(), None)
                .unwrap()
        else {
            panic!("expected ask window")
        };
        assert_eq!(window.eligible_reaction_ids, vec!["reaction-a"]);
        assert_eq!(
            state.scheduler.as_ref().unwrap().queue[0].effect_stable_id,
            "reaction-b"
        );
        let before = state.clone();
        assert!(!CanonicalEventChainScheduler::is_quiescent(&state));
        assert_eq!(
            CanonicalEventChainScheduler::dequeue_next(&mut state)
                .unwrap_err()
                .code,
            crate::EventSchedulerErrorCode::SuspendedForReaction
        );
        assert_eq!(
            CanonicalEventChainScheduler::enqueue_roots(&mut state, vec![])
                .unwrap_err()
                .code,
            crate::EventSchedulerErrorCode::SuspendedForReaction
        );
        assert_eq!(state, before);
    }

    #[test]
    fn depleted_ask_is_skipped_before_opening_a_window() {
        let (mut state, _ledger) = prepared_state();
        let bindings = vec![binding(
            "actor-a",
            "reaction-ask",
            ReactionExecutionMode::Ask,
            1,
        )];
        enqueue_and_dequeue(&mut state, &bindings);
        state.combatants[0].reaction_charges = 0;
        assert!(matches!(
            CanonicalReactionCore::route_current(&mut state, &bindings, &assignments(), None)
                .unwrap(),
            ReactionRouteOutcome::Skipped { .. }
        ));
        assert!(state.pending_reaction.is_none());
        assert_eq!(state.scheduler.as_ref().unwrap().executed_event_count, 0);
        assert!(state.cost_reservations.is_empty());
    }

    #[test]
    fn missing_cost_asset_is_an_error_instead_of_silent_candidate_omission() {
        let (mut state, _ledger) = prepared_state();
        let mut reaction = binding(
            "actor-a",
            "reaction-invalid",
            ReactionExecutionMode::Auto,
            1,
        );
        reaction.definition.costs.push(CombatCostRequestLine {
            cost_id: "mana-cost".into(),
            asset: CombatCostAsset::Resource {
                combatant_id: "actor-a".into(),
                resource_id: "missing-mana".into(),
            },
            amount: 1,
            consume_cost_on_interrupt: false,
        });
        let before = state.clone();
        assert_eq!(
            CanonicalReactionCore::enqueue_roots(&mut state, &[reaction])
                .unwrap_err()
                .code,
            ReactionRuleErrorCode::CostFailure
        );
        assert_eq!(state, before);
    }

    #[test]
    fn counted_item_without_committed_cost_cannot_resume_for_free() {
        let (mut state, _ledger) = prepared_state();
        let bindings = vec![binding(
            "actor-a",
            "reaction-auto",
            ReactionExecutionMode::Auto,
            1,
        )];
        enqueue_and_dequeue(&mut state, &bindings);
        CanonicalEventChainScheduler::gate_current_for_execution(&mut state, true).unwrap();
        let before = state.clone();
        assert_eq!(
            CanonicalReactionCore::route_current(&mut state, &bindings, &assignments(), None)
                .unwrap_err()
                .code,
            ReactionRuleErrorCode::CostFailure
        );
        assert_eq!(state, before);
    }

    #[test]
    fn utility_execution_resume_does_not_request_a_second_decision() {
        let (mut state, _ledger) = prepared_state();
        let bindings = vec![binding(
            "actor-b",
            "reaction-ai",
            ReactionExecutionMode::AiEvaluate,
            1,
        )];
        enqueue_and_dequeue(&mut state, &bindings);
        CanonicalReactionCore::route_current(
            &mut state,
            &bindings,
            &assignments(),
            Some(&UtilityReactionDecision {
                owner_combatant_id: "actor-b".into(),
                reaction_id: "reaction-ai".into(),
                trigger: true,
            }),
        )
        .unwrap();
        state = state.snapshot().unwrap().verify_and_restore().unwrap();
        let before = state.clone();
        assert!(matches!(
            CanonicalReactionCore::route_current(&mut state, &bindings, &assignments(), None)
                .unwrap(),
            ReactionRouteOutcome::ReadyToExecute(ReactionExecutionPermit { resumed: true, .. })
        ));
        assert_eq!(state, before);
    }

    #[test]
    fn ask_cannot_suspend_a_different_resolution_hook() {
        let (mut state, _ledger) = prepared_state();
        let mut reaction = binding("actor-a", "reaction-ask", ReactionExecutionMode::Ask, 1);
        reaction.definition.hook_phase = HookPhase::BeforeRoll;
        let bindings = vec![reaction];
        enqueue_and_dequeue(&mut state, &bindings);
        let before = state.clone();
        assert_eq!(
            CanonicalReactionCore::route_current(&mut state, &bindings, &assignments(), None)
                .unwrap_err()
                .code,
            ReactionRuleErrorCode::ContextFailure
        );
        assert_eq!(state, before);
    }

    #[test]
    fn maximum_length_chain_supports_ask_and_cost_identity() {
        let (mut state, _ledger) = prepared_state();
        let chain_id = "c".repeat(128);
        state.scheduler.as_mut().unwrap().event_chain_id = chain_id.clone();
        state.resolution_context.as_mut().unwrap().event_chain_id = chain_id;
        let bindings = vec![binding(
            "actor-a",
            "reaction-ask",
            ReactionExecutionMode::Ask,
            1,
        )];
        enqueue_and_dequeue(&mut state, &bindings);
        let ReactionRouteOutcome::AskWindowOpened(window) =
            CanonicalReactionCore::route_current(&mut state, &bindings, &assignments(), None)
                .unwrap()
        else {
            panic!("expected window")
        };
        assert!(valid_stable_id(&window.window_id));
        assert_eq!(
            state.snapshot().unwrap().verify_and_restore().unwrap(),
            state
        );
    }

    #[test]
    fn tampered_pending_item_shape_and_selected_identity_fail_restore() {
        let (mut state, _ledger) = prepared_state();
        let bindings = vec![binding(
            "actor-a",
            "reaction-ask",
            ReactionExecutionMode::Ask,
            1,
        )];
        enqueue_and_dequeue(&mut state, &bindings);
        CanonicalReactionCore::route_current(&mut state, &bindings, &assignments(), None).unwrap();

        for variant in 0..5 {
            let mut malformed = state.clone();
            let window = malformed.pending_reaction.as_mut().unwrap();
            match variant {
                0 => window.eligible_items[0].scheduler_item.depth = 0,
                1 => window.eligible_items[0].scheduler_item.sequence = 0,
                2 => {
                    window.eligible_items[0]
                        .scheduler_item
                        .source_initiative_order = u32::MAX
                }
                3 => window.eligible_items[0].scheduler_item.phase_priority += 1,
                4 => window.selected_reaction_id = Some("reaction-unknown".into()),
                _ => unreachable!(),
            }
            assert!(matches!(
                malformed.snapshot().unwrap().verify_and_restore(),
                Err(crate::CombatStateRestoreError::Invariant(
                    crate::CombatStateInvariantError {
                        code: crate::CombatStateInvariantCode::ReactionWindowInvalid,
                        ..
                    }
                ))
            ));
        }
        assert_eq!(
            state.snapshot().unwrap().verify_and_restore().unwrap(),
            state
        );
    }

    #[test]
    fn continuation_contract_rejects_unknown_fields() {
        let (mut state, _ledger) = prepared_state();
        let bindings = vec![binding(
            "actor-a",
            "reaction-ask",
            ReactionExecutionMode::Ask,
            1,
        )];
        enqueue_and_dequeue(&mut state, &bindings);
        CanonicalReactionCore::route_current(&mut state, &bindings, &assignments(), None).unwrap();
        let snapshot = CanonicalReactionCore::continuation_snapshot(&state).unwrap();
        let mut value = serde_json::to_value(snapshot).unwrap();
        value
            .as_object_mut()
            .unwrap()
            .insert("runtimeCode".into(), serde_json::json!("execute()"));
        assert!(serde_json::from_value::<ReactionContinuationSnapshot>(value).is_err());
    }

    fn prepared_state() -> (CombatState, AcceptedCommandLedger) {
        let mut state = fixture_state();
        let mut ledger = AcceptedCommandLedger::new();
        let accepted = ledger
            .accept_external(CombatCommandEnvelope {
                command_id: "command-attack".into(),
                source: crate::CombatCommandSource::Player {
                    controller_id: "controller-a".into(),
                },
                actor_id: "actor-a".into(),
                versions: CURRENT_COMBAT_VERSIONS,
                payload: CombatCommandPayload::UseAbility {
                    ability_id: "ability-attack".into(),
                    target_id: Some("actor-b".into()),
                },
            })
            .unwrap();
        assert_eq!(accepted.status, CommandAcceptanceStatus::Accepted);
        ResolutionContextLifecycle::create(&mut state, accepted.command, "chain-1".into(), None)
            .unwrap();
        for (from, to) in [
            (HookPhase::PreAction, HookPhase::BeforeRoll),
            (HookPhase::BeforeRoll, HookPhase::AfterRoll),
            (HookPhase::AfterRoll, HookPhase::Outcome),
            (HookPhase::Outcome, HookPhase::PreEffect),
        ] {
            ResolutionContextLifecycle::complete_hook(&mut state, from, to).unwrap();
        }
        CanonicalEventChainScheduler::begin(&mut state, "chain-1".into(), 32, 256).unwrap();
        (state, ledger)
    }

    fn enqueue_and_dequeue(state: &mut CombatState, bindings: &[ReactionBinding]) {
        CanonicalReactionCore::enqueue_roots(state, bindings).unwrap();
        CanonicalEventChainScheduler::dequeue_next(state)
            .unwrap()
            .unwrap();
    }

    fn binding(
        owner_id: &str,
        reaction_id: &str,
        mode: ReactionExecutionMode,
        charge: i64,
    ) -> ReactionBinding {
        ReactionBinding {
            owner_combatant_id: owner_id.into(),
            definition: ReactionDefinition {
                reaction_schema_version: CURRENT_REACTION_SCHEMA_VERSION,
                reaction_id: reaction_id.into(),
                hook_phase: HookPhase::PreEffect,
                priority: 10,
                mode,
                costs: vec![CombatCostRequestLine {
                    cost_id: format!("{reaction_id}-charge"),
                    asset: CombatCostAsset::ReactionCharge {
                        combatant_id: owner_id.into(),
                    },
                    amount: charge,
                    consume_cost_on_interrupt: false,
                }],
                effects: vec![EffectDefinition::Heal {
                    amount: EffectAmount::Flat { amount: 1 },
                }],
            },
        }
    }

    fn decision_envelope(
        command_id: &str,
        window_id: &str,
        choice: ReactionDecisionChoice,
        selected: Option<&str>,
    ) -> CombatCommandEnvelope {
        CombatCommandEnvelope {
            command_id: command_id.into(),
            source: crate::CombatCommandSource::Player {
                controller_id: "controller-a".into(),
            },
            actor_id: "actor-a".into(),
            versions: CURRENT_COMBAT_VERSIONS,
            payload: CombatCommandPayload::ResolveReaction {
                reaction_window_id: window_id.into(),
                choice,
                selected_reaction_id: selected.map(str::to_owned),
            },
        }
    }

    fn assignments() -> Vec<CombatControlAssignment> {
        vec![
            CombatControlAssignment {
                combatant_id: "actor-a".into(),
                authority: CombatControlAuthority::Player {
                    controller_id: "controller-a".into(),
                },
            },
            CombatControlAssignment {
                combatant_id: "actor-b".into(),
                authority: CombatControlAuthority::UtilityAi,
            },
        ]
    }

    fn fixture_state() -> CombatState {
        let combatant = |id: &str, side: CombatSide| CombatantRuntime {
            combatant_id: id.into(),
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
            resources: vec![],
            statuses: vec![],
            ability_usage: vec![AbilityUsageState {
                ability_id: "ability-attack".into(),
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
            combat_instance_id: "combat-reaction-fixture".into(),
            versions: CURRENT_COMBAT_VERSIONS,
            random_seed: SEED.into(),
            revision: 1,
            last_committed_sequence: 0,
            phase: CombatPhase::Action,
            combatants: vec![
                combatant("actor-a", CombatSide::Player),
                combatant("actor-b", CombatSide::Companion),
            ],
            formal_party_member_ids: vec!["actor-a".into(), "actor-b".into()],
            combat_inventory: vec![],
            cost_reservations: vec![],
            resolution_context: None,
            timeline: vec![
                TimelineEntry {
                    combatant_id: "actor-a".into(),
                    initiative_result: 10,
                    initiative_base_stat: 2,
                    is_extra_turn: false,
                    source_sequence: 1,
                },
                TimelineEntry {
                    combatant_id: "actor-b".into(),
                    initiative_result: 9,
                    initiative_base_stat: 2,
                    is_extra_turn: false,
                    source_sequence: 2,
                },
            ],
            round: RoundRuntimeState {
                round_number: 1,
                completed_round_count: 0,
                active_combatant_id: Some("actor-a".into()),
                extra_turn_resume_phase: None,
                roster: vec![
                    RoundRosterEntry {
                        combatant_id: "actor-a".into(),
                        normal_turn_slot: 0,
                        status: RoundRosterStatus::Pending,
                    },
                    RoundRosterEntry {
                        combatant_id: "actor-b".into(),
                        normal_turn_slot: 1,
                        status: RoundRosterStatus::Pending,
                    },
                ],
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
                "combat-reaction-fixture",
                CURRENT_COMBAT_VERSIONS.rng_contract_version,
            )
            .unwrap()
            .snapshot(),
        }
    }
}

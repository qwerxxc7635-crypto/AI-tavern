use std::{error::Error, fmt};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::{
    CanonicalEventChainScheduler, CombatCommandPayload, CombatControlAssignment,
    CombatControlAuthority, CombatCostAsset, CombatCostRequestLine, CombatState, CostCommitState,
    CostReservationModel, CostReservationRequest, EffectDefinition, HookPhase,
    PendingReactionWindow, ResolutionContextLifecycle, SchedulerCandidate,
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
pub enum ReactionRuleErrorCode {
    InvalidDefinition,
    DuplicateBinding,
    MissingBinding,
    WrongSchedulerItemKind,
    InvalidOwnership,
    InvalidUtilityDecision,
    MissingResolutionContext,
    ReactionWindowConflict,
    SchedulerFailure,
    CostFailure,
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
        let Some(item) = scheduler.current_item.as_ref() else {
            return Err(rule_error(
                ReactionRuleErrorCode::StateInvariantViolation,
                &window.window_id,
            ));
        };
        let valid = valid_stable_id(&window.window_id)
            && window.eligible_reaction_ids.len() == 1
            && window.eligible_reaction_ids[0] == item.effect_stable_id
            && state.combatants.iter().any(|owner| {
                owner.combatant_id == window.actor_id && owner.side == crate::CombatSide::Player
            })
            && item.kind == SchedulerItemKind::Reaction
            && item.event_chain_id == window.event_chain_id
            && item.phase_priority == hook_phase_priority(window.hook_phase)
            && !item.execution_counted
            && window.sequence_number == item.sequence
            && window.actor_id == item.source_stable_id
            && window.resolution_context_id == context.context_id
            && window.source_command_id == context.command.command_id
            && window.event_chain_id == context.event_chain_id
            && window.event_chain_id == scheduler.event_chain_id
            && window.hook_phase == context.current_hook_phase
            && context.status == crate::ResolutionContextStatus::SuspendedForReaction
            && window.selected_reaction_id.is_none()
            && window.accepted_reaction_decision_command_id.is_none()
            && window.cost_state == CostCommitState::Reserved
            && context.suspensions.last().is_some_and(|suspension| {
                suspension.reaction_window_id == window.window_id && !suspension.resumed
            });
        if !valid {
            return Err(rule_error(
                ReactionRuleErrorCode::StateInvariantViolation,
                &window.window_id,
            ));
        }
        Ok(())
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
        if state.pending_reaction.is_some() {
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
            RuntimeRoute::AskPlayer => open_ask_window(state),
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

fn open_ask_window(state: &mut CombatState) -> Result<ReactionRouteOutcome, ReactionRuleError> {
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
    let window_id = scheduler_identity("reaction-window", &first);
    let mut working = state.clone();
    ResolutionContextLifecycle::suspend_for_ask(&mut working, &window_id)
        .map_err(|error| rule_error(ReactionRuleErrorCode::ContextFailure, error.subject_id))?;
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
        eligible_reaction_ids: vec![first.effect_stable_id.clone()],
        selected_reaction_id: None,
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
        assert!(state.scheduler.as_ref().unwrap().current_item.is_some());
        assert_eq!(state.rng, rng_before);
        assert_eq!(
            state.resolution_context.as_ref().unwrap().status,
            crate::ResolutionContextStatus::SuspendedForReaction
        );
        let restored = state.snapshot().unwrap().verify_and_restore().unwrap();
        assert_eq!(restored, state);
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

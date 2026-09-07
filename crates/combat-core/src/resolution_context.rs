use std::{error::Error, fmt};

use serde::{Deserialize, Serialize};

use crate::{
    AcceptedCombatCommand, CombatCommandPayload, CombatRng, CombatRngSnapshot, CombatState,
    CostCommitState, CostReservationStatus, HookPhase, RngChannel,
};

const MAX_SAFE_SEQUENCE: u64 = 9_007_199_254_740_991;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ResolutionContextStatus {
    ExecutingHooks,
    SuspendedForReaction,
    ReadyForExecutionRevalidation,
    ResolutionStarted,
    CancelledBeforeResolution,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TargetRedirectRecord {
    pub sequence: u64,
    pub from_target_id: String,
    pub to_target_id: String,
    pub rule_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResolvedRollRecord {
    pub roll_id: String,
    pub channel: RngChannel,
    pub sides: u32,
    pub value: u32,
    pub cursor_after: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResolutionSuspensionRecord {
    pub sequence: u64,
    pub reaction_window_id: String,
    pub hook_phase: HookPhase,
    pub rng_checkpoint: CombatRngSnapshot,
    pub resumed: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResolutionContext {
    pub context_id: String,
    pub accepted_sequence: u64,
    pub command: AcceptedCombatCommand,
    pub status: ResolutionContextStatus,
    pub current_hook_phase: HookPhase,
    pub completed_hook_phases: Vec<HookPhase>,
    pub original_target_ids: Vec<String>,
    pub effective_target_ids: Vec<String>,
    pub target_redirects: Vec<TargetRedirectRecord>,
    pub reservation_id: Option<String>,
    pub event_chain_id: String,
    pub rng_checkpoint: CombatRngSnapshot,
    pub resolved_rolls: Vec<ResolvedRollRecord>,
    pub suspensions: Vec<ResolutionSuspensionRecord>,
}

pub struct ResolutionContextLifecycle;

impl ResolutionContextLifecycle {
    pub fn create(
        state: &mut CombatState,
        command: AcceptedCombatCommand,
        event_chain_id: String,
        reservation_id: Option<String>,
    ) -> Result<ResolutionContext, ResolutionContextError> {
        Self::validate_state(state)?;
        let context_id = command.command_id.clone();
        if let Some(existing) = &state.resolution_context {
            if existing.context_id == context_id
                && existing.command == command
                && existing.event_chain_id == event_chain_id
                && existing.reservation_id == reservation_id
            {
                return Ok(existing.clone());
            }
            return Err(context_error(
                ResolutionContextErrorCode::ActiveContextConflict,
                &context_id,
            ));
        }
        if command.versions != state.versions || command.accepted_sequence == 0 {
            return Err(context_error(
                ResolutionContextErrorCode::CommandMismatch,
                &context_id,
            ));
        }
        validate_stable_id(&event_chain_id, &context_id)?;
        if !state
            .combatants
            .iter()
            .any(|combatant| combatant.combatant_id == command.actor_id)
        {
            return Err(context_error(
                ResolutionContextErrorCode::CommandMismatch,
                &context_id,
            ));
        }
        validate_reservation(
            state,
            &command.command_id,
            reservation_id.as_deref(),
            &context_id,
        )?;
        if let Some(reservation_id) = &reservation_id
            && state
                .cost_reservations
                .iter()
                .find(|reservation| reservation.reservation_id == *reservation_id)
                .is_none_or(|reservation| reservation.status != CostReservationStatus::Reserved)
        {
            return Err(context_error(
                ResolutionContextErrorCode::ReservationMismatch,
                &context_id,
            ));
        }
        let original_target_ids = command_targets(&command);
        let context = ResolutionContext {
            context_id,
            accepted_sequence: command.accepted_sequence,
            command,
            status: ResolutionContextStatus::ExecutingHooks,
            current_hook_phase: HookPhase::PreAction,
            completed_hook_phases: vec![],
            original_target_ids: original_target_ids.clone(),
            effective_target_ids: original_target_ids,
            target_redirects: vec![],
            reservation_id,
            event_chain_id,
            rng_checkpoint: state.rng.clone(),
            resolved_rolls: vec![],
            suspensions: vec![],
        };
        let mut working = state.clone();
        working.resolution_context = Some(context.clone());
        bump_revision(&mut working, &context.context_id)?;
        Self::validate_state(&working)?;
        working.validate_for_commit().map_err(|_| {
            context_error(
                ResolutionContextErrorCode::StateInvariantViolation,
                &context.context_id,
            )
        })?;
        *state = working;
        Ok(context)
    }

    pub fn redirect_target(
        state: &mut CombatState,
        from_target_id: &str,
        to_target_id: &str,
        rule_id: &str,
    ) -> Result<ResolutionContext, ResolutionContextError> {
        validate_stable_id(from_target_id, from_target_id)?;
        validate_stable_id(to_target_id, to_target_id)?;
        validate_stable_id(rule_id, rule_id)?;
        mutate_context(state, |state, context| {
            require_executing(context)?;
            let position = context
                .effective_target_ids
                .iter()
                .position(|target| target == from_target_id)
                .ok_or_else(|| {
                    context_error(ResolutionContextErrorCode::TargetMismatch, from_target_id)
                })?;
            if !state
                .combatants
                .iter()
                .any(|combatant| combatant.combatant_id == to_target_id)
            {
                return Err(context_error(
                    ResolutionContextErrorCode::TargetMismatch,
                    to_target_id,
                ));
            }
            let sequence = next_sequence(context.target_redirects.len(), &context.context_id)?;
            context.effective_target_ids[position] = to_target_id.to_owned();
            context.target_redirects.push(TargetRedirectRecord {
                sequence,
                from_target_id: from_target_id.to_owned(),
                to_target_id: to_target_id.to_owned(),
                rule_id: rule_id.to_owned(),
            });
            Ok(())
        })
    }

    pub fn record_resolved_roll(
        state: &mut CombatState,
        record: ResolvedRollRecord,
    ) -> Result<ResolutionContext, ResolutionContextError> {
        validate_roll(&record)?;
        if let Some(context) = &state.resolution_context
            && let Some(existing) = context
                .resolved_rolls
                .iter()
                .find(|existing| existing.roll_id == record.roll_id)
        {
            return if existing == &record {
                Ok(context.clone())
            } else {
                Err(context_error(
                    ResolutionContextErrorCode::RollConflict,
                    &record.roll_id,
                ))
            };
        }
        mutate_context(state, |state, context| {
            require_executing(context)?;
            let stream = state
                .rng
                .streams
                .iter()
                .find(|stream| stream.channel_id == record.channel)
                .ok_or_else(|| {
                    context_error(ResolutionContextErrorCode::RngMismatch, &record.roll_id)
                })?;
            if stream.cursor != record.cursor_after {
                return Err(context_error(
                    ResolutionContextErrorCode::RngMismatch,
                    &record.roll_id,
                ));
            }
            context.resolved_rolls.push(record);
            context.rng_checkpoint = state.rng.clone();
            Ok(())
        })
    }

    pub fn complete_hook(
        state: &mut CombatState,
        hook_phase: HookPhase,
        next_hook_phase: HookPhase,
    ) -> Result<ResolutionContext, ResolutionContextError> {
        mutate_context(state, |_state, context| {
            require_executing(context)?;
            if context.current_hook_phase != hook_phase
                || context.completed_hook_phases.contains(&hook_phase)
                || !valid_hook_transition(hook_phase, next_hook_phase)
            {
                return Err(context_error(
                    ResolutionContextErrorCode::HookMismatch,
                    &context.context_id,
                ));
            }
            context.completed_hook_phases.push(hook_phase);
            context.current_hook_phase = next_hook_phase;
            Ok(())
        })
    }

    pub fn suspend_for_ask(
        state: &mut CombatState,
        reaction_window_id: &str,
    ) -> Result<ResolutionContext, ResolutionContextError> {
        validate_stable_id(reaction_window_id, reaction_window_id)?;
        mutate_context(state, |state, context| {
            require_executing(context)?;
            let sequence = next_sequence(context.suspensions.len(), &context.context_id)?;
            let checkpoint = state.rng.clone();
            context.suspensions.push(ResolutionSuspensionRecord {
                sequence,
                reaction_window_id: reaction_window_id.to_owned(),
                hook_phase: context.current_hook_phase,
                rng_checkpoint: checkpoint.clone(),
                resumed: false,
            });
            context.rng_checkpoint = checkpoint;
            context.status = ResolutionContextStatus::SuspendedForReaction;
            Ok(())
        })
    }

    pub fn resume_from_ask(
        state: &mut CombatState,
        reaction_window_id: &str,
    ) -> Result<ResolutionContext, ResolutionContextError> {
        validate_stable_id(reaction_window_id, reaction_window_id)?;
        mutate_context(state, |state, context| {
            if context.status != ResolutionContextStatus::SuspendedForReaction {
                return Err(context_error(
                    ResolutionContextErrorCode::InvalidTransition,
                    &context.context_id,
                ));
            }
            let suspension = context.suspensions.last_mut().ok_or_else(|| {
                context_error(
                    ResolutionContextErrorCode::InvalidContext,
                    &context.context_id,
                )
            })?;
            if suspension.reaction_window_id != reaction_window_id || suspension.resumed {
                return Err(context_error(
                    ResolutionContextErrorCode::SuspensionMismatch,
                    reaction_window_id,
                ));
            }
            if suspension.rng_checkpoint != state.rng {
                return Err(context_error(
                    ResolutionContextErrorCode::RngMismatch,
                    reaction_window_id,
                ));
            }
            suspension.resumed = true;
            context.status = ResolutionContextStatus::ExecutingHooks;
            Ok(())
        })
    }

    pub fn mark_ready_for_revalidation(
        state: &mut CombatState,
    ) -> Result<ResolutionContext, ResolutionContextError> {
        mutate_context(state, |state, context| {
            require_executing(context)?;
            if context.current_hook_phase != HookPhase::BeforeRoll
                || !context
                    .completed_hook_phases
                    .contains(&HookPhase::PreAction)
            {
                return Err(context_error(
                    ResolutionContextErrorCode::HookMismatch,
                    &context.context_id,
                ));
            }
            context.status = ResolutionContextStatus::ReadyForExecutionRevalidation;
            context.rng_checkpoint = state.rng.clone();
            Ok(())
        })
    }

    pub fn validate_state(state: &CombatState) -> Result<(), ResolutionContextError> {
        let Some(context) = &state.resolution_context else {
            return Ok(());
        };
        if context.status == ResolutionContextStatus::CancelledBeforeResolution {
            return Err(context_error(
                ResolutionContextErrorCode::InvalidContext,
                &context.context_id,
            ));
        }
        validate_context_shape(context)?;
        if context.command.command_id != context.context_id
            || context.command.accepted_sequence != context.accepted_sequence
            || context.command.versions != state.versions
        {
            return Err(context_error(
                ResolutionContextErrorCode::InvalidContext,
                &context.context_id,
            ));
        }
        validate_reservation(
            state,
            &context.command.command_id,
            context.reservation_id.as_deref(),
            &context.context_id,
        )?;
        if let Some(reservation_id) = &context.reservation_id {
            let reservation = state
                .cost_reservations
                .iter()
                .find(|reservation| reservation.reservation_id == *reservation_id)
                .ok_or_else(|| {
                    context_error(
                        ResolutionContextErrorCode::ReservationMismatch,
                        &context.context_id,
                    )
                })?;
            let expected = if context.status == ResolutionContextStatus::ResolutionStarted {
                CostReservationStatus::Committed
            } else {
                CostReservationStatus::Reserved
            };
            if reservation.status != expected {
                return Err(context_error(
                    ResolutionContextErrorCode::ReservationMismatch,
                    &context.context_id,
                ));
            }
        }
        CombatRng::restore(context.rng_checkpoint.clone()).map_err(|_| {
            context_error(ResolutionContextErrorCode::RngMismatch, &context.context_id)
        })?;
        let unresolved = context
            .suspensions
            .iter()
            .filter(|suspension| !suspension.resumed)
            .count();
        if (context.status == ResolutionContextStatus::SuspendedForReaction && unresolved != 1)
            || (context.status != ResolutionContextStatus::SuspendedForReaction && unresolved != 0)
        {
            return Err(context_error(
                ResolutionContextErrorCode::InvalidContext,
                &context.context_id,
            ));
        }
        if context.status == ResolutionContextStatus::SuspendedForReaction
            && context
                .suspensions
                .last()
                .is_none_or(|suspension| suspension.rng_checkpoint != state.rng)
        {
            return Err(context_error(
                ResolutionContextErrorCode::RngMismatch,
                &context.context_id,
            ));
        }
        Ok(())
    }
}

fn mutate_context(
    state: &mut CombatState,
    mutate: impl FnOnce(&CombatState, &mut ResolutionContext) -> Result<(), ResolutionContextError>,
) -> Result<ResolutionContext, ResolutionContextError> {
    ResolutionContextLifecycle::validate_state(state)?;
    let mut working = state.clone();
    let mut context = working.resolution_context.take().ok_or_else(|| {
        context_error(
            ResolutionContextErrorCode::ContextMissing,
            "resolution-context",
        )
    })?;
    mutate(&working, &mut context)?;
    let subject_id = context.context_id.clone();
    working.resolution_context = Some(context.clone());
    bump_revision(&mut working, &subject_id)?;
    ResolutionContextLifecycle::validate_state(&working)?;
    working.validate_for_commit().map_err(|_| {
        context_error(
            ResolutionContextErrorCode::StateInvariantViolation,
            &subject_id,
        )
    })?;
    *state = working;
    Ok(context)
}

fn validate_context_shape(context: &ResolutionContext) -> Result<(), ResolutionContextError> {
    validate_stable_id(&context.context_id, &context.context_id)?;
    validate_stable_id(&context.event_chain_id, &context.context_id)?;
    if context.accepted_sequence == 0 || context.accepted_sequence > MAX_SAFE_SEQUENCE {
        return Err(context_error(
            ResolutionContextErrorCode::InvalidContext,
            &context.context_id,
        ));
    }
    validate_unique_ids(&context.original_target_ids, &context.context_id)?;
    validate_unique_ids(&context.effective_target_ids, &context.context_id)?;
    if context.original_target_ids.len() != context.effective_target_ids.len() {
        return Err(context_error(
            ResolutionContextErrorCode::InvalidContext,
            &context.context_id,
        ));
    }
    if has_duplicates(&context.completed_hook_phases) {
        return Err(context_error(
            ResolutionContextErrorCode::InvalidContext,
            &context.context_id,
        ));
    }
    let mut replayed_targets = context.original_target_ids.clone();
    for (index, redirect) in context.target_redirects.iter().enumerate() {
        if redirect.sequence != next_sequence(index, &context.context_id)? {
            return Err(context_error(
                ResolutionContextErrorCode::InvalidContext,
                &context.context_id,
            ));
        }
        validate_stable_id(&redirect.from_target_id, &context.context_id)?;
        validate_stable_id(&redirect.to_target_id, &context.context_id)?;
        validate_stable_id(&redirect.rule_id, &context.context_id)?;
        let target = replayed_targets
            .iter_mut()
            .find(|target| **target == redirect.from_target_id)
            .ok_or_else(|| {
                context_error(
                    ResolutionContextErrorCode::InvalidContext,
                    &context.context_id,
                )
            })?;
        *target = redirect.to_target_id.clone();
    }
    if replayed_targets != context.effective_target_ids {
        return Err(context_error(
            ResolutionContextErrorCode::InvalidContext,
            &context.context_id,
        ));
    }
    for (index, roll) in context.resolved_rolls.iter().enumerate() {
        validate_roll(roll)?;
        if context.resolved_rolls[..index]
            .iter()
            .any(|previous| previous.roll_id == roll.roll_id)
        {
            return Err(context_error(
                ResolutionContextErrorCode::InvalidContext,
                &context.context_id,
            ));
        }
    }
    for (index, suspension) in context.suspensions.iter().enumerate() {
        if suspension.sequence != next_sequence(index, &context.context_id)?
            || context.suspensions[..index]
                .iter()
                .any(|previous| previous.reaction_window_id == suspension.reaction_window_id)
        {
            return Err(context_error(
                ResolutionContextErrorCode::InvalidContext,
                &context.context_id,
            ));
        }
        validate_stable_id(&suspension.reaction_window_id, &context.context_id)?;
        CombatRng::restore(suspension.rng_checkpoint.clone()).map_err(|_| {
            context_error(ResolutionContextErrorCode::RngMismatch, &context.context_id)
        })?;
    }
    Ok(())
}

fn validate_reservation(
    state: &CombatState,
    command_id: &str,
    reservation_id: Option<&str>,
    subject_id: &str,
) -> Result<(), ResolutionContextError> {
    let command_reservation = state
        .cost_reservations
        .iter()
        .find(|reservation| reservation.command_id == command_id);
    match (reservation_id, command_reservation) {
        (None, None) => Ok(()),
        (Some(expected), Some(actual))
            if expected == actual.reservation_id
                && !matches!(
                    actual.status,
                    CostReservationStatus::Released | CostReservationStatus::Interrupted
                )
                && actual
                    .costs
                    .iter()
                    .all(|cost| cost.state != CostCommitState::Released) =>
        {
            Ok(())
        }
        _ => Err(context_error(
            ResolutionContextErrorCode::ReservationMismatch,
            subject_id,
        )),
    }
}

fn command_targets(command: &AcceptedCombatCommand) -> Vec<String> {
    match &command.payload {
        CombatCommandPayload::UseAbility {
            target_id: Some(target_id),
            ..
        } => vec![target_id.clone()],
        _ => vec![],
    }
}

fn validate_roll(record: &ResolvedRollRecord) -> Result<(), ResolutionContextError> {
    validate_stable_id(&record.roll_id, &record.roll_id)?;
    if record.sides < 2
        || record.value == 0
        || record.value > record.sides
        || record.cursor_after == 0
        || record.cursor_after > MAX_SAFE_SEQUENCE
        || record.channel != RngChannel::Resolution
    {
        return Err(context_error(
            ResolutionContextErrorCode::InvalidRoll,
            &record.roll_id,
        ));
    }
    Ok(())
}

fn require_executing(context: &ResolutionContext) -> Result<(), ResolutionContextError> {
    if context.status == ResolutionContextStatus::ExecutingHooks {
        Ok(())
    } else {
        Err(context_error(
            ResolutionContextErrorCode::InvalidTransition,
            &context.context_id,
        ))
    }
}

const fn valid_hook_transition(current: HookPhase, next: HookPhase) -> bool {
    matches!(
        (current, next),
        (HookPhase::PreAction, HookPhase::BeforeRoll)
            | (HookPhase::BeforeRoll, HookPhase::AfterRoll)
            | (HookPhase::AfterRoll, HookPhase::Outcome)
            | (HookPhase::Outcome, HookPhase::PreEffect)
            | (HookPhase::PreEffect, HookPhase::PostEffect)
    )
}

fn validate_unique_ids(values: &[String], subject_id: &str) -> Result<(), ResolutionContextError> {
    for (index, value) in values.iter().enumerate() {
        validate_stable_id(value, subject_id)?;
        if values[..index].contains(value) {
            return Err(context_error(
                ResolutionContextErrorCode::InvalidContext,
                subject_id,
            ));
        }
    }
    Ok(())
}

fn has_duplicates<T: PartialEq>(values: &[T]) -> bool {
    values
        .iter()
        .enumerate()
        .any(|(index, value)| values[..index].contains(value))
}

fn next_sequence(index: usize, subject_id: &str) -> Result<u64, ResolutionContextError> {
    u64::try_from(index)
        .ok()
        .and_then(|value| value.checked_add(1))
        .filter(|value| *value <= MAX_SAFE_SEQUENCE)
        .ok_or_else(|| context_error(ResolutionContextErrorCode::SequenceExhausted, subject_id))
}

fn bump_revision(state: &mut CombatState, subject_id: &str) -> Result<(), ResolutionContextError> {
    state.revision = state
        .revision
        .checked_add(1)
        .ok_or_else(|| context_error(ResolutionContextErrorCode::SequenceExhausted, subject_id))?;
    Ok(())
}

fn validate_stable_id(value: &str, subject_id: &str) -> Result<(), ResolutionContextError> {
    if value.is_empty()
        || value.len() > 128
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b':' | b'-'))
    {
        Err(context_error(
            ResolutionContextErrorCode::InvalidStableId,
            subject_id,
        ))
    } else {
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ResolutionContextErrorCode {
    InvalidStableId,
    ContextMissing,
    ActiveContextConflict,
    InvalidContext,
    InvalidTransition,
    CommandMismatch,
    ReservationMismatch,
    TargetMismatch,
    HookMismatch,
    InvalidRoll,
    RollConflict,
    SuspensionMismatch,
    RngMismatch,
    SequenceExhausted,
    StateInvariantViolation,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolutionContextError {
    pub code: ResolutionContextErrorCode,
    pub subject_id: String,
}

impl fmt::Display for ResolutionContextError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("combat resolution context lifecycle failed")
    }
}

impl Error for ResolutionContextError {}

fn context_error(code: ResolutionContextErrorCode, subject_id: &str) -> ResolutionContextError {
    ResolutionContextError {
        code,
        subject_id: subject_id.to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        AbilityUsageState, AcceptedCommandSource, CURRENT_COMBAT_VERSIONS, CombatCostAsset,
        CombatCostRequestLine, CombatInventoryItemState, CombatPhase, CombatSide, CombatantRuntime,
        CombatantState, CostReservationModel, CostReservationRequest, ObjectiveRuntimeState,
        ProvisionalRuntimeDelta, ReinforcementRuntimeState, ResourceState, RoundRuntimeState,
    };

    const SEED: &str = "0123456789abcdef0123456789abcdef";

    #[test]
    fn creates_one_idempotent_context_bound_to_command_reservation_and_rng() {
        let (mut state, command) = prepared();
        let before_rng = state.rng.clone();
        let context = ResolutionContextLifecycle::create(
            &mut state,
            command.clone(),
            "chain-1".to_owned(),
            Some("command-1".to_owned()),
        )
        .unwrap();
        assert_eq!(context.context_id, "command-1");
        assert_eq!(context.accepted_sequence, 1);
        assert_eq!(context.original_target_ids, vec!["enemy-1"]);
        assert_eq!(context.effective_target_ids, vec!["enemy-1"]);
        assert_eq!(context.rng_checkpoint, before_rng);
        let revision = state.revision;
        assert_eq!(
            ResolutionContextLifecycle::create(
                &mut state,
                command,
                "chain-1".to_owned(),
                Some("command-1".to_owned()),
            )
            .unwrap(),
            context
        );
        assert_eq!(state.revision, revision);

        let mut other = accepted_command();
        other.command_id = "command-other".to_owned();
        assert_eq!(
            ResolutionContextLifecycle::create(&mut state, other, "chain-2".to_owned(), None,)
                .unwrap_err()
                .code,
            ResolutionContextErrorCode::ActiveContextConflict
        );
    }

    #[test]
    fn redirect_history_reconstructs_effective_target_and_survives_restore() {
        let (mut state, command) = prepared();
        ResolutionContextLifecycle::create(
            &mut state,
            command,
            "chain-1".to_owned(),
            Some("command-1".to_owned()),
        )
        .unwrap();
        let context = ResolutionContextLifecycle::redirect_target(
            &mut state,
            "enemy-1",
            "enemy-2",
            "rule-redirect",
        )
        .unwrap();
        assert_eq!(context.effective_target_ids, vec!["enemy-2"]);
        assert_eq!(context.target_redirects[0].sequence, 1);
        let restored = state.snapshot().unwrap().verify_and_restore().unwrap();
        assert_eq!(restored.resolution_context, Some(context));
    }

    #[test]
    fn records_an_already_consumed_resolution_roll_once_without_drawing_rng() {
        let (mut state, command) = prepared();
        ResolutionContextLifecycle::create(
            &mut state,
            command,
            "chain-1".to_owned(),
            Some("command-1".to_owned()),
        )
        .unwrap();
        let mut rng = CombatRng::restore(state.rng.clone()).unwrap();
        let value = rng.roll_die(RngChannel::Resolution, 20).unwrap();
        state.rng = rng.snapshot();
        let cursor = state.rng.streams[1].cursor;
        let roll = ResolvedRollRecord {
            roll_id: "roll-attack".to_owned(),
            channel: RngChannel::Resolution,
            sides: 20,
            value,
            cursor_after: cursor,
        };
        let context =
            ResolutionContextLifecycle::record_resolved_roll(&mut state, roll.clone()).unwrap();
        assert_eq!(context.resolved_rolls, vec![roll.clone()]);
        let revision = state.revision;
        let rng_after = state.rng.clone();
        ResolutionContextLifecycle::record_resolved_roll(&mut state, roll).unwrap();
        assert_eq!(state.revision, revision);
        assert_eq!(state.rng, rng_after);

        let mut conflict = state.resolution_context.as_ref().unwrap().resolved_rolls[0].clone();
        conflict.value = if conflict.value == 20 {
            19
        } else {
            conflict.value + 1
        };
        assert_eq!(
            ResolutionContextLifecycle::record_resolved_roll(&mut state, conflict)
                .unwrap_err()
                .code,
            ResolutionContextErrorCode::RollConflict
        );
    }

    #[test]
    fn ask_suspend_crash_restore_and_resume_continue_the_same_context() {
        let (mut state, command) = prepared();
        ResolutionContextLifecycle::create(
            &mut state,
            command,
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
        let before_suspend_rng = state.rng.clone();
        let suspended =
            ResolutionContextLifecycle::suspend_for_ask(&mut state, "reaction-window-1").unwrap();
        assert_eq!(
            suspended.status,
            ResolutionContextStatus::SuspendedForReaction
        );
        assert_eq!(suspended.current_hook_phase, HookPhase::BeforeRoll);
        assert_eq!(suspended.completed_hook_phases, vec![HookPhase::PreAction]);

        let mut restored = state.snapshot().unwrap().verify_and_restore().unwrap();
        let balances = (
            restored.combatants[0].action_points,
            restored.cost_reservations[0].status,
        );
        let resumed =
            ResolutionContextLifecycle::resume_from_ask(&mut restored, "reaction-window-1")
                .unwrap();
        assert_eq!(resumed.context_id, suspended.context_id);
        assert_eq!(resumed.status, ResolutionContextStatus::ExecutingHooks);
        assert!(resumed.suspensions[0].resumed);
        assert_eq!(restored.rng, before_suspend_rng);
        assert_eq!(
            (
                restored.combatants[0].action_points,
                restored.cost_reservations[0].status,
            ),
            balances
        );
    }

    #[test]
    fn hook_progress_is_monotonic_and_ready_state_rejects_more_hook_mutation() {
        let (mut state, command) = prepared();
        ResolutionContextLifecycle::create(
            &mut state,
            command,
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
        assert_eq!(
            ResolutionContextLifecycle::complete_hook(
                &mut state,
                HookPhase::PreAction,
                HookPhase::BeforeRoll,
            )
            .unwrap_err()
            .code,
            ResolutionContextErrorCode::HookMismatch
        );
        let ready = ResolutionContextLifecycle::mark_ready_for_revalidation(&mut state).unwrap();
        assert_eq!(
            ready.status,
            ResolutionContextStatus::ReadyForExecutionRevalidation
        );
        assert_eq!(
            ResolutionContextLifecycle::suspend_for_ask(&mut state, "late-window")
                .unwrap_err()
                .code,
            ResolutionContextErrorCode::InvalidTransition
        );
    }

    #[test]
    fn invalid_reservation_rng_and_tampered_context_fail_closed() {
        let (mut state, command) = prepared();
        assert_eq!(
            ResolutionContextLifecycle::create(
                &mut state,
                command.clone(),
                "chain-1".to_owned(),
                Some("missing-reservation".to_owned()),
            )
            .unwrap_err()
            .code,
            ResolutionContextErrorCode::ReservationMismatch
        );
        ResolutionContextLifecycle::create(
            &mut state,
            command,
            "chain-1".to_owned(),
            Some("command-1".to_owned()),
        )
        .unwrap();
        ResolutionContextLifecycle::suspend_for_ask(&mut state, "window-1").unwrap();
        let before = state.clone();
        state.rng.streams[1].cursor += 1;
        assert_eq!(
            ResolutionContextLifecycle::resume_from_ask(&mut state, "window-1")
                .unwrap_err()
                .code,
            ResolutionContextErrorCode::RngMismatch
        );
        state = before;
        state.resolution_context.as_mut().unwrap().suspensions[0].sequence = 2;
        assert!(matches!(
            state.snapshot().unwrap().verify_and_restore(),
            Err(crate::CombatStateRestoreError::Invariant(
                crate::CombatStateInvariantError {
                    code: crate::CombatStateInvariantCode::ResolutionContextInvalid,
                    ..
                }
            ))
        ));
    }

    fn prepared() -> (CombatState, AcceptedCombatCommand) {
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
                    consume_cost_on_interrupt: false,
                }],
            },
        )
        .unwrap();
        (state, accepted_command())
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
            combat_instance_id: "combat-context-fixture".to_owned(),
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
                "combat-context-fixture",
                CURRENT_COMBAT_VERSIONS.rng_contract_version,
            )
            .unwrap()
            .snapshot(),
        }
    }
}

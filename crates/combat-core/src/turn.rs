use std::{error::Error, fmt};

use crate::{
    CombatPhase, CombatState, CombatantState, ControlTurnCompletion, HardCcDrEngine,
    RoundRosterEntry, RoundRosterStatus, UsageCounterScope,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TurnStateErrorCode {
    InvalidPhase,
    InvalidRoundState,
    ActiveTurnConflict,
    ActiveTurnMissing,
    CombatantMissing,
    CombatantCannotTakeExtraTurn,
    RosterIncomplete,
    NumericOverflow,
    StateInvariantViolation,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TurnStateError {
    pub code: TurnStateErrorCode,
    pub subject_id: String,
}

impl fmt::Display for TurnStateError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "turn/round state transition failed for {}: {:?}",
            self.subject_id, self.code
        )
    }
}

impl Error for TurnStateError {}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NextTurnOutcome {
    NormalTurnStarted { combatant_id: String },
    RoundEndReached,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OwnerTurnStartOutcome {
    ActionEnabled { combatant_id: String },
    ActionSkipped { combatant_id: String },
}

pub struct TurnRoundStateMachine;

impl TurnRoundStateMachine {
    pub fn begin_round(state: &mut CombatState) -> Result<Vec<RoundRosterEntry>, TurnStateError> {
        Self::validate_state(state)?;
        match state.phase {
            CombatPhase::BattleStart
                if state.round.round_number == 0 && state.round.completed_round_count == 0 => {}
            CombatPhase::RoundEnd
                if state.round.completed_round_count == state.round.round_number => {}
            _ => return Err(turn_error(TurnStateErrorCode::InvalidPhase, "round-start")),
        }

        let mut working = state.clone();
        let next_round = working
            .round
            .round_number
            .checked_add(1)
            .ok_or_else(|| turn_error(TurnStateErrorCode::NumericOverflow, "round-number"))?;
        let roster = build_round_roster(&working)?;
        working.round.round_number = next_round;
        working.round.active_combatant_id = None;
        working.round.extra_turn_resume_phase = None;
        working.round.roster = roster.clone();
        for combatant in &mut working.combatants {
            combatant.reaction_charges = combatant.max_reaction_charges;
            for counter in &mut combatant.once_usage_counters {
                if counter.scope == UsageCounterScope::Round {
                    counter.uses = 0;
                }
            }
        }
        working.phase = CombatPhase::RoundStart;
        commit(state, working, "round-start")?;
        Ok(roster)
    }

    pub fn advance_to_next_normal_turn_or_round_end(
        state: &mut CombatState,
    ) -> Result<NextTurnOutcome, TurnStateError> {
        Self::validate_state(state)?;
        if !matches!(
            state.phase,
            CombatPhase::RoundStart | CombatPhase::OwnerTurnEnd
        ) {
            return Err(turn_error(TurnStateErrorCode::InvalidPhase, "next-turn"));
        }
        if state.round.active_combatant_id.is_some() {
            return Err(turn_error(
                TurnStateErrorCode::ActiveTurnConflict,
                "next-turn",
            ));
        }

        let mut working = state.clone();
        loop {
            let Some(index) = working
                .round
                .roster
                .iter()
                .position(|entry| entry.status == RoundRosterStatus::Pending)
            else {
                working.phase = CombatPhase::RoundEnd;
                bump_revision(&mut working, "round-end")?;
                commit(state, working, "round-end")?;
                return Ok(NextTurnOutcome::RoundEndReached);
            };
            let combatant_id = working.round.roster[index].combatant_id.clone();
            let combatant_state = working
                .combatants
                .iter()
                .find(|combatant| combatant.combatant_id == combatant_id)
                .map(|combatant| combatant.state)
                .ok_or_else(|| turn_error(TurnStateErrorCode::CombatantMissing, &combatant_id))?;
            match combatant_state {
                CombatantState::Active => {
                    let combatant = working
                        .combatants
                        .iter_mut()
                        .find(|combatant| combatant.combatant_id == combatant_id)
                        .ok_or_else(|| {
                            turn_error(TurnStateErrorCode::CombatantMissing, &combatant_id)
                        })?;
                    combatant.normal_owner_turn_index = combatant
                        .normal_owner_turn_index
                        .checked_add(1)
                        .ok_or_else(|| {
                            turn_error(TurnStateErrorCode::NumericOverflow, &combatant_id)
                        })?;
                    combatant.basic_attack_count_this_normal_owner_turn = 0;
                    for usage in &mut combatant.ability_usage {
                        usage.uses_this_normal_owner_turn = 0;
                        usage.cooldown_remaining = usage.cooldown_remaining.saturating_sub(1);
                    }
                    for counter in &mut combatant.once_usage_counters {
                        if counter.scope == UsageCounterScope::OwnerTurn {
                            counter.uses = 0;
                        }
                    }
                    working.round.active_combatant_id = Some(combatant_id.clone());
                    working.phase = CombatPhase::OwnerTurnStart;
                    bump_revision(&mut working, &combatant_id)?;
                    commit(state, working, &combatant_id)?;
                    return Ok(NextTurnOutcome::NormalTurnStarted { combatant_id });
                }
                CombatantState::Removed => {
                    working.round.roster[index].status = RoundRosterStatus::Removed;
                }
                CombatantState::Downed | CombatantState::Defeated => {
                    working.round.roster[index].status = RoundRosterStatus::Skipped;
                }
            }
        }
    }

    pub fn enter_action_or_owner_turn_end(
        state: &mut CombatState,
        action_allowed: bool,
    ) -> Result<OwnerTurnStartOutcome, TurnStateError> {
        Self::validate_state(state)?;
        if state.phase != CombatPhase::OwnerTurnStart {
            return Err(turn_error(
                TurnStateErrorCode::InvalidPhase,
                "owner-turn-start",
            ));
        }
        let combatant_id = state
            .round
            .active_combatant_id
            .clone()
            .ok_or_else(|| turn_error(TurnStateErrorCode::ActiveTurnMissing, "owner-turn"))?;
        let may_act = action_allowed
            && state
                .combatants
                .iter()
                .find(|combatant| combatant.combatant_id == combatant_id)
                .is_some_and(|combatant| combatant.state == CombatantState::Active);
        let mut working = state.clone();
        working.phase = if may_act {
            CombatPhase::Action
        } else {
            CombatPhase::OwnerTurnEnd
        };
        bump_revision(&mut working, &combatant_id)?;
        commit(state, working, &combatant_id)?;
        Ok(if may_act {
            OwnerTurnStartOutcome::ActionEnabled { combatant_id }
        } else {
            OwnerTurnStartOutcome::ActionSkipped { combatant_id }
        })
    }

    pub fn end_action(state: &mut CombatState) -> Result<(), TurnStateError> {
        Self::validate_state(state)?;
        if state.phase != CombatPhase::Action {
            return Err(turn_error(TurnStateErrorCode::InvalidPhase, "action"));
        }
        let mut working = state.clone();
        working.phase = CombatPhase::OwnerTurnEnd;
        bump_revision(&mut working, "owner-turn-end")?;
        commit(state, working, "owner-turn-end")
    }

    pub fn complete_owner_turn(state: &mut CombatState) -> Result<(), TurnStateError> {
        Self::validate_state(state)?;
        if state.phase != CombatPhase::OwnerTurnEnd {
            return Err(turn_error(
                TurnStateErrorCode::InvalidPhase,
                "owner-turn-end",
            ));
        }
        let combatant_id = state
            .round
            .active_combatant_id
            .clone()
            .ok_or_else(|| turn_error(TurnStateErrorCode::ActiveTurnMissing, "owner-turn"))?;
        let mut working = state.clone();
        let combatant = working
            .combatants
            .iter_mut()
            .find(|combatant| combatant.combatant_id == combatant_id)
            .ok_or_else(|| turn_error(TurnStateErrorCode::CombatantMissing, &combatant_id))?;
        combatant.hard_cc_dr = HardCcDrEngine::advance_quiet_turn(
            combatant.hard_cc_dr,
            ControlTurnCompletion::NormalOwnerTurnCompleted,
        )
        .map_err(|_| turn_error(TurnStateErrorCode::StateInvariantViolation, &combatant_id))?;
        let entry = working
            .round
            .roster
            .iter_mut()
            .find(|entry| {
                entry.combatant_id == combatant_id && entry.status == RoundRosterStatus::Pending
            })
            .ok_or_else(|| turn_error(TurnStateErrorCode::InvalidRoundState, &combatant_id))?;
        entry.status = RoundRosterStatus::Completed;
        working.round.active_combatant_id = None;
        bump_revision(&mut working, &combatant_id)?;
        commit(state, working, &combatant_id)
    }

    pub fn complete_round_end(state: &mut CombatState) -> Result<(), TurnStateError> {
        Self::validate_state(state)?;
        if state.phase != CombatPhase::RoundEnd {
            return Err(turn_error(TurnStateErrorCode::InvalidPhase, "round-end"));
        }
        if state
            .round
            .roster
            .iter()
            .any(|entry| entry.status == RoundRosterStatus::Pending)
        {
            return Err(turn_error(
                TurnStateErrorCode::RosterIncomplete,
                "round-end",
            ));
        }
        if state.round.completed_round_count == state.round.round_number {
            return Ok(());
        }
        if state.round.completed_round_count.checked_add(1) != Some(state.round.round_number) {
            return Err(turn_error(
                TurnStateErrorCode::InvalidRoundState,
                "completed-round-count",
            ));
        }
        let mut working = state.clone();
        working.round.completed_round_count = working.round.round_number;
        bump_revision(&mut working, "round-end")?;
        commit(state, working, "round-end")
    }

    pub fn reorder_pending_roster_from_timeline(
        state: &mut CombatState,
    ) -> Result<Vec<RoundRosterEntry>, TurnStateError> {
        Self::validate_state(state)?;
        if !matches!(
            state.phase,
            CombatPhase::RoundStart
                | CombatPhase::OwnerTurnStart
                | CombatPhase::Action
                | CombatPhase::OwnerTurnEnd
                | CombatPhase::ExtraTurn
        ) {
            return Err(turn_error(
                TurnStateErrorCode::InvalidPhase,
                "roster-reorder",
            ));
        }
        let active_normal = if state.phase == CombatPhase::ExtraTurn {
            None
        } else {
            state.round.active_combatant_id.as_deref()
        };
        let movable_positions: Vec<usize> = state
            .round
            .roster
            .iter()
            .enumerate()
            .filter(|(_, entry)| {
                entry.status == RoundRosterStatus::Pending
                    && Some(entry.combatant_id.as_str()) != active_normal
            })
            .map(|(index, _)| index)
            .collect();
        let mut ordered_ids: Vec<String> = movable_positions
            .iter()
            .map(|index| state.round.roster[*index].combatant_id.clone())
            .collect();
        ordered_ids.sort_by(|left, right| {
            timeline_rank(state, left)
                .cmp(&timeline_rank(state, right))
                .then_with(|| left.cmp(right))
        });

        let mut working = state.clone();
        for (position, combatant_id) in movable_positions.into_iter().zip(ordered_ids) {
            working.round.roster[position].combatant_id = combatant_id;
        }
        if working.round.roster == state.round.roster {
            return Ok(state.round.roster.clone());
        }
        bump_revision(&mut working, "roster-reorder")?;
        commit(state, working, "roster-reorder")?;
        Ok(state.round.roster.clone())
    }

    pub fn begin_extra_turn(
        state: &mut CombatState,
        combatant_id: &str,
    ) -> Result<(), TurnStateError> {
        Self::validate_state(state)?;
        if !matches!(
            state.phase,
            CombatPhase::RoundStart | CombatPhase::OwnerTurnEnd
        ) || state.round.active_combatant_id.is_some()
        {
            return Err(turn_error(
                TurnStateErrorCode::ActiveTurnConflict,
                combatant_id,
            ));
        }
        let active = state
            .combatants
            .iter()
            .find(|combatant| combatant.combatant_id == combatant_id)
            .ok_or_else(|| turn_error(TurnStateErrorCode::CombatantMissing, combatant_id))?
            .state
            == CombatantState::Active;
        if !active {
            return Err(turn_error(
                TurnStateErrorCode::CombatantCannotTakeExtraTurn,
                combatant_id,
            ));
        }
        let mut working = state.clone();
        working.round.extra_turn_resume_phase = Some(working.phase);
        working.round.active_combatant_id = Some(combatant_id.to_owned());
        working.phase = CombatPhase::ExtraTurn;
        bump_revision(&mut working, combatant_id)?;
        commit(state, working, combatant_id)
    }

    pub fn complete_extra_turn(state: &mut CombatState) -> Result<(), TurnStateError> {
        Self::validate_state(state)?;
        if state.phase != CombatPhase::ExtraTurn {
            return Err(turn_error(TurnStateErrorCode::InvalidPhase, "extra-turn"));
        }
        let mut working = state.clone();
        let resume_phase = working
            .round
            .extra_turn_resume_phase
            .take()
            .ok_or_else(|| turn_error(TurnStateErrorCode::InvalidRoundState, "extra-turn"))?;
        working.round.active_combatant_id = None;
        working.phase = resume_phase;
        bump_revision(&mut working, "extra-turn")?;
        commit(state, working, "extra-turn")
    }

    pub fn validate_state(state: &CombatState) -> Result<(), TurnStateError> {
        validate_roster(state)?;
        if state.round.completed_round_count > state.round.round_number {
            return Err(turn_error(
                TurnStateErrorCode::InvalidRoundState,
                "completed-round-count",
            ));
        }
        match state.phase {
            CombatPhase::BattleStart => {
                if state.round.round_number != 0
                    || state.round.completed_round_count != 0
                    || !state.round.roster.is_empty()
                    || state.round.active_combatant_id.is_some()
                    || state.round.extra_turn_resume_phase.is_some()
                {
                    return Err(turn_error(
                        TurnStateErrorCode::InvalidRoundState,
                        "battle-start",
                    ));
                }
            }
            CombatPhase::RoundStart => {
                require_active_round(state, "round-start")?;
                require_no_active_or_extra(state, "round-start")?;
            }
            CombatPhase::OwnerTurnStart | CombatPhase::Action => {
                require_active_round(state, "owner-turn")?;
                validate_active_normal_turn(state)?;
            }
            CombatPhase::OwnerTurnEnd => {
                require_active_round(state, "owner-turn-end")?;
                if state.round.extra_turn_resume_phase.is_some() {
                    return Err(turn_error(
                        TurnStateErrorCode::InvalidRoundState,
                        "owner-turn-end",
                    ));
                }
                if state.round.active_combatant_id.is_some() {
                    validate_active_normal_turn(state)?;
                }
            }
            CombatPhase::ExtraTurn => {
                require_active_round(state, "extra-turn")?;
                if state.round.active_combatant_id.is_none()
                    || !matches!(
                        state.round.extra_turn_resume_phase,
                        Some(CombatPhase::RoundStart | CombatPhase::OwnerTurnEnd)
                    )
                {
                    return Err(turn_error(
                        TurnStateErrorCode::InvalidRoundState,
                        "extra-turn",
                    ));
                }
            }
            CombatPhase::RoundEnd => {
                require_active_round_or_completed(state, "round-end")?;
                require_no_active_or_extra(state, "round-end")?;
                if state
                    .round
                    .roster
                    .iter()
                    .any(|entry| entry.status == RoundRosterStatus::Pending)
                {
                    return Err(turn_error(
                        TurnStateErrorCode::RosterIncomplete,
                        "round-end",
                    ));
                }
            }
            CombatPhase::Stable | CombatPhase::Terminal => {
                if state.round.extra_turn_resume_phase.is_some() {
                    return Err(turn_error(
                        TurnStateErrorCode::InvalidRoundState,
                        "stable-terminal",
                    ));
                }
            }
        }
        Ok(())
    }
}

fn build_round_roster(state: &CombatState) -> Result<Vec<RoundRosterEntry>, TurnStateError> {
    let mut roster = Vec::new();
    for timeline_entry in state.timeline.iter().filter(|entry| !entry.is_extra_turn) {
        let combatant = state
            .combatants
            .iter()
            .find(|combatant| combatant.combatant_id == timeline_entry.combatant_id)
            .ok_or_else(|| {
                turn_error(
                    TurnStateErrorCode::CombatantMissing,
                    &timeline_entry.combatant_id,
                )
            })?;
        if combatant.state != CombatantState::Active
            || roster
                .iter()
                .any(|entry: &RoundRosterEntry| entry.combatant_id == combatant.combatant_id)
        {
            continue;
        }
        let normal_turn_slot = u32::try_from(roster.len())
            .map_err(|_| turn_error(TurnStateErrorCode::NumericOverflow, "normal-turn-slot"))?;
        roster.push(RoundRosterEntry {
            combatant_id: combatant.combatant_id.clone(),
            normal_turn_slot,
            status: RoundRosterStatus::Pending,
        });
    }
    Ok(roster)
}

fn timeline_rank(state: &CombatState, combatant_id: &str) -> u64 {
    state
        .timeline
        .iter()
        .position(|entry| !entry.is_extra_turn && entry.combatant_id == combatant_id)
        .and_then(|index| u64::try_from(index).ok())
        .or_else(|| {
            state
                .combatants
                .iter()
                .find(|combatant| combatant.combatant_id == combatant_id)
                .and_then(|combatant| combatant.last_committed_timeline_order)
                .map(u64::from)
        })
        .unwrap_or(u64::MAX)
}

fn validate_roster(state: &CombatState) -> Result<(), TurnStateError> {
    for (index, entry) in state.round.roster.iter().enumerate() {
        if entry.normal_turn_slot != u32::try_from(index).unwrap_or(u32::MAX)
            || state.round.roster[..index]
                .iter()
                .any(|previous| previous.combatant_id == entry.combatant_id)
            || !state
                .combatants
                .iter()
                .any(|combatant| combatant.combatant_id == entry.combatant_id)
        {
            return Err(turn_error(
                TurnStateErrorCode::InvalidRoundState,
                &entry.combatant_id,
            ));
        }
    }
    Ok(())
}

fn validate_active_normal_turn(state: &CombatState) -> Result<(), TurnStateError> {
    if state.round.extra_turn_resume_phase.is_some() {
        return Err(turn_error(
            TurnStateErrorCode::InvalidRoundState,
            "normal-turn",
        ));
    }
    let actor_id = state
        .round
        .active_combatant_id
        .as_deref()
        .ok_or_else(|| turn_error(TurnStateErrorCode::ActiveTurnMissing, "normal-turn"))?;
    if !state
        .round
        .roster
        .iter()
        .any(|entry| entry.combatant_id == actor_id && entry.status == RoundRosterStatus::Pending)
    {
        return Err(turn_error(TurnStateErrorCode::InvalidRoundState, actor_id));
    }
    Ok(())
}

fn require_active_round(state: &CombatState, subject: &str) -> Result<(), TurnStateError> {
    if state.round.round_number == 0
        || state.round.completed_round_count.checked_add(1) != Some(state.round.round_number)
    {
        return Err(turn_error(TurnStateErrorCode::InvalidRoundState, subject));
    }
    Ok(())
}

fn require_active_round_or_completed(
    state: &CombatState,
    subject: &str,
) -> Result<(), TurnStateError> {
    if state.round.round_number == 0
        || !matches!(
            state.round.completed_round_count,
            value if value == state.round.round_number
                || value.checked_add(1) == Some(state.round.round_number)
        )
    {
        return Err(turn_error(TurnStateErrorCode::InvalidRoundState, subject));
    }
    Ok(())
}

fn require_no_active_or_extra(state: &CombatState, subject: &str) -> Result<(), TurnStateError> {
    if state.round.active_combatant_id.is_some() || state.round.extra_turn_resume_phase.is_some() {
        return Err(turn_error(TurnStateErrorCode::InvalidRoundState, subject));
    }
    Ok(())
}

fn commit(
    state: &mut CombatState,
    working: CombatState,
    subject: &str,
) -> Result<(), TurnStateError> {
    SelfValidation::validate(&working, subject)?;
    *state = working;
    Ok(())
}

struct SelfValidation;

impl SelfValidation {
    fn validate(state: &CombatState, subject: &str) -> Result<(), TurnStateError> {
        TurnRoundStateMachine::validate_state(state)?;
        state
            .validate_for_commit()
            .map_err(|_| turn_error(TurnStateErrorCode::StateInvariantViolation, subject))
    }
}

fn bump_revision(state: &mut CombatState, subject: &str) -> Result<(), TurnStateError> {
    state.revision = state
        .revision
        .checked_add(1)
        .ok_or_else(|| turn_error(TurnStateErrorCode::NumericOverflow, subject))?;
    Ok(())
}

fn turn_error(code: TurnStateErrorCode, subject_id: &str) -> TurnStateError {
    TurnStateError {
        code,
        subject_id: subject_id.to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        AbilityUsageState, CURRENT_COMBAT_VERSIONS, CombatRng, CombatSide, CombatantRuntime,
        HardCcDrRuntime, ObjectiveRuntimeState, ProvisionalRuntimeDelta, ReinforcementRuntimeState,
        RoundRuntimeState, TimelineEntry, UsageCounterScope, UsageCounterState,
    };

    const SEED: &str = "0123456789abcdef0123456789abcdef";

    #[test]
    fn battle_start_builds_round_roster_from_active_normal_timeline_only() {
        let mut state = battle_start_state();
        state.combatants[1].state = CombatantState::Downed;
        state.combatants[1].hit_points = 0;
        state.timeline.push(TimelineEntry {
            combatant_id: "actor-a".to_owned(),
            initiative_result: 99,
            initiative_base_stat: 2,
            is_extra_turn: true,
            source_sequence: 4,
        });
        let roster = TurnRoundStateMachine::begin_round(&mut state).unwrap();
        assert_eq!(state.phase, CombatPhase::RoundStart);
        assert_eq!(state.round.round_number, 1);
        assert_eq!(state.round.completed_round_count, 0);
        assert_eq!(
            roster
                .iter()
                .map(|entry| entry.combatant_id.as_str())
                .collect::<Vec<_>>(),
            vec!["actor-a", "actor-c"]
        );
        assert_eq!(roster[0].normal_turn_slot, 0);
        assert_eq!(roster[1].normal_turn_slot, 1);
    }

    #[test]
    fn normal_lifecycle_is_fixed_and_defeated_or_removed_slots_do_not_block_round_end() {
        let mut state = battle_start_state();
        TurnRoundStateMachine::begin_round(&mut state).unwrap();
        assert_eq!(start_next(&mut state), "actor-a");
        assert!(matches!(
            TurnRoundStateMachine::enter_action_or_owner_turn_end(&mut state, true).unwrap(),
            OwnerTurnStartOutcome::ActionEnabled { .. }
        ));
        assert_eq!(state.phase, CombatPhase::Action);
        TurnRoundStateMachine::end_action(&mut state).unwrap();
        TurnRoundStateMachine::complete_owner_turn(&mut state).unwrap();

        state.timeline.swap(1, 2);
        let reordered =
            TurnRoundStateMachine::reorder_pending_roster_from_timeline(&mut state).unwrap();
        assert_eq!(
            reordered
                .iter()
                .map(|entry| entry.combatant_id.as_str())
                .collect::<Vec<_>>(),
            vec!["actor-a", "actor-c", "actor-b"]
        );

        state.combatants[1].state = CombatantState::Defeated;
        state.combatants[1].hit_points = 0;
        state.combatants[2].state = CombatantState::Removed;
        assert_eq!(
            TurnRoundStateMachine::advance_to_next_normal_turn_or_round_end(&mut state).unwrap(),
            NextTurnOutcome::RoundEndReached
        );
        assert_eq!(state.phase, CombatPhase::RoundEnd);
        assert_eq!(
            state
                .round
                .roster
                .iter()
                .map(|entry| entry.status)
                .collect::<Vec<_>>(),
            vec![
                RoundRosterStatus::Completed,
                RoundRosterStatus::Removed,
                RoundRosterStatus::Skipped,
            ]
        );
        TurnRoundStateMachine::complete_round_end(&mut state).unwrap();
        assert_eq!(state.round.completed_round_count, 1);
        let after_first = state.clone();
        TurnRoundStateMachine::complete_round_end(&mut state).unwrap();
        assert_eq!(state, after_first);
    }

    #[test]
    fn active_controlled_actor_keeps_full_lifecycle_but_downed_during_start_skips_action() {
        let mut controlled = battle_start_state();
        controlled.combatants[0]
            .statuses
            .push(crate::StatusRuntime {
                status_schema_version: 1,
                status_instance_id: "status-stun".to_owned(),
                status_definition_id: "stun".to_owned(),
                source_combatant_id: Some("actor-b".to_owned()),
                stack_group_id: "stun".to_owned(),
                stack_count: 1,
                remaining_duration: Some(1),
                duration_clock: crate::DurationClock::OwnerTurn,
                application_sequence: 1,
                activation_clock_index: 1,
                applied_round_index: 1,
                applied_owner_turn_index: Some(0),
                tick_eligible_clock_index: 1,
                last_duration_advanced_clock_index: None,
                strength_rank: None,
            });
        TurnRoundStateMachine::begin_round(&mut controlled).unwrap();
        start_next(&mut controlled);
        assert!(matches!(
            TurnRoundStateMachine::enter_action_or_owner_turn_end(&mut controlled, false).unwrap(),
            OwnerTurnStartOutcome::ActionSkipped { .. }
        ));
        assert_eq!(controlled.phase, CombatPhase::OwnerTurnEnd);

        let mut downed = battle_start_state();
        TurnRoundStateMachine::begin_round(&mut downed).unwrap();
        start_next(&mut downed);
        downed.combatants[0].state = CombatantState::Downed;
        downed.combatants[0].hit_points = 0;
        assert!(matches!(
            TurnRoundStateMachine::enter_action_or_owner_turn_end(&mut downed, true).unwrap(),
            OwnerTurnStartOutcome::ActionSkipped { .. }
        ));
        assert_eq!(downed.phase, CombatPhase::OwnerTurnEnd);
        TurnRoundStateMachine::complete_owner_turn(&mut downed).unwrap();
        assert_eq!(downed.round.roster[0].status, RoundRosterStatus::Completed);
    }

    #[test]
    fn hard_cc_quiet_reset_counts_controlled_full_turn_but_not_extra_or_skipped_slot() {
        let prior = HardCcDrRuntime {
            level: 2,
            quiet_owner_turns: 1,
            applied_since_owner_turn_end: false,
        };
        let mut controlled = battle_start_state();
        controlled.combatants[0].hard_cc_dr = prior;
        TurnRoundStateMachine::begin_round(&mut controlled).unwrap();
        start_next(&mut controlled);
        TurnRoundStateMachine::enter_action_or_owner_turn_end(&mut controlled, false).unwrap();
        TurnRoundStateMachine::complete_owner_turn(&mut controlled).unwrap();
        assert_eq!(
            controlled.combatants[0].hard_cc_dr,
            HardCcDrRuntime::default()
        );

        let mut extra = battle_start_state();
        extra.combatants[0].hard_cc_dr = prior;
        TurnRoundStateMachine::begin_round(&mut extra).unwrap();
        TurnRoundStateMachine::begin_extra_turn(&mut extra, "actor-a").unwrap();
        TurnRoundStateMachine::complete_extra_turn(&mut extra).unwrap();
        assert_eq!(extra.combatants[0].hard_cc_dr, prior);

        let mut skipped = battle_start_state();
        skipped.combatants[0].hard_cc_dr = prior;
        TurnRoundStateMachine::begin_round(&mut skipped).unwrap();
        skipped.combatants[0].state = CombatantState::Downed;
        skipped.combatants[0].hit_points = 0;
        assert_eq!(start_next(&mut skipped), "actor-b");
        assert_eq!(skipped.round.roster[0].status, RoundRosterStatus::Skipped);
        assert_eq!(skipped.combatants[0].hard_cc_dr, prior);
    }

    #[test]
    fn combatant_joining_mid_round_enters_only_the_next_round_roster() {
        let mut state = battle_start_state();
        state.combatants.truncate(1);
        state.timeline.truncate(1);
        TurnRoundStateMachine::begin_round(&mut state).unwrap();
        let newcomer = combatant("actor-new");
        state.combatants.push(newcomer);
        state.timeline.push(TimelineEntry {
            combatant_id: "actor-new".to_owned(),
            initiative_result: 8,
            initiative_base_stat: 1,
            is_extra_turn: false,
            source_sequence: 4,
        });
        assert_eq!(state.round.roster.len(), 1);
        finish_one_normal_turn(&mut state);
        assert_eq!(
            TurnRoundStateMachine::advance_to_next_normal_turn_or_round_end(&mut state).unwrap(),
            NextTurnOutcome::RoundEndReached
        );
        TurnRoundStateMachine::complete_round_end(&mut state).unwrap();
        let next = TurnRoundStateMachine::begin_round(&mut state).unwrap();
        assert_eq!(
            next.iter()
                .map(|entry| entry.combatant_id.as_str())
                .collect::<Vec<_>>(),
            vec!["actor-a", "actor-new"]
        );
    }

    #[test]
    fn extra_turn_preserves_round_roster_cooldown_and_all_normal_turn_counters() {
        let mut state = battle_start_state();
        TurnRoundStateMachine::begin_round(&mut state).unwrap();
        let roster_before = state.round.roster.clone();
        let usage_before = state.combatants[0].ability_usage.clone();
        let basic_before = state.combatants[0].basic_attack_count_this_normal_owner_turn;
        let once_before = state.combatants[0].once_usage_counters.clone();
        let reaction_before = state.combatants[0].reaction_charges;
        let round_before = state.round.round_number;

        TurnRoundStateMachine::begin_extra_turn(&mut state, "actor-a").unwrap();
        assert_eq!(state.phase, CombatPhase::ExtraTurn);
        assert_eq!(
            state.round.extra_turn_resume_phase,
            Some(CombatPhase::RoundStart)
        );
        TurnRoundStateMachine::complete_extra_turn(&mut state).unwrap();
        assert_eq!(state.phase, CombatPhase::RoundStart);
        assert_eq!(state.round.roster, roster_before);
        assert_eq!(state.combatants[0].ability_usage, usage_before);
        assert_eq!(
            state.combatants[0].basic_attack_count_this_normal_owner_turn,
            basic_before
        );
        assert_eq!(state.combatants[0].once_usage_counters, once_before);
        assert_eq!(state.combatants[0].reaction_charges, reaction_before);
        assert_eq!(state.round.round_number, round_before);
    }

    #[test]
    fn round_and_normal_owner_turn_start_advance_only_their_owned_clocks() {
        let mut state = battle_start_state();
        state.combatants[0].reaction_charges = 0;
        state.combatants[0].once_usage_counters.extend([
            UsageCounterState {
                counter_id: "once-round".to_owned(),
                scope: UsageCounterScope::Round,
                uses: 1,
            },
            UsageCounterState {
                counter_id: "once-battle".to_owned(),
                scope: UsageCounterScope::Battle,
                uses: 1,
            },
        ]);
        state.combatants[0]
            .once_usage_counters
            .sort_by(|left, right| left.counter_id.cmp(&right.counter_id));

        TurnRoundStateMachine::begin_round(&mut state).unwrap();
        let actor = &state.combatants[0];
        assert_eq!(actor.reaction_charges, actor.max_reaction_charges);
        assert_eq!(counter(actor, "once-round"), 0);
        assert_eq!(counter(actor, "once-owner"), 1);
        assert_eq!(counter(actor, "once-battle"), 1);
        assert_eq!(actor.normal_owner_turn_index, 0);
        assert_eq!(actor.ability_usage[0].cooldown_remaining, 2);

        assert_eq!(start_next(&mut state), "actor-a");
        let actor = &state.combatants[0];
        assert_eq!(actor.normal_owner_turn_index, 1);
        assert_eq!(actor.ability_usage[0].cooldown_remaining, 1);
        assert_eq!(actor.ability_usage[0].uses_this_normal_owner_turn, 0);
        assert_eq!(actor.basic_attack_count_this_normal_owner_turn, 0);
        assert_eq!(counter(actor, "once-owner"), 0);
        assert_eq!(counter(actor, "once-round"), 0);
        assert_eq!(counter(actor, "once-battle"), 1);
    }

    #[test]
    fn cooldown_three_used_on_t1_becomes_usable_at_t4_normal_owner_turn_start() {
        let mut state = battle_start_state();
        state.combatants.truncate(1);
        state.timeline.truncate(1);

        TurnRoundStateMachine::begin_round(&mut state).unwrap();
        start_next(&mut state);
        state.combatants[0].ability_usage[0].cooldown_remaining = 3;
        TurnRoundStateMachine::enter_action_or_owner_turn_end(&mut state, true).unwrap();
        TurnRoundStateMachine::end_action(&mut state).unwrap();
        TurnRoundStateMachine::complete_owner_turn(&mut state).unwrap();
        finish_round(&mut state);

        for expected in [2, 1, 0] {
            TurnRoundStateMachine::begin_round(&mut state).unwrap();
            start_next(&mut state);
            assert_eq!(
                state.combatants[0].ability_usage[0].cooldown_remaining,
                expected
            );
            TurnRoundStateMachine::enter_action_or_owner_turn_end(&mut state, true).unwrap();
            TurnRoundStateMachine::end_action(&mut state).unwrap();
            TurnRoundStateMachine::complete_owner_turn(&mut state).unwrap();
            finish_round(&mut state);
        }
        assert_eq!(state.combatants[0].normal_owner_turn_index, 4);
    }

    #[test]
    fn illegal_transitions_and_hash_valid_roster_tampering_fail_closed() {
        let mut state = battle_start_state();
        let before = state.clone();
        assert_eq!(
            TurnRoundStateMachine::end_action(&mut state)
                .unwrap_err()
                .code,
            TurnStateErrorCode::InvalidPhase
        );
        assert_eq!(state, before);

        TurnRoundStateMachine::begin_round(&mut state).unwrap();
        state.round.roster[1].normal_turn_slot = 0;
        assert!(matches!(
            state.snapshot().unwrap().verify_and_restore(),
            Err(crate::CombatStateRestoreError::Invariant(
                crate::CombatStateInvariantError {
                    code: crate::CombatStateInvariantCode::TurnRoundStateInvalid,
                    ..
                }
            ))
        ));
    }

    fn start_next(state: &mut CombatState) -> String {
        let NextTurnOutcome::NormalTurnStarted { combatant_id } =
            TurnRoundStateMachine::advance_to_next_normal_turn_or_round_end(state).unwrap()
        else {
            panic!("expected normal turn")
        };
        combatant_id
    }

    fn counter(combatant: &CombatantRuntime, id: &str) -> i64 {
        combatant
            .once_usage_counters
            .iter()
            .find(|counter| counter.counter_id == id)
            .unwrap()
            .uses
    }

    fn finish_one_normal_turn(state: &mut CombatState) {
        start_next(state);
        TurnRoundStateMachine::enter_action_or_owner_turn_end(state, true).unwrap();
        TurnRoundStateMachine::end_action(state).unwrap();
        TurnRoundStateMachine::complete_owner_turn(state).unwrap();
    }

    fn finish_round(state: &mut CombatState) {
        assert_eq!(
            TurnRoundStateMachine::advance_to_next_normal_turn_or_round_end(state).unwrap(),
            NextTurnOutcome::RoundEndReached
        );
        TurnRoundStateMachine::complete_round_end(state).unwrap();
    }

    fn battle_start_state() -> CombatState {
        let combatants = vec![
            combatant("actor-a"),
            combatant("actor-b"),
            combatant("actor-c"),
        ];
        CombatState {
            combat_instance_id: "combat-turn-fixture".to_owned(),
            versions: CURRENT_COMBAT_VERSIONS,
            random_seed: SEED.to_owned(),
            revision: 1,
            last_committed_sequence: 0,
            phase: CombatPhase::BattleStart,
            timeline: combatants
                .iter()
                .enumerate()
                .map(|(index, combatant)| TimelineEntry {
                    combatant_id: combatant.combatant_id.clone(),
                    initiative_result: 10 - i64::try_from(index).unwrap(),
                    initiative_base_stat: 2,
                    is_extra_turn: false,
                    source_sequence: u64::try_from(index + 1).unwrap(),
                })
                .collect(),
            combatants,
            formal_party_member_ids: vec![],
            combat_inventory: vec![],
            cost_reservations: vec![],
            resolution_context: None,
            round: RoundRuntimeState {
                round_number: 0,
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
            result_candidates: vec![],
            terminal_priority_policy: crate::TerminalPriorityPolicy::default(),
            confirmed_result_candidate_id: None,
            confirmed_result: None,
            rng: CombatRng::new(
                SEED,
                "combat-turn-fixture",
                CURRENT_COMBAT_VERSIONS.rng_contract_version,
            )
            .unwrap()
            .snapshot(),
        }
    }

    fn combatant(id: &str) -> CombatantRuntime {
        CombatantRuntime {
            combatant_id: id.to_owned(),
            definition_id: format!("definition-{id}"),
            side: CombatSide::Player,
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
                ability_id: "ability-a".to_owned(),
                cooldown_remaining: 2,
                uses_this_normal_owner_turn: 1,
                uses_this_battle: 1,
            }],
            basic_attack_count_this_normal_owner_turn: 1,
            once_usage_counters: vec![UsageCounterState {
                counter_id: "once-owner".to_owned(),
                scope: UsageCounterScope::OwnerTurn,
                uses: 1,
            }],
            normal_owner_turn_index: 0,
            hard_cc_dr: crate::HardCcDrRuntime::default(),
            shield_recharge: crate::ShieldRechargeRuntime::default(),
            initiative_result: 10,
            initiative_base_stat: 2,
            last_committed_timeline_order: None,
            solo_recovery_available: false,
        }
    }
}

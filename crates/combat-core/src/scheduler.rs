use std::{cmp::Ordering, error::Error, fmt};

use serde::{Deserialize, Serialize};

use crate::{
    CombatResultType, CombatState, EventSchedulerCheckpoint, EventSchedulerStatus,
    LoopGuardEngineFailure, LoopGuardFailureReason, LoopGuardRollbackPolicy, SchedulerItem,
    SchedulerItemKind,
};

pub const NON_COMBATANT_INITIATIVE_ORDER: u32 = 2_147_483_647;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SchedulerCandidate {
    pub kind: SchedulerItemKind,
    pub phase_priority: i32,
    pub explicit_priority: i32,
    pub source_stable_id: String,
    pub effect_stable_id: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EventSchedulerErrorCode {
    SchedulerAlreadyActive,
    SchedulerMissing,
    CurrentItemActive,
    CurrentItemMissing,
    CurrentItemNotExecuting,
    CurrentItemAlreadyExecuting,
    InvalidStableId,
    InvalidCheckpoint,
    SequenceExhausted,
    DepthExhausted,
    StateInvariantViolation,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SchedulerExecutionGateOutcome {
    Skipped { item: SchedulerItem },
    ReadyToExecute { item: SchedulerItem, resumed: bool },
    EngineFailure { failure: LoopGuardEngineFailure },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EventSchedulerError {
    pub code: EventSchedulerErrorCode,
    pub subject_id: String,
}

impl fmt::Display for EventSchedulerError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "event scheduler failed for {}: {:?}",
            self.subject_id, self.code
        )
    }
}

impl Error for EventSchedulerError {}

pub struct CanonicalEventChainScheduler;

impl CanonicalEventChainScheduler {
    pub fn begin(
        state: &mut CombatState,
        event_chain_id: String,
        max_trigger_depth: u32,
        max_event_count: u64,
    ) -> Result<EventSchedulerCheckpoint, EventSchedulerError> {
        validate_stable_id(&event_chain_id)?;
        if state.scheduler.is_some() {
            return Err(scheduler_error(
                EventSchedulerErrorCode::SchedulerAlreadyActive,
                &event_chain_id,
            ));
        }
        let mut working = state.clone();
        working.scheduler = Some(EventSchedulerCheckpoint {
            event_chain_id: event_chain_id.clone(),
            status: EventSchedulerStatus::Active,
            engine_failure: None,
            executed_event_count: 0,
            queue: Vec::new(),
            current_item: None,
            next_sequence: 1,
            max_trigger_depth,
            max_event_count,
        });
        bump_revision(&mut working, &event_chain_id)?;
        commit_working_state(state, working)?;
        Ok(state.scheduler.clone().expect("scheduler was committed"))
    }

    pub fn enqueue_roots(
        state: &mut CombatState,
        candidates: Vec<SchedulerCandidate>,
    ) -> Result<Vec<SchedulerItem>, EventSchedulerError> {
        let mut working = state.clone();
        let chain_id = active_chain_id(&working)?;
        if working
            .scheduler
            .as_ref()
            .is_some_and(|scheduler| scheduler.current_item.is_some())
        {
            return Err(scheduler_error(
                EventSchedulerErrorCode::CurrentItemActive,
                &chain_id,
            ));
        }
        let items = build_items(&mut working, candidates, 1)?;
        insert_items(&mut working, &items)?;
        bump_revision(&mut working, &chain_id)?;
        commit_working_state(state, working)?;
        Ok(items)
    }

    pub fn dequeue_next(
        state: &mut CombatState,
    ) -> Result<Option<SchedulerItem>, EventSchedulerError> {
        let mut working = state.clone();
        let chain_id = active_chain_id(&working)?;
        let scheduler = working
            .scheduler
            .as_mut()
            .ok_or_else(|| scheduler_error(EventSchedulerErrorCode::SchedulerMissing, &chain_id))?;
        if scheduler.current_item.is_some() {
            return Err(scheduler_error(
                EventSchedulerErrorCode::CurrentItemActive,
                &chain_id,
            ));
        }
        if scheduler.queue.is_empty() {
            return Ok(None);
        }
        let item = scheduler.queue.remove(0);
        scheduler.current_item = Some(item.clone());
        bump_revision(&mut working, &chain_id)?;
        commit_working_state(state, working)?;
        Ok(Some(item))
    }

    pub fn gate_current_for_execution(
        state: &mut CombatState,
        eligible: bool,
    ) -> Result<SchedulerExecutionGateOutcome, EventSchedulerError> {
        Self::validate_state(state)?;
        let mut working = state.clone();
        let chain_id = active_chain_id(&working)?;
        let current = working
            .scheduler
            .as_ref()
            .and_then(|scheduler| scheduler.current_item.clone())
            .ok_or_else(|| {
                scheduler_error(EventSchedulerErrorCode::CurrentItemMissing, &chain_id)
            })?;

        if !eligible {
            if current.execution_counted {
                return Err(scheduler_error(
                    EventSchedulerErrorCode::CurrentItemAlreadyExecuting,
                    &chain_id,
                ));
            }
            working
                .scheduler
                .as_mut()
                .expect("active scheduler was checked")
                .current_item = None;
            bump_revision(&mut working, &chain_id)?;
            commit_working_state(state, working)?;
            return Ok(SchedulerExecutionGateOutcome::Skipped { item: current });
        }

        if current.execution_counted {
            return Ok(SchedulerExecutionGateOutcome::ReadyToExecute {
                item: current,
                resumed: true,
            });
        }

        let scheduler = working
            .scheduler
            .as_ref()
            .expect("active scheduler was checked");
        let failure_reason = if current.depth > scheduler.max_trigger_depth {
            Some(LoopGuardFailureReason::MaxTriggerDepth)
        } else if scheduler.executed_event_count >= scheduler.max_event_count {
            Some(LoopGuardFailureReason::MaxEventCount)
        } else {
            None
        };
        if let Some(reason) = failure_reason {
            let failure = LoopGuardEngineFailure {
                reason,
                overflow_item: current,
                result: CombatResultType::Aborted,
                rollback_policy: LoopGuardRollbackPolicy::RestorePrecombatSnapshot,
            };
            let scheduler = working
                .scheduler
                .as_mut()
                .expect("active scheduler was checked");
            scheduler.status = EventSchedulerStatus::EngineFailure;
            scheduler.current_item = None;
            scheduler.engine_failure = Some(failure.clone());
            working.confirmed_result = Some(CombatResultType::Aborted);
            bump_revision(&mut working, &chain_id)?;
            commit_working_state(state, working)?;
            return Ok(SchedulerExecutionGateOutcome::EngineFailure { failure });
        }

        let scheduler = working
            .scheduler
            .as_mut()
            .expect("active scheduler was checked");
        scheduler.executed_event_count =
            scheduler
                .executed_event_count
                .checked_add(1)
                .ok_or_else(|| {
                    scheduler_error(EventSchedulerErrorCode::SequenceExhausted, &chain_id)
                })?;
        let current = scheduler
            .current_item
            .as_mut()
            .expect("current item was checked");
        current.execution_counted = true;
        let ready = current.clone();
        bump_revision(&mut working, &chain_id)?;
        commit_working_state(state, working)?;
        Ok(SchedulerExecutionGateOutcome::ReadyToExecute {
            item: ready,
            resumed: false,
        })
    }

    pub fn complete_current_with_children(
        state: &mut CombatState,
        child_candidates: Vec<SchedulerCandidate>,
    ) -> Result<Vec<SchedulerItem>, EventSchedulerError> {
        let mut working = state.clone();
        let chain_id = active_chain_id(&working)?;
        let parent = working
            .scheduler
            .as_ref()
            .and_then(|scheduler| scheduler.current_item.clone())
            .ok_or_else(|| {
                scheduler_error(EventSchedulerErrorCode::CurrentItemMissing, &chain_id)
            })?;
        if !parent.execution_counted {
            return Err(scheduler_error(
                EventSchedulerErrorCode::CurrentItemNotExecuting,
                &chain_id,
            ));
        }
        let child_depth = parent
            .depth
            .checked_add(1)
            .ok_or_else(|| scheduler_error(EventSchedulerErrorCode::DepthExhausted, &chain_id))?;
        let children = build_items(&mut working, child_candidates, child_depth)?;
        working
            .scheduler
            .as_mut()
            .expect("active scheduler was checked")
            .current_item = None;
        insert_items(&mut working, &children)?;
        bump_revision(&mut working, &chain_id)?;
        commit_working_state(state, working)?;
        Ok(children)
    }

    pub fn complete_current(state: &mut CombatState) -> Result<(), EventSchedulerError> {
        Self::complete_current_with_children(state, Vec::new()).map(|_| ())
    }

    #[must_use]
    pub fn is_quiescent(state: &CombatState) -> bool {
        state.scheduler.as_ref().is_some_and(|scheduler| {
            scheduler.status == EventSchedulerStatus::Active
                && scheduler.queue.is_empty()
                && scheduler.current_item.is_none()
        })
    }

    pub fn validate_state(state: &CombatState) -> Result<(), EventSchedulerError> {
        let Some(scheduler) = &state.scheduler else {
            return Ok(());
        };
        validate_stable_id(&scheduler.event_chain_id)?;
        if scheduler.next_sequence == 0 {
            return Err(invalid_checkpoint(&scheduler.event_chain_id));
        }
        match (&scheduler.status, &scheduler.engine_failure) {
            (EventSchedulerStatus::Active, None) => {}
            (EventSchedulerStatus::EngineFailure, Some(failure)) => {
                validate_engine_failure(state, scheduler, failure)?;
            }
            _ => return Err(invalid_checkpoint(&scheduler.event_chain_id)),
        }
        if scheduler.executed_event_count > scheduler.max_event_count {
            return Err(invalid_checkpoint(&scheduler.event_chain_id));
        }
        if scheduler
            .current_item
            .as_ref()
            .is_some_and(|item| item.execution_counted)
            && scheduler.executed_event_count == 0
        {
            return Err(invalid_checkpoint(&scheduler.event_chain_id));
        }

        let mut prior: Option<&SchedulerItem> = None;
        let mut sequences = Vec::with_capacity(
            scheduler.queue.len()
                + usize::from(scheduler.current_item.is_some())
                + usize::from(scheduler.engine_failure.is_some()),
        );
        for item in &scheduler.queue {
            validate_item(item, &scheduler.event_chain_id)?;
            if item.execution_counted
                || prior.is_some_and(|previous| canonical_cmp(previous, item).is_gt())
            {
                return Err(invalid_checkpoint(&scheduler.event_chain_id));
            }
            sequences.push(item.sequence);
            prior = Some(item);
        }
        if let Some(item) = &scheduler.current_item {
            validate_item(item, &scheduler.event_chain_id)?;
            sequences.push(item.sequence);
        }
        if let Some(failure) = &scheduler.engine_failure {
            sequences.push(failure.overflow_item.sequence);
        }
        for (index, sequence) in sequences.iter().enumerate() {
            if *sequence == 0
                || *sequence >= scheduler.next_sequence
                || sequences[..index].contains(sequence)
            {
                return Err(invalid_checkpoint(&scheduler.event_chain_id));
            }
        }
        Ok(())
    }
}

fn build_items(
    state: &mut CombatState,
    mut candidates: Vec<SchedulerCandidate>,
    depth: u32,
) -> Result<Vec<SchedulerItem>, EventSchedulerError> {
    let chain_id = active_chain_id(state)?;
    if depth == 0 {
        return Err(invalid_checkpoint(&chain_id));
    }
    for candidate in &candidates {
        validate_candidate(candidate)?;
    }
    candidates.sort_by(candidate_identity_cmp);

    let mut items = Vec::with_capacity(candidates.len());
    for candidate in candidates {
        let sequence = state
            .scheduler
            .as_ref()
            .expect("active scheduler was checked")
            .next_sequence;
        let next_sequence = sequence.checked_add(1).ok_or_else(|| {
            scheduler_error(EventSchedulerErrorCode::SequenceExhausted, &chain_id)
        })?;
        let source_initiative_order =
            freeze_source_initiative_order(state, &candidate.source_stable_id)?;
        state
            .scheduler
            .as_mut()
            .expect("active scheduler was checked")
            .next_sequence = next_sequence;
        items.push(SchedulerItem {
            kind: candidate.kind,
            event_chain_id: chain_id.clone(),
            depth,
            phase_priority: candidate.phase_priority,
            explicit_priority: candidate.explicit_priority,
            source_initiative_order,
            source_stable_id: candidate.source_stable_id,
            effect_stable_id: candidate.effect_stable_id,
            sequence,
            execution_counted: false,
        });
    }
    Ok(items)
}

fn insert_items(
    state: &mut CombatState,
    items: &[SchedulerItem],
) -> Result<(), EventSchedulerError> {
    let chain_id = active_chain_id(state)?;
    let scheduler = state
        .scheduler
        .as_mut()
        .ok_or_else(|| scheduler_error(EventSchedulerErrorCode::SchedulerMissing, &chain_id))?;
    scheduler.queue.extend(items.iter().cloned());
    scheduler.queue.sort_by(canonical_cmp);
    Ok(())
}

fn freeze_source_initiative_order(
    state: &CombatState,
    source_stable_id: &str,
) -> Result<u32, EventSchedulerError> {
    if let Some(index) = state
        .timeline
        .iter()
        .position(|entry| entry.combatant_id == source_stable_id)
    {
        return u32::try_from(index).map_err(|_| {
            scheduler_error(EventSchedulerErrorCode::InvalidCheckpoint, source_stable_id)
        });
    }
    Ok(state
        .combatants
        .iter()
        .find(|combatant| combatant.combatant_id == source_stable_id)
        .and_then(|combatant| combatant.last_committed_timeline_order)
        .unwrap_or(NON_COMBATANT_INITIATIVE_ORDER))
}

fn canonical_cmp(left: &SchedulerItem, right: &SchedulerItem) -> Ordering {
    left.phase_priority
        .cmp(&right.phase_priority)
        .then_with(|| right.explicit_priority.cmp(&left.explicit_priority))
        .then_with(|| {
            left.source_initiative_order
                .cmp(&right.source_initiative_order)
        })
        .then_with(|| left.source_stable_id.cmp(&right.source_stable_id))
        .then_with(|| left.effect_stable_id.cmp(&right.effect_stable_id))
        .then_with(|| left.sequence.cmp(&right.sequence))
}

fn candidate_identity_cmp(left: &SchedulerCandidate, right: &SchedulerCandidate) -> Ordering {
    left.source_stable_id
        .cmp(&right.source_stable_id)
        .then_with(|| left.effect_stable_id.cmp(&right.effect_stable_id))
        .then_with(|| left.phase_priority.cmp(&right.phase_priority))
        .then_with(|| right.explicit_priority.cmp(&left.explicit_priority))
        .then_with(|| kind_rank(left.kind).cmp(&kind_rank(right.kind)))
}

const fn kind_rank(kind: SchedulerItemKind) -> u8 {
    match kind {
        SchedulerItemKind::Trigger => 0,
        SchedulerItemKind::Reaction => 1,
        SchedulerItemKind::EncounterRule => 2,
        SchedulerItemKind::System => 3,
    }
}

fn validate_candidate(candidate: &SchedulerCandidate) -> Result<(), EventSchedulerError> {
    validate_stable_id(&candidate.source_stable_id)?;
    validate_stable_id(&candidate.effect_stable_id)
}

fn validate_item(item: &SchedulerItem, event_chain_id: &str) -> Result<(), EventSchedulerError> {
    if item.event_chain_id != event_chain_id
        || item.depth == 0
        || item.source_initiative_order > NON_COMBATANT_INITIATIVE_ORDER
    {
        return Err(invalid_checkpoint(event_chain_id));
    }
    validate_stable_id(&item.source_stable_id)?;
    validate_stable_id(&item.effect_stable_id)
}

fn validate_stable_id(value: &str) -> Result<(), EventSchedulerError> {
    if value.is_empty()
        || value.len() > 128
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b':' | b'-'))
    {
        Err(scheduler_error(
            EventSchedulerErrorCode::InvalidStableId,
            value,
        ))
    } else {
        Ok(())
    }
}

fn active_chain_id(state: &CombatState) -> Result<String, EventSchedulerError> {
    let scheduler = state.scheduler.as_ref().ok_or_else(|| {
        scheduler_error(EventSchedulerErrorCode::SchedulerMissing, "event-scheduler")
    })?;
    if scheduler.status != EventSchedulerStatus::Active {
        return Err(scheduler_error(
            EventSchedulerErrorCode::InvalidCheckpoint,
            &scheduler.event_chain_id,
        ));
    }
    Ok(scheduler.event_chain_id.clone())
}

fn validate_engine_failure(
    state: &CombatState,
    scheduler: &EventSchedulerCheckpoint,
    failure: &LoopGuardEngineFailure,
) -> Result<(), EventSchedulerError> {
    if scheduler.current_item.is_some()
        || failure.result != CombatResultType::Aborted
        || failure.rollback_policy != LoopGuardRollbackPolicy::RestorePrecombatSnapshot
        || state.confirmed_result != Some(CombatResultType::Aborted)
        || failure.overflow_item.execution_counted
    {
        return Err(invalid_checkpoint(&scheduler.event_chain_id));
    }
    validate_item(&failure.overflow_item, &scheduler.event_chain_id)?;
    let exact_overflow = match failure.reason {
        LoopGuardFailureReason::MaxTriggerDepth => {
            failure.overflow_item.depth > scheduler.max_trigger_depth
        }
        LoopGuardFailureReason::MaxEventCount => {
            failure.overflow_item.depth <= scheduler.max_trigger_depth
                && scheduler.executed_event_count >= scheduler.max_event_count
        }
    };
    if !exact_overflow {
        return Err(invalid_checkpoint(&scheduler.event_chain_id));
    }
    Ok(())
}

fn bump_revision(state: &mut CombatState, subject_id: &str) -> Result<(), EventSchedulerError> {
    state.revision = state
        .revision
        .checked_add(1)
        .ok_or_else(|| scheduler_error(EventSchedulerErrorCode::SequenceExhausted, subject_id))?;
    Ok(())
}

fn commit_working_state(
    state: &mut CombatState,
    working: CombatState,
) -> Result<(), EventSchedulerError> {
    CanonicalEventChainScheduler::validate_state(&working)?;
    working.validate_for_commit().map_err(|_| {
        scheduler_error(
            EventSchedulerErrorCode::StateInvariantViolation,
            working
                .scheduler
                .as_ref()
                .map_or("event-scheduler", |scheduler| &scheduler.event_chain_id),
        )
    })?;
    *state = working;
    Ok(())
}

fn invalid_checkpoint(event_chain_id: &str) -> EventSchedulerError {
    scheduler_error(EventSchedulerErrorCode::InvalidCheckpoint, event_chain_id)
}

fn scheduler_error(code: EventSchedulerErrorCode, subject_id: &str) -> EventSchedulerError {
    EventSchedulerError {
        code,
        subject_id: subject_id.to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        AbilityUsageState, CURRENT_COMBAT_VERSIONS, CombatPhase, CombatRng, CombatSide,
        CombatantRuntime, CombatantState, ObjectiveRuntimeState, ProvisionalRuntimeDelta,
        ReinforcementRuntimeState, RoundRuntimeState, TimelineEntry,
    };

    const SEED: &str = "0123456789abcdef0123456789abcdef";

    #[test]
    fn canonical_tuple_orders_every_dimension_independent_of_candidate_input_order() {
        let candidates = vec![
            candidate(SchedulerItemKind::Trigger, 20, 5, "actor-b", "effect-z"),
            candidate(SchedulerItemKind::Reaction, 10, 1, "actor-b", "effect-z"),
            candidate(SchedulerItemKind::Trigger, 20, 6, "actor-b", "effect-z"),
            candidate(SchedulerItemKind::Trigger, 20, 5, "actor-a", "effect-z"),
            candidate(SchedulerItemKind::Trigger, 20, 5, "actor-b", "effect-a"),
            candidate(SchedulerItemKind::Reaction, 20, 5, "actor-b", "effect-a"),
        ];
        let first = drain_with_input(candidates.clone());
        let second = drain_with_input(candidates.into_iter().rev().collect());
        assert_eq!(first, second);
        assert_eq!(
            first
                .iter()
                .map(|item| (
                    item.phase_priority,
                    item.explicit_priority,
                    item.source_stable_id.as_str(),
                    item.effect_stable_id.as_str(),
                    item.kind,
                ))
                .collect::<Vec<_>>(),
            vec![
                (10, 1, "actor-b", "effect-z", SchedulerItemKind::Reaction),
                (20, 6, "actor-b", "effect-z", SchedulerItemKind::Trigger),
                (20, 5, "actor-a", "effect-z", SchedulerItemKind::Trigger),
                (20, 5, "actor-b", "effect-a", SchedulerItemKind::Trigger),
                (20, 5, "actor-b", "effect-a", SchedulerItemKind::Reaction),
                (20, 5, "actor-b", "effect-z", SchedulerItemKind::Trigger),
            ]
        );
    }

    #[test]
    fn same_key_sibling_runs_before_child_because_child_uses_later_sequence() {
        let mut state = fixture_state();
        begin(&mut state);
        CanonicalEventChainScheduler::enqueue_roots(
            &mut state,
            vec![
                candidate(SchedulerItemKind::Trigger, 10, 1, "actor-a", "effect-a"),
                candidate(SchedulerItemKind::Trigger, 10, 1, "actor-a", "effect-a"),
            ],
        )
        .unwrap();
        let first = CanonicalEventChainScheduler::dequeue_next(&mut state)
            .unwrap()
            .unwrap();
        ready(&mut state);
        let child = CanonicalEventChainScheduler::complete_current_with_children(
            &mut state,
            vec![candidate(
                SchedulerItemKind::Trigger,
                10,
                1,
                "actor-a",
                "effect-a",
            )],
        )
        .unwrap()
        .pop()
        .unwrap();
        let sibling = CanonicalEventChainScheduler::dequeue_next(&mut state)
            .unwrap()
            .unwrap();
        ready(&mut state);
        CanonicalEventChainScheduler::complete_current(&mut state).unwrap();
        let dequeued_child = CanonicalEventChainScheduler::dequeue_next(&mut state)
            .unwrap()
            .unwrap();
        assert_eq!(first.depth, 1);
        assert_eq!(sibling.depth, 1);
        assert_eq!(child.depth, 2);
        assert_eq!(dequeued_child, child);
        assert!(first.sequence < sibling.sequence && sibling.sequence < child.sequence);
    }

    #[test]
    fn higher_priority_child_reenters_same_queue_and_may_preempt_a_sibling() {
        let mut state = fixture_state();
        begin(&mut state);
        CanonicalEventChainScheduler::enqueue_roots(
            &mut state,
            vec![
                candidate(SchedulerItemKind::Reaction, 20, 1, "actor-a", "reaction-a"),
                candidate(SchedulerItemKind::Trigger, 20, 1, "actor-b", "trigger-b"),
            ],
        )
        .unwrap();
        let first = CanonicalEventChainScheduler::dequeue_next(&mut state)
            .unwrap()
            .unwrap();
        assert_eq!(first.effect_stable_id, "reaction-a");
        ready(&mut state);
        CanonicalEventChainScheduler::complete_current_with_children(
            &mut state,
            vec![candidate(
                SchedulerItemKind::Trigger,
                10,
                1,
                "actor-b",
                "child-early",
            )],
        )
        .unwrap();
        let next = CanonicalEventChainScheduler::dequeue_next(&mut state)
            .unwrap()
            .unwrap();
        assert_eq!(next.effect_stable_id, "child-early");
        assert_eq!(next.depth, 2);
    }

    #[test]
    fn source_initiative_is_frozen_at_enqueue_with_removed_and_system_fallbacks() {
        let mut state = fixture_state();
        state.combatants[1].last_committed_timeline_order = Some(7);
        state
            .timeline
            .retain(|entry| entry.combatant_id != "actor-b");
        begin(&mut state);
        let items = CanonicalEventChainScheduler::enqueue_roots(
            &mut state,
            vec![
                candidate(SchedulerItemKind::System, 20, 1, "system", "system-rule"),
                candidate(SchedulerItemKind::Trigger, 20, 1, "actor-a", "actor-a-rule"),
                candidate(SchedulerItemKind::Trigger, 20, 1, "actor-b", "actor-b-rule"),
            ],
        )
        .unwrap();
        assert_eq!(initiative_for(&items, "actor-a"), 0);
        assert_eq!(initiative_for(&items, "actor-b"), 7);
        assert_eq!(
            initiative_for(&items, "system"),
            NON_COMBATANT_INITIATIVE_ORDER
        );

        state.timeline.reverse();
        state.combatants[1].last_committed_timeline_order = Some(0);
        let order = drain(&mut state);
        assert_eq!(
            order
                .iter()
                .map(|item| item.source_stable_id.as_str())
                .collect::<Vec<_>>(),
            vec!["actor-a", "actor-b", "system"]
        );
    }

    #[test]
    fn current_item_blocks_recursive_dequeue_and_root_insertion() {
        let mut state = fixture_state();
        let rng_before = state.rng.clone();
        begin(&mut state);
        CanonicalEventChainScheduler::enqueue_roots(
            &mut state,
            vec![candidate(
                SchedulerItemKind::Trigger,
                10,
                1,
                "actor-a",
                "effect-a",
            )],
        )
        .unwrap();
        CanonicalEventChainScheduler::dequeue_next(&mut state)
            .unwrap()
            .unwrap();
        assert_eq!(
            CanonicalEventChainScheduler::dequeue_next(&mut state)
                .unwrap_err()
                .code,
            EventSchedulerErrorCode::CurrentItemActive
        );
        assert_eq!(
            CanonicalEventChainScheduler::enqueue_roots(&mut state, Vec::new())
                .unwrap_err()
                .code,
            EventSchedulerErrorCode::CurrentItemActive
        );
        assert_eq!(state.rng, rng_before);
    }

    #[test]
    fn malformed_candidate_and_tampered_queue_fail_atomically_and_on_restore() {
        let mut state = fixture_state();
        begin(&mut state);
        let before = state.clone();
        let error = CanonicalEventChainScheduler::enqueue_roots(
            &mut state,
            vec![candidate(
                SchedulerItemKind::Trigger,
                10,
                1,
                "actor-a",
                "bad id",
            )],
        )
        .unwrap_err();
        assert_eq!(error.code, EventSchedulerErrorCode::InvalidStableId);
        assert_eq!(state, before);

        CanonicalEventChainScheduler::enqueue_roots(
            &mut state,
            vec![
                candidate(SchedulerItemKind::Trigger, 20, 1, "actor-a", "effect-z"),
                candidate(SchedulerItemKind::Trigger, 10, 1, "actor-a", "effect-a"),
            ],
        )
        .unwrap();
        state.scheduler.as_mut().unwrap().queue.reverse();
        let restored = state.snapshot().unwrap().verify_and_restore();
        assert!(matches!(
            restored,
            Err(crate::CombatStateRestoreError::Invariant(
                crate::CombatStateInvariantError {
                    code: crate::CombatStateInvariantCode::EventSchedulerInvalid,
                    ..
                }
            ))
        ));
    }

    #[test]
    fn depth_limit_allows_exact_n_and_aborts_on_n_plus_one_without_rng() {
        let mut state = fixture_state();
        CanonicalEventChainScheduler::begin(&mut state, "chain-1".to_owned(), 2, 10).unwrap();
        CanonicalEventChainScheduler::enqueue_roots(
            &mut state,
            vec![candidate(
                SchedulerItemKind::Trigger,
                10,
                1,
                "actor-a",
                "depth-1",
            )],
        )
        .unwrap();
        CanonicalEventChainScheduler::dequeue_next(&mut state)
            .unwrap()
            .unwrap();
        ready(&mut state);
        CanonicalEventChainScheduler::complete_current_with_children(
            &mut state,
            vec![candidate(
                SchedulerItemKind::Trigger,
                10,
                1,
                "actor-a",
                "depth-2",
            )],
        )
        .unwrap();
        CanonicalEventChainScheduler::dequeue_next(&mut state)
            .unwrap()
            .unwrap();
        ready(&mut state);
        CanonicalEventChainScheduler::complete_current_with_children(
            &mut state,
            vec![candidate(
                SchedulerItemKind::Trigger,
                10,
                1,
                "actor-a",
                "depth-3",
            )],
        )
        .unwrap();
        let overflow = CanonicalEventChainScheduler::dequeue_next(&mut state)
            .unwrap()
            .unwrap();
        let rng_before = state.rng.clone();
        let outcome =
            CanonicalEventChainScheduler::gate_current_for_execution(&mut state, true).unwrap();
        let SchedulerExecutionGateOutcome::EngineFailure { failure } = outcome else {
            panic!("expected engine failure")
        };
        assert_eq!(overflow.depth, 3);
        assert_eq!(failure.overflow_item, overflow);
        assert_eq!(failure.reason, LoopGuardFailureReason::MaxTriggerDepth);
        assert_eq!(failure.result, CombatResultType::Aborted);
        assert_eq!(
            failure.rollback_policy,
            LoopGuardRollbackPolicy::RestorePrecombatSnapshot
        );
        assert_eq!(state.scheduler.as_ref().unwrap().executed_event_count, 2);
        assert_eq!(state.confirmed_result, Some(CombatResultType::Aborted));
        assert_eq!(state.rng, rng_before);
    }

    #[test]
    fn event_count_limit_counts_only_first_n_eligible_executions() {
        let mut state = fixture_state();
        CanonicalEventChainScheduler::begin(&mut state, "chain-1".to_owned(), 10, 2).unwrap();
        CanonicalEventChainScheduler::enqueue_roots(
            &mut state,
            vec![
                candidate(SchedulerItemKind::Trigger, 10, 1, "actor-a", "event-a"),
                candidate(SchedulerItemKind::Trigger, 10, 1, "actor-a", "event-b"),
                candidate(SchedulerItemKind::Trigger, 10, 1, "actor-a", "event-c"),
            ],
        )
        .unwrap();
        for _ in 0..2 {
            CanonicalEventChainScheduler::dequeue_next(&mut state)
                .unwrap()
                .unwrap();
            let outcome = ready(&mut state);
            assert!(matches!(
                outcome,
                SchedulerExecutionGateOutcome::ReadyToExecute { resumed: false, .. }
            ));
            CanonicalEventChainScheduler::complete_current(&mut state).unwrap();
        }
        let third = CanonicalEventChainScheduler::dequeue_next(&mut state)
            .unwrap()
            .unwrap();
        let rng_before = state.rng.clone();
        let outcome = ready(&mut state);
        let SchedulerExecutionGateOutcome::EngineFailure { failure } = outcome else {
            panic!("expected engine failure")
        };
        assert_eq!(failure.reason, LoopGuardFailureReason::MaxEventCount);
        assert_eq!(failure.overflow_item, third);
        assert_eq!(state.scheduler.as_ref().unwrap().executed_event_count, 2);
        assert_eq!(state.rng, rng_before);
    }

    #[test]
    fn legality_skip_does_not_count_and_resume_does_not_count_twice_or_change_depth() {
        let mut state = fixture_state();
        begin(&mut state);
        CanonicalEventChainScheduler::enqueue_roots(
            &mut state,
            vec![
                candidate(SchedulerItemKind::Reaction, 10, 1, "actor-a", "ask-a"),
                candidate(SchedulerItemKind::Reaction, 10, 1, "actor-a", "ask-b"),
            ],
        )
        .unwrap();
        let skipped = CanonicalEventChainScheduler::dequeue_next(&mut state)
            .unwrap()
            .unwrap();
        let outcome =
            CanonicalEventChainScheduler::gate_current_for_execution(&mut state, false).unwrap();
        assert_eq!(
            outcome,
            SchedulerExecutionGateOutcome::Skipped { item: skipped }
        );
        assert_eq!(state.scheduler.as_ref().unwrap().executed_event_count, 0);

        let current = CanonicalEventChainScheduler::dequeue_next(&mut state)
            .unwrap()
            .unwrap();
        let first_gate = ready(&mut state);
        assert!(matches!(
            first_gate,
            SchedulerExecutionGateOutcome::ReadyToExecute { resumed: false, .. }
        ));
        assert_eq!(state.scheduler.as_ref().unwrap().executed_event_count, 1);
        let restored = state.snapshot().unwrap().verify_and_restore().unwrap();
        state = restored;
        let before_resume = state.clone();
        let resumed = ready(&mut state);
        assert_eq!(
            resumed,
            SchedulerExecutionGateOutcome::ReadyToExecute {
                item: SchedulerItem {
                    execution_counted: true,
                    ..current
                },
                resumed: true,
            }
        );
        assert_eq!(state, before_resume);
        assert_eq!(state.scheduler.as_ref().unwrap().executed_event_count, 1);
        assert_eq!(
            state
                .scheduler
                .as_ref()
                .unwrap()
                .current_item
                .as_ref()
                .unwrap()
                .depth,
            1
        );
    }

    #[test]
    fn engine_failure_checkpoint_is_terminal_and_tampering_is_rejected() {
        let mut state = fixture_state();
        CanonicalEventChainScheduler::begin(&mut state, "chain-1".to_owned(), 0, 10).unwrap();
        CanonicalEventChainScheduler::enqueue_roots(
            &mut state,
            vec![candidate(
                SchedulerItemKind::Trigger,
                10,
                1,
                "actor-a",
                "overflow",
            )],
        )
        .unwrap();
        CanonicalEventChainScheduler::dequeue_next(&mut state)
            .unwrap()
            .unwrap();
        ready(&mut state);
        let restored = state.snapshot().unwrap().verify_and_restore().unwrap();
        assert_eq!(restored, state);
        assert_eq!(
            CanonicalEventChainScheduler::dequeue_next(&mut state)
                .unwrap_err()
                .code,
            EventSchedulerErrorCode::InvalidCheckpoint
        );

        state.scheduler.as_mut().unwrap().max_trigger_depth = 1;
        assert!(matches!(
            state.snapshot().unwrap().verify_and_restore(),
            Err(crate::CombatStateRestoreError::Invariant(
                crate::CombatStateInvariantError {
                    code: crate::CombatStateInvariantCode::EventSchedulerInvalid,
                    ..
                }
            ))
        ));
    }

    fn drain_with_input(candidates: Vec<SchedulerCandidate>) -> Vec<SchedulerItem> {
        let mut state = fixture_state();
        begin(&mut state);
        CanonicalEventChainScheduler::enqueue_roots(&mut state, candidates).unwrap();
        drain(&mut state)
    }

    fn drain(state: &mut CombatState) -> Vec<SchedulerItem> {
        let mut items = Vec::new();
        while let Some(item) = CanonicalEventChainScheduler::dequeue_next(state).unwrap() {
            items.push(item);
            ready(state);
            CanonicalEventChainScheduler::complete_current(state).unwrap();
        }
        assert!(CanonicalEventChainScheduler::is_quiescent(state));
        items
    }

    fn begin(state: &mut CombatState) {
        CanonicalEventChainScheduler::begin(state, "chain-1".to_owned(), 32, 256).unwrap();
    }

    fn ready(state: &mut CombatState) -> SchedulerExecutionGateOutcome {
        CanonicalEventChainScheduler::gate_current_for_execution(state, true).unwrap()
    }

    fn candidate(
        kind: SchedulerItemKind,
        phase_priority: i32,
        explicit_priority: i32,
        source_stable_id: &str,
        effect_stable_id: &str,
    ) -> SchedulerCandidate {
        SchedulerCandidate {
            kind,
            phase_priority,
            explicit_priority,
            source_stable_id: source_stable_id.to_owned(),
            effect_stable_id: effect_stable_id.to_owned(),
        }
    }

    fn initiative_for(items: &[SchedulerItem], source_id: &str) -> u32 {
        items
            .iter()
            .find(|item| item.source_stable_id == source_id)
            .unwrap()
            .source_initiative_order
    }

    fn fixture_state() -> CombatState {
        let combatant = |id: &str| CombatantRuntime {
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
                cooldown_remaining: 0,
                uses_this_normal_owner_turn: 0,
                uses_this_battle: 0,
            }],
            basic_attack_count_this_normal_owner_turn: 0,
            once_usage_counters: vec![],
            initiative_result: 10,
            initiative_base_stat: 2,
            last_committed_timeline_order: None,
            solo_recovery_available: false,
        };
        CombatState {
            combat_instance_id: "combat-scheduler-fixture".to_owned(),
            versions: CURRENT_COMBAT_VERSIONS,
            random_seed: SEED.to_owned(),
            revision: 1,
            last_committed_sequence: 0,
            phase: CombatPhase::Action,
            combatants: vec![combatant("actor-a"), combatant("actor-b")],
            combat_inventory: vec![],
            cost_reservations: vec![],
            resolution_context: None,
            timeline: vec![
                TimelineEntry {
                    combatant_id: "actor-a".to_owned(),
                    initiative_result: 10,
                    initiative_base_stat: 2,
                    is_extra_turn: false,
                    source_sequence: 1,
                },
                TimelineEntry {
                    combatant_id: "actor-b".to_owned(),
                    initiative_result: 9,
                    initiative_base_stat: 2,
                    is_extra_turn: false,
                    source_sequence: 2,
                },
            ],
            round: RoundRuntimeState {
                round_number: 1,
                completed_round_count: 0,
                active_combatant_id: Some("actor-a".to_owned()),
                extra_turn_resume_phase: None,
                roster: vec![crate::RoundRosterEntry {
                    combatant_id: "actor-a".to_owned(),
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
                "combat-scheduler-fixture",
                CURRENT_COMBAT_VERSIONS.rng_contract_version,
            )
            .unwrap()
            .snapshot(),
        }
    }
}

use std::{error::Error, fmt};

use serde::{Deserialize, Serialize};

use crate::{
    CombatPhase, CombatResultType, CombatState, CombatantState, EventSchedulerStatus,
    ObjectiveCommittedOutcome, ObjectiveCommittedSignal, ObjectiveFailureReason,
    ObjectiveFailureRecord, ObjectiveKind, ObjectiveRuntime, ResultCandidate,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ObjectiveEvaluationPoint {
    BattleStart,
    RoundStart,
    OwnerTurnStart,
    CommandQuiescent,
    OwnerTurnEnd,
    RoundEnd,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ObjectiveEvaluation {
    pub newly_completed_objective_ids: Vec<String>,
    pub newly_failed_objective_ids: Vec<String>,
    pub new_terminal_candidates: Vec<ResultCandidate>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ObjectiveRuntimeErrorCode {
    InvalidDefinition,
    InvalidStableId,
    ObjectiveMissing,
    InvalidSignal,
    SignalConflict,
    NotQuiescent,
    InvalidEvaluationPoint,
    InvalidRuntimeState,
    SequenceExhausted,
    StateInvariantViolation,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ObjectiveRuntimeError {
    pub code: ObjectiveRuntimeErrorCode,
    pub subject_id: String,
}

impl fmt::Display for ObjectiveRuntimeError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "combat objective runtime failed for {}: {:?}",
            self.subject_id, self.code
        )
    }
}

impl Error for ObjectiveRuntimeError {}

pub struct CombatObjectiveRuntime;

impl CombatObjectiveRuntime {
    pub fn initialize(
        state: &mut CombatState,
        mut objectives: Vec<ObjectiveRuntime>,
    ) -> Result<Vec<ObjectiveRuntime>, ObjectiveRuntimeError> {
        for objective in &mut objectives {
            objective.tracked_combatant_ids.sort();
        }
        objectives.sort_by(|left, right| left.objective_id.cmp(&right.objective_id));
        validate_definitions(state, &objectives)?;
        if !state.objectives.objectives.is_empty() {
            if state.objectives.objectives == objectives {
                return Ok(objectives);
            }
            return Err(objective_error(
                ObjectiveRuntimeErrorCode::InvalidRuntimeState,
                "objective-set",
            ));
        }
        if !state.objectives.required_objective_ids.is_empty()
            || !state.objectives.completed_objective_ids.is_empty()
            || !state.objectives.failed_objective_ids.is_empty()
            || !state.objectives.committed_signals.is_empty()
            || !state.objectives.failure_records.is_empty()
        {
            return Err(objective_error(
                ObjectiveRuntimeErrorCode::InvalidRuntimeState,
                "objective-set",
            ));
        }
        let required = objectives
            .iter()
            .filter(|objective| objective.required)
            .map(|objective| objective.objective_id.clone())
            .collect();
        let mut working = state.clone();
        working.objectives.objectives = objectives.clone();
        working.objectives.required_objective_ids = required;
        bump_revision(&mut working, "objective-set")?;
        commit(state, working, "objective-set")?;
        Ok(objectives)
    }

    pub fn commit_signal(
        state: &mut CombatState,
        signal: ObjectiveCommittedSignal,
    ) -> Result<ObjectiveCommittedSignal, ObjectiveRuntimeError> {
        Self::validate_state(state)?;
        let objective = state
            .objectives
            .objectives
            .iter()
            .find(|objective| objective.objective_id == signal.objective_id)
            .ok_or_else(|| {
                objective_error(
                    ObjectiveRuntimeErrorCode::ObjectiveMissing,
                    &signal.objective_id,
                )
            })?;
        let legal = matches!(objective.kind, ObjectiveKind::Scripted)
            || (objective.kind == ObjectiveKind::Escape
                && signal.outcome == ObjectiveCommittedOutcome::Satisfied);
        if !legal {
            return Err(objective_error(
                ObjectiveRuntimeErrorCode::InvalidSignal,
                &signal.objective_id,
            ));
        }
        if let Some(existing) = state
            .objectives
            .committed_signals
            .iter()
            .find(|existing| existing.objective_id == signal.objective_id)
        {
            if existing == &signal {
                return Ok(existing.clone());
            }
            return Err(objective_error(
                ObjectiveRuntimeErrorCode::SignalConflict,
                &signal.objective_id,
            ));
        }
        let mut working = state.clone();
        working.objectives.committed_signals.push(signal.clone());
        working
            .objectives
            .committed_signals
            .sort_by(|left, right| left.objective_id.cmp(&right.objective_id));
        bump_revision(&mut working, &signal.objective_id)?;
        commit(state, working, &signal.objective_id)?;
        Ok(signal)
    }

    pub fn evaluate(
        state: &mut CombatState,
        point: ObjectiveEvaluationPoint,
    ) -> Result<ObjectiveEvaluation, ObjectiveRuntimeError> {
        Self::validate_state(state)?;
        validate_evaluation_point(state, point)?;
        require_quiescent(state)?;
        if state.confirmed_result.is_some() {
            return Err(objective_error(
                ObjectiveRuntimeErrorCode::InvalidRuntimeState,
                "confirmed-result",
            ));
        }

        let mut working = state.clone();
        let mut newly_completed = Vec::new();
        let mut newly_failed = Vec::new();
        let objectives = working.objectives.objectives.clone();
        for objective in &objectives {
            if working
                .objectives
                .completed_objective_ids
                .contains(&objective.objective_id)
                || working
                    .objectives
                    .failed_objective_ids
                    .contains(&objective.objective_id)
            {
                continue;
            }
            match evaluate_one(&working, objective)? {
                ObjectiveDisposition::Unchanged => {}
                ObjectiveDisposition::Completed => {
                    working
                        .objectives
                        .completed_objective_ids
                        .push(objective.objective_id.clone());
                    newly_completed.push(objective.objective_id.clone());
                }
                ObjectiveDisposition::Failed(reason) => {
                    working
                        .objectives
                        .failed_objective_ids
                        .push(objective.objective_id.clone());
                    working
                        .objectives
                        .failure_records
                        .push(ObjectiveFailureRecord {
                            objective_id: objective.objective_id.clone(),
                            reason,
                        });
                    newly_failed.push(objective.objective_id.clone());
                }
            }
        }
        working.objectives.completed_objective_ids.sort();
        working.objectives.failed_objective_ids.sort();
        working
            .objectives
            .failure_records
            .sort_by(|left, right| left.objective_id.cmp(&right.objective_id));

        let mut candidate_specs = Vec::new();
        for objective_id in &newly_failed {
            let objective = objective_by_id(&working, objective_id)?;
            if objective.required {
                candidate_specs.push(CandidateSpec {
                    candidate_id: format!("objective:{objective_id}:defeat"),
                    result_type: CombatResultType::Defeat,
                    source_id: objective_id.clone(),
                    explicit_priority: objective.terminal_priority,
                });
            }
        }
        for objective_id in &newly_completed {
            let objective = objective_by_id(&working, objective_id)?;
            match objective.kind {
                ObjectiveKind::Escape => candidate_specs.push(CandidateSpec {
                    candidate_id: format!("objective:{objective_id}:escape"),
                    result_type: CombatResultType::Escape,
                    source_id: objective_id.clone(),
                    explicit_priority: objective.terminal_priority,
                }),
                ObjectiveKind::Scripted => {
                    if let Some(result_type) = objective.scripted_result {
                        candidate_specs.push(CandidateSpec {
                            candidate_id: format!(
                                "objective:{objective_id}:{}",
                                result_slug(result_type)
                            ),
                            result_type,
                            source_id: objective_id.clone(),
                            explicit_priority: objective.terminal_priority,
                        });
                    }
                }
                ObjectiveKind::Eliminate
                | ObjectiveKind::DefeatTarget
                | ObjectiveKind::Survive
                | ObjectiveKind::Protect => {}
            }
        }
        if !working.objectives.required_objective_ids.is_empty()
            && working
                .objectives
                .required_objective_ids
                .iter()
                .all(|id| working.objectives.completed_objective_ids.contains(id))
            && !working
                .objectives
                .required_objective_ids
                .iter()
                .any(|id| working.objectives.failed_objective_ids.contains(id))
        {
            candidate_specs.push(CandidateSpec {
                candidate_id: "objective:required:victory".to_owned(),
                result_type: CombatResultType::Victory,
                source_id: "required-objectives".to_owned(),
                explicit_priority: required_terminal_priority(&working),
            });
        }
        candidate_specs.sort_by(|left, right| left.candidate_id.cmp(&right.candidate_id));
        let new_candidates = append_candidates(&mut working, candidate_specs)?;

        if newly_completed.is_empty() && newly_failed.is_empty() && new_candidates.is_empty() {
            return Ok(ObjectiveEvaluation {
                newly_completed_objective_ids: Vec::new(),
                newly_failed_objective_ids: Vec::new(),
                new_terminal_candidates: Vec::new(),
            });
        }
        bump_revision(&mut working, "objective-evaluation")?;
        commit(state, working, "objective-evaluation")?;
        Ok(ObjectiveEvaluation {
            newly_completed_objective_ids: newly_completed,
            newly_failed_objective_ids: newly_failed,
            new_terminal_candidates: new_candidates,
        })
    }

    pub fn validate_state(state: &CombatState) -> Result<(), ObjectiveRuntimeError> {
        validate_definitions(state, &state.objectives.objectives)?;
        let expected_required: Vec<String> = state
            .objectives
            .objectives
            .iter()
            .filter(|objective| objective.required)
            .map(|objective| objective.objective_id.clone())
            .collect();
        if state.objectives.required_objective_ids != expected_required {
            return Err(objective_error(
                ObjectiveRuntimeErrorCode::InvalidRuntimeState,
                "required-objective-ids",
            ));
        }
        validate_sorted_subset(
            &state.objectives.completed_objective_ids,
            &state.objectives.objectives,
            "completed-objective-ids",
        )?;
        validate_sorted_subset(
            &state.objectives.failed_objective_ids,
            &state.objectives.objectives,
            "failed-objective-ids",
        )?;
        if state
            .objectives
            .completed_objective_ids
            .iter()
            .any(|id| state.objectives.failed_objective_ids.contains(id))
        {
            return Err(objective_error(
                ObjectiveRuntimeErrorCode::InvalidRuntimeState,
                "objective-terminal-sets",
            ));
        }
        validate_signals(state)?;
        validate_failure_records(state)?;
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ObjectiveDisposition {
    Unchanged,
    Completed,
    Failed(ObjectiveFailureReason),
}

fn evaluate_one(
    state: &CombatState,
    objective: &ObjectiveRuntime,
) -> Result<ObjectiveDisposition, ObjectiveRuntimeError> {
    match objective.kind {
        ObjectiveKind::Eliminate => {
            let completed = objective
                .tracked_combatant_ids
                .iter()
                .map(|id| objective_target_state(state, id))
                .collect::<Result<Vec<_>, _>>()?
                .into_iter()
                .all(|target_state| defeated_for_objective(target_state, objective));
            Ok(if completed {
                ObjectiveDisposition::Completed
            } else {
                ObjectiveDisposition::Unchanged
            })
        }
        ObjectiveKind::DefeatTarget => {
            let target_id = objective.target_id.as_deref().ok_or_else(|| {
                objective_error(
                    ObjectiveRuntimeErrorCode::InvalidDefinition,
                    &objective.objective_id,
                )
            })?;
            Ok(
                if defeated_for_objective(objective_target_state(state, target_id)?, objective) {
                    ObjectiveDisposition::Completed
                } else {
                    ObjectiveDisposition::Unchanged
                },
            )
        }
        ObjectiveKind::Survive => Ok(
            if state.round.completed_round_count >= objective.rounds_required.unwrap_or(u64::MAX) {
                ObjectiveDisposition::Completed
            } else {
                ObjectiveDisposition::Unchanged
            },
        ),
        ObjectiveKind::Protect => {
            let target_id = objective.target_id.as_deref().ok_or_else(|| {
                objective_error(
                    ObjectiveRuntimeErrorCode::InvalidDefinition,
                    &objective.objective_id,
                )
            })?;
            Ok(match objective_target_state(state, target_id)? {
                CombatantState::Downed if objective.fail_on_downed => {
                    ObjectiveDisposition::Failed(ObjectiveFailureReason::ProtectDowned)
                }
                CombatantState::Defeated => {
                    ObjectiveDisposition::Failed(ObjectiveFailureReason::ProtectDefeated)
                }
                CombatantState::Removed => {
                    ObjectiveDisposition::Failed(ObjectiveFailureReason::ProtectRemoved)
                }
                CombatantState::Active | CombatantState::Downed => ObjectiveDisposition::Unchanged,
            })
        }
        ObjectiveKind::Escape | ObjectiveKind::Scripted => {
            Ok(match committed_signal(state, &objective.objective_id) {
                Some(ObjectiveCommittedOutcome::Satisfied) => ObjectiveDisposition::Completed,
                Some(ObjectiveCommittedOutcome::Failed) => {
                    ObjectiveDisposition::Failed(ObjectiveFailureReason::Scripted)
                }
                None => ObjectiveDisposition::Unchanged,
            })
        }
    }
}

fn defeated_for_objective(state: CombatantState, objective: &ObjectiveRuntime) -> bool {
    state == CombatantState::Defeated
        || (state == CombatantState::Removed && objective.removed_counts_as_defeated)
}

fn objective_target_state(
    state: &CombatState,
    target_id: &str,
) -> Result<CombatantState, ObjectiveRuntimeError> {
    state
        .combatants
        .iter()
        .find(|combatant| combatant.combatant_id == target_id)
        .map(|combatant| combatant.state)
        .or_else(|| {
            state
                .reinforcements
                .reinforcements
                .iter()
                .find(|reinforcement| reinforcement.combatant_id == target_id)
                .map(|reinforcement| reinforcement.initial_runtime_snapshot.state)
        })
        .ok_or_else(|| objective_error(ObjectiveRuntimeErrorCode::ObjectiveMissing, target_id))
}

fn committed_signal(state: &CombatState, objective_id: &str) -> Option<ObjectiveCommittedOutcome> {
    state
        .objectives
        .committed_signals
        .iter()
        .find(|signal| signal.objective_id == objective_id)
        .map(|signal| signal.outcome)
}

#[derive(Debug)]
struct CandidateSpec {
    candidate_id: String,
    result_type: CombatResultType,
    source_id: String,
    explicit_priority: Option<i32>,
}

fn append_candidates(
    state: &mut CombatState,
    specs: Vec<CandidateSpec>,
) -> Result<Vec<ResultCandidate>, ObjectiveRuntimeError> {
    if specs.is_empty() {
        return Ok(Vec::new());
    }
    let mut next_sequence = state
        .result_candidates
        .iter()
        .map(|candidate| candidate.sequence)
        .max()
        .unwrap_or(0)
        .checked_add(1)
        .ok_or_else(|| {
            objective_error(
                ObjectiveRuntimeErrorCode::SequenceExhausted,
                "result-candidate",
            )
        })?;
    let mut appended = Vec::new();
    for spec in specs {
        if let Some(existing) = state
            .result_candidates
            .iter()
            .find(|candidate| candidate.candidate_id == spec.candidate_id)
        {
            if existing.result_type != spec.result_type
                || existing.source_kind != "OBJECTIVE"
                || existing.source_id != spec.source_id
                || existing.explicit_priority != spec.explicit_priority
            {
                return Err(objective_error(
                    ObjectiveRuntimeErrorCode::InvalidRuntimeState,
                    &spec.candidate_id,
                ));
            }
            continue;
        }
        let candidate = ResultCandidate {
            candidate_id: spec.candidate_id,
            result_type: spec.result_type,
            source_kind: "OBJECTIVE".to_owned(),
            source_id: spec.source_id,
            explicit_priority: spec.explicit_priority,
            sequence: next_sequence,
        };
        next_sequence = next_sequence.checked_add(1).ok_or_else(|| {
            objective_error(
                ObjectiveRuntimeErrorCode::SequenceExhausted,
                "result-candidate",
            )
        })?;
        state.result_candidates.push(candidate.clone());
        appended.push(candidate);
    }
    Ok(appended)
}

fn required_terminal_priority(state: &CombatState) -> Option<i32> {
    state
        .objectives
        .objectives
        .iter()
        .filter(|objective| objective.required)
        .filter_map(|objective| objective.terminal_priority)
        .max()
}

fn objective_by_id<'a>(
    state: &'a CombatState,
    objective_id: &str,
) -> Result<&'a ObjectiveRuntime, ObjectiveRuntimeError> {
    state
        .objectives
        .objectives
        .iter()
        .find(|objective| objective.objective_id == objective_id)
        .ok_or_else(|| objective_error(ObjectiveRuntimeErrorCode::ObjectiveMissing, objective_id))
}

fn validate_definitions(
    state: &CombatState,
    objectives: &[ObjectiveRuntime],
) -> Result<(), ObjectiveRuntimeError> {
    let mut previous_id: Option<&str> = None;
    for objective in objectives {
        validate_stable_id(&objective.objective_id)?;
        if previous_id.is_some_and(|previous| previous >= objective.objective_id.as_str()) {
            return Err(objective_error(
                ObjectiveRuntimeErrorCode::InvalidDefinition,
                &objective.objective_id,
            ));
        }
        previous_id = Some(&objective.objective_id);
        validate_sorted_ids(&objective.tracked_combatant_ids, &objective.objective_id)?;
        for target_id in &objective.tracked_combatant_ids {
            validate_stable_id(target_id)?;
            objective_target_state(state, target_id)?;
        }
        if let Some(target_id) = &objective.target_id {
            validate_stable_id(target_id)?;
            objective_target_state(state, target_id)?;
        }
        let valid_shape = match objective.kind {
            ObjectiveKind::Eliminate => {
                objective.target_id.is_none()
                    && objective.rounds_required.is_none()
                    && !objective.fail_on_downed
                    && objective.scripted_result.is_none()
                    && (!objective.required || !objective.tracked_combatant_ids.is_empty())
            }
            ObjectiveKind::DefeatTarget => {
                objective.target_id.is_some()
                    && objective.tracked_combatant_ids.is_empty()
                    && objective.rounds_required.is_none()
                    && !objective.fail_on_downed
                    && objective.scripted_result.is_none()
            }
            ObjectiveKind::Survive => {
                objective.target_id.is_none()
                    && objective.tracked_combatant_ids.is_empty()
                    && objective.rounds_required.is_some_and(|rounds| rounds > 0)
                    && !objective.fail_on_downed
                    && !objective.removed_counts_as_defeated
                    && objective.scripted_result.is_none()
            }
            ObjectiveKind::Protect => {
                objective.target_id.is_some()
                    && objective.tracked_combatant_ids.is_empty()
                    && objective.rounds_required.is_none()
                    && !objective.removed_counts_as_defeated
                    && objective.scripted_result.is_none()
            }
            ObjectiveKind::Escape => {
                objective.target_id.is_none()
                    && objective.tracked_combatant_ids.is_empty()
                    && objective.rounds_required.is_none()
                    && !objective.fail_on_downed
                    && !objective.removed_counts_as_defeated
                    && objective.scripted_result.is_none()
            }
            ObjectiveKind::Scripted => {
                objective.target_id.is_none()
                    && objective.tracked_combatant_ids.is_empty()
                    && objective.rounds_required.is_none()
                    && !objective.fail_on_downed
                    && !objective.removed_counts_as_defeated
                    && objective.scripted_result.is_none_or(|result| {
                        matches!(
                            result,
                            CombatResultType::ScriptedVictory | CombatResultType::ScriptedDefeat
                        )
                    })
            }
        };
        if !valid_shape {
            return Err(objective_error(
                ObjectiveRuntimeErrorCode::InvalidDefinition,
                &objective.objective_id,
            ));
        }
    }
    Ok(())
}

fn validate_sorted_ids(ids: &[String], subject: &str) -> Result<(), ObjectiveRuntimeError> {
    for (index, id) in ids.iter().enumerate() {
        if index > 0 && ids[index - 1] >= *id {
            return Err(objective_error(
                ObjectiveRuntimeErrorCode::InvalidRuntimeState,
                subject,
            ));
        }
    }
    Ok(())
}

fn validate_sorted_subset(
    ids: &[String],
    objectives: &[ObjectiveRuntime],
    subject: &str,
) -> Result<(), ObjectiveRuntimeError> {
    validate_sorted_ids(ids, subject)?;
    if ids.iter().any(|id| {
        !objectives
            .iter()
            .any(|objective| objective.objective_id == *id)
    }) {
        return Err(objective_error(
            ObjectiveRuntimeErrorCode::InvalidRuntimeState,
            subject,
        ));
    }
    Ok(())
}

fn validate_signals(state: &CombatState) -> Result<(), ObjectiveRuntimeError> {
    let signals = &state.objectives.committed_signals;
    for (index, signal) in signals.iter().enumerate() {
        if index > 0 && signals[index - 1].objective_id >= signal.objective_id {
            return Err(objective_error(
                ObjectiveRuntimeErrorCode::InvalidRuntimeState,
                "committed-objective-signals",
            ));
        }
        let objective = objective_by_id(state, &signal.objective_id)?;
        if !matches!(
            objective.kind,
            ObjectiveKind::Escape | ObjectiveKind::Scripted
        ) || (objective.kind == ObjectiveKind::Escape
            && signal.outcome != ObjectiveCommittedOutcome::Satisfied)
        {
            return Err(objective_error(
                ObjectiveRuntimeErrorCode::InvalidSignal,
                &signal.objective_id,
            ));
        }
    }
    Ok(())
}

fn validate_failure_records(state: &CombatState) -> Result<(), ObjectiveRuntimeError> {
    let records = &state.objectives.failure_records;
    if records.len() != state.objectives.failed_objective_ids.len() {
        return Err(objective_error(
            ObjectiveRuntimeErrorCode::InvalidRuntimeState,
            "objective-failure-records",
        ));
    }
    for (index, record) in records.iter().enumerate() {
        if state.objectives.failed_objective_ids.get(index) != Some(&record.objective_id) {
            return Err(objective_error(
                ObjectiveRuntimeErrorCode::InvalidRuntimeState,
                "objective-failure-records",
            ));
        }
        let objective = objective_by_id(state, &record.objective_id)?;
        let compatible = match record.reason {
            ObjectiveFailureReason::ProtectDowned => {
                objective.kind == ObjectiveKind::Protect && objective.fail_on_downed
            }
            ObjectiveFailureReason::ProtectDefeated | ObjectiveFailureReason::ProtectRemoved => {
                objective.kind == ObjectiveKind::Protect
            }
            ObjectiveFailureReason::Scripted => objective.kind == ObjectiveKind::Scripted,
        };
        if !compatible {
            return Err(objective_error(
                ObjectiveRuntimeErrorCode::InvalidRuntimeState,
                &record.objective_id,
            ));
        }
        if record.reason == ObjectiveFailureReason::ProtectRemoved {
            let target_id = objective.target_id.as_deref().ok_or_else(|| {
                objective_error(
                    ObjectiveRuntimeErrorCode::InvalidRuntimeState,
                    &record.objective_id,
                )
            })?;
            if state
                .combatants
                .iter()
                .find(|combatant| combatant.combatant_id == target_id)
                .is_some_and(|combatant| combatant.state != CombatantState::Removed)
            {
                return Err(objective_error(
                    ObjectiveRuntimeErrorCode::InvalidRuntimeState,
                    target_id,
                ));
            }
        }
    }
    Ok(())
}

fn validate_evaluation_point(
    state: &CombatState,
    point: ObjectiveEvaluationPoint,
) -> Result<(), ObjectiveRuntimeError> {
    let phase_matches = matches!(
        (point, state.phase),
        (
            ObjectiveEvaluationPoint::BattleStart,
            CombatPhase::BattleStart
        ) | (
            ObjectiveEvaluationPoint::RoundStart,
            CombatPhase::RoundStart
        ) | (
            ObjectiveEvaluationPoint::OwnerTurnStart,
            CombatPhase::OwnerTurnStart
        ) | (
            ObjectiveEvaluationPoint::CommandQuiescent,
            CombatPhase::Action
        ) | (
            ObjectiveEvaluationPoint::OwnerTurnEnd,
            CombatPhase::OwnerTurnEnd
        ) | (ObjectiveEvaluationPoint::RoundEnd, CombatPhase::RoundEnd)
    );
    if !phase_matches
        || (point == ObjectiveEvaluationPoint::RoundEnd
            && state.round.completed_round_count != state.round.round_number)
    {
        return Err(objective_error(
            ObjectiveRuntimeErrorCode::InvalidEvaluationPoint,
            "objective-evaluation-point",
        ));
    }
    Ok(())
}

fn require_quiescent(state: &CombatState) -> Result<(), ObjectiveRuntimeError> {
    let quiescent = state.scheduler.as_ref().is_none_or(|scheduler| {
        scheduler.status == EventSchedulerStatus::Active
            && scheduler.queue.is_empty()
            && scheduler.current_item.is_none()
    });
    if !quiescent {
        return Err(objective_error(
            ObjectiveRuntimeErrorCode::NotQuiescent,
            "event-chain",
        ));
    }
    Ok(())
}

fn result_slug(result: CombatResultType) -> &'static str {
    match result {
        CombatResultType::Victory => "victory",
        CombatResultType::Defeat => "defeat",
        CombatResultType::Escape => "escape",
        CombatResultType::ScriptedVictory => "scripted-victory",
        CombatResultType::ScriptedDefeat => "scripted-defeat",
        CombatResultType::Aborted => "aborted",
    }
}

fn commit(
    state: &mut CombatState,
    working: CombatState,
    subject: &str,
) -> Result<(), ObjectiveRuntimeError> {
    CombatObjectiveRuntime::validate_state(&working)?;
    working.validate_for_commit().map_err(|_| {
        objective_error(ObjectiveRuntimeErrorCode::StateInvariantViolation, subject)
    })?;
    *state = working;
    Ok(())
}

fn bump_revision(state: &mut CombatState, subject: &str) -> Result<(), ObjectiveRuntimeError> {
    state.revision = state
        .revision
        .checked_add(1)
        .ok_or_else(|| objective_error(ObjectiveRuntimeErrorCode::SequenceExhausted, subject))?;
    Ok(())
}

fn validate_stable_id(value: &str) -> Result<(), ObjectiveRuntimeError> {
    if value.is_empty()
        || value.len() > 128
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b':' | b'-'))
    {
        Err(objective_error(
            ObjectiveRuntimeErrorCode::InvalidStableId,
            value,
        ))
    } else {
        Ok(())
    }
}

fn objective_error(code: ObjectiveRuntimeErrorCode, subject_id: &str) -> ObjectiveRuntimeError {
    ObjectiveRuntimeError {
        code,
        subject_id: subject_id.to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        AbilityUsageState, CURRENT_COMBAT_VERSIONS, CanonicalEventChainScheduler, CombatRng,
        CombatSide, CombatantRuntime, ObjectiveRuntimeState, ProvisionalRuntimeDelta,
        ReinforcementRuntime, ReinforcementRuntimeState, RoundRuntimeState, SchedulerCandidate,
        SchedulerItemKind, TimelineEntry, TurnRoundStateMachine,
    };

    const SEED: &str = "0123456789abcdef0123456789abcdef";

    #[test]
    fn initialization_sorts_and_freezes_valid_definitions_and_rejects_ambiguous_shapes() {
        let mut state = battle_start_state();
        let objectives = vec![
            survive("survive", true, 2),
            eliminate(
                "eliminate",
                true,
                vec!["reinforcement".to_owned(), "enemy".to_owned()],
            ),
        ];
        let resolved = CombatObjectiveRuntime::initialize(&mut state, objectives).unwrap();
        assert_eq!(resolved[0].objective_id, "eliminate");
        assert_eq!(
            resolved[0].tracked_combatant_ids,
            vec!["enemy", "reinforcement"]
        );
        assert_eq!(
            state.objectives.required_objective_ids,
            vec!["eliminate", "survive"]
        );

        for invalid in [
            eliminate("empty", true, vec![]),
            objective("target", ObjectiveKind::DefeatTarget, true),
            survive("zero", true, 0),
        ] {
            let mut fresh = battle_start_state();
            let before = fresh.clone();
            assert!(matches!(
                CombatObjectiveRuntime::initialize(&mut fresh, vec![invalid]),
                Err(ObjectiveRuntimeError {
                    code: ObjectiveRuntimeErrorCode::InvalidDefinition,
                    ..
                })
            ));
            assert_eq!(fresh, before);
        }
    }

    #[test]
    fn eliminate_uses_frozen_tracked_ids_including_undeployed_reinforcement() {
        let mut state = battle_start_state();
        CombatObjectiveRuntime::initialize(
            &mut state,
            vec![eliminate(
                "eliminate",
                true,
                vec!["enemy".to_owned(), "reinforcement".to_owned()],
            )],
        )
        .unwrap();
        defeat(&mut state.combatants[1]);
        let first =
            CombatObjectiveRuntime::evaluate(&mut state, ObjectiveEvaluationPoint::BattleStart)
                .unwrap();
        assert!(first.newly_completed_objective_ids.is_empty());
        assert!(state.objectives.completed_objective_ids.is_empty());

        let mut deployed = state.reinforcements.reinforcements[0]
            .initial_runtime_snapshot
            .clone();
        defeat(&mut deployed);
        state.timeline.push(timeline(&deployed, 3));
        state.combatants.push(deployed);
        state.reinforcements.reinforcements[0].is_deployed = true;
        let second =
            CombatObjectiveRuntime::evaluate(&mut state, ObjectiveEvaluationPoint::BattleStart)
                .unwrap();
        assert_eq!(second.newly_completed_objective_ids, vec!["eliminate"]);
        assert_eq!(
            second.new_terminal_candidates[0].result_type,
            CombatResultType::Victory
        );
    }

    #[test]
    fn downed_and_removed_only_complete_defeat_objectives_under_declared_policy() {
        let mut downed = battle_start_state();
        let mut strict = target_objective("strict", ObjectiveKind::DefeatTarget, "enemy", true);
        strict.removed_counts_as_defeated = false;
        CombatObjectiveRuntime::initialize(&mut downed, vec![strict]).unwrap();
        downed.combatants[1].state = CombatantState::Downed;
        downed.combatants[1].hit_points = 0;
        CombatObjectiveRuntime::evaluate(&mut downed, ObjectiveEvaluationPoint::BattleStart)
            .unwrap();
        assert!(downed.objectives.completed_objective_ids.is_empty());

        let mut removed = battle_start_state();
        let mut permissive =
            target_objective("permissive", ObjectiveKind::DefeatTarget, "enemy", true);
        permissive.removed_counts_as_defeated = true;
        CombatObjectiveRuntime::initialize(&mut removed, vec![permissive]).unwrap();
        removed.combatants[1].state = CombatantState::Removed;
        CombatObjectiveRuntime::evaluate(&mut removed, ObjectiveEvaluationPoint::BattleStart)
            .unwrap();
        assert_eq!(
            removed.objectives.completed_objective_ids,
            vec!["permissive"]
        );
    }

    #[test]
    fn survive_completes_only_after_the_nth_committed_round_end() {
        let mut state = empty_battle_start_state();
        CombatObjectiveRuntime::initialize(&mut state, vec![survive("survive", true, 1)]).unwrap();
        TurnRoundStateMachine::begin_round(&mut state).unwrap();
        CombatObjectiveRuntime::evaluate(&mut state, ObjectiveEvaluationPoint::RoundStart).unwrap();
        assert!(state.objectives.completed_objective_ids.is_empty());
        TurnRoundStateMachine::advance_to_next_normal_turn_or_round_end(&mut state).unwrap();
        assert!(matches!(
            CombatObjectiveRuntime::evaluate(&mut state, ObjectiveEvaluationPoint::RoundEnd),
            Err(ObjectiveRuntimeError {
                code: ObjectiveRuntimeErrorCode::InvalidEvaluationPoint,
                ..
            })
        ));
        TurnRoundStateMachine::complete_round_end(&mut state).unwrap();
        CombatObjectiveRuntime::evaluate(&mut state, ObjectiveEvaluationPoint::RoundEnd).unwrap();
        assert_eq!(state.objectives.completed_objective_ids, vec!["survive"]);
    }

    #[test]
    fn protect_removed_is_committed_monotonic_and_cannot_be_undone_by_reactivation() {
        let mut state = battle_start_state();
        CombatObjectiveRuntime::initialize(
            &mut state,
            vec![target_objective(
                "protect",
                ObjectiveKind::Protect,
                "ally",
                true,
            )],
        )
        .unwrap();

        let mut uncommitted_working = state.clone();
        uncommitted_working.combatants[0].state = CombatantState::Removed;
        state.timeline.clear();
        CombatObjectiveRuntime::evaluate(&mut state, ObjectiveEvaluationPoint::BattleStart)
            .unwrap();
        assert!(state.objectives.failed_objective_ids.is_empty());

        state.combatants[0].state = CombatantState::Downed;
        state.combatants[0].hit_points = 0;
        CombatObjectiveRuntime::evaluate(&mut state, ObjectiveEvaluationPoint::BattleStart)
            .unwrap();
        assert!(state.objectives.failed_objective_ids.is_empty());
        state.combatants[0].state = CombatantState::Removed;
        let first =
            CombatObjectiveRuntime::evaluate(&mut state, ObjectiveEvaluationPoint::BattleStart)
                .unwrap();
        assert_eq!(first.newly_failed_objective_ids, vec!["protect"]);
        assert_eq!(
            state.objectives.failure_records[0].reason,
            ObjectiveFailureReason::ProtectRemoved
        );
        assert_eq!(
            first.new_terminal_candidates[0].result_type,
            CombatResultType::Defeat
        );
        let restored = state.snapshot().unwrap().verify_and_restore().unwrap();
        assert_eq!(restored, state);

        state.combatants[0].state = CombatantState::Active;
        state.combatants[0].hit_points = 10;
        assert!(matches!(
            state.snapshot().unwrap().verify_and_restore(),
            Err(crate::CombatStateRestoreError::Invariant(
                crate::CombatStateInvariantError {
                    code: crate::CombatStateInvariantCode::ObjectiveRuntimeInvalid,
                    ..
                }
            ))
        ));
        assert_eq!(
            uncommitted_working.combatants[0].state,
            CombatantState::Removed
        );
    }

    #[test]
    fn optional_failure_does_not_block_required_victory_and_signals_are_exactly_once() {
        let mut state = battle_start_state();
        let optional = target_objective("optional-protect", ObjectiveKind::Protect, "ally", false);
        let required = target_objective(
            "required-target",
            ObjectiveKind::DefeatTarget,
            "enemy",
            true,
        );
        let mut scripted = objective("scripted", ObjectiveKind::Scripted, false);
        scripted.scripted_result = Some(CombatResultType::ScriptedVictory);
        let escape = objective("escape", ObjectiveKind::Escape, false);
        CombatObjectiveRuntime::initialize(&mut state, vec![optional, required, scripted, escape])
            .unwrap();
        for (id, outcome) in [
            ("escape", ObjectiveCommittedOutcome::Satisfied),
            ("scripted", ObjectiveCommittedOutcome::Satisfied),
        ] {
            let signal = ObjectiveCommittedSignal {
                objective_id: id.to_owned(),
                outcome,
            };
            CombatObjectiveRuntime::commit_signal(&mut state, signal.clone()).unwrap();
            let after_first = state.clone();
            CombatObjectiveRuntime::commit_signal(&mut state, signal).unwrap();
            assert_eq!(state, after_first);
        }
        state.combatants[0].state = CombatantState::Defeated;
        state.combatants[0].hit_points = 0;
        defeat(&mut state.combatants[1]);
        let result =
            CombatObjectiveRuntime::evaluate(&mut state, ObjectiveEvaluationPoint::BattleStart)
                .unwrap();
        assert!(
            state
                .objectives
                .failed_objective_ids
                .contains(&"optional-protect".to_owned())
        );
        assert!(
            result
                .new_terminal_candidates
                .iter()
                .all(|candidate| candidate.result_type != CombatResultType::Defeat)
        );
        assert_eq!(
            result
                .new_terminal_candidates
                .iter()
                .map(|candidate| candidate.result_type)
                .collect::<Vec<_>>(),
            vec![
                CombatResultType::Escape,
                CombatResultType::Victory,
                CombatResultType::ScriptedVictory,
            ]
        );
        let after_first = state.clone();
        let repeated =
            CombatObjectiveRuntime::evaluate(&mut state, ObjectiveEvaluationPoint::BattleStart)
                .unwrap();
        assert!(repeated.new_terminal_candidates.is_empty());
        assert_eq!(state, after_first);
    }

    #[test]
    fn evaluation_requires_a_matching_quiescent_point_and_is_deterministic() {
        let mut state = battle_start_state();
        CombatObjectiveRuntime::initialize(
            &mut state,
            vec![target_objective(
                "target",
                ObjectiveKind::DefeatTarget,
                "enemy",
                true,
            )],
        )
        .unwrap();
        defeat(&mut state.combatants[1]);
        CanonicalEventChainScheduler::begin(&mut state, "chain".to_owned(), 8, 32).unwrap();
        CanonicalEventChainScheduler::enqueue_roots(
            &mut state,
            vec![SchedulerCandidate {
                kind: SchedulerItemKind::Trigger,
                phase_priority: 1,
                explicit_priority: 0,
                source_stable_id: "ally".to_owned(),
                effect_stable_id: "pending".to_owned(),
            }],
        )
        .unwrap();
        assert!(matches!(
            CombatObjectiveRuntime::evaluate(&mut state, ObjectiveEvaluationPoint::BattleStart),
            Err(ObjectiveRuntimeError {
                code: ObjectiveRuntimeErrorCode::NotQuiescent,
                ..
            })
        ));

        state.scheduler = None;
        let mut replay = state.clone();
        let first =
            CombatObjectiveRuntime::evaluate(&mut state, ObjectiveEvaluationPoint::BattleStart)
                .unwrap();
        let second =
            CombatObjectiveRuntime::evaluate(&mut replay, ObjectiveEvaluationPoint::BattleStart)
                .unwrap();
        assert_eq!(first, second);
        assert_eq!(state, replay);
    }

    #[test]
    fn no_op_evaluation_does_not_require_a_fresh_candidate_sequence() {
        let mut state = battle_start_state();
        state.result_candidates.push(ResultCandidate {
            candidate_id: "existing".to_owned(),
            result_type: CombatResultType::Victory,
            source_kind: "SCRIPT".to_owned(),
            source_id: "existing".to_owned(),
            explicit_priority: None,
            sequence: u64::MAX,
        });
        let before = state.clone();

        let evaluation =
            CombatObjectiveRuntime::evaluate(&mut state, ObjectiveEvaluationPoint::BattleStart)
                .unwrap();

        assert!(evaluation.newly_completed_objective_ids.is_empty());
        assert!(evaluation.newly_failed_objective_ids.is_empty());
        assert!(evaluation.new_terminal_candidates.is_empty());
        assert_eq!(state, before);
    }

    fn eliminate(id: &str, required: bool, tracked: Vec<String>) -> ObjectiveRuntime {
        ObjectiveRuntime {
            tracked_combatant_ids: tracked,
            ..objective(id, ObjectiveKind::Eliminate, required)
        }
    }

    fn survive(id: &str, required: bool, rounds: u64) -> ObjectiveRuntime {
        ObjectiveRuntime {
            rounds_required: Some(rounds),
            ..objective(id, ObjectiveKind::Survive, required)
        }
    }

    fn target_objective(
        id: &str,
        kind: ObjectiveKind,
        target_id: &str,
        required: bool,
    ) -> ObjectiveRuntime {
        ObjectiveRuntime {
            target_id: Some(target_id.to_owned()),
            ..objective(id, kind, required)
        }
    }

    fn objective(id: &str, kind: ObjectiveKind, required: bool) -> ObjectiveRuntime {
        ObjectiveRuntime {
            objective_id: id.to_owned(),
            kind,
            required,
            tracked_combatant_ids: vec![],
            target_id: None,
            rounds_required: None,
            fail_on_downed: false,
            removed_counts_as_defeated: false,
            terminal_priority: None,
            scripted_result: None,
        }
    }

    fn defeat(combatant: &mut CombatantRuntime) {
        combatant.hit_points = 0;
        combatant.state = CombatantState::Defeated;
    }

    fn empty_battle_start_state() -> CombatState {
        let mut state = battle_start_state();
        state.combatants.clear();
        state.timeline.clear();
        state.reinforcements.reinforcements.clear();
        state
    }

    fn battle_start_state() -> CombatState {
        let ally = combatant("ally", CombatSide::Player);
        let enemy = combatant("enemy", CombatSide::Hostile);
        let reinforcement = combatant("reinforcement", CombatSide::Hostile);
        CombatState {
            combat_instance_id: "combat-objective-fixture".to_owned(),
            versions: CURRENT_COMBAT_VERSIONS,
            random_seed: SEED.to_owned(),
            revision: 1,
            last_committed_sequence: 0,
            phase: CombatPhase::BattleStart,
            combatants: vec![ally.clone(), enemy.clone()],
            formal_party_member_ids: vec![],
            combat_inventory: vec![],
            cost_reservations: vec![],
            resolution_context: None,
            timeline: vec![timeline(&ally, 1), timeline(&enemy, 2)],
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
                reinforcements: vec![ReinforcementRuntime {
                    combatant_id: reinforcement.combatant_id.clone(),
                    definition_ref: reinforcement.definition_id.clone(),
                    is_deployed: false,
                    initiative_result: reinforcement.initiative_result,
                    initiative_base_stat: reinforcement.initiative_base_stat,
                    initial_runtime_snapshot: reinforcement,
                    objective_membership_ids: vec![],
                }],
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
                "combat-objective-fixture",
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
            normal_owner_turn_index: 0,
            initiative_result: 10,
            initiative_base_stat: 2,
            last_committed_timeline_order: None,
            solo_recovery_available: false,
        }
    }

    fn timeline(combatant: &CombatantRuntime, source_sequence: u64) -> TimelineEntry {
        TimelineEntry {
            combatant_id: combatant.combatant_id.clone(),
            initiative_result: combatant.initiative_result,
            initiative_base_stat: combatant.initiative_base_stat,
            is_extra_turn: false,
            source_sequence,
        }
    }
}

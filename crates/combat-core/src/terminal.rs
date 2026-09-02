use std::{cmp::Ordering, error::Error, fmt};

use serde::{Deserialize, Serialize};

use crate::{
    CombatResultType, CombatState, EventSchedulerStatus, ResultCandidate, TerminalPriorityPolicy,
    TerminalPriorityTier,
};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "status")]
pub enum TerminalArbitrationOutcome {
    NoCandidate,
    Confirmed {
        candidate: ResultCandidate,
        newly_confirmed: bool,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TerminalArbitrationErrorCode {
    InvalidPolicy,
    InvalidCandidate,
    InvalidConfirmation,
    NotQuiescent,
    EngineFailureOwnedResult,
    SequenceExhausted,
    StateInvariantViolation,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TerminalArbitrationError {
    pub code: TerminalArbitrationErrorCode,
    pub subject_id: String,
}

impl fmt::Display for TerminalArbitrationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "terminal arbitration failed for {}: {:?}",
            self.subject_id, self.code
        )
    }
}

impl Error for TerminalArbitrationError {}

/// The single normal-gameplay terminal result confirmer. Engine-failure
/// `Aborted` bypasses this path and remains owned by the loop guard.
pub struct TerminalOutcomeArbitrator;

impl TerminalOutcomeArbitrator {
    pub fn confirm(
        state: &mut CombatState,
    ) -> Result<TerminalArbitrationOutcome, TerminalArbitrationError> {
        Self::validate_state(state)?;
        state.validate_for_commit().map_err(|_| {
            terminal_error(
                TerminalArbitrationErrorCode::StateInvariantViolation,
                "committed-state",
            )
        })?;
        require_quiescent(state)?;

        if let Some(result_type) = state.confirmed_result {
            if result_type == CombatResultType::Aborted {
                return Err(terminal_error(
                    TerminalArbitrationErrorCode::EngineFailureOwnedResult,
                    "aborted",
                ));
            }
            let candidate_id = state
                .confirmed_result_candidate_id
                .as_deref()
                .ok_or_else(|| {
                    terminal_error(
                        TerminalArbitrationErrorCode::InvalidConfirmation,
                        "confirmed-result",
                    )
                })?;
            let candidate = state
                .result_candidates
                .iter()
                .find(|candidate| candidate.candidate_id == candidate_id)
                .cloned()
                .ok_or_else(|| {
                    terminal_error(
                        TerminalArbitrationErrorCode::InvalidConfirmation,
                        candidate_id,
                    )
                })?;
            return Ok(TerminalArbitrationOutcome::Confirmed {
                candidate,
                newly_confirmed: false,
            });
        }

        let Some(winner) = select_winner(state)? else {
            return Ok(TerminalArbitrationOutcome::NoCandidate);
        };
        let mut working = state.clone();
        working.confirmed_result_candidate_id = Some(winner.candidate_id.clone());
        working.confirmed_result = Some(winner.result_type);
        working.revision = working.revision.checked_add(1).ok_or_else(|| {
            terminal_error(
                TerminalArbitrationErrorCode::SequenceExhausted,
                &winner.candidate_id,
            )
        })?;
        Self::validate_state(&working)?;
        working.validate_for_commit().map_err(|_| {
            terminal_error(
                TerminalArbitrationErrorCode::StateInvariantViolation,
                &winner.candidate_id,
            )
        })?;
        *state = working;

        Ok(TerminalArbitrationOutcome::Confirmed {
            candidate: winner,
            newly_confirmed: true,
        })
    }

    pub fn validate_state(state: &CombatState) -> Result<(), TerminalArbitrationError> {
        validate_policy(&state.terminal_priority_policy)?;
        validate_candidates(&state.result_candidates)?;
        match (
            state.confirmed_result,
            state.confirmed_result_candidate_id.as_deref(),
        ) {
            (None, None) => Ok(()),
            (Some(CombatResultType::Aborted), None)
                if state.scheduler.as_ref().is_some_and(|scheduler| {
                    scheduler.status == EventSchedulerStatus::EngineFailure
                        && scheduler.engine_failure.is_some()
                }) =>
            {
                Ok(())
            }
            (Some(result_type), Some(candidate_id)) if result_type != CombatResultType::Aborted => {
                require_quiescent(state)?;
                let candidate = state
                    .result_candidates
                    .iter()
                    .find(|candidate| candidate.candidate_id == candidate_id)
                    .ok_or_else(|| {
                        terminal_error(
                            TerminalArbitrationErrorCode::InvalidConfirmation,
                            candidate_id,
                        )
                    })?;
                if candidate.result_type != result_type {
                    return Err(terminal_error(
                        TerminalArbitrationErrorCode::InvalidConfirmation,
                        candidate_id,
                    ));
                }
                let winner = select_winner(state)?.ok_or_else(|| {
                    terminal_error(
                        TerminalArbitrationErrorCode::InvalidConfirmation,
                        candidate_id,
                    )
                })?;
                if winner.candidate_id != candidate_id {
                    return Err(terminal_error(
                        TerminalArbitrationErrorCode::InvalidConfirmation,
                        candidate_id,
                    ));
                }
                Ok(())
            }
            _ => Err(terminal_error(
                TerminalArbitrationErrorCode::InvalidConfirmation,
                "confirmed-result",
            )),
        }
    }
}

fn select_winner(state: &CombatState) -> Result<Option<ResultCandidate>, TerminalArbitrationError> {
    let policy = &state.terminal_priority_policy;
    let mut winner: Option<&ResultCandidate> = None;
    for candidate in &state.result_candidates {
        candidate_tier_index(policy, candidate)?;
        if winner.is_none_or(|current| compare_candidates(policy, candidate, current).is_lt()) {
            winner = Some(candidate);
        }
    }
    Ok(winner.cloned())
}

fn compare_candidates(
    policy: &TerminalPriorityPolicy,
    left: &ResultCandidate,
    right: &ResultCandidate,
) -> Ordering {
    let left_tier = candidate_tier_index(policy, left).expect("validated candidate and policy");
    let right_tier = candidate_tier_index(policy, right).expect("validated candidate and policy");
    left_tier
        .cmp(&right_tier)
        .then_with(|| right.explicit_priority.cmp(&left.explicit_priority))
        .then_with(|| left.candidate_id.cmp(&right.candidate_id))
        .then_with(|| left.source_kind.cmp(&right.source_kind))
        .then_with(|| left.source_id.cmp(&right.source_id))
        .then_with(|| left.sequence.cmp(&right.sequence))
}

fn candidate_tier_index(
    policy: &TerminalPriorityPolicy,
    candidate: &ResultCandidate,
) -> Result<usize, TerminalArbitrationError> {
    policy
        .tiers
        .iter()
        .position(|tier| candidate_matches_tier(candidate, *tier))
        .ok_or_else(|| {
            terminal_error(
                TerminalArbitrationErrorCode::InvalidCandidate,
                &candidate.candidate_id,
            )
        })
}

fn candidate_matches_tier(candidate: &ResultCandidate, tier: TerminalPriorityTier) -> bool {
    match tier {
        TerminalPriorityTier::ScriptedOutcome => matches!(
            candidate.result_type,
            CombatResultType::ScriptedVictory | CombatResultType::ScriptedDefeat
        ),
        TerminalPriorityTier::ExplicitObjectivePriority => {
            candidate.source_kind == "OBJECTIVE" && candidate.explicit_priority.is_some()
        }
        TerminalPriorityTier::Defeat => candidate.result_type == CombatResultType::Defeat,
        TerminalPriorityTier::Victory => candidate.result_type == CombatResultType::Victory,
        TerminalPriorityTier::Escape => candidate.result_type == CombatResultType::Escape,
    }
}

fn validate_policy(policy: &TerminalPriorityPolicy) -> Result<(), TerminalArbitrationError> {
    if !is_stable_id(&policy.policy_id)
        || policy.tiers.len() != 5
        || ALL_TIERS
            .iter()
            .any(|tier| policy.tiers.iter().filter(|entry| *entry == tier).count() != 1)
    {
        return Err(terminal_error(
            TerminalArbitrationErrorCode::InvalidPolicy,
            &policy.policy_id,
        ));
    }
    Ok(())
}

fn validate_candidates(candidates: &[ResultCandidate]) -> Result<(), TerminalArbitrationError> {
    let mut previous_sequence = None;
    for (index, candidate) in candidates.iter().enumerate() {
        if !is_stable_id(&candidate.candidate_id)
            || !is_stable_id(&candidate.source_kind)
            || !is_stable_id(&candidate.source_id)
            || candidate.sequence == 0
            || previous_sequence.is_some_and(|sequence| sequence >= candidate.sequence)
            || candidates[..index]
                .iter()
                .any(|existing| existing.candidate_id == candidate.candidate_id)
            || (candidate.explicit_priority.is_some() && candidate.source_kind != "OBJECTIVE")
            || candidate.result_type == CombatResultType::Aborted
        {
            return Err(terminal_error(
                TerminalArbitrationErrorCode::InvalidCandidate,
                &candidate.candidate_id,
            ));
        }
        previous_sequence = Some(candidate.sequence);
    }
    Ok(())
}

fn require_quiescent(state: &CombatState) -> Result<(), TerminalArbitrationError> {
    let scheduler_quiescent = state.scheduler.as_ref().is_none_or(|scheduler| {
        scheduler.status == EventSchedulerStatus::Active
            && scheduler.queue.is_empty()
            && scheduler.current_item.is_none()
    });
    if !scheduler_quiescent
        || state.pending_reaction.is_some()
        || state.resolution_context.is_some()
    {
        return Err(terminal_error(
            TerminalArbitrationErrorCode::NotQuiescent,
            "event-chain",
        ));
    }
    Ok(())
}

const ALL_TIERS: [TerminalPriorityTier; 5] = [
    TerminalPriorityTier::ScriptedOutcome,
    TerminalPriorityTier::ExplicitObjectivePriority,
    TerminalPriorityTier::Defeat,
    TerminalPriorityTier::Victory,
    TerminalPriorityTier::Escape,
];

fn is_stable_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b':' | b'-'))
}

fn terminal_error(
    code: TerminalArbitrationErrorCode,
    subject_id: &str,
) -> TerminalArbitrationError {
    TerminalArbitrationError {
        code,
        subject_id: subject_id.to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        CURRENT_COMBAT_VERSIONS, CanonicalEventChainScheduler, CombatPhase, CombatRng,
        ObjectiveRuntimeState, ProvisionalRuntimeDelta, ReinforcementRuntimeState,
        RoundRuntimeState, SchedulerCandidate, SchedulerItemKind,
    };

    const SEED: &str = "abcdef0123456789abcdef0123456789";

    #[test]
    fn simultaneous_victory_defeat_and_escape_confirm_exactly_one_defeat() {
        let mut state = fixture();
        state.result_candidates = vec![
            candidate("escape", CombatResultType::Escape, 1),
            candidate("victory", CombatResultType::Victory, 2),
            candidate("defeat", CombatResultType::Defeat, 3),
        ];
        let before_rng = state.rng.clone();
        let before_revision = state.revision;

        let outcome = TerminalOutcomeArbitrator::confirm(&mut state).unwrap();

        assert_eq!(
            outcome,
            TerminalArbitrationOutcome::Confirmed {
                candidate: candidate("defeat", CombatResultType::Defeat, 3),
                newly_confirmed: true,
            }
        );
        assert_eq!(state.confirmed_result, Some(CombatResultType::Defeat));
        assert_eq!(
            state.confirmed_result_candidate_id.as_deref(),
            Some("defeat")
        );
        assert_eq!(state.revision, before_revision + 1);
        assert_eq!(state.rng, before_rng);
    }

    #[test]
    fn scripted_then_explicit_objective_priority_override_default_result_ranks() {
        let mut scripted_state = fixture();
        scripted_state.result_candidates = vec![
            objective_candidate("explicit-victory", CombatResultType::Victory, -50, 1),
            candidate("defeat", CombatResultType::Defeat, 2),
            candidate("scripted", CombatResultType::ScriptedVictory, 3),
        ];
        let scripted = TerminalOutcomeArbitrator::confirm(&mut scripted_state).unwrap();
        assert_eq!(confirmed_type(scripted), CombatResultType::ScriptedVictory);

        let mut explicit_state = fixture();
        explicit_state.result_candidates = vec![
            objective_candidate("explicit-low", CombatResultType::Escape, 10, 1),
            objective_candidate("explicit-high", CombatResultType::Victory, 20, 2),
            candidate("defeat", CombatResultType::Defeat, 3),
        ];
        let explicit = TerminalOutcomeArbitrator::confirm(&mut explicit_state).unwrap();
        assert_eq!(confirmed_id(explicit), "explicit-high");
        assert_eq!(
            explicit_state.confirmed_result,
            Some(CombatResultType::Victory)
        );
    }

    #[test]
    fn developer_policy_override_is_committed_input_and_replays_identically() {
        let mut state = fixture();
        state.terminal_priority_policy = TerminalPriorityPolicy {
            policy_id: "escape-first-v1".to_owned(),
            tiers: vec![
                TerminalPriorityTier::Escape,
                TerminalPriorityTier::Victory,
                TerminalPriorityTier::Defeat,
                TerminalPriorityTier::ExplicitObjectivePriority,
                TerminalPriorityTier::ScriptedOutcome,
            ],
        };
        state.result_candidates = vec![
            candidate("defeat", CombatResultType::Defeat, 1),
            candidate("escape", CombatResultType::Escape, 2),
            candidate("scripted", CombatResultType::ScriptedDefeat, 3),
        ];
        let mut replay = state.clone();

        let first = TerminalOutcomeArbitrator::confirm(&mut state).unwrap();
        let second = TerminalOutcomeArbitrator::confirm(&mut replay).unwrap();

        assert_eq!(confirmed_id(first), "escape");
        assert_eq!(state, replay);
        assert_eq!(confirmed_id(second), "escape");
    }

    #[test]
    fn stable_candidate_id_breaks_same_tier_ties_not_input_or_sequence_order() {
        let mut state = fixture();
        state.result_candidates = vec![
            candidate("z-defeat", CombatResultType::Defeat, 1),
            candidate("a-defeat", CombatResultType::Defeat, 2),
        ];

        let outcome = TerminalOutcomeArbitrator::confirm(&mut state).unwrap();

        assert_eq!(confirmed_id(outcome), "a-defeat");
    }

    #[test]
    fn active_event_chain_cannot_confirm_and_no_candidate_is_a_no_op() {
        let mut empty = fixture();
        let before = empty.clone();
        assert_eq!(
            TerminalOutcomeArbitrator::confirm(&mut empty).unwrap(),
            TerminalArbitrationOutcome::NoCandidate
        );
        assert_eq!(empty, before);

        let mut active = fixture();
        active.result_candidates = vec![candidate("victory", CombatResultType::Victory, 1)];
        CanonicalEventChainScheduler::begin(&mut active, "chain".to_owned(), 8, 32).unwrap();
        CanonicalEventChainScheduler::enqueue_roots(
            &mut active,
            vec![SchedulerCandidate {
                kind: SchedulerItemKind::Trigger,
                phase_priority: 1,
                explicit_priority: 0,
                source_stable_id: "system".to_owned(),
                effect_stable_id: "pending".to_owned(),
            }],
        )
        .unwrap();
        let active_before = active.clone();
        assert!(matches!(
            TerminalOutcomeArbitrator::confirm(&mut active),
            Err(TerminalArbitrationError {
                code: TerminalArbitrationErrorCode::NotQuiescent,
                ..
            })
        ));
        assert_eq!(active, active_before);
    }

    #[test]
    fn confirmation_is_exactly_once_and_tampering_fails_closed() {
        let mut state = fixture();
        state.result_candidates = vec![candidate("victory", CombatResultType::Victory, 1)];
        TerminalOutcomeArbitrator::confirm(&mut state).unwrap();
        let once = state.clone();

        let repeated = TerminalOutcomeArbitrator::confirm(&mut state).unwrap();

        assert!(matches!(
            repeated,
            TerminalArbitrationOutcome::Confirmed {
                newly_confirmed: false,
                ..
            }
        ));
        assert_eq!(state, once);

        let mut wrong_winner = once.clone();
        wrong_winner.result_candidates.push(candidate(
            "scripted",
            CombatResultType::ScriptedDefeat,
            2,
        ));
        assert!(matches!(
            TerminalOutcomeArbitrator::validate_state(&wrong_winner),
            Err(TerminalArbitrationError {
                code: TerminalArbitrationErrorCode::InvalidConfirmation,
                ..
            })
        ));

        let mut invalid_policy = fixture();
        invalid_policy.terminal_priority_policy.tiers[4] = TerminalPriorityTier::Victory;
        assert!(matches!(
            TerminalOutcomeArbitrator::validate_state(&invalid_policy),
            Err(TerminalArbitrationError {
                code: TerminalArbitrationErrorCode::InvalidPolicy,
                ..
            })
        ));

        let mut untrusted_priority = fixture();
        let mut forged = candidate("forged", CombatResultType::Escape, 1);
        forged.explicit_priority = Some(i32::MAX);
        untrusted_priority.result_candidates.push(forged);
        assert!(matches!(
            TerminalOutcomeArbitrator::validate_state(&untrusted_priority),
            Err(TerminalArbitrationError {
                code: TerminalArbitrationErrorCode::InvalidCandidate,
                ..
            })
        ));

        let mut forged_aborted = fixture();
        forged_aborted.confirmed_result = Some(CombatResultType::Aborted);
        assert!(matches!(
            TerminalOutcomeArbitrator::validate_state(&forged_aborted),
            Err(TerminalArbitrationError {
                code: TerminalArbitrationErrorCode::InvalidConfirmation,
                ..
            })
        ));
    }

    fn confirmed_type(outcome: TerminalArbitrationOutcome) -> CombatResultType {
        match outcome {
            TerminalArbitrationOutcome::Confirmed { candidate, .. } => candidate.result_type,
            TerminalArbitrationOutcome::NoCandidate => panic!("expected confirmed result"),
        }
    }

    fn confirmed_id(outcome: TerminalArbitrationOutcome) -> String {
        match outcome {
            TerminalArbitrationOutcome::Confirmed { candidate, .. } => candidate.candidate_id,
            TerminalArbitrationOutcome::NoCandidate => panic!("expected confirmed result"),
        }
    }

    fn objective_candidate(
        id: &str,
        result_type: CombatResultType,
        priority: i32,
        sequence: u64,
    ) -> ResultCandidate {
        ResultCandidate {
            explicit_priority: Some(priority),
            source_kind: "OBJECTIVE".to_owned(),
            ..candidate(id, result_type, sequence)
        }
    }

    fn candidate(id: &str, result_type: CombatResultType, sequence: u64) -> ResultCandidate {
        ResultCandidate {
            candidate_id: id.to_owned(),
            result_type,
            source_kind: "SYSTEM".to_owned(),
            source_id: format!("source-{id}"),
            explicit_priority: None,
            sequence,
        }
    }

    fn fixture() -> CombatState {
        CombatState {
            combat_instance_id: "combat-terminal-fixture".to_owned(),
            versions: CURRENT_COMBAT_VERSIONS,
            random_seed: SEED.to_owned(),
            revision: 1,
            last_committed_sequence: 0,
            phase: CombatPhase::BattleStart,
            combatants: vec![],
            combat_inventory: vec![],
            cost_reservations: vec![],
            resolution_context: None,
            timeline: vec![],
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
            terminal_priority_policy: TerminalPriorityPolicy::default(),
            confirmed_result_candidate_id: None,
            confirmed_result: None,
            rng: CombatRng::new(
                SEED,
                "combat-terminal-fixture",
                CURRENT_COMBAT_VERSIONS.rng_contract_version,
            )
            .unwrap()
            .snapshot(),
        }
    }
}

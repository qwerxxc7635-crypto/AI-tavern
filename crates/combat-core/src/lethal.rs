use std::{error::Error, fmt};

use serde::{Deserialize, Serialize};

use crate::{CombatState, CombatantRuntime, CombatantState, ProvisionalDeltaEntry};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PendingLethalOutcomeKind {
    Recovered,
    Downed,
    Defeated,
    PhaseTransition,
    Scripted,
}

/// A commit-pending lifecycle result. It is deliberately not serializable and is not an event.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PendingLethalOutcome {
    pub target_combatant_id: String,
    pub kind: PendingLethalOutcomeKind,
}

pub trait LethalOutcomeResolver {
    fn resolve(
        &self,
        working_state: &mut CombatState,
        target_combatant_id: &str,
    ) -> Result<PendingLethalOutcome, LethalResolutionError>;
}

pub struct LethalResolutionCore;

impl LethalResolutionCore {
    pub fn resolve_if_needed<R: LethalOutcomeResolver>(
        working_state: &mut CombatState,
        target_combatant_id: &str,
        resolver: &R,
    ) -> Result<Option<PendingLethalOutcome>, LethalResolutionError> {
        let target = find_target(working_state, target_combatant_id)?;
        if target.hit_points > 0 || target.state != CombatantState::Active {
            return Ok(None);
        }

        let outcome = resolver.resolve(working_state, target_combatant_id)?;
        if outcome.target_combatant_id != target_combatant_id {
            return Err(lethal_error(
                LethalResolutionErrorCode::InvalidPendingOutcome,
                &outcome.target_combatant_id,
            ));
        }
        validate_pending_outcome(working_state, &outcome)?;
        Ok(Some(outcome))
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum DirectHealthMutationOrigin {
    StatusTick,
    ReflectedDamage,
    OtherEffect,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HealthMutation {
    LoseHitPoints {
        amount: i64,
        origin: DirectHealthMutationOrigin,
    },
    SetMaximumHitPoints {
        new_maximum: i64,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HealthTransitionRequest {
    pub target_combatant_id: String,
    pub source_combatant_id: Option<String>,
    pub source_command_id: Option<String>,
    pub event_chain_id: String,
    pub mutation: HealthMutation,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TargetDefeatedFact {
    pub target_combatant_id: String,
    pub source_combatant_id: Option<String>,
    pub source_command_id: Option<String>,
    pub event_chain_id: String,
    pub committed_sequence: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum CommittedLethalEvent {
    TargetDefeated(TargetDefeatedFact),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HealthTransitionCommit {
    pub committed_state_revision: u64,
    pub committed_sequence: u64,
    pub pending_outcome: Option<PendingLethalOutcome>,
    pub committed_events: Vec<CommittedLethalEvent>,
}

pub struct AtomicHealthTransitionProcessor;

impl AtomicHealthTransitionProcessor {
    pub fn commit<R: LethalOutcomeResolver>(
        state: &mut CombatState,
        resolver: &R,
        request: HealthTransitionRequest,
    ) -> Result<HealthTransitionCommit, HealthTransitionError> {
        state.validate_for_commit().map_err(|_| {
            transition_error(HealthTransitionErrorCode::InvalidInitialState, "state")
        })?;
        validate_request(&request)?;

        let mut working = state.clone();
        let before = find_target(&working, &request.target_combatant_id)
            .map_err(map_lethal_error)?
            .clone();
        apply_mutation(&mut working, &request)?;
        let pending_outcome = LethalResolutionCore::resolve_if_needed(
            &mut working,
            &request.target_combatant_id,
            resolver,
        )
        .map_err(map_lethal_error)?;
        let after = find_target(&working, &request.target_combatant_id)
            .map_err(map_lethal_error)?
            .clone();

        append_health_delta(&mut working, &before, &after)?;
        let committed_sequence =
            working
                .last_committed_sequence
                .checked_add(1)
                .ok_or_else(|| {
                    transition_error(
                        HealthTransitionErrorCode::NumericOverflow,
                        "committedSequence",
                    )
                })?;
        working.last_committed_sequence = committed_sequence;
        working.revision = working.revision.checked_add(1).ok_or_else(|| {
            transition_error(HealthTransitionErrorCode::NumericOverflow, "stateRevision")
        })?;
        working.validate_for_commit().map_err(|_| {
            transition_error(HealthTransitionErrorCode::InvariantFailed, "workingState")
        })?;

        let committed_events = target_defeated_fact(
            &before,
            &after,
            pending_outcome.as_ref(),
            request.source_combatant_id.as_deref(),
            request.source_command_id.as_deref(),
            &request.event_chain_id,
            committed_sequence,
        )
        .into_iter()
        .map(CommittedLethalEvent::TargetDefeated)
        .collect();
        let committed_state_revision = working.revision;
        *state = working;

        Ok(HealthTransitionCommit {
            committed_state_revision,
            committed_sequence,
            pending_outcome,
            committed_events,
        })
    }
}

pub(crate) fn target_defeated_fact(
    before: &CombatantRuntime,
    after: &CombatantRuntime,
    pending_outcome: Option<&PendingLethalOutcome>,
    source_combatant_id: Option<&str>,
    source_command_id: Option<&str>,
    event_chain_id: &str,
    committed_sequence: u64,
) -> Option<TargetDefeatedFact> {
    (pending_outcome.is_some()
        && before.state != CombatantState::Defeated
        && after.state == CombatantState::Defeated)
        .then(|| TargetDefeatedFact {
            target_combatant_id: after.combatant_id.clone(),
            source_combatant_id: source_combatant_id.map(str::to_owned),
            source_command_id: source_command_id.map(str::to_owned),
            event_chain_id: event_chain_id.to_owned(),
            committed_sequence,
        })
}

fn apply_mutation(
    state: &mut CombatState,
    request: &HealthTransitionRequest,
) -> Result<(), HealthTransitionError> {
    let target = state
        .combatants
        .iter_mut()
        .find(|combatant| combatant.combatant_id == request.target_combatant_id)
        .ok_or_else(|| {
            transition_error(
                HealthTransitionErrorCode::TargetMissing,
                &request.target_combatant_id,
            )
        })?;
    match request.mutation {
        HealthMutation::LoseHitPoints { amount, .. } => {
            if amount < 0 {
                return Err(transition_error(
                    HealthTransitionErrorCode::InvalidMutation,
                    "hitPointLoss",
                ));
            }
            target.hit_points = target.hit_points.saturating_sub(amount).max(0);
        }
        HealthMutation::SetMaximumHitPoints { new_maximum } => {
            if new_maximum < 0 {
                return Err(transition_error(
                    HealthTransitionErrorCode::InvalidMutation,
                    "maximumHitPoints",
                ));
            }
            target.max_hit_points = new_maximum;
            target.hit_points = target.hit_points.min(new_maximum);
        }
    }
    Ok(())
}

pub(crate) fn append_health_delta(
    state: &mut CombatState,
    before: &CombatantRuntime,
    after: &CombatantRuntime,
) -> Result<(), HealthTransitionError> {
    for entry in [
        (before.max_hit_points != after.max_hit_points).then(|| {
            ProvisionalDeltaEntry::MaxHitPoints {
                combatant_id: before.combatant_id.clone(),
                before: before.max_hit_points,
                after: after.max_hit_points,
            }
        }),
        (before.hit_points != after.hit_points).then(|| ProvisionalDeltaEntry::HitPoints {
            combatant_id: before.combatant_id.clone(),
            before: before.hit_points,
            after: after.hit_points,
        }),
        (before.state != after.state).then(|| ProvisionalDeltaEntry::CombatantState {
            combatant_id: before.combatant_id.clone(),
            before: before.state,
            after: after.state,
        }),
        (before.solo_recovery_available != after.solo_recovery_available).then(|| {
            ProvisionalDeltaEntry::SoloRecoveryAvailable {
                combatant_id: before.combatant_id.clone(),
                before: before.solo_recovery_available,
                after: after.solo_recovery_available,
            }
        }),
    ]
    .into_iter()
    .flatten()
    {
        state.provisional_delta.entries.push(entry);
        state.provisional_delta.revision = state
            .provisional_delta
            .revision
            .checked_add(1)
            .ok_or_else(|| {
                transition_error(
                    HealthTransitionErrorCode::NumericOverflow,
                    "provisionalRevision",
                )
            })?;
    }
    Ok(())
}

fn validate_pending_outcome(
    state: &CombatState,
    outcome: &PendingLethalOutcome,
) -> Result<(), LethalResolutionError> {
    let target = find_target(state, &outcome.target_combatant_id)?;
    let valid = match outcome.kind {
        PendingLethalOutcomeKind::Recovered | PendingLethalOutcomeKind::PhaseTransition => {
            target.state == CombatantState::Active && target.hit_points > 0
        }
        PendingLethalOutcomeKind::Downed => {
            target.state == CombatantState::Downed && target.hit_points == 0
        }
        PendingLethalOutcomeKind::Defeated => {
            target.state == CombatantState::Defeated && target.hit_points == 0
        }
        PendingLethalOutcomeKind::Scripted => match target.state {
            CombatantState::Active => target.hit_points > 0,
            CombatantState::Downed | CombatantState::Defeated => target.hit_points == 0,
            CombatantState::Removed => true,
        },
    };
    if !valid {
        return Err(lethal_error(
            LethalResolutionErrorCode::InvalidPendingOutcome,
            &outcome.target_combatant_id,
        ));
    }
    Ok(())
}

fn find_target<'a>(
    state: &'a CombatState,
    target_combatant_id: &str,
) -> Result<&'a CombatantRuntime, LethalResolutionError> {
    state
        .combatants
        .iter()
        .find(|combatant| combatant.combatant_id == target_combatant_id)
        .ok_or_else(|| {
            lethal_error(
                LethalResolutionErrorCode::TargetMissing,
                target_combatant_id,
            )
        })
}

fn validate_request(request: &HealthTransitionRequest) -> Result<(), HealthTransitionError> {
    for value in [
        Some(request.target_combatant_id.as_str()),
        request.source_combatant_id.as_deref(),
        request.source_command_id.as_deref(),
        Some(request.event_chain_id.as_str()),
    ]
    .into_iter()
    .flatten()
    {
        validate_stable_id(value)
            .map_err(|()| transition_error(HealthTransitionErrorCode::InvalidStableId, value))?;
    }
    Ok(())
}

fn validate_stable_id(value: &str) -> Result<(), ()> {
    if value.is_empty()
        || value.len() > 128
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b':' | b'-'))
    {
        Err(())
    } else {
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LethalResolutionErrorCode {
    TargetMissing,
    ResolverFailed,
    InvalidPendingOutcome,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LethalResolutionError {
    pub code: LethalResolutionErrorCode,
    pub subject: String,
}

impl fmt::Display for LethalResolutionError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "lethal resolution failed for {}: {:?}",
            self.subject, self.code
        )
    }
}

impl Error for LethalResolutionError {}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HealthTransitionErrorCode {
    InvalidInitialState,
    InvalidStableId,
    InvalidMutation,
    TargetMissing,
    LethalResolutionFailed,
    InvariantFailed,
    NumericOverflow,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HealthTransitionError {
    pub code: HealthTransitionErrorCode,
    pub subject: String,
}

impl fmt::Display for HealthTransitionError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "health transition failed for {}: {:?}",
            self.subject, self.code
        )
    }
}

impl Error for HealthTransitionError {}

fn map_lethal_error(error: LethalResolutionError) -> HealthTransitionError {
    let code = match error.code {
        LethalResolutionErrorCode::TargetMissing => HealthTransitionErrorCode::TargetMissing,
        LethalResolutionErrorCode::ResolverFailed
        | LethalResolutionErrorCode::InvalidPendingOutcome => {
            HealthTransitionErrorCode::LethalResolutionFailed
        }
    };
    transition_error(code, error.subject)
}

pub fn lethal_error(
    code: LethalResolutionErrorCode,
    subject: impl Into<String>,
) -> LethalResolutionError {
    LethalResolutionError {
        code,
        subject: subject.into(),
    }
}

fn transition_error(
    code: HealthTransitionErrorCode,
    subject: impl Into<String>,
) -> HealthTransitionError {
    HealthTransitionError {
        code,
        subject: subject.into(),
    }
}

#[cfg(test)]
mod tests {
    use crate::{
        AbilityUsageState, CURRENT_COMBAT_VERSIONS, CombatPhase, CombatRng, CombatSide,
        CombatVersionSet, ObjectiveRuntimeState, ProvisionalRuntimeDelta,
        ReinforcementRuntimeState, RoundRuntimeState, TerminalPriorityPolicy,
    };

    use super::*;

    struct DefeatResolver;
    impl LethalOutcomeResolver for DefeatResolver {
        fn resolve(
            &self,
            working_state: &mut CombatState,
            target_combatant_id: &str,
        ) -> Result<PendingLethalOutcome, LethalResolutionError> {
            let target = working_state
                .combatants
                .iter_mut()
                .find(|combatant| combatant.combatant_id == target_combatant_id)
                .ok_or_else(|| {
                    lethal_error(
                        LethalResolutionErrorCode::TargetMissing,
                        target_combatant_id,
                    )
                })?;
            target.state = CombatantState::Defeated;
            Ok(PendingLethalOutcome {
                target_combatant_id: target_combatant_id.into(),
                kind: PendingLethalOutcomeKind::Defeated,
            })
        }
    }

    struct RecoverResolver;
    impl LethalOutcomeResolver for RecoverResolver {
        fn resolve(
            &self,
            working_state: &mut CombatState,
            target_combatant_id: &str,
        ) -> Result<PendingLethalOutcome, LethalResolutionError> {
            let target = working_state
                .combatants
                .iter_mut()
                .find(|combatant| combatant.combatant_id == target_combatant_id)
                .unwrap();
            target.hit_points = 3;
            Ok(PendingLethalOutcome {
                target_combatant_id: target_combatant_id.into(),
                kind: PendingLethalOutcomeKind::Recovered,
            })
        }
    }

    struct DownResolver;
    impl LethalOutcomeResolver for DownResolver {
        fn resolve(
            &self,
            working_state: &mut CombatState,
            target_combatant_id: &str,
        ) -> Result<PendingLethalOutcome, LethalResolutionError> {
            let target = working_state
                .combatants
                .iter_mut()
                .find(|combatant| combatant.combatant_id == target_combatant_id)
                .unwrap();
            target.state = CombatantState::Downed;
            Ok(PendingLethalOutcome {
                target_combatant_id: target_combatant_id.into(),
                kind: PendingLethalOutcomeKind::Downed,
            })
        }
    }

    struct InvalidResolver;
    impl LethalOutcomeResolver for InvalidResolver {
        fn resolve(
            &self,
            _working_state: &mut CombatState,
            target_combatant_id: &str,
        ) -> Result<PendingLethalOutcome, LethalResolutionError> {
            Ok(PendingLethalOutcome {
                target_combatant_id: target_combatant_id.into(),
                kind: PendingLethalOutcomeKind::Defeated,
            })
        }
    }

    #[test]
    fn status_tick_and_reflection_use_the_same_atomic_lethal_closure() {
        for origin in [
            DirectHealthMutationOrigin::StatusTick,
            DirectHealthMutationOrigin::ReflectedDamage,
        ] {
            let mut state = fixture(2, 10);
            let commit = AtomicHealthTransitionProcessor::commit(
                &mut state,
                &DefeatResolver,
                request(HealthMutation::LoseHitPoints { amount: 3, origin }),
            )
            .unwrap();

            assert_eq!(state.combatants[0].hit_points, 0);
            assert_eq!(state.combatants[0].state, CombatantState::Defeated);
            assert_eq!(state.last_committed_sequence, 1);
            assert!(matches!(
                commit.pending_outcome,
                Some(PendingLethalOutcome {
                    kind: PendingLethalOutcomeKind::Defeated,
                    ..
                })
            ));
            assert!(matches!(
                commit.committed_events.as_slice(),
                [CommittedLethalEvent::TargetDefeated(TargetDefeatedFact {
                    source_combatant_id: Some(source),
                    source_command_id: None,
                    event_chain_id,
                    committed_sequence: 1,
                    ..
                })] if source == "enemy" && event_chain_id == "chain-health"
            ));
        }
    }

    #[test]
    fn max_hp_reduction_clamps_current_then_resolves_before_commit() {
        let mut state = fixture(5, 10);
        let commit = AtomicHealthTransitionProcessor::commit(
            &mut state,
            &DefeatResolver,
            request(HealthMutation::SetMaximumHitPoints { new_maximum: 0 }),
        )
        .unwrap();

        assert_eq!(
            (
                state.combatants[0].max_hit_points,
                state.combatants[0].hit_points,
                state.combatants[0].state,
            ),
            (0, 0, CombatantState::Defeated)
        );
        assert_eq!(state.provisional_delta.revision, 3);
        assert!(matches!(
            state.provisional_delta.entries.as_slice(),
            [
                ProvisionalDeltaEntry::MaxHitPoints {
                    before: 10,
                    after: 0,
                    ..
                },
                ProvisionalDeltaEntry::HitPoints {
                    before: 5,
                    after: 0,
                    ..
                },
                ProvisionalDeltaEntry::CombatantState {
                    before: CombatantState::Active,
                    after: CombatantState::Defeated,
                    ..
                }
            ]
        ));
        assert_eq!(commit.committed_events.len(), 1);
    }

    #[test]
    fn recovered_and_downed_pending_outcomes_are_not_defeat_events() {
        let mut recovered = fixture(1, 10);
        let recovery = AtomicHealthTransitionProcessor::commit(
            &mut recovered,
            &RecoverResolver,
            request(HealthMutation::LoseHitPoints {
                amount: 1,
                origin: DirectHealthMutationOrigin::OtherEffect,
            }),
        )
        .unwrap();
        assert_eq!(recovered.combatants[0].state, CombatantState::Active);
        assert_eq!(recovered.combatants[0].hit_points, 3);
        assert!(recovery.committed_events.is_empty());

        let mut downed = fixture(1, 10);
        let down = AtomicHealthTransitionProcessor::commit(
            &mut downed,
            &DownResolver,
            request(HealthMutation::LoseHitPoints {
                amount: 1,
                origin: DirectHealthMutationOrigin::OtherEffect,
            }),
        )
        .unwrap();
        assert_eq!(downed.combatants[0].state, CombatantState::Downed);
        assert!(down.committed_events.is_empty());
    }

    #[test]
    fn invalid_pending_outcome_and_mutation_roll_back_without_committed_facts() {
        let original = fixture(1, 10);
        let mut invalid_outcome = original.clone();
        assert_eq!(
            AtomicHealthTransitionProcessor::commit(
                &mut invalid_outcome,
                &InvalidResolver,
                request(HealthMutation::LoseHitPoints {
                    amount: 1,
                    origin: DirectHealthMutationOrigin::StatusTick,
                }),
            )
            .unwrap_err()
            .code,
            HealthTransitionErrorCode::LethalResolutionFailed
        );
        assert_eq!(invalid_outcome, original);

        let mut invalid_mutation = original.clone();
        assert_eq!(
            AtomicHealthTransitionProcessor::commit(
                &mut invalid_mutation,
                &DefeatResolver,
                request(HealthMutation::LoseHitPoints {
                    amount: -1,
                    origin: DirectHealthMutationOrigin::ReflectedDamage,
                }),
            )
            .unwrap_err()
            .code,
            HealthTransitionErrorCode::InvalidMutation
        );
        assert_eq!(invalid_mutation, original);
    }

    fn request(mutation: HealthMutation) -> HealthTransitionRequest {
        HealthTransitionRequest {
            target_combatant_id: "hero".into(),
            source_combatant_id: Some("enemy".into()),
            source_command_id: None,
            event_chain_id: "chain-health".into(),
            mutation,
        }
    }

    fn fixture(hit_points: i64, max_hit_points: i64) -> CombatState {
        CombatState {
            combat_instance_id: "lethal-fixture".into(),
            versions: CombatVersionSet {
                ..CURRENT_COMBAT_VERSIONS
            },
            random_seed: "0123456789abcdef0123456789abcdef".into(),
            revision: 1,
            last_committed_sequence: 0,
            phase: CombatPhase::BattleStart,
            combatants: vec![CombatantRuntime {
                combatant_id: "hero".into(),
                definition_id: "definition-hero".into(),
                side: CombatSide::Player,
                state: CombatantState::Active,
                hit_points,
                max_hit_points,
                shield: 0,
                max_shield: 0,
                action_points: 3,
                max_action_points: 3,
                reaction_charges: 1,
                max_reaction_charges: 1,
                resources: vec![],
                statuses: vec![],
                ability_usage: vec![AbilityUsageState {
                    ability_id: "ability-a".into(),
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
            }],
            formal_party_member_ids: vec![],
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
            enemy_intents: vec![],
            result_candidates: vec![],
            terminal_priority_policy: TerminalPriorityPolicy::default(),
            confirmed_result_candidate_id: None,
            confirmed_result: None,
            rng: CombatRng::new(
                "0123456789abcdef0123456789abcdef",
                "lethal-fixture",
                CURRENT_COMBAT_VERSIONS.rng_contract_version,
            )
            .unwrap()
            .snapshot(),
        }
    }
}

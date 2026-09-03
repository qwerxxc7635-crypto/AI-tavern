use std::{error::Error, fmt};

use serde::{Deserialize, Serialize};

use crate::{
    COMBAT_FIXED_SCALE, CombatFixed, CombatNumeric, CombatResultType, CombatSide, CombatState,
    CombatantState, LethalOutcomeResolver, LethalResolutionError, LethalResolutionErrorCode,
    PendingLethalOutcome, PendingLethalOutcomeKind, ResolvedEffect, ResultCandidate, lethal_error,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CombatPartyMode {
    Solo,
    Party,
}

pub struct CombatPartyPolicy;

impl CombatPartyPolicy {
    pub fn initialize(
        state: &mut CombatState,
        mut deployed_formal_party_member_ids: Vec<String>,
    ) -> Result<CombatPartyMode, RecoveryRuleError> {
        state
            .validate_for_commit()
            .map_err(|_| recovery_error(RecoveryRuleErrorCode::InvalidInitialState, "state"))?;
        if !state.formal_party_member_ids.is_empty() {
            return Err(recovery_error(
                RecoveryRuleErrorCode::PartyModeAlreadyLocked,
                "formalPartyMemberIds",
            ));
        }
        deployed_formal_party_member_ids.sort();
        if deployed_formal_party_member_ids.is_empty()
            || deployed_formal_party_member_ids
                .windows(2)
                .any(|pair| pair[0] == pair[1])
        {
            return Err(recovery_error(
                RecoveryRuleErrorCode::InvalidFormalParty,
                "formalPartyMemberIds",
            ));
        }
        for member_id in &deployed_formal_party_member_ids {
            let member = state
                .combatants
                .iter()
                .find(|combatant| combatant.combatant_id == *member_id)
                .ok_or_else(|| {
                    recovery_error(RecoveryRuleErrorCode::InvalidFormalParty, member_id)
                })?;
            if member.state != CombatantState::Active
                || !matches!(member.side, CombatSide::Player | CombatSide::Companion)
            {
                return Err(recovery_error(
                    RecoveryRuleErrorCode::InvalidFormalParty,
                    member_id,
                ));
            }
        }

        let mode = if deployed_formal_party_member_ids.len() == 1 {
            CombatPartyMode::Solo
        } else {
            CombatPartyMode::Party
        };
        for combatant in &mut state.combatants {
            combatant.solo_recovery_available = mode == CombatPartyMode::Solo
                && combatant.combatant_id == deployed_formal_party_member_ids[0];
        }
        state.formal_party_member_ids = deployed_formal_party_member_ids;
        state.validate_for_commit().map_err(|_| {
            recovery_error(RecoveryRuleErrorCode::InvalidFormalParty, "combatState")
        })?;
        Ok(mode)
    }

    pub fn mode(state: &CombatState) -> Result<CombatPartyMode, RecoveryRuleError> {
        match state.formal_party_member_ids.len() {
            1 => Ok(CombatPartyMode::Solo),
            count if count > 1 => Ok(CombatPartyMode::Party),
            _ => Err(recovery_error(
                RecoveryRuleErrorCode::PartyModeNotInitialized,
                "formalPartyMemberIds",
            )),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SoloRecoveryBalanceConfig {
    pub restore_hp_percent: CombatFixed,
}

impl Default for SoloRecoveryBalanceConfig {
    fn default() -> Self {
        Self {
            restore_hp_percent: CombatFixed::from_scaled(300_000),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ExecutableRecoveryPath {
    Available,
    Unavailable,
}

pub struct StandardLethalPolicy {
    pub solo_recovery: SoloRecoveryBalanceConfig,
    pub executable_recovery_path: ExecutableRecoveryPath,
}

impl LethalOutcomeResolver for StandardLethalPolicy {
    fn resolve(
        &self,
        working_state: &mut CombatState,
        target_combatant_id: &str,
    ) -> Result<PendingLethalOutcome, LethalResolutionError> {
        validate_solo_balance(self.solo_recovery).map_err(|error| {
            lethal_error(
                LethalResolutionErrorCode::ResolverFailed,
                format!("{}:{:?}", error.subject, error.code),
            )
        })?;
        let target_index = working_state
            .combatants
            .iter()
            .position(|combatant| combatant.combatant_id == target_combatant_id)
            .ok_or_else(|| {
                lethal_error(
                    LethalResolutionErrorCode::TargetMissing,
                    target_combatant_id,
                )
            })?;
        let is_formal_member = working_state
            .formal_party_member_ids
            .binary_search_by(|id| id.as_str().cmp(target_combatant_id))
            .is_ok();

        if !is_formal_member {
            working_state.combatants[target_index].state = CombatantState::Defeated;
            return Ok(pending(
                target_combatant_id,
                PendingLethalOutcomeKind::Defeated,
            ));
        }

        let mode = CombatPartyPolicy::mode(working_state).map_err(|error| {
            lethal_error(
                LethalResolutionErrorCode::ResolverFailed,
                format!("{}:{:?}", error.subject, error.code),
            )
        })?;
        match mode {
            CombatPartyMode::Solo => {
                let target = &mut working_state.combatants[target_index];
                if target.solo_recovery_available {
                    let restored = CombatNumeric::percent_restore_at_least_one(
                        target.max_hit_points,
                        self.solo_recovery.restore_hp_percent,
                    )
                    .map_err(|error| {
                        lethal_error(LethalResolutionErrorCode::ResolverFailed, error.operation)
                    })?;
                    target.hit_points = restored.min(target.max_hit_points);
                    target.state = CombatantState::Active;
                    target.solo_recovery_available = false;
                    Ok(pending(
                        target_combatant_id,
                        PendingLethalOutcomeKind::Recovered,
                    ))
                } else {
                    target.state = CombatantState::Defeated;
                    append_defeat_candidate(working_state, target_combatant_id)?;
                    Ok(pending(
                        target_combatant_id,
                        PendingLethalOutcomeKind::Defeated,
                    ))
                }
            }
            CombatPartyMode::Party => {
                working_state.combatants[target_index].state = CombatantState::Downed;
                let another_active =
                    working_state
                        .formal_party_member_ids
                        .iter()
                        .any(|member_id| {
                            member_id != target_combatant_id
                                && working_state.combatants.iter().any(|combatant| {
                                    combatant.combatant_id == *member_id
                                        && combatant.state == CombatantState::Active
                                })
                        });
                if !another_active
                    && self.executable_recovery_path == ExecutableRecoveryPath::Unavailable
                {
                    append_defeat_candidate(working_state, target_combatant_id)?;
                }
                Ok(pending(
                    target_combatant_id,
                    PendingLethalOutcomeKind::Downed,
                ))
            }
        }
    }
}

fn append_defeat_candidate(
    state: &mut CombatState,
    target_combatant_id: &str,
) -> Result<(), LethalResolutionError> {
    let sequence = state
        .last_committed_sequence
        .checked_add(1)
        .ok_or_else(|| {
            lethal_error(
                LethalResolutionErrorCode::ResolverFailed,
                "defeatCandidateSequence",
            )
        })?;
    let candidate_id = format!("lethal-defeat:{target_combatant_id}:{sequence}");
    if state
        .result_candidates
        .iter()
        .any(|candidate| candidate.candidate_id == candidate_id)
    {
        return Err(lethal_error(
            LethalResolutionErrorCode::ResolverFailed,
            candidate_id,
        ));
    }
    state.result_candidates.push(ResultCandidate {
        candidate_id,
        result_type: CombatResultType::Defeat,
        source_kind: "LETHAL_RESOLUTION".into(),
        source_id: target_combatant_id.into(),
        explicit_priority: None,
        sequence,
    });
    Ok(())
}

fn pending(target_combatant_id: &str, kind: PendingLethalOutcomeKind) -> PendingLethalOutcome {
    PendingLethalOutcome {
        target_combatant_id: target_combatant_id.into(),
        kind,
    }
}

fn validate_solo_balance(balance: SoloRecoveryBalanceConfig) -> Result<(), RecoveryRuleError> {
    if !(1..=COMBAT_FIXED_SCALE).contains(&balance.restore_hp_percent.scaled()) {
        return Err(recovery_error(
            RecoveryRuleErrorCode::InvalidBalanceConfig,
            "restoreHpPercent",
        ));
    }
    Ok(())
}

pub trait ReviveFollowupApplier {
    fn apply(
        &self,
        working_state: &mut CombatState,
        target_combatant_id: &str,
        remove_tag_ids: &[String],
        apply_status_ids: &[String],
    ) -> Result<(), RecoveryRuleError>;
}

pub struct NoReviveFollowups;

impl ReviveFollowupApplier for NoReviveFollowups {
    fn apply(
        &self,
        _working_state: &mut CombatState,
        target_combatant_id: &str,
        remove_tag_ids: &[String],
        apply_status_ids: &[String],
    ) -> Result<(), RecoveryRuleError> {
        if !remove_tag_ids.is_empty() || !apply_status_ids.is_empty() {
            return Err(recovery_error(
                RecoveryRuleErrorCode::FollowupFailed,
                target_combatant_id,
            ));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RecoveryEffectRequest {
    pub target_combatant_id: String,
    pub source_combatant_id: Option<String>,
    pub source_command_id: Option<String>,
    pub event_chain_id: String,
    pub effect: ResolvedEffect,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum CommittedRecoveryEvent {
    HealApplied {
        target_combatant_id: String,
        hp_before: i64,
        hp_after: i64,
        committed_sequence: u64,
    },
    ReviveApplied {
        target_combatant_id: String,
        source_combatant_id: Option<String>,
        source_command_id: Option<String>,
        event_chain_id: String,
        hp_after: i64,
        remove_tag_ids: Vec<String>,
        apply_status_ids: Vec<String>,
        committed_sequence: u64,
    },
    StateTransition {
        target_combatant_id: String,
        from: CombatantState,
        to: CombatantState,
        committed_sequence: u64,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RecoveryEffectCommit {
    pub committed_state_revision: u64,
    pub committed_sequence: u64,
    pub committed_events: Vec<CommittedRecoveryEvent>,
}

pub struct RecoveryEffectProcessor;

impl RecoveryEffectProcessor {
    pub fn commit<F: ReviveFollowupApplier>(
        state: &mut CombatState,
        request: RecoveryEffectRequest,
        followups: &F,
    ) -> Result<RecoveryEffectCommit, RecoveryRuleError> {
        state
            .validate_for_commit()
            .map_err(|_| recovery_error(RecoveryRuleErrorCode::InvalidInitialState, "state"))?;
        validate_recovery_request(&request)?;
        let mut working = state.clone();
        let before = working
            .combatants
            .iter()
            .find(|combatant| combatant.combatant_id == request.target_combatant_id)
            .cloned()
            .ok_or_else(|| {
                recovery_error(
                    RecoveryRuleErrorCode::TargetMissing,
                    &request.target_combatant_id,
                )
            })?;

        let event_payload = {
            let target = working
                .combatants
                .iter_mut()
                .find(|combatant| combatant.combatant_id == request.target_combatant_id)
                .expect("target existence established above");
            match &request.effect {
                ResolvedEffect::Heal { amount } => {
                    if target.state != CombatantState::Active || *amount < 0 {
                        return Err(recovery_error(
                            RecoveryRuleErrorCode::IllegalHealTarget,
                            &request.target_combatant_id,
                        ));
                    }
                    target.hit_points = target
                        .hit_points
                        .checked_add(*amount)
                        .ok_or_else(|| {
                            recovery_error(RecoveryRuleErrorCode::NumericOverflow, "heal")
                        })?
                        .min(target.max_hit_points);
                    RecoveryEventPayload::Heal
                }
                ResolvedEffect::Revive {
                    restore_hp_amount,
                    remove_tag_ids,
                    apply_status_ids,
                } => {
                    if target.state != CombatantState::Downed
                        || target.hit_points != 0
                        || target.max_hit_points <= 0
                        || *restore_hp_amount <= 0
                    {
                        return Err(recovery_error(
                            RecoveryRuleErrorCode::IllegalReviveTarget,
                            &request.target_combatant_id,
                        ));
                    }
                    target.hit_points = (*restore_hp_amount).min(target.max_hit_points);
                    target.state = CombatantState::Active;
                    RecoveryEventPayload::Revive {
                        remove_tag_ids: remove_tag_ids.clone(),
                        apply_status_ids: apply_status_ids.clone(),
                    }
                }
                _ => {
                    return Err(recovery_error(
                        RecoveryRuleErrorCode::UnsupportedEffect,
                        &request.target_combatant_id,
                    ));
                }
            }
        };

        if let RecoveryEventPayload::Revive {
            remove_tag_ids,
            apply_status_ids,
        } = &event_payload
        {
            followups.apply(
                &mut working,
                &request.target_combatant_id,
                remove_tag_ids,
                apply_status_ids,
            )?;
        }
        let after = working
            .combatants
            .iter()
            .find(|combatant| combatant.combatant_id == request.target_combatant_id)
            .cloned()
            .ok_or_else(|| {
                recovery_error(
                    RecoveryRuleErrorCode::TargetMissing,
                    &request.target_combatant_id,
                )
            })?;
        crate::lethal::append_health_delta(&mut working, &before, &after).map_err(|error| {
            recovery_error(RecoveryRuleErrorCode::NumericOverflow, error.subject)
        })?;
        let committed_sequence =
            working
                .last_committed_sequence
                .checked_add(1)
                .ok_or_else(|| {
                    recovery_error(RecoveryRuleErrorCode::NumericOverflow, "committedSequence")
                })?;
        working.last_committed_sequence = committed_sequence;
        working.revision = working.revision.checked_add(1).ok_or_else(|| {
            recovery_error(RecoveryRuleErrorCode::NumericOverflow, "stateRevision")
        })?;
        working
            .validate_for_commit()
            .map_err(|_| recovery_error(RecoveryRuleErrorCode::InvariantFailed, "workingState"))?;

        let committed_events = match event_payload {
            RecoveryEventPayload::Heal => vec![CommittedRecoveryEvent::HealApplied {
                target_combatant_id: request.target_combatant_id,
                hp_before: before.hit_points,
                hp_after: after.hit_points,
                committed_sequence,
            }],
            RecoveryEventPayload::Revive {
                remove_tag_ids,
                apply_status_ids,
            } => vec![
                CommittedRecoveryEvent::ReviveApplied {
                    target_combatant_id: request.target_combatant_id.clone(),
                    source_combatant_id: request.source_combatant_id,
                    source_command_id: request.source_command_id,
                    event_chain_id: request.event_chain_id,
                    hp_after: after.hit_points,
                    remove_tag_ids,
                    apply_status_ids,
                    committed_sequence,
                },
                CommittedRecoveryEvent::StateTransition {
                    target_combatant_id: request.target_combatant_id,
                    from: before.state,
                    to: after.state,
                    committed_sequence,
                },
            ],
        };
        let committed_state_revision = working.revision;
        *state = working;
        Ok(RecoveryEffectCommit {
            committed_state_revision,
            committed_sequence,
            committed_events,
        })
    }
}

enum RecoveryEventPayload {
    Heal,
    Revive {
        remove_tag_ids: Vec<String>,
        apply_status_ids: Vec<String>,
    },
}

fn validate_recovery_request(request: &RecoveryEffectRequest) -> Result<(), RecoveryRuleError> {
    for value in [
        Some(request.target_combatant_id.as_str()),
        request.source_combatant_id.as_deref(),
        request.source_command_id.as_deref(),
        Some(request.event_chain_id.as_str()),
    ]
    .into_iter()
    .flatten()
    {
        if value.is_empty()
            || value.len() > 128
            || !value.bytes().all(|byte| {
                byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b':' | b'-')
            })
        {
            return Err(recovery_error(
                RecoveryRuleErrorCode::InvalidStableId,
                value,
            ));
        }
    }
    Ok(())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RecoveryRuleErrorCode {
    InvalidInitialState,
    PartyModeAlreadyLocked,
    PartyModeNotInitialized,
    InvalidFormalParty,
    InvalidBalanceConfig,
    InvalidStableId,
    TargetMissing,
    IllegalHealTarget,
    IllegalReviveTarget,
    UnsupportedEffect,
    FollowupFailed,
    InvariantFailed,
    NumericOverflow,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RecoveryRuleError {
    pub code: RecoveryRuleErrorCode,
    pub subject: String,
}

impl fmt::Display for RecoveryRuleError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "recovery rule failed for {}: {:?}",
            self.subject, self.code
        )
    }
}

impl Error for RecoveryRuleError {}

fn recovery_error(code: RecoveryRuleErrorCode, subject: impl Into<String>) -> RecoveryRuleError {
    RecoveryRuleError {
        code,
        subject: subject.into(),
    }
}

#[cfg(test)]
mod tests {
    use crate::{
        AbilityUsageState, AtomicHealthTransitionProcessor, CURRENT_COMBAT_VERSIONS, CombatPhase,
        CombatRng, CombatVersionSet, CommittedLethalEvent, DirectHealthMutationOrigin,
        HealthMutation, HealthTransitionRequest, ObjectiveRuntimeState, ProvisionalRuntimeDelta,
        ReinforcementRuntimeState, ResourceState, RoundRuntimeState, TerminalPriorityPolicy,
    };

    use super::*;

    #[test]
    fn combat_start_locks_mode_from_formal_members_and_ignores_summons() {
        let mut solo = fixture();
        assert_eq!(
            CombatPartyPolicy::initialize(&mut solo, vec!["hero".into()]).unwrap(),
            CombatPartyMode::Solo
        );
        assert_eq!(solo.formal_party_member_ids, ["hero"]);
        assert!(combatant(&solo, "hero").solo_recovery_available);
        assert!(!combatant(&solo, "drone").solo_recovery_available);
        assert_eq!(
            CombatPartyPolicy::initialize(&mut solo, vec!["hero".into()])
                .unwrap_err()
                .code,
            RecoveryRuleErrorCode::PartyModeAlreadyLocked
        );

        let mut party = fixture();
        assert_eq!(
            CombatPartyPolicy::initialize(&mut party, vec!["companion".into(), "hero".into()],)
                .unwrap(),
            CombatPartyMode::Party
        );
        assert_eq!(party.formal_party_member_ids, ["companion", "hero"]);
        assert!(
            party
                .combatants
                .iter()
                .all(|combatant| !combatant.solo_recovery_available)
        );
    }

    #[test]
    fn solo_first_lethal_restores_tunable_percent_once_without_side_bonuses() {
        let mut state = fixture();
        CombatPartyPolicy::initialize(&mut state, vec!["hero".into()]).unwrap();
        let before_ap = combatant(&state, "hero").action_points;
        let before_mana = combatant(&state, "hero").resources[0].current;
        assert_eq!(
            SoloRecoveryBalanceConfig::default()
                .restore_hp_percent
                .scaled(),
            300_000
        );
        let tuned_policy = StandardLethalPolicy {
            solo_recovery: SoloRecoveryBalanceConfig {
                restore_hp_percent: CombatFixed::from_scaled(400_000),
            },
            executable_recovery_path: ExecutableRecoveryPath::Unavailable,
        };
        let commit = AtomicHealthTransitionProcessor::commit(
            &mut state,
            &tuned_policy,
            lethal_request("hero", 10),
        )
        .unwrap();

        let hero = combatant(&state, "hero");
        assert_eq!((hero.hit_points, hero.state), (4, CombatantState::Active));
        assert!(!hero.solo_recovery_available);
        assert_eq!(hero.action_points, before_ap);
        assert_eq!(hero.resources[0].current, before_mana);
        assert!(state.result_candidates.is_empty());
        assert!(commit.committed_events.is_empty());
        assert!(matches!(
            commit.pending_outcome,
            Some(PendingLethalOutcome {
                kind: PendingLethalOutcomeKind::Recovered,
                ..
            })
        ));
        assert!(state.provisional_delta.entries.iter().any(|entry| matches!(
            entry,
            crate::ProvisionalDeltaEntry::SoloRecoveryAvailable {
                before: true,
                after: false,
                ..
            }
        )));
    }

    #[test]
    fn solo_second_lethal_defeats_and_adds_candidate_in_same_commit() {
        let mut state = fixture();
        CombatPartyPolicy::initialize(&mut state, vec!["hero".into()]).unwrap();
        let policy = standard_policy(ExecutableRecoveryPath::Unavailable);
        AtomicHealthTransitionProcessor::commit(&mut state, &policy, lethal_request("hero", 10))
            .unwrap();
        let second =
            AtomicHealthTransitionProcessor::commit(&mut state, &policy, lethal_request("hero", 3))
                .unwrap();

        assert_eq!(combatant(&state, "hero").state, CombatantState::Defeated);
        assert!(matches!(
            state.result_candidates.as_slice(),
            [ResultCandidate {
                result_type: CombatResultType::Defeat,
                source_kind,
                source_id,
                sequence: 2,
                ..
            }] if source_kind == "LETHAL_RESOLUTION" && source_id == "hero"
        ));
        assert!(matches!(
            second.committed_events.as_slice(),
            [CommittedLethalEvent::TargetDefeated(fact)]
                if fact.target_combatant_id == "hero" && fact.committed_sequence == 2
        ));
    }

    #[test]
    fn party_downed_continues_with_active_member_or_executable_recovery_path() {
        let mut state = fixture();
        CombatPartyPolicy::initialize(&mut state, vec!["hero".into(), "companion".into()]).unwrap();
        let unavailable = standard_policy(ExecutableRecoveryPath::Unavailable);
        let hero_down = AtomicHealthTransitionProcessor::commit(
            &mut state,
            &unavailable,
            lethal_request("hero", 10),
        )
        .unwrap();
        assert_eq!(combatant(&state, "hero").state, CombatantState::Downed);
        assert!(state.result_candidates.is_empty());
        assert!(hero_down.committed_events.is_empty());

        AtomicHealthTransitionProcessor::commit(
            &mut state,
            &unavailable,
            lethal_request("companion", 10),
        )
        .unwrap();
        assert_eq!(combatant(&state, "companion").state, CombatantState::Downed);
        assert_eq!(state.result_candidates.len(), 1);
        assert_eq!(
            state.result_candidates[0].result_type,
            CombatResultType::Defeat
        );

        let mut recoverable = fixture();
        CombatPartyPolicy::initialize(&mut recoverable, vec!["hero".into(), "companion".into()])
            .unwrap();
        recoverable.combatants[1].hit_points = 0;
        recoverable.combatants[1].state = CombatantState::Downed;
        AtomicHealthTransitionProcessor::commit(
            &mut recoverable,
            &standard_policy(ExecutableRecoveryPath::Available),
            lethal_request("hero", 10),
        )
        .unwrap();
        assert!(recoverable.result_candidates.is_empty());
    }

    #[test]
    fn heal_cannot_raise_downed_and_revive_is_atomic_and_target_specific() {
        let mut downed = fixture();
        CombatPartyPolicy::initialize(&mut downed, vec!["hero".into(), "companion".into()])
            .unwrap();
        downed.combatants[0].hit_points = 0;
        downed.combatants[0].state = CombatantState::Downed;
        let original = downed.clone();

        let heal_error = RecoveryEffectProcessor::commit(
            &mut downed,
            recovery_request(ResolvedEffect::Heal { amount: 5 }),
            &NoReviveFollowups,
        )
        .unwrap_err();
        assert_eq!(heal_error.code, RecoveryRuleErrorCode::IllegalHealTarget);
        assert_eq!(downed, original);

        let revive = RecoveryEffectProcessor::commit(
            &mut downed,
            recovery_request(ResolvedEffect::Revive {
                restore_hp_amount: 50,
                remove_tag_ids: vec![],
                apply_status_ids: vec![],
            }),
            &NoReviveFollowups,
        )
        .unwrap();
        assert_eq!(
            (
                combatant(&downed, "hero").hit_points,
                combatant(&downed, "hero").state
            ),
            (10, CombatantState::Active)
        );
        assert!(matches!(
            revive.committed_events.as_slice(),
            [
                CommittedRecoveryEvent::ReviveApplied { hp_after: 10, .. },
                CommittedRecoveryEvent::StateTransition {
                    from: CombatantState::Downed,
                    to: CombatantState::Active,
                    ..
                }
            ]
        ));

        let after_revive = downed.clone();
        assert_eq!(
            RecoveryEffectProcessor::commit(
                &mut downed,
                recovery_request(ResolvedEffect::Revive {
                    restore_hp_amount: 1,
                    remove_tag_ids: vec![],
                    apply_status_ids: vec![],
                }),
                &NoReviveFollowups,
            )
            .unwrap_err()
            .code,
            RecoveryRuleErrorCode::IllegalReviveTarget
        );
        assert_eq!(downed, after_revive);
    }

    #[test]
    fn revive_followups_fail_closed_in_the_same_working_state() {
        let mut state = fixture();
        state.combatants[0].hit_points = 0;
        state.combatants[0].state = CombatantState::Downed;
        let original = state.clone();
        let error = RecoveryEffectProcessor::commit(
            &mut state,
            recovery_request(ResolvedEffect::Revive {
                restore_hp_amount: 4,
                remove_tag_ids: vec!["tag.poisoned".into()],
                apply_status_ids: vec![],
            }),
            &NoReviveFollowups,
        )
        .unwrap_err();
        assert_eq!(error.code, RecoveryRuleErrorCode::FollowupFailed);
        assert_eq!(state, original);
    }

    #[test]
    fn revive_runs_optional_followups_after_built_in_state_transition_before_commit() {
        use std::cell::RefCell;

        struct RecordingFollowups(RefCell<Vec<String>>);
        impl ReviveFollowupApplier for RecordingFollowups {
            fn apply(
                &self,
                working_state: &mut CombatState,
                target_combatant_id: &str,
                remove_tag_ids: &[String],
                apply_status_ids: &[String],
            ) -> Result<(), RecoveryRuleError> {
                let target = combatant(working_state, target_combatant_id);
                assert_eq!(
                    (target.hit_points, target.state),
                    (4, CombatantState::Active)
                );
                self.0
                    .borrow_mut()
                    .extend(remove_tag_ids.iter().chain(apply_status_ids).cloned());
                Ok(())
            }
        }

        let mut state = fixture();
        state.combatants[0].hit_points = 0;
        state.combatants[0].state = CombatantState::Downed;
        let followups = RecordingFollowups(RefCell::new(vec![]));
        let commit = RecoveryEffectProcessor::commit(
            &mut state,
            recovery_request(ResolvedEffect::Revive {
                restore_hp_amount: 4,
                remove_tag_ids: vec!["tag.poisoned".into()],
                apply_status_ids: vec!["status.recovery-fatigue".into()],
            }),
            &followups,
        )
        .unwrap();

        assert_eq!(
            *followups.0.borrow(),
            ["tag.poisoned", "status.recovery-fatigue"]
        );
        assert!(matches!(
            commit.committed_events[0],
            CommittedRecoveryEvent::ReviveApplied { .. }
        ));
    }

    fn standard_policy(path: ExecutableRecoveryPath) -> StandardLethalPolicy {
        StandardLethalPolicy {
            solo_recovery: SoloRecoveryBalanceConfig::default(),
            executable_recovery_path: path,
        }
    }

    fn lethal_request(target: &str, amount: i64) -> HealthTransitionRequest {
        HealthTransitionRequest {
            target_combatant_id: target.into(),
            source_combatant_id: Some("enemy".into()),
            source_command_id: Some("command-hit".into()),
            event_chain_id: "chain-lethal".into(),
            mutation: HealthMutation::LoseHitPoints {
                amount,
                origin: DirectHealthMutationOrigin::OtherEffect,
            },
        }
    }

    fn recovery_request(effect: ResolvedEffect) -> RecoveryEffectRequest {
        RecoveryEffectRequest {
            target_combatant_id: "hero".into(),
            source_combatant_id: Some("companion".into()),
            source_command_id: Some("command-revive".into()),
            event_chain_id: "chain-revive".into(),
            effect,
        }
    }

    fn combatant<'a>(state: &'a CombatState, id: &str) -> &'a crate::CombatantRuntime {
        state
            .combatants
            .iter()
            .find(|combatant| combatant.combatant_id == id)
            .unwrap()
    }

    fn fixture() -> CombatState {
        CombatState {
            combat_instance_id: "recovery-fixture".into(),
            versions: CombatVersionSet {
                ..CURRENT_COMBAT_VERSIONS
            },
            random_seed: "0123456789abcdef0123456789abcdef".into(),
            revision: 1,
            last_committed_sequence: 0,
            phase: CombatPhase::BattleStart,
            combatants: vec![
                runtime("hero", CombatSide::Player),
                runtime("companion", CombatSide::Companion),
                runtime("enemy", CombatSide::Hostile),
                runtime("drone", CombatSide::Companion),
            ],
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
            result_candidates: vec![],
            terminal_priority_policy: TerminalPriorityPolicy::default(),
            confirmed_result_candidate_id: None,
            confirmed_result: None,
            rng: CombatRng::new(
                "0123456789abcdef0123456789abcdef",
                "recovery-fixture",
                CURRENT_COMBAT_VERSIONS.rng_contract_version,
            )
            .unwrap()
            .snapshot(),
        }
    }

    fn runtime(id: &str, side: CombatSide) -> crate::CombatantRuntime {
        crate::CombatantRuntime {
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
            resources: vec![ResourceState {
                resource_id: "mana".into(),
                current: 5,
                min_value: 0,
                max_value: 5,
                overheat_threshold: None,
                hard_max_value: None,
            }],
            statuses: vec![],
            ability_usage: vec![AbilityUsageState {
                ability_id: "ability-a".into(),
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
        }
    }
}

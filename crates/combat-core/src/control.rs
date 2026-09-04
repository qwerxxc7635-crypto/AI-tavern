use std::{error::Error, fmt};

use crate::{
    COMBAT_FIXED_SCALE, CombatFixed, CombatNumeric, ControlCategory, GameplayTagId,
    HardCcDrRuntime, StatusDefinition, StatusMergeOutcome,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ControlTargetTier {
    Normal,
    Elite,
    Boss,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ControlBalanceConfig {
    pub normal_duration_multiplier: CombatFixed,
    pub elite_duration_multiplier: CombatFixed,
    pub boss_duration_multiplier: CombatFixed,
    pub hard_cc_dr_multipliers: [CombatFixed; 3],
}

impl Default for ControlBalanceConfig {
    fn default() -> Self {
        Self {
            normal_duration_multiplier: CombatFixed::from_scaled(COMBAT_FIXED_SCALE),
            elite_duration_multiplier: CombatFixed::from_scaled(750_000),
            boss_duration_multiplier: CombatFixed::from_scaled(500_000),
            hard_cc_dr_multipliers: [
                CombatFixed::from_scaled(COMBAT_FIXED_SCALE),
                CombatFixed::from_scaled(500_000),
                CombatFixed::from_scaled(250_000),
            ],
        }
    }
}

impl ControlBalanceConfig {
    pub fn validate(self) -> Result<Self, ControlError> {
        for (subject, multiplier) in [
            ("normalDurationMultiplier", self.normal_duration_multiplier),
            ("eliteDurationMultiplier", self.elite_duration_multiplier),
            ("bossDurationMultiplier", self.boss_duration_multiplier),
            ("hardCcDrLevel0", self.hard_cc_dr_multipliers[0]),
            ("hardCcDrLevel1", self.hard_cc_dr_multipliers[1]),
            ("hardCcDrLevel2", self.hard_cc_dr_multipliers[2]),
        ] {
            if multiplier.scaled() <= 0 {
                return Err(control_error(
                    ControlErrorCode::InvalidBalanceConfig,
                    subject,
                ));
            }
        }
        if self.hard_cc_dr_multipliers[0] < self.hard_cc_dr_multipliers[1]
            || self.hard_cc_dr_multipliers[1] < self.hard_cc_dr_multipliers[2]
        {
            return Err(control_error(
                ControlErrorCode::InvalidBalanceConfig,
                "hardCcDrMultipliers",
            ));
        }
        Ok(self)
    }

    pub fn target_multiplier(self, tier: ControlTargetTier) -> Result<CombatFixed, ControlError> {
        let config = self.validate()?;
        Ok(match tier {
            ControlTargetTier::Normal => config.normal_duration_multiplier,
            ControlTargetTier::Elite => config.elite_duration_multiplier,
            ControlTargetTier::Boss => config.boss_duration_multiplier,
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ControlResolutionGate {
    Succeeded,
    Missed,
    SaveSucceeded,
    SchemaRejected,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ControlImmunityEvidence {
    MatchingImmunityTag { tag_id: GameplayTagId },
    ExplicitRule { rule_id: String },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ControlApplicationRejection {
    ResolutionDidNotApply,
    ExplicitImmunity,
    HardCcDrLevelThreeImmunity,
    NotAControlStatus,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PendingHardCcDrCommit {
    next: HardCcDrRuntime,
}

impl PendingHardCcDrCommit {
    pub fn commit_after_status_transition(
        self,
        runtime: &mut HardCcDrRuntime,
        transition: &StatusMergeOutcome,
    ) -> Result<(), ControlError> {
        if !matches!(
            transition,
            StatusMergeOutcome::Applied { .. } | StatusMergeOutcome::Replaced { .. }
        ) {
            return Err(control_error(
                ControlErrorCode::StatusApplicationNotCommitted,
                "hardCcDr",
            ));
        }
        *runtime = self.next;
        Ok(())
    }

    #[must_use]
    pub const fn next_state(self) -> HardCcDrRuntime {
        self.next
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ControlApplicationDecision {
    Apply {
        effective_duration: i64,
        resistance_fixed: CombatFixed,
        dr_fixed: CombatFixed,
        dr_level_used: u8,
        pending_hard_cc_dr_commit: Option<PendingHardCcDrCommit>,
    },
    Reject {
        reason: ControlApplicationRejection,
        effective_duration: i64,
    },
}

pub struct ControlApplicationEngine;

impl ControlApplicationEngine {
    pub fn resolve(
        definition: &StatusDefinition,
        target_duration_multiplier: CombatFixed,
        current_dr: HardCcDrRuntime,
        gate: ControlResolutionGate,
        immunity: Option<&ControlImmunityEvidence>,
        balance: ControlBalanceConfig,
    ) -> Result<ControlApplicationDecision, ControlError> {
        validate_dr_state(current_dr)?;
        let balance = balance.validate()?;
        if gate != ControlResolutionGate::Succeeded {
            return Ok(reject(ControlApplicationRejection::ResolutionDidNotApply));
        }
        if let Some(evidence) = immunity {
            validate_immunity_evidence(definition, evidence)?;
            return Ok(reject(ControlApplicationRejection::ExplicitImmunity));
        }
        if definition.control_category == ControlCategory::None {
            return Ok(reject(ControlApplicationRejection::NotAControlStatus));
        }
        if definition.control_category == ControlCategory::HardCc && current_dr.level == 3 {
            return Ok(reject(
                ControlApplicationRejection::HardCcDrLevelThreeImmunity,
            ));
        }
        let base_duration = definition.duration.duration.ok_or_else(|| {
            control_error(
                ControlErrorCode::InvalidBaseDuration,
                &definition.status_definition_id,
            )
        })?;
        if base_duration <= 0 || target_duration_multiplier.scaled() <= 0 {
            return Err(control_error(
                ControlErrorCode::InvalidBaseDuration,
                &definition.status_definition_id,
            ));
        }
        let (dr_fixed, pending_hard_cc_dr_commit) = match definition.control_category {
            ControlCategory::HardCc => {
                let dr_fixed = balance.hard_cc_dr_multipliers[usize::from(current_dr.level)];
                let next = HardCcDrRuntime {
                    level: current_dr.level.saturating_add(1).min(3),
                    quiet_owner_turns: 0,
                    applied_since_owner_turn_end: true,
                };
                (dr_fixed, Some(PendingHardCcDrCommit { next }))
            }
            ControlCategory::Restriction => (CombatFixed::from_scaled(COMBAT_FIXED_SCALE), None),
            ControlCategory::None => unreachable!("non-control returned above"),
        };
        let effective_duration = CombatNumeric::hard_cc_duration_single_ceil(
            base_duration,
            target_duration_multiplier,
            dr_fixed,
        )
        .map_err(|error| {
            control_error(
                ControlErrorCode::NumericFailure,
                format!("{}:{:?}", error.operation, error.code),
            )
        })?;
        Ok(ControlApplicationDecision::Apply {
            effective_duration,
            resistance_fixed: target_duration_multiplier,
            dr_fixed,
            dr_level_used: current_dr.level,
            pending_hard_cc_dr_commit,
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ControlTurnCompletion {
    NormalOwnerTurnCompleted,
    ExtraTurnCompleted,
    RosterSlotSkipped,
    RosterSlotRemoved,
}

pub struct HardCcDrEngine;

impl HardCcDrEngine {
    pub fn advance_quiet_turn(
        runtime: HardCcDrRuntime,
        completion: ControlTurnCompletion,
    ) -> Result<HardCcDrRuntime, ControlError> {
        validate_dr_state(runtime)?;
        if completion != ControlTurnCompletion::NormalOwnerTurnCompleted {
            return Ok(runtime);
        }
        if runtime.applied_since_owner_turn_end {
            return Ok(HardCcDrRuntime {
                applied_since_owner_turn_end: false,
                quiet_owner_turns: 0,
                ..runtime
            });
        }
        let quiet_owner_turns = runtime.quiet_owner_turns.checked_add(1).ok_or_else(|| {
            control_error(ControlErrorCode::NumericFailure, "hardCcQuietOwnerTurns")
        })?;
        if quiet_owner_turns >= 2 {
            Ok(HardCcDrRuntime::default())
        } else {
            Ok(HardCcDrRuntime {
                quiet_owner_turns,
                ..runtime
            })
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ControlErrorCode {
    InvalidBalanceConfig,
    InvalidBaseDuration,
    InvalidDrState,
    InvalidImmunityEvidence,
    StatusApplicationNotCommitted,
    NumericFailure,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ControlError {
    pub code: ControlErrorCode,
    pub subject: String,
}

impl fmt::Display for ControlError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "control rule failed for {}: {:?}",
            self.subject, self.code
        )
    }
}

impl Error for ControlError {}

fn reject(reason: ControlApplicationRejection) -> ControlApplicationDecision {
    ControlApplicationDecision::Reject {
        reason,
        effective_duration: 0,
    }
}

fn validate_dr_state(runtime: HardCcDrRuntime) -> Result<(), ControlError> {
    if runtime.level > 3
        || runtime.quiet_owner_turns > 2
        || runtime.applied_since_owner_turn_end
            && (runtime.level == 0 || runtime.quiet_owner_turns != 0)
    {
        return Err(control_error(ControlErrorCode::InvalidDrState, "hardCcDr"));
    }
    Ok(())
}

fn validate_immunity_evidence(
    definition: &StatusDefinition,
    evidence: &ControlImmunityEvidence,
) -> Result<(), ControlError> {
    let value = match evidence {
        ControlImmunityEvidence::MatchingImmunityTag { tag_id }
            if definition.immunity_tags.binary_search(tag_id).is_ok() =>
        {
            return Ok(());
        }
        ControlImmunityEvidence::MatchingImmunityTag { tag_id } => {
            return Err(control_error(
                ControlErrorCode::InvalidImmunityEvidence,
                tag_id.as_str(),
            ));
        }
        ControlImmunityEvidence::ExplicitRule { rule_id } => rule_id,
    };
    if value.is_empty()
        || value.len() > 128
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b':' | b'-'))
    {
        return Err(control_error(
            ControlErrorCode::InvalidImmunityEvidence,
            value,
        ));
    }
    Ok(())
}

fn control_error(code: ControlErrorCode, subject: impl Into<String>) -> ControlError {
    ControlError {
        code,
        subject: subject.into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        CURRENT_STATUS_SCHEMA_VERSION, DurationClock, StatusActivationPolicy,
        StatusDurationDefinition, StatusExpiryPhase, StatusRefreshPolicy, StatusStackMode,
        StatusTickPhase,
    };

    #[test]
    fn default_balance_maps_normal_elite_and_boss_multipliers() {
        let balance = ControlBalanceConfig::default();
        assert_eq!(
            balance
                .target_multiplier(ControlTargetTier::Normal)
                .unwrap()
                .scaled(),
            1_000_000
        );
        assert_eq!(
            balance
                .target_multiplier(ControlTargetTier::Elite)
                .unwrap()
                .scaled(),
            750_000
        );
        assert_eq!(
            balance
                .target_multiplier(ControlTargetTier::Boss)
                .unwrap()
                .scaled(),
            500_000
        );
    }

    #[test]
    fn hard_cc_uses_pre_application_level_then_commits_dr_only_after_status_apply() {
        let definition = definition(ControlCategory::HardCc, 4);
        let balance = ControlBalanceConfig::default();
        let mut runtime = HardCcDrRuntime::default();
        let expected = [(4, 0, 1), (2, 1, 2), (1, 2, 3)];

        for (duration, level_used, next_level) in expected {
            let decision = ControlApplicationEngine::resolve(
                &definition,
                balance
                    .target_multiplier(ControlTargetTier::Normal)
                    .unwrap(),
                runtime,
                ControlResolutionGate::Succeeded,
                None,
                balance,
            )
            .unwrap();
            let ControlApplicationDecision::Apply {
                effective_duration,
                dr_level_used,
                pending_hard_cc_dr_commit: Some(pending),
                ..
            } = decision
            else {
                panic!("hard cc must produce a pending commit");
            };
            assert_eq!(effective_duration, duration);
            assert_eq!(dr_level_used, level_used);
            assert_eq!(runtime.level, level_used);
            assert_eq!(pending.next_state().level, next_level);
            pending
                .commit_after_status_transition(&mut runtime, &committed_status_transition())
                .unwrap();
            assert_eq!(runtime.level, next_level);
            assert!(runtime.applied_since_owner_turn_end);
        }

        assert_eq!(
            ControlApplicationEngine::resolve(
                &definition,
                CombatFixed::from_scaled(1_000_000),
                runtime,
                ControlResolutionGate::Succeeded,
                None,
                balance,
            )
            .unwrap(),
            reject(ControlApplicationRejection::HardCcDrLevelThreeImmunity)
        );
        assert_eq!(runtime.level, 3);
    }

    #[test]
    fn duration_combines_resistance_and_dr_before_the_only_ceil() {
        let definition = definition(ControlCategory::HardCc, 2);
        let balance = ControlBalanceConfig {
            hard_cc_dr_multipliers: [
                CombatFixed::from_scaled(1_000_000),
                CombatFixed::from_scaled(900_000),
                CombatFixed::from_scaled(800_000),
            ],
            ..ControlBalanceConfig::default()
        };
        let decision = ControlApplicationEngine::resolve(
            &definition,
            CombatFixed::from_scaled(550_000),
            HardCcDrRuntime {
                level: 1,
                quiet_owner_turns: 0,
                applied_since_owner_turn_end: false,
            },
            ControlResolutionGate::Succeeded,
            None,
            balance,
        )
        .unwrap();
        let ControlApplicationDecision::Apply {
            effective_duration,
            resistance_fixed,
            dr_fixed,
            ..
        } = decision
        else {
            panic!("expected application");
        };
        assert_eq!(effective_duration, 1);
        assert_eq!(resistance_fixed.scaled(), 550_000);
        assert_eq!(dr_fixed.scaled(), 900_000);
        assert_eq!(
            CombatNumeric::ceil_div(2 * 550_000, 1_000_000)
                .and_then(|first| CombatNumeric::ceil_div(first * 900_000, 1_000_000))
                .unwrap(),
            2
        );
    }

    #[test]
    fn misses_saves_schema_rejects_and_immunity_never_create_dr_commit() {
        let mut definition = definition(ControlCategory::HardCc, 3);
        definition.immunity_tags = vec![GameplayTagId::new("Character.Mechanical").unwrap()];
        let current = HardCcDrRuntime {
            level: 2,
            quiet_owner_turns: 1,
            applied_since_owner_turn_end: false,
        };
        for gate in [
            ControlResolutionGate::Missed,
            ControlResolutionGate::SaveSucceeded,
            ControlResolutionGate::SchemaRejected,
        ] {
            assert_eq!(
                resolve(&definition, current, gate, None),
                reject(ControlApplicationRejection::ResolutionDidNotApply)
            );
        }

        let immunity = ControlImmunityEvidence::ExplicitRule {
            rule_id: "Control.Immune".to_owned(),
        };
        assert_eq!(
            resolve(
                &definition,
                HardCcDrRuntime {
                    level: 3,
                    quiet_owner_turns: 0,
                    applied_since_owner_turn_end: false,
                },
                ControlResolutionGate::Succeeded,
                Some(&immunity),
            ),
            reject(ControlApplicationRejection::ExplicitImmunity)
        );
        let matching_tag = ControlImmunityEvidence::MatchingImmunityTag {
            tag_id: GameplayTagId::new("Character.Mechanical").unwrap(),
        };
        assert_eq!(
            resolve(
                &definition,
                current,
                ControlResolutionGate::Succeeded,
                Some(&matching_tag),
            ),
            reject(ControlApplicationRejection::ExplicitImmunity)
        );
    }

    #[test]
    fn restriction_uses_boss_multiplier_without_hard_cc_dr_or_temporary_immunity() {
        let definition = definition(ControlCategory::Restriction, 3);
        let balance = ControlBalanceConfig::default();
        let decision = ControlApplicationEngine::resolve(
            &definition,
            balance.target_multiplier(ControlTargetTier::Boss).unwrap(),
            HardCcDrRuntime {
                level: 3,
                quiet_owner_turns: 0,
                applied_since_owner_turn_end: false,
            },
            ControlResolutionGate::Succeeded,
            None,
            balance,
        )
        .unwrap();
        let ControlApplicationDecision::Apply {
            effective_duration,
            dr_fixed,
            pending_hard_cc_dr_commit,
            ..
        } = decision
        else {
            panic!("restriction should apply");
        };
        assert_eq!(effective_duration, 2);
        assert_eq!(dr_fixed.scaled(), 1_000_000);
        assert_eq!(pending_hard_cc_dr_commit, None);
    }

    #[test]
    fn quiet_counter_resets_only_after_two_complete_normal_owner_turns() {
        let applied = HardCcDrRuntime {
            level: 2,
            quiet_owner_turns: 0,
            applied_since_owner_turn_end: true,
        };
        let after_application_turn = HardCcDrEngine::advance_quiet_turn(
            applied,
            ControlTurnCompletion::NormalOwnerTurnCompleted,
        )
        .unwrap();
        assert_eq!(
            after_application_turn,
            HardCcDrRuntime {
                level: 2,
                quiet_owner_turns: 0,
                applied_since_owner_turn_end: false
            }
        );
        for ignored in [
            ControlTurnCompletion::ExtraTurnCompleted,
            ControlTurnCompletion::RosterSlotSkipped,
            ControlTurnCompletion::RosterSlotRemoved,
        ] {
            assert_eq!(
                HardCcDrEngine::advance_quiet_turn(after_application_turn, ignored).unwrap(),
                after_application_turn
            );
        }
        let one = HardCcDrEngine::advance_quiet_turn(
            after_application_turn,
            ControlTurnCompletion::NormalOwnerTurnCompleted,
        )
        .unwrap();
        assert_eq!(one.level, 2);
        assert_eq!(one.quiet_owner_turns, 1);
        assert_eq!(
            HardCcDrEngine::advance_quiet_turn(
                one,
                ControlTurnCompletion::NormalOwnerTurnCompleted
            )
            .unwrap(),
            HardCcDrRuntime::default()
        );
    }

    #[test]
    fn malformed_balance_dr_and_immunity_evidence_fail_closed() {
        let definition = definition(ControlCategory::HardCc, 2);
        let invalid_balance = ControlBalanceConfig {
            boss_duration_multiplier: CombatFixed::from_scaled(0),
            ..ControlBalanceConfig::default()
        };
        assert_eq!(
            ControlApplicationEngine::resolve(
                &definition,
                CombatFixed::from_scaled(500_000),
                HardCcDrRuntime::default(),
                ControlResolutionGate::Succeeded,
                None,
                invalid_balance,
            )
            .unwrap_err()
            .code,
            ControlErrorCode::InvalidBalanceConfig
        );
        assert_eq!(
            HardCcDrEngine::advance_quiet_turn(
                HardCcDrRuntime {
                    level: 4,
                    quiet_owner_turns: 0,
                    applied_since_owner_turn_end: false,
                },
                ControlTurnCompletion::NormalOwnerTurnCompleted,
            )
            .unwrap_err()
            .code,
            ControlErrorCode::InvalidDrState
        );
        let bad_immunity = ControlImmunityEvidence::ExplicitRule {
            rule_id: "bad rule".to_owned(),
        };
        assert_eq!(
            ControlApplicationEngine::resolve(
                &definition,
                CombatFixed::from_scaled(1_000_000),
                HardCcDrRuntime::default(),
                ControlResolutionGate::Succeeded,
                Some(&bad_immunity),
                ControlBalanceConfig::default(),
            )
            .unwrap_err()
            .code,
            ControlErrorCode::InvalidImmunityEvidence
        );
    }

    #[test]
    fn pending_dr_rejects_a_no_op_status_transition() {
        let definition = definition(ControlCategory::HardCc, 2);
        let ControlApplicationDecision::Apply {
            pending_hard_cc_dr_commit: Some(pending),
            ..
        } = resolve(
            &definition,
            HardCcDrRuntime::default(),
            ControlResolutionGate::Succeeded,
            None,
        )
        else {
            panic!("expected pending hard cc commit");
        };
        let mut runtime = HardCcDrRuntime::default();
        let no_op = StatusMergeOutcome::NoOp {
            reason: crate::StatusMergeNoOpReason::CurrentHighestOnlyIsStronger,
        };
        assert_eq!(
            pending
                .commit_after_status_transition(&mut runtime, &no_op)
                .unwrap_err()
                .code,
            ControlErrorCode::StatusApplicationNotCommitted
        );
        assert_eq!(runtime, HardCcDrRuntime::default());
    }

    fn resolve(
        definition: &StatusDefinition,
        runtime: HardCcDrRuntime,
        gate: ControlResolutionGate,
        immunity: Option<&ControlImmunityEvidence>,
    ) -> ControlApplicationDecision {
        ControlApplicationEngine::resolve(
            definition,
            CombatFixed::from_scaled(1_000_000),
            runtime,
            gate,
            immunity,
            ControlBalanceConfig::default(),
        )
        .unwrap()
    }

    fn definition(category: ControlCategory, duration: i64) -> StatusDefinition {
        StatusDefinition {
            status_schema_version: CURRENT_STATUS_SCHEMA_VERSION,
            status_definition_id: "control-status".to_owned(),
            tags: Vec::new(),
            stack_group_id: "control-status".to_owned(),
            stack_mode: StatusStackMode::HighestOnly,
            max_stacks: 1,
            duration: StatusDurationDefinition {
                clock: DurationClock::OwnerTurn,
                duration: Some(duration),
                activation_policy: StatusActivationPolicy::NextClock,
                expiry_phase: StatusExpiryPhase::OwnerTurnEnd,
            },
            refresh_policy: StatusRefreshPolicy::RefreshDuration,
            priority: 0,
            control_category: category,
            tick_phase: StatusTickPhase::None,
            dispel_tags: Vec::new(),
            immunity_tags: Vec::new(),
            effects: Vec::new(),
            triggers: Vec::new(),
            strength_rank: Some(1),
        }
    }

    fn committed_status_transition() -> StatusMergeOutcome {
        StatusMergeOutcome::Applied {
            instance: crate::StatusRuntime {
                status_schema_version: CURRENT_STATUS_SCHEMA_VERSION,
                status_instance_id: "control-instance".to_owned(),
                status_definition_id: "control-status".to_owned(),
                source_combatant_id: Some("source".to_owned()),
                stack_group_id: "control-status".to_owned(),
                stack_count: 1,
                remaining_duration: Some(1),
                duration_clock: DurationClock::OwnerTurn,
                application_sequence: 1,
                activation_clock_index: 1,
                applied_round_index: 1,
                applied_owner_turn_index: Some(0),
                tick_eligible_clock_index: 1,
                last_duration_advanced_clock_index: None,
                strength_rank: Some(1),
            },
            existing_instance_id: None,
            stack_delta: 1,
            duration_changed: true,
        }
    }
}

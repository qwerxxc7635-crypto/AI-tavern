use std::{error::Error, fmt};

use serde::{Deserialize, Serialize};

use crate::ResolutionResult;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AttackClassification {
    BasicAttack,
    OtherAbility,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum MultipleAttackPenaltyOverride {
    Default {},
    IgnorePenalty { rule_id: String },
    CountAsBasicAttack { rule_id: String },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BasicAttackBalanceConfig {
    pub max_uses_per_normal_owner_turn: i64,
    pub first_attack_penalty: i64,
    pub second_attack_penalty: i64,
    pub third_and_later_attack_penalty: i64,
}

impl BasicAttackBalanceConfig {
    #[must_use]
    pub const fn v0_4_1_baseline() -> Self {
        Self {
            max_uses_per_normal_owner_turn: 3,
            first_attack_penalty: 0,
            second_attack_penalty: -3,
            third_and_later_attack_penalty: -6,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BasicAttackUsageDecision {
    pub accuracy_penalty: i64,
    pub increment_basic_attack_count: bool,
    pub committed_count_before_use: i64,
    pub committed_count_after_use: i64,
}

pub struct BasicAttackRules;

impl BasicAttackRules {
    pub fn evaluate(
        config: &BasicAttackBalanceConfig,
        committed_basic_attack_count: i64,
        classification: AttackClassification,
        penalty_override: &MultipleAttackPenaltyOverride,
    ) -> Result<BasicAttackUsageDecision, AttackRuleError> {
        validate_basic_attack_config(config)?;
        if committed_basic_attack_count < 0 {
            return Err(attack_error(
                AttackRuleErrorCode::InvalidCommittedCounter,
                "basicAttackCountThisNormalOwnerTurn",
            ));
        }

        let (counts_as_basic_attack, ignore_penalty) = match (classification, penalty_override) {
            (AttackClassification::BasicAttack, MultipleAttackPenaltyOverride::Default {}) => {
                (true, false)
            }
            (
                AttackClassification::BasicAttack,
                MultipleAttackPenaltyOverride::IgnorePenalty { rule_id },
            ) => {
                validate_rule_id(rule_id)?;
                (true, true)
            }
            (
                AttackClassification::OtherAbility,
                MultipleAttackPenaltyOverride::CountAsBasicAttack { rule_id },
            ) => {
                validate_rule_id(rule_id)?;
                (true, false)
            }
            (AttackClassification::OtherAbility, MultipleAttackPenaltyOverride::Default {}) => {
                (false, false)
            }
            _ => {
                return Err(attack_error(
                    AttackRuleErrorCode::IncompatibleOverride,
                    "multipleAttackPenaltyOverride",
                ));
            }
        };

        if !counts_as_basic_attack {
            return Ok(BasicAttackUsageDecision {
                accuracy_penalty: 0,
                increment_basic_attack_count: false,
                committed_count_before_use: committed_basic_attack_count,
                committed_count_after_use: committed_basic_attack_count,
            });
        }
        if committed_basic_attack_count >= config.max_uses_per_normal_owner_turn {
            return Err(attack_error(
                AttackRuleErrorCode::MaximumUsesReached,
                "basicAttackCountThisNormalOwnerTurn",
            ));
        }

        let accuracy_penalty = if ignore_penalty {
            0
        } else {
            match committed_basic_attack_count {
                0 => config.first_attack_penalty,
                1 => config.second_attack_penalty,
                _ => config.third_and_later_attack_penalty,
            }
        };
        let committed_count_after_use =
            committed_basic_attack_count.checked_add(1).ok_or_else(|| {
                attack_error(
                    AttackRuleErrorCode::NumericOverflow,
                    "basicAttackCountThisNormalOwnerTurn",
                )
            })?;

        Ok(BasicAttackUsageDecision {
            accuracy_penalty,
            increment_basic_attack_count: true,
            committed_count_before_use: committed_basic_attack_count,
            committed_count_after_use,
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum DamageComponentTiming {
    Instant,
    DamageOverTimeTick,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CriticalEligibility {
    Eligible,
    Ineligible,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum CriticalDamageOverride {
    Default {},
    AllowDamageOverTime { rule_id: String },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DamageDiceDefinition {
    pub dice_count: u32,
    pub die_sides: u32,
    pub fixed_bonus: i64,
    pub timing: DamageComponentTiming,
    pub critical_eligibility: CriticalEligibility,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CriticalDamagePlan {
    pub dice_count: u32,
    pub die_sides: u32,
    pub fixed_bonus: i64,
    pub critical_applied: bool,
}

pub struct CriticalDamageRules;

impl CriticalDamageRules {
    pub fn plan(
        resolution: &ResolutionResult,
        definition: &DamageDiceDefinition,
        damage_override: &CriticalDamageOverride,
    ) -> Result<CriticalDamagePlan, AttackRuleError> {
        validate_damage_definition(definition, damage_override)?;

        let critical = match resolution {
            ResolutionResult::AttackRoll { hit, critical, .. } => {
                if *critical && !*hit {
                    return Err(attack_error(
                        AttackRuleErrorCode::InvalidResolutionOutcome,
                        "criticalWithoutHit",
                    ));
                }
                *critical
            }
            ResolutionResult::SavingThrow { .. }
            | ResolutionResult::OpposedCheck { .. }
            | ResolutionResult::AutoHit { .. }
            | ResolutionResult::ConditionalCheck { .. }
            | ResolutionResult::AttemptEscape { .. } => false,
        };
        let critical_applied = critical
            && matches!(
                definition.critical_eligibility,
                CriticalEligibility::Eligible
            );
        let dice_count = if critical_applied {
            definition.dice_count.checked_mul(2).ok_or_else(|| {
                attack_error(AttackRuleErrorCode::NumericOverflow, "criticalDiceCount")
            })?
        } else {
            definition.dice_count
        };

        Ok(CriticalDamagePlan {
            dice_count,
            die_sides: definition.die_sides,
            fixed_bonus: definition.fixed_bonus,
            critical_applied,
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AttackRuleErrorCode {
    InvalidBalanceConfig,
    InvalidCommittedCounter,
    MaximumUsesReached,
    InvalidRuleId,
    IncompatibleOverride,
    InvalidDamageDefinition,
    InvalidResolutionOutcome,
    NumericOverflow,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AttackRuleError {
    pub code: AttackRuleErrorCode,
    pub subject: String,
}

impl fmt::Display for AttackRuleError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "attack rule failed for {}: {:?}",
            self.subject, self.code
        )
    }
}

impl Error for AttackRuleError {}

fn validate_basic_attack_config(config: &BasicAttackBalanceConfig) -> Result<(), AttackRuleError> {
    if config.max_uses_per_normal_owner_turn <= 0
        || config.first_attack_penalty > 0
        || config.second_attack_penalty > config.first_attack_penalty
        || config.third_and_later_attack_penalty > config.second_attack_penalty
    {
        return Err(attack_error(
            AttackRuleErrorCode::InvalidBalanceConfig,
            "basicAttackBalanceConfig",
        ));
    }
    Ok(())
}

fn validate_damage_definition(
    definition: &DamageDiceDefinition,
    damage_override: &CriticalDamageOverride,
) -> Result<(), AttackRuleError> {
    if definition.dice_count == 0 || definition.die_sides < 2 || definition.fixed_bonus < 0 {
        return Err(attack_error(
            AttackRuleErrorCode::InvalidDamageDefinition,
            "damageDiceDefinition",
        ));
    }

    match (definition.timing, damage_override) {
        (DamageComponentTiming::Instant, CriticalDamageOverride::Default {}) => Ok(()),
        (
            DamageComponentTiming::DamageOverTimeTick,
            CriticalDamageOverride::AllowDamageOverTime { rule_id },
        ) => validate_rule_id(rule_id),
        (DamageComponentTiming::DamageOverTimeTick, CriticalDamageOverride::Default {})
            if definition.critical_eligibility == CriticalEligibility::Ineligible =>
        {
            Ok(())
        }
        _ => Err(attack_error(
            AttackRuleErrorCode::IncompatibleOverride,
            "criticalDamageOverride",
        )),
    }
}

fn validate_rule_id(value: &str) -> Result<(), AttackRuleError> {
    if value.is_empty()
        || value.len() > 128
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b':' | b'-'))
    {
        Err(attack_error(AttackRuleErrorCode::InvalidRuleId, value))
    } else {
        Ok(())
    }
}

fn attack_error(code: AttackRuleErrorCode, subject: impl Into<String>) -> AttackRuleError {
    AttackRuleError {
        code,
        subject: subject.into(),
    }
}

#[cfg(test)]
mod tests {
    use crate::{ResolutionRequest, ResolutionResolver};

    use super::*;

    #[test]
    fn baseline_basic_attack_penalties_are_zero_minus_three_minus_six_then_blocked() {
        let config = BasicAttackBalanceConfig::v0_4_1_baseline();
        let mut committed_count = 0;
        for expected_penalty in [0, -3, -6] {
            let decision = BasicAttackRules::evaluate(
                &config,
                committed_count,
                AttackClassification::BasicAttack,
                &MultipleAttackPenaltyOverride::Default {},
            )
            .unwrap();
            assert_eq!(decision.accuracy_penalty, expected_penalty);
            assert!(decision.increment_basic_attack_count);
            committed_count = decision.committed_count_after_use;
        }
        assert_eq!(committed_count, 3);
        assert_eq!(
            BasicAttackRules::evaluate(
                &config,
                committed_count,
                AttackClassification::BasicAttack,
                &MultipleAttackPenaltyOverride::Default {},
            )
            .unwrap_err()
            .code,
            AttackRuleErrorCode::MaximumUsesReached
        );
    }

    #[test]
    fn penalties_are_tunable_without_removing_monotonic_mechanism() {
        let config = BasicAttackBalanceConfig {
            max_uses_per_normal_owner_turn: 4,
            first_attack_penalty: -1,
            second_attack_penalty: -2,
            third_and_later_attack_penalty: -4,
        };
        assert_eq!(
            BasicAttackRules::evaluate(
                &config,
                2,
                AttackClassification::BasicAttack,
                &MultipleAttackPenaltyOverride::Default {},
            )
            .unwrap()
            .accuracy_penalty,
            -4
        );
        let invalid = BasicAttackBalanceConfig {
            second_attack_penalty: 1,
            ..config
        };
        assert_eq!(
            BasicAttackRules::evaluate(
                &invalid,
                0,
                AttackClassification::BasicAttack,
                &MultipleAttackPenaltyOverride::Default {},
            )
            .unwrap_err()
            .code,
            AttackRuleErrorCode::InvalidBalanceConfig
        );
    }

    #[test]
    fn non_basic_ability_is_exempt_unless_typed_rule_counts_it_as_basic() {
        let config = BasicAttackBalanceConfig::v0_4_1_baseline();
        let ordinary = BasicAttackRules::evaluate(
            &config,
            2,
            AttackClassification::OtherAbility,
            &MultipleAttackPenaltyOverride::Default {},
        )
        .unwrap();
        assert_eq!(ordinary.accuracy_penalty, 0);
        assert!(!ordinary.increment_basic_attack_count);
        assert_eq!(ordinary.committed_count_after_use, 2);

        let counted = BasicAttackRules::evaluate(
            &config,
            2,
            AttackClassification::OtherAbility,
            &MultipleAttackPenaltyOverride::CountAsBasicAttack {
                rule_id: "attack.count-as-basic".to_owned(),
            },
        )
        .unwrap();
        assert_eq!(counted.accuracy_penalty, -6);
        assert_eq!(counted.committed_count_after_use, 3);
    }

    #[test]
    fn ignore_penalty_is_local_typed_override_but_does_not_bypass_use_cap() {
        let config = BasicAttackBalanceConfig::v0_4_1_baseline();
        let override_rule = MultipleAttackPenaltyOverride::IgnorePenalty {
            rule_id: "attack.ignore-map".to_owned(),
        };
        let decision = BasicAttackRules::evaluate(
            &config,
            2,
            AttackClassification::BasicAttack,
            &override_rule,
        )
        .unwrap();
        assert_eq!(decision.accuracy_penalty, 0);
        assert_eq!(decision.committed_count_after_use, 3);

        assert_eq!(
            BasicAttackRules::evaluate(
                &config,
                3,
                AttackClassification::BasicAttack,
                &override_rule,
            )
            .unwrap_err()
            .code,
            AttackRuleErrorCode::MaximumUsesReached
        );
    }

    #[test]
    fn critical_doubles_only_eligible_dice_and_never_fixed_bonus() {
        let critical = ResolutionResolver::resolve(ResolutionRequest::AttackRoll {
            raw_roll: 20,
            attacker_modifier: -100,
            target_defense: 100,
            critical_range_minimum: 20,
            force_critical: false,
        })
        .unwrap();
        let eligible = DamageDiceDefinition {
            dice_count: 2,
            die_sides: 8,
            fixed_bonus: 5,
            timing: DamageComponentTiming::Instant,
            critical_eligibility: CriticalEligibility::Eligible,
        };
        let plan =
            CriticalDamageRules::plan(&critical, &eligible, &CriticalDamageOverride::Default {})
                .unwrap();
        assert_eq!(
            (plan.dice_count, plan.die_sides, plan.fixed_bonus),
            (4, 8, 5)
        );
        assert!(plan.critical_applied);

        let ineligible = DamageDiceDefinition {
            critical_eligibility: CriticalEligibility::Ineligible,
            ..eligible
        };
        let plan =
            CriticalDamageRules::plan(&critical, &ineligible, &CriticalDamageOverride::Default {})
                .unwrap();
        assert_eq!((plan.dice_count, plan.fixed_bonus), (2, 5));
        assert!(!plan.critical_applied);
    }

    #[test]
    fn damage_over_time_defaults_ineligible_and_requires_specific_override() {
        let critical = ResolutionResolver::resolve(ResolutionRequest::AttackRoll {
            raw_roll: 20,
            attacker_modifier: 0,
            target_defense: 10,
            critical_range_minimum: 20,
            force_critical: false,
        })
        .unwrap();
        let mut dot = DamageDiceDefinition {
            dice_count: 1,
            die_sides: 6,
            fixed_bonus: 2,
            timing: DamageComponentTiming::DamageOverTimeTick,
            critical_eligibility: CriticalEligibility::Ineligible,
        };
        let default_plan =
            CriticalDamageRules::plan(&critical, &dot, &CriticalDamageOverride::Default {})
                .unwrap();
        assert_eq!((default_plan.dice_count, default_plan.fixed_bonus), (1, 2));

        dot.critical_eligibility = CriticalEligibility::Eligible;
        assert_eq!(
            CriticalDamageRules::plan(&critical, &dot, &CriticalDamageOverride::Default {},)
                .unwrap_err()
                .code,
            AttackRuleErrorCode::IncompatibleOverride
        );
        let explicit = CriticalDamageRules::plan(
            &critical,
            &dot,
            &CriticalDamageOverride::AllowDamageOverTime {
                rule_id: "critical.allow-dot".to_owned(),
            },
        )
        .unwrap();
        assert_eq!((explicit.dice_count, explicit.fixed_bonus), (2, 2));
    }

    #[test]
    fn critical_range_still_requires_hit_and_non_attack_types_do_not_crit() {
        let nineteen_miss = ResolutionResolver::resolve(ResolutionRequest::AttackRoll {
            raw_roll: 19,
            attacker_modifier: 0,
            target_defense: 20,
            critical_range_minimum: 19,
            force_critical: false,
        })
        .unwrap();
        let definition = DamageDiceDefinition {
            dice_count: 2,
            die_sides: 6,
            fixed_bonus: 4,
            timing: DamageComponentTiming::Instant,
            critical_eligibility: CriticalEligibility::Eligible,
        };
        assert_eq!(
            CriticalDamageRules::plan(
                &nineteen_miss,
                &definition,
                &CriticalDamageOverride::Default {},
            )
            .unwrap()
            .dice_count,
            2
        );

        let save = ResolutionResolver::resolve(ResolutionRequest::SavingThrow {
            raw_roll: 20,
            defender_save_modifier: 0,
            ability_dc: 10,
        })
        .unwrap();
        assert_eq!(
            CriticalDamageRules::plan(&save, &definition, &CriticalDamageOverride::Default {},)
                .unwrap()
                .dice_count,
            2
        );
    }

    #[test]
    fn malformed_outcomes_overrides_counters_and_dice_fail_closed() {
        let invalid_outcome = ResolutionResult::AttackRoll {
            raw_roll: 20,
            total: 20,
            target_defense: 10,
            hit: false,
            critical: true,
        };
        let definition = DamageDiceDefinition {
            dice_count: 1,
            die_sides: 6,
            fixed_bonus: 0,
            timing: DamageComponentTiming::Instant,
            critical_eligibility: CriticalEligibility::Eligible,
        };
        assert_eq!(
            CriticalDamageRules::plan(
                &invalid_outcome,
                &definition,
                &CriticalDamageOverride::Default {},
            )
            .unwrap_err()
            .code,
            AttackRuleErrorCode::InvalidResolutionOutcome
        );
        assert_eq!(
            BasicAttackRules::evaluate(
                &BasicAttackBalanceConfig::v0_4_1_baseline(),
                -1,
                AttackClassification::BasicAttack,
                &MultipleAttackPenaltyOverride::Default {},
            )
            .unwrap_err()
            .code,
            AttackRuleErrorCode::InvalidCommittedCounter
        );
        assert_eq!(
            BasicAttackRules::evaluate(
                &BasicAttackBalanceConfig::v0_4_1_baseline(),
                0,
                AttackClassification::OtherAbility,
                &MultipleAttackPenaltyOverride::IgnorePenalty {
                    rule_id: "attack.ignore-map".to_owned(),
                },
            )
            .unwrap_err()
            .code,
            AttackRuleErrorCode::IncompatibleOverride
        );

        let invalid_dice = DamageDiceDefinition {
            dice_count: 0,
            ..definition
        };
        assert_eq!(
            CriticalDamageRules::plan(
                &invalid_outcome,
                &invalid_dice,
                &CriticalDamageOverride::Default {},
            )
            .unwrap_err()
            .code,
            AttackRuleErrorCode::InvalidDamageDefinition
        );
    }
}

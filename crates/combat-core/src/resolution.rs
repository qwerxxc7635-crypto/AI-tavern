use std::{error::Error, fmt};

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ResolutionType {
    AttackRoll,
    SavingThrow,
    OpposedCheck,
    AutoHit,
    ConditionalCheck,
    AttemptEscape,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum OpposedTieRule {
    DefenderWins,
    AttackerWins,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ConditionalComparison {
    AtLeast,
    GreaterThan,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum ResolutionRequest {
    AttackRoll {
        raw_roll: u8,
        attacker_modifier: i64,
        target_defense: i64,
        critical_range_minimum: u8,
        force_critical: bool,
    },
    SavingThrow {
        raw_roll: u8,
        defender_save_modifier: i64,
        ability_dc: i64,
    },
    OpposedCheck {
        attacker_raw_roll: u8,
        attacker_modifier: i64,
        defender_raw_roll: u8,
        defender_modifier: i64,
        tie_rule: OpposedTieRule,
    },
    AutoHit {},
    ConditionalCheck {
        raw_roll: Option<u8>,
        modifier: i64,
        threshold: i64,
        comparison: ConditionalComparison,
    },
    AttemptEscape {
        raw_roll: u8,
        escape_modifier: i64,
        encounter_escape_dc: i64,
    },
}

impl ResolutionRequest {
    #[must_use]
    pub const fn resolution_type(&self) -> ResolutionType {
        match self {
            Self::AttackRoll { .. } => ResolutionType::AttackRoll,
            Self::SavingThrow { .. } => ResolutionType::SavingThrow,
            Self::OpposedCheck { .. } => ResolutionType::OpposedCheck,
            Self::AutoHit {} => ResolutionType::AutoHit,
            Self::ConditionalCheck { .. } => ResolutionType::ConditionalCheck,
            Self::AttemptEscape { .. } => ResolutionType::AttemptEscape,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum ResolutionResult {
    AttackRoll {
        raw_roll: u8,
        total: i64,
        target_defense: i64,
        hit: bool,
        critical: bool,
    },
    SavingThrow {
        raw_roll: u8,
        total: i64,
        ability_dc: i64,
        succeeded: bool,
    },
    OpposedCheck {
        attacker_raw_roll: u8,
        attacker_total: i64,
        defender_raw_roll: u8,
        defender_total: i64,
        attacker_won: bool,
        tie_rule: OpposedTieRule,
    },
    AutoHit {
        hit: bool,
        critical: bool,
    },
    ConditionalCheck {
        raw_roll: Option<u8>,
        total: i64,
        threshold: i64,
        comparison: ConditionalComparison,
        succeeded: bool,
    },
    AttemptEscape {
        raw_roll: u8,
        total: i64,
        encounter_escape_dc: i64,
        escaped: bool,
    },
}

impl ResolutionResult {
    #[must_use]
    pub const fn resolution_type(&self) -> ResolutionType {
        match self {
            Self::AttackRoll { .. } => ResolutionType::AttackRoll,
            Self::SavingThrow { .. } => ResolutionType::SavingThrow,
            Self::OpposedCheck { .. } => ResolutionType::OpposedCheck,
            Self::AutoHit { .. } => ResolutionType::AutoHit,
            Self::ConditionalCheck { .. } => ResolutionType::ConditionalCheck,
            Self::AttemptEscape { .. } => ResolutionType::AttemptEscape,
        }
    }

    #[must_use]
    pub const fn succeeded(&self) -> bool {
        match self {
            Self::AttackRoll { hit, .. } | Self::AutoHit { hit, .. } => *hit,
            Self::SavingThrow { succeeded, .. } | Self::ConditionalCheck { succeeded, .. } => {
                *succeeded
            }
            Self::OpposedCheck { attacker_won, .. } => *attacker_won,
            Self::AttemptEscape { escaped, .. } => *escaped,
        }
    }

    #[must_use]
    pub const fn critical(&self) -> bool {
        match self {
            Self::AttackRoll { critical, .. } | Self::AutoHit { critical, .. } => *critical,
            Self::SavingThrow { .. }
            | Self::OpposedCheck { .. }
            | Self::ConditionalCheck { .. }
            | Self::AttemptEscape { .. } => false,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ResolutionErrorCode {
    InvalidD20,
    InvalidCriticalRange,
    ArithmeticOverflow,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolutionError {
    pub code: ResolutionErrorCode,
    pub field: String,
}

impl fmt::Display for ResolutionError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "resolution failed for {}: {:?}",
            self.field, self.code
        )
    }
}

impl Error for ResolutionError {}

pub struct ResolutionResolver;

impl ResolutionResolver {
    pub fn resolve(request: ResolutionRequest) -> Result<ResolutionResult, ResolutionError> {
        match request {
            ResolutionRequest::AttackRoll {
                raw_roll,
                attacker_modifier,
                target_defense,
                critical_range_minimum,
                force_critical,
            } => {
                validate_d20(raw_roll, "raw-roll")?;
                if !(2..=20).contains(&critical_range_minimum) {
                    return Err(resolution_error(
                        ResolutionErrorCode::InvalidCriticalRange,
                        "critical-range-minimum",
                    ));
                }
                let total = checked_total(raw_roll, attacker_modifier, "attack-total")?;
                let hit = if raw_roll == 20 {
                    true
                } else if raw_roll == 1 {
                    false
                } else {
                    total >= target_defense
                };
                let critical =
                    hit && (raw_roll == 20 || raw_roll >= critical_range_minimum || force_critical);
                Ok(ResolutionResult::AttackRoll {
                    raw_roll,
                    total,
                    target_defense,
                    hit,
                    critical,
                })
            }
            ResolutionRequest::SavingThrow {
                raw_roll,
                defender_save_modifier,
                ability_dc,
            } => {
                validate_d20(raw_roll, "raw-roll")?;
                let total = checked_total(raw_roll, defender_save_modifier, "saving-throw-total")?;
                Ok(ResolutionResult::SavingThrow {
                    raw_roll,
                    total,
                    ability_dc,
                    succeeded: total >= ability_dc,
                })
            }
            ResolutionRequest::OpposedCheck {
                attacker_raw_roll,
                attacker_modifier,
                defender_raw_roll,
                defender_modifier,
                tie_rule,
            } => {
                validate_d20(attacker_raw_roll, "attacker-raw-roll")?;
                validate_d20(defender_raw_roll, "defender-raw-roll")?;
                let attacker_total =
                    checked_total(attacker_raw_roll, attacker_modifier, "attacker-total")?;
                let defender_total =
                    checked_total(defender_raw_roll, defender_modifier, "defender-total")?;
                let attacker_won = attacker_total > defender_total
                    || (attacker_total == defender_total
                        && tie_rule == OpposedTieRule::AttackerWins);
                Ok(ResolutionResult::OpposedCheck {
                    attacker_raw_roll,
                    attacker_total,
                    defender_raw_roll,
                    defender_total,
                    attacker_won,
                    tie_rule,
                })
            }
            ResolutionRequest::AutoHit {} => Ok(ResolutionResult::AutoHit {
                hit: true,
                critical: false,
            }),
            ResolutionRequest::ConditionalCheck {
                raw_roll,
                modifier,
                threshold,
                comparison,
            } => {
                if let Some(raw_roll) = raw_roll {
                    validate_d20(raw_roll, "raw-roll")?;
                }
                let total = match raw_roll {
                    Some(raw_roll) => checked_total(raw_roll, modifier, "conditional-total")?,
                    None => modifier,
                };
                let succeeded = match comparison {
                    ConditionalComparison::AtLeast => total >= threshold,
                    ConditionalComparison::GreaterThan => total > threshold,
                };
                Ok(ResolutionResult::ConditionalCheck {
                    raw_roll,
                    total,
                    threshold,
                    comparison,
                    succeeded,
                })
            }
            ResolutionRequest::AttemptEscape {
                raw_roll,
                escape_modifier,
                encounter_escape_dc,
            } => {
                validate_d20(raw_roll, "raw-roll")?;
                let total = checked_total(raw_roll, escape_modifier, "escape-total")?;
                Ok(ResolutionResult::AttemptEscape {
                    raw_roll,
                    total,
                    encounter_escape_dc,
                    escaped: total >= encounter_escape_dc,
                })
            }
        }
    }
}

fn validate_d20(raw_roll: u8, field: &str) -> Result<(), ResolutionError> {
    if !(1..=20).contains(&raw_roll) {
        Err(resolution_error(ResolutionErrorCode::InvalidD20, field))
    } else {
        Ok(())
    }
}

fn checked_total(raw_roll: u8, modifier: i64, field: &str) -> Result<i64, ResolutionError> {
    modifier
        .checked_add(i64::from(raw_roll))
        .ok_or_else(|| resolution_error(ResolutionErrorCode::ArithmeticOverflow, field))
}

fn resolution_error(code: ResolutionErrorCode, field: &str) -> ResolutionError {
    ResolutionError {
        code,
        field: field.to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn attack_natural_twenty_and_one_override_total_and_only_a_hitting_range_crit_counts() {
        let natural_twenty = ResolutionResolver::resolve(ResolutionRequest::AttackRoll {
            raw_roll: 20,
            attacker_modifier: -100,
            target_defense: 100,
            critical_range_minimum: 20,
            force_critical: false,
        })
        .unwrap();
        assert!(natural_twenty.succeeded());
        assert!(natural_twenty.critical());

        let natural_one = ResolutionResolver::resolve(ResolutionRequest::AttackRoll {
            raw_roll: 1,
            attacker_modifier: 100,
            target_defense: 1,
            critical_range_minimum: 2,
            force_critical: true,
        })
        .unwrap();
        assert!(!natural_one.succeeded());
        assert!(!natural_one.critical());

        let nineteen_miss = ResolutionResolver::resolve(ResolutionRequest::AttackRoll {
            raw_roll: 19,
            attacker_modifier: 0,
            target_defense: 20,
            critical_range_minimum: 19,
            force_critical: false,
        })
        .unwrap();
        assert!(!nineteen_miss.succeeded());
        assert!(!nineteen_miss.critical());
        let nineteen_hit = ResolutionResolver::resolve(ResolutionRequest::AttackRoll {
            raw_roll: 19,
            attacker_modifier: 1,
            target_defense: 20,
            critical_range_minimum: 19,
            force_critical: false,
        })
        .unwrap();
        assert!(nineteen_hit.succeeded());
        assert!(nineteen_hit.critical());
    }

    #[test]
    fn non_attack_natural_extremes_are_only_numbers_in_the_declared_formula() {
        let save_twenty = ResolutionResolver::resolve(ResolutionRequest::SavingThrow {
            raw_roll: 20,
            defender_save_modifier: -20,
            ability_dc: 1,
        })
        .unwrap();
        assert!(!save_twenty.succeeded());
        let save_one = ResolutionResolver::resolve(ResolutionRequest::SavingThrow {
            raw_roll: 1,
            defender_save_modifier: 20,
            ability_dc: 20,
        })
        .unwrap();
        assert!(save_one.succeeded());

        let escape_twenty = ResolutionResolver::resolve(ResolutionRequest::AttemptEscape {
            raw_roll: 20,
            escape_modifier: -20,
            encounter_escape_dc: 1,
        })
        .unwrap();
        assert!(!escape_twenty.succeeded());
        let escape_one = ResolutionResolver::resolve(ResolutionRequest::AttemptEscape {
            raw_roll: 1,
            escape_modifier: 20,
            encounter_escape_dc: 20,
        })
        .unwrap();
        assert!(escape_one.succeeded());
    }

    #[test]
    fn opposed_tie_defaults_to_defender_and_only_typed_override_changes_it() {
        let default = ResolutionResolver::resolve(ResolutionRequest::OpposedCheck {
            attacker_raw_roll: 20,
            attacker_modifier: -10,
            defender_raw_roll: 1,
            defender_modifier: 9,
            tie_rule: OpposedTieRule::DefenderWins,
        })
        .unwrap();
        assert!(!default.succeeded());

        let override_result = ResolutionResolver::resolve(ResolutionRequest::OpposedCheck {
            attacker_raw_roll: 20,
            attacker_modifier: -10,
            defender_raw_roll: 1,
            defender_modifier: 9,
            tie_rule: OpposedTieRule::AttackerWins,
        })
        .unwrap();
        assert!(override_result.succeeded());
    }

    #[test]
    fn conditional_check_supports_deterministic_or_d20_comparison_and_autohit_rolls_nothing() {
        let deterministic = ResolutionResolver::resolve(ResolutionRequest::ConditionalCheck {
            raw_roll: None,
            modifier: 12,
            threshold: 12,
            comparison: ConditionalComparison::GreaterThan,
        })
        .unwrap();
        assert!(!deterministic.succeeded());

        let rolled = ResolutionResolver::resolve(ResolutionRequest::ConditionalCheck {
            raw_roll: Some(20),
            modifier: -20,
            threshold: 1,
            comparison: ConditionalComparison::AtLeast,
        })
        .unwrap();
        assert!(!rolled.succeeded());

        let auto_hit = ResolutionResolver::resolve(ResolutionRequest::AutoHit {}).unwrap();
        assert!(auto_hit.succeeded());
        assert!(!auto_hit.critical());
        assert_eq!(auto_hit.resolution_type(), ResolutionType::AutoHit);
    }

    #[test]
    fn malformed_roll_range_and_overflow_fail_as_structured_errors() {
        assert!(matches!(
            ResolutionResolver::resolve(ResolutionRequest::SavingThrow {
                raw_roll: 0,
                defender_save_modifier: 0,
                ability_dc: 1,
            }),
            Err(ResolutionError {
                code: ResolutionErrorCode::InvalidD20,
                ..
            })
        ));
        assert!(matches!(
            ResolutionResolver::resolve(ResolutionRequest::AttackRoll {
                raw_roll: 10,
                attacker_modifier: 0,
                target_defense: 10,
                critical_range_minimum: 1,
                force_critical: false,
            }),
            Err(ResolutionError {
                code: ResolutionErrorCode::InvalidCriticalRange,
                ..
            })
        ));
        assert!(matches!(
            ResolutionResolver::resolve(ResolutionRequest::AttemptEscape {
                raw_roll: 20,
                escape_modifier: i64::MAX,
                encounter_escape_dc: 1,
            }),
            Err(ResolutionError {
                code: ResolutionErrorCode::ArithmeticOverflow,
                ..
            })
        ));
    }

    #[test]
    fn request_and_result_are_closed_exact_tagged_unions() {
        let encoded = serde_json::to_value(ResolutionRequest::AutoHit {}).unwrap();
        assert_eq!(encoded, serde_json::json!({ "type": "AUTO_HIT" }));
        assert!(
            serde_json::from_value::<ResolutionRequest>(serde_json::json!({
                "type": "AUTO_HIT",
                "plugin": "runtime-handler"
            }))
            .is_err()
        );
        assert!(
            serde_json::from_value::<ResolutionRequest>(serde_json::json!({
                "type": "CUSTOM_ROLL"
            }))
            .is_err()
        );
    }
}

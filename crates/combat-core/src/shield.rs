use std::{error::Error, fmt};

use serde::{Deserialize, Serialize};

use crate::{COMBAT_FIXED_SCALE, CombatFixed, DamageMitigationResult};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum ShieldInteraction {
    Absorb { damage_multiplier: CombatFixed },
    Bypass {},
    Disabled {},
}

impl ShieldInteraction {
    pub const fn standard() -> Self {
        Self::Absorb {
            damage_multiplier: CombatFixed::from_scaled(COMBAT_FIXED_SCALE),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ShieldResolutionRequest {
    pub rounded_incoming_damage: i64,
    pub current_shield: i64,
    pub interaction: ShieldInteraction,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ShieldResolutionResult {
    pub shield_damage: i64,
    pub shield_resource_loss: i64,
    pub remaining_after_shield: i64,
    pub resulting_shield: i64,
}

pub struct ShieldResolution;

impl ShieldResolution {
    pub fn resolve(
        request: ShieldResolutionRequest,
    ) -> Result<ShieldResolutionResult, ShieldResolutionError> {
        if request.rounded_incoming_damage < 0 || request.current_shield < 0 {
            return Err(shield_error(
                ShieldResolutionErrorCode::InvalidInput,
                "shieldResolutionRequest",
            ));
        }

        let (shield_damage, shield_resource_loss) = match request.interaction {
            ShieldInteraction::Bypass {} | ShieldInteraction::Disabled {} => (0, 0),
            ShieldInteraction::Absorb { damage_multiplier } => {
                if damage_multiplier.scaled() <= 0 {
                    return Err(shield_error(
                        ShieldResolutionErrorCode::InvalidMultiplier,
                        "damageMultiplier",
                    ));
                }
                let max_absorbable_damage = checked_floor_ratio(
                    request.current_shield,
                    COMBAT_FIXED_SCALE,
                    damage_multiplier.scaled(),
                )?;
                let shield_damage = request.rounded_incoming_damage.min(max_absorbable_damage);
                let mut shield_resource_loss = checked_ceil_ratio(
                    shield_damage,
                    damage_multiplier.scaled(),
                    COMBAT_FIXED_SCALE,
                )?
                .min(request.current_shield);
                if request.rounded_incoming_damage > 0
                    && request.current_shield > 0
                    && shield_damage == 0
                {
                    shield_resource_loss = request.current_shield;
                }
                (shield_damage, shield_resource_loss)
            }
        };

        let remaining_after_shield = request
            .rounded_incoming_damage
            .checked_sub(shield_damage)
            .ok_or_else(|| {
                shield_error(
                    ShieldResolutionErrorCode::NumericFailure,
                    "remainingAfterShield",
                )
            })?;
        let resulting_shield = request
            .current_shield
            .checked_sub(shield_resource_loss)
            .ok_or_else(|| {
                shield_error(ShieldResolutionErrorCode::NumericFailure, "resultingShield")
            })?;

        Ok(ShieldResolutionResult {
            shield_damage,
            shield_resource_loss,
            remaining_after_shield,
            resulting_shield,
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RechargeInterruptionPolicy {
    Default,
    Always,
    Never,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum DamageSourceRelation {
    Hostile,
    NonHostile,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RechargeInterruptionReason {
    HostileAppliedDamage,
    PolicyAlways,
    PolicyNever,
    NonHostileSource,
    NoAppliedDamage,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RechargeInterruptionDecision {
    pub policy: RechargeInterruptionPolicy,
    pub source_relation: DamageSourceRelation,
    pub interrupted: bool,
    pub reason: RechargeInterruptionReason,
}

pub struct ShieldRechargeEvaluator;

impl ShieldRechargeEvaluator {
    pub(crate) fn from_committed_damage(
        result: &DamageMitigationResult,
        source_relation: DamageSourceRelation,
        policy: RechargeInterruptionPolicy,
    ) -> RechargeInterruptionDecision {
        let (interrupted, reason) = match policy {
            RechargeInterruptionPolicy::Always => (true, RechargeInterruptionReason::PolicyAlways),
            RechargeInterruptionPolicy::Never => (false, RechargeInterruptionReason::PolicyNever),
            RechargeInterruptionPolicy::Default
                if source_relation == DamageSourceRelation::NonHostile =>
            {
                (false, RechargeInterruptionReason::NonHostileSource)
            }
            RechargeInterruptionPolicy::Default
                if result.shield_damage == 0 && result.hp_damage == 0 =>
            {
                (false, RechargeInterruptionReason::NoAppliedDamage)
            }
            RechargeInterruptionPolicy::Default => {
                (true, RechargeInterruptionReason::HostileAppliedDamage)
            }
        };
        RechargeInterruptionDecision {
            policy,
            source_relation,
            interrupted,
            reason,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ShieldResolutionErrorCode {
    InvalidInput,
    InvalidMultiplier,
    NumericFailure,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ShieldResolutionError {
    pub code: ShieldResolutionErrorCode,
    pub subject: String,
}

impl fmt::Display for ShieldResolutionError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "shield resolution failed for {}: {:?}",
            self.subject, self.code
        )
    }
}

impl Error for ShieldResolutionError {}

fn checked_floor_ratio(
    value: i64,
    multiplier: i64,
    divisor: i64,
) -> Result<i64, ShieldResolutionError> {
    let numerator = i128::from(value)
        .checked_mul(i128::from(multiplier))
        .ok_or_else(|| shield_error(ShieldResolutionErrorCode::NumericFailure, "floorRatio"))?;
    i64::try_from(numerator / i128::from(divisor))
        .map_err(|_| shield_error(ShieldResolutionErrorCode::NumericFailure, "floorRatio"))
}

fn checked_ceil_ratio(
    value: i64,
    multiplier: i64,
    divisor: i64,
) -> Result<i64, ShieldResolutionError> {
    let numerator = i128::from(value)
        .checked_mul(i128::from(multiplier))
        .ok_or_else(|| shield_error(ShieldResolutionErrorCode::NumericFailure, "ceilRatio"))?;
    let adjusted = numerator
        .checked_add(i128::from(divisor) - 1)
        .ok_or_else(|| shield_error(ShieldResolutionErrorCode::NumericFailure, "ceilRatio"))?;
    i64::try_from(adjusted / i128::from(divisor))
        .map_err(|_| shield_error(ShieldResolutionErrorCode::NumericFailure, "ceilRatio"))
}

fn shield_error(
    code: ShieldResolutionErrorCode,
    subject: impl Into<String>,
) -> ShieldResolutionError {
    ShieldResolutionError {
        code,
        subject: subject.into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn standard_and_emp_multipliers_follow_frozen_integer_equations() {
        let standard = ShieldResolution::resolve(ShieldResolutionRequest {
            rounded_incoming_damage: 8,
            current_shield: 5,
            interaction: ShieldInteraction::standard(),
        })
        .unwrap();
        assert_eq!(
            (standard.shield_damage, standard.shield_resource_loss),
            (5, 5)
        );
        assert_eq!(
            (standard.remaining_after_shield, standard.resulting_shield),
            (3, 0)
        );

        let emp = ShieldResolution::resolve(ShieldResolutionRequest {
            rounded_incoming_damage: 5,
            current_shield: 7,
            interaction: ShieldInteraction::Absorb {
                damage_multiplier: CombatFixed::from_scaled(2_000_000),
            },
        })
        .unwrap();
        assert_eq!((emp.shield_damage, emp.shield_resource_loss), (3, 6));
        assert_eq!((emp.remaining_after_shield, emp.resulting_shield), (2, 1));
    }

    #[test]
    fn insufficient_fractional_shield_is_consumed_without_absorbing_damage() {
        let result = ShieldResolution::resolve(ShieldResolutionRequest {
            rounded_incoming_damage: 1,
            current_shield: 1,
            interaction: ShieldInteraction::Absorb {
                damage_multiplier: CombatFixed::from_scaled(2_000_000),
            },
        })
        .unwrap();
        assert_eq!((result.shield_damage, result.shield_resource_loss), (0, 1));
        assert_eq!(
            (result.remaining_after_shield, result.resulting_shield),
            (1, 0)
        );
    }

    #[test]
    fn bypass_and_disabled_leave_shield_resource_untouched() {
        for interaction in [ShieldInteraction::Bypass {}, ShieldInteraction::Disabled {}] {
            let result = ShieldResolution::resolve(ShieldResolutionRequest {
                rounded_incoming_damage: 4,
                current_shield: 9,
                interaction,
            })
            .unwrap();
            assert_eq!((result.shield_damage, result.shield_resource_loss), (0, 0));
            assert_eq!(
                (result.remaining_after_shield, result.resulting_shield),
                (4, 9)
            );
        }
    }

    #[test]
    fn invalid_inputs_and_nonpositive_multiplier_are_rejected() {
        assert_eq!(
            ShieldResolution::resolve(ShieldResolutionRequest {
                rounded_incoming_damage: -1,
                current_shield: 0,
                interaction: ShieldInteraction::standard(),
            })
            .unwrap_err()
            .code,
            ShieldResolutionErrorCode::InvalidInput
        );
        assert_eq!(
            ShieldResolution::resolve(ShieldResolutionRequest {
                rounded_incoming_damage: 1,
                current_shield: 1,
                interaction: ShieldInteraction::Absorb {
                    damage_multiplier: CombatFixed::from_scaled(0),
                },
            })
            .unwrap_err()
            .code,
            ShieldResolutionErrorCode::InvalidMultiplier
        );
    }
}

use std::{error::Error, fmt};

use serde::{Deserialize, Serialize};

pub const COMBAT_FIXED_SCALE: i64 = 1_000_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(transparent)]
pub struct CombatFixed(i64);

impl CombatFixed {
    #[must_use]
    pub const fn from_scaled(value: i64) -> Self {
        Self(value)
    }

    pub fn from_integer(value: i64) -> Result<Self, CombatNumericError> {
        let scaled = i128::from(value)
            .checked_mul(i128::from(COMBAT_FIXED_SCALE))
            .ok_or_else(|| numeric_error(CombatNumericErrorCode::Overflow, "from-integer"))?;
        Ok(Self(to_i64(scaled, "from-integer")?))
    }

    #[must_use]
    pub const fn scaled(self) -> i64 {
        self.0
    }

    pub fn checked_add(self, other: Self) -> Result<Self, CombatNumericError> {
        self.0
            .checked_add(other.0)
            .map(Self)
            .ok_or_else(|| numeric_error(CombatNumericErrorCode::Overflow, "fixed-add"))
    }

    pub fn checked_sub(self, other: Self) -> Result<Self, CombatNumericError> {
        self.0
            .checked_sub(other.0)
            .map(Self)
            .ok_or_else(|| numeric_error(CombatNumericErrorCode::Overflow, "fixed-subtract"))
    }

    pub fn clamp(self, minimum: Self, maximum: Self) -> Result<Self, CombatNumericError> {
        if minimum > maximum {
            return Err(numeric_error(
                CombatNumericErrorCode::InvalidBounds,
                "fixed-clamp",
            ));
        }
        Ok(Self(self.0.clamp(minimum.0, maximum.0)))
    }

    pub fn require_nonnegative(self, subject: &str) -> Result<Self, CombatNumericError> {
        if self.0 < 0 {
            Err(numeric_error(
                CombatNumericErrorCode::NegativeInput,
                subject,
            ))
        } else {
            Ok(self)
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CombatNumericErrorCode {
    NegativeInput,
    DivisionByZero,
    InvalidBounds,
    Overflow,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CombatNumericError {
    pub code: CombatNumericErrorCode,
    pub operation: String,
}

impl fmt::Display for CombatNumericError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "combat numeric operation {} failed: {:?}",
            self.operation, self.code
        )
    }
}

impl Error for CombatNumericError {}

pub struct CombatNumeric;

impl CombatNumeric {
    pub fn fixed_mul_floor(value: i64, multiplier: CombatFixed) -> Result<i64, CombatNumericError> {
        require_nonnegative_i64(value, "fixed-mul-value")?;
        multiplier.require_nonnegative("fixed-mul-multiplier")?;
        let numerator = i128::from(value)
            .checked_mul(i128::from(multiplier.scaled()))
            .ok_or_else(|| numeric_error(CombatNumericErrorCode::Overflow, "fixed-mul"))?;
        to_i64(numerator / i128::from(COMBAT_FIXED_SCALE), "fixed-mul")
    }

    pub fn fixed_scalar_mul_floor(
        left: CombatFixed,
        right: CombatFixed,
    ) -> Result<CombatFixed, CombatNumericError> {
        left.require_nonnegative("fixed-scalar-left")?;
        right.require_nonnegative("fixed-scalar-right")?;
        let numerator = i128::from(left.scaled())
            .checked_mul(i128::from(right.scaled()))
            .ok_or_else(|| numeric_error(CombatNumericErrorCode::Overflow, "fixed-scalar-mul"))?;
        Ok(CombatFixed::from_scaled(to_i64(
            numerator / i128::from(COMBAT_FIXED_SCALE),
            "fixed-scalar-mul",
        )?))
    }

    pub fn ratio_fixed_floor(
        numerator: i64,
        denominator: i64,
    ) -> Result<CombatFixed, CombatNumericError> {
        require_nonnegative_i64(numerator, "ratio-numerator")?;
        if denominator <= 0 {
            return Err(numeric_error(
                if denominator == 0 {
                    CombatNumericErrorCode::DivisionByZero
                } else {
                    CombatNumericErrorCode::NegativeInput
                },
                "ratio-denominator",
            ));
        }
        let scaled = i128::from(numerator)
            .checked_mul(i128::from(COMBAT_FIXED_SCALE))
            .ok_or_else(|| numeric_error(CombatNumericErrorCode::Overflow, "ratio"))?
            / i128::from(denominator);
        Ok(CombatFixed::from_scaled(to_i64(scaled, "ratio")?))
    }

    pub fn ceil_div(numerator: i64, denominator: i64) -> Result<i64, CombatNumericError> {
        require_nonnegative_i64(numerator, "ceil-div-numerator")?;
        if denominator <= 0 {
            return Err(numeric_error(
                if denominator == 0 {
                    CombatNumericErrorCode::DivisionByZero
                } else {
                    CombatNumericErrorCode::NegativeInput
                },
                "ceil-div-denominator",
            ));
        }
        let quotient = numerator / denominator;
        let remainder = numerator % denominator;
        if remainder == 0 {
            Ok(quotient)
        } else {
            quotient
                .checked_add(1)
                .ok_or_else(|| numeric_error(CombatNumericErrorCode::Overflow, "ceil-div"))
        }
    }

    pub fn percent_integer_floor(
        reference: i64,
        percent: CombatFixed,
    ) -> Result<i64, CombatNumericError> {
        Self::fixed_mul_floor(reference, percent)
    }

    pub fn percent_restore_at_least_one(
        effective_maximum: i64,
        percent: CombatFixed,
    ) -> Result<i64, CombatNumericError> {
        if effective_maximum <= 0 {
            return Err(numeric_error(
                CombatNumericErrorCode::InvalidBounds,
                "percent-restore-maximum",
            ));
        }
        Ok(Self::percent_integer_floor(effective_maximum, percent)?.max(1))
    }

    pub fn hard_cc_duration_single_ceil(
        base_duration: i64,
        resistance_multiplier: CombatFixed,
        dr_multiplier: CombatFixed,
    ) -> Result<i64, CombatNumericError> {
        if base_duration <= 0 {
            return Err(numeric_error(
                CombatNumericErrorCode::InvalidBounds,
                "hard-cc-base-duration",
            ));
        }
        resistance_multiplier.require_nonnegative("hard-cc-resistance")?;
        dr_multiplier.require_nonnegative("hard-cc-dr")?;
        let numerator = i128::from(base_duration)
            .checked_mul(i128::from(resistance_multiplier.scaled()))
            .and_then(|value| value.checked_mul(i128::from(dr_multiplier.scaled())))
            .ok_or_else(|| numeric_error(CombatNumericErrorCode::Overflow, "hard-cc-duration"))?;
        let scale_squared = i128::from(COMBAT_FIXED_SCALE)
            .checked_mul(i128::from(COMBAT_FIXED_SCALE))
            .expect("fixed scale square fits i128");
        let duration = ceil_div_i128(numerator, scale_squared, "hard-cc-duration")?;
        Ok(to_i64(duration, "hard-cc-duration")?.max(1))
    }

    pub fn damage_fixed_to_integer_floor(
        precise_damage: CombatFixed,
    ) -> Result<i64, CombatNumericError> {
        precise_damage.require_nonnegative("damage-floor")?;
        Ok(precise_damage.scaled() / COMBAT_FIXED_SCALE)
    }
}

fn ceil_div_i128(
    numerator: i128,
    denominator: i128,
    operation: &str,
) -> Result<i128, CombatNumericError> {
    if numerator < 0 {
        return Err(numeric_error(
            CombatNumericErrorCode::NegativeInput,
            operation,
        ));
    }
    if denominator <= 0 {
        return Err(numeric_error(
            CombatNumericErrorCode::DivisionByZero,
            operation,
        ));
    }
    let quotient = numerator / denominator;
    if numerator % denominator == 0 {
        Ok(quotient)
    } else {
        quotient
            .checked_add(1)
            .ok_or_else(|| numeric_error(CombatNumericErrorCode::Overflow, operation))
    }
}

fn require_nonnegative_i64(value: i64, operation: &str) -> Result<(), CombatNumericError> {
    if value < 0 {
        Err(numeric_error(
            CombatNumericErrorCode::NegativeInput,
            operation,
        ))
    } else {
        Ok(())
    }
}

fn to_i64(value: i128, operation: &str) -> Result<i64, CombatNumericError> {
    i64::try_from(value).map_err(|_| numeric_error(CombatNumericErrorCode::Overflow, operation))
}

fn numeric_error(code: CombatNumericErrorCode, operation: &str) -> CombatNumericError {
    CombatNumericError {
        code,
        operation: operation.to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct NumericFixture {
        combat_fixed_scale: i64,
        fixed_mul_floor: Vec<FixedMulCase>,
        fixed_scalar_mul_floor: Vec<FixedScalarMulCase>,
        ratio_fixed_floor: Vec<RatioCase>,
        ceil_div: Vec<DivisionCase>,
        percent_integer_floor: Vec<PercentCase>,
        percent_restore_at_least_one: Vec<RestoreCase>,
        hard_cc_duration_single_ceil: Vec<HardCcCase>,
        damage_floor: Vec<DamageFloorCase>,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct FixedMulCase {
        value: i64,
        multiplier_fixed: i64,
        expected: i64,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct FixedScalarMulCase {
        left_fixed: i64,
        right_fixed: i64,
        expected_fixed: i64,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct RatioCase {
        numerator: i64,
        denominator: i64,
        expected_fixed: i64,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct DivisionCase {
        numerator: i64,
        denominator: i64,
        expected: i64,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct PercentCase {
        reference: i64,
        percent_fixed: i64,
        expected: i64,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct RestoreCase {
        effective_maximum: i64,
        percent_fixed: i64,
        expected: i64,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct HardCcCase {
        base_duration: i64,
        resistance_fixed: i64,
        dr_fixed: i64,
        expected: i64,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct DamageFloorCase {
        precise_damage_fixed: i64,
        expected: i64,
    }

    #[test]
    fn shared_exact_value_fixture_locks_every_rounding_contract() {
        let fixture: NumericFixture =
            serde_json::from_str(include_str!("../test-fixtures/combat-numeric-v1.json")).unwrap();
        assert_eq!(fixture.combat_fixed_scale, COMBAT_FIXED_SCALE);

        for case in fixture.fixed_mul_floor {
            assert_eq!(
                CombatNumeric::fixed_mul_floor(
                    case.value,
                    CombatFixed::from_scaled(case.multiplier_fixed),
                )
                .unwrap(),
                case.expected
            );
        }
        for case in fixture.fixed_scalar_mul_floor {
            assert_eq!(
                CombatNumeric::fixed_scalar_mul_floor(
                    CombatFixed::from_scaled(case.left_fixed),
                    CombatFixed::from_scaled(case.right_fixed),
                )
                .unwrap()
                .scaled(),
                case.expected_fixed
            );
        }
        for case in fixture.ratio_fixed_floor {
            assert_eq!(
                CombatNumeric::ratio_fixed_floor(case.numerator, case.denominator)
                    .unwrap()
                    .scaled(),
                case.expected_fixed
            );
        }
        for case in fixture.ceil_div {
            assert_eq!(
                CombatNumeric::ceil_div(case.numerator, case.denominator).unwrap(),
                case.expected
            );
        }
        for case in fixture.percent_integer_floor {
            assert_eq!(
                CombatNumeric::percent_integer_floor(
                    case.reference,
                    CombatFixed::from_scaled(case.percent_fixed),
                )
                .unwrap(),
                case.expected
            );
        }
        for case in fixture.percent_restore_at_least_one {
            assert_eq!(
                CombatNumeric::percent_restore_at_least_one(
                    case.effective_maximum,
                    CombatFixed::from_scaled(case.percent_fixed),
                )
                .unwrap(),
                case.expected
            );
        }
        for case in fixture.hard_cc_duration_single_ceil {
            assert_eq!(
                CombatNumeric::hard_cc_duration_single_ceil(
                    case.base_duration,
                    CombatFixed::from_scaled(case.resistance_fixed),
                    CombatFixed::from_scaled(case.dr_fixed),
                )
                .unwrap(),
                case.expected
            );
        }
        for case in fixture.damage_floor {
            assert_eq!(
                CombatNumeric::damage_fixed_to_integer_floor(CombatFixed::from_scaled(
                    case.precise_damage_fixed,
                ))
                .unwrap(),
                case.expected
            );
        }
    }

    #[test]
    fn hard_cc_combines_all_multipliers_before_its_only_ceil() {
        let combined = CombatNumeric::hard_cc_duration_single_ceil(
            2,
            CombatFixed::from_scaled(550_000),
            CombatFixed::from_scaled(900_000),
        )
        .unwrap();
        let incorrectly_rounded_between_steps = CombatNumeric::ceil_div(2 * 550_000, 1_000_000)
            .and_then(|first| CombatNumeric::ceil_div(first * 900_000, 1_000_000))
            .unwrap();

        assert_eq!(combined, 1);
        assert_eq!(incorrectly_rounded_between_steps, 2);
    }

    #[test]
    fn arithmetic_rejects_negative_division_bounds_and_overflow_instead_of_wrapping() {
        assert!(matches!(
            CombatNumeric::fixed_mul_floor(-1, CombatFixed::from_scaled(COMBAT_FIXED_SCALE)),
            Err(CombatNumericError {
                code: CombatNumericErrorCode::NegativeInput,
                ..
            })
        ));
        assert!(matches!(
            CombatNumeric::ratio_fixed_floor(1, 0),
            Err(CombatNumericError {
                code: CombatNumericErrorCode::DivisionByZero,
                ..
            })
        ));
        assert!(matches!(
            CombatNumeric::ceil_div(1, -1),
            Err(CombatNumericError {
                code: CombatNumericErrorCode::NegativeInput,
                ..
            })
        ));
        assert!(matches!(
            CombatNumeric::percent_restore_at_least_one(0, CombatFixed::from_scaled(300_000),),
            Err(CombatNumericError {
                code: CombatNumericErrorCode::InvalidBounds,
                ..
            })
        ));
        assert!(matches!(
            CombatFixed::from_integer(i64::MAX),
            Err(CombatNumericError {
                code: CombatNumericErrorCode::Overflow,
                ..
            })
        ));
        assert!(matches!(
            CombatFixed::from_scaled(i64::MAX).checked_add(CombatFixed::from_scaled(1)),
            Err(CombatNumericError {
                code: CombatNumericErrorCode::Overflow,
                ..
            })
        ));
        assert!(matches!(
            CombatFixed::from_scaled(2)
                .clamp(CombatFixed::from_scaled(3), CombatFixed::from_scaled(1),),
            Err(CombatNumericError {
                code: CombatNumericErrorCode::InvalidBounds,
                ..
            })
        ));
    }

    #[test]
    fn signed_fixed_adjustments_are_exact_but_state_writes_require_nonnegative_inputs() {
        let resistance = CombatFixed::from_scaled(200_000)
            .checked_sub(CombatFixed::from_scaled(350_000))
            .unwrap()
            .clamp(
                CombatFixed::from_scaled(-500_000),
                CombatFixed::from_scaled(800_000),
            )
            .unwrap();
        assert_eq!(resistance.scaled(), -150_000);
        assert!(
            CombatNumeric::fixed_scalar_mul_floor(
                resistance,
                CombatFixed::from_scaled(COMBAT_FIXED_SCALE),
            )
            .is_err()
        );
    }
}

use std::{error::Error, fmt};

use serde::{Deserialize, Serialize};

use crate::{
    COMBAT_FIXED_SCALE, CombatFixed, CombatNumeric, CombatNumericError, DamageChannelId,
    ResolutionResult,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PrimaryMitigation {
    Armor,
    Resistance,
    None,
}

/// Read-only profile boundary implemented by the M5 resolved WorldCombatProfile.
/// Returning `None` means the profile does not support the channel.
pub trait DamageDefenseProfile {
    fn primary_mitigation_for(&self, channel_id: &DamageChannelId) -> Option<PrimaryMitigation>;
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum DamageImmunity {
    NotImmune {},
    Immune { rule_id: String },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ZeroDamageReason {
    Missed,
    Immune,
    UnableToPenetrateDefense,
    Blocked,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MitigationBalanceConfig {
    pub armor_k: i64,
    pub max_armor_dr: CombatFixed,
    pub max_resistance: CombatFixed,
    pub max_weakness: CombatFixed,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DamageMitigationRequest<'a> {
    pub attack_resolution: &'a ResolutionResult,
    pub channel_id: &'a DamageChannelId,
    pub raw_modified_damage: CombatFixed,
    pub target_armor: i64,
    pub armor_penetration_percent: CombatFixed,
    pub armor_penetration_flat: i64,
    pub base_channel_resistance: CombatFixed,
    pub resistance_penetration: CombatFixed,
    pub immunity: DamageImmunity,
    pub current_shield: i64,
    pub current_hit_points: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DamageMitigationResult {
    pub channel_id: DamageChannelId,
    pub primary_mitigation: Option<PrimaryMitigation>,
    pub raw_modified_damage: CombatFixed,
    pub effective_armor: Option<i64>,
    pub armor_dr: Option<CombatFixed>,
    pub effective_channel_resistance: Option<CombatFixed>,
    pub post_mitigation_damage: CombatFixed,
    pub rounded_incoming_damage: i64,
    pub shield_damage: i64,
    pub shield_resource_loss: i64,
    pub hp_damage: i64,
    pub overkill_damage: i64,
    pub resulting_shield: i64,
    pub resulting_hit_points: i64,
    pub was_immune: bool,
    pub was_blocked: bool,
    pub zero_damage_reason: Option<ZeroDamageReason>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MitigationErrorCode {
    UnsupportedResolution,
    UnsupportedChannel,
    InvalidImmunityRuleId,
    InvalidBalanceConfig,
    InvalidDamageInput,
    NumericFailure,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MitigationError {
    pub code: MitigationErrorCode,
    pub subject: String,
}

impl fmt::Display for MitigationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "damage mitigation failed for {}: {:?}",
            self.subject, self.code
        )
    }
}

impl Error for MitigationError {}

pub struct MitigationPipeline;

impl MitigationPipeline {
    pub fn resolve<P: DamageDefenseProfile>(
        profile: &P,
        balance: &MitigationBalanceConfig,
        request: DamageMitigationRequest<'_>,
    ) -> Result<DamageMitigationResult, MitigationError> {
        validate_balance(balance)?;
        validate_request(&request)?;

        let hit = match request.attack_resolution {
            ResolutionResult::AttackRoll { hit, .. } | ResolutionResult::AutoHit { hit, .. } => {
                *hit
            }
            ResolutionResult::SavingThrow { .. }
            | ResolutionResult::OpposedCheck { .. }
            | ResolutionResult::ConditionalCheck { .. }
            | ResolutionResult::AttemptEscape { .. } => {
                return Err(mitigation_error(
                    MitigationErrorCode::UnsupportedResolution,
                    "attackResolution",
                ));
            }
        };

        if !hit {
            return Ok(zero_result(&request, None, false, ZeroDamageReason::Missed));
        }

        let primary_mitigation = profile
            .primary_mitigation_for(request.channel_id)
            .ok_or_else(|| {
                mitigation_error(
                    MitigationErrorCode::UnsupportedChannel,
                    request.channel_id.as_str(),
                )
            })?;

        if let DamageImmunity::Immune { rule_id } = &request.immunity {
            validate_stable_id(rule_id).map_err(|()| {
                mitigation_error(MitigationErrorCode::InvalidImmunityRuleId, rule_id)
            })?;
            return Ok(zero_result(
                &request,
                Some(primary_mitigation),
                true,
                ZeroDamageReason::Immune,
            ));
        }

        let mut effective_armor = None;
        let mut armor_dr = None;
        let mut effective_channel_resistance = None;

        let post_mitigation_damage = match primary_mitigation {
            PrimaryMitigation::Armor => {
                let after_percent = CombatNumeric::fixed_mul_floor(
                    request.target_armor,
                    CombatFixed::from_scaled(COMBAT_FIXED_SCALE)
                        .checked_sub(request.armor_penetration_percent)
                        .map_err(numeric_failure)?,
                )
                .map_err(numeric_failure)?;
                let effective = after_percent
                    .checked_sub(request.armor_penetration_flat)
                    .ok_or_else(|| {
                        mitigation_error(MitigationErrorCode::NumericFailure, "effectiveArmor")
                    })?
                    .max(0);
                let denominator = effective.checked_add(balance.armor_k).ok_or_else(|| {
                    mitigation_error(MitigationErrorCode::NumericFailure, "armorDenominator")
                })?;
                let dr = CombatNumeric::ratio_fixed_floor(effective, denominator)
                    .map_err(numeric_failure)?
                    .clamp(CombatFixed::from_scaled(0), balance.max_armor_dr)
                    .map_err(numeric_failure)?;
                let multiplier = CombatFixed::from_scaled(COMBAT_FIXED_SCALE)
                    .checked_sub(dr)
                    .map_err(numeric_failure)?;
                effective_armor = Some(effective);
                armor_dr = Some(dr);
                CombatNumeric::fixed_scalar_mul_floor(request.raw_modified_damage, multiplier)
                    .map_err(numeric_failure)?
            }
            PrimaryMitigation::Resistance => {
                let base = request.base_channel_resistance.scaled();
                let penetrated = if base > 0 {
                    base.checked_sub(request.resistance_penetration.scaled())
                        .ok_or_else(|| {
                            mitigation_error(
                                MitigationErrorCode::NumericFailure,
                                "resistancePenetration",
                            )
                        })?
                        .max(0)
                } else {
                    base
                };
                let effective = CombatFixed::from_scaled(penetrated)
                    .clamp(
                        CombatFixed::from_scaled(
                            balance.max_weakness.scaled().checked_neg().ok_or_else(|| {
                                mitigation_error(MitigationErrorCode::NumericFailure, "maxWeakness")
                            })?,
                        ),
                        balance.max_resistance,
                    )
                    .map_err(numeric_failure)?;
                let multiplier = CombatFixed::from_scaled(COMBAT_FIXED_SCALE)
                    .checked_sub(effective)
                    .map_err(numeric_failure)?;
                effective_channel_resistance = Some(effective);
                CombatNumeric::fixed_scalar_mul_floor(request.raw_modified_damage, multiplier)
                    .map_err(numeric_failure)?
            }
            PrimaryMitigation::None => request.raw_modified_damage,
        };

        let rounded_incoming_damage =
            CombatNumeric::damage_fixed_to_integer_floor(post_mitigation_damage)
                .map_err(numeric_failure)?;
        let shield_damage = request.current_shield.min(rounded_incoming_damage);
        let remaining_after_shield = rounded_incoming_damage
            .checked_sub(shield_damage)
            .ok_or_else(|| mitigation_error(MitigationErrorCode::NumericFailure, "shieldDamage"))?;
        let hp_damage = request.current_hit_points.min(remaining_after_shield);
        let overkill_damage = remaining_after_shield
            .checked_sub(hp_damage)
            .ok_or_else(|| {
                mitigation_error(MitigationErrorCode::NumericFailure, "overkillDamage")
            })?;
        let resulting_shield = request
            .current_shield
            .checked_sub(shield_damage)
            .ok_or_else(|| {
                mitigation_error(MitigationErrorCode::NumericFailure, "resultingShield")
            })?;
        let resulting_hit_points = request
            .current_hit_points
            .checked_sub(hp_damage)
            .ok_or_else(|| {
                mitigation_error(MitigationErrorCode::NumericFailure, "resultingHitPoints")
            })?;
        let zero_damage_reason =
            (rounded_incoming_damage == 0).then_some(match primary_mitigation {
                PrimaryMitigation::Armor => ZeroDamageReason::UnableToPenetrateDefense,
                PrimaryMitigation::Resistance | PrimaryMitigation::None => {
                    ZeroDamageReason::Blocked
                }
            });

        Ok(DamageMitigationResult {
            channel_id: request.channel_id.clone(),
            primary_mitigation: Some(primary_mitigation),
            raw_modified_damage: request.raw_modified_damage,
            effective_armor,
            armor_dr,
            effective_channel_resistance,
            post_mitigation_damage,
            rounded_incoming_damage,
            shield_damage,
            shield_resource_loss: shield_damage,
            hp_damage,
            overkill_damage,
            resulting_shield,
            resulting_hit_points,
            was_immune: false,
            was_blocked: rounded_incoming_damage == 0,
            zero_damage_reason,
        })
    }
}

fn zero_result(
    request: &DamageMitigationRequest<'_>,
    primary_mitigation: Option<PrimaryMitigation>,
    was_immune: bool,
    reason: ZeroDamageReason,
) -> DamageMitigationResult {
    DamageMitigationResult {
        channel_id: request.channel_id.clone(),
        primary_mitigation,
        raw_modified_damage: request.raw_modified_damage,
        effective_armor: None,
        armor_dr: None,
        effective_channel_resistance: None,
        post_mitigation_damage: CombatFixed::from_scaled(0),
        rounded_incoming_damage: 0,
        shield_damage: 0,
        shield_resource_loss: 0,
        hp_damage: 0,
        overkill_damage: 0,
        resulting_shield: request.current_shield,
        resulting_hit_points: request.current_hit_points,
        was_immune,
        was_blocked: !was_immune && reason != ZeroDamageReason::Missed,
        zero_damage_reason: Some(reason),
    }
}

fn validate_balance(balance: &MitigationBalanceConfig) -> Result<(), MitigationError> {
    if balance.armor_k <= 0
        || !(0..=COMBAT_FIXED_SCALE).contains(&balance.max_armor_dr.scaled())
        || !(0..COMBAT_FIXED_SCALE).contains(&balance.max_resistance.scaled())
        || !(0..=COMBAT_FIXED_SCALE).contains(&balance.max_weakness.scaled())
    {
        return Err(mitigation_error(
            MitigationErrorCode::InvalidBalanceConfig,
            "balanceConfig",
        ));
    }
    Ok(())
}

fn validate_request(request: &DamageMitigationRequest<'_>) -> Result<(), MitigationError> {
    let nonnegative_fixed = [
        request.raw_modified_damage,
        request.armor_penetration_percent,
        request.resistance_penetration,
    ];
    if request.target_armor < 0
        || request.armor_penetration_flat < 0
        || request.current_shield < 0
        || request.current_hit_points < 0
        || nonnegative_fixed.iter().any(|value| value.scaled() < 0)
        || request.armor_penetration_percent.scaled() > COMBAT_FIXED_SCALE
    {
        return Err(mitigation_error(
            MitigationErrorCode::InvalidDamageInput,
            request.channel_id.as_str(),
        ));
    }
    Ok(())
}

fn validate_stable_id(value: &str) -> Result<(), ()> {
    if value.is_empty()
        || !value.bytes().enumerate().all(|(index, byte)| {
            byte.is_ascii_lowercase()
                || byte.is_ascii_digit() && index > 0
                || matches!(byte, b'-' | b'.') && index > 0 && index + 1 < value.len()
        })
    {
        Err(())
    } else {
        Ok(())
    }
}

fn numeric_failure(error: CombatNumericError) -> MitigationError {
    mitigation_error(MitigationErrorCode::NumericFailure, error.operation)
}

fn mitigation_error(code: MitigationErrorCode, subject: impl Into<String>) -> MitigationError {
    MitigationError {
        code,
        subject: subject.into(),
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use super::*;

    struct TestProfile(BTreeMap<DamageChannelId, PrimaryMitigation>);

    impl TestProfile {
        fn new(entries: &[(&str, PrimaryMitigation)]) -> Self {
            Self(
                entries
                    .iter()
                    .map(|(id, mitigation)| (DamageChannelId::new(*id).unwrap(), *mitigation))
                    .collect(),
            )
        }
    }

    impl DamageDefenseProfile for TestProfile {
        fn primary_mitigation_for(
            &self,
            channel_id: &DamageChannelId,
        ) -> Option<PrimaryMitigation> {
            self.0.get(channel_id).copied()
        }
    }

    fn fixed(value: i64) -> CombatFixed {
        CombatFixed::from_scaled(value)
    }

    fn balance() -> MitigationBalanceConfig {
        MitigationBalanceConfig {
            armor_k: 100,
            max_armor_dr: fixed(800_000),
            max_resistance: fixed(800_000),
            max_weakness: fixed(1_000_000),
        }
    }

    fn hit() -> ResolutionResult {
        ResolutionResult::AttackRoll {
            raw_roll: 12,
            total: 20,
            target_defense: 15,
            hit: true,
            critical: false,
        }
    }

    fn request<'a>(
        resolution: &'a ResolutionResult,
        channel: &'a DamageChannelId,
    ) -> DamageMitigationRequest<'a> {
        DamageMitigationRequest {
            attack_resolution: resolution,
            channel_id: channel,
            raw_modified_damage: fixed(100_000_000),
            target_armor: 0,
            armor_penetration_percent: fixed(0),
            armor_penetration_flat: 0,
            base_channel_resistance: fixed(0),
            resistance_penetration: fixed(0),
            immunity: DamageImmunity::NotImmune {},
            current_shield: 0,
            current_hit_points: 200,
        }
    }

    #[test]
    fn miss_stops_before_profile_lookup_and_preserves_resources() {
        struct NoLookup;
        impl DamageDefenseProfile for NoLookup {
            fn primary_mitigation_for(
                &self,
                _channel_id: &DamageChannelId,
            ) -> Option<PrimaryMitigation> {
                panic!("miss must not query mitigation")
            }
        }

        let resolution = ResolutionResult::AttackRoll {
            raw_roll: 1,
            total: 99,
            target_defense: 1,
            hit: false,
            critical: false,
        };
        let channel = DamageChannelId::new("physical").unwrap();
        let mut request = request(&resolution, &channel);
        request.current_shield = 7;
        request.current_hit_points = 20;
        let result = MitigationPipeline::resolve(&NoLookup, &balance(), request).unwrap();

        assert_eq!(result.primary_mitigation, None);
        assert_eq!(result.zero_damage_reason, Some(ZeroDamageReason::Missed));
        assert_eq!(
            (result.resulting_shield, result.resulting_hit_points),
            (7, 20)
        );
    }

    #[test]
    fn armor_formula_uses_only_armor_penetration_then_rounds_once_and_spills() {
        let profile = TestProfile::new(&[("physical", PrimaryMitigation::Armor)]);
        let resolution = hit();
        let channel = DamageChannelId::new("physical").unwrap();
        let mut request = request(&resolution, &channel);
        request.target_armor = 100;
        request.armor_penetration_percent = fixed(250_000);
        request.armor_penetration_flat = 5;
        request.base_channel_resistance = fixed(800_000);
        request.resistance_penetration = fixed(800_000);
        request.current_shield = 10;
        request.current_hit_points = 40;

        let result = MitigationPipeline::resolve(&profile, &balance(), request).unwrap();
        assert_eq!(result.effective_armor, Some(70));
        assert_eq!(result.armor_dr, Some(fixed(411_764)));
        assert_eq!(result.effective_channel_resistance, None);
        assert_eq!(result.post_mitigation_damage, fixed(58_823_600));
        assert_eq!(result.rounded_incoming_damage, 58);
        assert_eq!(
            (
                result.shield_damage,
                result.hp_damage,
                result.overkill_damage
            ),
            (10, 40, 8)
        );
        assert_eq!(
            (result.resulting_shield, result.resulting_hit_points),
            (0, 0)
        );
    }

    #[test]
    fn resistance_formula_ignores_armor_and_penetration_never_creates_weakness() {
        let profile = TestProfile::new(&[("fire", PrimaryMitigation::Resistance)]);
        let resolution = hit();
        let channel = DamageChannelId::new("fire").unwrap();
        let mut request = request(&resolution, &channel);
        request.target_armor = i64::MAX;
        request.base_channel_resistance = fixed(100_000);
        request.resistance_penetration = fixed(300_000);

        let result = MitigationPipeline::resolve(&profile, &balance(), request).unwrap();
        assert_eq!(result.effective_armor, None);
        assert_eq!(result.effective_channel_resistance, Some(fixed(0)));
        assert_eq!(result.rounded_incoming_damage, 100);
    }

    #[test]
    fn resistance_caps_and_preserves_existing_weakness_under_penetration() {
        let profile = TestProfile::new(&[("fire", PrimaryMitigation::Resistance)]);
        let resolution = hit();
        let channel = DamageChannelId::new("fire").unwrap();

        let mut weak = request(&resolution, &channel);
        weak.base_channel_resistance = fixed(-1_500_000);
        weak.resistance_penetration = fixed(900_000);
        let result = MitigationPipeline::resolve(&profile, &balance(), weak).unwrap();
        assert_eq!(result.effective_channel_resistance, Some(fixed(-1_000_000)));
        assert_eq!(result.rounded_incoming_damage, 200);

        let mut resistant = request(&resolution, &channel);
        resistant.base_channel_resistance = fixed(990_000);
        let result = MitigationPipeline::resolve(&profile, &balance(), resistant).unwrap();
        assert_eq!(result.effective_channel_resistance, Some(fixed(800_000)));
        assert_eq!(result.rounded_incoming_damage, 20);
    }

    #[test]
    fn explicit_immunity_is_distinct_from_resistance_and_preserves_state() {
        let profile = TestProfile::new(&[("fire", PrimaryMitigation::Resistance)]);
        let resolution = hit();
        let channel = DamageChannelId::new("fire").unwrap();
        let mut request = request(&resolution, &channel);
        request.base_channel_resistance = fixed(0);
        request.immunity = DamageImmunity::Immune {
            rule_id: "status.fire-immunity".to_owned(),
        };
        request.current_shield = 5;
        request.current_hit_points = 20;

        let result = MitigationPipeline::resolve(&profile, &balance(), request).unwrap();
        assert!(result.was_immune);
        assert!(!result.was_blocked);
        assert_eq!(result.zero_damage_reason, Some(ZeroDamageReason::Immune));
        assert_eq!(
            (result.resulting_shield, result.resulting_hit_points),
            (5, 20)
        );
    }

    #[test]
    fn zero_damage_reasons_are_typed_for_later_chinese_projection() {
        let resolution = hit();
        let physical = DamageChannelId::new("physical").unwrap();
        let armor_profile = TestProfile::new(&[("physical", PrimaryMitigation::Armor)]);
        let mut armor_request = request(&resolution, &physical);
        armor_request.raw_modified_damage = fixed(1_000_000);
        armor_request.target_armor = i64::MAX - 100;
        let armor = MitigationPipeline::resolve(&armor_profile, &balance(), armor_request).unwrap();
        assert_eq!(
            armor.zero_damage_reason,
            Some(ZeroDamageReason::UnableToPenetrateDefense)
        );

        let fire = DamageChannelId::new("fire").unwrap();
        let resistance_profile = TestProfile::new(&[("fire", PrimaryMitigation::Resistance)]);
        let mut resistance_request = request(&resolution, &fire);
        resistance_request.raw_modified_damage = fixed(1_000_000);
        resistance_request.base_channel_resistance = fixed(800_000);
        let resistance =
            MitigationPipeline::resolve(&resistance_profile, &balance(), resistance_request)
                .unwrap();
        assert_eq!(
            resistance.zero_damage_reason,
            Some(ZeroDamageReason::Blocked)
        );
        assert!(resistance.was_blocked);

        assert_eq!(
            serde_json::to_value(armor).unwrap()["zeroDamageReason"],
            "UNABLE_TO_PENETRATE_DEFENSE"
        );
        assert_eq!(
            serde_json::to_value(resistance).unwrap()["zeroDamageReason"],
            "BLOCKED"
        );
    }

    #[test]
    fn no_mitigation_uses_default_shield_equations_and_preserves_exact_identity() {
        let profile = TestProfile::new(&[("void", PrimaryMitigation::None)]);
        let resolution = hit();
        let channel = DamageChannelId::new("void").unwrap();
        let mut request = request(&resolution, &channel);
        request.raw_modified_damage = fixed(3_700_000);
        request.current_shield = 2;
        request.current_hit_points = 10;

        let result = MitigationPipeline::resolve(&profile, &balance(), request).unwrap();
        assert_eq!(result.post_mitigation_damage, fixed(3_700_000));
        assert_eq!(result.rounded_incoming_damage, 3);
        assert_eq!((result.shield_damage, result.shield_resource_loss), (2, 2));
        assert_eq!((result.hp_damage, result.overkill_damage), (1, 0));
        assert_eq!(
            result.rounded_incoming_damage,
            result.shield_damage + result.hp_damage + result.overkill_damage
        );
    }

    #[test]
    fn unsupported_channels_resolutions_and_invalid_numeric_inputs_fail_closed() {
        let profile = TestProfile::new(&[("physical", PrimaryMitigation::Armor)]);
        let resolution = hit();
        let unknown = DamageChannelId::new("unknown").unwrap();
        assert_eq!(
            MitigationPipeline::resolve(&profile, &balance(), request(&resolution, &unknown))
                .unwrap_err()
                .code,
            MitigationErrorCode::UnsupportedChannel
        );

        let save = ResolutionResult::SavingThrow {
            raw_roll: 20,
            total: 20,
            ability_dc: 10,
            succeeded: true,
        };
        let physical = DamageChannelId::new("physical").unwrap();
        assert_eq!(
            MitigationPipeline::resolve(&profile, &balance(), request(&save, &physical))
                .unwrap_err()
                .code,
            MitigationErrorCode::UnsupportedResolution
        );

        let mut invalid = request(&resolution, &physical);
        invalid.armor_penetration_percent = fixed(COMBAT_FIXED_SCALE + 1);
        assert_eq!(
            MitigationPipeline::resolve(&profile, &balance(), invalid)
                .unwrap_err()
                .code,
            MitigationErrorCode::InvalidDamageInput
        );
    }
}

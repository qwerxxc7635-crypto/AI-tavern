use std::{error::Error, fmt};

use serde::{Deserialize, Serialize};

use crate::{
    CURRENT_COMBAT_VERSIONS, CanonicalLocalOverride, CanonicalMechanicalDefinition, CombatVersion,
    CriticalDamageOverride, EffectPrimitiveId, MultipleAttackPenaltyOverride, OpposedTieRule,
    ResolutionType, ResourceStorage, WorldCombatProfile, WorldType,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CostIntensity {
    None,
    Light,
    Standard,
    Heavy,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResourceCostIntent {
    pub resource_id: String,
    pub intensity: CostIntensity,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProgrammaticNumberRequest {
    pub mechanics: CanonicalMechanicalDefinition,
    pub level: u32,
    pub rarity_rank: u8,
    pub action_cost_intensity: CostIntensity,
    pub resource_cost_intent: Option<ResourceCostIntent>,
    pub cooldown_intensity: CostIntensity,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProgrammaticResourceCost {
    pub resource_id: String,
    pub operation: ResourceCostOperation,
    pub amount: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ResourceCostOperation {
    Spend,
    GainPressure,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProgrammaticCombatNumbers {
    pub action_point_cost: i64,
    pub resource_cost: Option<ProgrammaticResourceCost>,
    pub cooldown_owner_turns: u32,
    pub damage_amount: Option<i64>,
    pub healing_amount: Option<i64>,
    pub shield_amount: Option<i64>,
    pub difficulty_class: Option<i64>,
    pub status_probability_basis_points: Option<u32>,
    pub status_duration_owner_turns: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PowerBudgetBasis {
    pub ruleset_version: CombatVersion,
    pub balance_version: CombatVersion,
    pub world_type: WorldType,
    pub world_profile_version: CombatVersion,
    pub level: u32,
    pub rarity_rank: u8,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PowerBudgetReceipt {
    pub basis: PowerBudgetBasis,
    pub base_allowance: i64,
    pub level_allowance: i64,
    pub rarity_allowance: i64,
    pub action_cost_allowance: i64,
    pub resource_cost_allowance: i64,
    pub cooldown_allowance: i64,
    pub profile_allowance: i64,
    pub allowed_total: i64,
    pub primitive_spend: i64,
    pub local_override_spend: i64,
    pub numeric_spend: i64,
    pub spent_total: i64,
    pub remaining: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BudgetedMechanicalCandidate {
    pub mechanics: CanonicalMechanicalDefinition,
    pub numbers: ProgrammaticCombatNumbers,
    pub budget: PowerBudgetReceipt,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PowerBudgetBalanceConfig {
    pub balance_version: CombatVersion,
    pub maximum_level: u32,
    pub maximum_rarity_rank: u8,
    pub base_allowance: i64,
    pub allowance_per_level: i64,
    pub allowance_per_rarity_rank: i64,
    pub allowance_per_action_point: i64,
    pub allowance_per_resource_point: i64,
    pub allowance_per_cooldown_turn: i64,
    pub fantasy_profile_allowance: i64,
    pub sci_fi_profile_allowance: i64,
    pub cultivation_profile_allowance: i64,
    pub urban_profile_allowance: i64,
    pub light_action_point_cost: i64,
    pub standard_action_point_cost: i64,
    pub heavy_action_point_cost: i64,
    pub light_resource_cost: i64,
    pub standard_resource_cost: i64,
    pub heavy_resource_cost: i64,
    pub short_cooldown_turns: u32,
    pub standard_cooldown_turns: u32,
    pub long_cooldown_turns: u32,
    pub direct_primitive_spend: i64,
    pub state_primitive_spend: i64,
    pub economy_primitive_spend: i64,
    pub recovery_primitive_spend: i64,
    pub local_override_spend: i64,
    pub damage_point_spend: i64,
    pub healing_point_spend: i64,
    pub shield_point_spend: i64,
    pub base_difficulty_class: i64,
    pub difficulty_class_point_spend: i64,
    pub base_status_probability_basis_points: u32,
    pub probability_step_basis_points: u32,
    pub probability_step_spend: i64,
    pub maximum_status_probability_basis_points: u32,
    pub status_duration_turn_spend: i64,
    pub maximum_status_duration_owner_turns: u32,
}

#[derive(Debug)]
pub struct PowerBudgetEngine<'a> {
    config: &'a PowerBudgetBalanceConfig,
}

impl<'a> PowerBudgetEngine<'a> {
    pub fn new(config: &'a PowerBudgetBalanceConfig) -> Result<Self, PowerBudgetError> {
        validate_config(config)?;
        Ok(Self { config })
    }

    pub fn generate(
        &self,
        request: &ProgrammaticNumberRequest,
        profile: &WorldCombatProfile,
    ) -> Result<BudgetedMechanicalCandidate, PowerBudgetError> {
        validate_request_identity(request, profile, self.config)?;
        let action_point_cost = action_point_cost(self.config, request.action_cost_intensity)?;
        let resource_cost = resource_cost(self.config, request, profile)?;
        let cooldown_owner_turns = cooldown_turns(self.config, request.cooldown_intensity);

        let basis = PowerBudgetBasis {
            ruleset_version: request.mechanics.ruleset_version,
            balance_version: self.config.balance_version,
            world_type: profile.world_type(),
            world_profile_version: profile.world_profile_version(),
            level: request.level,
            rarity_rank: request.rarity_rank,
        };
        let allowance = self.allowance(
            &basis,
            action_point_cost,
            resource_cost.as_ref(),
            cooldown_owner_turns,
        )?;
        let primitive_spend = self.primitive_spend(&request.mechanics.primitives)?;
        let local_override_spend = self.local_override_spend(&request.mechanics.local_overrides)?;
        let fixed_spend = checked_add(primitive_spend, local_override_spend, "fixedSpend")?;
        if fixed_spend > allowance.allowed_total {
            return Err(budget_error(
                PowerBudgetErrorCode::InsufficientBudget,
                "primitiveSpend",
            ));
        }

        let numbers = self.allocate_numbers(
            &request.mechanics,
            action_point_cost,
            resource_cost,
            cooldown_owner_turns,
            allowance.allowed_total - fixed_spend,
        )?;
        let numeric_spend = self.numeric_spend(&numbers)?;
        let spent_total = checked_add(fixed_spend, numeric_spend, "spentTotal")?;
        if spent_total > allowance.allowed_total {
            return Err(budget_error(
                PowerBudgetErrorCode::BudgetExceeded,
                "spentTotal",
            ));
        }
        let budget = PowerBudgetReceipt {
            basis,
            primitive_spend,
            local_override_spend,
            numeric_spend,
            spent_total,
            remaining: allowance.allowed_total - spent_total,
            ..allowance
        };
        let candidate = BudgetedMechanicalCandidate {
            mechanics: request.mechanics.clone(),
            numbers,
            budget,
        };
        self.verify(&candidate, profile)?;
        Ok(candidate)
    }

    pub fn verify(
        &self,
        candidate: &BudgetedMechanicalCandidate,
        profile: &WorldCombatProfile,
    ) -> Result<(), PowerBudgetError> {
        validate_candidate_identity(candidate, profile, self.config)?;
        validate_exact_number_shape(&candidate.mechanics, &candidate.numbers, self.config)?;
        validate_exact_costs(&candidate.numbers, self.config, profile)?;

        let expected_allowance = self.allowance(
            &candidate.budget.basis,
            candidate.numbers.action_point_cost,
            candidate.numbers.resource_cost.as_ref(),
            candidate.numbers.cooldown_owner_turns,
        )?;
        let primitive_spend = self.primitive_spend(&candidate.mechanics.primitives)?;
        let local_override_spend =
            self.local_override_spend(&candidate.mechanics.local_overrides)?;
        let numeric_spend = self.numeric_spend(&candidate.numbers)?;
        let spent_total = checked_add(
            checked_add(primitive_spend, local_override_spend, "fixedSpend")?,
            numeric_spend,
            "spentTotal",
        )?;
        if spent_total > expected_allowance.allowed_total {
            return Err(budget_error(
                PowerBudgetErrorCode::BudgetExceeded,
                "spentTotal",
            ));
        }
        let expected = PowerBudgetReceipt {
            basis: candidate.budget.basis.clone(),
            primitive_spend,
            local_override_spend,
            numeric_spend,
            spent_total,
            remaining: expected_allowance.allowed_total - spent_total,
            ..expected_allowance
        };
        if candidate.budget != expected {
            return Err(budget_error(
                PowerBudgetErrorCode::BudgetReceiptMismatch,
                "budget",
            ));
        }
        Ok(())
    }

    fn allowance(
        &self,
        basis: &PowerBudgetBasis,
        action_point_cost: i64,
        resource_cost: Option<&ProgrammaticResourceCost>,
        cooldown_owner_turns: u32,
    ) -> Result<PowerBudgetReceipt, PowerBudgetError> {
        let level_allowance = checked_mul(
            i64::from(basis.level),
            self.config.allowance_per_level,
            "levelAllowance",
        )?;
        let rarity_allowance = checked_mul(
            i64::from(basis.rarity_rank),
            self.config.allowance_per_rarity_rank,
            "rarityAllowance",
        )?;
        let action_cost_allowance = checked_mul(
            action_point_cost,
            self.config.allowance_per_action_point,
            "actionCostAllowance",
        )?;
        let resource_cost_allowance = checked_mul(
            resource_cost.map_or(0, |cost| cost.amount),
            self.config.allowance_per_resource_point,
            "resourceCostAllowance",
        )?;
        let cooldown_allowance = checked_mul(
            i64::from(cooldown_owner_turns),
            self.config.allowance_per_cooldown_turn,
            "cooldownAllowance",
        )?;
        let profile_allowance = match basis.world_type {
            WorldType::Fantasy => self.config.fantasy_profile_allowance,
            WorldType::SciFi => self.config.sci_fi_profile_allowance,
            WorldType::Cultivation => self.config.cultivation_profile_allowance,
            WorldType::Urban => self.config.urban_profile_allowance,
        };
        let allowed_total = [
            self.config.base_allowance,
            level_allowance,
            rarity_allowance,
            action_cost_allowance,
            resource_cost_allowance,
            cooldown_allowance,
            profile_allowance,
        ]
        .into_iter()
        .try_fold(0_i64, |total, value| {
            checked_add(total, value, "allowedTotal")
        })?;
        Ok(PowerBudgetReceipt {
            basis: basis.clone(),
            base_allowance: self.config.base_allowance,
            level_allowance,
            rarity_allowance,
            action_cost_allowance,
            resource_cost_allowance,
            cooldown_allowance,
            profile_allowance,
            allowed_total,
            primitive_spend: 0,
            local_override_spend: 0,
            numeric_spend: 0,
            spent_total: 0,
            remaining: allowed_total,
        })
    }

    fn primitive_spend(&self, primitives: &[EffectPrimitiveId]) -> Result<i64, PowerBudgetError> {
        primitives.iter().try_fold(0_i64, |total, primitive| {
            let contribution = match primitive {
                EffectPrimitiveId::DealDamage
                | EffectPrimitiveId::Heal
                | EffectPrimitiveId::Shield => self.config.direct_primitive_spend,
                EffectPrimitiveId::Revive => self.config.recovery_primitive_spend,
                EffectPrimitiveId::ApplyStatus
                | EffectPrimitiveId::RemoveStatus
                | EffectPrimitiveId::ModifyStat
                | EffectPrimitiveId::Cleanse
                | EffectPrimitiveId::Dispel
                | EffectPrimitiveId::ApplyTag
                | EffectPrimitiveId::RemoveTag => self.config.state_primitive_spend,
                EffectPrimitiveId::GainResource
                | EffectPrimitiveId::LoseResource
                | EffectPrimitiveId::GainAp
                | EffectPrimitiveId::LoseAp
                | EffectPrimitiveId::ModifyAp
                | EffectPrimitiveId::GainReactionCharge
                | EffectPrimitiveId::ConsumeReactionCharge
                | EffectPrimitiveId::ModifyCooldown => self.config.economy_primitive_spend,
            };
            checked_add(total, contribution, "primitiveSpend")
        })
    }

    fn local_override_spend(
        &self,
        overrides: &[CanonicalLocalOverride],
    ) -> Result<i64, PowerBudgetError> {
        overrides.iter().try_fold(0_i64, |total, value| {
            let multiplier = match value {
                CanonicalLocalOverride::MultipleAttack {
                    value: MultipleAttackPenaltyOverride::Default {},
                }
                | CanonicalLocalOverride::CriticalDamage {
                    value: CriticalDamageOverride::Default {},
                }
                | CanonicalLocalOverride::OpposedTie {
                    value: OpposedTieRule::DefenderWins,
                } => 0,
                CanonicalLocalOverride::MultipleAttack {
                    value:
                        MultipleAttackPenaltyOverride::IgnorePenalty { .. }
                        | MultipleAttackPenaltyOverride::CountAsBasicAttack { .. },
                }
                | CanonicalLocalOverride::CriticalDamage {
                    value: CriticalDamageOverride::AllowDamageOverTime { .. },
                }
                | CanonicalLocalOverride::OpposedTie {
                    value: OpposedTieRule::AttackerWins,
                } => 1,
            };
            checked_add(
                total,
                checked_mul(
                    multiplier,
                    self.config.local_override_spend,
                    "localOverrideSpend",
                )?,
                "localOverrideSpend",
            )
        })
    }

    fn allocate_numbers(
        &self,
        mechanics: &CanonicalMechanicalDefinition,
        action_point_cost: i64,
        resource_cost: Option<ProgrammaticResourceCost>,
        cooldown_owner_turns: u32,
        available: i64,
    ) -> Result<ProgrammaticCombatNumbers, PowerBudgetError> {
        let has_damage = mechanics
            .primitives
            .contains(&EffectPrimitiveId::DealDamage);
        let has_heal = mechanics.primitives.contains(&EffectPrimitiveId::Heal);
        let has_shield = mechanics.primitives.contains(&EffectPrimitiveId::Shield);
        let has_status = mechanics
            .primitives
            .contains(&EffectPrimitiveId::ApplyStatus);
        let has_dc = matches!(
            mechanics.resolution_type,
            ResolutionType::SavingThrow | ResolutionType::ConditionalCheck
        );
        let slot_count = [
            has_damage, has_heal, has_shield, has_dc, has_status, has_status,
        ]
        .into_iter()
        .filter(|active| *active)
        .count();
        let share = if slot_count == 0 {
            0
        } else {
            available / i64::try_from(slot_count).expect("six slots fit i64")
        };

        let damage_amount =
            has_damage.then_some(at_least_one(share, self.config.damage_point_spend));
        let healing_amount =
            has_heal.then_some(at_least_one(share, self.config.healing_point_spend));
        let shield_amount =
            has_shield.then_some(at_least_one(share, self.config.shield_point_spend));
        let difficulty_class = if has_dc {
            Some(checked_add(
                self.config.base_difficulty_class,
                share / self.config.difficulty_class_point_spend,
                "difficultyClass",
            )?)
        } else {
            None
        };
        let status_probability_basis_points = has_status.then(|| {
            let purchased_steps =
                u32::try_from(share / self.config.probability_step_spend).unwrap_or(u32::MAX);
            self.config
                .base_status_probability_basis_points
                .saturating_add(
                    purchased_steps.saturating_mul(self.config.probability_step_basis_points),
                )
                .min(self.config.maximum_status_probability_basis_points)
        });
        let status_duration_owner_turns = has_status.then(|| {
            u32::try_from(
                share
                    .checked_div(self.config.status_duration_turn_spend)
                    .and_then(|value| value.checked_add(1))
                    .unwrap_or(i64::MAX),
            )
            .unwrap_or(u32::MAX)
            .min(self.config.maximum_status_duration_owner_turns)
        });

        Ok(ProgrammaticCombatNumbers {
            action_point_cost,
            resource_cost,
            cooldown_owner_turns,
            damage_amount,
            healing_amount,
            shield_amount,
            difficulty_class,
            status_probability_basis_points,
            status_duration_owner_turns,
        })
    }

    fn numeric_spend(&self, numbers: &ProgrammaticCombatNumbers) -> Result<i64, PowerBudgetError> {
        let damage = checked_mul(
            numbers.damage_amount.unwrap_or(0),
            self.config.damage_point_spend,
            "damageSpend",
        )?;
        let healing = checked_mul(
            numbers.healing_amount.unwrap_or(0),
            self.config.healing_point_spend,
            "healingSpend",
        )?;
        let shield = checked_mul(
            numbers.shield_amount.unwrap_or(0),
            self.config.shield_point_spend,
            "shieldSpend",
        )?;
        let difficulty = checked_mul(
            numbers
                .difficulty_class
                .map_or(0, |value| value - self.config.base_difficulty_class),
            self.config.difficulty_class_point_spend,
            "difficultySpend",
        )?;
        let probability = checked_mul(
            i64::from(numbers.status_probability_basis_points.map_or(0, |value| {
                (value - self.config.base_status_probability_basis_points)
                    / self.config.probability_step_basis_points
            })),
            self.config.probability_step_spend,
            "probabilitySpend",
        )?;
        let duration = checked_mul(
            i64::from(
                numbers
                    .status_duration_owner_turns
                    .map_or(0, |value| value.saturating_sub(1)),
            ),
            self.config.status_duration_turn_spend,
            "durationSpend",
        )?;
        [damage, healing, shield, difficulty, probability, duration]
            .into_iter()
            .try_fold(0_i64, |total, value| {
                checked_add(total, value, "numericSpend")
            })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PowerBudgetErrorCode {
    InvalidBalanceConfig,
    UnsupportedVersion,
    ProfileIdentityMismatch,
    InvalidLevel,
    InvalidRarity,
    InvalidCostIntent,
    UnsupportedResourceCost,
    InsufficientBudget,
    BudgetExceeded,
    InvalidNumberShape,
    InvalidProgrammaticCost,
    BudgetReceiptMismatch,
    ArithmeticOverflow,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PowerBudgetError {
    pub code: PowerBudgetErrorCode,
    pub subject: String,
}

impl fmt::Display for PowerBudgetError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "power budget failed for {}: {:?}",
            self.subject, self.code
        )
    }
}

impl Error for PowerBudgetError {}

fn validate_config(config: &PowerBudgetBalanceConfig) -> Result<(), PowerBudgetError> {
    let positive = [
        i64::from(config.maximum_level),
        i64::from(config.maximum_rarity_rank),
        config.base_allowance,
        config.allowance_per_level,
        config.allowance_per_rarity_rank,
        config.allowance_per_action_point,
        config.allowance_per_resource_point,
        config.allowance_per_cooldown_turn,
        config.light_action_point_cost,
        config.standard_action_point_cost,
        config.heavy_action_point_cost,
        config.light_resource_cost,
        config.standard_resource_cost,
        config.heavy_resource_cost,
        i64::from(config.short_cooldown_turns),
        i64::from(config.standard_cooldown_turns),
        i64::from(config.long_cooldown_turns),
        config.direct_primitive_spend,
        config.state_primitive_spend,
        config.economy_primitive_spend,
        config.recovery_primitive_spend,
        config.local_override_spend,
        config.damage_point_spend,
        config.healing_point_spend,
        config.shield_point_spend,
        config.base_difficulty_class,
        config.difficulty_class_point_spend,
        i64::from(config.base_status_probability_basis_points),
        i64::from(config.probability_step_basis_points),
        config.probability_step_spend,
        i64::from(config.maximum_status_probability_basis_points),
        config.status_duration_turn_spend,
        i64::from(config.maximum_status_duration_owner_turns),
    ];
    if config.balance_version != CURRENT_COMBAT_VERSIONS.balance_version
        || positive.into_iter().any(|value| value <= 0)
        || config.light_action_point_cost >= config.standard_action_point_cost
        || config.standard_action_point_cost >= config.heavy_action_point_cost
        || config.heavy_action_point_cost > 3
        || config.light_resource_cost >= config.standard_resource_cost
        || config.standard_resource_cost >= config.heavy_resource_cost
        || config.short_cooldown_turns >= config.standard_cooldown_turns
        || config.standard_cooldown_turns >= config.long_cooldown_turns
        || config.base_status_probability_basis_points
            > config.maximum_status_probability_basis_points
        || config.maximum_status_probability_basis_points > 10_000
        || config.probability_step_basis_points == 0
        || !(config.maximum_status_probability_basis_points
            - config.base_status_probability_basis_points)
            .is_multiple_of(config.probability_step_basis_points)
    {
        return Err(budget_error(
            PowerBudgetErrorCode::InvalidBalanceConfig,
            "balanceConfig",
        ));
    }
    Ok(())
}

fn validate_request_identity(
    request: &ProgrammaticNumberRequest,
    profile: &WorldCombatProfile,
    config: &PowerBudgetBalanceConfig,
) -> Result<(), PowerBudgetError> {
    if request.mechanics.ruleset_version != CURRENT_COMBAT_VERSIONS.ruleset_version
        || config.balance_version != CURRENT_COMBAT_VERSIONS.balance_version
    {
        return Err(budget_error(
            PowerBudgetErrorCode::UnsupportedVersion,
            "version",
        ));
    }
    if request.mechanics.world_type != profile.world_type()
        || request.mechanics.world_profile_version != profile.world_profile_version()
    {
        return Err(budget_error(
            PowerBudgetErrorCode::ProfileIdentityMismatch,
            "worldProfile",
        ));
    }
    if request.level == 0 || request.level > config.maximum_level {
        return Err(budget_error(PowerBudgetErrorCode::InvalidLevel, "level"));
    }
    if request.rarity_rank > config.maximum_rarity_rank {
        return Err(budget_error(
            PowerBudgetErrorCode::InvalidRarity,
            "rarityRank",
        ));
    }
    Ok(())
}

fn validate_candidate_identity(
    candidate: &BudgetedMechanicalCandidate,
    profile: &WorldCombatProfile,
    config: &PowerBudgetBalanceConfig,
) -> Result<(), PowerBudgetError> {
    if candidate.budget.basis.ruleset_version != candidate.mechanics.ruleset_version
        || candidate.budget.basis.balance_version != config.balance_version
        || candidate.budget.basis.world_type != candidate.mechanics.world_type
        || candidate.budget.basis.world_profile_version != candidate.mechanics.world_profile_version
    {
        return Err(budget_error(
            PowerBudgetErrorCode::UnsupportedVersion,
            "budgetBasis",
        ));
    }
    let synthetic = ProgrammaticNumberRequest {
        mechanics: candidate.mechanics.clone(),
        level: candidate.budget.basis.level,
        rarity_rank: candidate.budget.basis.rarity_rank,
        action_cost_intensity: CostIntensity::None,
        resource_cost_intent: None,
        cooldown_intensity: CostIntensity::None,
    };
    validate_request_identity(&synthetic, profile, config)
}

fn validate_exact_number_shape(
    mechanics: &CanonicalMechanicalDefinition,
    numbers: &ProgrammaticCombatNumbers,
    config: &PowerBudgetBalanceConfig,
) -> Result<(), PowerBudgetError> {
    let exact = [
        (
            mechanics
                .primitives
                .contains(&EffectPrimitiveId::DealDamage),
            numbers.damage_amount.is_some(),
        ),
        (
            mechanics.primitives.contains(&EffectPrimitiveId::Heal),
            numbers.healing_amount.is_some(),
        ),
        (
            mechanics.primitives.contains(&EffectPrimitiveId::Shield),
            numbers.shield_amount.is_some(),
        ),
        (
            matches!(
                mechanics.resolution_type,
                ResolutionType::SavingThrow | ResolutionType::ConditionalCheck
            ),
            numbers.difficulty_class.is_some(),
        ),
        (
            mechanics
                .primitives
                .contains(&EffectPrimitiveId::ApplyStatus),
            numbers.status_probability_basis_points.is_some(),
        ),
        (
            mechanics
                .primitives
                .contains(&EffectPrimitiveId::ApplyStatus),
            numbers.status_duration_owner_turns.is_some(),
        ),
    ];
    if exact
        .into_iter()
        .any(|(expected, actual)| expected != actual)
        || numbers.damage_amount.is_some_and(|value| value <= 0)
        || numbers.healing_amount.is_some_and(|value| value <= 0)
        || numbers.shield_amount.is_some_and(|value| value <= 0)
        || numbers
            .difficulty_class
            .is_some_and(|value| value < config.base_difficulty_class)
        || numbers
            .status_probability_basis_points
            .is_some_and(|value| {
                value < config.base_status_probability_basis_points
                    || value > config.maximum_status_probability_basis_points
                    || !(value - config.base_status_probability_basis_points)
                        .is_multiple_of(config.probability_step_basis_points)
            })
        || numbers
            .status_duration_owner_turns
            .is_some_and(|value| value == 0 || value > config.maximum_status_duration_owner_turns)
    {
        return Err(budget_error(
            PowerBudgetErrorCode::InvalidNumberShape,
            "numbers",
        ));
    }
    Ok(())
}

fn validate_exact_costs(
    numbers: &ProgrammaticCombatNumbers,
    config: &PowerBudgetBalanceConfig,
    profile: &WorldCombatProfile,
) -> Result<(), PowerBudgetError> {
    let valid_ap = [
        0,
        config.light_action_point_cost,
        config.standard_action_point_cost,
        config.heavy_action_point_cost,
    ]
    .contains(&numbers.action_point_cost);
    let valid_cooldown = [
        0,
        config.short_cooldown_turns,
        config.standard_cooldown_turns,
        config.long_cooldown_turns,
    ]
    .contains(&numbers.cooldown_owner_turns);
    let valid_resource = numbers.resource_cost.as_ref().is_none_or(|cost| {
        [
            config.light_resource_cost,
            config.standard_resource_cost,
            config.heavy_resource_cost,
        ]
        .contains(&cost.amount)
            && profile.resource_lifecycle().resources.iter().any(|rule| {
                rule.resource_id == cost.resource_id
                    && matches!(
                        (rule.storage, cost.operation),
                        (ResourceStorage::ResourcePool, ResourceCostOperation::Spend)
                            | (
                                ResourceStorage::PressureResourcePool,
                                ResourceCostOperation::GainPressure
                            )
                    )
            })
    });
    if !valid_ap || !valid_cooldown || !valid_resource {
        return Err(budget_error(
            PowerBudgetErrorCode::InvalidProgrammaticCost,
            "cost",
        ));
    }
    Ok(())
}

fn action_point_cost(
    config: &PowerBudgetBalanceConfig,
    intensity: CostIntensity,
) -> Result<i64, PowerBudgetError> {
    Ok(match intensity {
        CostIntensity::None => 0,
        CostIntensity::Light => config.light_action_point_cost,
        CostIntensity::Standard => config.standard_action_point_cost,
        CostIntensity::Heavy => config.heavy_action_point_cost,
    })
}

fn resource_cost(
    config: &PowerBudgetBalanceConfig,
    request: &ProgrammaticNumberRequest,
    profile: &WorldCombatProfile,
) -> Result<Option<ProgrammaticResourceCost>, PowerBudgetError> {
    let Some(intent) = &request.resource_cost_intent else {
        return Ok(None);
    };
    if intent.intensity == CostIntensity::None {
        return Err(budget_error(
            PowerBudgetErrorCode::InvalidCostIntent,
            "resourceCostIntent",
        ));
    }
    let Some(resource_rule) = profile.resource_lifecycle().resources.iter().find(|rule| {
        rule.resource_id == intent.resource_id
            && matches!(
                rule.storage,
                ResourceStorage::ResourcePool | ResourceStorage::PressureResourcePool
            )
    }) else {
        return Err(budget_error(
            PowerBudgetErrorCode::UnsupportedResourceCost,
            &intent.resource_id,
        ));
    };
    let amount = match intent.intensity {
        CostIntensity::None => unreachable!("checked above"),
        CostIntensity::Light => config.light_resource_cost,
        CostIntensity::Standard => config.standard_resource_cost,
        CostIntensity::Heavy => config.heavy_resource_cost,
    };
    Ok(Some(ProgrammaticResourceCost {
        resource_id: intent.resource_id.clone(),
        operation: match resource_rule.storage {
            ResourceStorage::ResourcePool => ResourceCostOperation::Spend,
            ResourceStorage::PressureResourcePool => ResourceCostOperation::GainPressure,
            ResourceStorage::HitPoints | ResourceStorage::Shield => unreachable!("filtered above"),
        },
        amount,
    }))
}

const fn cooldown_turns(config: &PowerBudgetBalanceConfig, intensity: CostIntensity) -> u32 {
    match intensity {
        CostIntensity::None => 0,
        CostIntensity::Light => config.short_cooldown_turns,
        CostIntensity::Standard => config.standard_cooldown_turns,
        CostIntensity::Heavy => config.long_cooldown_turns,
    }
}

fn at_least_one(share: i64, point_spend: i64) -> i64 {
    (share / point_spend).max(1)
}

fn checked_add(left: i64, right: i64, subject: &'static str) -> Result<i64, PowerBudgetError> {
    left.checked_add(right)
        .ok_or_else(|| budget_error(PowerBudgetErrorCode::ArithmeticOverflow, subject))
}

fn checked_mul(left: i64, right: i64, subject: &'static str) -> Result<i64, PowerBudgetError> {
    left.checked_mul(right)
        .ok_or_else(|| budget_error(PowerBudgetErrorCode::ArithmeticOverflow, subject))
}

fn budget_error(code: PowerBudgetErrorCode, subject: impl Into<String>) -> PowerBudgetError {
    PowerBudgetError {
        code,
        subject: subject.into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        CombatMechanicalConcept, DamageChannelCatalog, GameplayTagCatalog, GameplayTagId,
        MechanicalIntentMapper, WorldCombatProfileResolver,
    };

    fn config() -> PowerBudgetBalanceConfig {
        PowerBudgetBalanceConfig {
            balance_version: CURRENT_COMBAT_VERSIONS.balance_version,
            maximum_level: 100,
            maximum_rarity_rank: 4,
            base_allowance: 40,
            allowance_per_level: 3,
            allowance_per_rarity_rank: 12,
            allowance_per_action_point: 12,
            allowance_per_resource_point: 1,
            allowance_per_cooldown_turn: 6,
            fantasy_profile_allowance: 0,
            sci_fi_profile_allowance: 2,
            cultivation_profile_allowance: 1,
            urban_profile_allowance: 0,
            light_action_point_cost: 1,
            standard_action_point_cost: 2,
            heavy_action_point_cost: 3,
            light_resource_cost: 5,
            standard_resource_cost: 10,
            heavy_resource_cost: 20,
            short_cooldown_turns: 1,
            standard_cooldown_turns: 2,
            long_cooldown_turns: 3,
            direct_primitive_spend: 4,
            state_primitive_spend: 5,
            economy_primitive_spend: 4,
            recovery_primitive_spend: 12,
            local_override_spend: 10,
            damage_point_spend: 1,
            healing_point_spend: 1,
            shield_point_spend: 1,
            base_difficulty_class: 10,
            difficulty_class_point_spend: 4,
            base_status_probability_basis_points: 1_000,
            probability_step_basis_points: 500,
            probability_step_spend: 5,
            maximum_status_probability_basis_points: 5_000,
            status_duration_turn_spend: 12,
            maximum_status_duration_owner_turns: 3,
        }
    }

    struct Fixture {
        tags: GameplayTagCatalog,
        channels: DamageChannelCatalog,
        resolver: WorldCombatProfileResolver,
    }

    impl Fixture {
        fn new() -> Self {
            let tags = GameplayTagCatalog::v0_4_1();
            let channels = DamageChannelCatalog::v0_4_1();
            let resolver = WorldCombatProfileResolver::v0_4_1(&channels).unwrap();
            Self {
                tags,
                channels,
                resolver,
            }
        }

        fn mechanics(&self, intents: &[&str]) -> CanonicalMechanicalDefinition {
            let concept = CombatMechanicalConcept {
                mechanical_intent: intents.iter().map(|value| (*value).to_owned()).collect(),
                candidate_tags: vec![GameplayTagId::new("Ability.Spell").unwrap()],
                target_intent: "SINGLE_ENEMY".to_owned(),
            };
            MechanicalIntentMapper::new(&self.tags, &self.channels)
                .map(
                    &concept,
                    CURRENT_COMBAT_VERSIONS.ruleset_version,
                    self.resolver.resolve(WorldType::Cultivation),
                )
                .unwrap()
        }
    }

    #[test]
    fn generates_numbers_after_budget_and_verifies_the_receipt() {
        let fixture = Fixture::new();
        let profile = fixture.resolver.resolve(WorldType::Cultivation);
        let balance = config();
        let engine = PowerBudgetEngine::new(&balance).unwrap();
        let request = ProgrammaticNumberRequest {
            mechanics: fixture.mechanics(&[
                "PRIMITIVE:DEAL_DAMAGE",
                "DAMAGE_CHANNEL:soul",
                "PRIMITIVE:APPLY_STATUS",
                "RESOLUTION:SAVING_THROW",
            ]),
            level: 12,
            rarity_rank: 2,
            action_cost_intensity: CostIntensity::Standard,
            resource_cost_intent: Some(ResourceCostIntent {
                resource_id: "qi".to_owned(),
                intensity: CostIntensity::Heavy,
            }),
            cooldown_intensity: CostIntensity::Standard,
        };

        let candidate = engine.generate(&request, profile).unwrap();
        assert_eq!(candidate.numbers.action_point_cost, 2);
        assert_eq!(candidate.numbers.resource_cost.as_ref().unwrap().amount, 20);
        assert_eq!(
            candidate.numbers.resource_cost.as_ref().unwrap().operation,
            ResourceCostOperation::Spend
        );
        assert_eq!(candidate.numbers.cooldown_owner_turns, 2);
        assert!(candidate.numbers.damage_amount.unwrap() > 0);
        assert!(candidate.numbers.difficulty_class.unwrap() >= 10);
        assert!(candidate.numbers.status_probability_basis_points.is_some());
        assert!(candidate.numbers.status_duration_owner_turns.is_some());
        assert!(candidate.budget.spent_total <= candidate.budget.allowed_total);
        assert!(engine.verify(&candidate, profile).is_ok());
    }

    #[test]
    fn same_inputs_generate_byte_identical_numbers_without_rng() {
        let fixture = Fixture::new();
        let profile = fixture.resolver.resolve(WorldType::Cultivation);
        let balance = config();
        let engine = PowerBudgetEngine::new(&balance).unwrap();
        let request = ProgrammaticNumberRequest {
            mechanics: fixture.mechanics(&[
                "PRIMITIVE:HEAL",
                "PRIMITIVE:SHIELD",
                "RESOLUTION:AUTO_HIT",
            ]),
            level: 5,
            rarity_rank: 1,
            action_cost_intensity: CostIntensity::Light,
            resource_cost_intent: None,
            cooldown_intensity: CostIntensity::Light,
        };
        let left = engine.generate(&request, profile).unwrap();
        let right = engine.generate(&request, profile).unwrap();
        assert_eq!(
            serde_json::to_vec(&left).unwrap(),
            serde_json::to_vec(&right).unwrap()
        );
    }

    #[test]
    fn tampered_numbers_and_receipts_fail_recalculation() {
        let fixture = Fixture::new();
        let profile = fixture.resolver.resolve(WorldType::Cultivation);
        let balance = config();
        let engine = PowerBudgetEngine::new(&balance).unwrap();
        let request = ProgrammaticNumberRequest {
            mechanics: fixture.mechanics(&[
                "PRIMITIVE:DEAL_DAMAGE",
                "DAMAGE_CHANNEL:soul",
                "RESOLUTION:ATTACK_ROLL",
            ]),
            level: 1,
            rarity_rank: 0,
            action_cost_intensity: CostIntensity::Light,
            resource_cost_intent: None,
            cooldown_intensity: CostIntensity::None,
        };
        let candidate = engine.generate(&request, profile).unwrap();

        let mut inflated = candidate.clone();
        inflated.numbers.damage_amount = Some(10_000);
        assert_eq!(
            engine.verify(&inflated, profile).unwrap_err().code,
            PowerBudgetErrorCode::BudgetExceeded
        );

        let mut forged_receipt = candidate;
        forged_receipt.budget.allowed_total += 1;
        assert_eq!(
            engine.verify(&forged_receipt, profile).unwrap_err().code,
            PowerBudgetErrorCode::BudgetReceiptMismatch
        );
    }

    #[test]
    fn resource_cost_uses_only_profile_combat_resource_pools() {
        let fixture = Fixture::new();
        let profile = fixture.resolver.resolve(WorldType::Cultivation);
        let balance = config();
        let engine = PowerBudgetEngine::new(&balance).unwrap();
        for resource_id in ["health", "mana"] {
            let request = ProgrammaticNumberRequest {
                mechanics: fixture.mechanics(&["PRIMITIVE:HEAL", "RESOLUTION:AUTO_HIT"]),
                level: 1,
                rarity_rank: 0,
                action_cost_intensity: CostIntensity::Light,
                resource_cost_intent: Some(ResourceCostIntent {
                    resource_id: resource_id.to_owned(),
                    intensity: CostIntensity::Light,
                }),
                cooldown_intensity: CostIntensity::None,
            };
            assert_eq!(
                engine.generate(&request, profile).unwrap_err().code,
                PowerBudgetErrorCode::UnsupportedResourceCost
            );
        }

        let sci_fi = fixture.resolver.resolve(WorldType::SciFi);
        let mut mechanics = fixture.mechanics(&["PRIMITIVE:SHIELD", "RESOLUTION:AUTO_HIT"]);
        mechanics.world_type = WorldType::SciFi;
        let pressure_request = ProgrammaticNumberRequest {
            mechanics,
            level: 1,
            rarity_rank: 0,
            action_cost_intensity: CostIntensity::Light,
            resource_cost_intent: Some(ResourceCostIntent {
                resource_id: "heat".to_owned(),
                intensity: CostIntensity::Standard,
            }),
            cooldown_intensity: CostIntensity::None,
        };
        let pressure = engine.generate(&pressure_request, sci_fi).unwrap();
        assert_eq!(
            pressure.numbers.resource_cost.unwrap().operation,
            ResourceCostOperation::GainPressure
        );
    }

    #[test]
    fn primitive_and_typed_override_contributions_are_balance_owned() {
        let fixture = Fixture::new();
        let profile = fixture.resolver.resolve(WorldType::Cultivation);
        let balance = config();
        let engine = PowerBudgetEngine::new(&balance).unwrap();
        let mut mechanics = fixture.mechanics(&[
            "PRIMITIVE:DEAL_DAMAGE",
            "DAMAGE_CHANNEL:soul",
            "RESOLUTION:ATTACK_ROLL",
        ]);
        mechanics.local_overrides = vec![CanonicalLocalOverride::CriticalDamage {
            value: CriticalDamageOverride::AllowDamageOverTime {
                rule_id: "critical.allow-dot".to_owned(),
            },
        }];
        let request = ProgrammaticNumberRequest {
            mechanics,
            level: 10,
            rarity_rank: 2,
            action_cost_intensity: CostIntensity::Heavy,
            resource_cost_intent: None,
            cooldown_intensity: CostIntensity::Heavy,
        };
        let candidate = engine.generate(&request, profile).unwrap();
        assert_eq!(
            candidate.budget.primitive_spend,
            config().direct_primitive_spend
        );
        assert_eq!(
            candidate.budget.local_override_spend,
            config().local_override_spend
        );
    }

    #[test]
    fn malformed_config_level_rarity_and_cost_intent_fail_closed() {
        let fixture = Fixture::new();
        let profile = fixture.resolver.resolve(WorldType::Cultivation);
        let mut invalid_config = config();
        invalid_config.damage_point_spend = 0;
        assert_eq!(
            PowerBudgetEngine::new(&invalid_config).unwrap_err().code,
            PowerBudgetErrorCode::InvalidBalanceConfig
        );

        let balance = config();
        let engine = PowerBudgetEngine::new(&balance).unwrap();
        let mut request = ProgrammaticNumberRequest {
            mechanics: fixture.mechanics(&["PRIMITIVE:HEAL", "RESOLUTION:AUTO_HIT"]),
            level: 0,
            rarity_rank: 0,
            action_cost_intensity: CostIntensity::Light,
            resource_cost_intent: None,
            cooldown_intensity: CostIntensity::None,
        };
        assert_eq!(
            engine.generate(&request, profile).unwrap_err().code,
            PowerBudgetErrorCode::InvalidLevel
        );
        request.level = 1;
        request.rarity_rank = 5;
        assert_eq!(
            engine.generate(&request, profile).unwrap_err().code,
            PowerBudgetErrorCode::InvalidRarity
        );
        request.rarity_rank = 0;
        request.resource_cost_intent = Some(ResourceCostIntent {
            resource_id: "qi".to_owned(),
            intensity: CostIntensity::None,
        });
        assert_eq!(
            engine.generate(&request, profile).unwrap_err().code,
            PowerBudgetErrorCode::InvalidCostIntent
        );
    }
}

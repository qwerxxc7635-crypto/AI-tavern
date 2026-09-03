use std::{error::Error, fmt};

use serde::{Deserialize, Serialize};

use crate::{CombatFixed, CombatNumeric, DamageChannelId};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum EffectPrimitiveId {
    DealDamage,
    Heal,
    Revive,
    ApplyStatus,
    RemoveStatus,
    ModifyStat,
    GainResource,
    LoseResource,
    GainAp,
    LoseAp,
    ModifyAp,
    GainReactionCharge,
    ConsumeReactionCharge,
    Shield,
    Cleanse,
    Dispel,
    ModifyCooldown,
    ApplyTag,
    RemoveTag,
}

impl EffectPrimitiveId {
    pub const ALL: [Self; 19] = [
        Self::DealDamage,
        Self::Heal,
        Self::Revive,
        Self::ApplyStatus,
        Self::RemoveStatus,
        Self::ModifyStat,
        Self::GainResource,
        Self::LoseResource,
        Self::GainAp,
        Self::LoseAp,
        Self::ModifyAp,
        Self::GainReactionCharge,
        Self::ConsumeReactionCharge,
        Self::Shield,
        Self::Cleanse,
        Self::Dispel,
        Self::ModifyCooldown,
        Self::ApplyTag,
        Self::RemoveTag,
    ];
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum EffectAmount {
    Flat { amount: i64 },
    PercentOfMaximum { percent: CombatFixed },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum StatModification {
    Flat {
        delta: i64,
    },
    Percent {
        percent: CombatFixed,
        reference_stat_id: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum EffectDefinition {
    DealDamage {
        channel_id: DamageChannelId,
        raw_damage: CombatFixed,
    },
    Heal {
        amount: EffectAmount,
    },
    Revive {
        restore_hp_flat: Option<i64>,
        restore_hp_percent: Option<CombatFixed>,
        remove_tag_ids: Vec<String>,
        apply_status_ids: Vec<String>,
    },
    ApplyStatus {
        status_definition_id: String,
    },
    RemoveStatus {
        status_definition_id: String,
    },
    ModifyStat {
        stat_id: String,
        modification: StatModification,
    },
    GainResource {
        resource_id: String,
        amount: EffectAmount,
    },
    LoseResource {
        resource_id: String,
        amount: EffectAmount,
    },
    GainAp {
        amount: i64,
    },
    LoseAp {
        amount: i64,
    },
    ModifyAp {
        delta: i64,
    },
    GainReactionCharge {
        amount: i64,
    },
    ConsumeReactionCharge {
        amount: i64,
    },
    Shield {
        amount: EffectAmount,
    },
    Cleanse {
        tag_ids: Vec<String>,
    },
    Dispel {
        tag_ids: Vec<String>,
    },
    ModifyCooldown {
        ability_id: String,
        delta: i64,
    },
    ApplyTag {
        tag_id: String,
    },
    RemoveTag {
        tag_id: String,
    },
}

impl EffectDefinition {
    #[must_use]
    pub const fn primitive_id(&self) -> EffectPrimitiveId {
        match self {
            Self::DealDamage { .. } => EffectPrimitiveId::DealDamage,
            Self::Heal { .. } => EffectPrimitiveId::Heal,
            Self::Revive { .. } => EffectPrimitiveId::Revive,
            Self::ApplyStatus { .. } => EffectPrimitiveId::ApplyStatus,
            Self::RemoveStatus { .. } => EffectPrimitiveId::RemoveStatus,
            Self::ModifyStat { .. } => EffectPrimitiveId::ModifyStat,
            Self::GainResource { .. } => EffectPrimitiveId::GainResource,
            Self::LoseResource { .. } => EffectPrimitiveId::LoseResource,
            Self::GainAp { .. } => EffectPrimitiveId::GainAp,
            Self::LoseAp { .. } => EffectPrimitiveId::LoseAp,
            Self::ModifyAp { .. } => EffectPrimitiveId::ModifyAp,
            Self::GainReactionCharge { .. } => EffectPrimitiveId::GainReactionCharge,
            Self::ConsumeReactionCharge { .. } => EffectPrimitiveId::ConsumeReactionCharge,
            Self::Shield { .. } => EffectPrimitiveId::Shield,
            Self::Cleanse { .. } => EffectPrimitiveId::Cleanse,
            Self::Dispel { .. } => EffectPrimitiveId::Dispel,
            Self::ModifyCooldown { .. } => EffectPrimitiveId::ModifyCooldown,
            Self::ApplyTag { .. } => EffectPrimitiveId::ApplyTag,
            Self::RemoveTag { .. } => EffectPrimitiveId::RemoveTag,
        }
    }
}

pub trait EffectValueContext {
    fn maximum_hit_points(&self) -> i64;
    fn maximum_shield(&self) -> i64;
    fn maximum_resource(&self, resource_id: &str) -> Option<i64>;
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum ResolvedEffect {
    QueueDamage {
        channel_id: DamageChannelId,
        raw_damage: CombatFixed,
    },
    Heal {
        amount: i64,
    },
    Revive {
        restore_hp_amount: i64,
        remove_tag_ids: Vec<String>,
        apply_status_ids: Vec<String>,
    },
    ApplyStatus {
        status_definition_id: String,
    },
    RemoveStatus {
        status_definition_id: String,
    },
    ModifyStat {
        stat_id: String,
        modification: StatModification,
    },
    ModifyResource {
        resource_id: String,
        delta: i64,
    },
    ModifyAp {
        delta: i64,
    },
    ModifyReactionCharge {
        delta: i64,
    },
    GainShield {
        amount: i64,
    },
    Cleanse {
        tag_ids: Vec<String>,
    },
    Dispel {
        tag_ids: Vec<String>,
    },
    ModifyCooldown {
        ability_id: String,
        delta: i64,
    },
    ApplyTag {
        tag_id: String,
    },
    RemoveTag {
        tag_id: String,
    },
}

pub struct EffectHandlerSet;

impl EffectHandlerSet {
    pub fn resolve<C: EffectValueContext>(
        definition: &EffectDefinition,
        context: &C,
    ) -> Result<ResolvedEffect, EffectError> {
        match definition {
            EffectDefinition::DealDamage {
                channel_id,
                raw_damage,
            } => {
                require_nonnegative_fixed(*raw_damage, "rawDamage")?;
                Ok(ResolvedEffect::QueueDamage {
                    channel_id: channel_id.clone(),
                    raw_damage: *raw_damage,
                })
            }
            EffectDefinition::Heal { amount } => Ok(ResolvedEffect::Heal {
                amount: resolve_amount(amount, context.maximum_hit_points(), "heal")?,
            }),
            EffectDefinition::Revive {
                restore_hp_flat,
                restore_hp_percent,
                remove_tag_ids,
                apply_status_ids,
            } => {
                validate_ids(remove_tag_ids, false)?;
                validate_ids(apply_status_ids, false)?;
                let flat = restore_hp_flat.unwrap_or(0);
                if flat < 0 || restore_hp_flat.is_none() && restore_hp_percent.is_none() {
                    return Err(effect_error(EffectErrorCode::InvalidAmount, "revive"));
                }
                let percent = match restore_hp_percent {
                    Some(value) => CombatNumeric::percent_restore_at_least_one(
                        context.maximum_hit_points(),
                        *value,
                    )
                    .map_err(|_| effect_error(EffectErrorCode::NumericFailure, "revivePercent"))?,
                    None => 0,
                };
                let total = flat
                    .checked_add(percent)
                    .ok_or_else(|| effect_error(EffectErrorCode::NumericFailure, "revive"))?;
                if total <= 0 {
                    return Err(effect_error(EffectErrorCode::InvalidAmount, "revive"));
                }
                Ok(ResolvedEffect::Revive {
                    restore_hp_amount: total,
                    remove_tag_ids: remove_tag_ids.clone(),
                    apply_status_ids: apply_status_ids.clone(),
                })
            }
            EffectDefinition::ApplyStatus {
                status_definition_id,
            } => {
                validate_id(status_definition_id)?;
                Ok(ResolvedEffect::ApplyStatus {
                    status_definition_id: status_definition_id.clone(),
                })
            }
            EffectDefinition::RemoveStatus {
                status_definition_id,
            } => {
                validate_id(status_definition_id)?;
                Ok(ResolvedEffect::RemoveStatus {
                    status_definition_id: status_definition_id.clone(),
                })
            }
            EffectDefinition::ModifyStat {
                stat_id,
                modification,
            } => {
                validate_id(stat_id)?;
                validate_stat_modification(modification)?;
                Ok(ResolvedEffect::ModifyStat {
                    stat_id: stat_id.clone(),
                    modification: modification.clone(),
                })
            }
            EffectDefinition::GainResource {
                resource_id,
                amount,
            }
            | EffectDefinition::LoseResource {
                resource_id,
                amount,
            } => {
                validate_id(resource_id)?;
                let maximum = context
                    .maximum_resource(resource_id)
                    .ok_or_else(|| effect_error(EffectErrorCode::UnknownResource, resource_id))?;
                let value = resolve_amount(amount, maximum, resource_id)?;
                let delta = if matches!(definition, EffectDefinition::LoseResource { .. }) {
                    value
                        .checked_neg()
                        .ok_or_else(|| effect_error(EffectErrorCode::NumericFailure, resource_id))?
                } else {
                    value
                };
                Ok(ResolvedEffect::ModifyResource {
                    resource_id: resource_id.clone(),
                    delta,
                })
            }
            EffectDefinition::GainAp { amount } | EffectDefinition::LoseAp { amount } => {
                signed_amount(definition, *amount, "actionPoints")
                    .map(|delta| ResolvedEffect::ModifyAp { delta })
            }
            EffectDefinition::ModifyAp { delta } => Ok(ResolvedEffect::ModifyAp { delta: *delta }),
            EffectDefinition::GainReactionCharge { amount }
            | EffectDefinition::ConsumeReactionCharge { amount } => {
                signed_amount(definition, *amount, "reactionCharges")
                    .map(|delta| ResolvedEffect::ModifyReactionCharge { delta })
            }
            EffectDefinition::Shield { amount } => Ok(ResolvedEffect::GainShield {
                amount: resolve_amount(amount, context.maximum_shield(), "shield")?,
            }),
            EffectDefinition::Cleanse { tag_ids } => {
                validate_ids(tag_ids, true)?;
                Ok(ResolvedEffect::Cleanse {
                    tag_ids: tag_ids.clone(),
                })
            }
            EffectDefinition::Dispel { tag_ids } => {
                validate_ids(tag_ids, true)?;
                Ok(ResolvedEffect::Dispel {
                    tag_ids: tag_ids.clone(),
                })
            }
            EffectDefinition::ModifyCooldown { ability_id, delta } => {
                validate_id(ability_id)?;
                Ok(ResolvedEffect::ModifyCooldown {
                    ability_id: ability_id.clone(),
                    delta: *delta,
                })
            }
            EffectDefinition::ApplyTag { tag_id } => {
                validate_id(tag_id)?;
                Ok(ResolvedEffect::ApplyTag {
                    tag_id: tag_id.clone(),
                })
            }
            EffectDefinition::RemoveTag { tag_id } => {
                validate_id(tag_id)?;
                Ok(ResolvedEffect::RemoveTag {
                    tag_id: tag_id.clone(),
                })
            }
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EffectErrorCode {
    InvalidId,
    InvalidAmount,
    InvalidCollection,
    UnknownResource,
    NumericFailure,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EffectError {
    pub code: EffectErrorCode,
    pub subject: String,
}
impl fmt::Display for EffectError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "effect validation failed for {}: {:?}",
            self.subject, self.code
        )
    }
}
impl Error for EffectError {}

fn resolve_amount(amount: &EffectAmount, maximum: i64, subject: &str) -> Result<i64, EffectError> {
    if maximum < 0 {
        return Err(effect_error(EffectErrorCode::InvalidAmount, subject));
    }
    match amount {
        EffectAmount::Flat { amount } if *amount >= 0 => Ok(*amount),
        EffectAmount::Flat { .. } => Err(effect_error(EffectErrorCode::InvalidAmount, subject)),
        EffectAmount::PercentOfMaximum { percent } => {
            require_nonnegative_fixed(*percent, subject)?;
            CombatNumeric::percent_integer_floor(maximum, *percent)
                .map_err(|_| effect_error(EffectErrorCode::NumericFailure, subject))
        }
    }
}
fn signed_amount(
    definition: &EffectDefinition,
    amount: i64,
    subject: &str,
) -> Result<i64, EffectError> {
    if amount < 0 {
        return Err(effect_error(EffectErrorCode::InvalidAmount, subject));
    }
    if matches!(
        definition,
        EffectDefinition::LoseAp { .. } | EffectDefinition::ConsumeReactionCharge { .. }
    ) {
        amount
            .checked_neg()
            .ok_or_else(|| effect_error(EffectErrorCode::NumericFailure, subject))
    } else {
        Ok(amount)
    }
}
fn validate_stat_modification(value: &StatModification) -> Result<(), EffectError> {
    match value {
        StatModification::Flat { .. } => Ok(()),
        StatModification::Percent {
            percent,
            reference_stat_id,
        } => {
            require_nonnegative_fixed(*percent, "modifyStatPercent")?;
            validate_id(reference_stat_id)
        }
    }
}
fn require_nonnegative_fixed(value: CombatFixed, subject: &str) -> Result<(), EffectError> {
    if value.scaled() < 0 {
        Err(effect_error(EffectErrorCode::InvalidAmount, subject))
    } else {
        Ok(())
    }
}
fn validate_ids(values: &[String], require_nonempty: bool) -> Result<(), EffectError> {
    if require_nonempty && values.is_empty() {
        return Err(effect_error(EffectErrorCode::InvalidCollection, "ids"));
    }
    let mut previous: Option<&str> = None;
    for value in values {
        validate_id(value)?;
        if previous.is_some_and(|item| item >= value) {
            return Err(effect_error(EffectErrorCode::InvalidCollection, value));
        }
        previous = Some(value);
    }
    Ok(())
}
fn validate_id(value: &str) -> Result<(), EffectError> {
    if value.is_empty()
        || value.len() > 128
        || !value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b':' | b'-'))
    {
        Err(effect_error(EffectErrorCode::InvalidId, value))
    } else {
        Ok(())
    }
}
fn effect_error(code: EffectErrorCode, subject: impl Into<String>) -> EffectError {
    EffectError {
        code,
        subject: subject.into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Context;
    impl EffectValueContext for Context {
        fn maximum_hit_points(&self) -> i64 {
            101
        }
        fn maximum_shield(&self) -> i64 {
            20
        }
        fn maximum_resource(&self, id: &str) -> Option<i64> {
            (id == "mana").then_some(40)
        }
    }
    fn flat(amount: i64) -> EffectAmount {
        EffectAmount::Flat { amount }
    }

    #[test]
    fn static_set_contains_exactly_the_nineteen_must_primitives() {
        assert_eq!(EffectPrimitiveId::ALL.len(), 19);
        let json = serde_json::to_string(&EffectPrimitiveId::ALL).unwrap();
        for name in [
            "DEAL_DAMAGE",
            "HEAL",
            "REVIVE",
            "APPLY_STATUS",
            "REMOVE_STATUS",
            "MODIFY_STAT",
            "GAIN_RESOURCE",
            "LOSE_RESOURCE",
            "GAIN_AP",
            "LOSE_AP",
            "MODIFY_AP",
            "GAIN_REACTION_CHARGE",
            "CONSUME_REACTION_CHARGE",
            "SHIELD",
            "CLEANSE",
            "DISPEL",
            "MODIFY_COOLDOWN",
            "APPLY_TAG",
            "REMOVE_TAG",
        ] {
            assert!(json.contains(name), "{name}");
        }
        assert!(!json.contains("SPAWN"));
    }
    #[test]
    fn dispatcher_resolves_amounts_and_signs_deterministically() {
        let ctx = Context;
        assert_eq!(
            EffectHandlerSet::resolve(
                &EffectDefinition::Heal {
                    amount: EffectAmount::PercentOfMaximum {
                        percent: CombatFixed::from_scaled(300_000)
                    }
                },
                &ctx
            )
            .unwrap(),
            ResolvedEffect::Heal { amount: 30 }
        );
        assert_eq!(
            EffectHandlerSet::resolve(
                &EffectDefinition::LoseResource {
                    resource_id: "mana".into(),
                    amount: flat(7)
                },
                &ctx
            )
            .unwrap(),
            ResolvedEffect::ModifyResource {
                resource_id: "mana".into(),
                delta: -7
            }
        );
        assert_eq!(
            EffectHandlerSet::resolve(&EffectDefinition::ConsumeReactionCharge { amount: 1 }, &ctx)
                .unwrap(),
            ResolvedEffect::ModifyReactionCharge { delta: -1 }
        );
    }
    #[test]
    fn revive_requires_positive_recovery_and_uses_minimum_one_percent_term() {
        let ctx = Context;
        let effect = EffectDefinition::Revive {
            restore_hp_flat: Some(2),
            restore_hp_percent: Some(CombatFixed::from_scaled(1)),
            remove_tag_ids: vec!["state.downed".into()],
            apply_status_ids: vec![],
        };
        assert_eq!(
            EffectHandlerSet::resolve(&effect, &ctx).unwrap(),
            ResolvedEffect::Revive {
                restore_hp_amount: 3,
                remove_tag_ids: vec!["state.downed".into()],
                apply_status_ids: vec![]
            }
        );
        let invalid = EffectDefinition::Revive {
            restore_hp_flat: None,
            restore_hp_percent: None,
            remove_tag_ids: vec![],
            apply_status_ids: vec![],
        };
        assert!(EffectHandlerSet::resolve(&invalid, &ctx).is_err());
    }
    #[test]
    fn exact_tagged_union_rejects_unknown_primitives_fields_and_runtime_code() {
        assert!(
            serde_json::from_value::<EffectDefinition>(
                serde_json::json!({"type":"SPAWN","definitionId":"x"})
            )
            .is_err()
        );
        assert!(
            serde_json::from_value::<EffectDefinition>(
                serde_json::json!({"type":"GAIN_AP","amount":1,"handler":"eval(code)"})
            )
            .is_err()
        );
    }
    #[test]
    fn collections_ids_resources_and_percent_references_fail_closed() {
        let ctx = Context;
        assert_eq!(
            EffectHandlerSet::resolve(
                &EffectDefinition::GainResource {
                    resource_id: "unknown".into(),
                    amount: flat(1)
                },
                &ctx
            )
            .unwrap_err()
            .code,
            EffectErrorCode::UnknownResource
        );
        assert!(
            EffectHandlerSet::resolve(&EffectDefinition::Cleanse { tag_ids: vec![] }, &ctx)
                .is_err()
        );
        assert!(
            EffectHandlerSet::resolve(
                &EffectDefinition::ApplyTag {
                    tag_id: "bad id".into()
                },
                &ctx
            )
            .is_err()
        );
        let modification = EffectDefinition::ModifyStat {
            stat_id: "maxHp".into(),
            modification: StatModification::Percent {
                percent: CombatFixed::from_scaled(100_000),
                reference_stat_id: "".into(),
            },
        };
        assert!(EffectHandlerSet::resolve(&modification, &ctx).is_err());
    }
    #[test]
    fn every_variant_reaches_one_exhaustive_dispatch_without_registration() {
        let ctx = Context;
        let variants = vec![
            EffectDefinition::DealDamage {
                channel_id: DamageChannelId::new("fire").unwrap(),
                raw_damage: CombatFixed::from_scaled(1),
            },
            EffectDefinition::Heal { amount: flat(1) },
            EffectDefinition::Revive {
                restore_hp_flat: Some(1),
                restore_hp_percent: None,
                remove_tag_ids: vec![],
                apply_status_ids: vec![],
            },
            EffectDefinition::ApplyStatus {
                status_definition_id: "burning".into(),
            },
            EffectDefinition::RemoveStatus {
                status_definition_id: "burning".into(),
            },
            EffectDefinition::ModifyStat {
                stat_id: "armor".into(),
                modification: StatModification::Flat { delta: 1 },
            },
            EffectDefinition::GainResource {
                resource_id: "mana".into(),
                amount: flat(1),
            },
            EffectDefinition::LoseResource {
                resource_id: "mana".into(),
                amount: flat(1),
            },
            EffectDefinition::GainAp { amount: 1 },
            EffectDefinition::LoseAp { amount: 1 },
            EffectDefinition::ModifyAp { delta: -1 },
            EffectDefinition::GainReactionCharge { amount: 1 },
            EffectDefinition::ConsumeReactionCharge { amount: 1 },
            EffectDefinition::Shield { amount: flat(1) },
            EffectDefinition::Cleanse {
                tag_ids: vec!["status.poison".into()],
            },
            EffectDefinition::Dispel {
                tag_ids: vec!["status.buff".into()],
            },
            EffectDefinition::ModifyCooldown {
                ability_id: "fireball".into(),
                delta: -1,
            },
            EffectDefinition::ApplyTag {
                tag_id: "marked".into(),
            },
            EffectDefinition::RemoveTag {
                tag_id: "marked".into(),
            },
        ];
        for (expected, definition) in EffectPrimitiveId::ALL.into_iter().zip(variants) {
            assert_eq!(definition.primitive_id(), expected);
            EffectHandlerSet::resolve(&definition, &ctx).unwrap();
        }
    }
}

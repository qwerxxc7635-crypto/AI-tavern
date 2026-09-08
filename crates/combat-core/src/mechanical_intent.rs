use std::{collections::BTreeMap, error::Error, fmt};

use serde::{Deserialize, Serialize, de::DeserializeOwned};

use crate::{
    CURRENT_COMBAT_VERSIONS, CombatVersion, CriticalDamageOverride, DamageChannelCatalog,
    DamageChannelId, EffectPrimitiveId, GameplayTagCatalog, GameplayTagId,
    MultipleAttackPenaltyOverride, OpposedTieRule, ResolutionType, WorldCombatProfile, WorldType,
};

const PRIMITIVE_PREFIX: &str = "PRIMITIVE:";
const DAMAGE_CHANNEL_PREFIX: &str = "DAMAGE_CHANNEL:";
const RESOURCE_PREFIX: &str = "RESOURCE:";
const RESOLUTION_PREFIX: &str = "RESOLUTION:";
const MULTIPLE_ATTACK_IGNORE_PREFIX: &str = "LOCAL_OVERRIDE:MULTIPLE_ATTACK_IGNORE_PENALTY:";
const MULTIPLE_ATTACK_COUNT_PREFIX: &str = "LOCAL_OVERRIDE:MULTIPLE_ATTACK_COUNT_AS_BASIC:";
const CRITICAL_DOT_PREFIX: &str = "LOCAL_OVERRIDE:CRITICAL_ALLOW_DAMAGE_OVER_TIME:";
const OPPOSED_ATTACKER_WINS: &str = "LOCAL_OVERRIDE:OPPOSED_TIE_ATTACKER_WINS";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CombatMechanicalConcept {
    pub mechanical_intent: Vec<String>,
    pub candidate_tags: Vec<GameplayTagId>,
    pub target_intent: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum MechanicalTarget {
    SelfTarget,
    SingleAlly,
    SingleEnemy,
    SingleAny,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "owner",
    rename_all = "SCREAMING_SNAKE_CASE",
    deny_unknown_fields
)]
pub enum CanonicalLocalOverride {
    MultipleAttack {
        value: MultipleAttackPenaltyOverride,
    },
    CriticalDamage {
        value: CriticalDamageOverride,
    },
    OpposedTie {
        value: OpposedTieRule,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CanonicalMechanicalDefinition {
    pub ruleset_version: CombatVersion,
    pub world_type: WorldType,
    pub world_profile_version: CombatVersion,
    pub primitives: Vec<EffectPrimitiveId>,
    pub tags: Vec<GameplayTagId>,
    pub damage_channels: Vec<DamageChannelId>,
    pub resource_ids: Vec<String>,
    pub resolution_type: ResolutionType,
    pub target: MechanicalTarget,
    pub local_overrides: Vec<CanonicalLocalOverride>,
}

pub struct MechanicalIntentMapper<'a> {
    tag_catalog: &'a GameplayTagCatalog,
    channel_catalog: &'a DamageChannelCatalog,
}

impl<'a> MechanicalIntentMapper<'a> {
    #[must_use]
    pub const fn new(
        tag_catalog: &'a GameplayTagCatalog,
        channel_catalog: &'a DamageChannelCatalog,
    ) -> Self {
        Self {
            tag_catalog,
            channel_catalog,
        }
    }

    pub fn map(
        &self,
        concept: &CombatMechanicalConcept,
        ruleset_version: CombatVersion,
        profile: &WorldCombatProfile,
    ) -> Result<CanonicalMechanicalDefinition, MechanicalIntentError> {
        if ruleset_version != CURRENT_COMBAT_VERSIONS.ruleset_version {
            return Err(mapping_error(
                MechanicalIntentErrorCode::UnsupportedRulesetVersion,
                "rulesetVersion",
            ));
        }
        if profile.world_profile_version() != CURRENT_COMBAT_VERSIONS.world_profile_version {
            return Err(mapping_error(
                MechanicalIntentErrorCode::UnsupportedWorldProfileVersion,
                "worldProfileVersion",
            ));
        }
        if concept.mechanical_intent.is_empty() {
            return Err(mapping_error(
                MechanicalIntentErrorCode::MissingPrimitive,
                "mechanicalIntent",
            ));
        }

        let mut primitives = Vec::new();
        let mut channels = Vec::new();
        let mut resources = Vec::new();
        let mut resolution = None;
        let mut overrides = BTreeMap::new();

        for token in &concept.mechanical_intent {
            if let Some(value) = token.strip_prefix(PRIMITIVE_PREFIX) {
                primitives.push(parse_closed(value, "primitive")?);
            } else if let Some(value) = token.strip_prefix(DAMAGE_CHANNEL_PREFIX) {
                let channel = DamageChannelId::new(value).map_err(|_| {
                    mapping_error(MechanicalIntentErrorCode::UnknownDamageChannel, value)
                })?;
                if !self.channel_catalog.contains(&channel) {
                    return Err(mapping_error(
                        MechanicalIntentErrorCode::UnknownDamageChannel,
                        value,
                    ));
                }
                channels.push(channel);
            } else if let Some(value) = token.strip_prefix(RESOURCE_PREFIX) {
                if !valid_stable_id(value) {
                    return Err(mapping_error(
                        MechanicalIntentErrorCode::UnknownProfileResource,
                        value,
                    ));
                }
                resources.push(value.to_owned());
            } else if let Some(value) = token.strip_prefix(RESOLUTION_PREFIX) {
                let parsed = parse_closed(value, "resolution")?;
                if resolution.replace(parsed).is_some() {
                    return Err(mapping_error(
                        MechanicalIntentErrorCode::DuplicateResolution,
                        token,
                    ));
                }
            } else if let Some(rule_id) = token.strip_prefix(MULTIPLE_ATTACK_IGNORE_PREFIX) {
                insert_override(
                    &mut overrides,
                    "multipleAttack",
                    CanonicalLocalOverride::MultipleAttack {
                        value: MultipleAttackPenaltyOverride::IgnorePenalty {
                            rule_id: require_rule_id(rule_id)?,
                        },
                    },
                )?;
            } else if let Some(rule_id) = token.strip_prefix(MULTIPLE_ATTACK_COUNT_PREFIX) {
                insert_override(
                    &mut overrides,
                    "multipleAttack",
                    CanonicalLocalOverride::MultipleAttack {
                        value: MultipleAttackPenaltyOverride::CountAsBasicAttack {
                            rule_id: require_rule_id(rule_id)?,
                        },
                    },
                )?;
            } else if let Some(rule_id) = token.strip_prefix(CRITICAL_DOT_PREFIX) {
                insert_override(
                    &mut overrides,
                    "criticalDamage",
                    CanonicalLocalOverride::CriticalDamage {
                        value: CriticalDamageOverride::AllowDamageOverTime {
                            rule_id: require_rule_id(rule_id)?,
                        },
                    },
                )?;
            } else if token == OPPOSED_ATTACKER_WINS {
                insert_override(
                    &mut overrides,
                    "opposedTie",
                    CanonicalLocalOverride::OpposedTie {
                        value: OpposedTieRule::AttackerWins,
                    },
                )?;
            } else {
                return Err(mapping_error(
                    MechanicalIntentErrorCode::UnknownIntent,
                    token,
                ));
            }
        }

        canonicalize_unique(&mut primitives, "primitive")?;
        canonicalize_unique(&mut channels, "damageChannel")?;
        resources.sort();
        reject_adjacent_duplicate(&resources, "resource")?;

        if primitives.is_empty() {
            return Err(mapping_error(
                MechanicalIntentErrorCode::MissingPrimitive,
                "mechanicalIntent",
            ));
        }
        let resolution_type = resolution.ok_or_else(|| {
            mapping_error(
                MechanicalIntentErrorCode::MissingResolution,
                "mechanicalIntent",
            )
        })?;

        let mut tags = concept.candidate_tags.clone();
        tags.sort();
        reject_adjacent_duplicate(&tags, "candidateTags")?;
        self.tag_catalog.require_all_known(&tags).map_err(|error| {
            mapping_error(MechanicalIntentErrorCode::UnknownGameplayTag, error.subject)
        })?;

        for channel in &channels {
            if !profile
                .defense_behavior()
                .allowed_damage_channels
                .contains(channel)
            {
                return Err(mapping_error(
                    MechanicalIntentErrorCode::UnsupportedProfileDamageChannel,
                    channel.as_str(),
                ));
            }
        }
        for resource_id in &resources {
            if !profile
                .resource_lifecycle()
                .resources
                .iter()
                .any(|rule| rule.resource_id == *resource_id)
            {
                return Err(mapping_error(
                    MechanicalIntentErrorCode::UnknownProfileResource,
                    resource_id,
                ));
            }
        }

        let deals_damage = primitives.contains(&EffectPrimitiveId::DealDamage);
        if deals_damage != !channels.is_empty() {
            return Err(mapping_error(
                MechanicalIntentErrorCode::IncompleteDamageIntent,
                "damageChannel",
            ));
        }
        let uses_resource = primitives.iter().any(|primitive| {
            matches!(
                primitive,
                EffectPrimitiveId::GainResource | EffectPrimitiveId::LoseResource
            )
        });
        if uses_resource != !resources.is_empty() {
            return Err(mapping_error(
                MechanicalIntentErrorCode::IncompleteResourceIntent,
                "resource",
            ));
        }
        for override_value in overrides.values() {
            let compatible = match override_value {
                CanonicalLocalOverride::CriticalDamage { .. } => deals_damage,
                CanonicalLocalOverride::OpposedTie { .. } => {
                    resolution_type == ResolutionType::OpposedCheck
                }
                CanonicalLocalOverride::MultipleAttack { .. } => true,
            };
            if !compatible {
                return Err(mapping_error(
                    MechanicalIntentErrorCode::IncompatibleLocalOverride,
                    "localOverride",
                ));
            }
        }

        Ok(CanonicalMechanicalDefinition {
            ruleset_version,
            world_type: profile.world_type(),
            world_profile_version: profile.world_profile_version(),
            primitives,
            tags,
            damage_channels: channels,
            resource_ids: resources,
            resolution_type,
            target: parse_closed(&concept.target_intent, "targetIntent")?,
            local_overrides: overrides.into_values().collect(),
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MechanicalIntentErrorCode {
    UnsupportedRulesetVersion,
    UnsupportedWorldProfileVersion,
    UnknownIntent,
    UnknownPrimitive,
    UnknownGameplayTag,
    UnknownDamageChannel,
    UnsupportedProfileDamageChannel,
    UnknownProfileResource,
    UnknownResolution,
    UnknownTarget,
    MissingPrimitive,
    MissingResolution,
    DuplicateIntent,
    DuplicateResolution,
    DuplicateLocalOverride,
    InvalidLocalOverrideRuleId,
    IncompatibleLocalOverride,
    IncompleteDamageIntent,
    IncompleteResourceIntent,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MechanicalIntentError {
    pub code: MechanicalIntentErrorCode,
    pub subject: String,
}

impl fmt::Display for MechanicalIntentError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "mechanical intent mapping failed for {}: {:?}",
            self.subject, self.code
        )
    }
}

impl Error for MechanicalIntentError {}

fn parse_closed<T: DeserializeOwned>(
    value: &str,
    subject: &'static str,
) -> Result<T, MechanicalIntentError> {
    serde_json::from_value(serde_json::Value::String(value.to_owned())).map_err(|_| {
        let code = match subject {
            "primitive" => MechanicalIntentErrorCode::UnknownPrimitive,
            "resolution" => MechanicalIntentErrorCode::UnknownResolution,
            "targetIntent" => MechanicalIntentErrorCode::UnknownTarget,
            _ => MechanicalIntentErrorCode::UnknownIntent,
        };
        mapping_error(code, value)
    })
}

fn canonicalize_unique<T: Ord>(
    values: &mut [T],
    subject: &'static str,
) -> Result<(), MechanicalIntentError> {
    values.sort();
    reject_adjacent_duplicate(values, subject)
}

fn reject_adjacent_duplicate<T: PartialEq>(
    values: &[T],
    subject: &'static str,
) -> Result<(), MechanicalIntentError> {
    if values.windows(2).any(|pair| pair[0] == pair[1]) {
        return Err(mapping_error(
            MechanicalIntentErrorCode::DuplicateIntent,
            subject,
        ));
    }
    Ok(())
}

fn insert_override(
    overrides: &mut BTreeMap<&'static str, CanonicalLocalOverride>,
    owner: &'static str,
    value: CanonicalLocalOverride,
) -> Result<(), MechanicalIntentError> {
    if overrides.insert(owner, value).is_some() {
        return Err(mapping_error(
            MechanicalIntentErrorCode::DuplicateLocalOverride,
            owner,
        ));
    }
    Ok(())
}

fn require_rule_id(value: &str) -> Result<String, MechanicalIntentError> {
    if !valid_stable_id(value) {
        return Err(mapping_error(
            MechanicalIntentErrorCode::InvalidLocalOverrideRuleId,
            value,
        ));
    }
    Ok(value.to_owned())
}

fn valid_stable_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'_'))
}

fn mapping_error(
    code: MechanicalIntentErrorCode,
    subject: impl Into<String>,
) -> MechanicalIntentError {
    MechanicalIntentError {
        code,
        subject: subject.into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::WorldCombatProfileResolver;

    fn catalogs() -> (GameplayTagCatalog, DamageChannelCatalog) {
        (GameplayTagCatalog::v0_4_1(), DamageChannelCatalog::v0_4_1())
    }

    fn cultivation_concept(intents: &[&str]) -> CombatMechanicalConcept {
        CombatMechanicalConcept {
            mechanical_intent: intents.iter().map(|value| (*value).to_owned()).collect(),
            candidate_tags: ["Ability.Attack", "Ability.Spell", "Damage.Soul"]
                .into_iter()
                .map(|value| GameplayTagId::new(value).unwrap())
                .collect(),
            target_intent: "SINGLE_ENEMY".to_owned(),
        }
    }

    #[test]
    fn maps_to_canonical_authorities_and_is_order_independent() {
        let (tags, channels) = catalogs();
        let resolver = WorldCombatProfileResolver::v0_4_1(&channels).unwrap();
        let mapper = MechanicalIntentMapper::new(&tags, &channels);
        let left = cultivation_concept(&[
            "PRIMITIVE:LOSE_RESOURCE",
            "RESOURCE:qi",
            "RESOLUTION:ATTACK_ROLL",
            "DAMAGE_CHANNEL:soul",
            "PRIMITIVE:DEAL_DAMAGE",
        ]);
        let mut right = cultivation_concept(&[
            "PRIMITIVE:DEAL_DAMAGE",
            "DAMAGE_CHANNEL:soul",
            "RESOLUTION:ATTACK_ROLL",
            "RESOURCE:qi",
            "PRIMITIVE:LOSE_RESOURCE",
        ]);
        right.candidate_tags.reverse();

        let left = mapper
            .map(
                &left,
                CURRENT_COMBAT_VERSIONS.ruleset_version,
                resolver.resolve(WorldType::Cultivation),
            )
            .unwrap();
        let right = mapper
            .map(
                &right,
                CURRENT_COMBAT_VERSIONS.ruleset_version,
                resolver.resolve(WorldType::Cultivation),
            )
            .unwrap();

        assert_eq!(left, right);
        assert_eq!(
            serde_json::to_vec(&left).unwrap(),
            serde_json::to_vec(&right).unwrap()
        );
        assert_eq!(left.primitives.len(), 2);
        assert_eq!(left.damage_channels[0].as_str(), "soul");
        assert_eq!(left.resource_ids, ["qi"]);
        assert_eq!(left.resolution_type, ResolutionType::AttackRoll);
    }

    #[test]
    fn maps_only_the_existing_local_typed_override_types() {
        let (tags, channels) = catalogs();
        let resolver = WorldCombatProfileResolver::v0_4_1(&channels).unwrap();
        let mapper = MechanicalIntentMapper::new(&tags, &channels);
        let concept = cultivation_concept(&[
            "PRIMITIVE:DEAL_DAMAGE",
            "DAMAGE_CHANNEL:soul",
            "RESOLUTION:OPPOSED_CHECK",
            "LOCAL_OVERRIDE:MULTIPLE_ATTACK_IGNORE_PENALTY:attack.ignore-map",
            "LOCAL_OVERRIDE:CRITICAL_ALLOW_DAMAGE_OVER_TIME:critical.allow-dot",
            "LOCAL_OVERRIDE:OPPOSED_TIE_ATTACKER_WINS",
        ]);

        let definition = mapper
            .map(
                &concept,
                CURRENT_COMBAT_VERSIONS.ruleset_version,
                resolver.resolve(WorldType::Cultivation),
            )
            .unwrap();

        assert!(matches!(
            &definition.local_overrides[0],
            CanonicalLocalOverride::CriticalDamage {
                value: CriticalDamageOverride::AllowDamageOverTime { rule_id }
            } if rule_id == "critical.allow-dot"
        ));
        assert!(matches!(
            &definition.local_overrides[1],
            CanonicalLocalOverride::MultipleAttack {
                value: MultipleAttackPenaltyOverride::IgnorePenalty { rule_id }
            } if rule_id == "attack.ignore-map"
        ));
        assert!(matches!(
            definition.local_overrides[2],
            CanonicalLocalOverride::OpposedTie {
                value: OpposedTieRule::AttackerWins
            }
        ));
    }

    #[test]
    fn rejects_unknown_or_unmappable_intents_without_guessing() {
        let (tags, channels) = catalogs();
        let resolver = WorldCombatProfileResolver::v0_4_1(&channels).unwrap();
        let mapper = MechanicalIntentMapper::new(&tags, &channels);
        let profile = resolver.resolve(WorldType::Cultivation);

        for (token, code) in [
            ("make it epic", MechanicalIntentErrorCode::UnknownIntent),
            (
                "PRIMITIVE:TELEPORT_TARGET",
                MechanicalIntentErrorCode::UnknownPrimitive,
            ),
            (
                "RESOLUTION:ROLL_WHATEVER",
                MechanicalIntentErrorCode::UnknownResolution,
            ),
            (
                "DAMAGE_CHANNEL:friendship",
                MechanicalIntentErrorCode::UnknownDamageChannel,
            ),
        ] {
            let concept = cultivation_concept(&[token]);
            assert_eq!(
                mapper
                    .map(&concept, CURRENT_COMBAT_VERSIONS.ruleset_version, profile)
                    .unwrap_err()
                    .code,
                code
            );
        }
    }

    #[test]
    fn rejects_unknown_tags_and_cross_profile_mechanics() {
        let (tags, channels) = catalogs();
        let resolver = WorldCombatProfileResolver::v0_4_1(&channels).unwrap();
        let mapper = MechanicalIntentMapper::new(&tags, &channels);
        let cultivation = resolver.resolve(WorldType::Cultivation);

        let mut unknown_tag = cultivation_concept(&[
            "PRIMITIVE:DEAL_DAMAGE",
            "DAMAGE_CHANNEL:soul",
            "RESOLUTION:ATTACK_ROLL",
        ]);
        unknown_tag.candidate_tags = vec![GameplayTagId::new("Element.Void").unwrap()];
        assert_eq!(
            mapper
                .map(
                    &unknown_tag,
                    CURRENT_COMBAT_VERSIONS.ruleset_version,
                    cultivation,
                )
                .unwrap_err()
                .code,
            MechanicalIntentErrorCode::UnknownGameplayTag
        );

        let wrong_channel = cultivation_concept(&[
            "PRIMITIVE:DEAL_DAMAGE",
            "DAMAGE_CHANNEL:plasma",
            "RESOLUTION:ATTACK_ROLL",
        ]);
        assert_eq!(
            mapper
                .map(
                    &wrong_channel,
                    CURRENT_COMBAT_VERSIONS.ruleset_version,
                    cultivation,
                )
                .unwrap_err()
                .code,
            MechanicalIntentErrorCode::UnsupportedProfileDamageChannel
        );

        let wrong_resource = cultivation_concept(&[
            "PRIMITIVE:LOSE_RESOURCE",
            "RESOURCE:mana",
            "RESOLUTION:AUTO_HIT",
        ]);
        assert_eq!(
            mapper
                .map(
                    &wrong_resource,
                    CURRENT_COMBAT_VERSIONS.ruleset_version,
                    cultivation,
                )
                .unwrap_err()
                .code,
            MechanicalIntentErrorCode::UnknownProfileResource
        );
    }

    #[test]
    fn rejects_incomplete_and_duplicate_intents() {
        let (tags, channels) = catalogs();
        let resolver = WorldCombatProfileResolver::v0_4_1(&channels).unwrap();
        let mapper = MechanicalIntentMapper::new(&tags, &channels);
        let profile = resolver.resolve(WorldType::Cultivation);

        for (intents, code) in [
            (
                vec!["PRIMITIVE:DEAL_DAMAGE", "RESOLUTION:ATTACK_ROLL"],
                MechanicalIntentErrorCode::IncompleteDamageIntent,
            ),
            (
                vec!["PRIMITIVE:HEAL", "RESOURCE:qi", "RESOLUTION:AUTO_HIT"],
                MechanicalIntentErrorCode::IncompleteResourceIntent,
            ),
            (
                vec!["PRIMITIVE:HEAL", "PRIMITIVE:HEAL", "RESOLUTION:AUTO_HIT"],
                MechanicalIntentErrorCode::DuplicateIntent,
            ),
        ] {
            let concept = cultivation_concept(&intents);
            assert_eq!(
                mapper
                    .map(&concept, CURRENT_COMBAT_VERSIONS.ruleset_version, profile)
                    .unwrap_err()
                    .code,
                code
            );
        }
    }

    #[test]
    fn rejects_incompatible_override_and_unknown_target() {
        let (tags, channels) = catalogs();
        let resolver = WorldCombatProfileResolver::v0_4_1(&channels).unwrap();
        let mapper = MechanicalIntentMapper::new(&tags, &channels);
        let profile = resolver.resolve(WorldType::Cultivation);

        let incompatible = cultivation_concept(&[
            "PRIMITIVE:HEAL",
            "RESOLUTION:AUTO_HIT",
            "LOCAL_OVERRIDE:CRITICAL_ALLOW_DAMAGE_OVER_TIME:critical.allow-dot",
        ]);
        assert_eq!(
            mapper
                .map(
                    &incompatible,
                    CURRENT_COMBAT_VERSIONS.ruleset_version,
                    profile,
                )
                .unwrap_err()
                .code,
            MechanicalIntentErrorCode::IncompatibleLocalOverride
        );

        let mut unknown_target = cultivation_concept(&["PRIMITIVE:HEAL", "RESOLUTION:AUTO_HIT"]);
        unknown_target.target_intent = "EVERYONE_NEARBY".to_owned();
        assert_eq!(
            mapper
                .map(
                    &unknown_target,
                    CURRENT_COMBAT_VERSIONS.ruleset_version,
                    profile,
                )
                .unwrap_err()
                .code,
            MechanicalIntentErrorCode::UnknownTarget
        );
    }

    #[test]
    fn strict_wire_shape_rejects_unknown_fields() {
        let result = serde_json::from_value::<CombatMechanicalConcept>(serde_json::json!({
            "mechanicalIntent": ["PRIMITIVE:HEAL", "RESOLUTION:AUTO_HIT"],
            "candidateTags": ["Ability.Heal"],
            "targetIntent": "SINGLE_ALLY",
            "runtimeCode": "target.hp += 999"
        }));
        assert!(result.is_err());
    }
}

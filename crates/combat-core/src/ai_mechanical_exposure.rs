use std::{error::Error, fmt};

use serde::{Deserialize, Serialize};

use crate::{
    CURRENT_COMBAT_VERSIONS, CanonicalMechanicalDefinition, CombatVersion, DamageChannelCatalog,
    DamageChannelId, EffectPrimitiveId, GameplayTagCatalog, GameplayTagId, MechanicalTarget,
    ResolutionType, ResourceStorage, WorldCombatProfile, WorldType,
};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AiMechanicalExposure {
    pub ruleset_version: CombatVersion,
    pub world_type: WorldType,
    pub world_profile_version: CombatVersion,
    pub primitives: Vec<EffectPrimitiveId>,
    pub tags: Vec<GameplayTagId>,
    pub damage_channels: Vec<DamageChannelId>,
    pub resource_ids: Vec<String>,
    pub resolution_types: Vec<ResolutionType>,
    pub targets: Vec<MechanicalTarget>,
}

pub struct AiMechanicalExposurePolicy<'a> {
    tag_catalog: &'a GameplayTagCatalog,
    channel_catalog: &'a DamageChannelCatalog,
}

impl<'a> AiMechanicalExposurePolicy<'a> {
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

    /// Projects the one ordinary-AI allow surface from canonical owners.
    ///
    /// This snapshot may be supplied to a prompt or repair request. It is not a
    /// second registry: every member is read from an existing enum/catalog/profile.
    #[must_use]
    pub fn exposure_for(&self, profile: &WorldCombatProfile) -> AiMechanicalExposure {
        AiMechanicalExposure {
            ruleset_version: CURRENT_COMBAT_VERSIONS.ruleset_version,
            world_type: profile.world_type(),
            world_profile_version: profile.world_profile_version(),
            primitives: EffectPrimitiveId::ALL.to_vec(),
            tags: self
                .tag_catalog
                .tags()
                .iter()
                .map(|definition| definition.tag_id.clone())
                .collect(),
            damage_channels: profile.defense_behavior().allowed_damage_channels.clone(),
            resource_ids: profile
                .resource_lifecycle()
                .resources
                .iter()
                .filter(|rule| {
                    matches!(
                        rule.storage,
                        ResourceStorage::ResourcePool | ResourceStorage::PressureResourcePool
                    )
                })
                .map(|rule| rule.resource_id.clone())
                .collect(),
            resolution_types: ordinary_resolution_types(),
            targets: MechanicalTarget::ALL.to_vec(),
        }
    }

    pub fn validate_ordinary_candidate(
        &self,
        definition: &CanonicalMechanicalDefinition,
        profile: &WorldCombatProfile,
    ) -> Result<(), AiMechanicalExposureError> {
        if definition.ruleset_version != CURRENT_COMBAT_VERSIONS.ruleset_version {
            return Err(exposure_error(
                AiMechanicalExposureErrorCode::UnsupportedRulesetVersion,
                "rulesetVersion",
            ));
        }
        if definition.world_type != profile.world_type()
            || definition.world_profile_version != profile.world_profile_version()
        {
            return Err(exposure_error(
                AiMechanicalExposureErrorCode::ProfileIdentityMismatch,
                "worldProfile",
            ));
        }
        if !definition.local_overrides.is_empty() {
            return Err(exposure_error(
                AiMechanicalExposureErrorCode::DeveloperOnlyLocalOverride,
                "localOverrides",
            ));
        }

        let exposure = self.exposure_for(profile);
        require_nonempty_subset(
            &definition.primitives,
            &exposure.primitives,
            AiMechanicalExposureErrorCode::PrimitiveNotExposed,
            "primitives",
        )?;
        require_subset(
            &definition.tags,
            &exposure.tags,
            AiMechanicalExposureErrorCode::TagNotExposed,
            "tags",
        )?;
        require_subset(
            &definition.damage_channels,
            &exposure.damage_channels,
            AiMechanicalExposureErrorCode::DamageChannelNotExposed,
            "damageChannels",
        )?;
        require_subset(
            &definition.resource_ids,
            &exposure.resource_ids,
            AiMechanicalExposureErrorCode::ResourceNotExposed,
            "resourceIds",
        )?;
        if !exposure
            .resolution_types
            .contains(&definition.resolution_type)
        {
            return Err(exposure_error(
                AiMechanicalExposureErrorCode::ResolutionNotExposed,
                "resolutionType",
            ));
        }
        if !exposure.targets.contains(&definition.target) {
            return Err(exposure_error(
                AiMechanicalExposureErrorCode::TargetNotExposed,
                "target",
            ));
        }

        // The catalog is checked again at this trust boundary instead of assuming
        // callers preserved a prior mapper result.
        for channel in &definition.damage_channels {
            if !self.channel_catalog.contains(channel) {
                return Err(exposure_error(
                    AiMechanicalExposureErrorCode::DamageChannelNotExposed,
                    channel.as_str(),
                ));
            }
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AiMechanicalExposureErrorCode {
    UnsupportedRulesetVersion,
    ProfileIdentityMismatch,
    DeveloperOnlyLocalOverride,
    PrimitiveNotExposed,
    TagNotExposed,
    DamageChannelNotExposed,
    ResourceNotExposed,
    ResolutionNotExposed,
    TargetNotExposed,
    NonCanonicalExposureInput,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AiMechanicalExposureError {
    pub code: AiMechanicalExposureErrorCode,
    pub subject: String,
}

impl fmt::Display for AiMechanicalExposureError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "AI mechanical exposure rejected {}: {:?}",
            self.subject, self.code
        )
    }
}

impl Error for AiMechanicalExposureError {}

fn require_nonempty_subset<T: Ord>(
    requested: &[T],
    exposed: &[T],
    code: AiMechanicalExposureErrorCode,
    subject: &'static str,
) -> Result<(), AiMechanicalExposureError> {
    if requested.is_empty() {
        return Err(exposure_error(code, subject));
    }
    require_subset(requested, exposed, code, subject)
}

fn require_subset<T: Ord>(
    requested: &[T],
    exposed: &[T],
    code: AiMechanicalExposureErrorCode,
    subject: &'static str,
) -> Result<(), AiMechanicalExposureError> {
    if requested.windows(2).any(|pair| pair[0] >= pair[1]) {
        return Err(exposure_error(
            AiMechanicalExposureErrorCode::NonCanonicalExposureInput,
            subject,
        ));
    }
    if requested
        .iter()
        .any(|value| exposed.binary_search(value).is_err())
    {
        return Err(exposure_error(code, subject));
    }
    Ok(())
}

fn exposure_error(
    code: AiMechanicalExposureErrorCode,
    subject: impl Into<String>,
) -> AiMechanicalExposureError {
    AiMechanicalExposureError {
        code,
        subject: subject.into(),
    }
}

fn ordinary_resolution_types() -> Vec<ResolutionType> {
    vec![
        ResolutionType::AttackRoll,
        ResolutionType::SavingThrow,
        ResolutionType::OpposedCheck,
        ResolutionType::AutoHit,
        ResolutionType::ConditionalCheck,
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        CanonicalLocalOverride, CriticalDamageOverride, MechanicalIntentMapper,
        MultipleAttackPenaltyOverride, OpposedTieRule, WorldCombatProfileResolver,
    };

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

        fn mapped(&self) -> CanonicalMechanicalDefinition {
            let concept = crate::CombatMechanicalConcept {
                mechanical_intent: vec![
                    "PRIMITIVE:DEAL_DAMAGE".to_owned(),
                    "DAMAGE_CHANNEL:soul".to_owned(),
                    "RESOLUTION:ATTACK_ROLL".to_owned(),
                ],
                candidate_tags: vec![
                    GameplayTagId::new("Ability.Attack").unwrap(),
                    GameplayTagId::new("Damage.Soul").unwrap(),
                ],
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
    fn exposure_is_projected_from_canonical_owners_and_profile() {
        let fixture = Fixture::new();
        let policy = AiMechanicalExposurePolicy::new(&fixture.tags, &fixture.channels);
        let exposure = policy.exposure_for(fixture.resolver.resolve(WorldType::Cultivation));

        assert_eq!(exposure.primitives, EffectPrimitiveId::ALL);
        assert_eq!(exposure.resolution_types.len(), 5);
        assert!(
            !exposure
                .resolution_types
                .contains(&ResolutionType::AttemptEscape)
        );
        assert_eq!(exposure.targets, MechanicalTarget::ALL);
        assert_eq!(exposure.damage_channels.len(), 3);
        assert_eq!(exposure.resource_ids, ["qi", "spirit_sense"]);
        assert_eq!(exposure.tags.len(), fixture.tags.tags().len());
        assert!(!exposure.resource_ids.contains(&"health".to_owned()));
    }

    #[test]
    fn ordinary_mapped_candidate_passes_the_single_policy() {
        let fixture = Fixture::new();
        let policy = AiMechanicalExposurePolicy::new(&fixture.tags, &fixture.channels);
        assert!(
            policy
                .validate_ordinary_candidate(
                    &fixture.mapped(),
                    fixture.resolver.resolve(WorldType::Cultivation),
                )
                .is_ok()
        );
    }

    #[test]
    fn every_local_override_is_developer_only_for_ordinary_ai() {
        let fixture = Fixture::new();
        let policy = AiMechanicalExposurePolicy::new(&fixture.tags, &fixture.channels);
        let profile = fixture.resolver.resolve(WorldType::Cultivation);
        let overrides = [
            CanonicalLocalOverride::MultipleAttack {
                value: MultipleAttackPenaltyOverride::IgnorePenalty {
                    rule_id: "attack.ignore-map".to_owned(),
                },
            },
            CanonicalLocalOverride::CriticalDamage {
                value: CriticalDamageOverride::AllowDamageOverTime {
                    rule_id: "critical.allow-dot".to_owned(),
                },
            },
            CanonicalLocalOverride::OpposedTie {
                value: OpposedTieRule::AttackerWins,
            },
        ];

        for override_value in overrides {
            let mut definition = fixture.mapped();
            definition.local_overrides = vec![override_value];
            assert_eq!(
                policy
                    .validate_ordinary_candidate(&definition, profile)
                    .unwrap_err()
                    .code,
                AiMechanicalExposureErrorCode::DeveloperOnlyLocalOverride
            );
        }
    }

    #[test]
    fn attempt_escape_and_health_resource_are_not_exposed() {
        let fixture = Fixture::new();
        let policy = AiMechanicalExposurePolicy::new(&fixture.tags, &fixture.channels);
        let profile = fixture.resolver.resolve(WorldType::Cultivation);

        let mut attempt_escape = fixture.mapped();
        attempt_escape.resolution_type = ResolutionType::AttemptEscape;
        assert_eq!(
            policy
                .validate_ordinary_candidate(&attempt_escape, profile)
                .unwrap_err()
                .code,
            AiMechanicalExposureErrorCode::ResolutionNotExposed
        );

        let mut health_resource = fixture.mapped();
        health_resource.resource_ids = vec!["health".to_owned()];
        assert_eq!(
            policy
                .validate_ordinary_candidate(&health_resource, profile)
                .unwrap_err()
                .code,
            AiMechanicalExposureErrorCode::ResourceNotExposed
        );
    }

    #[test]
    fn cross_profile_and_noncanonical_inputs_fail_closed() {
        let fixture = Fixture::new();
        let policy = AiMechanicalExposurePolicy::new(&fixture.tags, &fixture.channels);
        let cultivation = fixture.resolver.resolve(WorldType::Cultivation);

        let mut wrong_profile = fixture.mapped();
        wrong_profile.world_type = WorldType::Fantasy;
        assert_eq!(
            policy
                .validate_ordinary_candidate(&wrong_profile, cultivation)
                .unwrap_err()
                .code,
            AiMechanicalExposureErrorCode::ProfileIdentityMismatch
        );

        let mut duplicate_tag = fixture.mapped();
        duplicate_tag.tags.push(duplicate_tag.tags[0].clone());
        duplicate_tag.tags.sort();
        assert_eq!(
            policy
                .validate_ordinary_candidate(&duplicate_tag, cultivation)
                .unwrap_err()
                .code,
            AiMechanicalExposureErrorCode::NonCanonicalExposureInput
        );
    }
}

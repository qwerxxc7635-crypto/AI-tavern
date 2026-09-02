use std::{collections::BTreeSet, error::Error, fmt};

use serde::{Deserialize, Serialize};

use crate::{CURRENT_COMBAT_VERSIONS, CombatVersion, CombatVersionSet};

const V03_RULE_SCHEMA_VERSION: u32 = 1;
const V03_UNIVERSAL_CHARACTER_SCHEMA_VERSION: u32 = 1;
const V03_ATTRIBUTE_MIN: i64 = 1;
const V03_ATTRIBUTE_MAX: i64 = 5;
const V03_ATTRIBUTE_TOTAL: i64 = 10;
const V03_LEGACY_MODIFIER_LIMIT: i64 = 5;
const V03_SKILL_MAX: i64 = 20;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CombatAttributeRole {
    Body,
    Finesse,
    Intellect,
    Presence,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CombatSaveType {
    Fortitude,
    Reflex,
    Mental,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum WorldCombatProfileId {
    #[serde(rename = "FANTASY")]
    Fantasy,
    #[serde(rename = "SCI_FI")]
    SciFi,
    #[serde(rename = "CULTIVATION")]
    Cultivation,
    #[serde(rename = "URBAN")]
    Urban,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct V03BaseAttributes {
    pub physique: i64,
    pub agility: i64,
    pub knowledge: i64,
    pub charisma: i64,
}

impl V03BaseAttributes {
    #[must_use]
    pub const fn value(self, role: CombatAttributeRole) -> i64 {
        match role {
            CombatAttributeRole::Body => self.physique,
            CombatAttributeRole::Finesse => self.agility,
            CombatAttributeRole::Intellect => self.knowledge,
            CombatAttributeRole::Presence => self.charisma,
        }
    }

    fn add_modifier(
        &mut self,
        role: CombatAttributeRole,
        amount: i64,
    ) -> Result<(), CombatAttributeResolverError> {
        let slot = match role {
            CombatAttributeRole::Body => &mut self.physique,
            CombatAttributeRole::Finesse => &mut self.agility,
            CombatAttributeRole::Intellect => &mut self.knowledge,
            CombatAttributeRole::Presence => &mut self.charisma,
        };
        *slot = slot.checked_add(amount).ok_or_else(|| {
            resolver_error(
                CombatAttributeResolverErrorCode::ModifierOverflow,
                "effectiveAttributes",
            )
        })?;
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct V03HitPoints {
    pub current: i64,
    pub max: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct V03UniversalAttributeProjection {
    pub schema_version: u32,
    pub revision: u64,
    pub attributes: V03BaseAttributes,
    pub textual_proficiencies: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct V03RuleSkill {
    pub key: String,
    pub value: i64,
    pub trait_modifier_total: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum LegacyAttributeModifierKind {
    Status,
    Trait,
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LegacyAttributeModifier {
    pub kind: LegacyAttributeModifierKind,
    pub source_id: String,
    pub role: CombatAttributeRole,
    pub amount: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct V03PlayerCombatSource {
    pub player_character_id: String,
    pub rule_schema_version: u32,
    pub source_revision: u64,
    pub rule_base_attributes: V03BaseAttributes,
    pub player_attributes: V03BaseAttributes,
    pub universal_projection: Option<V03UniversalAttributeProjection>,
    pub hit_points: V03HitPoints,
    pub rule_skills: Vec<V03RuleSkill>,
    pub legacy_attribute_modifiers: Vec<LegacyAttributeModifier>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "sourceType",
    rename_all = "SCREAMING_SNAKE_CASE",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum V03CombatAttributeSource {
    Player(Box<V03PlayerCombatSource>),
    NpcWithoutCombatProjection { npc_id: String },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CombatProficiencyDefinition {
    pub proficiency_id: String,
    pub numeric_skill_key: String,
    pub textual_aliases: Vec<String>,
    pub textual_baseline: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CombatAttributeProfile {
    pub world_profile_id: WorldCombatProfileId,
    pub world_profile_version: CombatVersion,
    pub base_defense: i64,
    pub initiative_modifier: i64,
    pub proficiency_definitions: Vec<CombatProficiencyDefinition>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResolvedProficiency {
    pub proficiency_id: String,
    pub value: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResolvedCombatAttributes {
    pub player_character_id: String,
    pub source_revision: u64,
    pub universal_source_revision: Option<u64>,
    pub attribute_mapping_version: CombatVersion,
    pub world_profile_id: WorldCombatProfileId,
    pub world_profile_version: CombatVersion,
    pub base_attributes: V03BaseAttributes,
    pub effective_attributes: V03BaseAttributes,
    pub hit_points: V03HitPoints,
    pub initiative_base_stat: i64,
    pub profile_initiative_modifier: i64,
    pub base_defense: i64,
    pub proficiencies: Vec<ResolvedProficiency>,
    pub applied_legacy_modifiers: Vec<LegacyAttributeModifier>,
}

impl ResolvedCombatAttributes {
    #[must_use]
    pub const fn resolve_attack_attribute(&self, role: CombatAttributeRole) -> i64 {
        self.effective_attributes.value(role)
    }

    #[must_use]
    pub const fn resolve_defense_attribute(&self, role: CombatAttributeRole) -> i64 {
        self.effective_attributes.value(role)
    }

    #[must_use]
    pub const fn resolve_ability_dc_attribute(&self, role: CombatAttributeRole) -> i64 {
        self.effective_attributes.value(role)
    }

    #[must_use]
    pub const fn resolve_save_attribute(&self, save_type: CombatSaveType) -> i64 {
        match save_type {
            CombatSaveType::Fortitude => self.effective_attributes.physique,
            CombatSaveType::Reflex => self.effective_attributes.agility,
            CombatSaveType::Mental => self.effective_attributes.charisma,
        }
    }

    pub fn resolve_initiative_modifier(&self) -> Result<i64, CombatAttributeResolverError> {
        self.initiative_base_stat
            .checked_add(self.profile_initiative_modifier)
            .ok_or_else(|| {
                resolver_error(
                    CombatAttributeResolverErrorCode::ModifierOverflow,
                    "initiativeModifier",
                )
            })
    }

    #[must_use]
    pub const fn resolve_base_defense(&self) -> i64 {
        self.base_defense
    }

    pub fn resolve_proficiency(
        &self,
        proficiency_id: &str,
    ) -> Result<i64, CombatAttributeResolverError> {
        self.proficiencies
            .iter()
            .find(|value| value.proficiency_id == proficiency_id)
            .map(|value| value.value)
            .ok_or_else(|| {
                resolver_error(
                    CombatAttributeResolverErrorCode::UnknownProficiency,
                    proficiency_id,
                )
            })
    }
}

pub struct CombatAttributeResolver;

impl CombatAttributeResolver {
    pub fn resolve(
        versions: CombatVersionSet,
        source: V03CombatAttributeSource,
        profile: &CombatAttributeProfile,
    ) -> Result<ResolvedCombatAttributes, CombatAttributeResolverError> {
        versions.ensure_supported().map_err(|error| {
            resolver_error(
                CombatAttributeResolverErrorCode::UnsupportedVersion,
                error.field.wire_name(),
            )
        })?;
        if profile.world_profile_version != versions.world_profile_version
            || profile.world_profile_version != CURRENT_COMBAT_VERSIONS.world_profile_version
        {
            return Err(resolver_error(
                CombatAttributeResolverErrorCode::UnsupportedVersion,
                "worldProfileVersion",
            ));
        }
        if profile.base_defense < 0 {
            return Err(resolver_error(
                CombatAttributeResolverErrorCode::InvalidProfile,
                "baseDefense",
            ));
        }
        let source = match source {
            V03CombatAttributeSource::Player(source) => *source,
            V03CombatAttributeSource::NpcWithoutCombatProjection { npc_id } => {
                return Err(resolver_error(
                    CombatAttributeResolverErrorCode::UnsupportedNpcProjection,
                    &npc_id,
                ));
            }
        };
        validate_player_source(&source)?;

        let mut modifiers = source.legacy_attribute_modifiers.clone();
        modifiers.sort();
        validate_modifiers(&modifiers)?;
        let mut effective_attributes = source.rule_base_attributes;
        for modifier in &modifiers {
            effective_attributes.add_modifier(modifier.role, modifier.amount)?;
        }

        let proficiencies = resolve_proficiencies(
            &source.rule_skills,
            source
                .universal_projection
                .as_ref()
                .map_or(&[][..], |value| &value.textual_proficiencies),
            &profile.proficiency_definitions,
        )?;

        Ok(ResolvedCombatAttributes {
            player_character_id: source.player_character_id,
            source_revision: source.source_revision,
            universal_source_revision: source
                .universal_projection
                .as_ref()
                .map(|value| value.revision),
            attribute_mapping_version: versions.attribute_mapping_version,
            world_profile_id: profile.world_profile_id,
            world_profile_version: profile.world_profile_version,
            base_attributes: source.rule_base_attributes,
            effective_attributes,
            hit_points: source.hit_points,
            initiative_base_stat: effective_attributes.agility,
            profile_initiative_modifier: profile.initiative_modifier,
            base_defense: profile.base_defense,
            proficiencies,
            applied_legacy_modifiers: modifiers,
        })
    }
}

fn validate_player_source(
    source: &V03PlayerCombatSource,
) -> Result<(), CombatAttributeResolverError> {
    if !canonical_identifier(&source.player_character_id) {
        return Err(resolver_error(
            CombatAttributeResolverErrorCode::InvalidSourceIdentity,
            "playerCharacterId",
        ));
    }
    if source.rule_schema_version != V03_RULE_SCHEMA_VERSION {
        return Err(resolver_error(
            CombatAttributeResolverErrorCode::UnsupportedSourceSchema,
            "ruleSchemaVersion",
        ));
    }
    if source.source_revision == 0 {
        return Err(resolver_error(
            CombatAttributeResolverErrorCode::InvalidSourceRevision,
            "sourceRevision",
        ));
    }
    validate_base_attributes(source.rule_base_attributes, "ruleBaseAttributes")?;
    validate_base_attributes(source.player_attributes, "playerAttributes")?;
    if source.rule_base_attributes != source.player_attributes {
        return Err(resolver_error(
            CombatAttributeResolverErrorCode::ProjectionDrift,
            "playerAttributes",
        ));
    }
    if let Some(universal) = &source.universal_projection {
        if universal.schema_version != V03_UNIVERSAL_CHARACTER_SCHEMA_VERSION {
            return Err(resolver_error(
                CombatAttributeResolverErrorCode::UnsupportedSourceSchema,
                "universalCharacterSchemaVersion",
            ));
        }
        if universal.revision == 0 {
            return Err(resolver_error(
                CombatAttributeResolverErrorCode::InvalidSourceRevision,
                "universalCharacterRevision",
            ));
        }
        validate_base_attributes(universal.attributes, "universalAttributes")?;
        if source.rule_base_attributes != universal.attributes {
            return Err(resolver_error(
                CombatAttributeResolverErrorCode::ProjectionDrift,
                "universalAttributes",
            ));
        }
    }
    if source.hit_points.max < 1
        || source.hit_points.current < 0
        || source.hit_points.current > source.hit_points.max
    {
        return Err(resolver_error(
            CombatAttributeResolverErrorCode::InvalidHitPoints,
            "hitPoints",
        ));
    }
    validate_skills(&source.rule_skills)
}

fn validate_base_attributes(
    attributes: V03BaseAttributes,
    subject: &str,
) -> Result<(), CombatAttributeResolverError> {
    let values = [
        attributes.physique,
        attributes.agility,
        attributes.knowledge,
        attributes.charisma,
    ];
    if values
        .iter()
        .any(|value| !(V03_ATTRIBUTE_MIN..=V03_ATTRIBUTE_MAX).contains(value))
        || values.iter().sum::<i64>() != V03_ATTRIBUTE_TOTAL
    {
        return Err(resolver_error(
            CombatAttributeResolverErrorCode::InvalidAttributeAllocation,
            subject,
        ));
    }
    Ok(())
}

fn validate_modifiers(
    modifiers: &[LegacyAttributeModifier],
) -> Result<(), CombatAttributeResolverError> {
    let mut previous: Option<&LegacyAttributeModifier> = None;
    for modifier in modifiers {
        if !canonical_identifier(&modifier.source_id)
            || modifier.amount == 0
            || !(-V03_LEGACY_MODIFIER_LIMIT..=V03_LEGACY_MODIFIER_LIMIT).contains(&modifier.amount)
        {
            return Err(resolver_error(
                CombatAttributeResolverErrorCode::InvalidModifier,
                &modifier.source_id,
            ));
        }
        if previous.is_some_and(|value| {
            value.kind == modifier.kind
                && value.source_id == modifier.source_id
                && value.role == modifier.role
        }) {
            return Err(resolver_error(
                CombatAttributeResolverErrorCode::DuplicateModifier,
                &modifier.source_id,
            ));
        }
        previous = Some(modifier);
    }
    Ok(())
}

fn validate_skills(skills: &[V03RuleSkill]) -> Result<(), CombatAttributeResolverError> {
    let mut keys = BTreeSet::new();
    for skill in skills {
        let effective = skill
            .value
            .checked_add(skill.trait_modifier_total)
            .ok_or_else(|| {
                resolver_error(
                    CombatAttributeResolverErrorCode::ModifierOverflow,
                    &skill.key,
                )
            })?;
        if !canonical_identifier(&skill.key)
            || !(0..=V03_SKILL_MAX).contains(&skill.value)
            || !(0..=V03_SKILL_MAX).contains(&effective)
        {
            return Err(resolver_error(
                CombatAttributeResolverErrorCode::InvalidSkill,
                &skill.key,
            ));
        }
        if !keys.insert(&skill.key) {
            return Err(resolver_error(
                CombatAttributeResolverErrorCode::DuplicateSkill,
                &skill.key,
            ));
        }
    }
    Ok(())
}

fn resolve_proficiencies(
    skills: &[V03RuleSkill],
    textual_proficiencies: &[String],
    definitions: &[CombatProficiencyDefinition],
) -> Result<Vec<ResolvedProficiency>, CombatAttributeResolverError> {
    let mut definitions = definitions.to_vec();
    definitions.sort_by(|left, right| left.proficiency_id.cmp(&right.proficiency_id));
    let mut ids = BTreeSet::new();
    let mut numeric_keys = BTreeSet::new();
    let mut aliases = BTreeSet::new();
    let mut resolved = Vec::with_capacity(definitions.len());
    for definition in definitions {
        if !canonical_identifier(&definition.proficiency_id)
            || !canonical_identifier(&definition.numeric_skill_key)
            || !(0..=V03_SKILL_MAX).contains(&definition.textual_baseline)
            || !ids.insert(definition.proficiency_id.clone())
            || !numeric_keys.insert(definition.numeric_skill_key.clone())
        {
            return Err(resolver_error(
                CombatAttributeResolverErrorCode::InvalidProficiencyCatalog,
                &definition.proficiency_id,
            ));
        }
        for alias in &definition.textual_aliases {
            if !canonical_identifier(alias) || !aliases.insert(alias.clone()) {
                return Err(resolver_error(
                    CombatAttributeResolverErrorCode::InvalidProficiencyCatalog,
                    alias,
                ));
            }
        }
        let numeric = skills
            .iter()
            .find(|skill| skill.key == definition.numeric_skill_key)
            .map(|skill| skill.value + skill.trait_modifier_total);
        let value = numeric.unwrap_or_else(|| {
            if definition
                .textual_aliases
                .iter()
                .any(|alias| textual_proficiencies.iter().any(|value| value == alias))
            {
                definition.textual_baseline
            } else {
                0
            }
        });
        resolved.push(ResolvedProficiency {
            proficiency_id: definition.proficiency_id,
            value,
        });
    }
    Ok(resolved)
}

fn canonical_identifier(value: &str) -> bool {
    !value.is_empty() && value.trim() == value && value.len() <= 128
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CombatAttributeResolverErrorCode {
    UnsupportedVersion,
    UnsupportedSourceSchema,
    UnsupportedNpcProjection,
    InvalidSourceIdentity,
    InvalidSourceRevision,
    InvalidAttributeAllocation,
    ProjectionDrift,
    InvalidHitPoints,
    InvalidProfile,
    InvalidModifier,
    DuplicateModifier,
    ModifierOverflow,
    InvalidSkill,
    DuplicateSkill,
    InvalidProficiencyCatalog,
    UnknownProficiency,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CombatAttributeResolverError {
    pub code: CombatAttributeResolverErrorCode,
    pub subject: String,
}

impl fmt::Display for CombatAttributeResolverError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "combat attribute resolution failed for {}: {:?}",
            self.subject, self.code
        )
    }
}

impl Error for CombatAttributeResolverError {}

fn resolver_error(
    code: CombatAttributeResolverErrorCode,
    subject: &str,
) -> CombatAttributeResolverError {
    CombatAttributeResolverError {
        code,
        subject: subject.to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{CURRENT_COMBAT_VERSIONS, CombatRng};

    const SEED: &str = "0123456789abcdef0123456789abcdef";

    #[test]
    fn resolves_all_roles_saves_initiative_and_four_profiles_from_one_source() {
        let profiles = [
            WorldCombatProfileId::Fantasy,
            WorldCombatProfileId::SciFi,
            WorldCombatProfileId::Cultivation,
            WorldCombatProfileId::Urban,
        ];
        for profile_id in profiles {
            let resolved = resolve(player_source(), profile(profile_id)).unwrap();
            assert_eq!(
                [
                    resolved.resolve_attack_attribute(CombatAttributeRole::Body),
                    resolved.resolve_attack_attribute(CombatAttributeRole::Finesse),
                    resolved.resolve_attack_attribute(CombatAttributeRole::Intellect),
                    resolved.resolve_attack_attribute(CombatAttributeRole::Presence),
                ],
                [5, 3, 3, 2]
            );
            assert_eq!(
                resolved.resolve_defense_attribute(CombatAttributeRole::Finesse),
                3
            );
            assert_eq!(
                resolved.resolve_ability_dc_attribute(CombatAttributeRole::Intellect),
                3
            );
            assert_eq!(
                [
                    resolved.resolve_save_attribute(CombatSaveType::Fortitude),
                    resolved.resolve_save_attribute(CombatSaveType::Reflex),
                    resolved.resolve_save_attribute(CombatSaveType::Mental),
                ],
                [5, 3, 2]
            );
            assert_eq!(resolved.initiative_base_stat, 3);
            assert_eq!(resolved.resolve_initiative_modifier().unwrap(), 4);
            assert_eq!(resolved.resolve_base_defense(), 10);
            assert_eq!(resolved.resolve_proficiency("weapon.blades").unwrap(), 5);
        }
    }

    #[test]
    fn rejects_projection_drift_invalid_allocation_future_version_and_missing_npc_projection() {
        let mut drift = player_source();
        let V03CombatAttributeSource::Player(player) = &mut drift else {
            unreachable!();
        };
        player.player_attributes.agility = 3;
        player.player_attributes.knowledge = 2;
        assert_code(drift, CombatAttributeResolverErrorCode::ProjectionDrift);

        let mut invalid = player_source();
        let V03CombatAttributeSource::Player(player) = &mut invalid else {
            unreachable!();
        };
        player.rule_base_attributes.physique = 6;
        assert_code(
            invalid,
            CombatAttributeResolverErrorCode::InvalidAttributeAllocation,
        );

        let mut future_source_schema = player_source();
        let V03CombatAttributeSource::Player(player) = &mut future_source_schema else {
            unreachable!();
        };
        player.rule_schema_version = 2;
        assert_code(
            future_source_schema,
            CombatAttributeResolverErrorCode::UnsupportedSourceSchema,
        );

        let mut future: CombatVersionSet = serde_json::from_value(serde_json::json!({
            "combatSchemaVersion": 1,
            "rulesetVersion": 1,
            "balanceVersion": 1,
            "engineVersion": 1,
            "worldProfileVersion": 1,
            "attributeMappingVersion": 2,
            "rngContractVersion": 1
        }))
        .unwrap();
        assert_eq!(future.attribute_mapping_version.get(), 2);
        let error = CombatAttributeResolver::resolve(
            future,
            player_source(),
            &profile(WorldCombatProfileId::Fantasy),
        )
        .unwrap_err();
        assert_eq!(
            error.code,
            CombatAttributeResolverErrorCode::UnsupportedVersion
        );
        future = CURRENT_COMBAT_VERSIONS;
        assert_eq!(future.attribute_mapping_version.get(), 1);

        let error = CombatAttributeResolver::resolve(
            CURRENT_COMBAT_VERSIONS,
            V03CombatAttributeSource::NpcWithoutCombatProjection {
                npc_id: "npc-with-prose-only".to_owned(),
            },
            &profile(WorldCombatProfileId::Fantasy),
        )
        .unwrap_err();
        assert_eq!(
            error.code,
            CombatAttributeResolverErrorCode::UnsupportedNpcProjection
        );

        assert!(serde_json::from_str::<CombatAttributeRole>(r#""STRENGTH""#).is_err());
        assert!(serde_json::from_str::<CombatSaveType>(r#""WILLPOWER""#).is_err());
    }

    #[test]
    fn numeric_skill_wins_text_fallback_is_explicit_and_unknown_text_is_neutral() {
        let resolved = resolve(player_source(), profile(WorldCombatProfileId::Fantasy)).unwrap();
        assert_eq!(resolved.resolve_proficiency("weapon.blades").unwrap(), 5);
        assert_eq!(resolved.resolve_proficiency("arcane.lore").unwrap(), 2);

        let mut unknown_only = player_source();
        let V03CombatAttributeSource::Player(player) = &mut unknown_only else {
            unreachable!();
        };
        let universal = player.universal_projection.as_mut().unwrap();
        universal.textual_proficiencies = vec![
            "master of every weapon because the story says so".to_owned(),
            "unknown-proficiency".to_owned(),
        ];
        let resolved = resolve(unknown_only, profile(WorldCombatProfileId::Fantasy)).unwrap();
        assert_eq!(resolved.resolve_proficiency("weapon.blades").unwrap(), 5);
        assert_eq!(resolved.resolve_proficiency("arcane.lore").unwrap(), 0);
    }

    #[test]
    fn canonical_modifier_order_prevents_order_dependent_hashes_and_double_counting() {
        let mut reversed = player_source();
        let V03CombatAttributeSource::Player(player) = &mut reversed else {
            unreachable!();
        };
        player.legacy_attribute_modifiers.reverse();
        let first = resolve(player_source(), profile(WorldCombatProfileId::Fantasy)).unwrap();
        let second = resolve(reversed, profile(WorldCombatProfileId::Fantasy)).unwrap();
        assert_eq!(first, second);

        let mut duplicate = player_source();
        let V03CombatAttributeSource::Player(player) = &mut duplicate else {
            unreachable!();
        };
        player
            .legacy_attribute_modifiers
            .push(player.legacy_attribute_modifiers[0].clone());
        assert_code(
            duplicate,
            CombatAttributeResolverErrorCode::DuplicateModifier,
        );
    }

    #[test]
    fn resolution_is_deterministic_and_has_no_rng_access() {
        let rng = CombatRng::new(
            SEED,
            "combat-attribute-fixture",
            CURRENT_COMBAT_VERSIONS.rng_contract_version,
        )
        .unwrap();
        let before = rng.snapshot();
        let first = resolve(player_source(), profile(WorldCombatProfileId::Fantasy)).unwrap();
        let second = resolve(player_source(), profile(WorldCombatProfileId::Fantasy)).unwrap();
        assert_eq!(first, second);
        assert_eq!(rng.snapshot(), before);
    }

    fn resolve(
        source: V03CombatAttributeSource,
        profile: CombatAttributeProfile,
    ) -> Result<ResolvedCombatAttributes, CombatAttributeResolverError> {
        CombatAttributeResolver::resolve(CURRENT_COMBAT_VERSIONS, source, &profile)
    }

    fn assert_code(source: V03CombatAttributeSource, code: CombatAttributeResolverErrorCode) {
        let error = resolve(source, profile(WorldCombatProfileId::Fantasy)).unwrap_err();
        assert_eq!(error.code, code);
    }

    fn profile(profile_id: WorldCombatProfileId) -> CombatAttributeProfile {
        CombatAttributeProfile {
            world_profile_id: profile_id,
            world_profile_version: CURRENT_COMBAT_VERSIONS.world_profile_version,
            base_defense: 10,
            initiative_modifier: 1,
            proficiency_definitions: vec![
                CombatProficiencyDefinition {
                    proficiency_id: "weapon.blades".to_owned(),
                    numeric_skill_key: "combat.blades".to_owned(),
                    textual_aliases: vec!["Blade Training".to_owned()],
                    textual_baseline: 2,
                },
                CombatProficiencyDefinition {
                    proficiency_id: "arcane.lore".to_owned(),
                    numeric_skill_key: "combat.arcane".to_owned(),
                    textual_aliases: vec!["Arcane Scholar".to_owned()],
                    textual_baseline: 2,
                },
            ],
        }
    }

    fn player_source() -> V03CombatAttributeSource {
        let attributes = V03BaseAttributes {
            physique: 3,
            agility: 2,
            knowledge: 3,
            charisma: 2,
        };
        V03CombatAttributeSource::Player(Box::new(V03PlayerCombatSource {
            player_character_id: "character-v03-fixture".to_owned(),
            rule_schema_version: 1,
            source_revision: 7,
            rule_base_attributes: attributes,
            player_attributes: attributes,
            universal_projection: Some(V03UniversalAttributeProjection {
                schema_version: 1,
                revision: 3,
                attributes,
                textual_proficiencies: vec![
                    "Blade Training".to_owned(),
                    "Arcane Scholar".to_owned(),
                    "unmapped narrative mastery".to_owned(),
                ],
            }),
            hit_points: V03HitPoints {
                current: 8,
                max: 12,
            },
            rule_skills: vec![V03RuleSkill {
                key: "combat.blades".to_owned(),
                value: 4,
                trait_modifier_total: 1,
            }],
            legacy_attribute_modifiers: vec![
                LegacyAttributeModifier {
                    kind: LegacyAttributeModifierKind::Trait,
                    source_id: "trait-sturdy".to_owned(),
                    role: CombatAttributeRole::Body,
                    amount: 2,
                },
                LegacyAttributeModifier {
                    kind: LegacyAttributeModifierKind::Status,
                    source_id: "status-agile".to_owned(),
                    role: CombatAttributeRole::Finesse,
                    amount: 1,
                },
            ],
        }))
    }
}

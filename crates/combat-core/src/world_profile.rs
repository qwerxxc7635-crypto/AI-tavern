use std::{collections::BTreeMap, error::Error, fmt};

use serde::{Deserialize, Serialize};

use crate::{
    CURRENT_COMBAT_VERSIONS, CombatVersion, DamageChannelCatalog, DamageChannelId,
    DamageDefenseProfile, PrimaryMitigation, WorldCombatProfileId,
};

pub type WorldType = WorldCombatProfileId;

const BASE_WORLD_TYPES: [WorldType; 4] = [
    WorldType::Fantasy,
    WorldType::SciFi,
    WorldType::Cultivation,
    WorldType::Urban,
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum WorldRuleFacet {
    ResourceLifecycle,
    DefenseBehavior,
    RecoveryRules,
    SignatureMechanic,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeveloperRuleModule {
    pub module_id: String,
    pub module_version: CombatVersion,
    pub supported_world_types: Vec<WorldType>,
    pub facets: Vec<WorldRuleFacet>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResourceLifecycle {
    pub policy_id: String,
    pub resources: Vec<ResourceLifecycleRule>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ResourceStorage {
    HitPoints,
    Shield,
    ResourcePool,
    PressureResourcePool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum NormalOwnerTurnResourcePolicy {
    NoAutomaticChange,
    RestoreFromBalance,
    ReduceFromBalance,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResourceLifecycleRule {
    pub resource_id: String,
    pub storage: ResourceStorage,
    pub normal_owner_turn_start: NormalOwnerTurnResourcePolicy,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChannelMitigationRule {
    pub channel_id: DamageChannelId,
    pub primary_mitigation: PrimaryMitigation,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DefenseBehavior {
    pub policy_id: String,
    pub allowed_damage_channels: Vec<DamageChannelId>,
    pub primary_mitigation_by_channel: Vec<ChannelMitigationRule>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RecoveryRules {
    pub policy_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SignatureMechanic {
    pub mechanic_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorldCombatProfileDefinition {
    pub world_type: WorldType,
    pub world_profile_version: CombatVersion,
    pub resource_lifecycle: ResourceLifecycle,
    pub defense_behavior: DefenseBehavior,
    pub recovery_rules: RecoveryRules,
    pub signature_mechanic: SignatureMechanic,
    pub selected_rule_module_ids: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorldCombatProfile {
    world_type: WorldType,
    world_profile_version: CombatVersion,
    resource_lifecycle: ResourceLifecycle,
    defense_behavior: DefenseBehavior,
    recovery_rules: RecoveryRules,
    signature_mechanic: SignatureMechanic,
    rule_modules: Vec<DeveloperRuleModule>,
}

impl WorldCombatProfile {
    #[must_use]
    pub const fn world_type(&self) -> WorldType {
        self.world_type
    }

    #[must_use]
    pub const fn world_profile_version(&self) -> CombatVersion {
        self.world_profile_version
    }

    #[must_use]
    pub const fn resource_lifecycle(&self) -> &ResourceLifecycle {
        &self.resource_lifecycle
    }

    #[must_use]
    pub const fn defense_behavior(&self) -> &DefenseBehavior {
        &self.defense_behavior
    }

    #[must_use]
    pub const fn recovery_rules(&self) -> &RecoveryRules {
        &self.recovery_rules
    }

    #[must_use]
    pub const fn signature_mechanic(&self) -> &SignatureMechanic {
        &self.signature_mechanic
    }

    #[must_use]
    pub fn rule_modules(&self) -> &[DeveloperRuleModule] {
        &self.rule_modules
    }
}

impl DamageDefenseProfile for WorldCombatProfile {
    fn primary_mitigation_for(&self, channel_id: &DamageChannelId) -> Option<PrimaryMitigation> {
        self.defense_behavior
            .primary_mitigation_by_channel
            .binary_search_by(|rule| rule.channel_id.cmp(channel_id))
            .ok()
            .map(|index| {
                self.defense_behavior.primary_mitigation_by_channel[index].primary_mitigation
            })
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorldCombatProfileResolver {
    profiles: Vec<WorldCombatProfile>,
    by_world_type: BTreeMap<WorldType, usize>,
}

impl WorldCombatProfileResolver {
    /// Resolves the four frozen v0.4.1 base profiles through one complete registry.
    pub fn v0_4_1(channel_catalog: &DamageChannelCatalog) -> Result<Self, WorldProfileError> {
        let definitions = [
            crate::fantasy::definition(),
            crate::sci_fi::definition(),
            crate::cultivation::definition(crate::CultivationSubProfile::Base),
            crate::urban::definition(crate::UrbanSubProfile::Base),
        ];
        let modules = crate::cultivation::modules()
            .into_iter()
            .chain(crate::urban::modules());
        Self::from_developer_definitions(definitions, modules, channel_catalog)
    }

    /// Constructs one immutable, version-bound resolver from developer-owned data.
    ///
    /// There is deliberately no incremental registration API. AI and UI receive
    /// only the already resolved profile and cannot assemble rule modules.
    pub fn from_developer_definitions(
        definitions: impl IntoIterator<Item = WorldCombatProfileDefinition>,
        modules: impl IntoIterator<Item = DeveloperRuleModule>,
        channel_catalog: &DamageChannelCatalog,
    ) -> Result<Self, WorldProfileError> {
        let mut modules: Vec<_> = modules.into_iter().collect();
        for module in &mut modules {
            canonicalize_module(module);
            validate_module(module)?;
        }
        modules.sort_by(|left, right| left.module_id.cmp(&right.module_id));
        reject_duplicate_modules(&modules)?;

        let module_by_id: BTreeMap<_, _> = modules
            .iter()
            .map(|module| (module.module_id.as_str(), module))
            .collect();
        let mut definitions: Vec<_> = definitions.into_iter().collect();
        for definition in &mut definitions {
            canonicalize_definition(definition);
            validate_definition(definition, channel_catalog)?;
        }
        definitions.sort_by_key(|definition| definition.world_type);

        let mut profiles = Vec::with_capacity(definitions.len());
        let mut by_world_type = BTreeMap::new();
        for definition in definitions {
            if by_world_type.contains_key(&definition.world_type) {
                return Err(profile_error(
                    WorldProfileErrorCode::DuplicateWorldProfile,
                    world_subject(definition.world_type),
                ));
            }
            let profile = compose_definition(definition, &module_by_id)?;
            by_world_type.insert(profile.world_type, profiles.len());
            profiles.push(profile);
        }
        if by_world_type.len() != BASE_WORLD_TYPES.len()
            || BASE_WORLD_TYPES
                .iter()
                .any(|world_type| !by_world_type.contains_key(world_type))
        {
            return Err(profile_error(
                WorldProfileErrorCode::MissingBaseWorldProfile,
                "worldProfiles",
            ));
        }
        Ok(Self {
            profiles,
            by_world_type,
        })
    }

    #[must_use]
    pub fn resolve(&self, world_type: WorldType) -> &WorldCombatProfile {
        &self.profiles[self.by_world_type[&world_type]]
    }

    #[must_use]
    pub fn profiles(&self) -> &[WorldCombatProfile] {
        &self.profiles
    }
}

fn compose_definition(
    definition: WorldCombatProfileDefinition,
    module_by_id: &BTreeMap<&str, &DeveloperRuleModule>,
) -> Result<WorldCombatProfile, WorldProfileError> {
    let mut selected_modules = Vec::with_capacity(definition.selected_rule_module_ids.len());
    for module_id in &definition.selected_rule_module_ids {
        let module = module_by_id
            .get(module_id.as_str())
            .ok_or_else(|| profile_error(WorldProfileErrorCode::UnknownRuleModule, module_id))?;
        if !module
            .supported_world_types
            .contains(&definition.world_type)
        {
            return Err(profile_error(
                WorldProfileErrorCode::IncompatibleRuleModule,
                module_id,
            ));
        }
        selected_modules.push((*module).clone());
    }
    Ok(WorldCombatProfile {
        world_type: definition.world_type,
        world_profile_version: definition.world_profile_version,
        resource_lifecycle: definition.resource_lifecycle,
        defense_behavior: definition.defense_behavior,
        recovery_rules: definition.recovery_rules,
        signature_mechanic: definition.signature_mechanic,
        rule_modules: selected_modules,
    })
}

pub(crate) fn resolve_single_definition(
    mut definition: WorldCombatProfileDefinition,
    modules: &[DeveloperRuleModule],
    channel_catalog: &DamageChannelCatalog,
) -> Result<WorldCombatProfile, WorldProfileError> {
    let mut modules = modules.to_vec();
    for module in &mut modules {
        canonicalize_module(module);
        validate_module(module)?;
    }
    modules.sort_by(|left, right| left.module_id.cmp(&right.module_id));
    reject_duplicate_modules(&modules)?;
    canonicalize_definition(&mut definition);
    validate_definition(&definition, channel_catalog)?;
    let by_id = modules
        .iter()
        .map(|module| (module.module_id.as_str(), module))
        .collect();
    compose_definition(definition, &by_id)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WorldProfileErrorCode {
    UnsupportedVersion,
    InvalidStableId,
    EmptyResourceLifecycle,
    DuplicateResource,
    EmptyDefenseBehavior,
    UnknownDamageChannel,
    DuplicateDamageChannel,
    MissingPrimaryMitigation,
    UnsupportedMitigationMapping,
    InvalidRuleModule,
    DuplicateRuleModule,
    UnknownRuleModule,
    IncompatibleRuleModule,
    DuplicateWorldProfile,
    MissingBaseWorldProfile,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorldProfileError {
    pub code: WorldProfileErrorCode,
    pub subject_id: String,
}

impl fmt::Display for WorldProfileError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "world combat profile failed for {}: {:?}",
            self.subject_id, self.code
        )
    }
}

impl Error for WorldProfileError {}

fn canonicalize_module(module: &mut DeveloperRuleModule) {
    module.supported_world_types.sort();
    module.facets.sort();
}

fn validate_module(module: &DeveloperRuleModule) -> Result<(), WorldProfileError> {
    if !valid_stable_id(&module.module_id)
        || module.module_version != CURRENT_COMBAT_VERSIONS.world_profile_version
        || module.supported_world_types.is_empty()
        || module.facets.is_empty()
        || has_adjacent_duplicate(&module.supported_world_types)
        || has_adjacent_duplicate(&module.facets)
    {
        return Err(profile_error(
            WorldProfileErrorCode::InvalidRuleModule,
            &module.module_id,
        ));
    }
    Ok(())
}

fn reject_duplicate_modules(modules: &[DeveloperRuleModule]) -> Result<(), WorldProfileError> {
    if let Some(pair) = modules
        .windows(2)
        .find(|pair| pair[0].module_id == pair[1].module_id)
    {
        return Err(profile_error(
            WorldProfileErrorCode::DuplicateRuleModule,
            &pair[0].module_id,
        ));
    }
    Ok(())
}

fn canonicalize_definition(definition: &mut WorldCombatProfileDefinition) {
    definition
        .resource_lifecycle
        .resources
        .sort_by(|left, right| left.resource_id.cmp(&right.resource_id));
    definition.defense_behavior.allowed_damage_channels.sort();
    definition
        .defense_behavior
        .primary_mitigation_by_channel
        .sort_by(|left, right| left.channel_id.cmp(&right.channel_id));
    definition.selected_rule_module_ids.sort();
}

fn validate_definition(
    definition: &WorldCombatProfileDefinition,
    channel_catalog: &DamageChannelCatalog,
) -> Result<(), WorldProfileError> {
    if definition.world_profile_version != CURRENT_COMBAT_VERSIONS.world_profile_version {
        return Err(profile_error(
            WorldProfileErrorCode::UnsupportedVersion,
            world_subject(definition.world_type),
        ));
    }
    for id in [
        definition.resource_lifecycle.policy_id.as_str(),
        definition.defense_behavior.policy_id.as_str(),
        definition.recovery_rules.policy_id.as_str(),
        definition.signature_mechanic.mechanic_id.as_str(),
    ] {
        if !valid_stable_id(id) {
            return Err(profile_error(WorldProfileErrorCode::InvalidStableId, id));
        }
    }
    if definition.resource_lifecycle.resources.is_empty() {
        return Err(profile_error(
            WorldProfileErrorCode::EmptyResourceLifecycle,
            world_subject(definition.world_type),
        ));
    }
    for rule in &definition.resource_lifecycle.resources {
        if !valid_stable_id(&rule.resource_id) {
            return Err(profile_error(
                WorldProfileErrorCode::InvalidStableId,
                &rule.resource_id,
            ));
        }
    }
    if let Some(pair) = definition
        .resource_lifecycle
        .resources
        .windows(2)
        .find(|pair| pair[0].resource_id == pair[1].resource_id)
    {
        return Err(profile_error(
            WorldProfileErrorCode::DuplicateResource,
            &pair[0].resource_id,
        ));
    }
    for storage in [ResourceStorage::HitPoints, ResourceStorage::Shield] {
        if definition
            .resource_lifecycle
            .resources
            .iter()
            .filter(|rule| rule.storage == storage)
            .count()
            > 1
        {
            return Err(profile_error(
                WorldProfileErrorCode::DuplicateResource,
                world_subject(definition.world_type),
            ));
        }
    }

    let defense = &definition.defense_behavior;
    if defense.allowed_damage_channels.is_empty() {
        return Err(profile_error(
            WorldProfileErrorCode::EmptyDefenseBehavior,
            world_subject(definition.world_type),
        ));
    }
    for channel_id in &defense.allowed_damage_channels {
        if !channel_catalog.contains(channel_id) {
            return Err(profile_error(
                WorldProfileErrorCode::UnknownDamageChannel,
                channel_id.as_str(),
            ));
        }
    }
    if let Some(duplicate) = adjacent_duplicate(&defense.allowed_damage_channels) {
        return Err(profile_error(
            WorldProfileErrorCode::DuplicateDamageChannel,
            duplicate.as_str(),
        ));
    }
    if let Some(pair) = defense
        .primary_mitigation_by_channel
        .windows(2)
        .find(|pair| pair[0].channel_id == pair[1].channel_id)
    {
        return Err(profile_error(
            WorldProfileErrorCode::DuplicateDamageChannel,
            pair[0].channel_id.as_str(),
        ));
    }
    if let Some(rule) = defense
        .primary_mitigation_by_channel
        .iter()
        .find(|rule| !defense.allowed_damage_channels.contains(&rule.channel_id))
    {
        return Err(profile_error(
            WorldProfileErrorCode::UnsupportedMitigationMapping,
            rule.channel_id.as_str(),
        ));
    }
    if defense.primary_mitigation_by_channel.len() != defense.allowed_damage_channels.len()
        || defense.allowed_damage_channels.iter().any(|channel_id| {
            defense
                .primary_mitigation_by_channel
                .binary_search_by(|rule| rule.channel_id.cmp(channel_id))
                .is_err()
        })
    {
        return Err(profile_error(
            WorldProfileErrorCode::MissingPrimaryMitigation,
            world_subject(definition.world_type),
        ));
    }
    for module_id in &definition.selected_rule_module_ids {
        if !valid_stable_id(module_id) {
            return Err(profile_error(
                WorldProfileErrorCode::InvalidStableId,
                module_id,
            ));
        }
    }
    if let Some(duplicate) = adjacent_duplicate(&definition.selected_rule_module_ids) {
        return Err(profile_error(
            WorldProfileErrorCode::DuplicateRuleModule,
            duplicate,
        ));
    }
    Ok(())
}

fn adjacent_duplicate<T: PartialEq>(values: &[T]) -> Option<&T> {
    values
        .windows(2)
        .find(|pair| pair[0] == pair[1])
        .map(|pair| &pair[0])
}

fn has_adjacent_duplicate<T: PartialEq>(values: &[T]) -> bool {
    adjacent_duplicate(values).is_some()
}

fn valid_stable_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b':' | b'-'))
}

const fn world_subject(world_type: WorldType) -> &'static str {
    match world_type {
        WorldType::Fantasy => "FANTASY",
        WorldType::SciFi => "SCI_FI",
        WorldType::Cultivation => "CULTIVATION",
        WorldType::Urban => "URBAN",
    }
}

fn profile_error(code: WorldProfileErrorCode, subject_id: impl Into<String>) -> WorldProfileError {
    WorldProfileError {
        code,
        subject_id: subject_id.into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_all_world_types_from_one_canonical_composition_path() {
        let resolver = resolver(vec![], definitions(vec![])).unwrap();
        assert_eq!(
            resolver
                .profiles()
                .iter()
                .map(|profile| profile.world_type)
                .collect::<Vec<_>>(),
            BASE_WORLD_TYPES
        );
        for world_type in BASE_WORLD_TYPES {
            let profile = resolver.resolve(world_type);
            assert_eq!(profile.world_type, world_type);
            assert_eq!(
                profile.world_profile_version,
                CURRENT_COMBAT_VERSIONS.world_profile_version
            );
        }
    }

    #[test]
    fn profile_is_the_only_owner_of_allowed_channels_and_primary_mitigation() {
        let resolver = resolver(vec![], definitions(vec![])).unwrap();
        let fantasy = resolver.resolve(WorldType::Fantasy);
        let physical = channel("physical");
        let fire = channel("fire");
        let qi = channel("qi");
        assert_eq!(
            fantasy.primary_mitigation_for(&physical),
            Some(PrimaryMitigation::Armor)
        );
        assert_eq!(
            fantasy.primary_mitigation_for(&fire),
            Some(PrimaryMitigation::Resistance)
        );
        assert_eq!(fantasy.primary_mitigation_for(&qi), None);
    }

    #[test]
    fn input_order_does_not_change_resolved_profiles_or_serialization() {
        let modules = vec![module("module-b"), module("module-a")];
        let first = resolver(modules.clone(), definitions(vec!["module-b", "module-a"])).unwrap();
        let mut reversed_definitions = definitions(vec!["module-a", "module-b"]);
        reversed_definitions.reverse();
        let mut reversed_modules = modules;
        reversed_modules.reverse();
        let second = resolver(reversed_modules, reversed_definitions).unwrap();
        assert_eq!(first, second);
        assert_eq!(
            serde_json::to_vec(first.profiles()).unwrap(),
            serde_json::to_vec(second.profiles()).unwrap()
        );
        assert_eq!(
            first.resolve(WorldType::Fantasy).rule_modules[0].module_id,
            "module-a"
        );
    }

    #[test]
    fn rejects_missing_duplicate_unknown_and_incompatible_modules() {
        let mut missing = definitions(vec![]);
        missing.pop();
        assert_eq!(
            resolver(vec![], missing).unwrap_err().code,
            WorldProfileErrorCode::MissingBaseWorldProfile
        );

        let mut duplicate = definitions(vec![]);
        duplicate[1].world_type = WorldType::Fantasy;
        assert_eq!(
            resolver(vec![], duplicate).unwrap_err().code,
            WorldProfileErrorCode::DuplicateWorldProfile
        );

        assert_eq!(
            resolver(vec![], definitions(vec!["missing-module"]))
                .unwrap_err()
                .code,
            WorldProfileErrorCode::UnknownRuleModule
        );

        let mut incompatible = module("urban-only");
        incompatible.supported_world_types = vec![WorldType::Urban];
        assert_eq!(
            resolver(vec![incompatible], definitions(vec!["urban-only"]))
                .unwrap_err()
                .code,
            WorldProfileErrorCode::IncompatibleRuleModule
        );
    }

    #[test]
    fn rejects_incomplete_or_duplicate_channel_ownership() {
        let mut missing = definitions(vec![]);
        missing[0]
            .defense_behavior
            .primary_mitigation_by_channel
            .pop();
        assert_eq!(
            resolver(vec![], missing).unwrap_err().code,
            WorldProfileErrorCode::MissingPrimaryMitigation
        );

        let mut unsupported = definitions(vec![]);
        unsupported[0]
            .defense_behavior
            .primary_mitigation_by_channel
            .push(ChannelMitigationRule {
                channel_id: channel("qi"),
                primary_mitigation: PrimaryMitigation::Resistance,
            });
        assert_eq!(
            resolver(vec![], unsupported).unwrap_err().code,
            WorldProfileErrorCode::UnsupportedMitigationMapping
        );

        let mut duplicate = definitions(vec![]);
        duplicate[0]
            .defense_behavior
            .allowed_damage_channels
            .push(channel("physical"));
        assert_eq!(
            resolver(vec![], duplicate).unwrap_err().code,
            WorldProfileErrorCode::DuplicateDamageChannel
        );
    }

    #[test]
    fn profile_wire_shape_cannot_contain_theme_or_runtime_code() {
        let resolver = resolver(vec![], definitions(vec![])).unwrap();
        let profile = resolver.resolve(WorldType::Fantasy);
        let encoded = serde_json::to_value(profile).unwrap();
        assert!(encoded.get("themeId").is_none());
        assert!(encoded.get("runtimeCode").is_none());

        let mut definition = serde_json::to_value(&definitions(vec![])[0]).unwrap();
        let value = definition.clone();
        let decoded: WorldCombatProfileDefinition = serde_json::from_value(value).unwrap();
        assert_eq!(decoded, definitions(vec![])[0]);

        let object = definition.as_object_mut().unwrap();
        object.insert("themeId".into(), serde_json::json!("theme-fantasy"));
        assert!(serde_json::from_value::<WorldCombatProfileDefinition>(definition).is_err());

        let mut value = serde_json::to_value(&definitions(vec![])[0]).unwrap();
        let object = value.as_object_mut().unwrap();
        object.insert("runtimeCode".into(), serde_json::json!("execute()"));
        assert!(serde_json::from_value::<WorldCombatProfileDefinition>(value).is_err());
    }

    fn resolver(
        modules: Vec<DeveloperRuleModule>,
        definitions: Vec<WorldCombatProfileDefinition>,
    ) -> Result<WorldCombatProfileResolver, WorldProfileError> {
        WorldCombatProfileResolver::from_developer_definitions(
            definitions,
            modules,
            &DamageChannelCatalog::v0_4_1(),
        )
    }

    fn definitions(fantasy_modules: Vec<&str>) -> Vec<WorldCombatProfileDefinition> {
        BASE_WORLD_TYPES
            .into_iter()
            .map(|world_type| {
                let (channels, mappings) = match world_type {
                    WorldType::Fantasy => (
                        vec!["physical", "fire"],
                        vec![PrimaryMitigation::Armor, PrimaryMitigation::Resistance],
                    ),
                    WorldType::SciFi => (
                        vec!["kinetic", "thermal"],
                        vec![PrimaryMitigation::Armor, PrimaryMitigation::Resistance],
                    ),
                    WorldType::Cultivation => (
                        vec!["physical", "qi"],
                        vec![PrimaryMitigation::Armor, PrimaryMitigation::Resistance],
                    ),
                    WorldType::Urban => (
                        vec!["physical", "ballistic"],
                        vec![PrimaryMitigation::Armor, PrimaryMitigation::Armor],
                    ),
                };
                WorldCombatProfileDefinition {
                    world_type,
                    world_profile_version: CURRENT_COMBAT_VERSIONS.world_profile_version,
                    resource_lifecycle: ResourceLifecycle {
                        policy_id: format!("{}.resource", world_subject(world_type).to_lowercase()),
                        resources: ["health", "resource"]
                            .into_iter()
                            .map(|resource_id| ResourceLifecycleRule {
                                resource_id: resource_id.into(),
                                storage: if resource_id == "health" {
                                    ResourceStorage::HitPoints
                                } else {
                                    ResourceStorage::ResourcePool
                                },
                                normal_owner_turn_start:
                                    NormalOwnerTurnResourcePolicy::NoAutomaticChange,
                            })
                            .collect(),
                    },
                    defense_behavior: DefenseBehavior {
                        policy_id: format!("{}.defense", world_subject(world_type).to_lowercase()),
                        allowed_damage_channels: channels.iter().map(|id| channel(id)).collect(),
                        primary_mitigation_by_channel: channels
                            .into_iter()
                            .zip(mappings)
                            .map(|(id, primary_mitigation)| ChannelMitigationRule {
                                channel_id: channel(id),
                                primary_mitigation,
                            })
                            .collect(),
                    },
                    recovery_rules: RecoveryRules {
                        policy_id: format!("{}.recovery", world_subject(world_type).to_lowercase()),
                    },
                    signature_mechanic: SignatureMechanic {
                        mechanic_id: format!(
                            "{}.signature",
                            world_subject(world_type).to_lowercase()
                        ),
                    },
                    selected_rule_module_ids: if world_type == WorldType::Fantasy {
                        fantasy_modules.iter().map(|id| (*id).to_owned()).collect()
                    } else {
                        vec![]
                    },
                }
            })
            .collect()
    }

    fn module(module_id: &str) -> DeveloperRuleModule {
        DeveloperRuleModule {
            module_id: module_id.into(),
            module_version: CURRENT_COMBAT_VERSIONS.world_profile_version,
            supported_world_types: vec![WorldType::Fantasy],
            facets: vec![WorldRuleFacet::SignatureMechanic],
        }
    }

    fn channel(id: &str) -> DamageChannelId {
        DamageChannelId::new(id).unwrap()
    }
}

use std::{collections::BTreeMap, error::Error, fmt};

use ember_combat_core::{
    AbilityCriticalPolicy, BuildAbilityDefinition, EffectPrimitiveId, GameplayTagId,
    MechanicalTarget, ResolutionType, ResourceCostOperation, WorldCombatProfile,
};
use serde::{Deserialize, Serialize};

mod view_model;

pub use view_model::{
    COMBAT_VIEW_MODEL_SCHEMA_VERSION, CombatActionRuleProjection, CombatActionViewKind,
    CombatActionViewModel, CombatMeterViewModel, CombatResourceViewModel,
    CombatRulesPresentationSnapshot, CombatStatusViewModel, CombatViewModel, CombatViewModelError,
    CombatViewModelErrorCode, CombatViewModelProjector, CombatViewModelRequest,
    CombatantPresentationEntry, CombatantViewModel, EnemyIntentViewModel, StatusPresentationEntry,
    TimelineEntryViewModel,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum TooltipLineKind {
    ActionPoint,
    Resource,
    Resolution,
    Damage,
    Healing,
    Shield,
    Critical,
    Save,
    Status,
    Cooldown,
    Target,
    Effect,
    Tag,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MechanicalTooltipLine {
    kind: TooltipLineKind,
    source_ids: Vec<String>,
    text: String,
}

impl MechanicalTooltipLine {
    #[must_use]
    pub const fn kind(&self) -> TooltipLineKind {
        self.kind
    }

    #[must_use]
    pub fn source_ids(&self) -> &[String] {
        &self.source_ids
    }

    #[must_use]
    pub fn text(&self) -> &str {
        &self.text
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MechanicalTooltip {
    ability_id: String,
    lines: Vec<MechanicalTooltipLine>,
}

impl MechanicalTooltip {
    #[must_use]
    pub fn ability_id(&self) -> &str {
        &self.ability_id
    }

    #[must_use]
    pub fn lines(&self) -> &[MechanicalTooltipLine] {
        &self.lines
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AiCombatFlavor {
    pub display_name: String,
    pub flavor_description: String,
    pub lore: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AbilityTooltip {
    flavor: AiCombatFlavor,
    mechanics: MechanicalTooltip,
}

impl AbilityTooltip {
    #[must_use]
    pub const fn flavor(&self) -> &AiCombatFlavor {
        &self.flavor
    }

    #[must_use]
    pub const fn mechanics(&self) -> &MechanicalTooltip {
        &self.mechanics
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LocalizedStableId {
    pub stable_id: String,
    pub simplified_chinese_name: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CombatPresentationCatalog {
    resources: BTreeMap<String, String>,
    damage_channels: BTreeMap<String, String>,
    primitives: BTreeMap<EffectPrimitiveId, String>,
    tags: BTreeMap<GameplayTagId, String>,
}

impl CombatPresentationCatalog {
    pub fn new(
        resources: impl IntoIterator<Item = LocalizedStableId>,
        damage_channels: impl IntoIterator<Item = LocalizedStableId>,
        primitives: impl IntoIterator<Item = (EffectPrimitiveId, String)>,
        tags: impl IntoIterator<Item = (GameplayTagId, String)>,
    ) -> Result<Self, TooltipProjectionError> {
        let resources = localized_map(resources, "resource")?;
        let damage_channels = localized_map(damage_channels, "damageChannel")?;
        let primitives = enum_localized_map(primitives, "primitive")?;
        let tags = enum_localized_map(tags, "tag")?;
        if resources.is_empty()
            || damage_channels.is_empty()
            || primitives.len() != EffectPrimitiveId::ALL.len()
            || tags.is_empty()
        {
            return Err(projection_error(
                TooltipProjectionErrorCode::IncompleteCatalog,
                "catalog",
            ));
        }
        Ok(Self {
            resources,
            damage_channels,
            primitives,
            tags,
        })
    }

    #[must_use]
    pub fn v0_4_1() -> Self {
        let resources = [
            localized("hp", "生命"),
            localized("health", "生命"),
            localized("mana", "法力"),
            localized("stamina", "体力"),
            localized("shield", "护盾"),
            localized("energy", "能量"),
            localized("heat", "热量"),
            localized("qi", "灵力"),
            localized("spirit_sense", "神识"),
            localized("focus", "专注"),
        ];
        let channels = [
            localized("arcane", "奥术"),
            localized("ballistic", "弹道"),
            localized("electromagnetic", "电磁"),
            localized("fire", "火焰"),
            localized("ice", "寒冰"),
            localized("kinetic", "动能"),
            localized("lightning", "雷电"),
            localized("occult", "秘术"),
            localized("physical", "物理"),
            localized("plasma", "等离子"),
            localized("psychic", "心灵"),
            localized("qi", "灵力"),
            localized("radiation", "辐射"),
            localized("soul", "神魂"),
            localized("thermal", "热能"),
        ];
        let primitives = [
            (EffectPrimitiveId::DealDamage, "造成伤害"),
            (EffectPrimitiveId::Heal, "治疗"),
            (EffectPrimitiveId::Revive, "复苏"),
            (EffectPrimitiveId::ApplyStatus, "施加状态"),
            (EffectPrimitiveId::RemoveStatus, "移除状态"),
            (EffectPrimitiveId::ModifyStat, "调整属性"),
            (EffectPrimitiveId::GainResource, "获得资源"),
            (EffectPrimitiveId::LoseResource, "失去资源"),
            (EffectPrimitiveId::GainAp, "获得行动点"),
            (EffectPrimitiveId::LoseAp, "失去行动点"),
            (EffectPrimitiveId::ModifyAp, "调整行动点"),
            (EffectPrimitiveId::GainReactionCharge, "获得反应次数"),
            (EffectPrimitiveId::ConsumeReactionCharge, "消耗反应次数"),
            (EffectPrimitiveId::Shield, "获得护盾"),
            (EffectPrimitiveId::Cleanse, "净化"),
            (EffectPrimitiveId::Dispel, "驱散"),
            (EffectPrimitiveId::ModifyCooldown, "调整冷却"),
            (EffectPrimitiveId::ApplyTag, "添加标签"),
            (EffectPrimitiveId::RemoveTag, "移除标签"),
        ]
        .map(|(id, name)| (id, name.to_owned()));
        let tags = [
            ("Ability.Attack", "攻击"),
            ("Ability.Control", "控制"),
            ("Ability.Defensive", "防御"),
            ("Ability.Heal", "治疗"),
            ("Ability.Spell", "法术"),
            ("Character.Human", "人类"),
            ("Character.Mechanical", "机械体"),
            ("Character.Undead", "亡灵"),
            ("Damage.Physical", "物理伤害"),
            ("Damage.Soul", "神魂伤害"),
            ("Element.Fire", "火焰"),
            ("Element.Lightning", "雷电"),
            ("Status.Burning", "燃烧"),
            ("Status.Poisoned", "中毒"),
            ("Status.Stunned", "眩晕"),
        ]
        .map(|(id, name)| {
            (
                GameplayTagId::new(id).expect("built-in tag ID is valid"),
                name.to_owned(),
            )
        });
        Self::new(resources, channels, primitives, tags)
            .expect("built-in combat presentation catalog is valid")
    }
}

pub struct MechanicalTooltipProjector<'a> {
    catalog: &'a CombatPresentationCatalog,
}

impl<'a> MechanicalTooltipProjector<'a> {
    #[must_use]
    pub const fn new(catalog: &'a CombatPresentationCatalog) -> Self {
        Self { catalog }
    }

    pub fn project(
        &self,
        approved_definition: &BuildAbilityDefinition,
        profile: &WorldCombatProfile,
    ) -> Result<MechanicalTooltip, TooltipProjectionError> {
        let candidate = &approved_definition.candidate;
        if candidate.mechanics.world_type != profile.world_type()
            || candidate.mechanics.world_profile_version != profile.world_profile_version()
        {
            return Err(projection_error(
                TooltipProjectionErrorCode::DefinitionProfileMismatch,
                &approved_definition.ability_id,
            ));
        }

        let mut lines = vec![line(
            TooltipLineKind::ActionPoint,
            vec![],
            format!("行动点：{}", candidate.numbers.action_point_cost),
        )];
        if let Some(cost) = &candidate.numbers.resource_cost {
            let name = self.resource_name(&cost.resource_id)?;
            let operation = match cost.operation {
                ResourceCostOperation::Spend => "消耗",
                ResourceCostOperation::GainPressure => "增加",
            };
            lines.push(line(
                TooltipLineKind::Resource,
                vec![cost.resource_id.clone()],
                format!("{operation}{name}：{}", cost.amount),
            ));
        }

        lines.push(line(
            TooltipLineKind::Resolution,
            vec![resolution_source_id(candidate.mechanics.resolution_type)],
            format!(
                "判定：{}",
                resolution_name(candidate.mechanics.resolution_type)
            ),
        ));
        if let Some(amount) = candidate.numbers.damage_amount {
            let names = candidate
                .mechanics
                .damage_channels
                .iter()
                .map(|id| {
                    self.catalog
                        .damage_channels
                        .get(id.as_str())
                        .cloned()
                        .ok_or_else(|| {
                            projection_error(
                                TooltipProjectionErrorCode::UnknownPresentationId,
                                id.as_str(),
                            )
                        })
                })
                .collect::<Result<Vec<_>, _>>()?;
            lines.push(line(
                TooltipLineKind::Damage,
                candidate
                    .mechanics
                    .damage_channels
                    .iter()
                    .map(ToString::to_string)
                    .collect(),
                format!("伤害：{}（{amount}）", names.join("、")),
            ));
        }
        if let Some(amount) = candidate.numbers.healing_amount {
            lines.push(line(
                TooltipLineKind::Healing,
                vec![primitive_source_id(EffectPrimitiveId::Heal)],
                format!("治疗：{amount}"),
            ));
        }
        if let Some(amount) = candidate.numbers.shield_amount {
            lines.push(line(
                TooltipLineKind::Shield,
                vec![primitive_source_id(EffectPrimitiveId::Shield)],
                format!("护盾：{amount}"),
            ));
        }

        lines.push(line(
            TooltipLineKind::Critical,
            vec![resolution_source_id(candidate.mechanics.resolution_type)],
            critical_text(
                candidate.mechanics.resolution_type,
                approved_definition.critical_policy,
            )?,
        ));
        if let Some(dc) = candidate.numbers.difficulty_class {
            lines.push(line(
                TooltipLineKind::Save,
                vec![resolution_source_id(candidate.mechanics.resolution_type)],
                format!("难度等级：{dc}"),
            ));
        }
        if let (Some(chance), Some(duration)) = (
            candidate.numbers.status_probability_basis_points,
            candidate.numbers.status_duration_owner_turns,
        ) {
            lines.push(line(
                TooltipLineKind::Status,
                vec![primitive_source_id(EffectPrimitiveId::ApplyStatus)],
                format!(
                    "状态：{}%，持续 {duration} 个自身普通回合",
                    format_basis_points(chance)
                ),
            ));
        }
        lines.push(line(
            TooltipLineKind::Cooldown,
            vec![],
            if candidate.numbers.cooldown_owner_turns == 0 {
                "冷却：无".to_owned()
            } else {
                format!(
                    "冷却：{} 个自身普通回合",
                    candidate.numbers.cooldown_owner_turns
                )
            },
        ));
        lines.push(line(
            TooltipLineKind::Target,
            vec![target_source_id(candidate.mechanics.target)],
            format!("目标：{}", target_name(candidate.mechanics.target)),
        ));

        for primitive in &candidate.mechanics.primitives {
            let name = self.catalog.primitives.get(primitive).ok_or_else(|| {
                projection_error(
                    TooltipProjectionErrorCode::UnknownPresentationId,
                    primitive_source_id(*primitive),
                )
            })?;
            lines.push(line(
                TooltipLineKind::Effect,
                vec![primitive_source_id(*primitive)],
                format!("效果：{name}"),
            ));
        }
        for tag in &candidate.mechanics.tags {
            let name = self.catalog.tags.get(tag).ok_or_else(|| {
                projection_error(
                    TooltipProjectionErrorCode::UnknownPresentationId,
                    tag.as_str(),
                )
            })?;
            lines.push(line(
                TooltipLineKind::Tag,
                vec![tag.as_str().to_owned()],
                format!("标签：{name}"),
            ));
        }

        Ok(MechanicalTooltip {
            ability_id: approved_definition.ability_id.clone(),
            lines,
        })
    }

    pub fn compose(
        &self,
        approved_definition: &BuildAbilityDefinition,
        profile: &WorldCombatProfile,
        flavor: AiCombatFlavor,
    ) -> Result<AbilityTooltip, TooltipProjectionError> {
        validate_ai_flavor(&flavor, approved_definition)?;
        Ok(AbilityTooltip {
            flavor,
            mechanics: self.project(approved_definition, profile)?,
        })
    }

    fn resource_name(&self, resource_id: &str) -> Result<&str, TooltipProjectionError> {
        self.catalog
            .resources
            .get(resource_id)
            .map(String::as_str)
            .ok_or_else(|| {
                projection_error(
                    TooltipProjectionErrorCode::UnknownPresentationId,
                    resource_id,
                )
            })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TooltipProjectionErrorCode {
    InvalidCatalogEntry,
    DuplicateCatalogEntry,
    IncompleteCatalog,
    UnknownPresentationId,
    DefinitionProfileMismatch,
    InvalidCriticalPolicy,
    InvalidFlavorText,
    NonChineseFlavorText,
    MechanicalClaimInFlavor,
    FlavorContradictsMechanics,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TooltipProjectionError {
    pub code: TooltipProjectionErrorCode,
    pub subject: String,
}

impl fmt::Display for TooltipProjectionError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "combat tooltip projection failed for {}: {:?}",
            self.subject, self.code
        )
    }
}

impl Error for TooltipProjectionError {}

fn validate_ai_flavor(
    flavor: &AiCombatFlavor,
    approved_definition: &BuildAbilityDefinition,
) -> Result<(), TooltipProjectionError> {
    for (field, value, maximum) in [
        ("displayName", flavor.display_name.as_str(), 80_usize),
        ("flavorDescription", flavor.flavor_description.as_str(), 600),
        ("lore", flavor.lore.as_str(), 1_200),
    ] {
        if value.trim() != value
            || value.is_empty()
            || value.chars().count() > maximum
            || value.chars().any(char::is_control)
        {
            return Err(projection_error(
                TooltipProjectionErrorCode::InvalidFlavorText,
                field,
            ));
        }
        if !value.chars().any(is_cjk)
            || value
                .chars()
                .any(|character| character.is_ascii_alphabetic())
        {
            return Err(projection_error(
                TooltipProjectionErrorCode::NonChineseFlavorText,
                field,
            ));
        }
    }

    let combined = format!(
        "{}\n{}\n{}",
        flavor.display_name, flavor.flavor_description, flavor.lore
    );
    if contradicts_mechanics(&combined, approved_definition) {
        return Err(projection_error(
            TooltipProjectionErrorCode::FlavorContradictsMechanics,
            &approved_definition.ability_id,
        ));
    }
    const MECHANICAL_CLAIMS: &[&str] = &[
        "行动点",
        "伤害骰",
        "难度等级",
        "豁免DC",
        "豁免 DC",
        "冷却时间",
        "冷却回合",
        "持续回合",
        "命中率",
        "暴击率",
        "%",
        "％",
    ];
    if MECHANICAL_CLAIMS
        .iter()
        .any(|claim| combined.contains(claim))
    {
        return Err(projection_error(
            TooltipProjectionErrorCode::MechanicalClaimInFlavor,
            &approved_definition.ability_id,
        ));
    }
    Ok(())
}

fn contradicts_mechanics(text: &str, approved: &BuildAbilityDefinition) -> bool {
    let numbers = &approved.candidate.numbers;
    let claims_free = ["无需消耗", "不消耗任何", "零消耗", "完全免费"];
    if (numbers.action_point_cost > 0 || numbers.resource_cost.is_some())
        && claims_free.iter().any(|claim| text.contains(claim))
    {
        return true;
    }
    if numbers.cooldown_owner_turns > 0
        && ["无冷却", "无需冷却"]
            .iter()
            .any(|claim| text.contains(claim))
    {
        return true;
    }
    if approved.candidate.mechanics.resolution_type != ResolutionType::AutoHit
        && ["自动命中", "必定命中", "必中"]
            .iter()
            .any(|claim| text.contains(claim))
    {
        return true;
    }
    let target = approved.candidate.mechanics.target;
    (target != MechanicalTarget::SelfTarget && text.contains("仅对自己"))
        || (target != MechanicalTarget::SingleEnemy && text.contains("仅对单个敌人"))
        || (target != MechanicalTarget::SingleAlly && text.contains("仅对单个友方"))
        || (target != MechanicalTarget::SingleAny && text.contains("任意单个目标"))
}

fn critical_text(
    resolution: ResolutionType,
    policy: AbilityCriticalPolicy,
) -> Result<String, TooltipProjectionError> {
    match (resolution, policy) {
        (ResolutionType::AttackRoll, AbilityCriticalPolicy::Standard) => {
            Ok("暴击：攻击检定可暴击".to_owned())
        }
        (ResolutionType::AttackRoll, AbilityCriticalPolicy::ForceCritical) => {
            Ok("暴击：命中后强制暴击".to_owned())
        }
        (
            ResolutionType::SavingThrow
            | ResolutionType::OpposedCheck
            | ResolutionType::AutoHit
            | ResolutionType::ConditionalCheck
            | ResolutionType::AttemptEscape,
            AbilityCriticalPolicy::Standard,
        ) => Ok("暴击：不可暴击".to_owned()),
        (_, AbilityCriticalPolicy::ForceCritical) => Err(projection_error(
            TooltipProjectionErrorCode::InvalidCriticalPolicy,
            "criticalPolicy",
        )),
    }
}

fn resolution_name(value: ResolutionType) -> &'static str {
    match value {
        ResolutionType::AttackRoll => "攻击检定",
        ResolutionType::SavingThrow => "豁免检定",
        ResolutionType::OpposedCheck => "对抗检定",
        ResolutionType::AutoHit => "自动命中",
        ResolutionType::ConditionalCheck => "条件检定",
        ResolutionType::AttemptEscape => "逃脱检定",
    }
}

fn target_name(value: MechanicalTarget) -> &'static str {
    match value {
        MechanicalTarget::SelfTarget => "自己",
        MechanicalTarget::SingleAlly => "单个友方",
        MechanicalTarget::SingleEnemy => "单个敌人",
        MechanicalTarget::SingleAny => "任意单个目标",
    }
}

fn resolution_source_id(value: ResolutionType) -> String {
    match value {
        ResolutionType::AttackRoll => "ATTACK_ROLL",
        ResolutionType::SavingThrow => "SAVING_THROW",
        ResolutionType::OpposedCheck => "OPPOSED_CHECK",
        ResolutionType::AutoHit => "AUTO_HIT",
        ResolutionType::ConditionalCheck => "CONDITIONAL_CHECK",
        ResolutionType::AttemptEscape => "ATTEMPT_ESCAPE",
    }
    .to_owned()
}

fn target_source_id(value: MechanicalTarget) -> String {
    match value {
        MechanicalTarget::SelfTarget => "SELF",
        MechanicalTarget::SingleAlly => "SINGLE_ALLY",
        MechanicalTarget::SingleEnemy => "SINGLE_ENEMY",
        MechanicalTarget::SingleAny => "SINGLE_ANY",
    }
    .to_owned()
}

fn primitive_source_id(value: EffectPrimitiveId) -> String {
    match value {
        EffectPrimitiveId::DealDamage => "DEAL_DAMAGE",
        EffectPrimitiveId::Heal => "HEAL",
        EffectPrimitiveId::Revive => "REVIVE",
        EffectPrimitiveId::ApplyStatus => "APPLY_STATUS",
        EffectPrimitiveId::RemoveStatus => "REMOVE_STATUS",
        EffectPrimitiveId::ModifyStat => "MODIFY_STAT",
        EffectPrimitiveId::GainResource => "GAIN_RESOURCE",
        EffectPrimitiveId::LoseResource => "LOSE_RESOURCE",
        EffectPrimitiveId::GainAp => "GAIN_AP",
        EffectPrimitiveId::LoseAp => "LOSE_AP",
        EffectPrimitiveId::ModifyAp => "MODIFY_AP",
        EffectPrimitiveId::GainReactionCharge => "GAIN_REACTION_CHARGE",
        EffectPrimitiveId::ConsumeReactionCharge => "CONSUME_REACTION_CHARGE",
        EffectPrimitiveId::Shield => "SHIELD",
        EffectPrimitiveId::Cleanse => "CLEANSE",
        EffectPrimitiveId::Dispel => "DISPEL",
        EffectPrimitiveId::ModifyCooldown => "MODIFY_COOLDOWN",
        EffectPrimitiveId::ApplyTag => "APPLY_TAG",
        EffectPrimitiveId::RemoveTag => "REMOVE_TAG",
    }
    .to_owned()
}

fn format_basis_points(value: u32) -> String {
    let whole = value / 100;
    let fraction = value % 100;
    if fraction == 0 {
        whole.to_string()
    } else {
        format!("{whole}.{fraction:02}")
            .trim_end_matches('0')
            .to_owned()
    }
}

fn line(kind: TooltipLineKind, source_ids: Vec<String>, text: String) -> MechanicalTooltipLine {
    MechanicalTooltipLine {
        kind,
        source_ids,
        text,
    }
}

fn localized(stable_id: &str, name: &str) -> LocalizedStableId {
    LocalizedStableId {
        stable_id: stable_id.to_owned(),
        simplified_chinese_name: name.to_owned(),
    }
}

fn localized_map(
    entries: impl IntoIterator<Item = LocalizedStableId>,
    subject: &str,
) -> Result<BTreeMap<String, String>, TooltipProjectionError> {
    enum_localized_map(
        entries
            .into_iter()
            .map(|entry| (entry.stable_id, entry.simplified_chinese_name)),
        subject,
    )
}

fn enum_localized_map<K: Ord + fmt::Debug>(
    entries: impl IntoIterator<Item = (K, String)>,
    subject: &str,
) -> Result<BTreeMap<K, String>, TooltipProjectionError> {
    let mut result = BTreeMap::new();
    for (id, name) in entries {
        if name.trim() != name || name.is_empty() || !name.chars().any(is_cjk) {
            return Err(projection_error(
                TooltipProjectionErrorCode::InvalidCatalogEntry,
                subject,
            ));
        }
        if result.insert(id, name).is_some() {
            return Err(projection_error(
                TooltipProjectionErrorCode::DuplicateCatalogEntry,
                subject,
            ));
        }
    }
    Ok(result)
}

fn is_cjk(character: char) -> bool {
    matches!(
        character,
        '\u{3400}'..='\u{4DBF}'
            | '\u{4E00}'..='\u{9FFF}'
            | '\u{F900}'..='\u{FAFF}'
            | '\u{20000}'..='\u{2FA1F}'
    )
}

fn projection_error(
    code: TooltipProjectionErrorCode,
    subject: impl Into<String>,
) -> TooltipProjectionError {
    TooltipProjectionError {
        code,
        subject: subject.into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ember_combat_core::{
        COMBAT_FIXED_SCALE, CURRENT_COMBAT_VERSIONS, CanonicalMechanicalDefinition, CombatFixed,
        DamageChannelId, EffectDefinition, MechanicalTarget, PowerBudgetBasis, PowerBudgetReceipt,
        ProgrammaticCombatNumbers, ProgrammaticResourceCost, WorldCombatProfileResolver, WorldType,
    };

    fn ability() -> BuildAbilityDefinition {
        BuildAbilityDefinition {
            ability_id: "ability.thunder-seal".to_owned(),
            candidate: ember_combat_core::BudgetedMechanicalCandidate {
                mechanics: CanonicalMechanicalDefinition {
                    ruleset_version: CURRENT_COMBAT_VERSIONS.ruleset_version,
                    world_type: WorldType::Cultivation,
                    world_profile_version: CURRENT_COMBAT_VERSIONS.world_profile_version,
                    primitives: vec![
                        EffectPrimitiveId::DealDamage,
                        EffectPrimitiveId::ApplyStatus,
                    ],
                    tags: vec![
                        GameplayTagId::new("Ability.Control").unwrap(),
                        GameplayTagId::new("Ability.Spell").unwrap(),
                        GameplayTagId::new("Element.Lightning").unwrap(),
                    ],
                    damage_channels: vec![DamageChannelId::new("soul").unwrap()],
                    resource_ids: vec!["qi".to_owned()],
                    resolution_type: ResolutionType::SavingThrow,
                    target: MechanicalTarget::SingleEnemy,
                    local_overrides: vec![],
                },
                numbers: ProgrammaticCombatNumbers {
                    action_point_cost: 2,
                    resource_cost: Some(ProgrammaticResourceCost {
                        resource_id: "qi".to_owned(),
                        operation: ResourceCostOperation::Spend,
                        amount: 30,
                    }),
                    cooldown_owner_turns: 3,
                    damage_amount: Some(24),
                    healing_amount: None,
                    shield_amount: None,
                    difficulty_class: Some(14),
                    status_probability_basis_points: Some(2_000),
                    status_duration_owner_turns: Some(1),
                },
                budget: PowerBudgetReceipt {
                    basis: PowerBudgetBasis {
                        ruleset_version: CURRENT_COMBAT_VERSIONS.ruleset_version,
                        balance_version: CURRENT_COMBAT_VERSIONS.balance_version,
                        world_type: WorldType::Cultivation,
                        world_profile_version: CURRENT_COMBAT_VERSIONS.world_profile_version,
                        level: 10,
                        rarity_rank: 1,
                    },
                    base_allowance: 1,
                    level_allowance: 1,
                    rarity_allowance: 1,
                    action_cost_allowance: 1,
                    resource_cost_allowance: 1,
                    cooldown_allowance: 1,
                    profile_allowance: 1,
                    allowed_total: 7,
                    primitive_spend: 1,
                    local_override_spend: 0,
                    numeric_spend: 1,
                    spent_total: 2,
                    remaining: 5,
                },
            },
            effects: vec![
                EffectDefinition::DealDamage {
                    channel_id: DamageChannelId::new("soul").unwrap(),
                    raw_damage: CombatFixed::from_scaled(COMBAT_FIXED_SCALE),
                },
                EffectDefinition::ApplyStatus {
                    status_definition_id: "status.spirit-disorder".to_owned(),
                },
            ],
            maximum_uses_per_normal_owner_turn: Some(1),
            maximum_uses_per_battle: None,
            critical_policy: AbilityCriticalPolicy::Standard,
        }
    }

    fn flavor() -> AiCombatFlavor {
        AiCombatFlavor {
            display_name: "玄雷镇魂印".to_owned(),
            flavor_description: "引动玄雷震慑敌人的神魂。".to_owned(),
            lore: "古老雷修以此印守护山门，雷光消散后只余一缕松香。".to_owned(),
        }
    }

    #[test]
    fn projects_every_required_mechanical_family_from_the_approved_definition() {
        let catalog = CombatPresentationCatalog::v0_4_1();
        let projector = MechanicalTooltipProjector::new(&catalog);
        let profiles = ember_combat_core::DamageChannelCatalog::v0_4_1();
        let resolver = WorldCombatProfileResolver::v0_4_1(&profiles).unwrap();
        let tooltip = projector
            .project(&ability(), resolver.resolve(WorldType::Cultivation))
            .unwrap();
        let rendered: Vec<_> = tooltip
            .lines
            .iter()
            .map(|line| line.text.as_str())
            .collect();
        assert_eq!(
            rendered,
            [
                "行动点：2",
                "消耗灵力：30",
                "判定：豁免检定",
                "伤害：神魂（24）",
                "暴击：不可暴击",
                "难度等级：14",
                "状态：20%，持续 1 个自身普通回合",
                "冷却：3 个自身普通回合",
                "目标：单个敌人",
                "效果：造成伤害",
                "效果：施加状态",
                "标签：控制",
                "标签：法术",
                "标签：雷电",
            ]
        );
        assert_eq!(
            tooltip.lines[3].source_ids,
            ["soul"],
            "stable IDs remain metadata rather than player copy"
        );
    }

    #[test]
    fn composition_keeps_ai_flavor_and_programmatic_mechanics_as_separate_fields() {
        let catalog = CombatPresentationCatalog::v0_4_1();
        let projector = MechanicalTooltipProjector::new(&catalog);
        let channels = ember_combat_core::DamageChannelCatalog::v0_4_1();
        let resolver = WorldCombatProfileResolver::v0_4_1(&channels).unwrap();
        let combined = projector
            .compose(
                &ability(),
                resolver.resolve(WorldType::Cultivation),
                flavor(),
            )
            .unwrap();
        assert_eq!(combined.flavor.display_name, "玄雷镇魂印");
        assert_eq!(combined.mechanics.lines[0].text, "行动点：2");
    }

    #[test]
    fn flavor_schema_rejects_extra_mechanics_fields() {
        let value = serde_json::json!({
            "displayName": "玄雷镇魂印",
            "flavorDescription": "雷光震慑敌人的神魂。",
            "lore": "古老雷修留下的秘印。",
            "damage": 999
        });
        assert!(serde_json::from_value::<AiCombatFlavor>(value).is_err());
    }

    #[test]
    fn rejects_non_chinese_and_natural_language_mechanical_copies() {
        let english = AiCombatFlavor {
            display_name: "Thunder Seal".to_owned(),
            ..flavor()
        };
        assert_eq!(
            validate_ai_flavor(&english, &ability()).unwrap_err().code,
            TooltipProjectionErrorCode::NonChineseFlavorText
        );
        let copied = AiCombatFlavor {
            flavor_description: "消耗二十行动点并造成三枚伤害骰。".to_owned(),
            ..flavor()
        };
        assert_eq!(
            validate_ai_flavor(&copied, &ability()).unwrap_err().code,
            TooltipProjectionErrorCode::MechanicalClaimInFlavor
        );
    }

    #[test]
    fn rejects_obvious_text_conflicts_without_changing_mechanics() {
        let contradiction = AiCombatFlavor {
            flavor_description: "这道秘术完全免费且必定命中。".to_owned(),
            ..flavor()
        };
        let approved = ability();
        let original = approved.candidate.clone();
        assert_eq!(
            validate_ai_flavor(&contradiction, &approved)
                .unwrap_err()
                .code,
            TooltipProjectionErrorCode::FlavorContradictsMechanics
        );
        assert_eq!(approved.candidate, original);
    }

    #[test]
    fn unknown_localization_profile_drift_and_invalid_critical_policy_fail_closed() {
        let catalog = CombatPresentationCatalog::v0_4_1();
        let projector = MechanicalTooltipProjector::new(&catalog);
        let channels = ember_combat_core::DamageChannelCatalog::v0_4_1();
        let resolver = WorldCombatProfileResolver::v0_4_1(&channels).unwrap();
        let mut unknown = ability();
        unknown.candidate.mechanics.tags = vec![GameplayTagId::new("Ability.Unknown").unwrap()];
        assert_eq!(
            projector
                .project(&unknown, resolver.resolve(WorldType::Cultivation))
                .unwrap_err()
                .code,
            TooltipProjectionErrorCode::UnknownPresentationId
        );
        assert_eq!(
            projector
                .project(&ability(), resolver.resolve(WorldType::Fantasy))
                .unwrap_err()
                .code,
            TooltipProjectionErrorCode::DefinitionProfileMismatch
        );
        let mut invalid_critical = ability();
        invalid_critical.critical_policy = AbilityCriticalPolicy::ForceCritical;
        assert_eq!(
            projector
                .project(&invalid_critical, resolver.resolve(WorldType::Cultivation))
                .unwrap_err()
                .code,
            TooltipProjectionErrorCode::InvalidCriticalPolicy
        );
    }
}

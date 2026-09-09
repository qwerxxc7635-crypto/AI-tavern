use std::{collections::BTreeMap, error::Error, fmt};

use ember_combat_core::{
    CombatPhase, CombatResultType, CombatSide, CombatState, CombatStateInvariantValidator,
    CombatantState, PreconditionFailure, PreconditionFailureCode,
};
use serde::{Deserialize, Serialize};

use crate::{CombatPresentationCatalog, is_cjk};

pub const COMBAT_VIEW_MODEL_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CombatantPresentationEntry {
    pub combatant_id: String,
    pub display_name_zh_cn: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StatusPresentationEntry {
    pub status_definition_id: String,
    pub display_name_zh_cn: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CombatActionViewKind {
    Ability,
    EndTurn,
    Escape,
    Reaction,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CombatantSideView {
    Player,
    Companion,
    Hostile,
    Neutral,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CombatActionRuleProjection {
    pub action_id: String,
    pub display_name_zh_cn: String,
    pub kind: CombatActionViewKind,
    pub requires_target: bool,
    pub is_legal: bool,
    pub legal_target_ids: Vec<String>,
    pub failures: Vec<PreconditionFailure>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CombatRulesPresentationSnapshot {
    pub state_revision: u64,
    pub actions: Vec<CombatActionRuleProjection>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CombatViewModelRequest<'a> {
    pub state: &'a CombatState,
    pub rules: &'a CombatRulesPresentationSnapshot,
    pub combatant_presentations: &'a [CombatantPresentationEntry],
    pub status_presentations: &'a [StatusPresentationEntry],
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CombatMeterViewModel {
    pub current: i64,
    pub maximum: i64,
    pub text_zh_cn: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CombatResourceViewModel {
    pub resource_id: String,
    pub label_zh_cn: String,
    pub current: i64,
    pub minimum: i64,
    pub maximum: i64,
    pub overheat_threshold: Option<i64>,
    pub is_overheated: bool,
    pub text_zh_cn: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CombatStatusViewModel {
    pub status_instance_id: String,
    pub status_definition_id: String,
    pub display_name_zh_cn: String,
    pub stack_count: i64,
    pub remaining_duration: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CombatantViewModel {
    pub combatant_id: String,
    pub display_name_zh_cn: String,
    pub side: CombatantSideView,
    pub side_label_zh_cn: String,
    pub state_label_zh_cn: String,
    pub is_active_turn: bool,
    pub health: CombatMeterViewModel,
    pub shield: CombatMeterViewModel,
    pub action_points: CombatMeterViewModel,
    pub reaction_charges: CombatMeterViewModel,
    pub resources: Vec<CombatResourceViewModel>,
    pub statuses: Vec<CombatStatusViewModel>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TimelineEntryViewModel {
    pub combatant_id: String,
    pub display_name_zh_cn: String,
    pub is_extra_turn: bool,
    pub is_current: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EnemyIntentViewModel {
    pub enemy_id: String,
    pub enemy_display_name_zh_cn: String,
    pub intent_label_zh_cn: String,
    pub target_hint_id: Option<String>,
    pub target_hint_name_zh_cn: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CombatActionViewModel {
    pub action_id: String,
    pub display_name_zh_cn: String,
    pub kind: CombatActionViewKind,
    pub enabled: bool,
    pub legal_target_ids: Vec<String>,
    pub disabled_reasons_zh_cn: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CombatViewModel {
    pub schema_version: u32,
    pub combat_instance_id: String,
    pub state_revision: u64,
    pub phase_label_zh_cn: String,
    pub round_number: u64,
    pub round_label_zh_cn: String,
    pub active_combatant_id: Option<String>,
    pub timeline: Vec<TimelineEntryViewModel>,
    pub combatants: Vec<CombatantViewModel>,
    pub enemy_intents: Vec<EnemyIntentViewModel>,
    pub actions: Vec<CombatActionViewModel>,
    pub result_label_zh_cn: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CombatViewModelErrorCode {
    InvalidCombatState,
    StaleRulesProjection,
    InvalidPresentationEntry,
    DuplicatePresentationEntry,
    MissingPresentationEntry,
    InvalidRulesProjection,
    UnknownRulesReference,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CombatViewModelError {
    pub code: CombatViewModelErrorCode,
    pub subject: String,
}

impl fmt::Display for CombatViewModelError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "combat view model projection failed for {}: {:?}",
            self.subject, self.code
        )
    }
}

impl Error for CombatViewModelError {}

pub struct CombatViewModelProjector<'a> {
    catalog: &'a CombatPresentationCatalog,
}

impl<'a> CombatViewModelProjector<'a> {
    #[must_use]
    pub const fn new(catalog: &'a CombatPresentationCatalog) -> Self {
        Self { catalog }
    }

    pub fn project(
        &self,
        request: &CombatViewModelRequest<'_>,
    ) -> Result<CombatViewModel, CombatViewModelError> {
        CombatStateInvariantValidator::validate(request.state)
            .map_err(|_| view_error(CombatViewModelErrorCode::InvalidCombatState, "combatState"))?;
        if request.rules.state_revision != request.state.revision {
            return Err(view_error(
                CombatViewModelErrorCode::StaleRulesProjection,
                "stateRevision",
            ));
        }
        let combatant_names = presentation_map(
            request
                .combatant_presentations
                .iter()
                .map(|entry| (&entry.combatant_id, &entry.display_name_zh_cn)),
            "combatantPresentation",
        )?;
        let status_names = presentation_map(
            request
                .status_presentations
                .iter()
                .map(|entry| (&entry.status_definition_id, &entry.display_name_zh_cn)),
            "statusPresentation",
        )?;
        for combatant in &request.state.combatants {
            require_name(&combatant_names, &combatant.combatant_id)?;
            for status in &combatant.statuses {
                require_name(&status_names, &status.status_definition_id)?;
            }
        }

        let timeline = request
            .state
            .timeline
            .iter()
            .map(|entry| {
                Ok(TimelineEntryViewModel {
                    combatant_id: entry.combatant_id.clone(),
                    display_name_zh_cn: require_name(&combatant_names, &entry.combatant_id)?
                        .to_owned(),
                    is_extra_turn: entry.is_extra_turn,
                    is_current: request.state.round.active_combatant_id.as_deref()
                        == Some(entry.combatant_id.as_str()),
                })
            })
            .collect::<Result<Vec<_>, CombatViewModelError>>()?;
        let ordered_combatant_ids = presentation_combatant_order(request.state);
        let combatants = ordered_combatant_ids
            .iter()
            .map(|combatant_id| {
                let combatant = request
                    .state
                    .combatants
                    .iter()
                    .find(|candidate| candidate.combatant_id == *combatant_id)
                    .expect("presentation order only contains state combatants");
                let resources = combatant
                    .resources
                    .iter()
                    .map(|resource| {
                        let label = self
                            .catalog
                            .resources
                            .get(&resource.resource_id)
                            .ok_or_else(|| {
                                view_error(
                                    CombatViewModelErrorCode::MissingPresentationEntry,
                                    &resource.resource_id,
                                )
                            })?;
                        Ok(CombatResourceViewModel {
                            resource_id: resource.resource_id.clone(),
                            label_zh_cn: label.clone(),
                            current: resource.current,
                            minimum: resource.min_value,
                            maximum: resource.max_value,
                            overheat_threshold: resource.overheat_threshold,
                            is_overheated: resource
                                .overheat_threshold
                                .is_some_and(|threshold| resource.current >= threshold),
                            text_zh_cn: format!(
                                "{label}：{}/{}",
                                resource.current, resource.max_value
                            ),
                        })
                    })
                    .collect::<Result<Vec<_>, CombatViewModelError>>()?;
                let statuses = combatant
                    .statuses
                    .iter()
                    .map(|status| {
                        Ok(CombatStatusViewModel {
                            status_instance_id: status.status_instance_id.clone(),
                            status_definition_id: status.status_definition_id.clone(),
                            display_name_zh_cn: require_name(
                                &status_names,
                                &status.status_definition_id,
                            )?
                            .to_owned(),
                            stack_count: status.stack_count,
                            remaining_duration: status.remaining_duration,
                        })
                    })
                    .collect::<Result<Vec<_>, CombatViewModelError>>()?;
                Ok(CombatantViewModel {
                    combatant_id: combatant.combatant_id.clone(),
                    display_name_zh_cn: require_name(&combatant_names, &combatant.combatant_id)?
                        .to_owned(),
                    side: side_view(combatant.side),
                    side_label_zh_cn: side_label(combatant.side).to_owned(),
                    state_label_zh_cn: state_label(combatant.state).to_owned(),
                    is_active_turn: request.state.round.active_combatant_id.as_deref()
                        == Some(combatant.combatant_id.as_str()),
                    health: meter("生命", combatant.hit_points, combatant.max_hit_points),
                    shield: meter("护盾", combatant.shield, combatant.max_shield),
                    action_points: meter(
                        "行动点",
                        combatant.action_points,
                        combatant.max_action_points,
                    ),
                    reaction_charges: meter(
                        "反应次数",
                        combatant.reaction_charges,
                        combatant.max_reaction_charges,
                    ),
                    resources,
                    statuses,
                })
            })
            .collect::<Result<Vec<_>, CombatViewModelError>>()?;
        let enemy_intents = request
            .state
            .enemy_intents
            .iter()
            .map(|intent| {
                Ok(EnemyIntentViewModel {
                    enemy_id: intent.enemy_id.clone(),
                    enemy_display_name_zh_cn: require_name(&combatant_names, &intent.enemy_id)?
                        .to_owned(),
                    intent_label_zh_cn: intent.display_label_zh_cn.clone(),
                    target_hint_id: intent.target_hint.clone(),
                    target_hint_name_zh_cn: intent
                        .target_hint
                        .as_ref()
                        .map(|target| require_name(&combatant_names, target).map(ToOwned::to_owned))
                        .transpose()?,
                })
            })
            .collect::<Result<Vec<_>, CombatViewModelError>>()?;
        let actions = project_actions(request.state, request.rules)?;

        Ok(CombatViewModel {
            schema_version: COMBAT_VIEW_MODEL_SCHEMA_VERSION,
            combat_instance_id: request.state.combat_instance_id.clone(),
            state_revision: request.state.revision,
            phase_label_zh_cn: phase_label(request.state.phase).to_owned(),
            round_number: request.state.round.round_number,
            round_label_zh_cn: format!("第 {} 轮", request.state.round.round_number),
            active_combatant_id: request.state.round.active_combatant_id.clone(),
            timeline,
            combatants,
            enemy_intents,
            actions,
            result_label_zh_cn: request
                .state
                .confirmed_result
                .map(result_label)
                .map(str::to_owned),
        })
    }
}

fn project_actions(
    state: &CombatState,
    rules: &CombatRulesPresentationSnapshot,
) -> Result<Vec<CombatActionViewModel>, CombatViewModelError> {
    let mut action_ids = BTreeMap::new();
    let state_ids: BTreeMap<_, _> = state
        .combatants
        .iter()
        .map(|combatant| (combatant.combatant_id.as_str(), ()))
        .collect();
    rules
        .actions
        .iter()
        .map(|action| {
            validate_visible_text(&action.display_name_zh_cn, "actionName")?;
            if !valid_id(&action.action_id)
                || action_ids.insert(action.action_id.as_str(), ()).is_some()
                || action.is_legal != action.failures.is_empty()
                || (action.is_legal && action.requires_target && action.legal_target_ids.is_empty())
                || (!action.is_legal && !action.legal_target_ids.is_empty())
            {
                return Err(view_error(
                    CombatViewModelErrorCode::InvalidRulesProjection,
                    &action.action_id,
                ));
            }
            let mut targets = BTreeMap::new();
            for target_id in &action.legal_target_ids {
                if !state_ids.contains_key(target_id.as_str())
                    || targets.insert(target_id.as_str(), ()).is_some()
                {
                    return Err(view_error(
                        CombatViewModelErrorCode::UnknownRulesReference,
                        target_id,
                    ));
                }
            }
            let mut reasons = Vec::new();
            for failure in &action.failures {
                let reason = precondition_failure_label(failure.code).to_owned();
                if !reasons.contains(&reason) {
                    reasons.push(reason);
                }
            }
            Ok(CombatActionViewModel {
                action_id: action.action_id.clone(),
                display_name_zh_cn: action.display_name_zh_cn.clone(),
                kind: action.kind,
                enabled: action.is_legal,
                legal_target_ids: action.legal_target_ids.clone(),
                disabled_reasons_zh_cn: reasons,
            })
        })
        .collect()
}

fn presentation_combatant_order(state: &CombatState) -> Vec<String> {
    let mut ids = Vec::with_capacity(state.combatants.len());
    for entry in &state.timeline {
        if !ids.contains(&entry.combatant_id) {
            ids.push(entry.combatant_id.clone());
        }
    }
    let mut remaining: Vec<_> = state
        .combatants
        .iter()
        .map(|combatant| combatant.combatant_id.clone())
        .filter(|id| !ids.contains(id))
        .collect();
    remaining.sort();
    ids.extend(remaining);
    ids
}

fn presentation_map<'a>(
    entries: impl IntoIterator<Item = (&'a String, &'a String)>,
    subject: &str,
) -> Result<BTreeMap<&'a str, &'a str>, CombatViewModelError> {
    let mut map = BTreeMap::new();
    for (id, name) in entries {
        if !valid_id(id) {
            return Err(view_error(
                CombatViewModelErrorCode::InvalidPresentationEntry,
                subject,
            ));
        }
        validate_visible_text(name, subject)?;
        if map.insert(id.as_str(), name.as_str()).is_some() {
            return Err(view_error(
                CombatViewModelErrorCode::DuplicatePresentationEntry,
                id,
            ));
        }
    }
    Ok(map)
}

fn require_name<'a>(
    names: &'a BTreeMap<&str, &str>,
    id: &str,
) -> Result<&'a str, CombatViewModelError> {
    names
        .get(id)
        .copied()
        .ok_or_else(|| view_error(CombatViewModelErrorCode::MissingPresentationEntry, id))
}

fn validate_visible_text(value: &str, subject: &str) -> Result<(), CombatViewModelError> {
    if value.is_empty()
        || value.trim() != value
        || value.chars().count() > 120
        || value.chars().any(char::is_control)
        || !value.chars().any(is_cjk)
    {
        Err(view_error(
            CombatViewModelErrorCode::InvalidPresentationEntry,
            subject,
        ))
    } else {
        Ok(())
    }
}

fn valid_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 256
        && value.trim() == value
        && !value.chars().any(char::is_control)
}

fn meter(label: &str, current: i64, maximum: i64) -> CombatMeterViewModel {
    CombatMeterViewModel {
        current,
        maximum,
        text_zh_cn: format!("{label}：{current}/{maximum}"),
    }
}

const fn phase_label(phase: CombatPhase) -> &'static str {
    match phase {
        CombatPhase::BattleStart => "战斗开始",
        CombatPhase::RoundStart => "回合开始",
        CombatPhase::OwnerTurnStart => "角色回合开始",
        CombatPhase::Action => "行动阶段",
        CombatPhase::OwnerTurnEnd => "角色回合结束",
        CombatPhase::ExtraTurn => "额外回合",
        CombatPhase::RoundEnd => "整轮结束",
        CombatPhase::Stable => "等待行动",
        CombatPhase::Terminal => "战斗结束",
    }
}

const fn side_label(side: CombatSide) -> &'static str {
    match side {
        CombatSide::Player => "我方主角",
        CombatSide::Companion => "我方队友",
        CombatSide::Hostile => "敌方",
        CombatSide::Neutral => "中立",
    }
}

const fn side_view(side: CombatSide) -> CombatantSideView {
    match side {
        CombatSide::Player => CombatantSideView::Player,
        CombatSide::Companion => CombatantSideView::Companion,
        CombatSide::Hostile => CombatantSideView::Hostile,
        CombatSide::Neutral => CombatantSideView::Neutral,
    }
}

const fn state_label(state: CombatantState) -> &'static str {
    match state {
        CombatantState::Active => "可行动",
        CombatantState::Downed => "倒地",
        CombatantState::Defeated => "已战败",
        CombatantState::Removed => "已离场",
    }
}

const fn result_label(result: CombatResultType) -> &'static str {
    match result {
        CombatResultType::Victory => "胜利",
        CombatResultType::Defeat => "战败",
        CombatResultType::Escape => "撤退成功",
        CombatResultType::ScriptedVictory => "剧情胜利",
        CombatResultType::ScriptedDefeat => "剧情战败",
        CombatResultType::Aborted => "战斗已安全中止",
    }
}

const fn precondition_failure_label(code: PreconditionFailureCode) -> &'static str {
    match code {
        PreconditionFailureCode::SourceNotAuthorized => "当前角色不受你控制",
        PreconditionFailureCode::UnstableInputPoint => "请等待当前结算完成",
        PreconditionFailureCode::ReservationNotOwned => "行动消耗预留已失效",
        PreconditionFailureCode::ActorMissing => "行动角色不存在",
        PreconditionFailureCode::ActorCannotAct => "当前角色无法行动",
        PreconditionFailureCode::AbilityMissing => "技能不存在",
        PreconditionFailureCode::AbilityDisabled => "技能当前不可用",
        PreconditionFailureCode::TargetMissing => "目标不存在",
        PreconditionFailureCode::TargetIllegal => "目标不符合技能要求",
        PreconditionFailureCode::InsufficientActionPoints => "行动点不足",
        PreconditionFailureCode::InsufficientReactionCharges => "反应次数不足",
        PreconditionFailureCode::ResourceMissing => "缺少所需资源",
        PreconditionFailureCode::InsufficientResource => "资源不足",
        PreconditionFailureCode::ItemMissing => "所需物品不存在",
        PreconditionFailureCode::InsufficientItemQuantity => "物品数量不足",
        PreconditionFailureCode::CooldownActive => "技能仍在冷却",
        PreconditionFailureCode::NormalOwnerTurnUsageExhausted => "本回合使用次数已耗尽",
        PreconditionFailureCode::BattleUsageExhausted => "本场战斗使用次数已耗尽",
        PreconditionFailureCode::BasicAttackUsageExhausted => "本回合普通攻击次数已耗尽",
        PreconditionFailureCode::OnceCounterAlreadyUsed => "本次触发机会已使用",
        PreconditionFailureCode::RequiredActorTagMissing => "行动角色缺少必要状态",
        PreconditionFailureCode::ForbiddenActorTagPresent => "行动角色当前状态不允许使用",
        PreconditionFailureCode::RequiredTargetTagMissing => "目标缺少必要状态",
        PreconditionFailureCode::ForbiddenTargetTagPresent => "目标当前状态不允许选择",
        PreconditionFailureCode::ResourceHardLimitExceeded => "使用后将超过资源上限",
    }
}

fn view_error(code: CombatViewModelErrorCode, subject: impl Into<String>) -> CombatViewModelError {
    CombatViewModelError {
        code,
        subject: subject.into(),
    }
}

#[cfg(test)]
mod tests {
    use ember_combat_core::{
        CURRENT_COMBAT_VERSIONS, CombatRng, CombatantRuntime, EnemyIntentCategory, EnemyIntentPlan,
        EnemyIntentTelegraphLevel, HardCcDrRuntime, ObjectiveRuntimeState, ProvisionalRuntimeDelta,
        ReinforcementRuntimeState, ResourceState, RoundRuntimeState, ShieldRechargeRuntime,
        TerminalPriorityPolicy, TimelineEntry, UtilityActionCategory,
    };

    use super::*;

    const SEED: &str = "0123456789abcdef0123456789abcdef";

    #[test]
    fn projects_authoritative_state_and_exact_rules_targets_into_chinese_view_data() {
        let state = state();
        let state_before = state.canonical_json_bytes().unwrap();
        let rules = rules(state.revision);
        let names = names();
        let view = CombatViewModelProjector::new(&CombatPresentationCatalog::v0_4_1())
            .project(&request(&state, &rules, &names))
            .unwrap();

        assert_eq!(view.schema_version, 1);
        assert_eq!(view.phase_label_zh_cn, "等待行动");
        assert_eq!(view.round_label_zh_cn, "第 2 轮");
        assert_eq!(view.timeline[0].combatant_id, "enemy");
        assert!(view.timeline[1].is_current);
        assert_eq!(view.combatants[0].display_name_zh_cn, "灰烬守卫");
        assert_eq!(view.combatants[1].health.text_zh_cn, "生命：30/40");
        assert_eq!(view.combatants[1].resources[0].text_zh_cn, "法力：6/10");
        assert_eq!(view.enemy_intents[0].intent_label_zh_cn, "攻击");
        assert_eq!(
            view.enemy_intents[0].target_hint_name_zh_cn.as_deref(),
            Some("旅者")
        );
        assert_eq!(view.actions[0].legal_target_ids, ["hero", "enemy"]);
        assert!(view.actions[0].enabled);
        assert_eq!(view.actions[1].disabled_reasons_zh_cn, ["技能仍在冷却"]);
        assert_eq!(state.canonical_json_bytes().unwrap(), state_before);
    }

    #[test]
    fn projection_is_byte_deterministic_and_state_collection_order_does_not_replace_timeline_order()
    {
        let state = state();
        let rules = rules(state.revision);
        let mut reversed_names = names();
        reversed_names.reverse();
        let catalog = CombatPresentationCatalog::v0_4_1();
        let projector = CombatViewModelProjector::new(&catalog);
        let first = projector
            .project(&request(&state, &rules, &names()))
            .unwrap();
        let second = projector
            .project(&request(&state, &rules, &reversed_names))
            .unwrap();
        assert_eq!(first, second);
        assert_eq!(
            serde_json::to_vec(&first).unwrap(),
            serde_json::to_vec(&second).unwrap()
        );
        assert_eq!(first.combatants[0].combatant_id, "enemy");
    }

    #[test]
    fn stale_or_self_inconsistent_rules_projection_fails_closed() {
        let state = state();
        let names = names();
        let mut stale = rules(state.revision + 1);
        let catalog = CombatPresentationCatalog::v0_4_1();
        let projector = CombatViewModelProjector::new(&catalog);
        assert_eq!(
            projector
                .project(&request(&state, &stale, &names))
                .unwrap_err()
                .code,
            CombatViewModelErrorCode::StaleRulesProjection
        );

        stale.state_revision = state.revision;
        stale.actions[0].is_legal = false;
        assert_eq!(
            projector
                .project(&request(&state, &stale, &names))
                .unwrap_err()
                .code,
            CombatViewModelErrorCode::InvalidRulesProjection
        );

        let mut unknown = rules(state.revision);
        unknown.actions[0].legal_target_ids = vec!["not-in-state".to_owned()];
        assert_eq!(
            projector
                .project(&request(&state, &unknown, &names))
                .unwrap_err()
                .code,
            CombatViewModelErrorCode::UnknownRulesReference
        );
    }

    #[test]
    fn invalid_state_or_missing_non_chinese_presentation_data_is_rejected() {
        let mut invalid_state = state();
        invalid_state.combatants[0].hit_points = -1;
        let invalid_rules = rules(invalid_state.revision);
        let invalid_names = names();
        let catalog = CombatPresentationCatalog::v0_4_1();
        let projector = CombatViewModelProjector::new(&catalog);
        assert_eq!(
            projector
                .project(&request(&invalid_state, &invalid_rules, &invalid_names))
                .unwrap_err()
                .code,
            CombatViewModelErrorCode::InvalidCombatState
        );

        let state = state();
        let rules = rules(state.revision);
        let mut incomplete = names();
        incomplete.pop();
        assert_eq!(
            projector
                .project(&request(&state, &rules, &incomplete))
                .unwrap_err()
                .code,
            CombatViewModelErrorCode::MissingPresentationEntry
        );

        let mut english = names();
        english[0].display_name_zh_cn = "Enemy".to_owned();
        assert_eq!(
            projector
                .project(&request(&state, &rules, &english))
                .unwrap_err()
                .code,
            CombatViewModelErrorCode::InvalidPresentationEntry
        );
    }

    #[test]
    fn combat_core_manifest_has_no_reverse_presentation_dependency() {
        let manifest = include_str!("../../combat-core/Cargo.toml");
        assert!(!manifest.contains("combat-presentation"));
        assert!(include_str!("../Cargo.toml").contains("ember-combat-core"));
    }

    fn request<'a>(
        state: &'a CombatState,
        rules: &'a CombatRulesPresentationSnapshot,
        names: &'a [CombatantPresentationEntry],
    ) -> CombatViewModelRequest<'a> {
        CombatViewModelRequest {
            state,
            rules,
            combatant_presentations: names,
            status_presentations: &[],
        }
    }

    fn names() -> Vec<CombatantPresentationEntry> {
        vec![
            CombatantPresentationEntry {
                combatant_id: "hero".to_owned(),
                display_name_zh_cn: "旅者".to_owned(),
            },
            CombatantPresentationEntry {
                combatant_id: "enemy".to_owned(),
                display_name_zh_cn: "灰烬守卫".to_owned(),
            },
        ]
    }

    fn rules(revision: u64) -> CombatRulesPresentationSnapshot {
        CombatRulesPresentationSnapshot {
            state_revision: revision,
            actions: vec![
                CombatActionRuleProjection {
                    action_id: "ability.strange-target".to_owned(),
                    display_name_zh_cn: "命运牵引".to_owned(),
                    kind: CombatActionViewKind::Ability,
                    requires_target: true,
                    is_legal: true,
                    legal_target_ids: vec!["hero".to_owned(), "enemy".to_owned()],
                    failures: vec![],
                },
                CombatActionRuleProjection {
                    action_id: "ability.cooldown".to_owned(),
                    display_name_zh_cn: "余烬斩".to_owned(),
                    kind: CombatActionViewKind::Ability,
                    requires_target: true,
                    is_legal: false,
                    legal_target_ids: vec![],
                    failures: vec![PreconditionFailure {
                        rule_id: "cooldown".to_owned(),
                        code: PreconditionFailureCode::CooldownActive,
                        subject_id: Some("ability.cooldown".to_owned()),
                    }],
                },
            ],
        }
    }

    fn state() -> CombatState {
        let combatants = vec![
            combatant("hero", CombatSide::Player, 30, 40),
            combatant("enemy", CombatSide::Hostile, 20, 25),
        ];
        CombatState {
            combat_instance_id: "combat-view-model".to_owned(),
            versions: CURRENT_COMBAT_VERSIONS,
            random_seed: SEED.to_owned(),
            revision: 7,
            last_committed_sequence: 4,
            phase: CombatPhase::Stable,
            combatants,
            formal_party_member_ids: vec!["hero".to_owned()],
            combat_inventory: vec![],
            cost_reservations: vec![],
            resolution_context: None,
            timeline: vec![timeline("enemy", 1), timeline("hero", 2)],
            round: RoundRuntimeState {
                round_number: 2,
                completed_round_count: 1,
                active_combatant_id: Some("hero".to_owned()),
                extra_turn_resume_phase: None,
                roster: vec![],
            },
            objectives: ObjectiveRuntimeState {
                objectives: vec![],
                required_objective_ids: vec![],
                completed_objective_ids: vec![],
                failed_objective_ids: vec![],
                committed_signals: vec![],
                failure_records: vec![],
            },
            reinforcements: ReinforcementRuntimeState {
                reinforcements: vec![],
            },
            provisional_delta: ProvisionalRuntimeDelta {
                revision: 0,
                entries: vec![],
            },
            scheduler: None,
            pending_reaction: None,
            enemy_intents: vec![EnemyIntentPlan {
                enemy_id: "enemy".to_owned(),
                intent_category: EnemyIntentCategory::Attack,
                preferred_utility_category: UtilityActionCategory::Damage,
                display_label_zh_cn: "攻击".to_owned(),
                target_hint: Some("hero".to_owned()),
                telegraph_level: EnemyIntentTelegraphLevel::High,
                created_sequence: 1,
                created_round: 2,
                replan_records: vec![],
            }],
            result_candidates: vec![],
            terminal_priority_policy: TerminalPriorityPolicy::default(),
            confirmed_result_candidate_id: None,
            confirmed_result: None,
            rng: CombatRng::new(
                SEED,
                "combat-view-model",
                CURRENT_COMBAT_VERSIONS.rng_contract_version,
            )
            .unwrap()
            .snapshot(),
        }
    }

    fn combatant(
        id: &str,
        side: CombatSide,
        hit_points: i64,
        max_hit_points: i64,
    ) -> CombatantRuntime {
        CombatantRuntime {
            combatant_id: id.to_owned(),
            definition_id: format!("definition.{id}"),
            side,
            state: CombatantState::Active,
            hit_points,
            max_hit_points,
            shield: 0,
            max_shield: 0,
            action_points: 2,
            max_action_points: 3,
            reaction_charges: 1,
            max_reaction_charges: 1,
            resources: if side == CombatSide::Player {
                vec![ResourceState {
                    resource_id: "mana".to_owned(),
                    current: 6,
                    min_value: 0,
                    max_value: 10,
                    overheat_threshold: None,
                    hard_max_value: None,
                }]
            } else {
                vec![]
            },
            statuses: vec![],
            ability_usage: vec![],
            basic_attack_count_this_normal_owner_turn: 0,
            once_usage_counters: vec![],
            normal_owner_turn_index: 1,
            hard_cc_dr: HardCcDrRuntime {
                level: 0,
                quiet_owner_turns: 0,
                applied_since_owner_turn_end: false,
            },
            shield_recharge: ShieldRechargeRuntime {
                uninterrupted_completed_rounds: 0,
                interrupted_this_round: false,
                last_processed_round_number: None,
            },
            initiative_result: if side == CombatSide::Hostile { 15 } else { 12 },
            initiative_base_stat: 2,
            last_committed_timeline_order: Some(if side == CombatSide::Hostile { 0 } else { 1 }),
            solo_recovery_available: side == CombatSide::Player,
        }
    }

    fn timeline(id: &str, sequence: u64) -> TimelineEntry {
        TimelineEntry {
            combatant_id: id.to_owned(),
            initiative_result: if id == "enemy" { 15 } else { 12 },
            initiative_base_stat: 2,
            is_extra_turn: false,
            source_sequence: sequence,
        }
    }
}

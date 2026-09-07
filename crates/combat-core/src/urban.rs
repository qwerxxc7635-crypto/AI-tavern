use std::{error::Error, fmt};

use crate::{
    CURRENT_COMBAT_VERSIONS, ChannelMitigationRule, CombatPhase, CombatState, DamageChannelCatalog,
    DamageChannelId, DefenseBehavior, DeveloperRuleModule, NormalOwnerTurnResourcePolicy,
    PrimaryMitigation, RecoveryEffectCommit, RecoveryEffectProcessor, RecoveryEffectRequest,
    RecoveryRules, ResourceLifecycle, ResourceLifecycleRule, ResourceState, ResourceStorage,
    ReviveFollowupApplier, SignatureMechanic, WorldCombatProfile, WorldCombatProfileDefinition,
    WorldProfileError, WorldRuleFacet, WorldType, world_profile::resolve_single_definition,
};

const HEALTH_ID: &str = "health";
const STAMINA_ID: &str = "stamina";
const FOCUS_ID: &str = "focus";
const FIREARM_MODULE_ID: &str = "urban.firearm.v0_4_1";
const MELEE_MODULE_ID: &str = "urban.melee.v0_4_1";
const PSYCHIC_MODULE_ID: &str = "urban.psychic.v0_4_1";
const OCCULT_MODULE_ID: &str = "urban.occult.v0_4_1";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UrbanSubProfile {
    Base,
    Firearm,
    Melee,
    Psychic,
    Occult,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UrbanTacticalAction {
    Aim,
    Brace,
    Observe,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UrbanHealingSource {
    FirstAid,
    MedicalItem,
    ExplicitAbility,
    SoloRecovery,
    PassiveTurn,
    AutomaticLayerRecharge,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct UrbanBalanceConfig {
    pub stamina_restore_per_normal_owner_turn: i64,
    pub aim_focus_restore: i64,
    pub brace_focus_restore: i64,
    pub observe_focus_restore: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct UrbanHealingDecision {
    pub source: UrbanHealingSource,
    pub allowed: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UrbanOwnerTurnRecovery {
    pub combatant_id: String,
    pub stamina_before: i64,
    pub stamina_after: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UrbanTacticalRecovery {
    pub combatant_id: String,
    pub action: UrbanTacticalAction,
    pub focus_before: i64,
    pub focus_after: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UrbanRuleErrorCode {
    InvalidBalance,
    InvalidPhase,
    ActiveCombatantMissing,
    CombatantMissing,
    ResourceMissing,
    DuplicateResource,
    HealingSourceForbidden,
    RecoveryFailed,
    NumericOverflow,
    StateInvariantViolation,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UrbanRuleError {
    pub code: UrbanRuleErrorCode,
    pub subject_id: String,
}

impl fmt::Display for UrbanRuleError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "urban combat rule failed for {}: {:?}",
            self.subject_id, self.code
        )
    }
}

impl Error for UrbanRuleError {}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UrbanProfile {
    resolved: WorldCombatProfile,
    sub_profile: UrbanSubProfile,
}

impl UrbanProfile {
    pub fn resolve(
        channel_catalog: &DamageChannelCatalog,
        sub_profile: UrbanSubProfile,
    ) -> Result<Self, WorldProfileError> {
        Ok(Self {
            resolved: resolve_single_definition(
                definition(sub_profile),
                &modules(),
                channel_catalog,
            )?,
            sub_profile,
        })
    }

    #[must_use]
    pub const fn profile(&self) -> &WorldCombatProfile {
        &self.resolved
    }

    #[must_use]
    pub const fn sub_profile(&self) -> UrbanSubProfile {
        self.sub_profile
    }

    #[must_use]
    pub const fn healing_decision(source: UrbanHealingSource) -> UrbanHealingDecision {
        UrbanHealingDecision {
            source,
            allowed: matches!(
                source,
                UrbanHealingSource::FirstAid
                    | UrbanHealingSource::MedicalItem
                    | UrbanHealingSource::ExplicitAbility
                    | UrbanHealingSource::SoloRecovery
            ),
        }
    }

    pub fn commit_limited_heal<F: ReviveFollowupApplier>(
        &self,
        state: &mut CombatState,
        source: UrbanHealingSource,
        request: RecoveryEffectRequest,
        followups: &F,
    ) -> Result<RecoveryEffectCommit, UrbanRuleError> {
        if !Self::healing_decision(source).allowed {
            return Err(rule_error(
                UrbanRuleErrorCode::HealingSourceForbidden,
                "urban-healing-source",
            ));
        }
        RecoveryEffectProcessor::commit(state, request, followups).map_err(|error| {
            rule_error(
                UrbanRuleErrorCode::RecoveryFailed,
                format!("{}:{:?}", error.subject, error.code),
            )
        })
    }

    pub fn apply_normal_owner_turn_start(
        &self,
        state: &mut CombatState,
        balance: UrbanBalanceConfig,
    ) -> Result<UrbanOwnerTurnRecovery, UrbanRuleError> {
        validate_balance(balance)?;
        validate_state(state)?;
        if state.phase != CombatPhase::OwnerTurnStart {
            return Err(rule_error(
                UrbanRuleErrorCode::InvalidPhase,
                "normal-owner-turn-start",
            ));
        }
        let combatant_id = active_combatant_id(state)?;
        let mut working = state.clone();
        let combatant = combatant_mut(&mut working, &combatant_id)?;
        let (stamina_before, stamina_after) = restore_resource(
            &mut combatant.resources,
            STAMINA_ID,
            balance.stamina_restore_per_normal_owner_turn,
        )?;
        bump_and_commit(state, working)?;
        Ok(UrbanOwnerTurnRecovery {
            combatant_id,
            stamina_before,
            stamina_after,
        })
    }

    pub fn apply_tactical_focus_recovery(
        &self,
        state: &mut CombatState,
        action: UrbanTacticalAction,
        balance: UrbanBalanceConfig,
    ) -> Result<UrbanTacticalRecovery, UrbanRuleError> {
        validate_balance(balance)?;
        validate_state(state)?;
        if state.phase != CombatPhase::Action {
            return Err(rule_error(
                UrbanRuleErrorCode::InvalidPhase,
                "tactical-action",
            ));
        }
        let combatant_id = active_combatant_id(state)?;
        let amount = match action {
            UrbanTacticalAction::Aim => balance.aim_focus_restore,
            UrbanTacticalAction::Brace => balance.brace_focus_restore,
            UrbanTacticalAction::Observe => balance.observe_focus_restore,
        };
        let mut working = state.clone();
        let combatant = combatant_mut(&mut working, &combatant_id)?;
        let (focus_before, focus_after) =
            restore_resource(&mut combatant.resources, FOCUS_ID, amount)?;
        bump_and_commit(state, working)?;
        Ok(UrbanTacticalRecovery {
            combatant_id,
            action,
            focus_before,
            focus_after,
        })
    }
}

pub(crate) fn definition(sub_profile: UrbanSubProfile) -> WorldCombatProfileDefinition {
    let mut mappings = vec![
        ("physical", PrimaryMitigation::Armor),
        ("ballistic", PrimaryMitigation::Armor),
    ];
    let mut selected_rule_module_ids = vec![];
    match sub_profile {
        UrbanSubProfile::Base => {}
        UrbanSubProfile::Firearm => selected_rule_module_ids.push(FIREARM_MODULE_ID.into()),
        UrbanSubProfile::Melee => selected_rule_module_ids.push(MELEE_MODULE_ID.into()),
        UrbanSubProfile::Psychic => {
            mappings.push(("psychic", PrimaryMitigation::Resistance));
            selected_rule_module_ids.push(PSYCHIC_MODULE_ID.into());
        }
        UrbanSubProfile::Occult => {
            mappings.push(("occult", PrimaryMitigation::Resistance));
            selected_rule_module_ids.push(OCCULT_MODULE_ID.into());
        }
    }
    WorldCombatProfileDefinition {
        world_type: WorldType::Urban,
        world_profile_version: CURRENT_COMBAT_VERSIONS.world_profile_version,
        resource_lifecycle: ResourceLifecycle {
            policy_id: "urban.resource-lifecycle.v0_4_1".into(),
            resources: vec![
                lifecycle(
                    HEALTH_ID,
                    ResourceStorage::HitPoints,
                    NormalOwnerTurnResourcePolicy::NoAutomaticChange,
                ),
                lifecycle(
                    STAMINA_ID,
                    ResourceStorage::ResourcePool,
                    NormalOwnerTurnResourcePolicy::RestoreFromBalance,
                ),
                lifecycle(
                    FOCUS_ID,
                    ResourceStorage::ResourcePool,
                    NormalOwnerTurnResourcePolicy::NoAutomaticChange,
                ),
            ],
        },
        defense_behavior: DefenseBehavior {
            policy_id: "urban.armor-and-subprofile-resistance.v0_4_1".into(),
            allowed_damage_channels: mappings.iter().map(|(id, _)| channel(id)).collect(),
            primary_mitigation_by_channel: mappings
                .into_iter()
                .map(|(id, primary_mitigation)| ChannelMitigationRule {
                    channel_id: channel(id),
                    primary_mitigation,
                })
                .collect(),
        },
        recovery_rules: RecoveryRules {
            policy_id: "urban.explicit-limited-healing.v0_4_1".into(),
        },
        signature_mechanic: SignatureMechanic {
            mechanic_id: "urban.focus-management-limited-healing.v0_4_1".into(),
        },
        selected_rule_module_ids,
    }
}

pub(crate) fn modules() -> Vec<DeveloperRuleModule> {
    [
        FIREARM_MODULE_ID,
        MELEE_MODULE_ID,
        PSYCHIC_MODULE_ID,
        OCCULT_MODULE_ID,
    ]
    .into_iter()
    .map(|module_id| DeveloperRuleModule {
        module_id: module_id.into(),
        module_version: CURRENT_COMBAT_VERSIONS.world_profile_version,
        supported_world_types: vec![WorldType::Urban],
        facets: vec![WorldRuleFacet::SignatureMechanic],
    })
    .collect()
}

fn lifecycle(
    id: &str,
    storage: ResourceStorage,
    policy: NormalOwnerTurnResourcePolicy,
) -> ResourceLifecycleRule {
    ResourceLifecycleRule {
        resource_id: id.into(),
        storage,
        normal_owner_turn_start: policy,
    }
}

fn validate_balance(balance: UrbanBalanceConfig) -> Result<(), UrbanRuleError> {
    if balance.stamina_restore_per_normal_owner_turn <= 0
        || balance.aim_focus_restore <= 0
        || balance.brace_focus_restore <= 0
        || balance.observe_focus_restore <= 0
    {
        return Err(rule_error(
            UrbanRuleErrorCode::InvalidBalance,
            "urban-balance",
        ));
    }
    Ok(())
}

fn validate_state(state: &CombatState) -> Result<(), UrbanRuleError> {
    state
        .validate_for_commit()
        .map_err(|_| rule_error(UrbanRuleErrorCode::StateInvariantViolation, "state"))
}

fn active_combatant_id(state: &CombatState) -> Result<String, UrbanRuleError> {
    state.round.active_combatant_id.clone().ok_or_else(|| {
        rule_error(
            UrbanRuleErrorCode::ActiveCombatantMissing,
            "active-combatant",
        )
    })
}

fn combatant_mut<'a>(
    state: &'a mut CombatState,
    combatant_id: &str,
) -> Result<&'a mut crate::CombatantRuntime, UrbanRuleError> {
    state
        .combatants
        .iter_mut()
        .find(|combatant| combatant.combatant_id == combatant_id)
        .ok_or_else(|| rule_error(UrbanRuleErrorCode::CombatantMissing, combatant_id))
}

fn restore_resource(
    resources: &mut [ResourceState],
    id: &str,
    amount: i64,
) -> Result<(i64, i64), UrbanRuleError> {
    let indices: Vec<_> = resources
        .iter()
        .enumerate()
        .filter(|(_, resource)| resource.resource_id == id)
        .map(|(index, _)| index)
        .collect();
    let [index] = indices.as_slice() else {
        return Err(rule_error(
            if indices.is_empty() {
                UrbanRuleErrorCode::ResourceMissing
            } else {
                UrbanRuleErrorCode::DuplicateResource
            },
            id,
        ));
    };
    let resource = &mut resources[*index];
    let before = resource.current;
    resource.current = resource
        .current
        .checked_add(amount)
        .ok_or_else(|| rule_error(UrbanRuleErrorCode::NumericOverflow, id))?
        .min(resource.max_value);
    Ok((before, resource.current))
}

fn bump_and_commit(
    state: &mut CombatState,
    mut working: CombatState,
) -> Result<(), UrbanRuleError> {
    working.revision = working
        .revision
        .checked_add(1)
        .ok_or_else(|| rule_error(UrbanRuleErrorCode::NumericOverflow, "state-revision"))?;
    validate_state(&working)?;
    *state = working;
    Ok(())
}

fn channel(id: &str) -> DamageChannelId {
    DamageChannelId::new(id).expect("Urban channels are developer-owned stable constants")
}

fn rule_error(code: UrbanRuleErrorCode, subject_id: impl Into<String>) -> UrbanRuleError {
    UrbanRuleError {
        code,
        subject_id: subject_id.into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        CombatRng, CombatSide, CombatantRuntime, CombatantState, DamageDefenseProfile,
        HardCcDrRuntime, NoReviveFollowups, ObjectiveRuntimeState, ProvisionalRuntimeDelta,
        ReinforcementRuntimeState, ResolvedEffect, RoundRosterEntry, RoundRosterStatus,
        RoundRuntimeState, ShieldRechargeRuntime, TimelineEntry,
    };

    const SEED: &str = "0123456789abcdef0123456789abcdef";

    #[test]
    fn base_profile_has_no_shield_or_optional_channels() {
        let urban = profile(UrbanSubProfile::Base);
        let resolved = urban.profile();
        assert_eq!(resolved.world_type(), WorldType::Urban);
        assert_eq!(
            resolved
                .resource_lifecycle()
                .resources
                .iter()
                .map(|rule| (rule.resource_id.as_str(), rule.normal_owner_turn_start))
                .collect::<Vec<_>>(),
            vec![
                (FOCUS_ID, NormalOwnerTurnResourcePolicy::NoAutomaticChange),
                (HEALTH_ID, NormalOwnerTurnResourcePolicy::NoAutomaticChange),
                (
                    STAMINA_ID,
                    NormalOwnerTurnResourcePolicy::RestoreFromBalance,
                ),
            ]
        );
        assert!(
            resolved
                .resource_lifecycle()
                .resources
                .iter()
                .all(|rule| rule.storage != ResourceStorage::Shield)
        );
        assert_eq!(
            resolved
                .defense_behavior()
                .allowed_damage_channels
                .iter()
                .map(DamageChannelId::as_str)
                .collect::<Vec<_>>(),
            vec!["ballistic", "physical"]
        );
        for id in ["ballistic", "physical"] {
            assert_eq!(
                resolved.primary_mitigation_for(&channel(id)),
                Some(PrimaryMitigation::Armor)
            );
        }
        assert_eq!(resolved.primary_mitigation_for(&channel("psychic")), None);
    }

    #[test]
    fn psychic_and_occult_channels_require_their_fixed_subprofile() {
        let psychic = profile(UrbanSubProfile::Psychic);
        let occult = profile(UrbanSubProfile::Occult);
        assert_eq!(
            psychic
                .profile()
                .defense_behavior()
                .allowed_damage_channels
                .iter()
                .map(DamageChannelId::as_str)
                .collect::<Vec<_>>(),
            vec!["ballistic", "physical", "psychic"]
        );
        assert_eq!(
            psychic
                .profile()
                .primary_mitigation_for(&channel("psychic")),
            Some(PrimaryMitigation::Resistance)
        );
        assert_eq!(
            occult.profile().primary_mitigation_for(&channel("occult")),
            Some(PrimaryMitigation::Resistance)
        );
        assert_eq!(
            occult.profile().primary_mitigation_for(&channel("psychic")),
            None
        );
        assert_eq!(
            psychic.profile().rule_modules()[0].module_id,
            PSYCHIC_MODULE_ID
        );
        assert_eq!(
            occult.profile().rule_modules()[0].module_id,
            OCCULT_MODULE_ID
        );
    }

    #[test]
    fn normal_owner_turn_restores_only_stamina_without_health_focus_or_shield() {
        let urban = profile(UrbanSubProfile::Base);
        let mut state = fixture_state(CombatPhase::OwnerTurnStart);
        state.combatants[0].hit_points = 12;
        state.combatants[0].shield = 0;
        resource_mut(&mut state, STAMINA_ID).current = 3;
        resource_mut(&mut state, FOCUS_ID).current = 2;
        let rng_before = state.rng.clone();

        let outcome = urban
            .apply_normal_owner_turn_start(&mut state, balance())
            .unwrap();
        assert_eq!((outcome.stamina_before, outcome.stamina_after), (3, 7));
        assert_eq!(state.combatants[0].hit_points, 12);
        assert_eq!(state.combatants[0].shield, 0);
        assert_eq!(resource(&state, FOCUS_ID).current, 2);
        assert_eq!(state.rng, rng_before);
    }

    #[test]
    fn aim_brace_and_observe_restore_focus_only_as_explicit_actions() {
        let urban = profile(UrbanSubProfile::Base);
        for (action, expected) in [
            (UrbanTacticalAction::Aim, 3),
            (UrbanTacticalAction::Brace, 4),
            (UrbanTacticalAction::Observe, 5),
        ] {
            let mut state = fixture_state(CombatPhase::Action);
            resource_mut(&mut state, FOCUS_ID).current = 1;
            resource_mut(&mut state, STAMINA_ID).current = 2;
            let outcome = urban
                .apply_tactical_focus_recovery(&mut state, action, balance())
                .unwrap();
            assert_eq!((outcome.focus_before, outcome.focus_after), (1, expected));
            assert_eq!(resource(&state, STAMINA_ID).current, 2);
            assert_eq!(state.combatants[0].hit_points, 20);
        }
    }

    #[test]
    fn limited_healing_rejects_passive_and_automatic_layer_recharge() {
        let urban = profile(UrbanSubProfile::Base);
        for source in [
            UrbanHealingSource::FirstAid,
            UrbanHealingSource::MedicalItem,
            UrbanHealingSource::ExplicitAbility,
            UrbanHealingSource::SoloRecovery,
        ] {
            assert!(UrbanProfile::healing_decision(source).allowed);
        }
        for source in [
            UrbanHealingSource::PassiveTurn,
            UrbanHealingSource::AutomaticLayerRecharge,
        ] {
            assert!(!UrbanProfile::healing_decision(source).allowed);
        }

        let mut state = fixture_state(CombatPhase::Action);
        state.combatants[0].hit_points = 10;
        let explicit = heal_request(4);
        urban
            .commit_limited_heal(
                &mut state,
                UrbanHealingSource::FirstAid,
                explicit,
                &NoReviveFollowups,
            )
            .unwrap();
        assert_eq!(state.combatants[0].hit_points, 14);

        let before = state.clone();
        assert_eq!(
            urban
                .commit_limited_heal(
                    &mut state,
                    UrbanHealingSource::PassiveTurn,
                    heal_request(4),
                    &NoReviveFollowups,
                )
                .unwrap_err()
                .code,
            UrbanRuleErrorCode::HealingSourceForbidden
        );
        assert_eq!(state, before);
    }

    #[test]
    fn wrong_phase_and_malformed_balance_or_resource_fail_atomically() {
        let urban = profile(UrbanSubProfile::Base);
        let mut extra = fixture_state(CombatPhase::ExtraTurn);
        let before = extra.clone();
        assert_eq!(
            urban
                .apply_normal_owner_turn_start(&mut extra, balance())
                .unwrap_err()
                .code,
            UrbanRuleErrorCode::InvalidPhase
        );
        assert_eq!(extra, before);

        let mut action = fixture_state(CombatPhase::Action);
        let before = action.clone();
        let mut invalid = balance();
        invalid.observe_focus_restore = 0;
        assert_eq!(
            urban
                .apply_tactical_focus_recovery(&mut action, UrbanTacticalAction::Observe, invalid,)
                .unwrap_err()
                .code,
            UrbanRuleErrorCode::InvalidBalance
        );
        assert_eq!(action, before);

        action.combatants[0]
            .resources
            .retain(|resource| resource.resource_id != FOCUS_ID);
        let before = action.clone();
        assert_eq!(
            urban
                .apply_tactical_focus_recovery(&mut action, UrbanTacticalAction::Aim, balance(),)
                .unwrap_err()
                .code,
            UrbanRuleErrorCode::ResourceMissing
        );
        assert_eq!(action, before);
    }

    fn profile(sub_profile: UrbanSubProfile) -> UrbanProfile {
        UrbanProfile::resolve(&DamageChannelCatalog::v0_4_1(), sub_profile).unwrap()
    }

    fn balance() -> UrbanBalanceConfig {
        UrbanBalanceConfig {
            stamina_restore_per_normal_owner_turn: 4,
            aim_focus_restore: 2,
            brace_focus_restore: 3,
            observe_focus_restore: 4,
        }
    }

    fn heal_request(amount: i64) -> RecoveryEffectRequest {
        RecoveryEffectRequest {
            target_combatant_id: "investigator".into(),
            source_combatant_id: Some("investigator".into()),
            source_command_id: Some("first-aid-command".into()),
            event_chain_id: "urban-healing-chain".into(),
            effect: ResolvedEffect::Heal { amount },
        }
    }

    fn resource<'a>(state: &'a CombatState, id: &str) -> &'a ResourceState {
        state.combatants[0]
            .resources
            .iter()
            .find(|resource| resource.resource_id == id)
            .unwrap()
    }

    fn resource_mut<'a>(state: &'a mut CombatState, id: &str) -> &'a mut ResourceState {
        state.combatants[0]
            .resources
            .iter_mut()
            .find(|resource| resource.resource_id == id)
            .unwrap()
    }

    fn fixture_state(phase: CombatPhase) -> CombatState {
        let is_extra = phase == CombatPhase::ExtraTurn;
        CombatState {
            combat_instance_id: "urban-scenario".into(),
            versions: CURRENT_COMBAT_VERSIONS,
            random_seed: SEED.into(),
            revision: 1,
            last_committed_sequence: 0,
            phase,
            combatants: vec![CombatantRuntime {
                combatant_id: "investigator".into(),
                definition_id: "urban-investigator".into(),
                side: CombatSide::Player,
                state: CombatantState::Active,
                hit_points: 20,
                max_hit_points: 20,
                shield: 0,
                max_shield: 0,
                action_points: 3,
                max_action_points: 3,
                reaction_charges: 1,
                max_reaction_charges: 1,
                resources: vec![pool(FOCUS_ID), pool(STAMINA_ID)],
                statuses: vec![],
                ability_usage: vec![],
                basic_attack_count_this_normal_owner_turn: 0,
                once_usage_counters: vec![],
                normal_owner_turn_index: 1,
                hard_cc_dr: HardCcDrRuntime::default(),
                shield_recharge: ShieldRechargeRuntime::default(),
                initiative_result: 10,
                initiative_base_stat: 2,
                last_committed_timeline_order: Some(0),
                solo_recovery_available: false,
            }],
            formal_party_member_ids: vec!["investigator".into()],
            combat_inventory: vec![],
            cost_reservations: vec![],
            resolution_context: None,
            timeline: vec![TimelineEntry {
                combatant_id: "investigator".into(),
                initiative_result: 10,
                initiative_base_stat: 2,
                is_extra_turn: false,
                source_sequence: 1,
            }],
            round: RoundRuntimeState {
                round_number: 1,
                completed_round_count: 0,
                active_combatant_id: Some("investigator".into()),
                extra_turn_resume_phase: is_extra.then_some(CombatPhase::OwnerTurnEnd),
                roster: vec![RoundRosterEntry {
                    combatant_id: "investigator".into(),
                    normal_turn_slot: 0,
                    status: RoundRosterStatus::Pending,
                }],
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
            result_candidates: vec![],
            terminal_priority_policy: crate::TerminalPriorityPolicy::default(),
            confirmed_result_candidate_id: None,
            confirmed_result: None,
            rng: CombatRng::new(
                SEED,
                "urban-scenario",
                CURRENT_COMBAT_VERSIONS.rng_contract_version,
            )
            .unwrap()
            .snapshot(),
        }
    }

    fn pool(id: &str) -> ResourceState {
        ResourceState {
            resource_id: id.into(),
            current: 10,
            min_value: 0,
            max_value: 10,
            overheat_threshold: None,
            hard_max_value: None,
        }
    }
}

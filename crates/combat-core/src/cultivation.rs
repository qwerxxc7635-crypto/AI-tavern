use std::{error::Error, fmt};

use crate::{
    CURRENT_COMBAT_VERSIONS, ChannelMitigationRule, CombatState, DamageChannelCatalog,
    DamageChannelId, DefenseBehavior, DeveloperRuleModule, NormalOwnerTurnResourcePolicy,
    OpposedTieRule, PrimaryMitigation, RecoveryRules, ResolutionRequest, ResourceLifecycle,
    ResourceLifecycleRule, ResourceState, ResourceStorage, SignatureMechanic, WorldCombatProfile,
    WorldCombatProfileDefinition, WorldProfileError, WorldRuleFacet, WorldType,
    world_profile::resolve_single_definition,
};

const HEALTH_ID: &str = "health";
const QI_ID: &str = "qi";
const SPIRIT_SENSE_ID: &str = "spirit_sense";
const QI_MODULE_ID: &str = "cultivation.qi-resource.v0_4_1";
const SOUL_MODULE_ID: &str = "cultivation.soul.v0_4_1";
const BODY_REFINING_MODULE_ID: &str = "cultivation.body-refining.v0_4_1";
const SWORD_CULTIVATION_MODULE_ID: &str = "cultivation.sword-cultivation.v0_4_1";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CultivationSubProfile {
    Base,
    BodyRefining,
    SwordCultivation,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CultivationBalanceConfig {
    pub spirit_sense_points_per_modifier: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CultivationSoulOpposedInput {
    pub attacker_id: String,
    pub defender_id: String,
    pub attacker_raw_roll: u8,
    pub defender_raw_roll: u8,
    pub tie_rule: OpposedTieRule,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CultivationRuleErrorCode {
    InvalidBalance,
    CombatantMissing,
    ResourceMissing,
    DuplicateResource,
    NumericOverflow,
    StateInvariantViolation,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CultivationRuleError {
    pub code: CultivationRuleErrorCode,
    pub subject_id: String,
}

impl fmt::Display for CultivationRuleError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "cultivation combat rule failed for {}: {:?}",
            self.subject_id, self.code
        )
    }
}

impl Error for CultivationRuleError {}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CultivationProfile {
    resolved: WorldCombatProfile,
    sub_profile: CultivationSubProfile,
}

impl CultivationProfile {
    pub fn resolve(
        channel_catalog: &DamageChannelCatalog,
        sub_profile: CultivationSubProfile,
    ) -> Result<Self, WorldProfileError> {
        let modules = modules();
        Ok(Self {
            resolved: resolve_single_definition(
                definition(sub_profile),
                &modules,
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
    pub const fn sub_profile(&self) -> CultivationSubProfile {
        self.sub_profile
    }

    /// Builds the canonical Mental save request with current Spirit Sense as defense.
    pub fn mental_saving_throw(
        &self,
        state: &CombatState,
        defender_id: &str,
        raw_roll: u8,
        base_save_modifier: i64,
        ability_dc: i64,
        balance: CultivationBalanceConfig,
    ) -> Result<ResolutionRequest, CultivationRuleError> {
        let spirit_modifier = spirit_sense_modifier(state, defender_id, balance)?;
        let defender_save_modifier = base_save_modifier
            .checked_add(spirit_modifier)
            .ok_or_else(|| rule_error(CultivationRuleErrorCode::NumericOverflow, defender_id))?;
        Ok(ResolutionRequest::SavingThrow {
            raw_roll,
            defender_save_modifier,
            ability_dc,
        })
    }

    /// Builds a Soul opposed check where both sides use their current Spirit Sense.
    pub fn soul_opposed_check(
        &self,
        state: &CombatState,
        input: CultivationSoulOpposedInput,
        balance: CultivationBalanceConfig,
    ) -> Result<ResolutionRequest, CultivationRuleError> {
        Ok(ResolutionRequest::OpposedCheck {
            attacker_raw_roll: input.attacker_raw_roll,
            attacker_modifier: spirit_sense_modifier(state, &input.attacker_id, balance)?,
            defender_raw_roll: input.defender_raw_roll,
            defender_modifier: spirit_sense_modifier(state, &input.defender_id, balance)?,
            tie_rule: input.tie_rule,
        })
    }
}

pub(crate) fn definition(sub_profile: CultivationSubProfile) -> WorldCombatProfileDefinition {
    let mut selected_rule_module_ids = vec![QI_MODULE_ID.into(), SOUL_MODULE_ID.into()];
    match sub_profile {
        CultivationSubProfile::Base => {}
        CultivationSubProfile::BodyRefining => {
            selected_rule_module_ids.push(BODY_REFINING_MODULE_ID.into());
        }
        CultivationSubProfile::SwordCultivation => {
            selected_rule_module_ids.push(SWORD_CULTIVATION_MODULE_ID.into());
        }
    }
    let mappings = [
        ("physical", PrimaryMitigation::Armor),
        ("qi", PrimaryMitigation::Resistance),
        ("soul", PrimaryMitigation::Resistance),
    ];
    WorldCombatProfileDefinition {
        world_type: WorldType::Cultivation,
        world_profile_version: CURRENT_COMBAT_VERSIONS.world_profile_version,
        resource_lifecycle: ResourceLifecycle {
            policy_id: "cultivation.resource-lifecycle.v0_4_1".into(),
            resources: vec![
                lifecycle(HEALTH_ID, ResourceStorage::HitPoints),
                lifecycle(QI_ID, ResourceStorage::ResourcePool),
                lifecycle(SPIRIT_SENSE_ID, ResourceStorage::ResourcePool),
            ],
        },
        defense_behavior: DefenseBehavior {
            policy_id: "cultivation.body-qi-soul-defense.v0_4_1".into(),
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
            policy_id: "cultivation.explicit-recovery.v0_4_1".into(),
        },
        signature_mechanic: SignatureMechanic {
            mechanic_id: "cultivation.qi-spirit-sense-offense-defense.v0_4_1".into(),
        },
        selected_rule_module_ids,
    }
}

pub(crate) fn modules() -> Vec<DeveloperRuleModule> {
    [
        (QI_MODULE_ID, vec![WorldRuleFacet::ResourceLifecycle]),
        (
            SOUL_MODULE_ID,
            vec![
                WorldRuleFacet::DefenseBehavior,
                WorldRuleFacet::SignatureMechanic,
            ],
        ),
        (
            BODY_REFINING_MODULE_ID,
            vec![WorldRuleFacet::SignatureMechanic],
        ),
        (
            SWORD_CULTIVATION_MODULE_ID,
            vec![WorldRuleFacet::SignatureMechanic],
        ),
    ]
    .into_iter()
    .map(|(module_id, facets)| DeveloperRuleModule {
        module_id: module_id.into(),
        module_version: CURRENT_COMBAT_VERSIONS.world_profile_version,
        supported_world_types: vec![WorldType::Cultivation],
        facets,
    })
    .collect()
}

fn lifecycle(id: &str, storage: ResourceStorage) -> ResourceLifecycleRule {
    ResourceLifecycleRule {
        resource_id: id.into(),
        storage,
        normal_owner_turn_start: NormalOwnerTurnResourcePolicy::NoAutomaticChange,
    }
}

fn spirit_sense_modifier(
    state: &CombatState,
    combatant_id: &str,
    balance: CultivationBalanceConfig,
) -> Result<i64, CultivationRuleError> {
    if balance.spirit_sense_points_per_modifier <= 0 {
        return Err(rule_error(
            CultivationRuleErrorCode::InvalidBalance,
            SPIRIT_SENSE_ID,
        ));
    }
    state
        .validate_for_commit()
        .map_err(|_| rule_error(CultivationRuleErrorCode::StateInvariantViolation, "state"))?;
    let combatant = state
        .combatants
        .iter()
        .find(|combatant| combatant.combatant_id == combatant_id)
        .ok_or_else(|| rule_error(CultivationRuleErrorCode::CombatantMissing, combatant_id))?;
    let resource = one_resource(&combatant.resources, SPIRIT_SENSE_ID)?;
    Ok(resource.current / balance.spirit_sense_points_per_modifier)
}

fn one_resource<'a>(
    resources: &'a [ResourceState],
    id: &str,
) -> Result<&'a ResourceState, CultivationRuleError> {
    let mut matches = resources
        .iter()
        .filter(|resource| resource.resource_id == id);
    let resource = matches
        .next()
        .ok_or_else(|| rule_error(CultivationRuleErrorCode::ResourceMissing, id))?;
    if matches.next().is_some() {
        return Err(rule_error(CultivationRuleErrorCode::DuplicateResource, id));
    }
    Ok(resource)
}

fn channel(id: &str) -> DamageChannelId {
    DamageChannelId::new(id).expect("Cultivation channels are developer-owned stable constants")
}

fn rule_error(
    code: CultivationRuleErrorCode,
    subject_id: impl Into<String>,
) -> CultivationRuleError {
    CultivationRuleError {
        code,
        subject_id: subject_id.into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        CombatCostAsset, CombatCostRequestLine, CombatPhase, CombatRng, CombatSide,
        CombatantRuntime, CombatantState, CostReservationModel, CostReservationRequest,
        DamageDefenseProfile, HardCcDrRuntime, ObjectiveRuntimeState, ProvisionalRuntimeDelta,
        ReinforcementRuntimeState, ResolutionResolver, RoundRuntimeState, ShieldRechargeRuntime,
    };

    const SEED: &str = "0123456789abcdef0123456789abcdef";

    #[test]
    fn resolved_profile_freezes_resources_channels_and_single_mitigation() {
        let cultivation = profile(CultivationSubProfile::Base);
        let resolved = cultivation.profile();
        assert_eq!(resolved.world_type(), WorldType::Cultivation);
        assert_eq!(
            resolved
                .resource_lifecycle()
                .resources
                .iter()
                .map(|rule| rule.resource_id.as_str())
                .collect::<Vec<_>>(),
            vec![HEALTH_ID, QI_ID, SPIRIT_SENSE_ID]
        );
        assert!(resolved.resource_lifecycle().resources.iter().all(|rule| {
            rule.normal_owner_turn_start == NormalOwnerTurnResourcePolicy::NoAutomaticChange
        }));
        assert_eq!(
            resolved
                .defense_behavior()
                .allowed_damage_channels
                .iter()
                .map(DamageChannelId::as_str)
                .collect::<Vec<_>>(),
            vec!["physical", "qi", "soul"]
        );
        assert_eq!(
            resolved.primary_mitigation_for(&channel("physical")),
            Some(PrimaryMitigation::Armor)
        );
        assert_eq!(
            resolved.primary_mitigation_for(&channel("qi")),
            Some(PrimaryMitigation::Resistance)
        );
        assert_eq!(
            resolved.primary_mitigation_for(&channel("soul")),
            Some(PrimaryMitigation::Resistance)
        );
    }

    #[test]
    fn developer_subprofiles_select_only_their_fixed_module() {
        let base = module_ids(&profile(CultivationSubProfile::Base));
        let body = module_ids(&profile(CultivationSubProfile::BodyRefining));
        let sword = module_ids(&profile(CultivationSubProfile::SwordCultivation));
        assert_eq!(base, vec![QI_MODULE_ID, SOUL_MODULE_ID]);
        assert_eq!(
            body,
            vec![BODY_REFINING_MODULE_ID, QI_MODULE_ID, SOUL_MODULE_ID]
        );
        assert_eq!(
            sword,
            vec![QI_MODULE_ID, SOUL_MODULE_ID, SWORD_CULTIVATION_MODULE_ID]
        );
    }

    #[test]
    fn spending_spirit_sense_changes_a_real_mental_save_outcome() {
        let cultivation = profile(CultivationSubProfile::Base);
        let mut state = fixture_state();
        let balance = CultivationBalanceConfig {
            spirit_sense_points_per_modifier: 2,
        };
        let before = cultivation
            .mental_saving_throw(&state, "defender", 9, 0, 12, balance)
            .unwrap();
        assert!(ResolutionResolver::resolve(before).unwrap().succeeded());

        spend(&mut state, "spirit-strike", "defender", SPIRIT_SENSE_ID, 4);
        let after = cultivation
            .mental_saving_throw(&state, "defender", 9, 0, 12, balance)
            .unwrap();
        assert!(!ResolutionResolver::resolve(after).unwrap().succeeded());
    }

    #[test]
    fn soul_opposed_check_uses_both_spirit_sense_values_but_not_qi() {
        let cultivation = profile(CultivationSubProfile::Base);
        let mut state = fixture_state();
        let balance = CultivationBalanceConfig {
            spirit_sense_points_per_modifier: 2,
        };
        spend(&mut state, "qi-technique", "attacker", QI_ID, 5);
        let before = cultivation
            .soul_opposed_check(&state, opposed_input(), balance)
            .unwrap();
        assert!(!ResolutionResolver::resolve(before).unwrap().succeeded());

        spend(
            &mut state,
            "defensive-spirit-cost",
            "defender",
            SPIRIT_SENSE_ID,
            4,
        );
        let after = cultivation
            .soul_opposed_check(&state, opposed_input(), balance)
            .unwrap();
        assert!(ResolutionResolver::resolve(after).unwrap().succeeded());
    }

    #[test]
    fn invalid_balance_missing_or_duplicate_spirit_sense_fail_closed() {
        let cultivation = profile(CultivationSubProfile::Base);
        let mut state = fixture_state();
        assert_eq!(
            cultivation
                .mental_saving_throw(
                    &state,
                    "defender",
                    10,
                    0,
                    12,
                    CultivationBalanceConfig {
                        spirit_sense_points_per_modifier: 0,
                    },
                )
                .unwrap_err()
                .code,
            CultivationRuleErrorCode::InvalidBalance
        );

        state.combatants[1]
            .resources
            .retain(|resource| resource.resource_id != SPIRIT_SENSE_ID);
        assert_eq!(
            cultivation
                .mental_saving_throw(
                    &state,
                    "defender",
                    10,
                    0,
                    12,
                    CultivationBalanceConfig {
                        spirit_sense_points_per_modifier: 2,
                    },
                )
                .unwrap_err()
                .code,
            CultivationRuleErrorCode::ResourceMissing
        );

        let mut duplicate = fixture_state();
        duplicate.combatants[1]
            .resources
            .push(pool(SPIRIT_SENSE_ID, 4));
        assert_eq!(
            cultivation
                .mental_saving_throw(
                    &duplicate,
                    "defender",
                    10,
                    0,
                    12,
                    CultivationBalanceConfig {
                        spirit_sense_points_per_modifier: 2,
                    },
                )
                .unwrap_err()
                .code,
            CultivationRuleErrorCode::DuplicateResource
        );
    }

    fn profile(sub_profile: CultivationSubProfile) -> CultivationProfile {
        CultivationProfile::resolve(&DamageChannelCatalog::v0_4_1(), sub_profile).unwrap()
    }

    fn opposed_input() -> CultivationSoulOpposedInput {
        CultivationSoulOpposedInput {
            attacker_id: "attacker".into(),
            defender_id: "defender".into(),
            attacker_raw_roll: 10,
            defender_raw_roll: 10,
            tie_rule: OpposedTieRule::DefenderWins,
        }
    }

    fn module_ids(profile: &CultivationProfile) -> Vec<String> {
        profile
            .profile()
            .rule_modules()
            .iter()
            .map(|module| module.module_id.clone())
            .collect()
    }

    fn spend(
        state: &mut CombatState,
        id: &str,
        combatant_id: &str,
        resource_id: &str,
        amount: i64,
    ) {
        CostReservationModel::reserve(
            state,
            CostReservationRequest {
                reservation_id: format!("reservation-{id}"),
                command_id: format!("command-{id}"),
                parent_reservation_id: None,
                costs: vec![CombatCostRequestLine {
                    cost_id: format!("cost-{id}"),
                    asset: CombatCostAsset::Resource {
                        combatant_id: combatant_id.into(),
                        resource_id: resource_id.into(),
                    },
                    amount,
                    consume_cost_on_interrupt: false,
                }],
            },
        )
        .unwrap();
        CostReservationModel::commit(state, &format!("reservation-{id}")).unwrap();
    }

    fn fixture_state() -> CombatState {
        CombatState {
            combat_instance_id: "cultivation-scenario".into(),
            versions: CURRENT_COMBAT_VERSIONS,
            random_seed: SEED.into(),
            revision: 1,
            last_committed_sequence: 0,
            phase: CombatPhase::Stable,
            combatants: vec![combatant("attacker"), combatant("defender")],
            formal_party_member_ids: vec!["attacker".into(), "defender".into()],
            combat_inventory: vec![],
            cost_reservations: vec![],
            resolution_context: None,
            timeline: vec![],
            round: RoundRuntimeState {
                round_number: 0,
                completed_round_count: 0,
                active_combatant_id: None,
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
            enemy_intents: vec![],
            result_candidates: vec![],
            terminal_priority_policy: crate::TerminalPriorityPolicy::default(),
            confirmed_result_candidate_id: None,
            confirmed_result: None,
            rng: CombatRng::new(
                SEED,
                "cultivation-scenario",
                CURRENT_COMBAT_VERSIONS.rng_contract_version,
            )
            .unwrap()
            .snapshot(),
        }
    }

    fn combatant(id: &str) -> CombatantRuntime {
        CombatantRuntime {
            combatant_id: id.into(),
            definition_id: format!("cultivation-{id}"),
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
            resources: vec![pool(QI_ID, 10), pool(SPIRIT_SENSE_ID, 6)],
            statuses: vec![],
            ability_usage: vec![],
            basic_attack_count_this_normal_owner_turn: 0,
            once_usage_counters: vec![],
            normal_owner_turn_index: 0,
            hard_cc_dr: HardCcDrRuntime::default(),
            shield_recharge: ShieldRechargeRuntime::default(),
            initiative_result: 10,
            initiative_base_stat: 2,
            last_committed_timeline_order: None,
            solo_recovery_available: false,
        }
    }

    fn pool(id: &str, current: i64) -> ResourceState {
        ResourceState {
            resource_id: id.into(),
            current,
            min_value: 0,
            max_value: 10,
            overheat_threshold: None,
            hard_max_value: None,
        }
    }
}

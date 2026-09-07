use std::{error::Error, fmt};

use crate::{
    CURRENT_COMBAT_VERSIONS, ChannelMitigationRule, CombatPhase, CombatState, DamageChannelCatalog,
    DamageChannelId, DefenseBehavior, NormalOwnerTurnResourcePolicy, PrimaryMitigation,
    RecoveryRules, ResourceLifecycle, ResourceLifecycleRule, ResourceStorage, SignatureMechanic,
    WorldCombatProfile, WorldCombatProfileDefinition, WorldProfileError, WorldType,
    world_profile::resolve_single_definition,
};

const HP_ID: &str = "hp";
const MANA_ID: &str = "mana";
const STAMINA_ID: &str = "stamina";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FantasyBalanceConfig {
    pub stamina_restore_per_normal_owner_turn: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FantasyOwnerTurnRecovery {
    pub combatant_id: String,
    pub stamina_before: i64,
    pub stamina_after: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FantasyRuleErrorCode {
    InvalidBalance,
    InvalidPhase,
    ActiveCombatantMissing,
    CombatantMissing,
    ResourceMissing,
    DuplicateResource,
    NumericOverflow,
    StateInvariantViolation,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FantasyRuleError {
    pub code: FantasyRuleErrorCode,
    pub subject_id: String,
}

impl fmt::Display for FantasyRuleError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "fantasy combat rule failed for {}: {:?}",
            self.subject_id, self.code
        )
    }
}

impl Error for FantasyRuleError {}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FantasyProfile {
    resolved: WorldCombatProfile,
}

impl FantasyProfile {
    pub fn resolve(channel_catalog: &DamageChannelCatalog) -> Result<Self, WorldProfileError> {
        Ok(Self {
            resolved: resolve_single_definition(definition(), &[], channel_catalog)?,
        })
    }

    #[must_use]
    pub const fn profile(&self) -> &WorldCombatProfile {
        &self.resolved
    }

    /// Applies the Fantasy normal-owner-turn resource rule atomically.
    /// Mana and HP are intentionally absent from the mutation path.
    pub fn apply_normal_owner_turn_start(
        &self,
        state: &mut CombatState,
        balance: FantasyBalanceConfig,
    ) -> Result<FantasyOwnerTurnRecovery, FantasyRuleError> {
        if balance.stamina_restore_per_normal_owner_turn <= 0 {
            return Err(rule_error(FantasyRuleErrorCode::InvalidBalance, STAMINA_ID));
        }
        state
            .validate_for_commit()
            .map_err(|_| rule_error(FantasyRuleErrorCode::StateInvariantViolation, "state"))?;
        if state.phase != CombatPhase::OwnerTurnStart {
            return Err(rule_error(
                FantasyRuleErrorCode::InvalidPhase,
                "normal-owner-turn-start",
            ));
        }
        let combatant_id = state.round.active_combatant_id.clone().ok_or_else(|| {
            rule_error(
                FantasyRuleErrorCode::ActiveCombatantMissing,
                "active-combatant",
            )
        })?;

        let mut working = state.clone();
        let combatant = working
            .combatants
            .iter_mut()
            .find(|combatant| combatant.combatant_id == combatant_id)
            .ok_or_else(|| rule_error(FantasyRuleErrorCode::CombatantMissing, &combatant_id))?;
        let mut matching = combatant
            .resources
            .iter_mut()
            .filter(|resource| resource.resource_id == STAMINA_ID);
        let stamina = matching
            .next()
            .ok_or_else(|| rule_error(FantasyRuleErrorCode::ResourceMissing, STAMINA_ID))?;
        if matching.next().is_some() {
            return Err(rule_error(
                FantasyRuleErrorCode::DuplicateResource,
                STAMINA_ID,
            ));
        }
        let stamina_before = stamina.current;
        stamina.current = stamina
            .current
            .checked_add(balance.stamina_restore_per_normal_owner_turn)
            .ok_or_else(|| rule_error(FantasyRuleErrorCode::NumericOverflow, STAMINA_ID))?
            .min(stamina.max_value);
        let stamina_after = stamina.current;
        working.revision = working
            .revision
            .checked_add(1)
            .ok_or_else(|| rule_error(FantasyRuleErrorCode::NumericOverflow, "state-revision"))?;
        working
            .validate_for_commit()
            .map_err(|_| rule_error(FantasyRuleErrorCode::StateInvariantViolation, "state"))?;
        *state = working;

        Ok(FantasyOwnerTurnRecovery {
            combatant_id,
            stamina_before,
            stamina_after,
        })
    }
}

fn definition() -> WorldCombatProfileDefinition {
    let channel_mappings = [
        ("physical", PrimaryMitigation::Armor),
        ("fire", PrimaryMitigation::Resistance),
        ("ice", PrimaryMitigation::Resistance),
        ("lightning", PrimaryMitigation::Resistance),
        ("arcane", PrimaryMitigation::Resistance),
    ];
    WorldCombatProfileDefinition {
        world_type: WorldType::Fantasy,
        world_profile_version: CURRENT_COMBAT_VERSIONS.world_profile_version,
        resource_lifecycle: ResourceLifecycle {
            policy_id: "fantasy.resource-lifecycle.v0_4_1".into(),
            resources: vec![
                ResourceLifecycleRule {
                    resource_id: HP_ID.into(),
                    storage: ResourceStorage::HitPoints,
                    normal_owner_turn_start: NormalOwnerTurnResourcePolicy::NoAutomaticChange,
                },
                ResourceLifecycleRule {
                    resource_id: MANA_ID.into(),
                    storage: ResourceStorage::ResourcePool,
                    normal_owner_turn_start: NormalOwnerTurnResourcePolicy::NoAutomaticChange,
                },
                ResourceLifecycleRule {
                    resource_id: STAMINA_ID.into(),
                    storage: ResourceStorage::ResourcePool,
                    normal_owner_turn_start: NormalOwnerTurnResourcePolicy::RestoreFromBalance,
                },
            ],
        },
        defense_behavior: DefenseBehavior {
            policy_id: "fantasy.defense.v0_4_1".into(),
            allowed_damage_channels: channel_mappings.iter().map(|(id, _)| channel(id)).collect(),
            primary_mitigation_by_channel: channel_mappings
                .into_iter()
                .map(|(id, primary_mitigation)| ChannelMitigationRule {
                    channel_id: channel(id),
                    primary_mitigation,
                })
                .collect(),
        },
        recovery_rules: RecoveryRules {
            policy_id: "fantasy.explicit-recovery.v0_4_1".into(),
        },
        signature_mechanic: SignatureMechanic {
            mechanic_id: "fantasy.mana-stamina-element-loop.v0_4_1".into(),
        },
        selected_rule_module_ids: vec![],
    }
}

fn channel(id: &str) -> DamageChannelId {
    DamageChannelId::new(id).expect("Fantasy channels are developer-owned stable constants")
}

fn rule_error(code: FantasyRuleErrorCode, subject_id: impl Into<String>) -> FantasyRuleError {
    FantasyRuleError {
        code,
        subject_id: subject_id.into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        CombatCostAsset, CombatCostRequestLine, CombatRng, CombatSide, CombatantRuntime,
        CombatantState, CostReservationModel, CostReservationRequest, HardCcDrRuntime,
        ObjectiveRuntimeState, ProvisionalRuntimeDelta, ReinforcementRuntimeState, ResourceState,
        RoundRosterEntry, RoundRosterStatus, RoundRuntimeState, TimelineEntry,
    };

    const SEED: &str = "0123456789abcdef0123456789abcdef";

    #[test]
    fn resolved_profile_freezes_fantasy_resources_channels_and_mitigation() {
        let fantasy = FantasyProfile::resolve(&DamageChannelCatalog::v0_4_1()).unwrap();
        let profile = fantasy.profile();
        assert_eq!(profile.world_type(), WorldType::Fantasy);
        assert_eq!(
            profile
                .resource_lifecycle()
                .resources
                .iter()
                .map(|rule| (rule.resource_id.as_str(), rule.normal_owner_turn_start))
                .collect::<Vec<_>>(),
            vec![
                (HP_ID, NormalOwnerTurnResourcePolicy::NoAutomaticChange),
                (MANA_ID, NormalOwnerTurnResourcePolicy::NoAutomaticChange),
                (
                    STAMINA_ID,
                    NormalOwnerTurnResourcePolicy::RestoreFromBalance
                ),
            ]
        );
        assert_eq!(
            profile
                .defense_behavior()
                .allowed_damage_channels
                .iter()
                .map(DamageChannelId::as_str)
                .collect::<Vec<_>>(),
            vec!["arcane", "fire", "ice", "lightning", "physical"]
        );
        for id in ["arcane", "fire", "ice", "lightning"] {
            assert_eq!(
                crate::DamageDefenseProfile::primary_mitigation_for(profile, &channel(id)),
                Some(PrimaryMitigation::Resistance)
            );
        }
        assert_eq!(
            crate::DamageDefenseProfile::primary_mitigation_for(profile, &channel("physical")),
            Some(PrimaryMitigation::Armor)
        );
    }

    #[test]
    fn normal_owner_turn_restores_only_stamina_and_caps_at_maximum() {
        let fantasy = rules();
        let mut state = owner_turn_state();
        state.combatants[0].hit_points = 7;
        resource_mut(&mut state, MANA_ID).current = 3;
        resource_mut(&mut state, STAMINA_ID).current = 8;
        let rng_before = state.rng.clone();

        let outcome = fantasy
            .apply_normal_owner_turn_start(
                &mut state,
                FantasyBalanceConfig {
                    stamina_restore_per_normal_owner_turn: 5,
                },
            )
            .unwrap();

        assert_eq!(outcome.stamina_before, 8);
        assert_eq!(outcome.stamina_after, 10);
        assert_eq!(state.combatants[0].hit_points, 7);
        assert_eq!(resource(&state, MANA_ID).current, 3);
        assert_eq!(resource(&state, STAMINA_ID).current, 10);
        assert_eq!(state.rng, rng_before);
    }

    #[test]
    fn real_cost_commits_produce_a_mana_stamina_dual_loop() {
        let fantasy = rules();
        let mut state = owner_turn_state();
        spend(&mut state, "spell", MANA_ID, 4);
        spend(&mut state, "martial", STAMINA_ID, 6);
        assert_eq!(resource(&state, MANA_ID).current, 6);
        assert_eq!(resource(&state, STAMINA_ID).current, 4);

        fantasy
            .apply_normal_owner_turn_start(
                &mut state,
                FantasyBalanceConfig {
                    stamina_restore_per_normal_owner_turn: 3,
                },
            )
            .unwrap();

        assert_eq!(resource(&state, MANA_ID).current, 6);
        assert_eq!(resource(&state, STAMINA_ID).current, 7);
    }

    #[test]
    fn extra_turn_never_receives_normal_turn_stamina_recovery() {
        let fantasy = rules();
        let mut state = owner_turn_state();
        state.phase = CombatPhase::ExtraTurn;
        state.round.extra_turn_resume_phase = Some(CombatPhase::OwnerTurnEnd);
        let before = state.clone();
        let error = fantasy
            .apply_normal_owner_turn_start(
                &mut state,
                FantasyBalanceConfig {
                    stamina_restore_per_normal_owner_turn: 3,
                },
            )
            .unwrap_err();
        assert_eq!(error.code, FantasyRuleErrorCode::InvalidPhase);
        assert_eq!(state, before);
    }

    #[test]
    fn malformed_balance_or_resource_fails_atomically() {
        let fantasy = rules();
        let mut state = owner_turn_state();
        let before = state.clone();
        assert_eq!(
            fantasy
                .apply_normal_owner_turn_start(
                    &mut state,
                    FantasyBalanceConfig {
                        stamina_restore_per_normal_owner_turn: 0,
                    },
                )
                .unwrap_err()
                .code,
            FantasyRuleErrorCode::InvalidBalance
        );
        assert_eq!(state, before);

        state.combatants[0]
            .resources
            .retain(|resource| resource.resource_id != STAMINA_ID);
        let before = state.clone();
        assert_eq!(
            fantasy
                .apply_normal_owner_turn_start(
                    &mut state,
                    FantasyBalanceConfig {
                        stamina_restore_per_normal_owner_turn: 3,
                    },
                )
                .unwrap_err()
                .code,
            FantasyRuleErrorCode::ResourceMissing
        );
        assert_eq!(state, before);
    }

    fn rules() -> FantasyProfile {
        FantasyProfile::resolve(&DamageChannelCatalog::v0_4_1()).unwrap()
    }

    fn spend(state: &mut CombatState, id: &str, resource_id: &str, amount: i64) {
        let request = CostReservationRequest {
            reservation_id: format!("reservation-{id}"),
            command_id: format!("command-{id}"),
            parent_reservation_id: None,
            costs: vec![CombatCostRequestLine {
                cost_id: format!("cost-{id}"),
                asset: CombatCostAsset::Resource {
                    combatant_id: "hero".into(),
                    resource_id: resource_id.into(),
                },
                amount,
                consume_cost_on_interrupt: false,
            }],
        };
        CostReservationModel::reserve(state, request).unwrap();
        CostReservationModel::commit(state, &format!("reservation-{id}")).unwrap();
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

    fn owner_turn_state() -> CombatState {
        let combatant = CombatantRuntime {
            combatant_id: "hero".into(),
            definition_id: "fantasy-hero".into(),
            side: CombatSide::Player,
            state: CombatantState::Active,
            hit_points: 10,
            max_hit_points: 10,
            shield: 0,
            max_shield: 0,
            action_points: 3,
            max_action_points: 3,
            reaction_charges: 1,
            max_reaction_charges: 1,
            resources: vec![pool(MANA_ID), pool(STAMINA_ID)],
            statuses: vec![],
            ability_usage: vec![],
            basic_attack_count_this_normal_owner_turn: 0,
            once_usage_counters: vec![],
            normal_owner_turn_index: 1,
            hard_cc_dr: HardCcDrRuntime::default(),
            shield_recharge: crate::ShieldRechargeRuntime::default(),
            initiative_result: 10,
            initiative_base_stat: 2,
            last_committed_timeline_order: Some(0),
            solo_recovery_available: false,
        };
        CombatState {
            combat_instance_id: "fantasy-scenario".into(),
            versions: CURRENT_COMBAT_VERSIONS,
            random_seed: SEED.into(),
            revision: 1,
            last_committed_sequence: 0,
            phase: CombatPhase::OwnerTurnStart,
            combatants: vec![combatant],
            formal_party_member_ids: vec!["hero".into()],
            combat_inventory: vec![],
            cost_reservations: vec![],
            resolution_context: None,
            timeline: vec![TimelineEntry {
                combatant_id: "hero".into(),
                initiative_result: 10,
                initiative_base_stat: 2,
                is_extra_turn: false,
                source_sequence: 1,
            }],
            round: RoundRuntimeState {
                round_number: 1,
                completed_round_count: 0,
                active_combatant_id: Some("hero".into()),
                extra_turn_resume_phase: None,
                roster: vec![RoundRosterEntry {
                    combatant_id: "hero".into(),
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
                "fantasy-scenario",
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

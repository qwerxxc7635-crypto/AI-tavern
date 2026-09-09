use std::{error::Error, fmt};

use crate::{
    CURRENT_COMBAT_VERSIONS, ChannelMitigationRule, CombatPhase, CombatState, CommittedDamageEvent,
    DamageChannelCatalog, DamageChannelId, DamageSourceRelation, DefenseBehavior,
    NormalOwnerTurnResourcePolicy, PrimaryMitigation, RechargeInterruptionDecision,
    RechargeInterruptionPolicy, RecoveryRules, ResourceLifecycle, ResourceLifecycleRule,
    ResourceState, ResourceStorage, SignatureMechanic, WorldCombatProfile,
    WorldCombatProfileDefinition, WorldProfileError, WorldType,
    world_profile::resolve_single_definition,
};

const HEALTH_ID: &str = "health";
const SHIELD_ID: &str = "shield";
const ENERGY_ID: &str = "energy";
const HEAT_ID: &str = "heat";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SciFiBalanceConfig {
    pub energy_restore_per_normal_owner_turn: i64,
    pub heat_cooling_per_normal_owner_turn: i64,
    pub shield_recharge_delay_rounds: u32,
    pub shield_recharge_amount: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SciFiAbilityHeatClass {
    Standard,
    OverheatRestricted,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SciFiHeatDecision {
    pub combatant_id: String,
    pub heat_current: i64,
    pub overheat_threshold: i64,
    pub allowed: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SciFiOwnerTurnRecovery {
    pub combatant_id: String,
    pub energy_before: i64,
    pub energy_after: i64,
    pub heat_before: i64,
    pub heat_after: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SciFiRechargeOutcome {
    pub combatant_id: String,
    pub uninterrupted_completed_rounds: u32,
    pub shield_before: i64,
    pub shield_after: i64,
    pub recharged: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SciFiRuleErrorCode {
    InvalidBalance,
    InvalidPhase,
    ActiveCombatantMissing,
    CombatantMissing,
    ResourceMissing,
    DuplicateResource,
    PressureContractMissing,
    EventNotDamageResolved,
    RoundHookAlreadyApplied,
    NumericOverflow,
    StateInvariantViolation,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SciFiRuleError {
    pub code: SciFiRuleErrorCode,
    pub subject_id: String,
}

impl fmt::Display for SciFiRuleError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "sci-fi combat rule failed for {}: {:?}",
            self.subject_id, self.code
        )
    }
}

impl Error for SciFiRuleError {}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SciFiProfile {
    resolved: WorldCombatProfile,
}

impl SciFiProfile {
    pub fn resolve(channel_catalog: &DamageChannelCatalog) -> Result<Self, WorldProfileError> {
        Ok(Self {
            resolved: resolve_single_definition(definition(), &[], channel_catalog)?,
        })
    }

    #[must_use]
    pub const fn profile(&self) -> &WorldCombatProfile {
        &self.resolved
    }

    pub fn heat_decision(
        &self,
        state: &CombatState,
        combatant_id: &str,
        class: SciFiAbilityHeatClass,
    ) -> Result<SciFiHeatDecision, SciFiRuleError> {
        state
            .validate_for_commit()
            .map_err(|_| rule_error(SciFiRuleErrorCode::StateInvariantViolation, "state"))?;
        let combatant = state
            .combatants
            .iter()
            .find(|combatant| combatant.combatant_id == combatant_id)
            .ok_or_else(|| rule_error(SciFiRuleErrorCode::CombatantMissing, combatant_id))?;
        let heat = one_resource(&combatant.resources, HEAT_ID)?;
        let threshold = heat
            .overheat_threshold
            .ok_or_else(|| rule_error(SciFiRuleErrorCode::PressureContractMissing, HEAT_ID))?;
        Ok(SciFiHeatDecision {
            combatant_id: combatant_id.into(),
            heat_current: heat.current,
            overheat_threshold: threshold,
            allowed: class == SciFiAbilityHeatClass::Standard || heat.current < threshold,
        })
    }

    pub fn apply_normal_owner_turn_start(
        &self,
        state: &mut CombatState,
        balance: SciFiBalanceConfig,
    ) -> Result<SciFiOwnerTurnRecovery, SciFiRuleError> {
        validate_balance(balance)?;
        validate_state(state)?;
        if state.phase != CombatPhase::OwnerTurnStart {
            return Err(rule_error(
                SciFiRuleErrorCode::InvalidPhase,
                "normal-owner-turn-start",
            ));
        }
        let combatant_id = state.round.active_combatant_id.clone().ok_or_else(|| {
            rule_error(
                SciFiRuleErrorCode::ActiveCombatantMissing,
                "active-combatant",
            )
        })?;
        let mut working = state.clone();
        let combatant = combatant_mut(&mut working, &combatant_id)?;
        let (energy_before, energy_after) = adjust_pool(
            &mut combatant.resources,
            ENERGY_ID,
            balance.energy_restore_per_normal_owner_turn,
            true,
        )?;
        let (heat_before, heat_after) = adjust_pool(
            &mut combatant.resources,
            HEAT_ID,
            balance.heat_cooling_per_normal_owner_turn,
            false,
        )?;
        bump_and_commit(state, working)?;
        Ok(SciFiOwnerTurnRecovery {
            combatant_id,
            energy_before,
            energy_after,
            heat_before,
            heat_after,
        })
    }

    /// Consumes only a committed DamageResolved fact; UI estimates cannot reset recharge.
    pub fn record_committed_damage(
        &self,
        state: &mut CombatState,
        event: &CommittedDamageEvent,
        source_relation: DamageSourceRelation,
        policy: RechargeInterruptionPolicy,
    ) -> Result<RechargeInterruptionDecision, SciFiRuleError> {
        validate_state(state)?;
        if !matches!(
            state.phase,
            CombatPhase::RoundStart
                | CombatPhase::OwnerTurnStart
                | CombatPhase::Action
                | CombatPhase::OwnerTurnEnd
                | CombatPhase::ExtraTurn
        ) {
            return Err(rule_error(
                SciFiRuleErrorCode::InvalidPhase,
                "damage-recharge-observation",
            ));
        }
        let target_id = match event {
            CommittedDamageEvent::DamageResolved {
                target_combatant_id,
                ..
            } => target_combatant_id,
            _ => {
                return Err(rule_error(
                    SciFiRuleErrorCode::EventNotDamageResolved,
                    "damage-event",
                ));
            }
        };
        if !state
            .combatants
            .iter()
            .any(|combatant| combatant.combatant_id == *target_id)
        {
            return Err(rule_error(SciFiRuleErrorCode::CombatantMissing, target_id));
        }
        let decision = event
            .recharge_interruption_decision(source_relation, policy)
            .expect("DamageResolved always produces a recharge decision");
        if decision.interrupted {
            let mut working = state.clone();
            let combatant = combatant_mut(&mut working, target_id)?;
            combatant.shield_recharge.uninterrupted_completed_rounds = 0;
            combatant.shield_recharge.interrupted_this_round = true;
            bump_and_commit(state, working)?;
        }
        Ok(decision)
    }

    pub fn apply_round_end_recharge(
        &self,
        state: &mut CombatState,
        combatant_id: &str,
        balance: SciFiBalanceConfig,
    ) -> Result<SciFiRechargeOutcome, SciFiRuleError> {
        validate_balance(balance)?;
        validate_state(state)?;
        if state.phase != CombatPhase::RoundEnd {
            return Err(rule_error(SciFiRuleErrorCode::InvalidPhase, "round-end"));
        }
        let mut working = state.clone();
        let round_number = working.round.round_number;
        let combatant = combatant_mut(&mut working, combatant_id)?;
        if combatant.shield_recharge.last_processed_round_number == Some(round_number) {
            return Err(rule_error(
                SciFiRuleErrorCode::RoundHookAlreadyApplied,
                combatant_id,
            ));
        }
        let shield_before = combatant.shield;
        if combatant.shield_recharge.interrupted_this_round {
            combatant.shield_recharge.interrupted_this_round = false;
        } else {
            combatant.shield_recharge.uninterrupted_completed_rounds = combatant
                .shield_recharge
                .uninterrupted_completed_rounds
                .checked_add(1)
                .ok_or_else(|| {
                    rule_error(
                        SciFiRuleErrorCode::NumericOverflow,
                        "shield-recharge-rounds",
                    )
                })?
                .min(balance.shield_recharge_delay_rounds);
            if combatant.shield_recharge.uninterrupted_completed_rounds
                >= balance.shield_recharge_delay_rounds
            {
                combatant.shield = combatant
                    .shield
                    .checked_add(balance.shield_recharge_amount)
                    .ok_or_else(|| rule_error(SciFiRuleErrorCode::NumericOverflow, SHIELD_ID))?
                    .min(combatant.max_shield);
            }
        }
        combatant.shield_recharge.last_processed_round_number = Some(round_number);
        let outcome = SciFiRechargeOutcome {
            combatant_id: combatant_id.into(),
            uninterrupted_completed_rounds: combatant
                .shield_recharge
                .uninterrupted_completed_rounds,
            shield_before,
            shield_after: combatant.shield,
            recharged: combatant.shield > shield_before,
        };
        bump_and_commit(state, working)?;
        Ok(outcome)
    }
}

pub(crate) fn definition() -> WorldCombatProfileDefinition {
    let mappings = [
        ("kinetic", PrimaryMitigation::Armor),
        ("thermal", PrimaryMitigation::Resistance),
        ("electromagnetic", PrimaryMitigation::Resistance),
        ("plasma", PrimaryMitigation::Resistance),
        ("radiation", PrimaryMitigation::Resistance),
    ];
    WorldCombatProfileDefinition {
        world_type: WorldType::SciFi,
        world_profile_version: CURRENT_COMBAT_VERSIONS.world_profile_version,
        resource_lifecycle: ResourceLifecycle {
            policy_id: "sci-fi.resource-lifecycle.v0_4_1".into(),
            resources: vec![
                lifecycle(
                    HEALTH_ID,
                    ResourceStorage::HitPoints,
                    NormalOwnerTurnResourcePolicy::NoAutomaticChange,
                ),
                lifecycle(
                    SHIELD_ID,
                    ResourceStorage::Shield,
                    NormalOwnerTurnResourcePolicy::NoAutomaticChange,
                ),
                lifecycle(
                    ENERGY_ID,
                    ResourceStorage::ResourcePool,
                    NormalOwnerTurnResourcePolicy::RestoreFromBalance,
                ),
                lifecycle(
                    HEAT_ID,
                    ResourceStorage::PressureResourcePool,
                    NormalOwnerTurnResourcePolicy::ReduceFromBalance,
                ),
            ],
        },
        defense_behavior: DefenseBehavior {
            policy_id: "sci-fi.defense.v0_4_1".into(),
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
            policy_id: "sci-fi.recharge-energy-cooling.v0_4_1".into(),
        },
        signature_mechanic: SignatureMechanic {
            mechanic_id: "sci-fi.shield-window-heat-management.v0_4_1".into(),
        },
        selected_rule_module_ids: vec![],
    }
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

fn channel(id: &str) -> DamageChannelId {
    DamageChannelId::new(id).expect("Sci-Fi channels are developer-owned stable constants")
}

fn validate_balance(balance: SciFiBalanceConfig) -> Result<(), SciFiRuleError> {
    if balance.energy_restore_per_normal_owner_turn <= 0
        || balance.heat_cooling_per_normal_owner_turn <= 0
        || balance.shield_recharge_delay_rounds == 0
        || balance.shield_recharge_amount <= 0
    {
        return Err(rule_error(
            SciFiRuleErrorCode::InvalidBalance,
            "sci-fi-balance",
        ));
    }
    Ok(())
}

fn validate_state(state: &CombatState) -> Result<(), SciFiRuleError> {
    state
        .validate_for_commit()
        .map_err(|_| rule_error(SciFiRuleErrorCode::StateInvariantViolation, "state"))
}

fn combatant_mut<'a>(
    state: &'a mut CombatState,
    combatant_id: &str,
) -> Result<&'a mut crate::CombatantRuntime, SciFiRuleError> {
    state
        .combatants
        .iter_mut()
        .find(|combatant| combatant.combatant_id == combatant_id)
        .ok_or_else(|| rule_error(SciFiRuleErrorCode::CombatantMissing, combatant_id))
}

fn one_resource<'a>(
    resources: &'a [ResourceState],
    id: &str,
) -> Result<&'a ResourceState, SciFiRuleError> {
    let mut matches = resources
        .iter()
        .filter(|resource| resource.resource_id == id);
    let resource = matches
        .next()
        .ok_or_else(|| rule_error(SciFiRuleErrorCode::ResourceMissing, id))?;
    if matches.next().is_some() {
        return Err(rule_error(SciFiRuleErrorCode::DuplicateResource, id));
    }
    Ok(resource)
}

fn adjust_pool(
    resources: &mut [ResourceState],
    id: &str,
    amount: i64,
    increase: bool,
) -> Result<(i64, i64), SciFiRuleError> {
    let indices: Vec<_> = resources
        .iter()
        .enumerate()
        .filter(|(_, resource)| resource.resource_id == id)
        .map(|(index, _)| index)
        .collect();
    let [index] = indices.as_slice() else {
        return Err(rule_error(
            if indices.is_empty() {
                SciFiRuleErrorCode::ResourceMissing
            } else {
                SciFiRuleErrorCode::DuplicateResource
            },
            id,
        ));
    };
    let resource = &mut resources[*index];
    let before = resource.current;
    resource.current = if increase {
        resource
            .current
            .checked_add(amount)
            .ok_or_else(|| rule_error(SciFiRuleErrorCode::NumericOverflow, id))?
            .min(resource.max_value)
    } else {
        resource
            .current
            .saturating_sub(amount)
            .max(resource.min_value)
    };
    Ok((before, resource.current))
}

fn bump_and_commit(
    state: &mut CombatState,
    mut working: CombatState,
) -> Result<(), SciFiRuleError> {
    working.revision = working
        .revision
        .checked_add(1)
        .ok_or_else(|| rule_error(SciFiRuleErrorCode::NumericOverflow, "state-revision"))?;
    validate_state(&working)?;
    *state = working;
    Ok(())
}

fn rule_error(code: SciFiRuleErrorCode, subject_id: impl Into<String>) -> SciFiRuleError {
    SciFiRuleError {
        code,
        subject_id: subject_id.into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        COMBAT_FIXED_SCALE, CombatFixed, CombatRng, CombatSide, CombatantRuntime, CombatantState,
        DamageDefenseProfile, DamageImmunity, DamageMitigationRequest, HardCcDrRuntime,
        MitigationBalanceConfig, MitigationPipeline, ObjectiveRuntimeState,
        ProvisionalRuntimeDelta, ReinforcementRuntimeState, ResolutionResult, RoundRosterEntry,
        RoundRosterStatus, RoundRuntimeState, ShieldInteraction, TimelineEntry,
    };

    const SEED: &str = "0123456789abcdef0123456789abcdef";

    #[test]
    fn resolved_profile_freezes_resources_channels_and_mitigation() {
        let sci_fi = rules();
        let profile = sci_fi.profile();
        assert_eq!(profile.world_type(), WorldType::SciFi);
        assert_eq!(
            profile
                .resource_lifecycle()
                .resources
                .iter()
                .map(|rule| (
                    rule.resource_id.as_str(),
                    rule.storage,
                    rule.normal_owner_turn_start
                ))
                .collect::<Vec<_>>(),
            vec![
                (
                    ENERGY_ID,
                    ResourceStorage::ResourcePool,
                    NormalOwnerTurnResourcePolicy::RestoreFromBalance,
                ),
                (
                    HEALTH_ID,
                    ResourceStorage::HitPoints,
                    NormalOwnerTurnResourcePolicy::NoAutomaticChange,
                ),
                (
                    HEAT_ID,
                    ResourceStorage::PressureResourcePool,
                    NormalOwnerTurnResourcePolicy::ReduceFromBalance,
                ),
                (
                    SHIELD_ID,
                    ResourceStorage::Shield,
                    NormalOwnerTurnResourcePolicy::NoAutomaticChange,
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
            vec![
                "electromagnetic",
                "kinetic",
                "plasma",
                "radiation",
                "thermal"
            ]
        );
        assert_eq!(
            profile.primary_mitigation_for(&channel("kinetic")),
            Some(PrimaryMitigation::Armor)
        );
        for id in ["thermal", "electromagnetic", "plasma", "radiation"] {
            assert_eq!(
                profile.primary_mitigation_for(&channel(id)),
                Some(PrimaryMitigation::Resistance)
            );
        }
    }

    #[test]
    fn owner_turn_recovers_energy_cools_heat_and_changes_overheat_gate() {
        let sci_fi = rules();
        let mut state = fixture_state(CombatPhase::OwnerTurnStart, 1);
        resource_mut(&mut state, ENERGY_ID).current = 3;
        resource_mut(&mut state, HEAT_ID).current = 11;
        assert!(
            !sci_fi
                .heat_decision(&state, "pilot", SciFiAbilityHeatClass::OverheatRestricted)
                .unwrap()
                .allowed
        );
        assert!(
            sci_fi
                .heat_decision(&state, "pilot", SciFiAbilityHeatClass::Standard)
                .unwrap()
                .allowed
        );
        let rng_before = state.rng.clone();

        let outcome = sci_fi
            .apply_normal_owner_turn_start(&mut state, balance())
            .unwrap();
        assert_eq!((outcome.energy_before, outcome.energy_after), (3, 7));
        assert_eq!((outcome.heat_before, outcome.heat_after), (11, 8));
        assert!(
            sci_fi
                .heat_decision(&state, "pilot", SciFiAbilityHeatClass::OverheatRestricted)
                .unwrap()
                .allowed
        );
        assert_eq!(state.rng, rng_before);
    }

    #[test]
    fn committed_hostile_damage_resets_delay_then_two_quiet_rounds_recharge() {
        let sci_fi = rules();
        let mut state = fixture_state(CombatPhase::OwnerTurnStart, 1);
        state.combatants[0]
            .shield_recharge
            .uninterrupted_completed_rounds = 1;
        let event = committed_damage(sci_fi.profile(), 5, 10);
        let decision = sci_fi
            .record_committed_damage(
                &mut state,
                &event,
                DamageSourceRelation::Hostile,
                RechargeInterruptionPolicy::Default,
            )
            .unwrap();
        assert!(decision.interrupted);
        assert!(state.combatants[0].shield_recharge.interrupted_this_round);

        set_round_end(&mut state, 1);
        let interrupted = sci_fi
            .apply_round_end_recharge(&mut state, "pilot", balance())
            .unwrap();
        assert!(!interrupted.recharged);
        assert_eq!(interrupted.uninterrupted_completed_rounds, 0);

        set_round_end(&mut state, 2);
        let first_quiet = sci_fi
            .apply_round_end_recharge(&mut state, "pilot", balance())
            .unwrap();
        assert!(!first_quiet.recharged);
        assert_eq!(first_quiet.uninterrupted_completed_rounds, 1);

        set_round_end(&mut state, 3);
        let second_quiet = sci_fi
            .apply_round_end_recharge(&mut state, "pilot", balance())
            .unwrap();
        assert!(second_quiet.recharged);
        assert_eq!(
            (second_quiet.shield_before, second_quiet.shield_after),
            (5, 9)
        );
    }

    #[test]
    fn miss_nonhostile_and_never_policy_do_not_interrupt_recharge() {
        let sci_fi = rules();
        let mut state = fixture_state(CombatPhase::OwnerTurnStart, 1);
        let cases = [
            (
                committed_damage(sci_fi.profile(), 0, 10),
                DamageSourceRelation::Hostile,
                RechargeInterruptionPolicy::Default,
            ),
            (
                committed_damage(sci_fi.profile(), 5, 10),
                DamageSourceRelation::NonHostile,
                RechargeInterruptionPolicy::Default,
            ),
            (
                committed_damage(sci_fi.profile(), 5, 10),
                DamageSourceRelation::Hostile,
                RechargeInterruptionPolicy::Never,
            ),
        ];
        for (event, relation, policy) in cases {
            let before = state.clone();
            let decision = sci_fi
                .record_committed_damage(&mut state, &event, relation, policy)
                .unwrap();
            assert!(!decision.interrupted);
            assert_eq!(state, before);
        }
    }

    #[test]
    fn duplicate_round_hook_and_invalid_inputs_fail_atomically() {
        let sci_fi = rules();
        let mut state = fixture_state(CombatPhase::RoundEnd, 1);
        sci_fi
            .apply_round_end_recharge(&mut state, "pilot", balance())
            .unwrap();
        let before = state.clone();
        assert_eq!(
            sci_fi
                .apply_round_end_recharge(&mut state, "pilot", balance())
                .unwrap_err()
                .code,
            SciFiRuleErrorCode::RoundHookAlreadyApplied
        );
        assert_eq!(state, before);

        let mut owner = fixture_state(CombatPhase::OwnerTurnStart, 1);
        let before = owner.clone();
        let mut bad = balance();
        bad.heat_cooling_per_normal_owner_turn = 0;
        assert_eq!(
            sci_fi
                .apply_normal_owner_turn_start(&mut owner, bad)
                .unwrap_err()
                .code,
            SciFiRuleErrorCode::InvalidBalance
        );
        assert_eq!(owner, before);
    }

    fn rules() -> SciFiProfile {
        SciFiProfile::resolve(&DamageChannelCatalog::v0_4_1()).unwrap()
    }

    fn balance() -> SciFiBalanceConfig {
        SciFiBalanceConfig {
            energy_restore_per_normal_owner_turn: 4,
            heat_cooling_per_normal_owner_turn: 3,
            shield_recharge_delay_rounds: 2,
            shield_recharge_amount: 4,
        }
    }

    fn committed_damage(
        profile: &WorldCombatProfile,
        incoming_damage: i64,
        shield: i64,
    ) -> CommittedDamageEvent {
        let resolution = ResolutionResult::AutoHit {
            hit: incoming_damage > 0,
            critical: false,
        };
        let channel_id = channel("kinetic");
        let result = MitigationPipeline::resolve(
            profile,
            &MitigationBalanceConfig {
                armor_k: 100,
                max_armor_dr: fixed(800_000),
                max_resistance: fixed(800_000),
                max_weakness: fixed(1_000_000),
            },
            DamageMitigationRequest {
                attack_resolution: &resolution,
                channel_id: &channel_id,
                raw_modified_damage: fixed(incoming_damage * COMBAT_FIXED_SCALE),
                target_armor: 0,
                armor_penetration_percent: fixed(0),
                armor_penetration_flat: 0,
                base_channel_resistance: fixed(0),
                resistance_penetration: fixed(0),
                immunity: DamageImmunity::NotImmune {},
                shield_interaction: ShieldInteraction::standard(),
                current_shield: shield,
                current_hit_points: 20,
            },
        )
        .unwrap();
        CommittedDamageEvent::DamageResolved {
            bundle_id: "bundle".into(),
            source_command_id: "command".into(),
            source_combatant_id: Some("enemy".into()),
            target_combatant_id: "pilot".into(),
            component_index: 0,
            result,
        }
    }

    fn fixed(value: i64) -> CombatFixed {
        CombatFixed::from_scaled(value)
    }

    fn resource_mut<'a>(state: &'a mut CombatState, id: &str) -> &'a mut ResourceState {
        state.combatants[0]
            .resources
            .iter_mut()
            .find(|resource| resource.resource_id == id)
            .unwrap()
    }

    fn set_round_end(state: &mut CombatState, round_number: u64) {
        state.phase = CombatPhase::RoundEnd;
        state.round.round_number = round_number;
        state.round.completed_round_count = round_number - 1;
        state.round.active_combatant_id = None;
        state.round.roster[0].status = RoundRosterStatus::Completed;
    }

    fn fixture_state(phase: CombatPhase, round_number: u64) -> CombatState {
        let active = phase == CombatPhase::OwnerTurnStart;
        CombatState {
            combat_instance_id: "sci-fi-scenario".into(),
            versions: CURRENT_COMBAT_VERSIONS,
            random_seed: SEED.into(),
            revision: 1,
            last_committed_sequence: 0,
            phase,
            combatants: vec![CombatantRuntime {
                combatant_id: "pilot".into(),
                definition_id: "sci-fi-pilot".into(),
                side: CombatSide::Player,
                state: CombatantState::Active,
                hit_points: 20,
                max_hit_points: 20,
                shield: 5,
                max_shield: 12,
                action_points: 3,
                max_action_points: 3,
                reaction_charges: 1,
                max_reaction_charges: 1,
                resources: vec![
                    ResourceState {
                        resource_id: ENERGY_ID.into(),
                        current: 10,
                        min_value: 0,
                        max_value: 10,
                        overheat_threshold: None,
                        hard_max_value: None,
                    },
                    ResourceState {
                        resource_id: HEAT_ID.into(),
                        current: 0,
                        min_value: 0,
                        max_value: 10,
                        overheat_threshold: Some(10),
                        hard_max_value: Some(15),
                    },
                ],
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
            }],
            formal_party_member_ids: vec!["pilot".into()],
            combat_inventory: vec![],
            cost_reservations: vec![],
            resolution_context: None,
            timeline: vec![TimelineEntry {
                combatant_id: "pilot".into(),
                initiative_result: 10,
                initiative_base_stat: 2,
                is_extra_turn: false,
                source_sequence: 1,
            }],
            round: RoundRuntimeState {
                round_number,
                completed_round_count: round_number - 1,
                active_combatant_id: active.then(|| "pilot".into()),
                extra_turn_resume_phase: None,
                roster: vec![RoundRosterEntry {
                    combatant_id: "pilot".into(),
                    normal_turn_slot: 0,
                    status: if active {
                        RoundRosterStatus::Pending
                    } else {
                        RoundRosterStatus::Completed
                    },
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
            enemy_intents: vec![],
            result_candidates: vec![],
            terminal_priority_policy: crate::TerminalPriorityPolicy::default(),
            confirmed_result_candidate_id: None,
            confirmed_result: None,
            rng: CombatRng::new(
                SEED,
                "sci-fi-scenario",
                CURRENT_COMBAT_VERSIONS.rng_contract_version,
            )
            .unwrap()
            .snapshot(),
        }
    }
}

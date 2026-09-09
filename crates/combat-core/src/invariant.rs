use std::{error::Error, fmt};

use crate::{
    CanonicalEventChainScheduler, CanonicalReactionCore, CombatObjectiveRuntime, CombatState,
    CombatantRuntime, CombatantState, CostReservationModel, ResolutionContextLifecycle,
    ResourceState, TerminalOutcomeArbitrator, TurnRoundStateMachine,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CombatStateInvariantCode {
    HitPointsOutOfRange,
    ShieldOutOfRange,
    ActionPointsOutOfRange,
    ReactionChargesOutOfRange,
    BasicAttackCounterInvalid,
    HardCcDrStateInvalid,
    ShieldRechargeStateInvalid,
    UsageCounterInvalid,
    ResourceBoundsInvalid,
    ResourceOutOfRange,
    PressureResourceContractIncomplete,
    PressureResourceBoundsInvalid,
    CombatantStateHitPointsMismatch,
    FormalPartyContractInvalid,
    CostReservationLedgerInvalid,
    ResolutionContextInvalid,
    EventSchedulerInvalid,
    ReactionWindowInvalid,
    TurnRoundStateInvalid,
    ObjectiveRuntimeInvalid,
    EnemyIntentRuntimeInvalid,
    ReinforcementRegistryInvalid,
    StatusRuntimeInvalid,
    TerminalOutcomeInvalid,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CombatStateInvariantError {
    pub code: CombatStateInvariantCode,
    pub combatant_id: String,
    pub resource_id: Option<String>,
}

impl fmt::Display for CombatStateInvariantError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "combat state invariant failed for combatant {}: {:?}",
            self.combatant_id, self.code
        )
    }
}

impl Error for CombatStateInvariantError {}

/// The only validator used before an atomic state commit, after save restore,
/// and before canonical result commit. It rejects; it never repairs state.
pub struct CombatStateInvariantValidator;

impl CombatStateInvariantValidator {
    pub fn validate(state: &CombatState) -> Result<(), CombatStateInvariantError> {
        for combatant in &state.combatants {
            validate_combatant(combatant)?;
            if combatant
                .shield_recharge
                .last_processed_round_number
                .is_some_and(|round| round > state.round.round_number)
            {
                return Err(combatant_error(
                    combatant,
                    CombatStateInvariantCode::ShieldRechargeStateInvalid,
                ));
            }
        }
        validate_formal_party(state)?;
        validate_enemy_intents(state)?;
        validate_reinforcements(state)?;
        CostReservationModel::validate_state(state).map_err(|error| CombatStateInvariantError {
            code: CombatStateInvariantCode::CostReservationLedgerInvalid,
            combatant_id: error.subject_id,
            resource_id: None,
        })?;
        ResolutionContextLifecycle::validate_state(state).map_err(|error| {
            CombatStateInvariantError {
                code: CombatStateInvariantCode::ResolutionContextInvalid,
                combatant_id: error.subject_id,
                resource_id: None,
            }
        })?;
        CanonicalEventChainScheduler::validate_state(state).map_err(|error| {
            CombatStateInvariantError {
                code: CombatStateInvariantCode::EventSchedulerInvalid,
                combatant_id: error.subject_id,
                resource_id: None,
            }
        })?;
        CanonicalReactionCore::validate_state(state).map_err(|error| {
            CombatStateInvariantError {
                code: CombatStateInvariantCode::ReactionWindowInvalid,
                combatant_id: error.subject_id,
                resource_id: None,
            }
        })?;
        TurnRoundStateMachine::validate_state(state).map_err(|error| {
            CombatStateInvariantError {
                code: CombatStateInvariantCode::TurnRoundStateInvalid,
                combatant_id: error.subject_id,
                resource_id: None,
            }
        })?;
        CombatObjectiveRuntime::validate_state(state).map_err(|error| {
            CombatStateInvariantError {
                code: CombatStateInvariantCode::ObjectiveRuntimeInvalid,
                combatant_id: error.subject_id,
                resource_id: None,
            }
        })?;
        TerminalOutcomeArbitrator::validate_state(state).map_err(|error| {
            CombatStateInvariantError {
                code: CombatStateInvariantCode::TerminalOutcomeInvalid,
                combatant_id: error.subject_id,
                resource_id: None,
            }
        })?;
        Ok(())
    }
}

fn validate_enemy_intents(state: &CombatState) -> Result<(), CombatStateInvariantError> {
    let mut enemy_ids = std::collections::BTreeSet::new();
    let mut created_sequences = std::collections::BTreeSet::new();
    for plan in &state.enemy_intents {
        let actor_is_hostile = state.combatants.iter().any(|combatant| {
            combatant.combatant_id == plan.enemy_id && combatant.side == crate::CombatSide::Hostile
        });
        let target_exists = plan.target_hint.as_ref().is_none_or(|target_id| {
            state
                .combatants
                .iter()
                .any(|combatant| combatant.combatant_id == *target_id)
        });
        let mapping_is_valid = matches!(
            (plan.intent_category, plan.preferred_utility_category),
            (
                crate::EnemyIntentCategory::Attack,
                crate::UtilityActionCategory::Damage
            ) | (
                crate::EnemyIntentCategory::Charge,
                crate::UtilityActionCategory::Resource
            ) | (
                crate::EnemyIntentCategory::Control,
                crate::UtilityActionCategory::Control
            ) | (
                crate::EnemyIntentCategory::Defend,
                crate::UtilityActionCategory::Defense
            ) | (
                crate::EnemyIntentCategory::Heal,
                crate::UtilityActionCategory::Heal
            ) | (
                crate::EnemyIntentCategory::Ritual | crate::EnemyIntentCategory::Special,
                _
            )
        );
        let mut previous_sequence = 0;
        let mut previous_category = plan
            .replan_records
            .first()
            .map_or(plan.intent_category, |record| record.previous_category);
        let records_valid = plan.replan_records.iter().all(|record| {
            let expected_message = format!(
                "敌人调整了行动意图：{} → {}",
                record.previous_category.label_zh_cn(),
                record.next_category.label_zh_cn()
            );
            let valid = record.sequence > previous_sequence
                && record.previous_category == previous_category
                && record.debug_message_zh_cn == expected_message;
            previous_sequence = record.sequence;
            previous_category = record.next_category;
            valid
        }) && plan.replan_records.last().is_none_or(|record| {
            record.sequence < plan.created_sequence
                || (record.sequence == plan.created_sequence
                    && record.next_category == plan.intent_category)
        });
        if !enemy_ids.insert(plan.enemy_id.as_str())
            || !created_sequences.insert(plan.created_sequence)
            || !actor_is_hostile
            || !target_exists
            || !mapping_is_valid
            || plan.display_label_zh_cn != plan.intent_category.label_zh_cn()
            || plan.created_sequence == 0
            || plan.created_round == 0
            || plan.created_round > state.round.round_number
            || !records_valid
        {
            return Err(CombatStateInvariantError {
                code: CombatStateInvariantCode::EnemyIntentRuntimeInvalid,
                combatant_id: plan.enemy_id.clone(),
                resource_id: None,
            });
        }
    }
    Ok(())
}

fn validate_reinforcements(state: &CombatState) -> Result<(), CombatStateInvariantError> {
    let mut previous: Option<&str> = None;
    for reinforcement in &state.reinforcements.reinforcements {
        let id = reinforcement.combatant_id.as_str();
        let snapshot = &reinforcement.initial_runtime_snapshot;
        validate_combatant(snapshot)?;
        let live_matches = state
            .combatants
            .iter()
            .filter(|combatant| combatant.combatant_id == id)
            .count();
        let timeline_matches = state
            .timeline
            .iter()
            .filter(|entry| !entry.is_extra_turn && entry.combatant_id == id)
            .count();
        let roster_contains = state
            .round
            .roster
            .iter()
            .any(|entry| entry.combatant_id == id);
        let objective_ids_are_ordered = reinforcement
            .objective_membership_ids
            .windows(2)
            .all(|pair| pair[0] < pair[1]);
        let deployed_snapshot_matches = state.combatants.iter().any(|combatant| {
            combatant.combatant_id == id
                && combatant.definition_id == reinforcement.definition_ref
                && combatant.initiative_result == reinforcement.initiative_result
                && combatant.initiative_base_stat == reinforcement.initiative_base_stat
        });

        if id.is_empty()
            || previous.is_some_and(|value| value >= id)
            || snapshot.combatant_id != id
            || snapshot.definition_id != reinforcement.definition_ref
            || snapshot.state != CombatantState::Active
            || !objective_ids_are_ordered
            || (!reinforcement.is_deployed
                && (live_matches != 0 || timeline_matches != 0 || roster_contains))
            || (reinforcement.is_deployed
                && (live_matches != 1 || timeline_matches != 1 || !deployed_snapshot_matches))
        {
            return Err(CombatStateInvariantError {
                code: CombatStateInvariantCode::ReinforcementRegistryInvalid,
                combatant_id: reinforcement.combatant_id.clone(),
                resource_id: None,
            });
        }
        previous = Some(id);
    }
    Ok(())
}

fn validate_formal_party(state: &CombatState) -> Result<(), CombatStateInvariantError> {
    let mut previous: Option<&str> = None;
    for member_id in &state.formal_party_member_ids {
        let member = state
            .combatants
            .iter()
            .find(|combatant| combatant.combatant_id == *member_id)
            .ok_or_else(|| CombatStateInvariantError {
                code: CombatStateInvariantCode::FormalPartyContractInvalid,
                combatant_id: member_id.clone(),
                resource_id: None,
            })?;
        if previous.is_some_and(|value| value >= member_id)
            || !matches!(
                member.side,
                crate::CombatSide::Player | crate::CombatSide::Companion
            )
        {
            return Err(CombatStateInvariantError {
                code: CombatStateInvariantCode::FormalPartyContractInvalid,
                combatant_id: member_id.clone(),
                resource_id: None,
            });
        }
        previous = Some(member_id);
    }
    Ok(())
}

fn validate_combatant(combatant: &CombatantRuntime) -> Result<(), CombatStateInvariantError> {
    if combatant.max_hit_points < 0
        || combatant.hit_points < 0
        || combatant.hit_points > combatant.max_hit_points
    {
        return Err(combatant_error(
            combatant,
            CombatStateInvariantCode::HitPointsOutOfRange,
        ));
    }
    if combatant.max_shield < 0 || combatant.shield < 0 || combatant.shield > combatant.max_shield {
        return Err(combatant_error(
            combatant,
            CombatStateInvariantCode::ShieldOutOfRange,
        ));
    }
    if combatant.max_action_points < 0
        || combatant.action_points < 0
        || combatant.action_points > combatant.max_action_points
    {
        return Err(combatant_error(
            combatant,
            CombatStateInvariantCode::ActionPointsOutOfRange,
        ));
    }
    if combatant.max_reaction_charges < 0
        || combatant.reaction_charges < 0
        || combatant.reaction_charges > combatant.max_reaction_charges
    {
        return Err(combatant_error(
            combatant,
            CombatStateInvariantCode::ReactionChargesOutOfRange,
        ));
    }
    if combatant.basic_attack_count_this_normal_owner_turn < 0 {
        return Err(combatant_error(
            combatant,
            CombatStateInvariantCode::BasicAttackCounterInvalid,
        ));
    }
    if combatant.hard_cc_dr.level > 3
        || combatant.hard_cc_dr.quiet_owner_turns > 2
        || combatant.hard_cc_dr.applied_since_owner_turn_end
            && (combatant.hard_cc_dr.level == 0 || combatant.hard_cc_dr.quiet_owner_turns != 0)
    {
        return Err(combatant_error(
            combatant,
            CombatStateInvariantCode::HardCcDrStateInvalid,
        ));
    }
    if combatant.shield_recharge.interrupted_this_round
        && combatant.shield_recharge.uninterrupted_completed_rounds != 0
    {
        return Err(combatant_error(
            combatant,
            CombatStateInvariantCode::ShieldRechargeStateInvalid,
        ));
    }
    for (index, counter) in combatant.once_usage_counters.iter().enumerate() {
        if !(0..=1).contains(&counter.uses)
            || combatant.once_usage_counters[..index]
                .iter()
                .any(|previous| previous.counter_id == counter.counter_id)
        {
            return Err(CombatStateInvariantError {
                code: CombatStateInvariantCode::UsageCounterInvalid,
                combatant_id: combatant.combatant_id.clone(),
                resource_id: Some(counter.counter_id.clone()),
            });
        }
    }
    for resource in &combatant.resources {
        validate_resource(combatant, resource)?;
    }
    crate::StatusSchemaValidator::validate_runtime_collection(&combatant.statuses).map_err(
        |_| CombatStateInvariantError {
            code: CombatStateInvariantCode::StatusRuntimeInvalid,
            combatant_id: combatant.combatant_id.clone(),
            resource_id: None,
        },
    )?;
    match combatant.state {
        CombatantState::Active if combatant.hit_points == 0 => Err(combatant_error(
            combatant,
            CombatStateInvariantCode::CombatantStateHitPointsMismatch,
        )),
        CombatantState::Downed | CombatantState::Defeated if combatant.hit_points != 0 => {
            Err(combatant_error(
                combatant,
                CombatStateInvariantCode::CombatantStateHitPointsMismatch,
            ))
        }
        CombatantState::Active
        | CombatantState::Downed
        | CombatantState::Defeated
        | CombatantState::Removed => Ok(()),
    }
}

fn validate_resource(
    combatant: &CombatantRuntime,
    resource: &ResourceState,
) -> Result<(), CombatStateInvariantError> {
    if resource.min_value < 0 || resource.max_value < resource.min_value {
        return Err(resource_error(
            combatant,
            resource,
            CombatStateInvariantCode::ResourceBoundsInvalid,
        ));
    }

    match (resource.overheat_threshold, resource.hard_max_value) {
        (None, None) => {}
        (Some(overheat_threshold), Some(hard_max_value)) => {
            if hard_max_value < resource.min_value
                || resource.max_value > hard_max_value
                || overheat_threshold < resource.min_value
                || overheat_threshold > hard_max_value
            {
                return Err(resource_error(
                    combatant,
                    resource,
                    CombatStateInvariantCode::PressureResourceBoundsInvalid,
                ));
            }
        }
        (Some(_), None) | (None, Some(_)) => {
            return Err(resource_error(
                combatant,
                resource,
                CombatStateInvariantCode::PressureResourceContractIncomplete,
            ));
        }
    }

    let current_upper_bound = resource.hard_max_value.unwrap_or(resource.max_value);
    if resource.current < resource.min_value || resource.current > current_upper_bound {
        return Err(resource_error(
            combatant,
            resource,
            CombatStateInvariantCode::ResourceOutOfRange,
        ));
    }
    Ok(())
}

fn combatant_error(
    combatant: &CombatantRuntime,
    code: CombatStateInvariantCode,
) -> CombatStateInvariantError {
    CombatStateInvariantError {
        code,
        combatant_id: combatant.combatant_id.clone(),
        resource_id: None,
    }
}

fn resource_error(
    combatant: &CombatantRuntime,
    resource: &ResourceState,
    code: CombatStateInvariantCode,
) -> CombatStateInvariantError {
    CombatStateInvariantError {
        code,
        combatant_id: combatant.combatant_id.clone(),
        resource_id: Some(resource.resource_id.clone()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        CURRENT_COMBAT_VERSIONS, CombatPhase, CombatRng, CombatSide, ObjectiveRuntimeState,
        ProvisionalRuntimeDelta, ReinforcementRuntimeState, RoundRuntimeState,
    };

    const SEED: &str = "0123456789abcdef0123456789abcdef";

    #[test]
    fn accepts_a_valid_committed_state() {
        CombatStateInvariantValidator::validate(&valid_state()).unwrap();
    }

    #[test]
    fn rejects_every_bounded_combatant_value_outside_its_range() {
        let cases = [
            (
                CombatStateInvariantCode::HitPointsOutOfRange,
                hit_points_below_min as fn(&mut CombatantRuntime),
            ),
            (
                CombatStateInvariantCode::HitPointsOutOfRange,
                hit_points_above_max,
            ),
            (CombatStateInvariantCode::ShieldOutOfRange, shield_below_min),
            (CombatStateInvariantCode::ShieldOutOfRange, shield_above_max),
            (
                CombatStateInvariantCode::ActionPointsOutOfRange,
                action_points_below_min,
            ),
            (
                CombatStateInvariantCode::ActionPointsOutOfRange,
                action_points_above_max,
            ),
            (
                CombatStateInvariantCode::ReactionChargesOutOfRange,
                reaction_charges_below_min,
            ),
            (
                CombatStateInvariantCode::ReactionChargesOutOfRange,
                reaction_charges_above_max,
            ),
        ];

        for (expected, mutate) in cases {
            let mut state = valid_state();
            mutate(&mut state.combatants[0]);
            assert_eq!(validation_error(&state).code, expected);
        }
    }

    #[test]
    fn rejects_resource_ranges_pressure_contracts_and_current_values() {
        let mut invalid_bounds = valid_state();
        invalid_bounds.combatants[0].resources[0].min_value = -1;
        assert_eq!(
            validation_error(&invalid_bounds).code,
            CombatStateInvariantCode::ResourceBoundsInvalid
        );

        let mut out_of_range = valid_state();
        out_of_range.combatants[0].resources[0].current = 101;
        assert_eq!(
            validation_error(&out_of_range).code,
            CombatStateInvariantCode::ResourceOutOfRange
        );

        let mut below_min = valid_state();
        below_min.combatants[0].resources[0].min_value = 10;
        below_min.combatants[0].resources[0].current = 9;
        assert_eq!(
            validation_error(&below_min).code,
            CombatStateInvariantCode::ResourceOutOfRange
        );

        let mut incomplete_heat = valid_state();
        incomplete_heat.combatants[0].resources[1].hard_max_value = None;
        assert_eq!(
            validation_error(&incomplete_heat).code,
            CombatStateInvariantCode::PressureResourceContractIncomplete
        );

        let mut invalid_heat = valid_state();
        invalid_heat.combatants[0].resources[1].overheat_threshold = Some(121);
        let error = validation_error(&invalid_heat);
        assert_eq!(
            error.code,
            CombatStateInvariantCode::PressureResourceBoundsInvalid
        );
        assert_eq!(error.resource_id.as_deref(), Some("heat"));
    }

    #[test]
    fn enforces_active_downed_and_defeated_hit_point_relations() {
        for (combatant_state, hit_points) in [
            (CombatantState::Active, 0),
            (CombatantState::Downed, 1),
            (CombatantState::Defeated, 1),
        ] {
            let mut state = valid_state();
            state.combatants[0].state = combatant_state;
            state.combatants[0].hit_points = hit_points;
            assert_eq!(
                validation_error(&state).code,
                CombatStateInvariantCode::CombatantStateHitPointsMismatch
            );
        }
    }

    #[test]
    fn rejects_impossible_hard_cc_dr_runtime_state() {
        for invalid in [
            crate::HardCcDrRuntime {
                level: 4,
                quiet_owner_turns: 0,
                applied_since_owner_turn_end: false,
            },
            crate::HardCcDrRuntime {
                level: 1,
                quiet_owner_turns: 1,
                applied_since_owner_turn_end: true,
            },
        ] {
            let mut state = valid_state();
            state.combatants[0].hard_cc_dr = invalid;
            assert_eq!(
                validation_error(&state).code,
                CombatStateInvariantCode::HardCcDrStateInvalid
            );
        }
    }

    #[test]
    fn rejects_impossible_shield_recharge_runtime_state() {
        let mut interrupted_with_progress = valid_state();
        interrupted_with_progress.combatants[0].shield_recharge = crate::ShieldRechargeRuntime {
            uninterrupted_completed_rounds: 1,
            interrupted_this_round: true,
            last_processed_round_number: None,
        };
        assert_eq!(
            validation_error(&interrupted_with_progress).code,
            CombatStateInvariantCode::ShieldRechargeStateInvalid
        );

        let mut future_round = valid_state();
        future_round.combatants[0]
            .shield_recharge
            .last_processed_round_number = Some(future_round.round.round_number + 1);
        assert_eq!(
            validation_error(&future_round).code,
            CombatStateInvariantCode::ShieldRechargeStateInvalid
        );
    }

    #[test]
    fn formal_party_members_are_stable_sorted_unique_and_player_aligned() {
        let mut state = valid_state();
        state.formal_party_member_ids = vec!["combatant-player".into()];
        assert!(CombatStateInvariantValidator::validate(&state).is_ok());

        for ids in [
            vec!["missing".into()],
            vec!["combatant-player".into(), "combatant-player".into()],
        ] {
            let mut invalid = state.clone();
            invalid.formal_party_member_ids = ids;
            assert_eq!(
                CombatStateInvariantValidator::validate(&invalid)
                    .unwrap_err()
                    .code,
                CombatStateInvariantCode::FormalPartyContractInvalid
            );
        }
    }

    #[test]
    fn working_state_may_be_temporarily_invalid_but_commit_validation_rejects_it() {
        let committed = valid_state();
        let mut working = committed.clone();
        working.combatants[0].hit_points = 0;
        assert!(working.validate_for_commit().is_err());

        working.combatants[0].state = CombatantState::Downed;
        working.validate_for_commit().unwrap();
        assert_eq!(committed.combatants[0].state, CombatantState::Active);
    }

    #[test]
    fn hash_valid_save_restore_still_rejects_invalid_committed_state() {
        let mut invalid = valid_state();
        invalid.combatants[0].hit_points = 0;
        let envelope = invalid.snapshot().unwrap();

        assert!(matches!(
            envelope.verify_and_restore(),
            Err(crate::CombatStateRestoreError::Invariant(
                CombatStateInvariantError {
                    code: CombatStateInvariantCode::CombatantStateHitPointsMismatch,
                    ..
                }
            ))
        ));
    }

    #[test]
    fn restore_rejects_an_invalid_undeployed_reinforcement_snapshot() {
        let mut invalid = valid_state();
        let mut reinforcement = invalid.combatants[0].clone();
        reinforcement.combatant_id = "combatant-reinforcement".to_owned();
        reinforcement.action_points = -1;
        invalid
            .reinforcements
            .reinforcements
            .push(crate::ReinforcementRuntime {
                combatant_id: reinforcement.combatant_id.clone(),
                definition_ref: "reinforcement-definition".to_owned(),
                is_deployed: false,
                initiative_result: 9,
                initiative_base_stat: 1,
                initial_runtime_snapshot: reinforcement,
                objective_membership_ids: Vec::new(),
            });

        assert!(matches!(
            invalid.snapshot().unwrap().verify_and_restore(),
            Err(crate::CombatStateRestoreError::Invariant(
                CombatStateInvariantError {
                    code: CombatStateInvariantCode::ActionPointsOutOfRange,
                    ..
                }
            ))
        ));
    }

    fn validation_error(state: &CombatState) -> CombatStateInvariantError {
        CombatStateInvariantValidator::validate(state).unwrap_err()
    }

    fn hit_points_below_min(combatant: &mut CombatantRuntime) {
        combatant.hit_points = -1;
    }

    fn hit_points_above_max(combatant: &mut CombatantRuntime) {
        combatant.hit_points = combatant.max_hit_points + 1;
    }

    fn shield_below_min(combatant: &mut CombatantRuntime) {
        combatant.shield = -1;
    }

    fn shield_above_max(combatant: &mut CombatantRuntime) {
        combatant.shield = combatant.max_shield + 1;
    }

    fn action_points_below_min(combatant: &mut CombatantRuntime) {
        combatant.action_points = -1;
    }

    fn action_points_above_max(combatant: &mut CombatantRuntime) {
        combatant.action_points = combatant.max_action_points + 1;
    }

    fn reaction_charges_below_min(combatant: &mut CombatantRuntime) {
        combatant.reaction_charges = -1;
    }

    fn reaction_charges_above_max(combatant: &mut CombatantRuntime) {
        combatant.reaction_charges = combatant.max_reaction_charges + 1;
    }

    fn valid_state() -> CombatState {
        CombatState {
            combat_instance_id: "combat-invariant-fixture".to_owned(),
            versions: CURRENT_COMBAT_VERSIONS,
            random_seed: SEED.to_owned(),
            revision: 1,
            last_committed_sequence: 0,
            phase: CombatPhase::Stable,
            combatants: vec![CombatantRuntime {
                combatant_id: "combatant-player".to_owned(),
                definition_id: "player".to_owned(),
                side: CombatSide::Player,
                state: CombatantState::Active,
                hit_points: 10,
                max_hit_points: 10,
                shield: 3,
                max_shield: 5,
                action_points: 2,
                max_action_points: 3,
                reaction_charges: 1,
                max_reaction_charges: 1,
                resources: vec![
                    ResourceState {
                        resource_id: "energy".to_owned(),
                        current: 40,
                        min_value: 0,
                        max_value: 100,
                        overheat_threshold: None,
                        hard_max_value: None,
                    },
                    ResourceState {
                        resource_id: "heat".to_owned(),
                        current: 45,
                        min_value: 0,
                        max_value: 100,
                        overheat_threshold: Some(80),
                        hard_max_value: Some(120),
                    },
                ],
                statuses: Vec::new(),
                ability_usage: Vec::new(),
                basic_attack_count_this_normal_owner_turn: 0,
                once_usage_counters: Vec::new(),
                normal_owner_turn_index: 0,
                hard_cc_dr: crate::HardCcDrRuntime::default(),
                shield_recharge: crate::ShieldRechargeRuntime::default(),
                initiative_result: 12,
                initiative_base_stat: 2,
                last_committed_timeline_order: Some(0),
                solo_recovery_available: true,
            }],
            formal_party_member_ids: vec![],
            combat_inventory: Vec::new(),
            cost_reservations: Vec::new(),
            resolution_context: None,
            timeline: Vec::new(),
            round: RoundRuntimeState {
                round_number: 1,
                completed_round_count: 0,
                active_combatant_id: None,
                extra_turn_resume_phase: None,
                roster: Vec::new(),
            },
            objectives: ObjectiveRuntimeState {
                objectives: Vec::new(),
                required_objective_ids: Vec::new(),
                completed_objective_ids: Vec::new(),
                failed_objective_ids: Vec::new(),
                committed_signals: Vec::new(),
                failure_records: Vec::new(),
            },
            reinforcements: ReinforcementRuntimeState {
                reinforcements: Vec::new(),
            },
            provisional_delta: ProvisionalRuntimeDelta {
                revision: 0,
                entries: Vec::new(),
            },
            scheduler: None,
            pending_reaction: None,
            enemy_intents: Vec::new(),
            result_candidates: Vec::new(),
            terminal_priority_policy: crate::TerminalPriorityPolicy::default(),
            confirmed_result_candidate_id: None,
            confirmed_result: None,
            rng: CombatRng::new(
                SEED,
                "combat-invariant-fixture",
                CURRENT_COMBAT_VERSIONS.rng_contract_version,
            )
            .unwrap()
            .snapshot(),
        }
    }
}

use std::{error::Error, fmt};

use serde::{Deserialize, Serialize};

use crate::{
    CombatFixed, CombatState, DamageDefenseProfile, DamageImmunity, DamageMitigationRequest,
    DamageMitigationResult, MitigationBalanceConfig, MitigationPipeline, ProvisionalDeltaEntry,
    ResolutionResult, ResolvedEffect,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DamageBundleComponent {
    pub component_index: u32,
    pub damage_effect: ResolvedEffect,
    pub target_armor: i64,
    pub armor_penetration_percent: CombatFixed,
    pub armor_penetration_flat: i64,
    pub base_channel_resistance: CombatFixed,
    pub resistance_penetration: CombatFixed,
    pub immunity: DamageImmunity,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DamageBundle {
    pub bundle_id: String,
    pub source_command_id: String,
    pub source_combatant_id: Option<String>,
    pub target_combatant_id: String,
    pub components: Vec<DamageBundleComponent>,
}

pub trait DamageLethalResolver {
    fn resolve_after_bundle(
        &self,
        working_state: &mut CombatState,
        target_combatant_id: &str,
    ) -> Result<(), DamageBundleError>;
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkingDamageResult {
    pub component_index: u32,
    pub mitigation: DamageMitigationResult,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum CommittedDamageEvent {
    DamageResolved {
        bundle_id: String,
        source_command_id: String,
        source_combatant_id: Option<String>,
        target_combatant_id: String,
        component_index: u32,
        result: DamageMitigationResult,
    },
    DamageApplied {
        bundle_id: String,
        source_command_id: String,
        target_combatant_id: String,
        component_count: u32,
        total_shield_damage: i64,
        total_hp_damage: i64,
        total_overkill_damage: i64,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DamageBundleCommit {
    pub committed_state_revision: u64,
    pub working_results: Vec<WorkingDamageResult>,
    pub committed_events: Vec<CommittedDamageEvent>,
}

pub struct DamageBundleProcessor;

impl DamageBundleProcessor {
    pub fn commit<P: DamageDefenseProfile, L: DamageLethalResolver>(
        state: &mut CombatState,
        profile: &P,
        balance: &MitigationBalanceConfig,
        attack_resolution: &ResolutionResult,
        lethal_resolver: &L,
        mut bundle: DamageBundle,
    ) -> Result<DamageBundleCommit, DamageBundleError> {
        state
            .validate_for_commit()
            .map_err(|_| bundle_error(DamageBundleErrorCode::InvalidInitialState, "state"))?;
        validate_bundle(&bundle)?;

        let mut components = std::mem::take(&mut bundle.components);
        components.sort_by_key(|component| component.component_index);
        let mut working = state.clone();
        let target_before = working
            .combatants
            .iter()
            .find(|combatant| combatant.combatant_id == bundle.target_combatant_id)
            .cloned()
            .ok_or_else(|| {
                bundle_error(
                    DamageBundleErrorCode::TargetMissing,
                    &bundle.target_combatant_id,
                )
            })?;
        let mut working_results = Vec::with_capacity(components.len());

        for component in components {
            let (channel_id, raw_modified_damage) = match component.damage_effect {
                ResolvedEffect::QueueDamage {
                    channel_id,
                    raw_damage,
                } => (channel_id, raw_damage),
                _ => {
                    return Err(bundle_error(
                        DamageBundleErrorCode::NotDamagePrimitive,
                        format!("component-{}", component.component_index),
                    ));
                }
            };
            let target = working
                .combatants
                .iter_mut()
                .find(|combatant| combatant.combatant_id == bundle.target_combatant_id)
                .expect("target existence was established before component processing");
            let result = MitigationPipeline::resolve(
                profile,
                balance,
                DamageMitigationRequest {
                    attack_resolution,
                    channel_id: &channel_id,
                    raw_modified_damage,
                    target_armor: component.target_armor,
                    armor_penetration_percent: component.armor_penetration_percent,
                    armor_penetration_flat: component.armor_penetration_flat,
                    base_channel_resistance: component.base_channel_resistance,
                    resistance_penetration: component.resistance_penetration,
                    immunity: component.immunity,
                    current_shield: target.shield,
                    current_hit_points: target.hit_points,
                },
            )
            .map_err(|error| {
                bundle_error(
                    DamageBundleErrorCode::MitigationFailed,
                    format!("component-{}:{:?}", component.component_index, error.code),
                )
            })?;
            target.shield = result.resulting_shield;
            target.hit_points = result.resulting_hit_points;
            working_results.push(WorkingDamageResult {
                component_index: component.component_index,
                mitigation: result,
            });
        }

        let target_is_lethal = working
            .combatants
            .iter()
            .find(|combatant| combatant.combatant_id == bundle.target_combatant_id)
            .is_some_and(|combatant| combatant.hit_points == 0);
        if target_is_lethal {
            lethal_resolver.resolve_after_bundle(&mut working, &bundle.target_combatant_id)?;
        }

        let target_after = working
            .combatants
            .iter()
            .find(|combatant| combatant.combatant_id == bundle.target_combatant_id)
            .cloned()
            .ok_or_else(|| {
                bundle_error(
                    DamageBundleErrorCode::TargetMissing,
                    &bundle.target_combatant_id,
                )
            })?;
        append_provisional_delta(&mut working, &target_before, &target_after)?;
        working.revision = working
            .revision
            .checked_add(1)
            .ok_or_else(|| bundle_error(DamageBundleErrorCode::NumericOverflow, "stateRevision"))?;
        working
            .validate_for_commit()
            .map_err(|_| bundle_error(DamageBundleErrorCode::InvariantFailed, "workingState"))?;

        let committed_events = build_committed_events(&bundle, &working_results)?;
        let committed_state_revision = working.revision;
        *state = working;
        Ok(DamageBundleCommit {
            committed_state_revision,
            working_results,
            committed_events,
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DamageBundleErrorCode {
    InvalidInitialState,
    InvalidBundle,
    DuplicateComponentIndex,
    NotDamagePrimitive,
    TargetMissing,
    MitigationFailed,
    LethalResolutionFailed,
    InvariantFailed,
    NumericOverflow,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DamageBundleError {
    pub code: DamageBundleErrorCode,
    pub subject: String,
}

impl fmt::Display for DamageBundleError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "damage bundle failed for {}: {:?}",
            self.subject, self.code
        )
    }
}

impl Error for DamageBundleError {}

fn validate_bundle(bundle: &DamageBundle) -> Result<(), DamageBundleError> {
    validate_id(&bundle.bundle_id)?;
    validate_id(&bundle.source_command_id)?;
    validate_id(&bundle.target_combatant_id)?;
    if let Some(source_id) = &bundle.source_combatant_id {
        validate_id(source_id)?;
    }
    if bundle.components.is_empty() {
        return Err(bundle_error(
            DamageBundleErrorCode::InvalidBundle,
            &bundle.bundle_id,
        ));
    }
    let mut indices: Vec<_> = bundle
        .components
        .iter()
        .map(|component| component.component_index)
        .collect();
    indices.sort_unstable();
    if indices.windows(2).any(|pair| pair[0] == pair[1]) {
        return Err(bundle_error(
            DamageBundleErrorCode::DuplicateComponentIndex,
            &bundle.bundle_id,
        ));
    }
    for component in &bundle.components {
        validate_sorted_ids(&component.tags)?;
        if !matches!(component.damage_effect, ResolvedEffect::QueueDamage { .. }) {
            return Err(bundle_error(
                DamageBundleErrorCode::NotDamagePrimitive,
                format!("component-{}", component.component_index),
            ));
        }
    }
    Ok(())
}

fn append_provisional_delta(
    state: &mut CombatState,
    before: &crate::CombatantRuntime,
    after: &crate::CombatantRuntime,
) -> Result<(), DamageBundleError> {
    if before.shield != after.shield {
        state
            .provisional_delta
            .entries
            .push(ProvisionalDeltaEntry::Shield {
                combatant_id: before.combatant_id.clone(),
                before: before.shield,
                after: after.shield,
            });
        bump_provisional_revision(state)?;
    }
    if before.hit_points != after.hit_points {
        state
            .provisional_delta
            .entries
            .push(ProvisionalDeltaEntry::HitPoints {
                combatant_id: before.combatant_id.clone(),
                before: before.hit_points,
                after: after.hit_points,
            });
        bump_provisional_revision(state)?;
    }
    Ok(())
}

fn bump_provisional_revision(state: &mut CombatState) -> Result<(), DamageBundleError> {
    state.provisional_delta.revision =
        state
            .provisional_delta
            .revision
            .checked_add(1)
            .ok_or_else(|| {
                bundle_error(
                    DamageBundleErrorCode::NumericOverflow,
                    "provisionalRevision",
                )
            })?;
    Ok(())
}

fn build_committed_events(
    bundle: &DamageBundle,
    results: &[WorkingDamageResult],
) -> Result<Vec<CommittedDamageEvent>, DamageBundleError> {
    let mut events = Vec::with_capacity(results.len() + 1);
    let mut total_shield_damage = 0_i64;
    let mut total_hp_damage = 0_i64;
    let mut total_overkill_damage = 0_i64;
    for result in results {
        total_shield_damage = total_shield_damage
            .checked_add(result.mitigation.shield_damage)
            .ok_or_else(|| bundle_error(DamageBundleErrorCode::NumericOverflow, "shieldTotal"))?;
        total_hp_damage = total_hp_damage
            .checked_add(result.mitigation.hp_damage)
            .ok_or_else(|| bundle_error(DamageBundleErrorCode::NumericOverflow, "hpTotal"))?;
        total_overkill_damage = total_overkill_damage
            .checked_add(result.mitigation.overkill_damage)
            .ok_or_else(|| bundle_error(DamageBundleErrorCode::NumericOverflow, "overkillTotal"))?;
        events.push(CommittedDamageEvent::DamageResolved {
            bundle_id: bundle.bundle_id.clone(),
            source_command_id: bundle.source_command_id.clone(),
            source_combatant_id: bundle.source_combatant_id.clone(),
            target_combatant_id: bundle.target_combatant_id.clone(),
            component_index: result.component_index,
            result: result.mitigation.clone(),
        });
    }
    events.push(CommittedDamageEvent::DamageApplied {
        bundle_id: bundle.bundle_id.clone(),
        source_command_id: bundle.source_command_id.clone(),
        target_combatant_id: bundle.target_combatant_id.clone(),
        component_count: u32::try_from(results.len())
            .map_err(|_| bundle_error(DamageBundleErrorCode::NumericOverflow, "componentCount"))?,
        total_shield_damage,
        total_hp_damage,
        total_overkill_damage,
    });
    Ok(events)
}

fn validate_sorted_ids(ids: &[String]) -> Result<(), DamageBundleError> {
    let mut previous: Option<&str> = None;
    for id in ids {
        validate_id(id)?;
        if previous.is_some_and(|value| value >= id) {
            return Err(bundle_error(DamageBundleErrorCode::InvalidBundle, id));
        }
        previous = Some(id);
    }
    Ok(())
}

fn validate_id(value: &str) -> Result<(), DamageBundleError> {
    if value.is_empty()
        || value.len() > 128
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b':' | b'-'))
    {
        Err(bundle_error(DamageBundleErrorCode::InvalidBundle, value))
    } else {
        Ok(())
    }
}

fn bundle_error(code: DamageBundleErrorCode, subject: impl Into<String>) -> DamageBundleError {
    DamageBundleError {
        code,
        subject: subject.into(),
    }
}

#[cfg(test)]
mod tests {
    use std::{cell::Cell, collections::BTreeMap};

    use crate::{
        AbilityUsageState, CURRENT_COMBAT_VERSIONS, CombatPhase, CombatRng, CombatSide,
        CombatVersionSet, CombatantRuntime, CombatantState, DamageChannelId, ObjectiveRuntimeState,
        PrimaryMitigation, ProvisionalRuntimeDelta, ReinforcementRuntimeState, RoundRuntimeState,
        TerminalPriorityPolicy, TimelineEntry,
    };

    use super::*;

    struct TestProfile(BTreeMap<DamageChannelId, PrimaryMitigation>);

    impl DamageDefenseProfile for TestProfile {
        fn primary_mitigation_for(
            &self,
            channel_id: &DamageChannelId,
        ) -> Option<PrimaryMitigation> {
            self.0.get(channel_id).copied()
        }
    }

    struct DefeatLethal(Cell<u32>);

    impl DamageLethalResolver for DefeatLethal {
        fn resolve_after_bundle(
            &self,
            working_state: &mut CombatState,
            target_combatant_id: &str,
        ) -> Result<(), DamageBundleError> {
            self.0.set(self.0.get() + 1);
            let target = working_state
                .combatants
                .iter_mut()
                .find(|combatant| combatant.combatant_id == target_combatant_id)
                .ok_or_else(|| {
                    bundle_error(DamageBundleErrorCode::TargetMissing, target_combatant_id)
                })?;
            target.state = CombatantState::Defeated;
            Ok(())
        }
    }

    struct NoLethal;
    impl DamageLethalResolver for NoLethal {
        fn resolve_after_bundle(
            &self,
            _working_state: &mut CombatState,
            _target_combatant_id: &str,
        ) -> Result<(), DamageBundleError> {
            Ok(())
        }
    }

    struct FailingLethal;
    impl DamageLethalResolver for FailingLethal {
        fn resolve_after_bundle(
            &self,
            _working_state: &mut CombatState,
            target_combatant_id: &str,
        ) -> Result<(), DamageBundleError> {
            Err(bundle_error(
                DamageBundleErrorCode::LethalResolutionFailed,
                target_combatant_id,
            ))
        }
    }

    #[test]
    fn unsorted_components_use_index_order_and_inherit_working_shield_and_hp() {
        let mut state = fixture(10, 5);
        let bundle = bundle(vec![component(1, 3), component(0, 4)]);
        let result = DamageBundleProcessor::commit(
            &mut state,
            &profile(),
            &balance(),
            &hit(),
            &NoLethal,
            bundle,
        )
        .unwrap();

        assert_eq!(
            result
                .working_results
                .iter()
                .map(|result| result.component_index)
                .collect::<Vec<_>>(),
            [0, 1]
        );
        assert_eq!(result.working_results[0].mitigation.shield_damage, 4);
        assert_eq!(result.working_results[0].mitigation.hp_damage, 0);
        assert_eq!(result.working_results[1].mitigation.shield_damage, 1);
        assert_eq!(result.working_results[1].mitigation.hp_damage, 2);
        assert_eq!(
            (state.combatants[1].shield, state.combatants[1].hit_points),
            (0, 8)
        );
        assert_eq!(result.committed_events.len(), 3);
        assert!(matches!(
            result.committed_events[0],
            CommittedDamageEvent::DamageResolved {
                component_index: 0,
                ..
            }
        ));
        assert!(matches!(
            result.committed_events[1],
            CommittedDamageEvent::DamageResolved {
                component_index: 1,
                ..
            }
        ));
        assert!(matches!(
            result.committed_events[2],
            CommittedDamageEvent::DamageApplied {
                component_count: 2,
                ..
            }
        ));
    }

    #[test]
    fn lethal_resolution_runs_once_only_after_every_normal_component() {
        let mut state = fixture(3, 0);
        let resolver = DefeatLethal(Cell::new(0));
        let result = DamageBundleProcessor::commit(
            &mut state,
            &profile(),
            &balance(),
            &hit(),
            &resolver,
            bundle(vec![component(0, 5), component(1, 7)]),
        )
        .unwrap();

        assert_eq!(resolver.0.get(), 1);
        assert_eq!(state.combatants[1].state, CombatantState::Defeated);
        assert_eq!(state.combatants[1].hit_points, 0);
        assert_eq!(result.working_results[0].mitigation.overkill_damage, 2);
        assert_eq!(result.working_results[1].mitigation.overkill_damage, 7);
        assert_eq!(state.revision, 2);
        assert_eq!(state.provisional_delta.revision, 1);
        assert!(matches!(
            state.provisional_delta.entries[0],
            ProvisionalDeltaEntry::HitPoints {
                before: 3,
                after: 0,
                ..
            }
        ));
    }

    #[test]
    fn lethal_or_invariant_failure_leaves_original_state_byte_identical() {
        let original = fixture(3, 0);
        let mut failing = original.clone();
        assert_eq!(
            DamageBundleProcessor::commit(
                &mut failing,
                &profile(),
                &balance(),
                &hit(),
                &FailingLethal,
                bundle(vec![component(0, 5)]),
            )
            .unwrap_err()
            .code,
            DamageBundleErrorCode::LethalResolutionFailed
        );
        assert_eq!(failing, original);

        let mut invalid = original.clone();
        assert_eq!(
            DamageBundleProcessor::commit(
                &mut invalid,
                &profile(),
                &balance(),
                &hit(),
                &NoLethal,
                bundle(vec![component(0, 5)]),
            )
            .unwrap_err()
            .code,
            DamageBundleErrorCode::InvariantFailed
        );
        assert_eq!(invalid, original);
    }

    #[test]
    fn duplicate_indices_non_damage_effects_and_bad_tags_fail_before_commit() {
        let original = fixture(10, 0);
        let mut state = original.clone();
        assert_eq!(
            DamageBundleProcessor::commit(
                &mut state,
                &profile(),
                &balance(),
                &hit(),
                &NoLethal,
                bundle(vec![component(0, 1), component(0, 2)]),
            )
            .unwrap_err()
            .code,
            DamageBundleErrorCode::DuplicateComponentIndex
        );
        assert_eq!(state, original);

        let mut wrong = component(0, 1);
        wrong.damage_effect = ResolvedEffect::Heal { amount: 1 };
        let mut wrong_state = original.clone();
        assert_eq!(
            DamageBundleProcessor::commit(
                &mut wrong_state,
                &profile(),
                &balance(),
                &hit(),
                &NoLethal,
                bundle(vec![wrong]),
            )
            .unwrap_err()
            .code,
            DamageBundleErrorCode::NotDamagePrimitive
        );
        assert_eq!(wrong_state, original);

        let mut tags = component(0, 1);
        tags.tags = vec!["z".into(), "a".into()];
        assert!(
            DamageBundleProcessor::commit(
                &mut state,
                &profile(),
                &balance(),
                &hit(),
                &NoLethal,
                bundle(vec![tags]),
            )
            .is_err()
        );
    }

    fn profile() -> TestProfile {
        TestProfile(BTreeMap::from([(
            DamageChannelId::new("physical").unwrap(),
            PrimaryMitigation::None,
        )]))
    }

    fn balance() -> MitigationBalanceConfig {
        MitigationBalanceConfig {
            armor_k: 100,
            max_armor_dr: CombatFixed::from_scaled(800_000),
            max_resistance: CombatFixed::from_scaled(800_000),
            max_weakness: CombatFixed::from_scaled(1_000_000),
        }
    }

    fn hit() -> ResolutionResult {
        ResolutionResult::AutoHit {
            hit: true,
            critical: false,
        }
    }

    fn component(index: u32, damage: i64) -> DamageBundleComponent {
        DamageBundleComponent {
            component_index: index,
            damage_effect: ResolvedEffect::QueueDamage {
                channel_id: DamageChannelId::new("physical").unwrap(),
                raw_damage: CombatFixed::from_scaled(damage * 1_000_000),
            },
            target_armor: 0,
            armor_penetration_percent: CombatFixed::from_scaled(0),
            armor_penetration_flat: 0,
            base_channel_resistance: CombatFixed::from_scaled(0),
            resistance_penetration: CombatFixed::from_scaled(0),
            immunity: DamageImmunity::NotImmune {},
            tags: vec![],
        }
    }

    fn bundle(components: Vec<DamageBundleComponent>) -> DamageBundle {
        DamageBundle {
            bundle_id: "bundle-a".into(),
            source_command_id: "command-a".into(),
            source_combatant_id: Some("ally".into()),
            target_combatant_id: "enemy".into(),
            components,
        }
    }

    fn fixture(enemy_hp: i64, enemy_shield: i64) -> CombatState {
        let ally = combatant("ally", CombatSide::Player, 10, 0);
        let enemy = combatant("enemy", CombatSide::Hostile, enemy_hp, enemy_shield);
        CombatState {
            combat_instance_id: "damage-bundle-fixture".into(),
            versions: CombatVersionSet {
                ..CURRENT_COMBAT_VERSIONS
            },
            random_seed: "0123456789abcdef0123456789abcdef".into(),
            revision: 1,
            last_committed_sequence: 0,
            phase: CombatPhase::BattleStart,
            combatants: vec![ally.clone(), enemy.clone()],
            combat_inventory: vec![],
            cost_reservations: vec![],
            resolution_context: None,
            timeline: vec![timeline(&ally, 1), timeline(&enemy, 2)],
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
            result_candidates: vec![],
            terminal_priority_policy: TerminalPriorityPolicy::default(),
            confirmed_result_candidate_id: None,
            confirmed_result: None,
            rng: CombatRng::new(
                "0123456789abcdef0123456789abcdef",
                "damage-bundle-fixture",
                CURRENT_COMBAT_VERSIONS.rng_contract_version,
            )
            .unwrap()
            .snapshot(),
        }
    }

    fn combatant(id: &str, side: CombatSide, hp: i64, shield: i64) -> CombatantRuntime {
        CombatantRuntime {
            combatant_id: id.into(),
            definition_id: format!("definition-{id}"),
            side,
            state: CombatantState::Active,
            hit_points: hp,
            max_hit_points: 10,
            shield,
            max_shield: 10,
            action_points: 3,
            max_action_points: 3,
            reaction_charges: 1,
            max_reaction_charges: 1,
            resources: vec![],
            statuses: vec![],
            ability_usage: vec![AbilityUsageState {
                ability_id: "ability-a".into(),
                cooldown_remaining: 0,
                uses_this_normal_owner_turn: 0,
                uses_this_battle: 0,
            }],
            basic_attack_count_this_normal_owner_turn: 0,
            once_usage_counters: vec![],
            initiative_result: 10,
            initiative_base_stat: 2,
            last_committed_timeline_order: None,
            solo_recovery_available: false,
        }
    }

    fn timeline(combatant: &CombatantRuntime, source_sequence: u64) -> TimelineEntry {
        TimelineEntry {
            combatant_id: combatant.combatant_id.clone(),
            initiative_result: combatant.initiative_result,
            initiative_base_stat: combatant.initiative_base_stat,
            is_extra_turn: false,
            source_sequence,
        }
    }
}

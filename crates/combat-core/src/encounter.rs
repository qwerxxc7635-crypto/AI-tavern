use std::{error::Error, fmt};

use serde::{Deserialize, Serialize};

use crate::{
    AcceptedCommandLedger, CombatCommandBoundaryError, CombatCommandEnvelope, CombatFixed,
    CombatState, CombatantState, DamageBundle, DamageBundleCommit, DamageBundleComponent,
    DamageBundleError, DamageDefenseProfile, DamageImmunity, EffectDefinition, EffectError,
    EffectHandlerSet, EffectValueContext, LethalOutcomeResolver, MitigationBalanceConfig,
    RecoveryEffectCommit, RecoveryEffectProcessor, RecoveryEffectRequest, RecoveryRuleError,
    ResolutionError, ResolutionRequest, ResolutionResolver, ReviveFollowupApplier,
    ShieldInteraction, TimelineEntry,
};

/// Encounter-owned damage knobs. This is deliberately local and typed: encounter
/// rules do not gain a generic capability or a direct CombatState writer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EncounterDamageRule {
    pub resolution: ResolutionRequest,
    pub target_armor: i64,
    pub armor_penetration_percent: CombatFixed,
    pub armor_penetration_flat: i64,
    pub base_channel_resistance: CombatFixed,
    pub resistance_penetration: CombatFixed,
    pub immunity: DamageImmunity,
    pub shield_interaction: ShieldInteraction,
    pub tags: Vec<String>,
}

pub struct EncounterDamageServices<'a, P, L> {
    pub profile: &'a P,
    pub balance: &'a MitigationBalanceConfig,
    pub lethal_resolver: &'a L,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum CommittedEncounterEvent {
    ReinforcementActivated {
        rule_id: String,
        command_id: String,
        combatant_id: String,
        committed_sequence: u64,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReinforcementActivationCommit {
    pub committed_state_revision: u64,
    pub committed_events: Vec<CommittedEncounterEvent>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EncounterRuleErrorCode {
    CommandRejected,
    VersionMismatch,
    TargetCountInvalid,
    TargetMissing,
    EffectResolutionFailed,
    ResolutionFailed,
    DamageCommitFailed,
    RecoveryCommitFailed,
    ReinforcementMissing,
    ReinforcementAlreadyDeployed,
    ReinforcementStateConflict,
    NumericOverflow,
    InvariantFailed,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EncounterRuleError {
    pub code: EncounterRuleErrorCode,
    pub subject: String,
}

impl fmt::Display for EncounterRuleError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "encounter rule failed for {}: {:?}",
            self.subject, self.code
        )
    }
}

impl Error for EncounterRuleError {}

pub struct EncounterRuleExecutor;

impl EncounterRuleExecutor {
    pub fn commit_damage<P: DamageDefenseProfile, L: LethalOutcomeResolver>(
        state: &mut CombatState,
        ledger: &AcceptedCommandLedger,
        envelope: CombatCommandEnvelope,
        effect: &EffectDefinition,
        rule: EncounterDamageRule,
        services: EncounterDamageServices<'_, P, L>,
    ) -> Result<DamageBundleCommit, EncounterRuleError> {
        let command = validate_internal_action(state, ledger, envelope)?;
        let target_id = exactly_one_target(&command.target_ids)?;
        let context = target_context(state, target_id)?;
        let resolved = EffectHandlerSet::resolve(effect, &context).map_err(map_effect)?;
        let resolution = ResolutionResolver::resolve(rule.resolution).map_err(map_resolution)?;
        let bundle = DamageBundle {
            bundle_id: format!("encounter-bundle:{}", command.command_id),
            source_command_id: command.command_id,
            source_combatant_id: Some(command.actor_id),
            target_combatant_id: target_id.to_owned(),
            event_chain_id: format!("encounter-chain:{}", command.rule_id),
            components: vec![DamageBundleComponent {
                component_index: 0,
                damage_effect: resolved,
                target_armor: rule.target_armor,
                armor_penetration_percent: rule.armor_penetration_percent,
                armor_penetration_flat: rule.armor_penetration_flat,
                base_channel_resistance: rule.base_channel_resistance,
                resistance_penetration: rule.resistance_penetration,
                immunity: rule.immunity,
                shield_interaction: rule.shield_interaction,
                tags: rule.tags,
            }],
        };
        DamageBundleProcessor::commit(
            state,
            services.profile,
            services.balance,
            &resolution,
            services.lethal_resolver,
            bundle,
        )
        .map_err(map_damage)
    }

    pub fn commit_recovery<F: ReviveFollowupApplier>(
        state: &mut CombatState,
        ledger: &AcceptedCommandLedger,
        envelope: CombatCommandEnvelope,
        effect: &EffectDefinition,
        followups: &F,
    ) -> Result<RecoveryEffectCommit, EncounterRuleError> {
        let command = validate_internal_action(state, ledger, envelope)?;
        let target_id = exactly_one_target(&command.target_ids)?;
        let context = target_context(state, target_id)?;
        let resolved = EffectHandlerSet::resolve(effect, &context).map_err(map_effect)?;
        RecoveryEffectProcessor::commit(
            state,
            RecoveryEffectRequest {
                target_combatant_id: target_id.to_owned(),
                source_combatant_id: Some(command.actor_id),
                source_command_id: Some(command.command_id),
                event_chain_id: format!("encounter-chain:{}", command.rule_id),
                effect: resolved,
            },
            followups,
        )
        .map_err(map_recovery)
    }

    /// Each target is its own atomic chain. Earlier stable-ID activations remain
    /// committed if a later target fails, matching full-field encounter ordering.
    pub fn activate_reinforcements(
        state: &mut CombatState,
        ledger: &AcceptedCommandLedger,
        envelope: CombatCommandEnvelope,
    ) -> Result<ReinforcementActivationCommit, EncounterRuleError> {
        let command = validate_internal_action(state, ledger, envelope)?;
        if command.target_ids.is_empty() {
            return Err(encounter_error(
                EncounterRuleErrorCode::TargetCountInvalid,
                "targetIds",
            ));
        }
        let mut events = Vec::with_capacity(command.target_ids.len());
        for target_id in &command.target_ids {
            let mut working = state.clone();
            activate_one(&mut working, target_id)?;
            let sequence = working
                .last_committed_sequence
                .checked_add(1)
                .ok_or_else(|| {
                    encounter_error(EncounterRuleErrorCode::NumericOverflow, "committedSequence")
                })?;
            working.last_committed_sequence = sequence;
            working.revision = working.revision.checked_add(1).ok_or_else(|| {
                encounter_error(EncounterRuleErrorCode::NumericOverflow, "stateRevision")
            })?;
            working
                .validate_for_commit()
                .map_err(|_| encounter_error(EncounterRuleErrorCode::InvariantFailed, target_id))?;
            *state = working;
            events.push(CommittedEncounterEvent::ReinforcementActivated {
                rule_id: command.rule_id.clone(),
                command_id: command.command_id.clone(),
                combatant_id: target_id.clone(),
                committed_sequence: sequence,
            });
        }
        Ok(ReinforcementActivationCommit {
            committed_state_revision: state.revision,
            committed_events: events,
        })
    }
}

fn validate_internal_action(
    state: &CombatState,
    ledger: &AcceptedCommandLedger,
    envelope: CombatCommandEnvelope,
) -> Result<crate::InternalCombatCommand, EncounterRuleError> {
    let command = ledger.validate_internal(envelope).map_err(map_command)?;
    if command.versions != state.versions {
        return Err(encounter_error(
            EncounterRuleErrorCode::VersionMismatch,
            "versions",
        ));
    }
    Ok(command)
}

fn exactly_one_target(target_ids: &[String]) -> Result<&str, EncounterRuleError> {
    if target_ids.len() != 1 {
        return Err(encounter_error(
            EncounterRuleErrorCode::TargetCountInvalid,
            "targetIds",
        ));
    }
    Ok(&target_ids[0])
}

struct TargetEffectContext {
    maximum_hit_points: i64,
    maximum_shield: i64,
    resources: Vec<(String, i64)>,
}

impl EffectValueContext for TargetEffectContext {
    fn maximum_hit_points(&self) -> i64 {
        self.maximum_hit_points
    }
    fn maximum_shield(&self) -> i64 {
        self.maximum_shield
    }
    fn maximum_resource(&self, resource_id: &str) -> Option<i64> {
        self.resources
            .iter()
            .find(|(id, _)| id == resource_id)
            .map(|(_, value)| *value)
    }
}

fn target_context(
    state: &CombatState,
    target_id: &str,
) -> Result<TargetEffectContext, EncounterRuleError> {
    let target = state
        .combatants
        .iter()
        .find(|value| value.combatant_id == target_id)
        .ok_or_else(|| encounter_error(EncounterRuleErrorCode::TargetMissing, target_id))?;
    Ok(TargetEffectContext {
        maximum_hit_points: target.max_hit_points,
        maximum_shield: target.max_shield,
        resources: target
            .resources
            .iter()
            .map(|value| (value.resource_id.clone(), value.max_value))
            .collect(),
    })
}

fn activate_one(state: &mut CombatState, target_id: &str) -> Result<(), EncounterRuleError> {
    let index = state
        .reinforcements
        .reinforcements
        .iter()
        .position(|value| value.combatant_id == target_id)
        .ok_or_else(|| encounter_error(EncounterRuleErrorCode::ReinforcementMissing, target_id))?;
    let reinforcement = state.reinforcements.reinforcements[index].clone();
    if reinforcement.is_deployed {
        return Err(encounter_error(
            EncounterRuleErrorCode::ReinforcementAlreadyDeployed,
            target_id,
        ));
    }
    if state
        .combatants
        .iter()
        .any(|value| value.combatant_id == target_id)
        || state
            .timeline
            .iter()
            .any(|value| value.combatant_id == target_id)
        || state
            .round
            .roster
            .iter()
            .any(|value| value.combatant_id == target_id)
    {
        return Err(encounter_error(
            EncounterRuleErrorCode::ReinforcementStateConflict,
            target_id,
        ));
    }
    let mut combatant = reinforcement.initial_runtime_snapshot;
    combatant.state = CombatantState::Active;
    combatant.initiative_result = reinforcement.initiative_result;
    combatant.initiative_base_stat = reinforcement.initiative_base_stat;
    state.combatants.push(combatant);
    state
        .combatants
        .sort_by(|left, right| left.combatant_id.cmp(&right.combatant_id));
    state.timeline.push(TimelineEntry {
        combatant_id: target_id.to_owned(),
        initiative_result: reinforcement.initiative_result,
        initiative_base_stat: reinforcement.initiative_base_stat,
        is_extra_turn: false,
        source_sequence: state.last_committed_sequence.saturating_add(1),
    });
    state.timeline.sort_by(|left, right| {
        right
            .initiative_result
            .cmp(&left.initiative_result)
            .then_with(|| right.initiative_base_stat.cmp(&left.initiative_base_stat))
            .then_with(|| left.combatant_id.cmp(&right.combatant_id))
    });
    for (order, entry) in state
        .timeline
        .iter()
        .filter(|entry| !entry.is_extra_turn)
        .enumerate()
    {
        if let Some(combatant) = state
            .combatants
            .iter_mut()
            .find(|value| value.combatant_id == entry.combatant_id)
        {
            combatant.last_committed_timeline_order = u32::try_from(order).ok();
        }
    }
    state.reinforcements.reinforcements[index].is_deployed = true;
    Ok(())
}

fn encounter_error(code: EncounterRuleErrorCode, subject: impl Into<String>) -> EncounterRuleError {
    EncounterRuleError {
        code,
        subject: subject.into(),
    }
}
fn map_command(error: CombatCommandBoundaryError) -> EncounterRuleError {
    encounter_error(
        EncounterRuleErrorCode::CommandRejected,
        format!("{}:{:?}", error.path, error.code),
    )
}
fn map_effect(error: EffectError) -> EncounterRuleError {
    encounter_error(
        EncounterRuleErrorCode::EffectResolutionFailed,
        format!("{}:{:?}", error.subject, error.code),
    )
}
fn map_resolution(error: ResolutionError) -> EncounterRuleError {
    encounter_error(
        EncounterRuleErrorCode::ResolutionFailed,
        format!("{}:{:?}", error.field, error.code),
    )
}
fn map_damage(error: DamageBundleError) -> EncounterRuleError {
    encounter_error(
        EncounterRuleErrorCode::DamageCommitFailed,
        format!("{}:{:?}", error.subject, error.code),
    )
}
fn map_recovery(error: RecoveryRuleError) -> EncounterRuleError {
    encounter_error(
        EncounterRuleErrorCode::RecoveryCommitFailed,
        format!("{}:{:?}", error.subject, error.code),
    )
}

use crate::DamageBundleProcessor;

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use super::*;
    use crate::{
        CURRENT_COMBAT_VERSIONS, CombatCommandPayload, CombatCommandSource, CombatPhase, CombatRng,
        CombatSide, CombatantRuntime, DamageChannelId, ExecutableRecoveryPath, NoReviveFollowups,
        ObjectiveRuntimeState, PrimaryMitigation, ProvisionalRuntimeDelta, ReinforcementRuntime,
        ReinforcementRuntimeState, ResourceState, RoundRosterEntry, RoundRosterStatus,
        RoundRuntimeState, SoloRecoveryBalanceConfig, StandardLethalPolicy, TerminalPriorityPolicy,
    };

    const SEED: &str = "0123456789abcdef0123456789abcdef";

    struct TestProfile(BTreeMap<DamageChannelId, PrimaryMitigation>);
    impl DamageDefenseProfile for TestProfile {
        fn primary_mitigation_for(
            &self,
            channel_id: &DamageChannelId,
        ) -> Option<PrimaryMitigation> {
            self.0.get(channel_id).copied()
        }
    }

    #[test]
    fn internal_encounter_damage_reuses_effect_resolution_lethal_and_atomic_commit() {
        let mut state = fixture();
        let before_history = AcceptedCommandLedger::new();
        let effect = EffectDefinition::DealDamage {
            channel_id: DamageChannelId::new("physical").unwrap(),
            raw_damage: CombatFixed::from_scaled(20_000_000),
        };
        let commit = EncounterRuleExecutor::commit_damage(
            &mut state,
            &before_history,
            internal("cmd-hazard", "rule.hazard", vec!["enemy"]),
            &effect,
            EncounterDamageRule {
                resolution: ResolutionRequest::AutoHit {},
                target_armor: 0,
                armor_penetration_percent: CombatFixed::from_scaled(0),
                armor_penetration_flat: 0,
                base_channel_resistance: CombatFixed::from_scaled(0),
                resistance_penetration: CombatFixed::from_scaled(0),
                immunity: DamageImmunity::NotImmune {},
                shield_interaction: ShieldInteraction::standard(),
                tags: vec!["encounter".into()],
            },
            EncounterDamageServices {
                profile: &TestProfile(BTreeMap::from([(
                    DamageChannelId::new("physical").unwrap(),
                    PrimaryMitigation::None,
                )])),
                balance: &balance(),
                lethal_resolver: &StandardLethalPolicy {
                    solo_recovery: SoloRecoveryBalanceConfig::default(),
                    executable_recovery_path: ExecutableRecoveryPath::Unavailable,
                },
            },
        )
        .unwrap();

        assert_eq!(before_history.commands().len(), 0);
        assert_eq!(
            state
                .combatants
                .iter()
                .find(|value| value.combatant_id == "enemy")
                .unwrap()
                .state,
            CombatantState::Defeated
        );
        assert!(
            commit
                .committed_events
                .iter()
                .any(|event| matches!(event, crate::CommittedDamageEvent::TargetDefeated { .. }))
        );
    }

    #[test]
    fn player_or_ability_payload_cannot_enter_encounter_rule_path() {
        let mut state = fixture();
        let before = state.clone();
        let envelope = CombatCommandEnvelope {
            command_id: "cmd-player".into(),
            source: CombatCommandSource::Player {
                controller_id: "controller".into(),
            },
            actor_id: "hero".into(),
            versions: CURRENT_COMBAT_VERSIONS,
            payload: CombatCommandPayload::UseAbility {
                ability_id: "spawn".into(),
                target_id: Some("reinforcement-a".into()),
            },
        };
        let error = EncounterRuleExecutor::activate_reinforcements(
            &mut state,
            &AcceptedCommandLedger::new(),
            envelope,
        )
        .unwrap_err();
        assert_eq!(error.code, EncounterRuleErrorCode::CommandRejected);
        assert_eq!(state, before);
    }

    #[test]
    fn recovery_uses_shared_effect_handler_and_recovery_commit() {
        let mut state = fixture();
        let enemy = state
            .combatants
            .iter_mut()
            .find(|value| value.combatant_id == "enemy")
            .unwrap();
        enemy.hit_points = 2;
        let commit = EncounterRuleExecutor::commit_recovery(
            &mut state,
            &AcceptedCommandLedger::new(),
            internal("cmd-heal", "rule.heal", vec!["enemy"]),
            &EffectDefinition::Heal {
                amount: crate::EffectAmount::PercentOfMaximum {
                    percent: CombatFixed::from_scaled(500_000),
                },
            },
            &NoReviveFollowups,
        )
        .unwrap();
        assert_eq!(
            state
                .combatants
                .iter()
                .find(|value| value.combatant_id == "enemy")
                .unwrap()
                .hit_points,
            7
        );
        assert_eq!(commit.committed_sequence, 1);
    }

    #[test]
    fn reinforcement_activation_uses_preallocated_order_and_joins_next_round() {
        let mut state = fixture();
        let roster_before = state.round.roster.clone();
        let rng_before = state.rng.clone();
        let commit = EncounterRuleExecutor::activate_reinforcements(
            &mut state,
            &AcceptedCommandLedger::new(),
            internal(
                "cmd-wave",
                "rule.wave",
                vec!["reinforcement-a", "reinforcement-b"],
            ),
        )
        .unwrap();

        assert_eq!(state.round.roster, roster_before);
        assert_eq!(state.rng, rng_before);
        assert_eq!(
            commit
                .committed_events
                .iter()
                .map(|event| match event {
                    CommittedEncounterEvent::ReinforcementActivated { combatant_id, .. } =>
                        combatant_id.as_str(),
                })
                .collect::<Vec<_>>(),
            vec!["reinforcement-a", "reinforcement-b"]
        );
        assert_eq!(
            state
                .timeline
                .iter()
                .map(|entry| entry.combatant_id.as_str())
                .collect::<Vec<_>>(),
            vec!["reinforcement-a", "reinforcement-b", "hero", "enemy"]
        );

        state.phase = CombatPhase::RoundEnd;
        state.round.completed_round_count = state.round.round_number;
        state
            .round
            .roster
            .iter_mut()
            .for_each(|entry| entry.status = RoundRosterStatus::Completed);
        let next = crate::TurnRoundStateMachine::begin_round(&mut state).unwrap();
        assert_eq!(
            next.iter()
                .map(|entry| entry.combatant_id.as_str())
                .collect::<Vec<_>>(),
            vec!["reinforcement-a", "reinforcement-b", "hero", "enemy"]
        );
        let restored = state.snapshot().unwrap().verify_and_restore().unwrap();
        assert!(
            restored
                .reinforcements
                .reinforcements
                .iter()
                .all(|value| value.is_deployed)
        );
    }

    #[test]
    fn unknown_and_repeated_reinforcements_fail_without_mutating_that_chain() {
        let mut state = fixture();
        let before = state.clone();
        let missing = EncounterRuleExecutor::activate_reinforcements(
            &mut state,
            &AcceptedCommandLedger::new(),
            internal("cmd-missing", "rule.wave", vec!["missing"]),
        )
        .unwrap_err();
        assert_eq!(missing.code, EncounterRuleErrorCode::ReinforcementMissing);
        assert_eq!(state, before);

        EncounterRuleExecutor::activate_reinforcements(
            &mut state,
            &AcceptedCommandLedger::new(),
            internal("cmd-first", "rule.wave", vec!["reinforcement-a"]),
        )
        .unwrap();
        let after_first = state.clone();
        let repeated = EncounterRuleExecutor::activate_reinforcements(
            &mut state,
            &AcceptedCommandLedger::new(),
            internal("cmd-repeat", "rule.wave", vec!["reinforcement-a"]),
        )
        .unwrap_err();
        assert_eq!(
            repeated.code,
            EncounterRuleErrorCode::ReinforcementAlreadyDeployed
        );
        assert_eq!(state, after_first);
    }

    fn internal(command_id: &str, rule_id: &str, target_ids: Vec<&str>) -> CombatCommandEnvelope {
        CombatCommandEnvelope {
            command_id: command_id.into(),
            source: CombatCommandSource::InternalDeterministic {
                rule_id: rule_id.into(),
            },
            actor_id: "encounter".into(),
            versions: CURRENT_COMBAT_VERSIONS,
            payload: CombatCommandPayload::InternalRuleAction {
                rule_id: rule_id.into(),
                target_ids: target_ids.into_iter().map(str::to_owned).collect(),
            },
        }
    }

    fn balance() -> MitigationBalanceConfig {
        MitigationBalanceConfig {
            armor_k: 100,
            max_armor_dr: CombatFixed::from_scaled(900_000),
            max_resistance: CombatFixed::from_scaled(900_000),
            max_weakness: CombatFixed::from_scaled(900_000),
        }
    }

    fn fixture() -> CombatState {
        let hero = combatant("hero", CombatSide::Player, 10, 10, 5, 2);
        let enemy = combatant("enemy", CombatSide::Hostile, 10, 10, 1, 1);
        let a = combatant("reinforcement-a", CombatSide::Hostile, 8, 8, 20, 3);
        let b = combatant("reinforcement-b", CombatSide::Hostile, 9, 9, 20, 2);
        CombatState {
            combat_instance_id: "combat-encounter".into(),
            versions: CURRENT_COMBAT_VERSIONS,
            random_seed: SEED.into(),
            revision: 1,
            last_committed_sequence: 0,
            phase: CombatPhase::RoundStart,
            combatants: vec![enemy.clone(), hero.clone()],
            formal_party_member_ids: vec!["hero".into()],
            combat_inventory: vec![],
            cost_reservations: vec![],
            resolution_context: None,
            timeline: vec![timeline(&hero, 1), timeline(&enemy, 2)],
            round: RoundRuntimeState {
                round_number: 1,
                completed_round_count: 0,
                active_combatant_id: None,
                extra_turn_resume_phase: None,
                roster: vec![
                    RoundRosterEntry {
                        combatant_id: "hero".into(),
                        normal_turn_slot: 0,
                        status: RoundRosterStatus::Pending,
                    },
                    RoundRosterEntry {
                        combatant_id: "enemy".into(),
                        normal_turn_slot: 1,
                        status: RoundRosterStatus::Pending,
                    },
                ],
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
                reinforcements: vec![reinforcement(a), reinforcement(b)],
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
                SEED,
                "combat-encounter",
                CURRENT_COMBAT_VERSIONS.rng_contract_version,
            )
            .unwrap()
            .snapshot(),
        }
    }

    fn reinforcement(snapshot: CombatantRuntime) -> ReinforcementRuntime {
        ReinforcementRuntime {
            combatant_id: snapshot.combatant_id.clone(),
            definition_ref: snapshot.definition_id.clone(),
            is_deployed: false,
            initiative_result: snapshot.initiative_result,
            initiative_base_stat: snapshot.initiative_base_stat,
            initial_runtime_snapshot: snapshot,
            objective_membership_ids: vec![],
        }
    }

    fn timeline(value: &CombatantRuntime, source_sequence: u64) -> TimelineEntry {
        TimelineEntry {
            combatant_id: value.combatant_id.clone(),
            initiative_result: value.initiative_result,
            initiative_base_stat: value.initiative_base_stat,
            is_extra_turn: false,
            source_sequence,
        }
    }

    fn combatant(
        id: &str,
        side: CombatSide,
        hp: i64,
        max_hp: i64,
        initiative: i64,
        base: i64,
    ) -> CombatantRuntime {
        CombatantRuntime {
            combatant_id: id.into(),
            definition_id: format!("definition-{id}"),
            side,
            state: CombatantState::Active,
            hit_points: hp,
            max_hit_points: max_hp,
            shield: 0,
            max_shield: 0,
            action_points: 2,
            max_action_points: 2,
            reaction_charges: 1,
            max_reaction_charges: 1,
            resources: Vec::<ResourceState>::new(),
            statuses: vec![],
            ability_usage: vec![],
            basic_attack_count_this_normal_owner_turn: 0,
            once_usage_counters: vec![],
            normal_owner_turn_index: 0,
            hard_cc_dr: crate::HardCcDrRuntime::default(),
            initiative_result: initiative,
            initiative_base_stat: base,
            last_committed_timeline_order: None,
            solo_recovery_available: id == "hero",
        }
    }

    #[test]
    fn reinforcement_registry_invariant_rejects_aliases_and_live_undeployed_units() {
        let mut invalid = fixture();
        invalid.reinforcements.reinforcements[0].definition_ref = "wrong".into();
        assert_eq!(
            invalid.validate_for_commit().unwrap_err().code,
            crate::CombatStateInvariantCode::ReinforcementRegistryInvalid
        );

        let mut leaked = fixture();
        leaked.combatants.push(
            leaked.reinforcements.reinforcements[0]
                .initial_runtime_snapshot
                .clone(),
        );
        assert_eq!(
            leaked.validate_for_commit().unwrap_err().code,
            crate::CombatStateInvariantCode::ReinforcementRegistryInvalid
        );
    }

    #[test]
    fn primitive_registry_has_no_spawn_or_summon_capability() {
        let encoded = serde_json::to_string(&crate::EffectPrimitiveId::ALL).unwrap();
        assert!(!encoded.contains("SPAWN"));
        assert!(!encoded.contains("SUMMON"));
    }
}

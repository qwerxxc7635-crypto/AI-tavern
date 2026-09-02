use std::{error::Error, fmt};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::{
    CombatInventoryItemState, CombatRngSnapshot, CombatStateInvariantError,
    CombatStateInvariantValidator, CombatVersionSet, CostReservationRecord, ResolutionContext,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CombatPhase {
    BattleStart,
    RoundStart,
    OwnerTurnStart,
    Action,
    OwnerTurnEnd,
    ExtraTurn,
    RoundEnd,
    Stable,
    Terminal,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CombatSide {
    Player,
    Companion,
    Hostile,
    Neutral,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CombatantState {
    Active,
    Downed,
    Defeated,
    Removed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum DurationClock {
    OwnerTurn,
    Round,
    Permanent,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResourceState {
    pub resource_id: String,
    pub current: i64,
    pub min_value: i64,
    pub max_value: i64,
    pub overheat_threshold: Option<i64>,
    pub hard_max_value: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StatusRuntime {
    pub status_instance_id: String,
    pub definition_id: String,
    pub source_id: String,
    pub stack_group_id: String,
    pub stack_count: i64,
    pub remaining_duration: Option<i64>,
    pub duration_clock: DurationClock,
    pub application_sequence: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AbilityUsageState {
    pub ability_id: String,
    pub cooldown_remaining: i64,
    pub uses_this_normal_owner_turn: i64,
    pub uses_this_battle: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum UsageCounterScope {
    OwnerTurn,
    Round,
    Battle,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UsageCounterState {
    pub counter_id: String,
    pub scope: UsageCounterScope,
    pub uses: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CombatantRuntime {
    pub combatant_id: String,
    pub definition_id: String,
    pub side: CombatSide,
    pub state: CombatantState,
    pub hit_points: i64,
    pub max_hit_points: i64,
    pub shield: i64,
    pub max_shield: i64,
    pub action_points: i64,
    pub max_action_points: i64,
    pub reaction_charges: i64,
    pub max_reaction_charges: i64,
    pub resources: Vec<ResourceState>,
    pub statuses: Vec<StatusRuntime>,
    pub ability_usage: Vec<AbilityUsageState>,
    pub basic_attack_count_this_normal_owner_turn: i64,
    pub once_usage_counters: Vec<UsageCounterState>,
    pub initiative_result: i64,
    pub initiative_base_stat: i64,
    pub last_committed_timeline_order: Option<u32>,
    pub solo_recovery_available: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TimelineEntry {
    pub combatant_id: String,
    pub initiative_result: i64,
    pub initiative_base_stat: i64,
    pub is_extra_turn: bool,
    pub source_sequence: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RoundRosterStatus {
    Pending,
    Completed,
    Skipped,
    Removed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RoundRosterEntry {
    pub combatant_id: String,
    pub normal_turn_slot: u32,
    pub status: RoundRosterStatus,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RoundRuntimeState {
    pub round_number: u64,
    pub completed_round_count: u64,
    pub active_combatant_id: Option<String>,
    pub extra_turn_resume_phase: Option<CombatPhase>,
    pub roster: Vec<RoundRosterEntry>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ObjectiveKind {
    Eliminate,
    DefeatTarget,
    Survive,
    Protect,
    Escape,
    Scripted,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ObjectiveRuntime {
    pub objective_id: String,
    pub kind: ObjectiveKind,
    pub required: bool,
    pub tracked_combatant_ids: Vec<String>,
    pub target_id: Option<String>,
    pub rounds_required: Option<u64>,
    pub fail_on_downed: bool,
    pub removed_counts_as_defeated: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ObjectiveRuntimeState {
    pub objectives: Vec<ObjectiveRuntime>,
    pub required_objective_ids: Vec<String>,
    pub completed_objective_ids: Vec<String>,
    pub failed_objective_ids: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReinforcementRuntime {
    pub combatant_id: String,
    pub definition_ref: String,
    pub is_deployed: bool,
    pub initiative_result: i64,
    pub initiative_base_stat: i64,
    pub initial_runtime_snapshot: CombatantRuntime,
    pub objective_membership_ids: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReinforcementRuntimeState {
    pub reinforcements: Vec<ReinforcementRuntime>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum ProvisionalDeltaEntry {
    HitPoints {
        combatant_id: String,
        before: i64,
        after: i64,
    },
    Shield {
        combatant_id: String,
        before: i64,
        after: i64,
    },
    Resource {
        combatant_id: String,
        resource_id: String,
        before: i64,
        after: i64,
    },
    ItemQuantity {
        owner_id: String,
        item_id: String,
        before: i64,
        after: i64,
    },
    StatusPresence {
        combatant_id: String,
        status_instance_id: String,
        before: bool,
        after: bool,
    },
    WorldFact {
        fact_id: String,
        before_digest: Option<String>,
        after_digest: Option<String>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProvisionalRuntimeDelta {
    pub revision: u64,
    pub entries: Vec<ProvisionalDeltaEntry>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SchedulerItemKind {
    Trigger,
    Reaction,
    EncounterRule,
    System,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SchedulerItem {
    pub kind: SchedulerItemKind,
    pub event_chain_id: String,
    pub depth: u32,
    pub phase_priority: i32,
    pub explicit_priority: i32,
    pub source_initiative_order: u32,
    pub source_stable_id: String,
    pub effect_stable_id: String,
    pub sequence: u64,
    pub execution_counted: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum EventSchedulerStatus {
    Active,
    EngineFailure,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum LoopGuardFailureReason {
    MaxTriggerDepth,
    MaxEventCount,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum LoopGuardRollbackPolicy {
    RestorePrecombatSnapshot,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LoopGuardEngineFailure {
    pub reason: LoopGuardFailureReason,
    pub overflow_item: SchedulerItem,
    pub result: CombatResultType,
    pub rollback_policy: LoopGuardRollbackPolicy,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EventSchedulerCheckpoint {
    pub event_chain_id: String,
    pub status: EventSchedulerStatus,
    pub engine_failure: Option<LoopGuardEngineFailure>,
    pub executed_event_count: u64,
    pub queue: Vec<SchedulerItem>,
    pub current_item: Option<SchedulerItem>,
    pub next_sequence: u64,
    pub max_trigger_depth: u32,
    pub max_event_count: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum HookPhase {
    PreAction,
    BeforeRoll,
    AfterRoll,
    Outcome,
    PreEffect,
    PostEffect,
    OwnerTurnStart,
    OwnerTurnEnd,
    RoundStart,
    RoundEnd,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CostCommitState {
    Reserved,
    Committed,
    Released,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PendingReactionWindow {
    pub window_id: String,
    pub resolution_context_id: String,
    pub source_command_id: String,
    pub actor_id: String,
    pub target_ids: Vec<String>,
    pub ability_id: Option<String>,
    pub event_chain_id: String,
    pub hook_phase: HookPhase,
    pub eligible_reaction_ids: Vec<String>,
    pub selected_reaction_id: Option<String>,
    pub cost_state: CostCommitState,
    pub resolved_rolls: Vec<i64>,
    pub sequence_number: u64,
    pub accepted_reaction_decision_command_id: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CombatResultType {
    Victory,
    Defeat,
    Escape,
    ScriptedVictory,
    ScriptedDefeat,
    Aborted,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResultCandidate {
    pub candidate_id: String,
    pub result_type: CombatResultType,
    pub source_kind: String,
    pub source_id: String,
    pub explicit_priority: Option<i32>,
    pub sequence: u64,
}

/// The single authoritative in-memory Runtime State. Collections use explicit
/// ordered vectors; rule code may not add map/object iteration to hashing.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CombatState {
    pub combat_instance_id: String,
    pub versions: CombatVersionSet,
    pub random_seed: String,
    pub revision: u64,
    pub last_committed_sequence: u64,
    pub phase: CombatPhase,
    pub combatants: Vec<CombatantRuntime>,
    pub combat_inventory: Vec<CombatInventoryItemState>,
    pub cost_reservations: Vec<CostReservationRecord>,
    pub resolution_context: Option<ResolutionContext>,
    pub timeline: Vec<TimelineEntry>,
    pub round: RoundRuntimeState,
    pub objectives: ObjectiveRuntimeState,
    pub reinforcements: ReinforcementRuntimeState,
    pub provisional_delta: ProvisionalRuntimeDelta,
    pub scheduler: Option<EventSchedulerCheckpoint>,
    pub pending_reaction: Option<PendingReactionWindow>,
    pub result_candidates: Vec<ResultCandidate>,
    pub confirmed_result: Option<CombatResultType>,
    pub rng: CombatRngSnapshot,
}

impl CombatState {
    /// Exact serde JSON bytes are canonical for `combatSchemaVersion=1`.
    /// The struct contains no maps, floats, timestamps, or presentation state.
    pub fn canonical_json_bytes(&self) -> Result<Vec<u8>, serde_json::Error> {
        serde_json::to_vec(self)
    }

    pub fn state_hash_sha256(&self) -> Result<String, serde_json::Error> {
        let bytes = self.canonical_json_bytes()?;
        Ok(format!("{:x}", Sha256::digest(bytes)))
    }

    pub fn snapshot(&self) -> Result<CombatStateEnvelope, serde_json::Error> {
        Ok(CombatStateEnvelope {
            state_hash_sha256: self.state_hash_sha256()?,
            state: self.clone(),
        })
    }

    /// Must succeed before an atomic state/result commit. Working copies may
    /// remain unvalidated while their effect and lethal resolution are active.
    pub fn validate_for_commit(&self) -> Result<(), CombatStateInvariantError> {
        CombatStateInvariantValidator::validate(self)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CombatStateEnvelope {
    pub state_hash_sha256: String,
    pub state: CombatState,
}

impl CombatStateEnvelope {
    pub fn verify_and_restore(self) -> Result<CombatState, CombatStateRestoreError> {
        let actual = self
            .state
            .state_hash_sha256()
            .map_err(|_| CombatStateRestoreError::Hash(CombatStateHashError::Serialization))?;
        if actual != self.state_hash_sha256 {
            return Err(CombatStateRestoreError::Hash(
                CombatStateHashError::Mismatch {
                    expected: self.state_hash_sha256,
                    actual,
                },
            ));
        }
        CombatStateInvariantValidator::validate(&self.state)
            .map_err(CombatStateRestoreError::Invariant)?;
        Ok(self.state)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CombatStateHashError {
    Serialization,
    Mismatch { expected: String, actual: String },
}

impl fmt::Display for CombatStateHashError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Serialization => formatter.write_str("combat state serialization failed"),
            Self::Mismatch { .. } => formatter.write_str("combat state hash does not match"),
        }
    }
}

impl Error for CombatStateHashError {}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CombatStateRestoreError {
    Hash(CombatStateHashError),
    Invariant(CombatStateInvariantError),
}

impl fmt::Display for CombatStateRestoreError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Hash(error) => error.fmt(formatter),
            Self::Invariant(_) => formatter.write_str("restored combat state violates invariants"),
        }
    }
}

impl Error for CombatStateRestoreError {}

#[cfg(test)]
mod tests {
    use serde_json::{Value, json};

    use super::*;
    use crate::{CURRENT_COMBAT_VERSIONS, CombatRng, RngChannel};

    const SEED: &str = "0123456789abcdef0123456789abcdef";

    #[test]
    fn aggregate_round_trips_every_authoritative_state_partition() {
        let state = fixture();
        let encoded = state.canonical_json_bytes().unwrap();
        let decoded: CombatState = serde_json::from_slice(&encoded).unwrap();
        assert_eq!(decoded, state);
        assert_eq!(decoded.combatants.len(), 2);
        assert_eq!(decoded.timeline.len(), 2);
        assert_eq!(decoded.round.roster.len(), 2);
        assert_eq!(decoded.objectives.objectives.len(), 1);
        assert_eq!(decoded.reinforcements.reinforcements.len(), 1);
        assert_eq!(decoded.provisional_delta.entries.len(), 2);
        assert!(decoded.scheduler.is_some());
        assert!(decoded.pending_reaction.is_some());
        assert_eq!(decoded.result_candidates.len(), 1);
    }

    #[test]
    fn state_hash_and_envelope_restore_are_exact_and_deterministic() {
        let state = fixture();
        let first = state.state_hash_sha256().unwrap();
        let second = state.state_hash_sha256().unwrap();
        assert_eq!(first, second);
        assert_eq!(first.len(), 64);

        let snapshot = state.snapshot().unwrap();
        let encoded = serde_json::to_string(&snapshot).unwrap();
        let decoded: CombatStateEnvelope = serde_json::from_str(&encoded).unwrap();
        assert_eq!(decoded.verify_and_restore().unwrap(), state);
    }

    #[test]
    fn tamper_and_unknown_fields_fail_closed() {
        let mut snapshot = fixture().snapshot().unwrap();
        snapshot.state.combatants[0].hit_points -= 1;
        assert!(matches!(
            snapshot.verify_and_restore(),
            Err(CombatStateRestoreError::Hash(
                CombatStateHashError::Mismatch { .. }
            ))
        ));

        let mut unknown: Value = serde_json::to_value(fixture()).unwrap();
        unknown["uiSelectedAbilityId"] = json!("ability-ui-only");
        assert!(serde_json::from_value::<CombatState>(unknown).is_err());
    }

    #[test]
    fn collection_order_is_part_of_the_canonical_state_not_container_accident() {
        let original = fixture();
        let mut reordered = original.clone();
        reordered.combatants.reverse();
        assert_ne!(
            original.state_hash_sha256().unwrap(),
            reordered.state_hash_sha256().unwrap()
        );
    }

    #[test]
    fn read_only_hash_snapshot_and_serialization_do_not_consume_rng() {
        let state = fixture();
        let before = state.rng.clone();
        let mut control_rng = CombatRng::restore(before.clone()).unwrap();
        state.canonical_json_bytes().unwrap();
        state.state_hash_sha256().unwrap();
        state.snapshot().unwrap();
        assert_eq!(state.rng, before);

        let mut restored_rng = CombatRng::restore(state.rng).unwrap();
        assert_eq!(
            restored_rng.roll_die(RngChannel::Resolution, 20).unwrap(),
            control_rng.roll_die(RngChannel::Resolution, 20).unwrap()
        );
    }

    fn fixture() -> CombatState {
        let player = combatant("combatant-player", CombatSide::Player, 10, 0);
        let enemy = combatant("combatant-enemy", CombatSide::Hostile, 8, 2);
        let reinforcement = combatant("combatant-reinforcement", CombatSide::Hostile, 6, 0);
        CombatState {
            combat_instance_id: "combat-state-fixture".to_owned(),
            versions: CURRENT_COMBAT_VERSIONS,
            random_seed: SEED.to_owned(),
            revision: 3,
            last_committed_sequence: 7,
            phase: CombatPhase::Action,
            combatants: vec![player.clone(), enemy.clone()],
            combat_inventory: vec![],
            cost_reservations: vec![],
            resolution_context: None,
            timeline: vec![
                TimelineEntry {
                    combatant_id: player.combatant_id.clone(),
                    initiative_result: 18,
                    initiative_base_stat: 4,
                    is_extra_turn: false,
                    source_sequence: 1,
                },
                TimelineEntry {
                    combatant_id: enemy.combatant_id.clone(),
                    initiative_result: 14,
                    initiative_base_stat: 3,
                    is_extra_turn: false,
                    source_sequence: 2,
                },
            ],
            round: RoundRuntimeState {
                round_number: 1,
                completed_round_count: 0,
                active_combatant_id: Some(player.combatant_id.clone()),
                extra_turn_resume_phase: None,
                roster: vec![
                    RoundRosterEntry {
                        combatant_id: player.combatant_id.clone(),
                        normal_turn_slot: 0,
                        status: RoundRosterStatus::Pending,
                    },
                    RoundRosterEntry {
                        combatant_id: enemy.combatant_id.clone(),
                        normal_turn_slot: 1,
                        status: RoundRosterStatus::Pending,
                    },
                ],
            },
            objectives: ObjectiveRuntimeState {
                objectives: vec![ObjectiveRuntime {
                    objective_id: "objective-eliminate".to_owned(),
                    kind: ObjectiveKind::Eliminate,
                    required: true,
                    tracked_combatant_ids: vec![
                        enemy.combatant_id.clone(),
                        reinforcement.combatant_id.clone(),
                    ],
                    target_id: None,
                    rounds_required: None,
                    fail_on_downed: false,
                    removed_counts_as_defeated: false,
                }],
                required_objective_ids: vec!["objective-eliminate".to_owned()],
                completed_objective_ids: vec![],
                failed_objective_ids: vec![],
            },
            reinforcements: ReinforcementRuntimeState {
                reinforcements: vec![ReinforcementRuntime {
                    combatant_id: reinforcement.combatant_id.clone(),
                    definition_ref: reinforcement.definition_id.clone(),
                    is_deployed: false,
                    initiative_result: 12,
                    initiative_base_stat: 2,
                    initial_runtime_snapshot: reinforcement,
                    objective_membership_ids: vec!["objective-eliminate".to_owned()],
                }],
            },
            provisional_delta: ProvisionalRuntimeDelta {
                revision: 2,
                entries: vec![
                    ProvisionalDeltaEntry::HitPoints {
                        combatant_id: enemy.combatant_id.clone(),
                        before: 10,
                        after: 8,
                    },
                    ProvisionalDeltaEntry::Shield {
                        combatant_id: enemy.combatant_id.clone(),
                        before: 4,
                        after: 2,
                    },
                ],
            },
            scheduler: Some(EventSchedulerCheckpoint {
                event_chain_id: "chain-7".to_owned(),
                status: EventSchedulerStatus::Active,
                engine_failure: None,
                executed_event_count: 1,
                queue: vec![SchedulerItem {
                    kind: SchedulerItemKind::Reaction,
                    event_chain_id: "chain-7".to_owned(),
                    depth: 1,
                    phase_priority: 20,
                    explicit_priority: 5,
                    source_initiative_order: 1,
                    source_stable_id: enemy.combatant_id.clone(),
                    effect_stable_id: "reaction-guard".to_owned(),
                    sequence: 8,
                    execution_counted: false,
                }],
                current_item: None,
                next_sequence: 9,
                max_trigger_depth: 32,
                max_event_count: 256,
            }),
            pending_reaction: Some(PendingReactionWindow {
                window_id: "reaction-window-8".to_owned(),
                resolution_context_id: "resolution-7".to_owned(),
                source_command_id: "command-7".to_owned(),
                actor_id: player.combatant_id.clone(),
                target_ids: vec![enemy.combatant_id.clone()],
                ability_id: Some("ability-basic-attack".to_owned()),
                event_chain_id: "chain-7".to_owned(),
                hook_phase: HookPhase::PreEffect,
                eligible_reaction_ids: vec!["reaction-guard".to_owned()],
                selected_reaction_id: None,
                cost_state: CostCommitState::Reserved,
                resolved_rolls: vec![17],
                sequence_number: 8,
                accepted_reaction_decision_command_id: None,
            }),
            result_candidates: vec![ResultCandidate {
                candidate_id: "candidate-escape".to_owned(),
                result_type: CombatResultType::Escape,
                source_kind: "OBJECTIVE".to_owned(),
                source_id: "objective-escape".to_owned(),
                explicit_priority: None,
                sequence: 6,
            }],
            confirmed_result: None,
            rng: CombatRng::new(
                SEED,
                "combat-state-fixture",
                CURRENT_COMBAT_VERSIONS.rng_contract_version,
            )
            .unwrap()
            .snapshot(),
        }
    }

    fn combatant(id: &str, side: CombatSide, hit_points: i64, shield: i64) -> CombatantRuntime {
        CombatantRuntime {
            combatant_id: id.to_owned(),
            definition_id: format!("definition-{id}"),
            side,
            state: CombatantState::Active,
            hit_points,
            max_hit_points: 10,
            shield,
            max_shield: 4,
            action_points: 3,
            max_action_points: 3,
            reaction_charges: 1,
            max_reaction_charges: 1,
            resources: vec![ResourceState {
                resource_id: "resource-primary".to_owned(),
                current: 4,
                min_value: 0,
                max_value: 6,
                overheat_threshold: None,
                hard_max_value: None,
            }],
            statuses: vec![StatusRuntime {
                status_instance_id: format!("status-{id}"),
                definition_id: "status-guarded".to_owned(),
                source_id: id.to_owned(),
                stack_group_id: "guarded".to_owned(),
                stack_count: 1,
                remaining_duration: Some(2),
                duration_clock: DurationClock::OwnerTurn,
                application_sequence: 1,
            }],
            ability_usage: vec![AbilityUsageState {
                ability_id: "ability-basic-attack".to_owned(),
                cooldown_remaining: 0,
                uses_this_normal_owner_turn: 0,
                uses_this_battle: 0,
            }],
            basic_attack_count_this_normal_owner_turn: 0,
            once_usage_counters: vec![],
            initiative_result: 10,
            initiative_base_stat: 3,
            last_committed_timeline_order: None,
            solo_recovery_available: side == CombatSide::Player,
        }
    }
}

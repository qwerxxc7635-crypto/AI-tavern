use ember_combat_core::{
    AcceptedCombatCommand, AcceptedCommandLedger, CanonicalReactionCore, CombatReplayInput,
    CombatRng, CombatRngSnapshot, CombatState, CostSnapshot, EventSchedulerCheckpoint,
    ObjectiveRuntimeState, PendingReactionSnapshot, ReinforcementRuntimeState,
    ResolutionContextSnapshot,
};
use rusqlite::{OptionalExtension, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use thiserror::Error;

use crate::{CampaignStore, CampaignStoreError, current_timestamp};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CombatLoopGuardContract {
    pub max_trigger_depth: u32,
    pub max_event_count: u64,
}

#[derive(Debug, Clone)]
pub struct CombatCheckpointWrite<'a> {
    pub campaign_id: &'a str,
    pub initial_state: &'a CombatState,
    pub state: &'a CombatState,
    pub accepted_commands: &'a [AcceptedCombatCommand],
    pub events: &'a [Value],
    pub loop_guard: CombatLoopGuardContract,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CombatCheckpointReceipt {
    pub combat_instance_id: String,
    pub checkpoint_hash: String,
    pub persistence_revision: u64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct RestoredCombatCheckpoint {
    pub campaign_id: String,
    pub initial_state: CombatState,
    pub state: CombatState,
    pub accepted_commands: Vec<AcceptedCombatCommand>,
    pub events: Vec<Value>,
    pub loop_guard: CombatLoopGuardContract,
    pub persistence_revision: u64,
    pub checkpoint_hash: String,
}

#[derive(Debug, Error)]
pub enum CombatPersistenceError {
    #[error("combat checkpoint does not exist")]
    NotFound,
    #[error("combat checkpoint is structurally or semantically invalid")]
    InvalidCheckpoint,
    #[error("combat checkpoint would regress monotonic runtime state")]
    StateRegression,
    #[error("combat checkpoint uses unsupported combat versions")]
    IncompatibleVersion,
    #[error("combat persistence database operation failed")]
    Store(#[from] CampaignStoreError),
    #[error("combat persistence database operation failed")]
    Database(#[from] rusqlite::Error),
    #[error("combat checkpoint serialization failed")]
    Serialization(#[from] serde_json::Error),
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CheckpointHashPayload<'a> {
    state: &'a CombatState,
    loop_guard: CombatLoopGuardContract,
    objective: &'a ObjectiveRuntimeState,
    reinforcements: &'a ReinforcementRuntimeState,
    scheduler: &'a Option<EventSchedulerCheckpoint>,
    pending: &'a Option<PendingReactionSnapshot>,
    resolution: &'a Option<ResolutionContextSnapshot>,
    costs: &'a CostSnapshot,
}

impl CampaignStore {
    /// Atomically persists one stable runtime boundary. The IMMEDIATE transaction
    /// exists only for this call and is committed before control returns to a UI
    /// that may wait indefinitely for a reaction decision.
    pub fn save_combat_checkpoint(
        &self,
        write: CombatCheckpointWrite<'_>,
    ) -> Result<CombatCheckpointReceipt, CombatPersistenceError> {
        let parts = validate_and_partition(&write)?;
        let at = current_timestamp().map_err(CombatPersistenceError::Store)?;
        let mut connection = self.connect().map_err(CombatPersistenceError::Store)?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;

        let previous = transaction
            .query_row(
                "SELECT objective_runtime_state_json, reinforcement_runtime_state_json, revision
                 FROM active_combat_saves WHERE combat_instance_id=?1",
                [&write.state.combat_instance_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, i64>(2)?,
                    ))
                },
            )
            .optional()?;
        let persistence_revision =
            if let Some((objective_json, reinforcement_json, revision)) = previous {
                let old_objective: ObjectiveRuntimeState = serde_json::from_str(&objective_json)?;
                let old_reinforcements: ReinforcementRuntimeState =
                    serde_json::from_str(&reinforcement_json)?;
                ensure_monotonic(
                    &old_objective,
                    &parts.objective,
                    &old_reinforcements,
                    &parts.reinforcements,
                )?;
                u64::try_from(revision)
                    .map_err(|_| CombatPersistenceError::InvalidCheckpoint)?
                    .checked_add(1)
                    .ok_or(CombatPersistenceError::InvalidCheckpoint)?
            } else {
                1
            };

        let versions = write.state.versions;
        let initial_json = serde_json::to_string(write.initial_state)?;
        let initial_hash = write.initial_state.state_hash_sha256()?;
        let commands_json = serde_json::to_string(write.accepted_commands)?;
        let events_json = serde_json::to_string(write.events)?;
        let event_digest = digest(events_json.as_bytes());
        transaction.execute(
            "INSERT INTO battle_records (
               combat_instance_id,campaign_id,combat_schema_version,ruleset_version,balance_version,
               engine_version,world_profile_version,attribute_mapping_version,rng_contract_version,
               random_seed,initial_state_json,initial_state_hash,accepted_commands_json,events_json,
               event_digest,last_committed_sequence,created_at,updated_at
             ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?17)
             ON CONFLICT(combat_instance_id) DO UPDATE SET
               accepted_commands_json=excluded.accepted_commands_json,
               events_json=excluded.events_json,event_digest=excluded.event_digest,
               last_committed_sequence=excluded.last_committed_sequence,updated_at=excluded.updated_at",
            params![
                &write.state.combat_instance_id, write.campaign_id,
                version(versions.combat_schema_version), version(versions.ruleset_version),
                version(versions.balance_version), version(versions.engine_version),
                version(versions.world_profile_version), version(versions.attribute_mapping_version),
                version(versions.rng_contract_version), &write.state.random_seed, initial_json,
                initial_hash, commands_json, events_json, event_digest,
                as_i64(write.state.last_committed_sequence)?, &at,
            ],
        )?;

        let state_json = serde_json::to_string(write.state)?;
        let rng_json = serde_json::to_string(&write.state.rng)?;
        let objective_json = serde_json::to_string(&parts.objective)?;
        let reinforcements_json = serde_json::to_string(&parts.reinforcements)?;
        let scheduler_json = optional_json(&parts.scheduler)?;
        let loop_guard_json = serde_json::to_string(&write.loop_guard)?;
        let pending_json = optional_json(&parts.pending)?;
        let resolution_json = optional_json(&parts.resolution)?;
        let costs_json = serde_json::to_string(&parts.costs)?;
        let revision_i64 = as_i64(persistence_revision)?;
        transaction.execute(
            "INSERT INTO active_combat_saves (
               combat_instance_id,campaign_id,combat_schema_version,ruleset_version,balance_version,
               engine_version,world_profile_version,attribute_mapping_version,rng_contract_version,
               rng_streams_json,current_combat_state_json,checkpoint_hash,objective_runtime_state_json,
               reinforcement_runtime_state_json,event_scheduler_checkpoint_json,loop_guard_contract_json,
               pending_reaction_snapshot_json,resolution_context_snapshot_json,cost_snapshot_json,
               last_committed_sequence,revision,created_at,updated_at
             ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?22)
             ON CONFLICT(combat_instance_id) DO UPDATE SET
               rng_streams_json=excluded.rng_streams_json,current_combat_state_json=excluded.current_combat_state_json,
               checkpoint_hash=excluded.checkpoint_hash,objective_runtime_state_json=excluded.objective_runtime_state_json,
               reinforcement_runtime_state_json=excluded.reinforcement_runtime_state_json,
               event_scheduler_checkpoint_json=excluded.event_scheduler_checkpoint_json,
               loop_guard_contract_json=excluded.loop_guard_contract_json,
               pending_reaction_snapshot_json=excluded.pending_reaction_snapshot_json,
               resolution_context_snapshot_json=excluded.resolution_context_snapshot_json,
               cost_snapshot_json=excluded.cost_snapshot_json,last_committed_sequence=excluded.last_committed_sequence,
               revision=excluded.revision,updated_at=excluded.updated_at",
            params![
                &write.state.combat_instance_id, write.campaign_id,
                version(versions.combat_schema_version), version(versions.ruleset_version),
                version(versions.balance_version), version(versions.engine_version),
                version(versions.world_profile_version), version(versions.attribute_mapping_version),
                version(versions.rng_contract_version), rng_json, state_json, &parts.hash, objective_json,
                reinforcements_json, scheduler_json, loop_guard_json, pending_json, resolution_json,
                costs_json, as_i64(write.state.last_committed_sequence)?, revision_i64, &at,
            ],
        )?;
        transaction.commit()?;
        Ok(CombatCheckpointReceipt {
            combat_instance_id: write.state.combat_instance_id.clone(),
            checkpoint_hash: parts.hash,
            persistence_revision,
        })
    }

    pub fn restore_combat_checkpoint(
        &self,
        combat_instance_id: &str,
    ) -> Result<RestoredCombatCheckpoint, CombatPersistenceError> {
        let connection = self.connect().map_err(CombatPersistenceError::Store)?;
        let row = connection.query_row(
            "SELECT r.campaign_id,r.initial_state_json,r.initial_state_hash,r.accepted_commands_json,
                    r.events_json,r.event_digest,CAST(r.last_committed_sequence AS TEXT),
                    s.rng_streams_json,s.current_combat_state_json,s.checkpoint_hash,
                    s.objective_runtime_state_json,s.reinforcement_runtime_state_json,
                    s.event_scheduler_checkpoint_json,s.loop_guard_contract_json,
                    s.pending_reaction_snapshot_json,s.resolution_context_snapshot_json,
                    s.cost_snapshot_json,CAST(s.last_committed_sequence AS TEXT),CAST(s.revision AS TEXT)
             FROM battle_records r JOIN active_combat_saves s USING(combat_instance_id,campaign_id)
             WHERE r.combat_instance_id=?1",
            [combat_instance_id],
            |row| {
                (0..19)
                    .map(|index| row.get::<_, Option<String>>(index))
                    .collect::<Result<Vec<_>, _>>()
            },
        ).optional()?.ok_or(CombatPersistenceError::NotFound)?;
        restore_row(row)
    }

    /// Loads exactly the four deterministic replay inputs from BattleRecord.
    /// Events, wall-clock timestamps and the active checkpoint are deliberately
    /// excluded from this contract.
    pub fn load_combat_replay_input(
        &self,
        combat_instance_id: &str,
    ) -> Result<CombatReplayInput, CombatPersistenceError> {
        let connection = self.connect().map_err(CombatPersistenceError::Store)?;
        let (random_seed, initial_json, initial_hash, commands_json) = connection
            .query_row(
                "SELECT random_seed,initial_state_json,initial_state_hash,accepted_commands_json
                 FROM battle_records WHERE combat_instance_id=?1",
                [combat_instance_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                    ))
                },
            )
            .optional()?
            .ok_or(CombatPersistenceError::NotFound)?;
        let initial_state: CombatState = serde_json::from_str(&initial_json)?;
        let accepted_commands: Vec<AcceptedCombatCommand> = serde_json::from_str(&commands_json)?;
        validate_state(&initial_state)?;
        AcceptedCommandLedger::restore(accepted_commands.clone())
            .map_err(|_| CombatPersistenceError::InvalidCheckpoint)?;
        if initial_state.random_seed != random_seed
            || initial_state.state_hash_sha256()? != initial_hash
            || accepted_commands
                .iter()
                .any(|command| command.versions != initial_state.versions)
        {
            return Err(CombatPersistenceError::InvalidCheckpoint);
        }
        Ok(CombatReplayInput {
            versions: initial_state.versions,
            random_seed,
            initial_state,
            accepted_commands,
        })
    }
}

struct Parts {
    objective: ObjectiveRuntimeState,
    reinforcements: ReinforcementRuntimeState,
    scheduler: Option<EventSchedulerCheckpoint>,
    pending: Option<PendingReactionSnapshot>,
    resolution: Option<ResolutionContextSnapshot>,
    costs: CostSnapshot,
    hash: String,
}

fn validate_and_partition(
    write: &CombatCheckpointWrite<'_>,
) -> Result<Parts, CombatPersistenceError> {
    validate_state(write.initial_state)?;
    validate_state(write.state)?;
    if write.campaign_id.is_empty()
        || write.initial_state.combat_instance_id != write.state.combat_instance_id
        || write.initial_state.versions != write.state.versions
        || write.initial_state.random_seed != write.state.random_seed
    {
        return Err(CombatPersistenceError::InvalidCheckpoint);
    }
    AcceptedCommandLedger::restore(write.accepted_commands.to_vec())
        .map_err(|_| CombatPersistenceError::InvalidCheckpoint)?;
    if write
        .accepted_commands
        .iter()
        .any(|command| command.versions != write.state.versions)
        || write.events.iter().any(|event| !event.is_object())
    {
        return Err(CombatPersistenceError::InvalidCheckpoint);
    }
    if let Some(scheduler) = &write.state.scheduler {
        if scheduler.max_trigger_depth != write.loop_guard.max_trigger_depth
            || scheduler.max_event_count != write.loop_guard.max_event_count
        {
            return Err(CombatPersistenceError::InvalidCheckpoint);
        }
    } else if write.loop_guard.max_trigger_depth == 0 || write.loop_guard.max_event_count == 0 {
        return Err(CombatPersistenceError::InvalidCheckpoint);
    }
    let objective = write.state.objectives.clone();
    let reinforcements = write.state.reinforcements.clone();
    let scheduler = write.state.scheduler.clone();
    let costs = cost_snapshot(write.state);
    let (pending, resolution) = if write.state.pending_reaction.is_some() {
        let continuation = CanonicalReactionCore::continuation_snapshot(write.state)
            .map_err(|_| CombatPersistenceError::InvalidCheckpoint)?;
        (Some(continuation.pending), Some(continuation.resolution))
    } else {
        (
            None,
            write
                .state
                .resolution_context
                .clone()
                .map(|context| ResolutionContextSnapshot {
                    context,
                    rng: write.state.rng.clone(),
                }),
        )
    };
    let payload = CheckpointHashPayload {
        state: write.state,
        loop_guard: write.loop_guard,
        objective: &objective,
        reinforcements: &reinforcements,
        scheduler: &scheduler,
        pending: &pending,
        resolution: &resolution,
        costs: &costs,
    };
    let hash = digest(&serde_json::to_vec(&payload)?);
    Ok(Parts {
        objective,
        reinforcements,
        scheduler,
        pending,
        resolution,
        costs,
        hash,
    })
}

fn validate_state(state: &CombatState) -> Result<(), CombatPersistenceError> {
    state
        .versions
        .ensure_supported()
        .map_err(|_| CombatPersistenceError::IncompatibleVersion)?;
    state
        .validate_for_commit()
        .map_err(|_| CombatPersistenceError::InvalidCheckpoint)?;
    if state.rng.rng_contract_version != state.versions.rng_contract_version {
        return Err(CombatPersistenceError::InvalidCheckpoint);
    }
    CombatRng::restore(state.rng.clone()).map_err(|_| CombatPersistenceError::InvalidCheckpoint)?;
    Ok(())
}

fn cost_snapshot(state: &CombatState) -> CostSnapshot {
    CostSnapshot {
        combatants: state
            .combatants
            .iter()
            .map(|combatant| ember_combat_core::CombatantCostSnapshot {
                combatant_id: combatant.combatant_id.clone(),
                action_points: combatant.action_points,
                reaction_charges: combatant.reaction_charges,
                resources: combatant.resources.clone(),
            })
            .collect(),
        inventory: state.combat_inventory.clone(),
        reservations: state.cost_reservations.clone(),
    }
}

fn ensure_monotonic(
    old_objective: &ObjectiveRuntimeState,
    new_objective: &ObjectiveRuntimeState,
    old_reinforcements: &ReinforcementRuntimeState,
    new_reinforcements: &ReinforcementRuntimeState,
) -> Result<(), CombatPersistenceError> {
    if old_objective
        .failed_objective_ids
        .iter()
        .any(|id| !new_objective.failed_objective_ids.contains(id))
        || old_objective
            .failure_records
            .iter()
            .any(|record| !new_objective.failure_records.contains(record))
    {
        return Err(CombatPersistenceError::StateRegression);
    }
    for old in &old_reinforcements.reinforcements {
        let new = new_reinforcements
            .reinforcements
            .iter()
            .find(|candidate| candidate.combatant_id == old.combatant_id)
            .ok_or(CombatPersistenceError::StateRegression)?;
        if (old.is_deployed && !new.is_deployed)
            || old.initiative_result != new.initiative_result
            || old.initiative_base_stat != new.initiative_base_stat
        {
            return Err(CombatPersistenceError::StateRegression);
        }
    }
    Ok(())
}

fn restore_row(
    row: Vec<Option<String>>,
) -> Result<RestoredCombatCheckpoint, CombatPersistenceError> {
    let required = |index: usize| {
        row[index]
            .as_ref()
            .ok_or(CombatPersistenceError::InvalidCheckpoint)
    };
    let campaign_id = required(0)?.clone();
    let initial_state: CombatState = serde_json::from_str(required(1)?)?;
    if initial_state.state_hash_sha256()? != required(2)?.as_str() {
        return Err(CombatPersistenceError::InvalidCheckpoint);
    }
    let accepted_commands: Vec<AcceptedCombatCommand> = serde_json::from_str(required(3)?)?;
    let events: Vec<Value> = serde_json::from_str(required(4)?)?;
    if digest(required(4)?.as_bytes()) != required(5)?.as_str() {
        return Err(CombatPersistenceError::InvalidCheckpoint);
    }
    let record_sequence = parse_u64(required(6)?)?;
    let rng: CombatRngSnapshot = serde_json::from_str(required(7)?)?;
    let state: CombatState = serde_json::from_str(required(8)?)?;
    let checkpoint_hash = required(9)?.clone();
    let objective: ObjectiveRuntimeState = serde_json::from_str(required(10)?)?;
    let reinforcements: ReinforcementRuntimeState = serde_json::from_str(required(11)?)?;
    let scheduler: Option<EventSchedulerCheckpoint> = parse_optional(&row[12])?;
    let loop_guard: CombatLoopGuardContract = serde_json::from_str(required(13)?)?;
    let pending: Option<PendingReactionSnapshot> = parse_optional(&row[14])?;
    let resolution: Option<ResolutionContextSnapshot> = parse_optional(&row[15])?;
    let costs: CostSnapshot = serde_json::from_str(required(16)?)?;
    let save_sequence = parse_u64(required(17)?)?;
    let persistence_revision = parse_u64(required(18)?)?;
    let write = CombatCheckpointWrite {
        campaign_id: &campaign_id,
        initial_state: &initial_state,
        state: &state,
        accepted_commands: &accepted_commands,
        events: &events,
        loop_guard,
    };
    let parts = validate_and_partition(&write)?;
    if rng != state.rng
        || objective != parts.objective
        || reinforcements != parts.reinforcements
        || scheduler != parts.scheduler
        || pending != parts.pending
        || resolution != parts.resolution
        || costs != parts.costs
        || checkpoint_hash != parts.hash
        || record_sequence != state.last_committed_sequence
        || save_sequence != state.last_committed_sequence
    {
        return Err(CombatPersistenceError::InvalidCheckpoint);
    }
    Ok(RestoredCombatCheckpoint {
        campaign_id,
        initial_state,
        state,
        accepted_commands,
        events,
        loop_guard,
        persistence_revision,
        checkpoint_hash,
    })
}

fn optional_json<T: Serialize>(value: &Option<T>) -> Result<Option<String>, serde_json::Error> {
    value.as_ref().map(serde_json::to_string).transpose()
}
fn parse_optional<T: for<'de> Deserialize<'de>>(
    value: &Option<String>,
) -> Result<Option<T>, serde_json::Error> {
    value
        .as_ref()
        .map(|json| serde_json::from_str(json))
        .transpose()
}
fn version(value: ember_combat_core::CombatVersion) -> i64 {
    i64::from(value.get())
}
fn as_i64(value: u64) -> Result<i64, CombatPersistenceError> {
    i64::try_from(value).map_err(|_| CombatPersistenceError::InvalidCheckpoint)
}
fn parse_u64(value: &str) -> Result<u64, CombatPersistenceError> {
    value
        .parse()
        .map_err(|_| CombatPersistenceError::InvalidCheckpoint)
}
fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use ember_combat_core::*;
    use rusqlite::Connection;
    use serde_json::json;

    use super::*;

    const SEED: &str = "00112233445566778899aabbccddeeff";

    #[test]
    fn crash_resume_preserves_pending_reaction_and_continues_deterministically() {
        let directory = tempfile::tempdir().unwrap();
        let database_path = directory.path().join("combat.sqlite");
        let store = CampaignStore::open(&database_path).unwrap();
        let campaign = store.create_campaign().unwrap();
        let initial = fixture_state();
        let (mut live, ledger, bindings, assignments) = pending_reaction_state();
        let events = vec![json!({"sequence": 1, "kind": "REACTION_WINDOW_OPENED"})];

        let receipt = store
            .save_combat_checkpoint(CombatCheckpointWrite {
                campaign_id: &campaign.id,
                initial_state: &initial,
                state: &live,
                accepted_commands: ledger.commands(),
                events: &events,
                loop_guard: guard(),
            })
            .unwrap();
        assert_eq!(receipt.persistence_revision, 1);

        // A second writer succeeds while the reaction remains unresolved: the
        // save call did not leak its SQLite transaction into the user wait.
        let second = Connection::open(&database_path).unwrap();
        second.busy_timeout(Duration::from_millis(50)).unwrap();
        second
            .execute(
                "UPDATE campaigns SET updated_at=updated_at WHERE id=?1",
                [&campaign.id],
            )
            .unwrap();
        drop(store);

        let reopened = CampaignStore::open(&database_path).unwrap();
        let restored = reopened
            .restore_combat_checkpoint(&live.combat_instance_id)
            .unwrap();
        let replay_input = reopened
            .load_combat_replay_input(&live.combat_instance_id)
            .unwrap();
        assert_eq!(replay_input.versions, initial.versions);
        assert_eq!(replay_input.random_seed, initial.random_seed);
        assert_eq!(replay_input.initial_state, initial);
        assert_eq!(replay_input.accepted_commands, ledger.commands());
        assert_eq!(restored.state, live);
        assert_eq!(restored.state.rng, live.rng);
        assert_eq!(restored.state.scheduler, live.scheduler);
        assert_eq!(restored.state.pending_reaction, live.pending_reaction);
        assert_eq!(restored.state.resolution_context, live.resolution_context);
        assert_eq!(restored.state.cost_reservations, live.cost_reservations);
        assert_eq!(restored.checkpoint_hash, receipt.checkpoint_hash);
        assert_eq!(
            restored
                .state
                .scheduler
                .as_ref()
                .unwrap()
                .executed_event_count,
            live.scheduler.as_ref().unwrap().executed_event_count,
        );

        let window_id = live.pending_reaction.as_ref().unwrap().window_id.clone();
        let decision = CombatCommandEnvelope {
            command_id: "decision-after-crash".into(),
            source: CombatCommandSource::Player {
                controller_id: "controller-a".into(),
            },
            actor_id: "actor-a".into(),
            versions: CURRENT_COMBAT_VERSIONS,
            payload: CombatCommandPayload::ResolveReaction {
                reaction_window_id: window_id,
                choice: ReactionDecisionChoice::Trigger,
                selected_reaction_id: Some("reaction-ask".into()),
            },
        };
        let mut live_ledger = ledger.clone();
        let mut resumed_ledger =
            AcceptedCommandLedger::restore(restored.accepted_commands).unwrap();
        let mut resumed = restored.state;
        let live_outcome = CanonicalReactionCore::resolve_ask_window(
            &mut live,
            &mut live_ledger,
            decision.clone(),
            &bindings,
            &assignments,
        )
        .unwrap();
        let resumed_outcome = CanonicalReactionCore::resolve_ask_window(
            &mut resumed,
            &mut resumed_ledger,
            decision,
            &bindings,
            &assignments,
        )
        .unwrap();
        assert_eq!(live_outcome, resumed_outcome);
        assert_eq!(live, resumed);
        assert_eq!(live_ledger.commands(), resumed_ledger.commands());
    }

    #[test]
    fn repeated_save_advances_only_persistence_revision_and_rejects_tampering() {
        let directory = tempfile::tempdir().unwrap();
        let database_path = directory.path().join("combat.sqlite");
        let store = CampaignStore::open(&database_path).unwrap();
        let campaign = store.create_campaign().unwrap();
        let state = fixture_state();
        let events = vec![json!({"sequence": 0, "kind": "COMBAT_STARTED"})];
        let write = || CombatCheckpointWrite {
            campaign_id: &campaign.id,
            initial_state: &state,
            state: &state,
            accepted_commands: &[],
            events: &events,
            loop_guard: guard(),
        };
        assert_eq!(
            store
                .save_combat_checkpoint(write())
                .unwrap()
                .persistence_revision,
            1
        );
        assert_eq!(
            store
                .save_combat_checkpoint(write())
                .unwrap()
                .persistence_revision,
            2
        );

        let connection = Connection::open(&database_path).unwrap();
        connection.execute(
            "UPDATE active_combat_saves SET rng_streams_json=json_set(rng_streams_json,'$.streams[0].cursor',99),
                    revision=revision+1
             WHERE combat_instance_id=?1",
            [&state.combat_instance_id],
        ).unwrap();
        assert!(matches!(
            store.restore_combat_checkpoint(&state.combat_instance_id),
            Err(CombatPersistenceError::InvalidCheckpoint)
        ));
    }

    #[test]
    fn loop_guard_limits_are_frozen_instead_of_replaced_by_current_defaults() {
        let directory = tempfile::tempdir().unwrap();
        let store = CampaignStore::open(directory.path().join("combat.sqlite")).unwrap();
        let campaign = store.create_campaign().unwrap();
        let initial = fixture_state();
        let mut active = initial.clone();
        CanonicalEventChainScheduler::begin(&mut active, "chain-frozen".into(), 7, 19).unwrap();
        let result = store.save_combat_checkpoint(CombatCheckpointWrite {
            campaign_id: &campaign.id,
            initial_state: &initial,
            state: &active,
            accepted_commands: &[],
            events: &[],
            loop_guard: CombatLoopGuardContract {
                max_trigger_depth: 32,
                max_event_count: 256,
            },
        });
        assert!(matches!(
            result,
            Err(CombatPersistenceError::InvalidCheckpoint)
        ));
    }

    fn pending_reaction_state() -> (
        CombatState,
        AcceptedCommandLedger,
        Vec<ReactionBinding>,
        Vec<CombatControlAssignment>,
    ) {
        let mut state = fixture_state();
        let mut ledger = AcceptedCommandLedger::new();
        let accepted = ledger
            .accept_external(CombatCommandEnvelope {
                command_id: "command-attack".into(),
                source: CombatCommandSource::Player {
                    controller_id: "controller-a".into(),
                },
                actor_id: "actor-a".into(),
                versions: CURRENT_COMBAT_VERSIONS,
                payload: CombatCommandPayload::UseAbility {
                    ability_id: "ability-attack".into(),
                    target_id: Some("actor-b".into()),
                },
            })
            .unwrap();
        ResolutionContextLifecycle::create(&mut state, accepted.command, "chain-1".into(), None)
            .unwrap();
        for (from, to) in [
            (HookPhase::PreAction, HookPhase::BeforeRoll),
            (HookPhase::BeforeRoll, HookPhase::AfterRoll),
            (HookPhase::AfterRoll, HookPhase::Outcome),
            (HookPhase::Outcome, HookPhase::PreEffect),
        ] {
            ResolutionContextLifecycle::complete_hook(&mut state, from, to).unwrap();
        }
        CanonicalEventChainScheduler::begin(&mut state, "chain-1".into(), 32, 256).unwrap();
        let bindings = vec![ReactionBinding {
            owner_combatant_id: "actor-a".into(),
            definition: ReactionDefinition {
                reaction_schema_version: CURRENT_REACTION_SCHEMA_VERSION,
                reaction_id: "reaction-ask".into(),
                hook_phase: HookPhase::PreEffect,
                priority: 10,
                mode: ReactionExecutionMode::Ask,
                costs: vec![CombatCostRequestLine {
                    cost_id: "reaction-charge".into(),
                    asset: CombatCostAsset::ReactionCharge {
                        combatant_id: "actor-a".into(),
                    },
                    amount: 1,
                    consume_cost_on_interrupt: false,
                }],
                effects: vec![EffectDefinition::Heal {
                    amount: EffectAmount::Flat { amount: 1 },
                }],
            },
        }];
        let assignments = vec![
            CombatControlAssignment {
                combatant_id: "actor-a".into(),
                authority: CombatControlAuthority::Player {
                    controller_id: "controller-a".into(),
                },
            },
            CombatControlAssignment {
                combatant_id: "actor-b".into(),
                authority: CombatControlAuthority::UtilityAi,
            },
        ];
        CanonicalReactionCore::enqueue_roots(&mut state, &bindings).unwrap();
        CanonicalEventChainScheduler::dequeue_next(&mut state)
            .unwrap()
            .unwrap();
        assert!(matches!(
            CanonicalReactionCore::route_current(&mut state, &bindings, &assignments, None)
                .unwrap(),
            ReactionRouteOutcome::AskWindowOpened(_)
        ));
        (state, ledger, bindings, assignments)
    }

    fn fixture_state() -> CombatState {
        let combatant = |id: &str, side: CombatSide| CombatantRuntime {
            combatant_id: id.into(),
            definition_id: format!("definition-{id}"),
            side,
            state: CombatantState::Active,
            hit_points: 10,
            max_hit_points: 10,
            shield: 0,
            max_shield: 0,
            action_points: 3,
            max_action_points: 3,
            reaction_charges: 1,
            max_reaction_charges: 1,
            resources: vec![],
            statuses: vec![],
            ability_usage: vec![AbilityUsageState {
                ability_id: "ability-attack".into(),
                cooldown_remaining: 0,
                uses_this_normal_owner_turn: 0,
                uses_this_battle: 0,
            }],
            basic_attack_count_this_normal_owner_turn: 0,
            once_usage_counters: vec![],
            normal_owner_turn_index: 0,
            hard_cc_dr: HardCcDrRuntime::default(),
            shield_recharge: ShieldRechargeRuntime::default(),
            initiative_result: 10,
            initiative_base_stat: 2,
            last_committed_timeline_order: None,
            solo_recovery_available: false,
        };
        CombatState {
            combat_instance_id: "combat-persistence-fixture".into(),
            versions: CURRENT_COMBAT_VERSIONS,
            random_seed: SEED.into(),
            revision: 1,
            last_committed_sequence: 0,
            phase: CombatPhase::Action,
            combatants: vec![
                combatant("actor-a", CombatSide::Player),
                combatant("actor-b", CombatSide::Companion),
            ],
            formal_party_member_ids: vec!["actor-a".into(), "actor-b".into()],
            combat_inventory: vec![],
            cost_reservations: vec![],
            resolution_context: None,
            timeline: vec![
                TimelineEntry {
                    combatant_id: "actor-a".into(),
                    initiative_result: 10,
                    initiative_base_stat: 2,
                    is_extra_turn: false,
                    source_sequence: 1,
                },
                TimelineEntry {
                    combatant_id: "actor-b".into(),
                    initiative_result: 9,
                    initiative_base_stat: 2,
                    is_extra_turn: false,
                    source_sequence: 2,
                },
            ],
            round: RoundRuntimeState {
                round_number: 1,
                completed_round_count: 0,
                active_combatant_id: Some("actor-a".into()),
                extra_turn_resume_phase: None,
                roster: vec![
                    RoundRosterEntry {
                        combatant_id: "actor-a".into(),
                        normal_turn_slot: 0,
                        status: RoundRosterStatus::Pending,
                    },
                    RoundRosterEntry {
                        combatant_id: "actor-b".into(),
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
            terminal_priority_policy: TerminalPriorityPolicy::default(),
            confirmed_result_candidate_id: None,
            confirmed_result: None,
            rng: CombatRng::new(
                SEED,
                "combat-persistence-fixture",
                CURRENT_COMBAT_VERSIONS.rng_contract_version,
            )
            .unwrap()
            .snapshot(),
        }
    }

    const fn guard() -> CombatLoopGuardContract {
        CombatLoopGuardContract {
            max_trigger_depth: 32,
            max_event_count: 256,
        }
    }
}

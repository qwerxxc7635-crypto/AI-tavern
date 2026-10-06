use ember_combat_core::{
    AcceptedCombatCommand, AcceptedCommandLedger, CanonicalReactionCore, CombatReplayInput,
    CombatRng, CombatRngSnapshot, CombatState, CostSnapshot, EventSchedulerCheckpoint,
    ObjectiveRuntimeState, PendingReactionSnapshot, PreCombatSnapshot, ReinforcementRuntimeState,
    ResolutionContextSnapshot, RuntimeCommitContract, RuntimeFinalizationPlan,
    RuntimeFinalizationRequest,
};
use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use thiserror::Error;

use crate::{
    AuthoredEncounterEvent, AuthoredEncounterOrigin, CampaignStore, CampaignStoreError,
    current_timestamp,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CombatLoopGuardContract {
    pub max_trigger_depth: u32,
    pub max_event_count: u64,
}

#[derive(Debug, Clone)]
pub struct CombatCheckpointWrite<'a> {
    pub campaign_id: &'a str,
    pub expected_persistence_revision: Option<u64>,
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
    #[error("combat checkpoint was changed by another writer")]
    CheckpointRevisionConflict,
    #[error("combat checkpoint uses unsupported combat versions")]
    IncompatibleVersion,
    #[error("combat result is not ready for canonical commit")]
    ResultNotReady,
    #[error("combat result commit identity conflicts with durable state")]
    ResultCommitConflict,
    #[error("combat persistence database operation failed")]
    Store(#[from] CampaignStoreError),
    #[error("combat persistence database operation failed")]
    Database(#[from] rusqlite::Error),
    #[error("combat checkpoint serialization failed")]
    Serialization(#[from] serde_json::Error),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CombatResultCommitStatus {
    Committed,
    AlreadyCommitted,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CombatResultCommitReceipt {
    pub status: CombatResultCommitStatus,
    pub combat_instance_id: String,
    pub result_commit_id: String,
    pub canonical_delta_hash: String,
    pub committed_at: String,
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
        let authored_origin = authored_origin_from_events(write.events)?;
        if let Some(origin) = &authored_origin {
            origin
                .validate_initial_state(write.campaign_id, write.initial_state)
                .map_err(|_| CombatPersistenceError::InvalidCheckpoint)?;
        }
        let at = current_timestamp().map_err(CombatPersistenceError::Store)?;
        let mut connection = self.connect().map_err(CombatPersistenceError::Store)?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let initial_hash = write.initial_state.state_hash_sha256()?;

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
        let actual_revision = previous
            .as_ref()
            .map(|(_, _, revision)| {
                u64::try_from(*revision).map_err(|_| CombatPersistenceError::InvalidCheckpoint)
            })
            .transpose()?;
        if actual_revision != write.expected_persistence_revision {
            return Err(CombatPersistenceError::CheckpointRevisionConflict);
        }
        let historical = transaction
            .query_row(
                "SELECT campaign_id,initial_state_hash,result_commit_id,events_json
                 FROM battle_records WHERE combat_instance_id=?1",
                [&write.state.combat_instance_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, Option<String>>(2)?,
                        row.get::<_, String>(3)?,
                    ))
                },
            )
            .optional()?;
        match (actual_revision, historical) {
            (None, Some(_)) => return Err(CombatPersistenceError::ResultCommitConflict),
            (Some(_), Some((campaign, hash, None, historical_events)))
                if campaign == write.campaign_id && hash == initial_hash =>
            {
                let historical_values: Vec<Value> = serde_json::from_str(&historical_events)?;
                if authored_origin_from_events(&historical_values)? != authored_origin {
                    return Err(CombatPersistenceError::InvalidCheckpoint);
                }
            }
            (Some(_), _) => return Err(CombatPersistenceError::ResultCommitConflict),
            (None, None) => {}
        }
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
        ensure_combat_started_fact(
            &transaction,
            write.campaign_id,
            &write.state.combat_instance_id,
            &initial_hash,
            authored_origin.as_ref(),
            &at,
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

    /// Commits the canonical domain mutation and its BattleRecord marker in one
    /// SQLite transaction. Retries inspect the marker before invoking the
    /// supplied existing-domain transaction body.
    pub fn commit_combat_result_with<F>(
        &self,
        campaign_id: &str,
        state: &CombatState,
        precombat_snapshot: &PreCombatSnapshot,
        finalization: RuntimeFinalizationRequest,
        apply_domain_delta: F,
    ) -> Result<CombatResultCommitReceipt, CombatPersistenceError>
    where
        F: FnOnce(
            &rusqlite::Transaction<'_>,
            &RuntimeFinalizationPlan,
        ) -> Result<(), CampaignStoreError>,
    {
        let plan =
            RuntimeCommitContract::build_finalization_plan(state, precombat_snapshot, finalization)
                .map_err(|_| CombatPersistenceError::ResultNotReady)?;
        let at = current_timestamp().map_err(CombatPersistenceError::Store)?;
        let mut connection = self.connect().map_err(CombatPersistenceError::Store)?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;

        if let Some((owner_combat_id, owner_hash)) = transaction
            .query_row(
                "SELECT combat_instance_id,canonical_delta_hash FROM battle_records
                 WHERE result_commit_id=?1",
                [&plan.result_commit_id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .optional()?
            && (owner_combat_id != state.combat_instance_id
                || owner_hash != plan.canonical_delta_hash_sha256)
        {
            return Err(CombatPersistenceError::ResultCommitConflict);
        }

        let stored = transaction
            .query_row(
                "SELECT campaign_id,combat_result,result_commit_id,canonical_delta_hash,
                        canonical_result_committed_at
                 FROM battle_records WHERE combat_instance_id=?1",
                [&state.combat_instance_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, Option<String>>(1)?,
                        row.get::<_, Option<String>>(2)?,
                        row.get::<_, Option<String>>(3)?,
                        row.get::<_, Option<String>>(4)?,
                    ))
                },
            )
            .optional()?
            .ok_or(CombatPersistenceError::NotFound)?;
        if stored.0 != campaign_id {
            return Err(CombatPersistenceError::ResultCommitConflict);
        }
        if let (Some(result), Some(commit_id), Some(delta_hash), Some(committed_at)) =
            (&stored.1, &stored.2, &stored.3, &stored.4)
        {
            if result != result_name(plan.result_type)
                || commit_id != &plan.result_commit_id
                || delta_hash != &plan.canonical_delta_hash_sha256
            {
                return Err(CombatPersistenceError::ResultCommitConflict);
            }
            validate_combat_finished_fact(
                &transaction,
                campaign_id,
                &state.combat_instance_id,
                result,
                commit_id,
                delta_hash,
            )?;
            transaction.commit()?;
            return Ok(CombatResultCommitReceipt {
                status: CombatResultCommitStatus::AlreadyCommitted,
                combat_instance_id: state.combat_instance_id.clone(),
                result_commit_id: commit_id.clone(),
                canonical_delta_hash: delta_hash.clone(),
                committed_at: committed_at.clone(),
            });
        }
        if stored.1.is_some() || stored.2.is_some() || stored.3.is_some() || stored.4.is_some() {
            return Err(CombatPersistenceError::ResultCommitConflict);
        }

        let active_state_json = transaction
            .query_row(
                "SELECT current_combat_state_json FROM active_combat_saves
                 WHERE combat_instance_id=?1 AND campaign_id=?2",
                params![&state.combat_instance_id, campaign_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?
            .ok_or(CombatPersistenceError::ResultNotReady)?;
        let active_state: CombatState = serde_json::from_str(&active_state_json)?;
        if &active_state != state {
            return Err(CombatPersistenceError::ResultNotReady);
        }

        apply_domain_delta(&transaction, &plan).map_err(CombatPersistenceError::Store)?;
        let changed = transaction.execute(
            "UPDATE battle_records SET combat_result=?1,result_commit_id=?2,
                    canonical_delta_hash=?3,canonical_result_committed_at=?4,updated_at=?4
             WHERE combat_instance_id=?5 AND campaign_id=?6 AND result_commit_id IS NULL",
            params![
                result_name(plan.result_type),
                &plan.result_commit_id,
                &plan.canonical_delta_hash_sha256,
                &at,
                &state.combat_instance_id,
                campaign_id,
            ],
        )?;
        if changed != 1 {
            return Err(CombatPersistenceError::ResultCommitConflict);
        }
        insert_combat_finished_fact(
            &transaction,
            campaign_id,
            &state.combat_instance_id,
            result_name(plan.result_type),
            &plan.result_commit_id,
            &plan.canonical_delta_hash_sha256,
            &at,
        )?;
        transaction.commit()?;
        Ok(CombatResultCommitReceipt {
            status: CombatResultCommitStatus::Committed,
            combat_instance_id: state.combat_instance_id.clone(),
            result_commit_id: plan.result_commit_id,
            canonical_delta_hash: plan.canonical_delta_hash_sha256,
            committed_at: at,
        })
    }

    /// Idempotently removes a resumable checkpoint only after the durable
    /// canonical result marker proves which transaction succeeded.
    pub fn complete_combat_result_cleanup(
        &self,
        combat_instance_id: &str,
        result_commit_id: &str,
    ) -> Result<bool, CombatPersistenceError> {
        let mut connection = self.connect().map_err(CombatPersistenceError::Store)?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let marker = transaction
            .query_row(
                "SELECT result_commit_id FROM battle_records WHERE combat_instance_id=?1",
                [combat_instance_id],
                |row| row.get::<_, Option<String>>(0),
            )
            .optional()?
            .ok_or(CombatPersistenceError::NotFound)?;
        if marker.as_deref() != Some(result_commit_id) {
            return Err(CombatPersistenceError::ResultCommitConflict);
        }
        let removed = transaction.execute(
            "DELETE FROM active_combat_saves WHERE combat_instance_id=?1",
            [combat_instance_id],
        )?;
        transaction.commit()?;
        Ok(removed == 1)
    }
}

pub(crate) fn validate_combat_archive_compatibility(
    connection: &Connection,
    campaign_id: &str,
) -> Result<(), CampaignStoreError> {
    let combat_ids = connection
        .prepare(
            "SELECT combat_instance_id FROM battle_records
             WHERE campaign_id=?1 ORDER BY combat_instance_id",
        )?
        .query_map([campaign_id], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    for combat_id in &combat_ids {
        validate_archive_battle_record(connection, campaign_id, combat_id)?;
    }
    let active_ids = connection
        .prepare(
            "SELECT combat_instance_id FROM active_combat_saves
             WHERE campaign_id=?1 ORDER BY combat_instance_id",
        )?
        .query_map([campaign_id], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    for combat_id in active_ids {
        load_combat_checkpoint_row(connection, &combat_id)
            .and_then(restore_row)
            .map_err(archive_combat_error)?;
    }
    Ok(())
}

fn validate_archive_battle_record(
    connection: &Connection,
    campaign_id: &str,
    combat_instance_id: &str,
) -> Result<(), CampaignStoreError> {
    let row = connection.query_row(
        "SELECT combat_schema_version,ruleset_version,balance_version,engine_version,
                world_profile_version,attribute_mapping_version,rng_contract_version,
                random_seed,initial_state_json,initial_state_hash,accepted_commands_json,
                events_json,event_digest
         FROM battle_records WHERE campaign_id=?1 AND combat_instance_id=?2",
        params![campaign_id, combat_instance_id],
        |row| {
            Ok((
                [
                    row.get::<_, i64>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, i64>(4)?,
                    row.get::<_, i64>(5)?,
                    row.get::<_, i64>(6)?,
                ],
                row.get::<_, String>(7)?,
                row.get::<_, String>(8)?,
                row.get::<_, String>(9)?,
                row.get::<_, String>(10)?,
                row.get::<_, String>(11)?,
                row.get::<_, String>(12)?,
            ))
        },
    )?;
    let supported_versions = [
        version(ember_combat_core::CURRENT_COMBAT_VERSIONS.combat_schema_version),
        version(ember_combat_core::CURRENT_COMBAT_VERSIONS.ruleset_version),
        version(ember_combat_core::CURRENT_COMBAT_VERSIONS.balance_version),
        version(ember_combat_core::CURRENT_COMBAT_VERSIONS.engine_version),
        version(ember_combat_core::CURRENT_COMBAT_VERSIONS.world_profile_version),
        version(ember_combat_core::CURRENT_COMBAT_VERSIONS.attribute_mapping_version),
        version(ember_combat_core::CURRENT_COMBAT_VERSIONS.rng_contract_version),
    ];
    if row.0 != supported_versions {
        return Err(CampaignStoreError::IncompatibleSchema);
    }
    let initial: CombatState =
        serde_json::from_str(&row.2).map_err(|_| CampaignStoreError::ArchiveInvalid)?;
    validate_state(&initial).map_err(archive_combat_error)?;
    let expected_versions = [
        version(initial.versions.combat_schema_version),
        version(initial.versions.ruleset_version),
        version(initial.versions.balance_version),
        version(initial.versions.engine_version),
        version(initial.versions.world_profile_version),
        version(initial.versions.attribute_mapping_version),
        version(initial.versions.rng_contract_version),
    ];
    if row.0 != expected_versions
        || initial.combat_instance_id != combat_instance_id
        || initial.random_seed != row.1
        || initial
            .state_hash_sha256()
            .map_err(|_| CampaignStoreError::ArchiveInvalid)?
            != row.3
    {
        return Err(CampaignStoreError::ArchiveInvalid);
    }
    let commands: Vec<AcceptedCombatCommand> =
        serde_json::from_str(&row.4).map_err(|_| CampaignStoreError::ArchiveInvalid)?;
    AcceptedCommandLedger::restore(commands).map_err(|_| CampaignStoreError::ArchiveInvalid)?;
    let events: Vec<Value> =
        serde_json::from_str(&row.5).map_err(|_| CampaignStoreError::ArchiveInvalid)?;
    if events.iter().any(|event| !event.is_object()) || digest(row.5.as_bytes()) != row.6 {
        return Err(CampaignStoreError::ArchiveInvalid);
    }
    Ok(())
}

fn load_combat_checkpoint_row(
    connection: &Connection,
    combat_instance_id: &str,
) -> Result<Vec<Option<String>>, CombatPersistenceError> {
    connection.query_row(
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
    ).optional()?.ok_or(CombatPersistenceError::NotFound)
}

fn archive_combat_error(error: CombatPersistenceError) -> CampaignStoreError {
    match error {
        CombatPersistenceError::IncompatibleVersion => CampaignStoreError::IncompatibleSchema,
        _ => CampaignStoreError::ArchiveInvalid,
    }
}

fn authored_origin_from_events(
    events: &[Value],
) -> Result<Option<AuthoredEncounterOrigin>, CombatPersistenceError> {
    if events
        .iter()
        .skip(1)
        .any(|value| value.get("kind").and_then(Value::as_str) == Some("ENCOUNTER_STARTED"))
    {
        return Err(CombatPersistenceError::InvalidCheckpoint);
    }
    match events.first() {
        Some(value) if value.get("kind").and_then(Value::as_str) == Some("ENCOUNTER_STARTED") => {
            AuthoredEncounterEvent::from_first_event(value)
                .map(Some)
                .map_err(|_| CombatPersistenceError::InvalidCheckpoint)
        }
        _ => Ok(None),
    }
}

fn ensure_combat_started_fact(
    transaction: &rusqlite::Transaction<'_>,
    campaign_id: &str,
    combat_instance_id: &str,
    initial_state_hash: &str,
    authored_origin: Option<&AuthoredEncounterOrigin>,
    occurred_at: &str,
) -> Result<(), CombatPersistenceError> {
    let expected_id = format!("combat-ledger-start:{combat_instance_id}");
    let expected_operation = format!("combat-start:{combat_instance_id}");
    let mut expected_payload = serde_json::json!({
        "combatInstanceId": combat_instance_id,
        "event": "combat.started",
        "initialStateHash": initial_state_hash,
    });
    if let Some(origin) = authored_origin {
        expected_payload["encounterOrigin"] = serde_json::to_value(origin)?;
    }
    let stored = transaction
        .query_row(
            "SELECT id,campaign_id,event_type,operation_id,payload_json,payload_version,source
             FROM event_ledger WHERE aggregate_type='COMBAT' AND aggregate_id=?1 AND revision=1",
            [combat_instance_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, i64>(5)?,
                    row.get::<_, String>(6)?,
                ))
            },
        )
        .optional()?;
    if let Some((id, campaign, event_type, operation, payload, version, source)) = stored {
        if id != expected_id
            || campaign != campaign_id
            || event_type != "COMBAT_STARTED"
            || operation != expected_operation
            || serde_json::from_str::<Value>(&payload)? != expected_payload
            || version != 1
            || source != "SYSTEM"
        {
            return Err(CombatPersistenceError::ResultCommitConflict);
        }
        return Ok(());
    }
    transaction.execute(
        "INSERT INTO event_ledger (
           id,campaign_id,event_type,operation_id,aggregate_type,aggregate_id,revision,
           payload_json,payload_version,source,occurred_at
         ) VALUES (?1,?2,'COMBAT_STARTED',?3,'COMBAT',?4,1,?5,1,'SYSTEM',?6)",
        params![
            expected_id,
            campaign_id,
            expected_operation,
            combat_instance_id,
            serde_json::to_string(&expected_payload)?,
            occurred_at,
        ],
    )?;
    Ok(())
}

fn insert_combat_finished_fact(
    transaction: &rusqlite::Transaction<'_>,
    campaign_id: &str,
    combat_instance_id: &str,
    combat_result: &str,
    result_commit_id: &str,
    canonical_delta_hash: &str,
    occurred_at: &str,
) -> Result<(), CombatPersistenceError> {
    let payload = serde_json::json!({
        "canonicalDeltaHash": canonical_delta_hash,
        "combatInstanceId": combat_instance_id,
        "combatResult": combat_result,
        "event": "combat.finished",
        "resultCommitId": result_commit_id,
    });
    transaction.execute(
        "INSERT INTO event_ledger (
           id,campaign_id,event_type,operation_id,aggregate_type,aggregate_id,revision,
           payload_json,payload_version,source,occurred_at
         ) VALUES (?1,?2,'COMBAT_FINISHED',?3,'COMBAT',?4,2,?5,1,'SYSTEM',?6)",
        params![
            format!("combat-ledger-finish:{result_commit_id}"),
            campaign_id,
            result_commit_id,
            combat_instance_id,
            serde_json::to_string(&payload)?,
            occurred_at,
        ],
    )?;
    Ok(())
}

fn validate_combat_finished_fact(
    transaction: &rusqlite::Transaction<'_>,
    campaign_id: &str,
    combat_instance_id: &str,
    combat_result: &str,
    result_commit_id: &str,
    canonical_delta_hash: &str,
) -> Result<(), CombatPersistenceError> {
    let stored = transaction
        .query_row(
            "SELECT id,campaign_id,event_type,operation_id,payload_json,payload_version,source
             FROM event_ledger WHERE aggregate_type='COMBAT' AND aggregate_id=?1 AND revision=2",
            [combat_instance_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, i64>(5)?,
                    row.get::<_, String>(6)?,
                ))
            },
        )
        .optional()?;
    let expected_payload = serde_json::json!({
        "canonicalDeltaHash": canonical_delta_hash,
        "combatInstanceId": combat_instance_id,
        "combatResult": combat_result,
        "event": "combat.finished",
        "resultCommitId": result_commit_id,
    });
    if let Some((id, campaign, event_type, operation, payload, version, source)) = stored
        && id == format!("combat-ledger-finish:{result_commit_id}")
        && campaign == campaign_id
        && event_type == "COMBAT_FINISHED"
        && operation == result_commit_id
        && serde_json::from_str::<Value>(&payload)? == expected_payload
        && version == 1
        && source == "SYSTEM"
    {
        return Ok(());
    }
    Err(CombatPersistenceError::ResultCommitConflict)
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
        expected_persistence_revision: None,
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

const fn result_name(result: ember_combat_core::CombatResultType) -> &'static str {
    match result {
        ember_combat_core::CombatResultType::Victory => "VICTORY",
        ember_combat_core::CombatResultType::Defeat => "DEFEAT",
        ember_combat_core::CombatResultType::Escape => "ESCAPE",
        ember_combat_core::CombatResultType::ScriptedVictory => "SCRIPTED_VICTORY",
        ember_combat_core::CombatResultType::ScriptedDefeat => "SCRIPTED_DEFEAT",
        ember_combat_core::CombatResultType::Aborted => "ABORTED",
    }
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
    fn authored_start_provenance_is_atomic_and_immutable_with_the_checkpoint() {
        let directory = tempfile::tempdir().unwrap();
        let store = CampaignStore::open(directory.path().join("combat.sqlite")).unwrap();
        let campaign = store.create_campaign().unwrap();
        let origin = AuthoredEncounterOrigin {
            schema_version: 1,
            operation_id: "f6a931df-cb50-4bc8-8f30-48caf969383e".to_owned(),
            rule_id: "tavern.sparring".to_owned(),
            rule_version: 1,
            definition_id: "encounter.sparring.fantasy".to_owned(),
            definition_version: 1,
            world_profile_id: WorldCombatProfileId::Fantasy,
            player_character_id: "actor-a".to_owned(),
            roster_combatant_ids: vec!["actor-a".to_owned(), "actor-b".to_owned()],
            objective_ids: vec!["survive-one-round".to_owned()],
        };
        let mut state = fixture_state_with_id(&origin.combat_instance_id(&campaign.id).unwrap());
        state.objectives.objectives.push(ObjectiveRuntime {
            objective_id: "survive-one-round".to_owned(),
            kind: ObjectiveKind::Survive,
            required: true,
            tracked_combatant_ids: vec![],
            target_id: None,
            rounds_required: Some(1),
            fail_on_downed: false,
            removed_counts_as_defeated: false,
            terminal_priority: None,
            scripted_result: None,
        });
        state
            .objectives
            .required_objective_ids
            .push("survive-one-round".to_owned());
        let start = serde_json::to_value(AuthoredEncounterEvent::EncounterStarted {
            sequence: 1,
            origin: origin.clone(),
        })
        .unwrap();
        let events = vec![start.clone()];
        fn write_authored<'a>(
            campaign_id: &'a str,
            state: &'a CombatState,
            events: &'a [Value],
            revision: Option<u64>,
        ) -> CombatCheckpointWrite<'a> {
            CombatCheckpointWrite {
                campaign_id,
                expected_persistence_revision: revision,
                initial_state: state,
                state,
                accepted_commands: &[],
                events,
                loop_guard: guard(),
            }
        }
        store
            .save_combat_checkpoint(write_authored(&campaign.id, &state, &events, None))
            .unwrap();
        let started_payload: String = store
            .connect()
            .unwrap()
            .query_row(
                "SELECT payload_json FROM event_ledger WHERE aggregate_type='COMBAT' AND aggregate_id=?1",
                [&state.combat_instance_id],
                |row| row.get(0),
            )
            .unwrap();
        let started_payload: Value = serde_json::from_str(&started_payload).unwrap();
        assert_eq!(
            started_payload["encounterOrigin"]["operationId"],
            origin.operation_id
        );
        assert_eq!(started_payload["encounterOrigin"]["definitionVersion"], 1);

        let mut changed = origin.clone();
        changed.definition_version = 2;
        let forged = vec![
            serde_json::to_value(AuthoredEncounterEvent::EncounterStarted {
                sequence: 1,
                origin: changed,
            })
            .unwrap(),
        ];
        assert!(matches!(
            store.save_combat_checkpoint(write_authored(&campaign.id, &state, &forged, Some(1))),
            Err(CombatPersistenceError::InvalidCheckpoint)
        ));
        assert!(matches!(
            store.save_combat_checkpoint(write_authored(&campaign.id, &state, &[], Some(1))),
            Err(CombatPersistenceError::InvalidCheckpoint)
        ));
        assert!(matches!(
            store.save_combat_checkpoint(write_authored(
                &campaign.id,
                &state,
                &[start.clone(), start],
                Some(1)
            )),
            Err(CombatPersistenceError::InvalidCheckpoint)
        ));
        let restored = store
            .restore_combat_checkpoint(&state.combat_instance_id)
            .unwrap();
        assert_eq!(restored.events, events);
        assert_eq!(restored.persistence_revision, 1);
        let (authored, restored_origin) = store
            .restore_authored_encounter_checkpoint(&campaign.id, &state.combat_instance_id)
            .unwrap();
        assert_eq!(authored.state, state);
        assert_eq!(restored_origin, origin);
        assert!(matches!(
            store.restore_authored_encounter_checkpoint(
                "another-campaign",
                &state.combat_instance_id
            ),
            Err(CombatPersistenceError::InvalidCheckpoint)
        ));
    }

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
                expected_persistence_revision: None,
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
        let write = |expected_persistence_revision| CombatCheckpointWrite {
            campaign_id: &campaign.id,
            expected_persistence_revision,
            initial_state: &state,
            state: &state,
            accepted_commands: &[],
            events: &events,
            loop_guard: guard(),
        };
        assert_eq!(
            store
                .save_combat_checkpoint(write(None))
                .unwrap()
                .persistence_revision,
            1
        );
        assert_eq!(
            store
                .save_combat_checkpoint(write(Some(1)))
                .unwrap()
                .persistence_revision,
            2
        );
        let mut changed_initial = state.clone();
        changed_initial.combatants[0].hit_points -= 1;
        assert!(matches!(
            store.save_combat_checkpoint(CombatCheckpointWrite {
                campaign_id: &campaign.id,
                expected_persistence_revision: Some(2),
                initial_state: &changed_initial,
                state: &state,
                accepted_commands: &[],
                events: &events,
                loop_guard: guard(),
            }),
            Err(CombatPersistenceError::ResultCommitConflict)
        ));
        assert!(matches!(
            store.save_combat_checkpoint(write(Some(1))),
            Err(CombatPersistenceError::CheckpointRevisionConflict)
        ));
        assert_eq!(
            store
                .restore_combat_checkpoint(&state.combat_instance_id)
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
    fn m11_long_combat_generated_content_stress_reopens_64_pending_reaction_checkpoints() {
        let directory = tempfile::tempdir().unwrap();
        let database_path = directory.path().join("combat.sqlite");
        let mut store = CampaignStore::open(&database_path).unwrap();
        let campaign = store.create_campaign().unwrap();
        let initial = fixture_state();
        let (live, ledger, _, _) = pending_reaction_state();
        let events = vec![json!({"sequence": 1, "kind": "REACTION_WINDOW_OPENED"})];

        for expected_revision in 1_u64..=64 {
            let receipt = store
                .save_combat_checkpoint(CombatCheckpointWrite {
                    campaign_id: &campaign.id,
                    expected_persistence_revision: (expected_revision > 1)
                        .then_some(expected_revision - 1),
                    initial_state: &initial,
                    state: &live,
                    accepted_commands: ledger.commands(),
                    events: &events,
                    loop_guard: guard(),
                })
                .unwrap();
            assert_eq!(receipt.persistence_revision, expected_revision);

            drop(store);
            store = CampaignStore::open(&database_path).unwrap();
            let restored = store
                .restore_combat_checkpoint(&live.combat_instance_id)
                .unwrap();
            assert_eq!(restored.state, live);
            assert_eq!(restored.accepted_commands, ledger.commands());
            assert_eq!(restored.checkpoint_hash, receipt.checkpoint_hash);
            assert_eq!(
                store
                    .load_combat_replay_input(&live.combat_instance_id)
                    .unwrap()
                    .accepted_commands,
                ledger.commands()
            );
        }
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
            expected_persistence_revision: None,
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

    #[test]
    fn result_commit_survives_crash_before_cleanup_without_reapplying_domain_delta() {
        let directory = tempfile::tempdir().unwrap();
        let database_path = directory.path().join("combat.sqlite");
        let store = CampaignStore::open(&database_path).unwrap();
        let campaign = store.create_campaign().unwrap();
        let initial = fixture_state();
        let final_state = confirmed_victory(&initial);
        let snapshot = RuntimeCommitContract::capture_precombat_snapshot(
            initial.combat_instance_id.clone(),
            initial.versions,
            vec![],
        )
        .unwrap();
        store
            .save_combat_checkpoint(CombatCheckpointWrite {
                campaign_id: &campaign.id,
                expected_persistence_revision: None,
                initial_state: &initial,
                state: &final_state,
                accepted_commands: &[],
                events: &[
                    json!({"kind":"DAMAGE_APPLIED","hitPointsAfter":1}),
                    json!({"kind":"ITEM_CONSUMED","itemId":"potion-a"}),
                    json!({"kind":"WORLD_FACT_PROVISIONAL","factId":"door-open"}),
                ],
                loop_guard: guard(),
            })
            .unwrap();
        let connection = Connection::open(&database_path).unwrap();
        assert_eq!(
            connection
                .query_row(
                    "SELECT json_array_length(events_json) FROM battle_records
                     WHERE combat_instance_id=?1",
                    [&final_state.combat_instance_id],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            3
        );
        let precommit_ledger = connection
            .prepare(
                "SELECT event_type,payload_json FROM event_ledger
                 WHERE aggregate_type='COMBAT' AND aggregate_id=?1 ORDER BY revision",
            )
            .unwrap()
            .query_map([&final_state.combat_instance_id], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(precommit_ledger.len(), 1);
        assert_eq!(precommit_ledger[0].0, "COMBAT_STARTED");
        for forbidden in ["hitPointsAfter", "itemId", "factId"] {
            assert!(!precommit_ledger[0].1.contains(forbidden));
        }
        connection
            .execute_batch(
                "CREATE TABLE domain_commit_probe (
                   campaign_id TEXT PRIMARY KEY,
                   reward_count INTEGER NOT NULL,
                   inventory_delta_count INTEGER NOT NULL,
                   world_delta_count INTEGER NOT NULL
                 );",
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO domain_commit_probe VALUES (?1,0,0,0)",
                [&campaign.id],
            )
            .unwrap();

        let first = store
            .commit_combat_result_with(
                &campaign.id,
                &final_state,
                &snapshot,
                RuntimeFinalizationRequest::default(),
                |transaction, plan| {
                    assert_eq!(plan.result_type, CombatResultType::Victory);
                    transaction.execute(
                        "UPDATE domain_commit_probe SET reward_count=reward_count+1,
                         inventory_delta_count=inventory_delta_count+1,
                         world_delta_count=world_delta_count+1 WHERE campaign_id=?1",
                        [&campaign.id],
                    )?;
                    Ok(())
                },
            )
            .unwrap();
        assert_eq!(first.status, CombatResultCommitStatus::Committed);
        drop(store); // Simulated crash: ActiveCombatSave was not cleaned.

        let reopened = CampaignStore::open(&database_path).unwrap();
        let retry = reopened
            .commit_combat_result_with(
                &campaign.id,
                &final_state,
                &snapshot,
                RuntimeFinalizationRequest::default(),
                |transaction, _| {
                    transaction.execute(
                        "UPDATE domain_commit_probe SET reward_count=reward_count+100,
                         inventory_delta_count=inventory_delta_count+100,
                         world_delta_count=world_delta_count+100 WHERE campaign_id=?1",
                        [&campaign.id],
                    )?;
                    Ok(())
                },
            )
            .unwrap();
        assert_eq!(retry.status, CombatResultCommitStatus::AlreadyCommitted);
        assert_eq!(retry.result_commit_id, first.result_commit_id);
        assert_eq!(retry.canonical_delta_hash, first.canonical_delta_hash);
        let counts = Connection::open(&database_path)
            .unwrap()
            .query_row(
                "SELECT reward_count,inventory_delta_count,world_delta_count
                 FROM domain_commit_probe WHERE campaign_id=?1",
                [&campaign.id],
                |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, i64>(2)?,
                    ))
                },
            )
            .unwrap();
        assert_eq!(counts, (1, 1, 1));
        let connection = Connection::open(&database_path).unwrap();
        let committed_facts = connection
            .prepare(
                "SELECT revision,event_type,operation_id,payload_json FROM event_ledger
                 WHERE aggregate_type='COMBAT' AND aggregate_id=?1 ORDER BY revision",
            )
            .unwrap()
            .query_map([&final_state.combat_instance_id], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                ))
            })
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(committed_facts.len(), 2);
        assert_eq!(
            (committed_facts[0].0, committed_facts[0].1.as_str()),
            (1, "COMBAT_STARTED")
        );
        assert_eq!(
            (committed_facts[1].0, committed_facts[1].1.as_str()),
            (2, "COMBAT_FINISHED")
        );
        assert_eq!(committed_facts[1].2, first.result_commit_id);
        let finished_payload: Value = serde_json::from_str(&committed_facts[1].3).unwrap();
        assert_eq!(finished_payload["resultCommitId"], first.result_commit_id);
        assert_eq!(
            finished_payload["canonicalDeltaHash"],
            first.canonical_delta_hash
        );
        assert_eq!(finished_payload["combatResult"], "VICTORY");
        connection
            .execute(
                "UPDATE battle_records SET canonical_delta_hash=?1 WHERE combat_instance_id=?2",
                params!["0".repeat(64), &final_state.combat_instance_id],
            )
            .unwrap();
        assert!(matches!(
            reopened.commit_combat_result_with(
                &campaign.id,
                &final_state,
                &snapshot,
                RuntimeFinalizationRequest::default(),
                |_, _| Ok(()),
            ),
            Err(CombatPersistenceError::ResultCommitConflict)
        ));
        connection
            .execute(
                "UPDATE battle_records SET canonical_delta_hash=?1 WHERE combat_instance_id=?2",
                params![&first.canonical_delta_hash, &final_state.combat_instance_id],
            )
            .unwrap();
        assert!(
            reopened
                .restore_combat_checkpoint(&final_state.combat_instance_id)
                .is_ok()
        );
        assert!(
            reopened
                .complete_combat_result_cleanup(
                    &final_state.combat_instance_id,
                    &first.result_commit_id
                )
                .unwrap()
        );
        assert!(
            !reopened
                .complete_combat_result_cleanup(
                    &final_state.combat_instance_id,
                    &first.result_commit_id
                )
                .unwrap()
        );
        assert!(matches!(
            reopened.restore_combat_checkpoint(&final_state.combat_instance_id),
            Err(CombatPersistenceError::NotFound)
        ));
    }

    #[test]
    fn failed_domain_transaction_rolls_back_effect_and_result_marker_together() {
        let directory = tempfile::tempdir().unwrap();
        let database_path = directory.path().join("combat.sqlite");
        let store = CampaignStore::open(&database_path).unwrap();
        let campaign = store.create_campaign().unwrap();
        let initial = fixture_state();
        let final_state = confirmed_victory(&initial);
        let snapshot = RuntimeCommitContract::capture_precombat_snapshot(
            initial.combat_instance_id.clone(),
            initial.versions,
            vec![],
        )
        .unwrap();
        store
            .save_combat_checkpoint(CombatCheckpointWrite {
                campaign_id: &campaign.id,
                expected_persistence_revision: None,
                initial_state: &initial,
                state: &final_state,
                accepted_commands: &[],
                events: &[json!({
                    "kind":"DAMAGE_APPLIED",
                    "hitPointsAfter":0,
                    "itemId":"rollback-item",
                    "worldFact":"rollback-world"
                })],
                loop_guard: guard(),
            })
            .unwrap();
        let connection = Connection::open(&database_path).unwrap();
        connection.execute_batch("CREATE TABLE domain_rollback_probe (value INTEGER NOT NULL); INSERT INTO domain_rollback_probe VALUES (0);").unwrap();
        let result = store.commit_combat_result_with(
            &campaign.id,
            &final_state,
            &snapshot,
            RuntimeFinalizationRequest::default(),
            |transaction, _| {
                transaction.execute("UPDATE domain_rollback_probe SET value=1", [])?;
                Err(CampaignStoreError::InvalidData)
            },
        );
        assert!(matches!(
            result,
            Err(CombatPersistenceError::Store(
                CampaignStoreError::InvalidData
            ))
        ));
        let connection = Connection::open(&database_path).unwrap();
        assert_eq!(
            connection
                .query_row("SELECT value FROM domain_rollback_probe", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            0
        );
        let marker = connection
            .query_row(
                "SELECT result_commit_id FROM battle_records WHERE combat_instance_id=?1",
                [&final_state.combat_instance_id],
                |row| row.get::<_, Option<String>>(0),
            )
            .unwrap();
        assert_eq!(marker, None);
        assert_eq!(
            connection
                .query_row(
                    "SELECT COUNT(*) FROM event_ledger
                     WHERE aggregate_type='COMBAT' AND aggregate_id=?1",
                    [&final_state.combat_instance_id],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            1
        );
        let only_payload: String = connection
            .query_row(
                "SELECT payload_json FROM event_ledger
                 WHERE aggregate_type='COMBAT' AND aggregate_id=?1",
                [&final_state.combat_instance_id],
                |row| row.get(0),
            )
            .unwrap();
        assert!(!only_payload.contains("hitPointsAfter"));
        assert!(!only_payload.contains("rollback-item"));
        assert!(!only_payload.contains("rollback-world"));
    }

    #[test]
    fn every_combat_result_applies_its_persistence_policy_in_the_canonical_transaction() {
        let runtime_world_digest = "c".repeat(64);
        let scripted_world_digest = "d".repeat(64);
        let cases = vec![
            (
                "victory",
                CombatResultType::Victory,
                RuntimeFinalizationRequest::default(),
                ResultPersistencePolicy::CommitRuntimeDelta,
                (6, 1, Some(runtime_world_digest.clone()), 1),
            ),
            (
                "escape",
                CombatResultType::Escape,
                RuntimeFinalizationRequest::default(),
                ResultPersistencePolicy::CommitRuntimeDelta,
                (6, 1, Some(runtime_world_digest.clone()), 0),
            ),
            (
                "defeat",
                CombatResultType::Defeat,
                RuntimeFinalizationRequest::default(),
                ResultPersistencePolicy::RestorePrecombatSnapshot,
                (10, 2, None, 0),
            ),
            (
                "aborted",
                CombatResultType::Aborted,
                RuntimeFinalizationRequest::default(),
                ResultPersistencePolicy::RestorePrecombatSnapshot,
                (10, 2, None, 0),
            ),
            (
                "scripted-victory-commit",
                CombatResultType::ScriptedVictory,
                RuntimeFinalizationRequest {
                    scripted_persistence_policy: Some(ResultPersistencePolicy::CommitRuntimeDelta),
                    scripted_delta_entries: vec![],
                },
                ResultPersistencePolicy::CommitRuntimeDelta,
                (6, 1, Some(runtime_world_digest.clone()), 1),
            ),
            (
                "scripted-defeat-restore",
                CombatResultType::ScriptedDefeat,
                RuntimeFinalizationRequest {
                    scripted_persistence_policy: Some(
                        ResultPersistencePolicy::RestorePrecombatSnapshot,
                    ),
                    scripted_delta_entries: vec![],
                },
                ResultPersistencePolicy::RestorePrecombatSnapshot,
                (10, 2, None, 0),
            ),
            (
                "scripted-defeat-restore-then-apply",
                CombatResultType::ScriptedDefeat,
                RuntimeFinalizationRequest {
                    scripted_persistence_policy: Some(
                        ResultPersistencePolicy::RestoreSnapshotThenApplyScriptedDelta,
                    ),
                    scripted_delta_entries: vec![ProvisionalDeltaEntry::WorldFact {
                        fact_id: "encounter-outcome".into(),
                        before_digest: None,
                        after_digest: Some(scripted_world_digest.clone()),
                    }],
                },
                ResultPersistencePolicy::RestoreSnapshotThenApplyScriptedDelta,
                (10, 2, Some(scripted_world_digest.clone()), 0),
            ),
        ];

        for (name, result_type, request, expected_policy, expected_values) in cases {
            let directory = tempfile::tempdir().unwrap();
            let database_path = directory.path().join(format!("{name}.sqlite"));
            let store = CampaignStore::open(&database_path).unwrap();
            let campaign = store.create_campaign().unwrap();
            let combat_id = format!("combat-result-policy-{name}");
            let (initial, mut final_state, snapshot) =
                result_policy_fixture(&combat_id, &runtime_world_digest);
            if result_type == CombatResultType::Aborted {
                force_loop_guard_abort(&mut final_state);
            } else {
                confirm_result(&mut final_state, result_type);
            }
            let loop_guard = final_state
                .scheduler
                .as_ref()
                .map_or_else(guard, |scheduler| CombatLoopGuardContract {
                    max_trigger_depth: scheduler.max_trigger_depth,
                    max_event_count: scheduler.max_event_count,
                });
            store
                .save_combat_checkpoint(CombatCheckpointWrite {
                    campaign_id: &campaign.id,
                    expected_persistence_revision: None,
                    initial_state: &initial,
                    state: &final_state,
                    accepted_commands: &[],
                    events: &[json!({"kind":"RESULT_POLICY_FIXTURE","case":name})],
                    loop_guard,
                })
                .unwrap();
            let connection = Connection::open(&database_path).unwrap();
            connection
                .execute_batch(
                    "CREATE TABLE combat_result_domain_probe (
                       hit_points INTEGER NOT NULL,
                       item_quantity INTEGER NOT NULL,
                       world_digest TEXT,
                       reward_count INTEGER NOT NULL
                     );
                     INSERT INTO combat_result_domain_probe VALUES (10,2,NULL,0);",
                )
                .unwrap();

            let receipt = store
                .commit_combat_result_with(
                    &campaign.id,
                    &final_state,
                    &snapshot,
                    request,
                    |transaction, plan| {
                        assert_eq!(plan.persistence_policy, expected_policy, "{name}");
                        apply_result_policy_to_probe(transaction, plan)?;
                        if matches!(
                            plan.result_type,
                            CombatResultType::Victory | CombatResultType::ScriptedVictory
                        ) && plan.persistence_policy
                            == ResultPersistencePolicy::CommitRuntimeDelta
                        {
                            transaction.execute(
                                "UPDATE combat_result_domain_probe
                                 SET reward_count=reward_count+1",
                                [],
                            )?;
                        }
                        Ok(())
                    },
                )
                .unwrap();
            assert_eq!(
                receipt.status,
                CombatResultCommitStatus::Committed,
                "{name}"
            );
            let actual = Connection::open(&database_path)
                .unwrap()
                .query_row(
                    "SELECT hit_points,item_quantity,world_digest,reward_count
                     FROM combat_result_domain_probe",
                    [],
                    |row| {
                        Ok((
                            row.get::<_, i64>(0)?,
                            row.get::<_, i64>(1)?,
                            row.get::<_, Option<String>>(2)?,
                            row.get::<_, i64>(3)?,
                        ))
                    },
                )
                .unwrap();
            assert_eq!(actual, expected_values, "{name}");
            let durable_result = Connection::open(&database_path)
                .unwrap()
                .query_row(
                    "SELECT combat_result,(SELECT COUNT(*) FROM event_ledger
                       WHERE aggregate_type='COMBAT' AND aggregate_id=?1)
                     FROM battle_records WHERE combat_instance_id=?1",
                    [&combat_id],
                    |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
                )
                .unwrap();
            assert_eq!(
                durable_result,
                (result_name(result_type).into(), 2),
                "{name}"
            );
        }
    }

    #[test]
    fn scripted_result_without_explicit_policy_writes_nothing() {
        let directory = tempfile::tempdir().unwrap();
        let database_path = directory.path().join("scripted-missing-policy.sqlite");
        let store = CampaignStore::open(&database_path).unwrap();
        let campaign = store.create_campaign().unwrap();
        let (initial, mut final_state, snapshot) =
            result_policy_fixture("combat-scripted-missing-policy", &"c".repeat(64));
        confirm_result(&mut final_state, CombatResultType::ScriptedVictory);
        store
            .save_combat_checkpoint(CombatCheckpointWrite {
                campaign_id: &campaign.id,
                expected_persistence_revision: None,
                initial_state: &initial,
                state: &final_state,
                accepted_commands: &[],
                events: &[],
                loop_guard: guard(),
            })
            .unwrap();
        let mut callback_called = false;
        let result = store.commit_combat_result_with(
            &campaign.id,
            &final_state,
            &snapshot,
            RuntimeFinalizationRequest::default(),
            |_, _| {
                callback_called = true;
                Ok(())
            },
        );
        assert!(matches!(
            result,
            Err(CombatPersistenceError::ResultNotReady)
        ));
        assert!(!callback_called);
        let connection = Connection::open(&database_path).unwrap();
        let durable = connection
            .query_row(
                "SELECT result_commit_id,(SELECT COUNT(*) FROM event_ledger
                   WHERE aggregate_type='COMBAT' AND aggregate_id=?1)
                 FROM battle_records WHERE combat_instance_id=?1",
                [&final_state.combat_instance_id],
                |row| Ok((row.get::<_, Option<String>>(0)?, row.get::<_, i64>(1)?)),
            )
            .unwrap();
        assert_eq!(durable, (None, 1));
    }

    #[test]
    fn portable_archive_round_trips_a_compatible_active_combat_checkpoint() {
        let source_directory = tempfile::tempdir().unwrap();
        let source = CampaignStore::open(source_directory.path().join("source.sqlite")).unwrap();
        let campaign = source.create_campaign().unwrap();
        let initial = fixture_state_with_id("combat-portable-roundtrip");
        let (mut active, ledger, _, _) =
            pending_reaction_state_with_id(&initial.combat_instance_id);
        active.combat_instance_id = initial.combat_instance_id.clone();
        active.rng = CombatRng::new(
            SEED,
            &initial.combat_instance_id,
            CURRENT_COMBAT_VERSIONS.rng_contract_version,
        )
        .unwrap()
        .snapshot();
        source
            .save_combat_checkpoint(CombatCheckpointWrite {
                campaign_id: &campaign.id,
                expected_persistence_revision: None,
                initial_state: &initial,
                state: &active,
                accepted_commands: ledger.commands(),
                events: &[json!({"kind":"REACTION_WINDOW_OPENED"})],
                loop_guard: guard(),
            })
            .unwrap();
        let archive_path = source_directory.path().join("active-combat.emtavern");
        source
            .export_campaign_archive(&campaign.id, &archive_path, "0.4.1-test")
            .unwrap();

        let target_directory = tempfile::tempdir().unwrap();
        let target = CampaignStore::open(target_directory.path().join("target.sqlite")).unwrap();
        target
            .import_campaign_archive(&archive_path, crate::CampaignArchiveImportMode::Create)
            .unwrap();
        let restored = target
            .restore_combat_checkpoint(&initial.combat_instance_id)
            .unwrap();
        assert_eq!(restored.initial_state, initial);
        assert_eq!(restored.state, active);
        assert_eq!(restored.accepted_commands, ledger.commands());
        let connection = target.connect().unwrap();
        assert_eq!(
            connection
                .query_row(
                    "SELECT COUNT(*) FROM battle_records WHERE campaign_id=?1",
                    [&campaign.id],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            1
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT COUNT(*) FROM active_combat_saves WHERE campaign_id=?1",
                    [&campaign.id],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            1
        );
    }

    #[test]
    fn portable_archive_export_rejects_an_unsupported_combat_version() {
        let directory = tempfile::tempdir().unwrap();
        let store = CampaignStore::open(directory.path().join("unsupported.sqlite")).unwrap();
        let campaign = store.create_campaign().unwrap();
        let connection = store.connect().unwrap();
        connection
            .execute(
                "INSERT INTO battle_records (
                   combat_instance_id,campaign_id,combat_schema_version,ruleset_version,
                   balance_version,engine_version,world_profile_version,attribute_mapping_version,
                   rng_contract_version,random_seed,initial_state_json,initial_state_hash,
                   accepted_commands_json,events_json,event_digest,last_committed_sequence,
                   created_at,updated_at
                 ) VALUES (
                   'combat-unsupported-version',?1,1,1,1,2,1,1,1,?2,'{}',?3,'[]','[]',?4,0,?5,?5
                 )",
                params![
                    &campaign.id,
                    SEED,
                    "a".repeat(64),
                    digest(b"[]"),
                    "2026-09-13T00:00:00.000Z"
                ],
            )
            .unwrap();
        assert!(matches!(
            store.export_campaign_archive(
                &campaign.id,
                directory.path().join("must-not-exist.emtavern"),
                "0.4.1-test"
            ),
            Err(CampaignStoreError::IncompatibleSchema)
        ));
        assert!(!directory.path().join("must-not-exist.emtavern").exists());
    }

    fn apply_result_policy_to_probe(
        transaction: &rusqlite::Transaction<'_>,
        plan: &RuntimeFinalizationPlan,
    ) -> Result<(), CampaignStoreError> {
        if let Some(snapshot) = &plan.rollback_snapshot {
            for entry in &snapshot.entries {
                match entry {
                    CanonicalDomainValue::HitPoints { value, .. } => {
                        transaction.execute(
                            "UPDATE combat_result_domain_probe SET hit_points=?1",
                            [value],
                        )?;
                    }
                    CanonicalDomainValue::ItemQuantity { value, .. } => {
                        transaction.execute(
                            "UPDATE combat_result_domain_probe SET item_quantity=?1",
                            [value],
                        )?;
                    }
                    CanonicalDomainValue::WorldFact { digest, .. } => {
                        transaction.execute(
                            "UPDATE combat_result_domain_probe SET world_digest=?1",
                            [digest],
                        )?;
                    }
                    _ => return Err(CampaignStoreError::InvalidData),
                }
            }
        }
        for entry in &plan.canonical_delta.entries {
            match entry {
                ProvisionalDeltaEntry::HitPoints { after, .. } => {
                    transaction.execute(
                        "UPDATE combat_result_domain_probe SET hit_points=?1",
                        [after],
                    )?;
                }
                ProvisionalDeltaEntry::ItemQuantity { after, .. } => {
                    transaction.execute(
                        "UPDATE combat_result_domain_probe SET item_quantity=?1",
                        [after],
                    )?;
                }
                ProvisionalDeltaEntry::WorldFact { after_digest, .. } => {
                    transaction.execute(
                        "UPDATE combat_result_domain_probe SET world_digest=?1",
                        [after_digest],
                    )?;
                }
                _ => return Err(CampaignStoreError::InvalidData),
            }
        }
        Ok(())
    }

    fn result_policy_fixture(
        combat_instance_id: &str,
        runtime_world_digest: &str,
    ) -> (CombatState, CombatState, PreCombatSnapshot) {
        let mut initial = fixture_state_with_id(combat_instance_id);
        initial.combat_inventory.push(CombatInventoryItemState {
            owner_id: "actor-a".into(),
            item_id: "potion-a".into(),
            current_quantity: 2,
        });
        let snapshot = RuntimeCommitContract::capture_precombat_snapshot(
            combat_instance_id.into(),
            initial.versions,
            vec![
                CanonicalDomainValue::HitPoints {
                    combatant_id: "actor-a".into(),
                    value: 10,
                },
                CanonicalDomainValue::ItemQuantity {
                    owner_id: "actor-a".into(),
                    item_id: "potion-a".into(),
                    value: 2,
                },
                CanonicalDomainValue::WorldFact {
                    fact_id: "encounter-outcome".into(),
                    digest: None,
                },
            ],
        )
        .unwrap();
        let mut state = initial.clone();
        state.combatants[0].hit_points = 6;
        state.combat_inventory[0].current_quantity = 1;
        state.provisional_delta = ProvisionalRuntimeDelta {
            revision: 3,
            entries: vec![
                ProvisionalDeltaEntry::HitPoints {
                    combatant_id: "actor-a".into(),
                    before: 10,
                    after: 6,
                },
                ProvisionalDeltaEntry::ItemQuantity {
                    owner_id: "actor-a".into(),
                    item_id: "potion-a".into(),
                    before: 2,
                    after: 1,
                },
                ProvisionalDeltaEntry::WorldFact {
                    fact_id: "encounter-outcome".into(),
                    before_digest: None,
                    after_digest: Some(runtime_world_digest.into()),
                },
            ],
        };
        (initial, state, snapshot)
    }

    fn confirm_result(state: &mut CombatState, result_type: CombatResultType) {
        state.result_candidates.push(ResultCandidate {
            candidate_id: format!("result-{}", result_name(result_type).to_ascii_lowercase()),
            result_type,
            source_kind: "SYSTEM".into(),
            source_id: "result-policy-fixture".into(),
            explicit_priority: None,
            sequence: 1,
        });
        TerminalOutcomeArbitrator::confirm(state).unwrap();
    }

    fn force_loop_guard_abort(state: &mut CombatState) {
        CanonicalEventChainScheduler::begin(state, "chain-aborted".into(), 8, 0).unwrap();
        CanonicalEventChainScheduler::enqueue_roots(
            state,
            vec![SchedulerCandidate {
                kind: SchedulerItemKind::Trigger,
                phase_priority: 1,
                explicit_priority: 0,
                source_stable_id: "system".into(),
                effect_stable_id: "overflow".into(),
            }],
        )
        .unwrap();
        CanonicalEventChainScheduler::dequeue_next(state)
            .unwrap()
            .unwrap();
        assert!(matches!(
            CanonicalEventChainScheduler::gate_current_for_execution(state, true).unwrap(),
            SchedulerExecutionGateOutcome::EngineFailure { .. }
        ));
    }

    fn pending_reaction_state() -> (
        CombatState,
        AcceptedCommandLedger,
        Vec<ReactionBinding>,
        Vec<CombatControlAssignment>,
    ) {
        pending_reaction_state_with_id("combat-persistence-fixture")
    }

    fn pending_reaction_state_with_id(
        combat_instance_id: &str,
    ) -> (
        CombatState,
        AcceptedCommandLedger,
        Vec<ReactionBinding>,
        Vec<CombatControlAssignment>,
    ) {
        let mut state = fixture_state_with_id(combat_instance_id);
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

    fn confirmed_victory(initial: &CombatState) -> CombatState {
        let mut state = initial.clone();
        state.result_candidates.push(ResultCandidate {
            candidate_id: "result-victory".into(),
            result_type: CombatResultType::Victory,
            source_kind: "SYSTEM".into(),
            source_id: "result-fixture".into(),
            explicit_priority: None,
            sequence: 1,
        });
        TerminalOutcomeArbitrator::confirm(&mut state).unwrap();
        state
    }

    fn fixture_state() -> CombatState {
        fixture_state_with_id("combat-persistence-fixture")
    }

    fn fixture_state_with_id(combat_instance_id: &str) -> CombatState {
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
            combat_instance_id: combat_instance_id.into(),
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
                combat_instance_id,
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

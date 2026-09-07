use std::{error::Error, fmt};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::{
    CURRENT_COMBAT_VERSIONS, CombatResultType, CombatState, CombatVersionSet, ProvisionalDeltaEntry,
};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum CanonicalDomainValue {
    HitPoints {
        combatant_id: String,
        value: i64,
    },
    MaxHitPoints {
        combatant_id: String,
        value: i64,
    },
    CombatantState {
        combatant_id: String,
        value: crate::CombatantState,
    },
    SoloRecoveryAvailable {
        combatant_id: String,
        value: bool,
    },
    Shield {
        combatant_id: String,
        value: i64,
    },
    Resource {
        combatant_id: String,
        resource_id: String,
        value: i64,
    },
    ItemQuantity {
        owner_id: String,
        item_id: String,
        value: i64,
    },
    StatusPresence {
        combatant_id: String,
        status_instance_id: String,
        value: bool,
    },
    WorldFact {
        fact_id: String,
        digest: Option<String>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PreCombatSnapshot {
    pub combat_instance_id: String,
    pub versions: CombatVersionSet,
    pub entries: Vec<CanonicalDomainValue>,
    pub snapshot_hash_sha256: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ResultPersistencePolicy {
    CommitRuntimeDelta,
    RestorePrecombatSnapshot,
    RestoreSnapshotThenApplyScriptedDelta,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RuntimeFinalizationRequest {
    pub scripted_persistence_policy: Option<ResultPersistencePolicy>,
    pub scripted_delta_entries: Vec<ProvisionalDeltaEntry>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CanonicalDomainDelta {
    pub combat_instance_id: String,
    pub result_type: CombatResultType,
    pub entries: Vec<ProvisionalDeltaEntry>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CombatFinishedFact {
    pub combat_instance_id: String,
    pub result_type: CombatResultType,
    pub correlation_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RuntimeFinalizationPlan {
    pub result_commit_id: String,
    pub final_result_sequence: u64,
    pub result_type: CombatResultType,
    pub persistence_policy: ResultPersistencePolicy,
    pub runtime_state_hash_sha256: String,
    pub precombat_snapshot_hash_sha256: String,
    pub canonical_delta_hash_sha256: String,
    pub canonical_delta: CanonicalDomainDelta,
    pub rollback_snapshot: Option<PreCombatSnapshot>,
    pub finished_fact: CombatFinishedFact,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RuntimeCommitErrorCode {
    InvalidStableId,
    InvalidSnapshot,
    SnapshotMismatch,
    ResultNotConfirmed,
    InvalidScriptedPolicy,
    InvalidProvisionalDelta,
    RuntimeProjectionMismatch,
    SerializationFailed,
    StateInvariantViolation,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RuntimeCommitError {
    pub code: RuntimeCommitErrorCode,
    pub subject_id: String,
}

impl fmt::Display for RuntimeCommitError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "runtime commit contract failed for {}: {:?}",
            self.subject_id, self.code
        )
    }
}

impl Error for RuntimeCommitError {}

pub struct RuntimeCommitContract;

impl RuntimeCommitContract {
    pub fn capture_precombat_snapshot(
        combat_instance_id: String,
        versions: CombatVersionSet,
        mut entries: Vec<CanonicalDomainValue>,
    ) -> Result<PreCombatSnapshot, RuntimeCommitError> {
        validate_stable_id(&combat_instance_id)?;
        versions
            .ensure_supported()
            .map_err(|_| runtime_error(RuntimeCommitErrorCode::InvalidSnapshot, "versions"))?;
        for entry in &entries {
            validate_snapshot_entry(entry)?;
        }
        entries.sort_by_key(domain_value_key);
        if entries
            .windows(2)
            .any(|pair| domain_value_key(&pair[0]) == domain_value_key(&pair[1]))
        {
            return Err(runtime_error(
                RuntimeCommitErrorCode::InvalidSnapshot,
                "duplicate-domain-entry",
            ));
        }
        let snapshot_hash_sha256 = hash_serializable(&SnapshotHashInput {
            combat_instance_id: &combat_instance_id,
            versions,
            entries: &entries,
        })?;
        Ok(PreCombatSnapshot {
            combat_instance_id,
            versions,
            entries,
            snapshot_hash_sha256,
        })
    }

    pub fn validate_snapshot(snapshot: &PreCombatSnapshot) -> Result<(), RuntimeCommitError> {
        validate_stable_id(&snapshot.combat_instance_id)?;
        snapshot
            .versions
            .ensure_supported()
            .map_err(|_| runtime_error(RuntimeCommitErrorCode::InvalidSnapshot, "versions"))?;
        for entry in &snapshot.entries {
            validate_snapshot_entry(entry)?;
        }
        if snapshot
            .entries
            .windows(2)
            .any(|pair| domain_value_key(&pair[0]) >= domain_value_key(&pair[1]))
        {
            return Err(runtime_error(
                RuntimeCommitErrorCode::InvalidSnapshot,
                "snapshot-order",
            ));
        }
        let expected = hash_serializable(&SnapshotHashInput {
            combat_instance_id: &snapshot.combat_instance_id,
            versions: snapshot.versions,
            entries: &snapshot.entries,
        })?;
        if expected != snapshot.snapshot_hash_sha256 {
            return Err(runtime_error(
                RuntimeCommitErrorCode::InvalidSnapshot,
                "snapshot-hash",
            ));
        }
        Ok(())
    }

    pub fn build_finalization_plan(
        state: &CombatState,
        snapshot: &PreCombatSnapshot,
        request: RuntimeFinalizationRequest,
    ) -> Result<RuntimeFinalizationPlan, RuntimeCommitError> {
        Self::validate_snapshot(snapshot)?;
        state.validate_for_commit().map_err(|_| {
            runtime_error(
                RuntimeCommitErrorCode::StateInvariantViolation,
                "combat-state",
            )
        })?;
        if state.combat_instance_id != snapshot.combat_instance_id
            || state.versions != snapshot.versions
            || state.versions != CURRENT_COMBAT_VERSIONS
        {
            return Err(runtime_error(
                RuntimeCommitErrorCode::SnapshotMismatch,
                &state.combat_instance_id,
            ));
        }
        let result_type = state.confirmed_result.ok_or_else(|| {
            runtime_error(
                RuntimeCommitErrorCode::ResultNotConfirmed,
                &state.combat_instance_id,
            )
        })?;
        validate_provisional_revision(state)?;
        let runtime_delta = canonicalize_delta(
            &snapshot.entries,
            &state.provisional_delta.entries,
            Some(state),
        )?;
        let (persistence_policy, entries) =
            resolve_persistence(result_type, runtime_delta, &snapshot.entries, request)?;
        let canonical_delta = CanonicalDomainDelta {
            combat_instance_id: state.combat_instance_id.clone(),
            result_type,
            entries,
        };
        let canonical_delta_hash_sha256 = hash_serializable(&canonical_delta)?;
        let runtime_state_hash_sha256 = state.state_hash_sha256().map_err(|_| {
            runtime_error(RuntimeCommitErrorCode::SerializationFailed, "runtime-state")
        })?;
        let final_result_sequence = final_result_sequence(state, result_type)?;
        let identity = ResultCommitIdentity {
            combat_instance_id: &state.combat_instance_id,
            final_result_sequence,
            result_type,
            canonical_delta_hash_sha256: &canonical_delta_hash_sha256,
        };
        let result_commit_id = format!("combat-result:{}", hash_serializable(&identity)?);
        let rollback_snapshot = match persistence_policy {
            ResultPersistencePolicy::CommitRuntimeDelta => None,
            ResultPersistencePolicy::RestorePrecombatSnapshot
            | ResultPersistencePolicy::RestoreSnapshotThenApplyScriptedDelta => {
                Some(snapshot.clone())
            }
        };
        let finished_fact = CombatFinishedFact {
            combat_instance_id: state.combat_instance_id.clone(),
            result_type,
            correlation_id: result_commit_id.clone(),
        };
        Ok(RuntimeFinalizationPlan {
            result_commit_id,
            final_result_sequence,
            result_type,
            persistence_policy,
            runtime_state_hash_sha256,
            precombat_snapshot_hash_sha256: snapshot.snapshot_hash_sha256.clone(),
            canonical_delta_hash_sha256,
            canonical_delta,
            rollback_snapshot,
            finished_fact,
        })
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SnapshotHashInput<'a> {
    combat_instance_id: &'a str,
    versions: CombatVersionSet,
    entries: &'a [CanonicalDomainValue],
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ResultCommitIdentity<'a> {
    combat_instance_id: &'a str,
    final_result_sequence: u64,
    result_type: CombatResultType,
    canonical_delta_hash_sha256: &'a str,
}

fn resolve_persistence(
    result_type: CombatResultType,
    runtime_delta: Vec<ProvisionalDeltaEntry>,
    snapshot: &[CanonicalDomainValue],
    request: RuntimeFinalizationRequest,
) -> Result<(ResultPersistencePolicy, Vec<ProvisionalDeltaEntry>), RuntimeCommitError> {
    let RuntimeFinalizationRequest {
        scripted_persistence_policy,
        scripted_delta_entries,
    } = request;
    match result_type {
        CombatResultType::Victory | CombatResultType::Escape => {
            require_no_scripted_request(scripted_persistence_policy, &scripted_delta_entries)?;
            Ok((ResultPersistencePolicy::CommitRuntimeDelta, runtime_delta))
        }
        CombatResultType::Defeat | CombatResultType::Aborted => {
            require_no_scripted_request(scripted_persistence_policy, &scripted_delta_entries)?;
            Ok((
                ResultPersistencePolicy::RestorePrecombatSnapshot,
                Vec::new(),
            ))
        }
        CombatResultType::ScriptedVictory | CombatResultType::ScriptedDefeat => {
            let policy = scripted_persistence_policy.ok_or_else(|| {
                runtime_error(
                    RuntimeCommitErrorCode::InvalidScriptedPolicy,
                    "scripted-policy-required",
                )
            })?;
            match policy {
                ResultPersistencePolicy::CommitRuntimeDelta => {
                    if !scripted_delta_entries.is_empty() {
                        return Err(runtime_error(
                            RuntimeCommitErrorCode::InvalidScriptedPolicy,
                            "unexpected-scripted-delta",
                        ));
                    }
                    Ok((policy, runtime_delta))
                }
                ResultPersistencePolicy::RestorePrecombatSnapshot => {
                    if !scripted_delta_entries.is_empty() {
                        return Err(runtime_error(
                            RuntimeCommitErrorCode::InvalidScriptedPolicy,
                            "unexpected-scripted-delta",
                        ));
                    }
                    Ok((policy, Vec::new()))
                }
                ResultPersistencePolicy::RestoreSnapshotThenApplyScriptedDelta => {
                    if scripted_delta_entries.is_empty() {
                        return Err(runtime_error(
                            RuntimeCommitErrorCode::InvalidScriptedPolicy,
                            "scripted-delta-required",
                        ));
                    }
                    let scripted_delta =
                        canonicalize_delta(snapshot, &scripted_delta_entries, None)?;
                    Ok((policy, scripted_delta))
                }
            }
        }
    }
}

fn require_no_scripted_request(
    policy: Option<ResultPersistencePolicy>,
    entries: &[ProvisionalDeltaEntry],
) -> Result<(), RuntimeCommitError> {
    if policy.is_some() || !entries.is_empty() {
        return Err(runtime_error(
            RuntimeCommitErrorCode::InvalidScriptedPolicy,
            "non-scripted-result",
        ));
    }
    Ok(())
}

fn final_result_sequence(
    state: &CombatState,
    result_type: CombatResultType,
) -> Result<u64, RuntimeCommitError> {
    if result_type == CombatResultType::Aborted {
        return state
            .scheduler
            .as_ref()
            .and_then(|scheduler| scheduler.engine_failure.as_ref())
            .map(|failure| failure.overflow_item.sequence)
            .ok_or_else(|| {
                runtime_error(
                    RuntimeCommitErrorCode::ResultNotConfirmed,
                    "aborted-sequence",
                )
            });
    }
    let candidate_id = state
        .confirmed_result_candidate_id
        .as_deref()
        .ok_or_else(|| {
            runtime_error(
                RuntimeCommitErrorCode::ResultNotConfirmed,
                "result-candidate",
            )
        })?;
    state
        .result_candidates
        .iter()
        .find(|candidate| candidate.candidate_id == candidate_id)
        .map(|candidate| candidate.sequence)
        .ok_or_else(|| runtime_error(RuntimeCommitErrorCode::ResultNotConfirmed, candidate_id))
}

fn validate_provisional_revision(state: &CombatState) -> Result<(), RuntimeCommitError> {
    if usize::try_from(state.provisional_delta.revision).ok()
        != Some(state.provisional_delta.entries.len())
    {
        return Err(runtime_error(
            RuntimeCommitErrorCode::InvalidProvisionalDelta,
            "provisional-revision",
        ));
    }
    Ok(())
}

fn canonicalize_delta(
    snapshot: &[CanonicalDomainValue],
    entries: &[ProvisionalDeltaEntry],
    runtime_state: Option<&CombatState>,
) -> Result<Vec<ProvisionalDeltaEntry>, RuntimeCommitError> {
    let mut folded: Vec<ProvisionalDeltaEntry> = Vec::new();
    for entry in entries {
        validate_delta_entry(entry)?;
        let key = delta_entry_key(entry);
        if let Some(existing) = folded
            .iter_mut()
            .find(|existing| delta_entry_key(existing) == key)
        {
            chain_delta(existing, entry)?;
        } else {
            let snapshot_entry = snapshot
                .iter()
                .find(|snapshot_entry| domain_value_key(snapshot_entry) == key)
                .ok_or_else(|| {
                    runtime_error(
                        RuntimeCommitErrorCode::SnapshotMismatch,
                        &domain_key_subject(&key),
                    )
                })?;
            if domain_scalar(snapshot_entry) != delta_before(entry) {
                return Err(runtime_error(
                    RuntimeCommitErrorCode::SnapshotMismatch,
                    &domain_key_subject(&key),
                ));
            }
            folded.push(entry.clone());
        }
    }
    if let Some(state) = runtime_state {
        for entry in &folded {
            validate_runtime_projection(state, entry)?;
        }
    }
    folded.retain(|entry| delta_before(entry) != delta_after(entry));
    folded.sort_by_key(delta_entry_key);
    Ok(folded)
}

fn chain_delta(
    existing: &mut ProvisionalDeltaEntry,
    next: &ProvisionalDeltaEntry,
) -> Result<(), RuntimeCommitError> {
    if delta_after(existing) != delta_before(next) {
        return Err(runtime_error(
            RuntimeCommitErrorCode::InvalidProvisionalDelta,
            &domain_key_subject(&delta_entry_key(next)),
        ));
    }
    match (existing, next) {
        (
            ProvisionalDeltaEntry::HitPoints { after, .. },
            ProvisionalDeltaEntry::HitPoints {
                after: next_after, ..
            },
        )
        | (
            ProvisionalDeltaEntry::MaxHitPoints { after, .. },
            ProvisionalDeltaEntry::MaxHitPoints {
                after: next_after, ..
            },
        )
        | (
            ProvisionalDeltaEntry::Shield { after, .. },
            ProvisionalDeltaEntry::Shield {
                after: next_after, ..
            },
        )
        | (
            ProvisionalDeltaEntry::Resource { after, .. },
            ProvisionalDeltaEntry::Resource {
                after: next_after, ..
            },
        )
        | (
            ProvisionalDeltaEntry::ItemQuantity { after, .. },
            ProvisionalDeltaEntry::ItemQuantity {
                after: next_after, ..
            },
        ) => *after = *next_after,
        (
            ProvisionalDeltaEntry::StatusPresence { after, .. },
            ProvisionalDeltaEntry::StatusPresence {
                after: next_after, ..
            },
        ) => *after = *next_after,
        (
            ProvisionalDeltaEntry::CombatantState { after, .. },
            ProvisionalDeltaEntry::CombatantState {
                after: next_after, ..
            },
        ) => *after = *next_after,
        (
            ProvisionalDeltaEntry::SoloRecoveryAvailable { after, .. },
            ProvisionalDeltaEntry::SoloRecoveryAvailable {
                after: next_after, ..
            },
        ) => *after = *next_after,
        (
            ProvisionalDeltaEntry::WorldFact { after_digest, .. },
            ProvisionalDeltaEntry::WorldFact {
                after_digest: next_after,
                ..
            },
        ) => *after_digest = next_after.clone(),
        _ => {
            return Err(runtime_error(
                RuntimeCommitErrorCode::InvalidProvisionalDelta,
                "delta-kind",
            ));
        }
    }
    Ok(())
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum DomainScalar {
    Integer(i64),
    CombatantState(crate::CombatantState),
    Boolean(bool),
    Digest(Option<String>),
}

fn domain_scalar(entry: &CanonicalDomainValue) -> DomainScalar {
    match entry {
        CanonicalDomainValue::HitPoints { value, .. }
        | CanonicalDomainValue::MaxHitPoints { value, .. }
        | CanonicalDomainValue::Shield { value, .. }
        | CanonicalDomainValue::Resource { value, .. }
        | CanonicalDomainValue::ItemQuantity { value, .. } => DomainScalar::Integer(*value),
        CanonicalDomainValue::CombatantState { value, .. } => DomainScalar::CombatantState(*value),
        CanonicalDomainValue::SoloRecoveryAvailable { value, .. } => DomainScalar::Boolean(*value),
        CanonicalDomainValue::StatusPresence { value, .. } => DomainScalar::Boolean(*value),
        CanonicalDomainValue::WorldFact { digest, .. } => DomainScalar::Digest(digest.clone()),
    }
}

fn delta_before(entry: &ProvisionalDeltaEntry) -> DomainScalar {
    match entry {
        ProvisionalDeltaEntry::HitPoints { before, .. }
        | ProvisionalDeltaEntry::MaxHitPoints { before, .. }
        | ProvisionalDeltaEntry::Shield { before, .. }
        | ProvisionalDeltaEntry::Resource { before, .. }
        | ProvisionalDeltaEntry::ItemQuantity { before, .. } => DomainScalar::Integer(*before),
        ProvisionalDeltaEntry::CombatantState { before, .. } => {
            DomainScalar::CombatantState(*before)
        }
        ProvisionalDeltaEntry::SoloRecoveryAvailable { before, .. } => {
            DomainScalar::Boolean(*before)
        }
        ProvisionalDeltaEntry::StatusPresence { before, .. } => DomainScalar::Boolean(*before),
        ProvisionalDeltaEntry::WorldFact { before_digest, .. } => {
            DomainScalar::Digest(before_digest.clone())
        }
    }
}

fn delta_after(entry: &ProvisionalDeltaEntry) -> DomainScalar {
    match entry {
        ProvisionalDeltaEntry::HitPoints { after, .. }
        | ProvisionalDeltaEntry::MaxHitPoints { after, .. }
        | ProvisionalDeltaEntry::Shield { after, .. }
        | ProvisionalDeltaEntry::Resource { after, .. }
        | ProvisionalDeltaEntry::ItemQuantity { after, .. } => DomainScalar::Integer(*after),
        ProvisionalDeltaEntry::CombatantState { after, .. } => DomainScalar::CombatantState(*after),
        ProvisionalDeltaEntry::SoloRecoveryAvailable { after, .. } => DomainScalar::Boolean(*after),
        ProvisionalDeltaEntry::StatusPresence { after, .. } => DomainScalar::Boolean(*after),
        ProvisionalDeltaEntry::WorldFact { after_digest, .. } => {
            DomainScalar::Digest(after_digest.clone())
        }
    }
}

fn validate_runtime_projection(
    state: &CombatState,
    entry: &ProvisionalDeltaEntry,
) -> Result<(), RuntimeCommitError> {
    let actual = match entry {
        ProvisionalDeltaEntry::HitPoints { combatant_id, .. } => state
            .combatants
            .iter()
            .find(|combatant| combatant.combatant_id == *combatant_id)
            .map(|combatant| DomainScalar::Integer(combatant.hit_points)),
        ProvisionalDeltaEntry::MaxHitPoints { combatant_id, .. } => state
            .combatants
            .iter()
            .find(|combatant| combatant.combatant_id == *combatant_id)
            .map(|combatant| DomainScalar::Integer(combatant.max_hit_points)),
        ProvisionalDeltaEntry::CombatantState { combatant_id, .. } => state
            .combatants
            .iter()
            .find(|combatant| combatant.combatant_id == *combatant_id)
            .map(|combatant| DomainScalar::CombatantState(combatant.state)),
        ProvisionalDeltaEntry::SoloRecoveryAvailable { combatant_id, .. } => state
            .combatants
            .iter()
            .find(|combatant| combatant.combatant_id == *combatant_id)
            .map(|combatant| DomainScalar::Boolean(combatant.solo_recovery_available)),
        ProvisionalDeltaEntry::Shield { combatant_id, .. } => state
            .combatants
            .iter()
            .find(|combatant| combatant.combatant_id == *combatant_id)
            .map(|combatant| DomainScalar::Integer(combatant.shield)),
        ProvisionalDeltaEntry::Resource {
            combatant_id,
            resource_id,
            ..
        } => state
            .combatants
            .iter()
            .find(|combatant| combatant.combatant_id == *combatant_id)
            .and_then(|combatant| {
                combatant
                    .resources
                    .iter()
                    .find(|resource| resource.resource_id == *resource_id)
            })
            .map(|resource| DomainScalar::Integer(resource.current)),
        ProvisionalDeltaEntry::ItemQuantity {
            owner_id, item_id, ..
        } => state
            .combat_inventory
            .iter()
            .find(|item| item.owner_id == *owner_id && item.item_id == *item_id)
            .map(|item| DomainScalar::Integer(item.current_quantity)),
        ProvisionalDeltaEntry::StatusPresence {
            combatant_id,
            status_instance_id,
            ..
        } => state
            .combatants
            .iter()
            .find(|combatant| combatant.combatant_id == *combatant_id)
            .map(|combatant| {
                DomainScalar::Boolean(
                    combatant
                        .statuses
                        .iter()
                        .any(|status| status.status_instance_id == *status_instance_id),
                )
            }),
        ProvisionalDeltaEntry::WorldFact { .. } => return Ok(()),
    };
    if actual.as_ref() != Some(&delta_after(entry)) {
        return Err(runtime_error(
            RuntimeCommitErrorCode::RuntimeProjectionMismatch,
            &domain_key_subject(&delta_entry_key(entry)),
        ));
    }
    Ok(())
}

fn validate_snapshot_entry(entry: &CanonicalDomainValue) -> Result<(), RuntimeCommitError> {
    match entry {
        CanonicalDomainValue::HitPoints {
            combatant_id,
            value,
        }
        | CanonicalDomainValue::MaxHitPoints {
            combatant_id,
            value,
        }
        | CanonicalDomainValue::Shield {
            combatant_id,
            value,
        } => {
            validate_stable_id(combatant_id)?;
            if *value < 0 {
                return Err(runtime_error(
                    RuntimeCommitErrorCode::InvalidSnapshot,
                    combatant_id,
                ));
            }
        }
        CanonicalDomainValue::CombatantState { combatant_id, .. } => {
            validate_stable_id(combatant_id)?;
        }
        CanonicalDomainValue::SoloRecoveryAvailable { combatant_id, .. } => {
            validate_stable_id(combatant_id)?;
        }
        CanonicalDomainValue::Resource {
            combatant_id,
            resource_id,
            ..
        } => {
            validate_stable_id(combatant_id)?;
            validate_stable_id(resource_id)?;
        }
        CanonicalDomainValue::ItemQuantity {
            owner_id,
            item_id,
            value,
        } => {
            validate_stable_id(owner_id)?;
            validate_stable_id(item_id)?;
            if *value < 0 {
                return Err(runtime_error(
                    RuntimeCommitErrorCode::InvalidSnapshot,
                    item_id,
                ));
            }
        }
        CanonicalDomainValue::StatusPresence {
            combatant_id,
            status_instance_id,
            ..
        } => {
            validate_stable_id(combatant_id)?;
            validate_stable_id(status_instance_id)?;
        }
        CanonicalDomainValue::WorldFact { fact_id, digest } => {
            validate_stable_id(fact_id)?;
            validate_optional_digest(digest.as_deref())?;
        }
    }
    Ok(())
}

fn validate_delta_entry(entry: &ProvisionalDeltaEntry) -> Result<(), RuntimeCommitError> {
    match entry {
        ProvisionalDeltaEntry::HitPoints {
            combatant_id,
            before,
            after,
        }
        | ProvisionalDeltaEntry::MaxHitPoints {
            combatant_id,
            before,
            after,
        }
        | ProvisionalDeltaEntry::Shield {
            combatant_id,
            before,
            after,
        } => {
            validate_stable_id(combatant_id)?;
            if *before < 0 || *after < 0 {
                return Err(runtime_error(
                    RuntimeCommitErrorCode::InvalidProvisionalDelta,
                    combatant_id,
                ));
            }
        }
        ProvisionalDeltaEntry::CombatantState { combatant_id, .. } => {
            validate_stable_id(combatant_id)?;
        }
        ProvisionalDeltaEntry::SoloRecoveryAvailable { combatant_id, .. } => {
            validate_stable_id(combatant_id)?;
        }
        ProvisionalDeltaEntry::Resource {
            combatant_id,
            resource_id,
            ..
        } => {
            validate_stable_id(combatant_id)?;
            validate_stable_id(resource_id)?;
        }
        ProvisionalDeltaEntry::ItemQuantity {
            owner_id,
            item_id,
            before,
            after,
        } => {
            validate_stable_id(owner_id)?;
            validate_stable_id(item_id)?;
            if *before < 0 || *after < 0 {
                return Err(runtime_error(
                    RuntimeCommitErrorCode::InvalidProvisionalDelta,
                    item_id,
                ));
            }
        }
        ProvisionalDeltaEntry::StatusPresence {
            combatant_id,
            status_instance_id,
            ..
        } => {
            validate_stable_id(combatant_id)?;
            validate_stable_id(status_instance_id)?;
        }
        ProvisionalDeltaEntry::WorldFact {
            fact_id,
            before_digest,
            after_digest,
        } => {
            validate_stable_id(fact_id)?;
            validate_optional_digest(before_digest.as_deref())?;
            validate_optional_digest(after_digest.as_deref())?;
        }
    }
    Ok(())
}

fn validate_optional_digest(value: Option<&str>) -> Result<(), RuntimeCommitError> {
    if value.is_some_and(|digest| {
        digest.len() != 64 || !digest.bytes().all(|byte| byte.is_ascii_hexdigit())
    }) {
        return Err(runtime_error(
            RuntimeCommitErrorCode::InvalidProvisionalDelta,
            "digest",
        ));
    }
    Ok(())
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
enum DomainKey {
    HitPoints(String),
    MaxHitPoints(String),
    CombatantState(String),
    SoloRecoveryAvailable(String),
    Shield(String),
    Resource(String, String),
    ItemQuantity(String, String),
    StatusPresence(String, String),
    WorldFact(String),
}

fn domain_value_key(entry: &CanonicalDomainValue) -> DomainKey {
    match entry {
        CanonicalDomainValue::HitPoints { combatant_id, .. } => {
            DomainKey::HitPoints(combatant_id.clone())
        }
        CanonicalDomainValue::MaxHitPoints { combatant_id, .. } => {
            DomainKey::MaxHitPoints(combatant_id.clone())
        }
        CanonicalDomainValue::CombatantState { combatant_id, .. } => {
            DomainKey::CombatantState(combatant_id.clone())
        }
        CanonicalDomainValue::SoloRecoveryAvailable { combatant_id, .. } => {
            DomainKey::SoloRecoveryAvailable(combatant_id.clone())
        }
        CanonicalDomainValue::Shield { combatant_id, .. } => {
            DomainKey::Shield(combatant_id.clone())
        }
        CanonicalDomainValue::Resource {
            combatant_id,
            resource_id,
            ..
        } => DomainKey::Resource(combatant_id.clone(), resource_id.clone()),
        CanonicalDomainValue::ItemQuantity {
            owner_id, item_id, ..
        } => DomainKey::ItemQuantity(owner_id.clone(), item_id.clone()),
        CanonicalDomainValue::StatusPresence {
            combatant_id,
            status_instance_id,
            ..
        } => DomainKey::StatusPresence(combatant_id.clone(), status_instance_id.clone()),
        CanonicalDomainValue::WorldFact { fact_id, .. } => DomainKey::WorldFact(fact_id.clone()),
    }
}

fn delta_entry_key(entry: &ProvisionalDeltaEntry) -> DomainKey {
    match entry {
        ProvisionalDeltaEntry::HitPoints { combatant_id, .. } => {
            DomainKey::HitPoints(combatant_id.clone())
        }
        ProvisionalDeltaEntry::MaxHitPoints { combatant_id, .. } => {
            DomainKey::MaxHitPoints(combatant_id.clone())
        }
        ProvisionalDeltaEntry::CombatantState { combatant_id, .. } => {
            DomainKey::CombatantState(combatant_id.clone())
        }
        ProvisionalDeltaEntry::SoloRecoveryAvailable { combatant_id, .. } => {
            DomainKey::SoloRecoveryAvailable(combatant_id.clone())
        }
        ProvisionalDeltaEntry::Shield { combatant_id, .. } => {
            DomainKey::Shield(combatant_id.clone())
        }
        ProvisionalDeltaEntry::Resource {
            combatant_id,
            resource_id,
            ..
        } => DomainKey::Resource(combatant_id.clone(), resource_id.clone()),
        ProvisionalDeltaEntry::ItemQuantity {
            owner_id, item_id, ..
        } => DomainKey::ItemQuantity(owner_id.clone(), item_id.clone()),
        ProvisionalDeltaEntry::StatusPresence {
            combatant_id,
            status_instance_id,
            ..
        } => DomainKey::StatusPresence(combatant_id.clone(), status_instance_id.clone()),
        ProvisionalDeltaEntry::WorldFact { fact_id, .. } => DomainKey::WorldFact(fact_id.clone()),
    }
}

fn domain_key_subject(key: &DomainKey) -> String {
    match key {
        DomainKey::HitPoints(combatant_id) => format!("hit-points:{combatant_id}"),
        DomainKey::MaxHitPoints(combatant_id) => format!("max-hit-points:{combatant_id}"),
        DomainKey::CombatantState(combatant_id) => format!("combatant-state:{combatant_id}"),
        DomainKey::SoloRecoveryAvailable(combatant_id) => {
            format!("solo-recovery-available:{combatant_id}")
        }
        DomainKey::Shield(combatant_id) => format!("shield:{combatant_id}"),
        DomainKey::Resource(combatant_id, resource_id) => {
            format!("resource:{combatant_id}:{resource_id}")
        }
        DomainKey::ItemQuantity(owner_id, item_id) => format!("item:{owner_id}:{item_id}"),
        DomainKey::StatusPresence(combatant_id, status_instance_id) => {
            format!("status:{combatant_id}:{status_instance_id}")
        }
        DomainKey::WorldFact(fact_id) => format!("world-fact:{fact_id}"),
    }
}

fn hash_serializable(value: &impl Serialize) -> Result<String, RuntimeCommitError> {
    let bytes = serde_json::to_vec(value).map_err(|_| {
        runtime_error(
            RuntimeCommitErrorCode::SerializationFailed,
            "canonical-json",
        )
    })?;
    Ok(format!("{:x}", Sha256::digest(bytes)))
}

fn validate_stable_id(value: &str) -> Result<(), RuntimeCommitError> {
    if value.is_empty()
        || value.len() > 128
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b':' | b'-'))
    {
        Err(runtime_error(
            RuntimeCommitErrorCode::InvalidStableId,
            value,
        ))
    } else {
        Ok(())
    }
}

fn runtime_error(code: RuntimeCommitErrorCode, subject_id: &str) -> RuntimeCommitError {
    RuntimeCommitError {
        code,
        subject_id: subject_id.to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        AbilityUsageState, CanonicalEventChainScheduler, CombatInventoryItemState, CombatPhase,
        CombatRng, CombatSide, CombatState, CombatantRuntime, CombatantState,
        ObjectiveRuntimeState, ProvisionalRuntimeDelta, ReinforcementRuntimeState, ResourceState,
        ResultCandidate, RoundRuntimeState, SchedulerCandidate, SchedulerExecutionGateOutcome,
        SchedulerItemKind, TerminalOutcomeArbitrator, TerminalPriorityPolicy,
    };

    const SEED: &str = "abcdef0123456789abcdef0123456789";

    #[test]
    fn victory_builds_one_canonical_collapsed_delta_and_stable_commit_identity() {
        let snapshot = snapshot();
        let mut state = runtime_state();
        confirm(&mut state, CombatResultType::Victory);
        let before = state.clone();

        let first = RuntimeCommitContract::build_finalization_plan(
            &state,
            &snapshot,
            RuntimeFinalizationRequest::default(),
        )
        .unwrap();
        let second = RuntimeCommitContract::build_finalization_plan(
            &state,
            &snapshot,
            RuntimeFinalizationRequest::default(),
        )
        .unwrap();

        assert_eq!(first, second);
        assert_eq!(state, before);
        assert_eq!(first.result_type, CombatResultType::Victory);
        assert_eq!(
            first.persistence_policy,
            ResultPersistencePolicy::CommitRuntimeDelta
        );
        assert!(first.rollback_snapshot.is_none());
        assert_eq!(first.canonical_delta.entries.len(), 3);
        assert_eq!(
            first.canonical_delta.entries[0],
            ProvisionalDeltaEntry::HitPoints {
                combatant_id: "hero".to_owned(),
                before: 10,
                after: 8,
            }
        );
        assert!(first.result_commit_id.starts_with("combat-result:"));
        assert_eq!(first.result_commit_id.len(), 78);
        assert_eq!(first.finished_fact.correlation_id, first.result_commit_id);
        assert_eq!(
            first.runtime_state_hash_sha256,
            state.state_hash_sha256().unwrap()
        );
    }

    #[test]
    fn ordinary_defeat_discards_runtime_delta_and_restores_exact_snapshot() {
        let snapshot = snapshot();
        let mut state = runtime_state();
        confirm(&mut state, CombatResultType::Defeat);

        let plan = RuntimeCommitContract::build_finalization_plan(
            &state,
            &snapshot,
            RuntimeFinalizationRequest::default(),
        )
        .unwrap();

        assert_eq!(
            plan.persistence_policy,
            ResultPersistencePolicy::RestorePrecombatSnapshot
        );
        assert!(plan.canonical_delta.entries.is_empty());
        assert_eq!(plan.rollback_snapshot, Some(snapshot));
    }

    #[test]
    fn loop_guard_aborted_uses_overflow_sequence_and_never_commits_runtime_delta() {
        let snapshot = snapshot();
        let mut state = runtime_state();
        CanonicalEventChainScheduler::begin(&mut state, "chain".to_owned(), 8, 0).unwrap();
        CanonicalEventChainScheduler::enqueue_roots(
            &mut state,
            vec![SchedulerCandidate {
                kind: SchedulerItemKind::Trigger,
                phase_priority: 1,
                explicit_priority: 0,
                source_stable_id: "system".to_owned(),
                effect_stable_id: "overflow".to_owned(),
            }],
        )
        .unwrap();
        let overflow_sequence = CanonicalEventChainScheduler::dequeue_next(&mut state)
            .unwrap()
            .unwrap()
            .sequence;
        assert!(matches!(
            CanonicalEventChainScheduler::gate_current_for_execution(&mut state, true).unwrap(),
            SchedulerExecutionGateOutcome::EngineFailure { .. }
        ));

        let plan = RuntimeCommitContract::build_finalization_plan(
            &state,
            &snapshot,
            RuntimeFinalizationRequest::default(),
        )
        .unwrap();

        assert_eq!(plan.result_type, CombatResultType::Aborted);
        assert_eq!(plan.final_result_sequence, overflow_sequence);
        assert_eq!(
            plan.persistence_policy,
            ResultPersistencePolicy::RestorePrecombatSnapshot
        );
        assert!(plan.canonical_delta.entries.is_empty());
        assert_eq!(plan.rollback_snapshot, Some(snapshot));
    }

    #[test]
    fn scripted_result_requires_and_obeys_an_explicit_persistence_policy() {
        let snapshot = snapshot_with_world_fact();
        let mut state = runtime_state();
        confirm(&mut state, CombatResultType::ScriptedVictory);
        assert!(matches!(
            RuntimeCommitContract::build_finalization_plan(
                &state,
                &snapshot,
                RuntimeFinalizationRequest::default(),
            ),
            Err(RuntimeCommitError {
                code: RuntimeCommitErrorCode::InvalidScriptedPolicy,
                ..
            })
        ));

        let commit = RuntimeCommitContract::build_finalization_plan(
            &state,
            &snapshot,
            RuntimeFinalizationRequest {
                scripted_persistence_policy: Some(ResultPersistencePolicy::CommitRuntimeDelta),
                scripted_delta_entries: vec![],
            },
        )
        .unwrap();
        assert_eq!(commit.canonical_delta.entries.len(), 3);
        assert!(commit.rollback_snapshot.is_none());

        let scripted_digest = "a".repeat(64);
        let restore_then_apply = RuntimeCommitContract::build_finalization_plan(
            &state,
            &snapshot,
            RuntimeFinalizationRequest {
                scripted_persistence_policy: Some(
                    ResultPersistencePolicy::RestoreSnapshotThenApplyScriptedDelta,
                ),
                scripted_delta_entries: vec![ProvisionalDeltaEntry::WorldFact {
                    fact_id: "boss-spared".to_owned(),
                    before_digest: None,
                    after_digest: Some(scripted_digest.clone()),
                }],
            },
        )
        .unwrap();
        assert_eq!(
            restore_then_apply.persistence_policy,
            ResultPersistencePolicy::RestoreSnapshotThenApplyScriptedDelta
        );
        assert_eq!(restore_then_apply.rollback_snapshot, Some(snapshot));
        assert_eq!(
            restore_then_apply.canonical_delta.entries,
            vec![ProvisionalDeltaEntry::WorldFact {
                fact_id: "boss-spared".to_owned(),
                before_digest: None,
                after_digest: Some(scripted_digest),
            }]
        );
    }

    #[test]
    fn snapshot_delta_and_runtime_drift_fail_closed() {
        let mut bad_snapshot = snapshot();
        bad_snapshot.entries.reverse();
        assert!(matches!(
            RuntimeCommitContract::validate_snapshot(&bad_snapshot),
            Err(RuntimeCommitError {
                code: RuntimeCommitErrorCode::InvalidSnapshot,
                ..
            })
        ));

        let snapshot = snapshot();
        let mut discontinuous = runtime_state();
        discontinuous.provisional_delta.entries[1] = ProvisionalDeltaEntry::HitPoints {
            combatant_id: "hero".to_owned(),
            before: 7,
            after: 8,
        };
        confirm(&mut discontinuous, CombatResultType::Victory);
        assert!(matches!(
            RuntimeCommitContract::build_finalization_plan(
                &discontinuous,
                &snapshot,
                RuntimeFinalizationRequest::default(),
            ),
            Err(RuntimeCommitError {
                code: RuntimeCommitErrorCode::InvalidProvisionalDelta,
                ..
            })
        ));

        let mut projection_drift = runtime_state();
        projection_drift.combatants[0].hit_points = 7;
        confirm(&mut projection_drift, CombatResultType::Victory);
        assert!(matches!(
            RuntimeCommitContract::build_finalization_plan(
                &projection_drift,
                &snapshot,
                RuntimeFinalizationRequest::default(),
            ),
            Err(RuntimeCommitError {
                code: RuntimeCommitErrorCode::RuntimeProjectionMismatch,
                ..
            })
        ));

        let mut revision_drift = runtime_state();
        revision_drift.provisional_delta.revision += 1;
        confirm(&mut revision_drift, CombatResultType::Victory);
        assert!(matches!(
            RuntimeCommitContract::build_finalization_plan(
                &revision_drift,
                &snapshot,
                RuntimeFinalizationRequest::default(),
            ),
            Err(RuntimeCommitError {
                code: RuntimeCommitErrorCode::InvalidProvisionalDelta,
                ..
            })
        ));
    }

    #[test]
    fn non_scripted_result_rejects_scripted_overrides_and_snapshot_identity_drift() {
        let snapshot = snapshot();
        let mut state = runtime_state();
        confirm(&mut state, CombatResultType::Escape);
        assert!(matches!(
            RuntimeCommitContract::build_finalization_plan(
                &state,
                &snapshot,
                RuntimeFinalizationRequest {
                    scripted_persistence_policy: Some(
                        ResultPersistencePolicy::RestorePrecombatSnapshot,
                    ),
                    scripted_delta_entries: vec![],
                },
            ),
            Err(RuntimeCommitError {
                code: RuntimeCommitErrorCode::InvalidScriptedPolicy,
                ..
            })
        ));

        let foreign = RuntimeCommitContract::capture_precombat_snapshot(
            "other-combat".to_owned(),
            CURRENT_COMBAT_VERSIONS,
            snapshot.entries,
        )
        .unwrap();
        assert!(matches!(
            RuntimeCommitContract::build_finalization_plan(
                &state,
                &foreign,
                RuntimeFinalizationRequest::default(),
            ),
            Err(RuntimeCommitError {
                code: RuntimeCommitErrorCode::SnapshotMismatch,
                ..
            })
        ));
    }

    #[test]
    fn max_hit_points_and_combatant_state_share_canonical_delta_contract() {
        let mut state = runtime_state();
        state.combatants[0].max_hit_points = 8;
        state.combatants[0].hit_points = 0;
        state.combatants[0].state = CombatantState::Defeated;
        state.combatants[0].solo_recovery_available = true;
        let entries = vec![
            ProvisionalDeltaEntry::MaxHitPoints {
                combatant_id: "hero".into(),
                before: 10,
                after: 8,
            },
            ProvisionalDeltaEntry::CombatantState {
                combatant_id: "hero".into(),
                before: CombatantState::Active,
                after: CombatantState::Defeated,
            },
            ProvisionalDeltaEntry::HitPoints {
                combatant_id: "hero".into(),
                before: 10,
                after: 0,
            },
            ProvisionalDeltaEntry::SoloRecoveryAvailable {
                combatant_id: "hero".into(),
                before: false,
                after: true,
            },
        ];
        let snapshot = vec![
            CanonicalDomainValue::MaxHitPoints {
                combatant_id: "hero".into(),
                value: 10,
            },
            CanonicalDomainValue::CombatantState {
                combatant_id: "hero".into(),
                value: CombatantState::Active,
            },
            CanonicalDomainValue::HitPoints {
                combatant_id: "hero".into(),
                value: 10,
            },
            CanonicalDomainValue::SoloRecoveryAvailable {
                combatant_id: "hero".into(),
                value: false,
            },
        ];

        let canonical = canonicalize_delta(&snapshot, &entries, Some(&state)).unwrap();
        assert_eq!(canonical.len(), 4);
        assert!(canonical.iter().any(|entry| matches!(
            entry,
            ProvisionalDeltaEntry::MaxHitPoints {
                before: 10,
                after: 8,
                ..
            }
        )));
        assert!(canonical.iter().any(|entry| matches!(
            entry,
            ProvisionalDeltaEntry::SoloRecoveryAvailable {
                before: false,
                after: true,
                ..
            }
        )));
        assert!(canonical.iter().any(|entry| matches!(
            entry,
            ProvisionalDeltaEntry::CombatantState {
                before: CombatantState::Active,
                after: CombatantState::Defeated,
                ..
            }
        )));
    }

    fn confirm(state: &mut CombatState, result_type: CombatResultType) {
        state.result_candidates.push(ResultCandidate {
            candidate_id: "result".to_owned(),
            result_type,
            source_kind: "SYSTEM".to_owned(),
            source_id: "fixture".to_owned(),
            explicit_priority: None,
            sequence: 1,
        });
        TerminalOutcomeArbitrator::confirm(state).unwrap();
    }

    fn snapshot() -> PreCombatSnapshot {
        RuntimeCommitContract::capture_precombat_snapshot(
            "combat-runtime-fixture".to_owned(),
            CURRENT_COMBAT_VERSIONS,
            vec![
                CanonicalDomainValue::ItemQuantity {
                    owner_id: "hero".to_owned(),
                    item_id: "potion".to_owned(),
                    value: 2,
                },
                CanonicalDomainValue::Resource {
                    combatant_id: "hero".to_owned(),
                    resource_id: "mana".to_owned(),
                    value: 5,
                },
                CanonicalDomainValue::HitPoints {
                    combatant_id: "hero".to_owned(),
                    value: 10,
                },
            ],
        )
        .unwrap()
    }

    fn snapshot_with_world_fact() -> PreCombatSnapshot {
        let mut entries = snapshot().entries;
        entries.push(CanonicalDomainValue::WorldFact {
            fact_id: "boss-spared".to_owned(),
            digest: None,
        });
        RuntimeCommitContract::capture_precombat_snapshot(
            "combat-runtime-fixture".to_owned(),
            CURRENT_COMBAT_VERSIONS,
            entries,
        )
        .unwrap()
    }

    fn runtime_state() -> CombatState {
        CombatState {
            combat_instance_id: "combat-runtime-fixture".to_owned(),
            versions: CURRENT_COMBAT_VERSIONS,
            random_seed: SEED.to_owned(),
            revision: 1,
            last_committed_sequence: 0,
            phase: CombatPhase::BattleStart,
            combatants: vec![combatant()],
            formal_party_member_ids: vec![],
            combat_inventory: vec![CombatInventoryItemState {
                owner_id: "hero".to_owned(),
                item_id: "potion".to_owned(),
                current_quantity: 1,
            }],
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
                revision: 4,
                entries: vec![
                    ProvisionalDeltaEntry::HitPoints {
                        combatant_id: "hero".to_owned(),
                        before: 10,
                        after: 9,
                    },
                    ProvisionalDeltaEntry::HitPoints {
                        combatant_id: "hero".to_owned(),
                        before: 9,
                        after: 8,
                    },
                    ProvisionalDeltaEntry::Resource {
                        combatant_id: "hero".to_owned(),
                        resource_id: "mana".to_owned(),
                        before: 5,
                        after: 3,
                    },
                    ProvisionalDeltaEntry::ItemQuantity {
                        owner_id: "hero".to_owned(),
                        item_id: "potion".to_owned(),
                        before: 2,
                        after: 1,
                    },
                ],
            },
            scheduler: None,
            pending_reaction: None,
            result_candidates: vec![],
            terminal_priority_policy: TerminalPriorityPolicy::default(),
            confirmed_result_candidate_id: None,
            confirmed_result: None,
            rng: CombatRng::new(
                SEED,
                "combat-runtime-fixture",
                CURRENT_COMBAT_VERSIONS.rng_contract_version,
            )
            .unwrap()
            .snapshot(),
        }
    }

    fn combatant() -> CombatantRuntime {
        CombatantRuntime {
            combatant_id: "hero".to_owned(),
            definition_id: "hero-definition".to_owned(),
            side: CombatSide::Player,
            state: CombatantState::Active,
            hit_points: 8,
            max_hit_points: 10,
            shield: 0,
            max_shield: 0,
            action_points: 3,
            max_action_points: 3,
            reaction_charges: 1,
            max_reaction_charges: 1,
            resources: vec![ResourceState {
                resource_id: "mana".to_owned(),
                current: 3,
                min_value: 0,
                max_value: 5,
                overheat_threshold: None,
                hard_max_value: None,
            }],
            statuses: vec![],
            ability_usage: vec![AbilityUsageState {
                ability_id: "basic".to_owned(),
                cooldown_remaining: 0,
                uses_this_normal_owner_turn: 0,
                uses_this_battle: 0,
            }],
            basic_attack_count_this_normal_owner_turn: 0,
            once_usage_counters: vec![],
            normal_owner_turn_index: 0,
            hard_cc_dr: crate::HardCcDrRuntime::default(),
            shield_recharge: crate::ShieldRechargeRuntime::default(),
            initiative_result: 10,
            initiative_base_stat: 2,
            last_committed_timeline_order: None,
            solo_recovery_available: false,
        }
    }
}

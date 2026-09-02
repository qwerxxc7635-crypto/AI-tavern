use std::{error::Error, fmt};

use serde::{Deserialize, Serialize};

use crate::{CombatState, CombatantRuntime, CostCommitState, ProvisionalDeltaEntry};

const MAX_SAFE_SEQUENCE: u64 = 9_007_199_254_740_991;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "SCREAMING_SNAKE_CASE",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum CombatCostAsset {
    ActionPoints {
        combatant_id: String,
    },
    Resource {
        combatant_id: String,
        resource_id: String,
    },
    Item {
        owner_id: String,
        item_id: String,
    },
    ReactionCharge {
        combatant_id: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CombatCostRequestLine {
    pub cost_id: String,
    pub asset: CombatCostAsset,
    pub amount: i64,
    pub consume_cost_on_interrupt: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CostReservationRequest {
    pub reservation_id: String,
    pub command_id: String,
    pub parent_reservation_id: Option<String>,
    pub costs: Vec<CombatCostRequestLine>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CostReservationStatus {
    Reserved,
    Committed,
    Released,
    Interrupted,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReservedCombatCost {
    pub cost_id: String,
    pub asset: CombatCostAsset,
    pub amount: i64,
    pub consume_cost_on_interrupt: bool,
    pub state: CostCommitState,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CostReservationRecord {
    pub reservation_id: String,
    pub command_id: String,
    pub parent_reservation_id: Option<String>,
    pub sequence: u64,
    pub status: CostReservationStatus,
    pub costs: Vec<ReservedCombatCost>,
}

impl CostReservationRecord {
    fn matches_request(&self, request: &CostReservationRequest) -> bool {
        self.reservation_id == request.reservation_id
            && self.command_id == request.command_id
            && self.parent_reservation_id == request.parent_reservation_id
            && self.costs.len() == request.costs.len()
            && self.costs.iter().zip(&request.costs).all(|(a, b)| {
                a.cost_id == b.cost_id
                    && a.asset == b.asset
                    && a.amount == b.amount
                    && a.consume_cost_on_interrupt == b.consume_cost_on_interrupt
            })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CombatInventoryItemState {
    pub owner_id: String,
    pub item_id: String,
    pub current_quantity: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CostReservationMutationStatus {
    Created,
    Committed,
    Released,
    Interrupted,
    AlreadyApplied,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CostReservationReceipt {
    pub status: CostReservationMutationStatus,
    pub record: CostReservationRecord,
}

pub struct CostReservationModel;

impl CostReservationModel {
    pub fn reserve(
        state: &mut CombatState,
        request: CostReservationRequest,
    ) -> Result<CostReservationReceipt, CostReservationError> {
        validate_request(&request)?;
        Self::validate_state(state)?;
        if let Some(existing) = state.cost_reservations.iter().find(|existing| {
            existing.reservation_id == request.reservation_id
                || existing.command_id == request.command_id
        }) {
            if existing.matches_request(&request) {
                return Ok(CostReservationReceipt {
                    status: CostReservationMutationStatus::AlreadyApplied,
                    record: existing.clone(),
                });
            }
            return Err(cost_error(
                CostReservationErrorCode::IdentityConflict,
                &request.reservation_id,
            ));
        }
        if let Some(parent_id) = &request.parent_reservation_id {
            let parent = state
                .cost_reservations
                .iter()
                .find(|record| record.reservation_id == *parent_id)
                .ok_or_else(|| cost_error(CostReservationErrorCode::ParentMissing, parent_id))?;
            if matches!(
                parent.status,
                CostReservationStatus::Released | CostReservationStatus::Interrupted
            ) {
                return Err(cost_error(
                    CostReservationErrorCode::InvalidTransition,
                    parent_id,
                ));
            }
        }
        for line in &request.costs {
            ensure_available(state, &line.asset, line.amount, &request.reservation_id)?;
        }
        let record = CostReservationRecord {
            reservation_id: request.reservation_id,
            command_id: request.command_id,
            parent_reservation_id: request.parent_reservation_id,
            sequence: next_sequence(state)?,
            status: CostReservationStatus::Reserved,
            costs: request
                .costs
                .into_iter()
                .map(|line| ReservedCombatCost {
                    cost_id: line.cost_id,
                    asset: line.asset,
                    amount: line.amount,
                    consume_cost_on_interrupt: line.consume_cost_on_interrupt,
                    state: CostCommitState::Reserved,
                })
                .collect(),
        };
        let mut working = state.clone();
        working.cost_reservations.push(record.clone());
        bump_state_revision(&mut working, &record.reservation_id)?;
        Self::validate_state(&working)?;
        working.validate_for_commit().map_err(|_| {
            cost_error(
                CostReservationErrorCode::StateInvariantViolation,
                &record.reservation_id,
            )
        })?;
        *state = working;
        Ok(CostReservationReceipt {
            status: CostReservationMutationStatus::Created,
            record,
        })
    }

    pub fn commit(
        state: &mut CombatState,
        reservation_id: &str,
    ) -> Result<CostReservationReceipt, CostReservationError> {
        transition(state, reservation_id, Transition::Commit)
    }

    pub fn cancel_before_resolution(
        state: &mut CombatState,
        reservation_id: &str,
    ) -> Result<CostReservationReceipt, CostReservationError> {
        transition(state, reservation_id, Transition::CancelBeforeResolution)
    }

    pub fn validate_state(state: &CombatState) -> Result<(), CostReservationError> {
        validate_inventory(state)?;
        for (index, record) in state.cost_reservations.iter().enumerate() {
            validate_record(record)?;
            let expected = u64::try_from(index)
                .ok()
                .and_then(|value| value.checked_add(1))
                .ok_or_else(|| {
                    cost_error(
                        CostReservationErrorCode::SequenceExhausted,
                        &record.reservation_id,
                    )
                })?;
            if record.sequence != expected || record.sequence > MAX_SAFE_SEQUENCE {
                return Err(cost_error(
                    CostReservationErrorCode::InvalidLedger,
                    &record.reservation_id,
                ));
            }
            if state.cost_reservations[..index].iter().any(|previous| {
                previous.reservation_id == record.reservation_id
                    || previous.command_id == record.command_id
            }) {
                return Err(cost_error(
                    CostReservationErrorCode::InvalidLedger,
                    &record.reservation_id,
                ));
            }
            if let Some(parent_id) = &record.parent_reservation_id
                && !state.cost_reservations[..index]
                    .iter()
                    .any(|parent| parent.reservation_id == *parent_id)
            {
                return Err(cost_error(
                    CostReservationErrorCode::InvalidLedger,
                    &record.reservation_id,
                ));
            }
        }
        for record in &state.cost_reservations {
            for cost in &record.costs {
                if cost.state == CostCommitState::Reserved {
                    ensure_reserved_ledger_is_covered(state, &cost.asset, &record.reservation_id)?;
                }
            }
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Copy)]
enum Transition {
    Commit,
    CancelBeforeResolution,
}

fn transition(
    state: &mut CombatState,
    reservation_id: &str,
    transition: Transition,
) -> Result<CostReservationReceipt, CostReservationError> {
    validate_stable_id(reservation_id, reservation_id)?;
    CostReservationModel::validate_state(state)?;
    let index = state
        .cost_reservations
        .iter()
        .position(|record| record.reservation_id == reservation_id)
        .ok_or_else(|| cost_error(CostReservationErrorCode::ReservationMissing, reservation_id))?;
    if state.cost_reservations.iter().any(|record| {
        record.parent_reservation_id.as_deref() == Some(reservation_id)
            && record.status == CostReservationStatus::Reserved
    }) {
        return Err(cost_error(
            CostReservationErrorCode::InvalidTransition,
            reservation_id,
        ));
    }
    match (transition, state.cost_reservations[index].status) {
        (Transition::Commit, CostReservationStatus::Committed)
        | (Transition::CancelBeforeResolution, CostReservationStatus::Released)
        | (Transition::CancelBeforeResolution, CostReservationStatus::Interrupted) => {
            return Ok(CostReservationReceipt {
                status: CostReservationMutationStatus::AlreadyApplied,
                record: state.cost_reservations[index].clone(),
            });
        }
        (_, CostReservationStatus::Reserved) => {}
        _ => {
            return Err(cost_error(
                CostReservationErrorCode::InvalidTransition,
                reservation_id,
            ));
        }
    }
    let mut working = state.clone();
    let costs = working.cost_reservations[index].costs.clone();
    let mut consumed_on_interrupt = false;
    for (line_index, cost) in costs.iter().enumerate() {
        let should_commit =
            matches!(transition, Transition::Commit) || cost.consume_cost_on_interrupt;
        if should_commit {
            apply_cost(&mut working, &cost.asset, cost.amount, reservation_id)?;
            working.cost_reservations[index].costs[line_index].state = CostCommitState::Committed;
            consumed_on_interrupt |= matches!(transition, Transition::CancelBeforeResolution);
        } else {
            working.cost_reservations[index].costs[line_index].state = CostCommitState::Released;
        }
    }
    let (record_status, receipt_status) = match transition {
        Transition::Commit => (
            CostReservationStatus::Committed,
            CostReservationMutationStatus::Committed,
        ),
        Transition::CancelBeforeResolution if consumed_on_interrupt => (
            CostReservationStatus::Interrupted,
            CostReservationMutationStatus::Interrupted,
        ),
        Transition::CancelBeforeResolution => (
            CostReservationStatus::Released,
            CostReservationMutationStatus::Released,
        ),
    };
    working.cost_reservations[index].status = record_status;
    bump_state_revision(&mut working, reservation_id)?;
    CostReservationModel::validate_state(&working)?;
    working.validate_for_commit().map_err(|_| {
        cost_error(
            CostReservationErrorCode::StateInvariantViolation,
            reservation_id,
        )
    })?;
    let record = working.cost_reservations[index].clone();
    *state = working;
    Ok(CostReservationReceipt {
        status: receipt_status,
        record,
    })
}

fn apply_cost(
    state: &mut CombatState,
    asset: &CombatCostAsset,
    amount: i64,
    subject_id: &str,
) -> Result<(), CostReservationError> {
    match asset {
        CombatCostAsset::ActionPoints { combatant_id } => {
            let value = &mut combatant_mut(state, combatant_id, subject_id)?.action_points;
            *value = value
                .checked_sub(amount)
                .filter(|after| *after >= 0)
                .ok_or_else(|| {
                    cost_error(CostReservationErrorCode::InsufficientAvailable, subject_id)
                })?;
        }
        CombatCostAsset::ReactionCharge { combatant_id } => {
            let value = &mut combatant_mut(state, combatant_id, subject_id)?.reaction_charges;
            *value = value
                .checked_sub(amount)
                .filter(|after| *after >= 0)
                .ok_or_else(|| {
                    cost_error(CostReservationErrorCode::InsufficientAvailable, subject_id)
                })?;
        }
        CombatCostAsset::Resource {
            combatant_id,
            resource_id,
        } => {
            let resource = combatant_mut(state, combatant_id, subject_id)?
                .resources
                .iter_mut()
                .find(|resource| resource.resource_id == *resource_id)
                .ok_or_else(|| cost_error(CostReservationErrorCode::AssetMissing, resource_id))?;
            resource.current = resource
                .current
                .checked_sub(amount)
                .filter(|after| *after >= resource.min_value)
                .ok_or_else(|| {
                    cost_error(CostReservationErrorCode::InsufficientAvailable, subject_id)
                })?;
        }
        CombatCostAsset::Item { owner_id, item_id } => {
            let item = state
                .combat_inventory
                .iter_mut()
                .find(|item| item.owner_id == *owner_id && item.item_id == *item_id)
                .ok_or_else(|| cost_error(CostReservationErrorCode::AssetMissing, item_id))?;
            let before = item.current_quantity;
            let after = before
                .checked_sub(amount)
                .filter(|after| *after >= 0)
                .ok_or_else(|| {
                    cost_error(CostReservationErrorCode::InsufficientAvailable, subject_id)
                })?;
            item.current_quantity = after;
            state
                .provisional_delta
                .entries
                .push(ProvisionalDeltaEntry::ItemQuantity {
                    owner_id: owner_id.clone(),
                    item_id: item_id.clone(),
                    before,
                    after,
                });
            state.provisional_delta.revision = state
                .provisional_delta
                .revision
                .checked_add(1)
                .ok_or_else(|| {
                    cost_error(CostReservationErrorCode::SequenceExhausted, subject_id)
                })?;
        }
    }
    Ok(())
}

fn ensure_available(
    state: &CombatState,
    asset: &CombatCostAsset,
    requested: i64,
    subject_id: &str,
) -> Result<(), CostReservationError> {
    let available = asset_available(state, asset, subject_id)?;
    let reserved = total_reserved(state, asset, subject_id)?;
    if available
        .checked_sub(reserved)
        .is_none_or(|remaining| remaining < requested)
    {
        Err(cost_error(
            CostReservationErrorCode::InsufficientAvailable,
            subject_id,
        ))
    } else {
        Ok(())
    }
}

fn ensure_reserved_ledger_is_covered(
    state: &CombatState,
    asset: &CombatCostAsset,
    subject_id: &str,
) -> Result<(), CostReservationError> {
    if total_reserved(state, asset, subject_id)? > asset_available(state, asset, subject_id)? {
        Err(cost_error(
            CostReservationErrorCode::InvalidLedger,
            subject_id,
        ))
    } else {
        Ok(())
    }
}

fn asset_available(
    state: &CombatState,
    asset: &CombatCostAsset,
    subject_id: &str,
) -> Result<i64, CostReservationError> {
    match asset {
        CombatCostAsset::ActionPoints { combatant_id } => {
            Ok(combatant(state, combatant_id, subject_id)?.action_points)
        }
        CombatCostAsset::ReactionCharge { combatant_id } => {
            Ok(combatant(state, combatant_id, subject_id)?.reaction_charges)
        }
        CombatCostAsset::Resource {
            combatant_id,
            resource_id,
        } => {
            let resource = combatant(state, combatant_id, subject_id)?
                .resources
                .iter()
                .find(|resource| resource.resource_id == *resource_id)
                .ok_or_else(|| cost_error(CostReservationErrorCode::AssetMissing, resource_id))?;
            resource
                .current
                .checked_sub(resource.min_value)
                .ok_or_else(|| cost_error(CostReservationErrorCode::InvalidLedger, subject_id))
        }
        CombatCostAsset::Item { owner_id, item_id } => state
            .combat_inventory
            .iter()
            .find(|item| item.owner_id == *owner_id && item.item_id == *item_id)
            .map(|item| item.current_quantity)
            .ok_or_else(|| cost_error(CostReservationErrorCode::AssetMissing, item_id)),
    }
}

fn total_reserved(
    state: &CombatState,
    asset: &CombatCostAsset,
    subject_id: &str,
) -> Result<i64, CostReservationError> {
    state
        .cost_reservations
        .iter()
        .flat_map(|record| &record.costs)
        .filter(|cost| cost.state == CostCommitState::Reserved && cost.asset == *asset)
        .try_fold(0_i64, |total, cost| {
            total
                .checked_add(cost.amount)
                .ok_or_else(|| cost_error(CostReservationErrorCode::NumericOverflow, subject_id))
        })
}

fn combatant<'a>(
    state: &'a CombatState,
    combatant_id: &str,
    subject_id: &str,
) -> Result<&'a CombatantRuntime, CostReservationError> {
    state
        .combatants
        .iter()
        .find(|value| value.combatant_id == combatant_id)
        .ok_or_else(|| cost_error(CostReservationErrorCode::AssetMissing, subject_id))
}

fn combatant_mut<'a>(
    state: &'a mut CombatState,
    combatant_id: &str,
    subject_id: &str,
) -> Result<&'a mut CombatantRuntime, CostReservationError> {
    state
        .combatants
        .iter_mut()
        .find(|value| value.combatant_id == combatant_id)
        .ok_or_else(|| cost_error(CostReservationErrorCode::AssetMissing, subject_id))
}

fn validate_request(request: &CostReservationRequest) -> Result<(), CostReservationError> {
    validate_stable_id(&request.reservation_id, &request.reservation_id)?;
    validate_stable_id(&request.command_id, &request.reservation_id)?;
    if let Some(parent) = &request.parent_reservation_id {
        validate_stable_id(parent, &request.reservation_id)?;
        if parent == &request.reservation_id {
            return Err(cost_error(
                CostReservationErrorCode::InvalidDefinition,
                &request.reservation_id,
            ));
        }
    }
    if request.costs.is_empty() {
        return Err(cost_error(
            CostReservationErrorCode::InvalidDefinition,
            &request.reservation_id,
        ));
    }
    for (index, cost) in request.costs.iter().enumerate() {
        validate_request_line(cost, &request.reservation_id)?;
        if request.costs[..index]
            .iter()
            .any(|previous| previous.cost_id == cost.cost_id || previous.asset == cost.asset)
        {
            return Err(cost_error(
                CostReservationErrorCode::InvalidDefinition,
                &request.reservation_id,
            ));
        }
    }
    Ok(())
}

fn validate_request_line(
    line: &CombatCostRequestLine,
    subject_id: &str,
) -> Result<(), CostReservationError> {
    validate_stable_id(&line.cost_id, subject_id)?;
    validate_asset(&line.asset, subject_id)?;
    if line.amount <= 0 {
        Err(cost_error(
            CostReservationErrorCode::InvalidDefinition,
            subject_id,
        ))
    } else {
        Ok(())
    }
}

fn validate_asset(asset: &CombatCostAsset, subject_id: &str) -> Result<(), CostReservationError> {
    match asset {
        CombatCostAsset::ActionPoints { combatant_id }
        | CombatCostAsset::ReactionCharge { combatant_id } => {
            validate_stable_id(combatant_id, subject_id)
        }
        CombatCostAsset::Resource {
            combatant_id,
            resource_id,
        } => {
            validate_stable_id(combatant_id, subject_id)?;
            validate_stable_id(resource_id, subject_id)
        }
        CombatCostAsset::Item { owner_id, item_id } => {
            validate_stable_id(owner_id, subject_id)?;
            validate_stable_id(item_id, subject_id)
        }
    }
}

fn validate_record(record: &CostReservationRecord) -> Result<(), CostReservationError> {
    validate_request(&CostReservationRequest {
        reservation_id: record.reservation_id.clone(),
        command_id: record.command_id.clone(),
        parent_reservation_id: record.parent_reservation_id.clone(),
        costs: record
            .costs
            .iter()
            .map(|cost| CombatCostRequestLine {
                cost_id: cost.cost_id.clone(),
                asset: cost.asset.clone(),
                amount: cost.amount,
                consume_cost_on_interrupt: cost.consume_cost_on_interrupt,
            })
            .collect(),
    })?;
    let valid = match record.status {
        CostReservationStatus::Reserved => record
            .costs
            .iter()
            .all(|cost| cost.state == CostCommitState::Reserved),
        CostReservationStatus::Committed => record
            .costs
            .iter()
            .all(|cost| cost.state == CostCommitState::Committed),
        CostReservationStatus::Released => record
            .costs
            .iter()
            .all(|cost| cost.state == CostCommitState::Released),
        CostReservationStatus::Interrupted => {
            record
                .costs
                .iter()
                .all(|cost| cost.state != CostCommitState::Reserved)
                && record
                    .costs
                    .iter()
                    .any(|cost| cost.state == CostCommitState::Committed)
        }
    };
    if valid {
        Ok(())
    } else {
        Err(cost_error(
            CostReservationErrorCode::InvalidLedger,
            &record.reservation_id,
        ))
    }
}

fn validate_inventory(state: &CombatState) -> Result<(), CostReservationError> {
    for (index, item) in state.combat_inventory.iter().enumerate() {
        validate_stable_id(&item.owner_id, &item.item_id)?;
        validate_stable_id(&item.item_id, &item.item_id)?;
        if item.current_quantity < 0
            || state.combat_inventory[..index].iter().any(|previous| {
                previous.owner_id == item.owner_id && previous.item_id == item.item_id
            })
        {
            return Err(cost_error(
                CostReservationErrorCode::InvalidLedger,
                &item.item_id,
            ));
        }
    }
    Ok(())
}

fn next_sequence(state: &CombatState) -> Result<u64, CostReservationError> {
    let last = state
        .cost_reservations
        .last()
        .map_or(0, |record| record.sequence);
    if last >= MAX_SAFE_SEQUENCE {
        Err(cost_error(
            CostReservationErrorCode::SequenceExhausted,
            "cost-reservations",
        ))
    } else {
        Ok(last + 1)
    }
}

fn bump_state_revision(
    state: &mut CombatState,
    subject_id: &str,
) -> Result<(), CostReservationError> {
    state.revision = state
        .revision
        .checked_add(1)
        .ok_or_else(|| cost_error(CostReservationErrorCode::SequenceExhausted, subject_id))?;
    Ok(())
}

fn validate_stable_id(value: &str, subject_id: &str) -> Result<(), CostReservationError> {
    if value.is_empty()
        || value.len() > 128
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b':' | b'-'))
    {
        Err(cost_error(
            CostReservationErrorCode::InvalidDefinition,
            subject_id,
        ))
    } else {
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CostReservationErrorCode {
    InvalidDefinition,
    IdentityConflict,
    ParentMissing,
    ReservationMissing,
    AssetMissing,
    InsufficientAvailable,
    InvalidTransition,
    InvalidLedger,
    NumericOverflow,
    SequenceExhausted,
    StateInvariantViolation,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CostReservationError {
    pub code: CostReservationErrorCode,
    pub subject_id: String,
}

impl fmt::Display for CostReservationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("combat cost reservation failed")
    }
}
impl Error for CostReservationError {}

fn cost_error(code: CostReservationErrorCode, subject_id: &str) -> CostReservationError {
    CostReservationError {
        code,
        subject_id: subject_id.to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        AbilityUsageState, CURRENT_COMBAT_VERSIONS, CombatPhase, CombatRng, CombatSide,
        CombatantState, ObjectiveRuntimeState, ProvisionalRuntimeDelta, ReinforcementRuntimeState,
        ResourceState, RoundRuntimeState,
    };

    const SEED: &str = "0123456789abcdef0123456789abcdef";

    #[test]
    fn reserves_every_cost_kind_without_deducting_and_blocks_double_allocation() {
        let mut state = fixture_state();
        let before = balances(&state);
        let receipt = CostReservationModel::reserve(
            &mut state,
            full_request("reservation-1", "command-1", None),
        )
        .unwrap();
        assert_eq!(receipt.status, CostReservationMutationStatus::Created);
        assert_eq!(balances(&state), before);
        assert_eq!(receipt.record.sequence, 1);

        let conflict = CostReservationModel::reserve(
            &mut state,
            request(
                "reservation-2",
                "command-2",
                None,
                vec![line(
                    "reaction",
                    CombatCostAsset::ReactionCharge {
                        combatant_id: "actor-1".to_owned(),
                    },
                    1,
                    false,
                )],
            ),
        )
        .unwrap_err();
        assert_eq!(
            conflict.code,
            CostReservationErrorCode::InsufficientAvailable
        );
        assert_eq!(state.cost_reservations.len(), 1);
    }

    #[test]
    fn commit_is_atomic_persists_item_delta_and_is_idempotent_after_restore() {
        let mut state = fixture_state();
        let request = full_request("reservation-1", "command-1", None);
        CostReservationModel::reserve(&mut state, request.clone()).unwrap();
        let before_rng = state.rng.clone();
        let receipt = CostReservationModel::commit(&mut state, "reservation-1").unwrap();
        assert_eq!(receipt.status, CostReservationMutationStatus::Committed);
        assert_eq!(balances(&state), (2, 4, 0, 1));
        assert_eq!(state.provisional_delta.entries.len(), 1);
        assert_eq!(state.rng, before_rng);

        let mut restored = state.snapshot().unwrap().verify_and_restore().unwrap();
        assert_eq!(
            CostReservationModel::commit(&mut restored, "reservation-1")
                .unwrap()
                .status,
            CostReservationMutationStatus::AlreadyApplied
        );
        assert_eq!(
            CostReservationModel::reserve(&mut restored, request)
                .unwrap()
                .status,
            CostReservationMutationStatus::AlreadyApplied
        );
        assert_eq!(balances(&restored), (2, 4, 0, 1));
        assert_eq!(restored.provisional_delta.entries.len(), 1);
    }

    #[test]
    fn nested_reaction_reservations_share_available_balances_and_release_cleanly() {
        let mut state = fixture_state();
        CostReservationModel::reserve(
            &mut state,
            request(
                "parent",
                "command-parent",
                None,
                vec![line("ap", ap(), 1, false)],
            ),
        )
        .unwrap();
        CostReservationModel::reserve(
            &mut state,
            request(
                "reaction-a",
                "command-reaction-a",
                Some("parent"),
                vec![line("charge", reaction_charge(), 1, false)],
            ),
        )
        .unwrap();
        assert_eq!(
            CostReservationModel::commit(&mut state, "parent")
                .unwrap_err()
                .code,
            CostReservationErrorCode::InvalidTransition
        );
        assert_eq!(
            CostReservationModel::reserve(
                &mut state,
                request(
                    "reaction-b",
                    "command-reaction-b",
                    Some("parent"),
                    vec![line("charge", reaction_charge(), 1, false)],
                ),
            )
            .unwrap_err()
            .code,
            CostReservationErrorCode::InsufficientAvailable
        );
        assert_eq!(
            CostReservationModel::cancel_before_resolution(&mut state, "reaction-a")
                .unwrap()
                .status,
            CostReservationMutationStatus::Released
        );
        CostReservationModel::reserve(
            &mut state,
            request(
                "reaction-b",
                "command-reaction-b",
                Some("parent"),
                vec![line("charge", reaction_charge(), 1, false)],
            ),
        )
        .unwrap();
        assert_eq!(state.cost_reservations[2].sequence, 3);
    }

    #[test]
    fn pre_resolution_cancel_only_consumes_explicit_interrupt_costs() {
        let mut state = fixture_state();
        let initial_usage = state.combatants[0].ability_usage[0].clone();
        CostReservationModel::reserve(
            &mut state,
            request(
                "reservation-interrupt",
                "command-interrupt",
                None,
                vec![line("ap", ap(), 1, false), line("mana", mana(), 1, true)],
            ),
        )
        .unwrap();
        let receipt =
            CostReservationModel::cancel_before_resolution(&mut state, "reservation-interrupt")
                .unwrap();
        assert_eq!(receipt.status, CostReservationMutationStatus::Interrupted);
        assert_eq!(state.combatants[0].action_points, 3);
        assert_eq!(state.combatants[0].resources[0].current, 4);
        assert_eq!(state.combatants[0].ability_usage[0], initial_usage);
        assert_eq!(receipt.record.costs[0].state, CostCommitState::Released);
        assert_eq!(receipt.record.costs[1].state, CostCommitState::Committed);
        assert_eq!(
            CostReservationModel::cancel_before_resolution(&mut state, "reservation-interrupt",)
                .unwrap()
                .status,
            CostReservationMutationStatus::AlreadyApplied
        );
        assert_eq!(state.combatants[0].resources[0].current, 4);
    }

    #[test]
    fn active_reservation_survives_save_and_tampered_ledger_fails_restore() {
        let mut state = fixture_state();
        let request = request(
            "reservation-save",
            "command-save",
            None,
            vec![line("ap", ap(), 2, false)],
        );
        CostReservationModel::reserve(&mut state, request.clone()).unwrap();
        let mut restored = state.snapshot().unwrap().verify_and_restore().unwrap();
        assert_eq!(
            CostReservationModel::reserve(&mut restored, request)
                .unwrap()
                .status,
            CostReservationMutationStatus::AlreadyApplied
        );
        assert_eq!(restored.combatants[0].action_points, 3);

        let mut tampered = restored;
        tampered.cost_reservations[0].sequence = 2;
        assert!(matches!(
            tampered.snapshot().unwrap().verify_and_restore(),
            Err(crate::CombatStateRestoreError::Invariant(
                crate::CombatStateInvariantError {
                    code: crate::CombatStateInvariantCode::CostReservationLedgerInvalid,
                    ..
                }
            ))
        ));
    }

    #[test]
    fn failed_commit_and_malformed_requests_leave_state_unchanged() {
        let mut state = fixture_state();
        CostReservationModel::reserve(
            &mut state,
            request(
                "reservation-1",
                "command-1",
                None,
                vec![line("ap", ap(), 2, false)],
            ),
        )
        .unwrap();
        state.combatants[0].action_points = 1;
        let before = state.clone();
        assert_eq!(
            CostReservationModel::commit(&mut state, "reservation-1")
                .unwrap_err()
                .code,
            CostReservationErrorCode::InvalidLedger
        );
        assert_eq!(state, before);

        let malformed = request(
            "reservation-bad",
            "command-bad",
            None,
            vec![line("bad cost id", ap(), 0, false)],
        );
        assert_eq!(
            CostReservationModel::reserve(&mut fixture_state(), malformed)
                .unwrap_err()
                .code,
            CostReservationErrorCode::InvalidDefinition
        );
    }

    fn full_request(id: &str, command_id: &str, parent: Option<&str>) -> CostReservationRequest {
        request(
            id,
            command_id,
            parent,
            vec![
                line("ap", ap(), 1, false),
                line("mana", mana(), 1, false),
                line("reaction", reaction_charge(), 1, false),
                line(
                    "item",
                    CombatCostAsset::Item {
                        owner_id: "actor-1".to_owned(),
                        item_id: "item-arrow".to_owned(),
                    },
                    1,
                    false,
                ),
            ],
        )
    }

    fn request(
        id: &str,
        command_id: &str,
        parent: Option<&str>,
        costs: Vec<CombatCostRequestLine>,
    ) -> CostReservationRequest {
        CostReservationRequest {
            reservation_id: id.to_owned(),
            command_id: command_id.to_owned(),
            parent_reservation_id: parent.map(str::to_owned),
            costs,
        }
    }

    fn line(
        id: &str,
        asset: CombatCostAsset,
        amount: i64,
        consume_on_interrupt: bool,
    ) -> CombatCostRequestLine {
        CombatCostRequestLine {
            cost_id: id.to_owned(),
            asset,
            amount,
            consume_cost_on_interrupt: consume_on_interrupt,
        }
    }

    fn ap() -> CombatCostAsset {
        CombatCostAsset::ActionPoints {
            combatant_id: "actor-1".to_owned(),
        }
    }

    fn mana() -> CombatCostAsset {
        CombatCostAsset::Resource {
            combatant_id: "actor-1".to_owned(),
            resource_id: "mana".to_owned(),
        }
    }

    fn reaction_charge() -> CombatCostAsset {
        CombatCostAsset::ReactionCharge {
            combatant_id: "actor-1".to_owned(),
        }
    }

    fn balances(state: &CombatState) -> (i64, i64, i64, i64) {
        (
            state.combatants[0].action_points,
            state.combatants[0].resources[0].current,
            state.combatants[0].reaction_charges,
            state.combat_inventory[0].current_quantity,
        )
    }

    fn fixture_state() -> CombatState {
        CombatState {
            combat_instance_id: "combat-cost-fixture".to_owned(),
            versions: CURRENT_COMBAT_VERSIONS,
            random_seed: SEED.to_owned(),
            revision: 1,
            last_committed_sequence: 0,
            phase: CombatPhase::Action,
            combatants: vec![CombatantRuntime {
                combatant_id: "actor-1".to_owned(),
                definition_id: "player".to_owned(),
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
                resources: vec![ResourceState {
                    resource_id: "mana".to_owned(),
                    current: 5,
                    min_value: 0,
                    max_value: 5,
                    overheat_threshold: None,
                    hard_max_value: None,
                }],
                statuses: vec![],
                ability_usage: vec![AbilityUsageState {
                    ability_id: "ability-strike".to_owned(),
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
            }],
            combat_inventory: vec![CombatInventoryItemState {
                owner_id: "actor-1".to_owned(),
                item_id: "item-arrow".to_owned(),
                current_quantity: 2,
            }],
            cost_reservations: vec![],
            resolution_context: None,
            timeline: vec![],
            round: RoundRuntimeState {
                round_number: 1,
                completed_round_count: 0,
                active_combatant_id: Some("actor-1".to_owned()),
                extra_turn_resume_phase: None,
                roster: vec![crate::RoundRosterEntry {
                    combatant_id: "actor-1".to_owned(),
                    normal_turn_slot: 0,
                    status: crate::RoundRosterStatus::Pending,
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
            confirmed_result: None,
            rng: CombatRng::new(
                SEED,
                "combat-cost-fixture",
                CURRENT_COMBAT_VERSIONS.rng_contract_version,
            )
            .unwrap()
            .snapshot(),
        }
    }
}

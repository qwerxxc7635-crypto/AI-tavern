use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params};
use serde::Deserialize;

use crate::{
    CampaignStore, CampaignStoreError, QuestBoardSnapshot, current_timestamp,
    quest_board::load_snapshot, validate_id,
};

const STATUSES: &[&str] = &[
    "HIDDEN",
    "DISCOVERED",
    "AVAILABLE",
    "ACCEPTED",
    "ACTIVE",
    "BLOCKED",
    "UPDATED",
    "COMPLETED",
    "FAILED",
    "EXPIRED",
    "ABANDONED",
];
const SOURCES: &[&str] = &[
    "PLAYER_INTERVENTION",
    "PLAYER",
    "LOCAL_RULE",
    "SYSTEM",
    "ADVENTURE",
    "FACTION",
    "LEGACY",
];

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QuestPoolTransitionCommand {
    pub campaign_id: String,
    pub quest_id: String,
    pub expected_revision: i64,
    pub to_status: String,
    pub source: String,
    pub reason: String,
    pub operation_id: String,
}

impl CampaignStore {
    pub fn transition_quest_pool(
        &self,
        command: QuestPoolTransitionCommand,
    ) -> Result<QuestBoardSnapshot, CampaignStoreError> {
        validate_command(&command)?;
        let mut connection = self.connect()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        if let Some((quest_id, campaign_id, before_revision, to_status, source, reason)) =
            transaction
                .query_row(
                    "SELECT quest_id,campaign_id,before_revision,to_status,source,reason
                     FROM quest_pool_transitions WHERE operation_id=?1",
                    [&command.operation_id],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, i64>(2)?,
                            row.get::<_, String>(3)?,
                            row.get::<_, String>(4)?,
                            row.get::<_, String>(5)?,
                        ))
                    },
                )
                .optional()?
        {
            if quest_id != command.quest_id
                || campaign_id != command.campaign_id
                || before_revision != command.expected_revision
                || to_status != command.to_status
                || source != command.source
                || reason != command.reason
            {
                return Err(CampaignStoreError::InvalidData);
            }
            let snapshot = load_snapshot(&transaction, &command.campaign_id)?;
            transaction.commit()?;
            return Ok(snapshot);
        }
        let at = current_timestamp()?;
        transition_quest_pool_in_transaction(
            &transaction,
            &command.campaign_id,
            &command.quest_id,
            Some(command.expected_revision),
            None,
            &command.to_status,
            &command.source,
            &command.reason,
            &command.operation_id,
            &at,
        )?;
        transaction.execute(
            "UPDATE campaigns SET updated_at=?1 WHERE id=?2",
            params![at, command.campaign_id],
        )?;
        let snapshot = load_snapshot(&transaction, &command.campaign_id)?;
        transaction.commit()?;
        Ok(snapshot)
    }
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn transition_quest_pool_in_transaction(
    connection: &Connection,
    campaign_id: &str,
    quest_id: &str,
    expected_revision: Option<i64>,
    expected_status: Option<&str>,
    to_status: &str,
    source: &str,
    reason: &str,
    operation_id: &str,
    occurred_at: &str,
) -> Result<String, CampaignStoreError> {
    let (before, revision) = connection
        .query_row(
            "SELECT status,revision FROM quest_pool_states
             WHERE quest_id=?1 AND campaign_id=?2",
            params![quest_id, campaign_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
        )
        .optional()?
        .ok_or(CampaignStoreError::NotFound)?;
    if expected_revision.is_some_and(|value| value != revision)
        || expected_status.is_some_and(|value| value != before)
        || !transition_allowed(&before, to_status)
        || !source_allowed(&before, to_status, source)
    {
        return Err(CampaignStoreError::InvalidState);
    }
    let changed = connection.execute(
        "UPDATE quest_pool_states SET
           status=?1,revision=revision+1,last_source=?2,last_reason=?3,
           last_operation_id=?4,updated_at=?5
         WHERE quest_id=?6 AND campaign_id=?7 AND revision=?8 AND status=?9",
        params![
            to_status,
            source,
            reason,
            operation_id,
            occurred_at,
            quest_id,
            campaign_id,
            revision,
            before,
        ],
    )?;
    if changed != 1 {
        return Err(CampaignStoreError::ConcurrentModification);
    }
    Ok(before)
}

fn validate_command(command: &QuestPoolTransitionCommand) -> Result<(), CampaignStoreError> {
    validate_id(&command.campaign_id)?;
    validate_id(&command.quest_id)?;
    validate_id(&command.operation_id)?;
    if command.expected_revision < 1
        || !STATUSES.contains(&command.to_status.as_str())
        || !SOURCES.contains(&command.source.as_str())
        || command.reason.trim() != command.reason
        || command.reason.is_empty()
        || command.reason.chars().count() > 4_000
    {
        return Err(CampaignStoreError::InvalidData);
    }
    Ok(())
}

pub(crate) fn transition_allowed(before: &str, after: &str) -> bool {
    match before {
        "HIDDEN" => ["DISCOVERED", "AVAILABLE", "ACTIVE", "FAILED", "EXPIRED"].contains(&after),
        "DISCOVERED" => [
            "AVAILABLE",
            "ACTIVE",
            "BLOCKED",
            "UPDATED",
            "FAILED",
            "EXPIRED",
            "ABANDONED",
        ]
        .contains(&after),
        "AVAILABLE" => [
            "ACCEPTED",
            "ACTIVE",
            "BLOCKED",
            "UPDATED",
            "FAILED",
            "EXPIRED",
            "ABANDONED",
        ]
        .contains(&after),
        "ACCEPTED" => [
            "ACTIVE",
            "BLOCKED",
            "UPDATED",
            "FAILED",
            "EXPIRED",
            "ABANDONED",
        ]
        .contains(&after),
        "ACTIVE" => [
            "BLOCKED",
            "UPDATED",
            "COMPLETED",
            "FAILED",
            "EXPIRED",
            "ABANDONED",
        ]
        .contains(&after),
        "BLOCKED" => [
            "AVAILABLE",
            "ACTIVE",
            "UPDATED",
            "FAILED",
            "EXPIRED",
            "ABANDONED",
        ]
        .contains(&after),
        "UPDATED" => [
            "DISCOVERED",
            "AVAILABLE",
            "ACCEPTED",
            "ACTIVE",
            "BLOCKED",
            "COMPLETED",
            "FAILED",
            "EXPIRED",
            "ABANDONED",
        ]
        .contains(&after),
        _ => false,
    }
}

fn source_allowed(before: &str, after: &str, source: &str) -> bool {
    match source {
        "PLAYER_INTERVENTION" => {
            ["DISCOVERED", "AVAILABLE", "ACCEPTED", "UPDATED"].contains(&before)
                && after == "ACTIVE"
        }
        "PLAYER" => before != "HIDDEN" && after == "ABANDONED",
        _ => true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_transition_graph_covers_every_declared_nonterminal_pair() {
        for status in STATUSES {
            let terminal = ["COMPLETED", "FAILED", "EXPIRED", "ABANDONED"].contains(status);
            assert_eq!(
                STATUSES
                    .iter()
                    .any(|candidate| transition_allowed(status, candidate)),
                !terminal
            );
        }
        assert!(source_allowed("AVAILABLE", "ACTIVE", "PLAYER_INTERVENTION"));
        assert!(!source_allowed("HIDDEN", "ACTIVE", "PLAYER_INTERVENTION"));
    }
}

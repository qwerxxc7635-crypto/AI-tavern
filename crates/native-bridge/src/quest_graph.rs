use std::collections::{BTreeMap, BTreeSet};

use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params};
use serde::{Deserialize, Serialize};

use crate::{
    CampaignStore, CampaignStoreError, quest_pool::transition_allowed, validate_id,
    validate_timestamp,
};

const TERMINAL_STATUSES: &[&str] = &["COMPLETED", "FAILED", "EXPIRED", "ABANDONED"];
const TRIGGER_KINDS: &[&str] = &[
    "GRAPH_CHANGED",
    "QUEST_TRANSITION",
    "WORLD_FACT_CHANGE",
    "NPC_CHANGE",
    "FACTION_CHANGE",
    "LOCATION_CHANGE",
    "MANUAL_REEVALUATION",
];

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QuestGraphEdge {
    pub id: String,
    pub campaign_id: String,
    pub kind: String,
    pub source_kind: String,
    pub source_id: String,
    pub predicate: String,
    pub expected_value: String,
    pub target_quest_id: String,
    pub satisfied_status: String,
    pub unsatisfied_status: Option<String>,
    pub priority: i64,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QuestGraphStatusChange {
    pub quest_id: String,
    pub from_status: String,
    pub to_status: String,
    pub edge_ids: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuestGraphEvaluation {
    pub operation_id: String,
    pub campaign_id: String,
    pub graph_revision: i64,
    pub trigger_kind: String,
    pub trigger_id: String,
    pub evaluated_edge_ids: Vec<String>,
    pub changes: Vec<QuestGraphStatusChange>,
    pub occurred_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuestGraphSnapshot {
    pub campaign_id: String,
    pub revision: i64,
    pub edges: Vec<QuestGraphEdge>,
    pub evaluations: Vec<QuestGraphEvaluation>,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QuestGraphReplaceCommand {
    pub operation_id: String,
    pub campaign_id: String,
    pub expected_revision: i64,
    pub edges: Vec<QuestGraphEdge>,
    pub occurred_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QuestGraphEvaluateCommand {
    pub operation_id: String,
    pub campaign_id: String,
    pub trigger_kind: String,
    pub trigger_id: String,
    pub occurred_at: String,
}

impl CampaignStore {
    pub fn quest_graph_snapshot(
        &self,
        campaign_id: &str,
    ) -> Result<QuestGraphSnapshot, CampaignStoreError> {
        validate_id(campaign_id)?;
        load_quest_graph_snapshot(&self.connect()?, campaign_id)
    }

    pub fn replace_quest_graph(
        &self,
        command: QuestGraphReplaceCommand,
    ) -> Result<QuestGraphSnapshot, CampaignStoreError> {
        validate_replace(&command)?;
        let mut connection = self.connect()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        if let Some((campaign_id, revision, edges_json, occurred_at)) = transaction
            .query_row(
                "SELECT campaign_id,revision,edges_json,occurred_at
                 FROM quest_graph_revisions WHERE operation_id=?1",
                [&command.operation_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                    ))
                },
            )
            .optional()?
        {
            let expected_json = serde_json::to_string(&sorted_edges(&command.edges))
                .map_err(|_| CampaignStoreError::InvalidData)?;
            if campaign_id != command.campaign_id
                || revision != command.expected_revision + 1
                || edges_json != expected_json
                || occurred_at != command.occurred_at
            {
                return Err(CampaignStoreError::InvalidData);
            }
            let snapshot = load_quest_graph_snapshot(&transaction, &command.campaign_id)?;
            transaction.commit()?;
            return Ok(snapshot);
        }
        let current_revision: i64 = transaction
            .query_row(
                "SELECT revision FROM quest_graphs WHERE campaign_id=?1",
                [&command.campaign_id],
                |row| row.get(0),
            )
            .optional()?
            .ok_or(CampaignStoreError::NotFound)?;
        if current_revision != command.expected_revision {
            return Err(CampaignStoreError::ConcurrentModification);
        }
        let edges = sorted_edges(&command.edges);
        validate_graph(&transaction, &command.campaign_id, &edges)?;
        transaction.execute(
            "DELETE FROM quest_graph_edges WHERE campaign_id=?1",
            [&command.campaign_id],
        )?;
        for edge in &edges {
            transaction.execute(
                "INSERT INTO quest_graph_edges (
                   id,campaign_id,edge_kind,source_kind,source_id,predicate,expected_value,
                   target_quest_id,satisfied_status,unsatisfied_status,priority,created_at
                 ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",
                params![
                    edge.id,
                    edge.campaign_id,
                    edge.kind,
                    edge.source_kind,
                    edge.source_id,
                    edge.predicate,
                    edge.expected_value,
                    edge.target_quest_id,
                    edge.satisfied_status,
                    edge.unsatisfied_status,
                    edge.priority,
                    edge.created_at
                ],
            )?;
        }
        let next_revision = current_revision + 1;
        transaction.execute(
            "UPDATE quest_graphs SET revision=?1,updated_at=?2
             WHERE campaign_id=?3 AND revision=?4",
            params![
                next_revision,
                command.occurred_at,
                command.campaign_id,
                current_revision
            ],
        )?;
        transaction.execute(
            "INSERT INTO quest_graph_revisions
             (operation_id,campaign_id,revision,edges_json,occurred_at) VALUES (?1,?2,?3,?4,?5)",
            params![
                command.operation_id,
                command.campaign_id,
                next_revision,
                serde_json::to_string(&edges).map_err(|_| CampaignStoreError::InvalidData)?,
                command.occurred_at
            ],
        )?;
        evaluate_in_transaction(
            &transaction,
            &command.campaign_id,
            &format!("{}:evaluation", command.operation_id),
            "GRAPH_CHANGED",
            &command.operation_id,
            &command.occurred_at,
        )?;
        let snapshot = load_quest_graph_snapshot(&transaction, &command.campaign_id)?;
        transaction.commit()?;
        Ok(snapshot)
    }

    pub fn evaluate_quest_graph(
        &self,
        command: QuestGraphEvaluateCommand,
    ) -> Result<QuestGraphSnapshot, CampaignStoreError> {
        validate_evaluate(&command)?;
        let mut connection = self.connect()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        evaluate_in_transaction(
            &transaction,
            &command.campaign_id,
            &command.operation_id,
            &command.trigger_kind,
            &command.trigger_id,
            &command.occurred_at,
        )?;
        let snapshot = load_quest_graph_snapshot(&transaction, &command.campaign_id)?;
        transaction.commit()?;
        Ok(snapshot)
    }
}

pub(crate) fn evaluate_after_quest_transition(
    connection: &Connection,
    campaign_id: &str,
    operation_id: &str,
    quest_id: &str,
    occurred_at: &str,
) -> Result<(), CampaignStoreError> {
    evaluate_in_transaction(
        connection,
        campaign_id,
        &format!("{operation_id}:graph"),
        "QUEST_TRANSITION",
        quest_id,
        occurred_at,
    )
}

pub(crate) fn evaluate_after_source_change(
    connection: &Connection,
    campaign_id: &str,
    operation_id: &str,
    trigger_kind: &str,
    trigger_id: &str,
    occurred_at: &str,
) -> Result<(), CampaignStoreError> {
    evaluate_in_transaction(
        connection,
        campaign_id,
        operation_id,
        trigger_kind,
        trigger_id,
        occurred_at,
    )
}

pub(crate) fn load_quest_graph_snapshot(
    connection: &Connection,
    campaign_id: &str,
) -> Result<QuestGraphSnapshot, CampaignStoreError> {
    let (revision, updated_at) = connection
        .query_row(
            "SELECT revision,updated_at FROM quest_graphs WHERE campaign_id=?1",
            [campaign_id],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()?
        .ok_or(CampaignStoreError::NotFound)?;
    let mut edge_statement = connection.prepare(
        "SELECT id,campaign_id,edge_kind,source_kind,source_id,predicate,expected_value,
                target_quest_id,satisfied_status,unsatisfied_status,priority,created_at
         FROM quest_graph_edges WHERE campaign_id=?1 ORDER BY priority DESC,id",
    )?;
    let edges = edge_statement
        .query_map([campaign_id], map_edge)?
        .collect::<Result<Vec<_>, _>>()?;
    let mut evaluation_statement = connection.prepare(
        "SELECT operation_id,campaign_id,graph_revision,trigger_kind,trigger_id,
                evaluated_edge_ids_json,changes_json,occurred_at
         FROM quest_graph_evaluations WHERE campaign_id=?1
         ORDER BY occurred_at DESC,operation_id DESC LIMIT 20",
    )?;
    let evaluations = evaluation_statement
        .query_map([campaign_id], |row| {
            let edge_ids: String = row.get(5)?;
            let changes: String = row.get(6)?;
            Ok(QuestGraphEvaluation {
                operation_id: row.get(0)?,
                campaign_id: row.get(1)?,
                graph_revision: row.get(2)?,
                trigger_kind: row.get(3)?,
                trigger_id: row.get(4)?,
                evaluated_edge_ids: serde_json::from_str(&edge_ids).map_err(json_error)?,
                changes: serde_json::from_str(&changes).map_err(json_error)?,
                occurred_at: row.get(7)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(QuestGraphSnapshot {
        campaign_id: campaign_id.to_owned(),
        revision,
        edges,
        evaluations,
        updated_at,
    })
}

fn map_edge(row: &rusqlite::Row<'_>) -> rusqlite::Result<QuestGraphEdge> {
    Ok(QuestGraphEdge {
        id: row.get(0)?,
        campaign_id: row.get(1)?,
        kind: row.get(2)?,
        source_kind: row.get(3)?,
        source_id: row.get(4)?,
        predicate: row.get(5)?,
        expected_value: row.get(6)?,
        target_quest_id: row.get(7)?,
        satisfied_status: row.get(8)?,
        unsatisfied_status: row.get(9)?,
        priority: row.get(10)?,
        created_at: row.get(11)?,
    })
}

fn json_error(error: serde_json::Error) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(error))
}

fn validate_replace(command: &QuestGraphReplaceCommand) -> Result<(), CampaignStoreError> {
    validate_id(&command.operation_id)?;
    validate_id(&command.campaign_id)?;
    validate_timestamp(&command.occurred_at)?;
    if command.expected_revision < 1
        || command
            .edges
            .iter()
            .any(|edge| edge.campaign_id != command.campaign_id)
    {
        return Err(CampaignStoreError::InvalidData);
    }
    Ok(())
}

fn validate_evaluate(command: &QuestGraphEvaluateCommand) -> Result<(), CampaignStoreError> {
    validate_id(&command.operation_id)?;
    validate_id(&command.campaign_id)?;
    validate_id(&command.trigger_id)?;
    validate_timestamp(&command.occurred_at)?;
    if !TRIGGER_KINDS.contains(&command.trigger_kind.as_str()) {
        return Err(CampaignStoreError::InvalidData);
    }
    Ok(())
}

fn sorted_edges(edges: &[QuestGraphEdge]) -> Vec<QuestGraphEdge> {
    let mut result = edges.to_vec();
    result.sort_by(|left, right| left.id.cmp(&right.id));
    result
}

fn validate_graph(
    connection: &Connection,
    campaign_id: &str,
    edges: &[QuestGraphEdge],
) -> Result<Vec<String>, CampaignStoreError> {
    let mut edge_ids = BTreeSet::new();
    let mut semantics = BTreeSet::new();
    let quest_ids = load_quest_ids(connection, campaign_id)?;
    for edge in edges {
        validate_id(&edge.id)?;
        validate_id(&edge.source_id)?;
        validate_id(&edge.target_quest_id)?;
        validate_timestamp(&edge.created_at)?;
        if edge.campaign_id != campaign_id
            || !["PREREQUISITE", "CONSEQUENCE"].contains(&edge.kind.as_str())
            || edge.expected_value.is_empty()
            || edge.expected_value.trim() != edge.expected_value
            || edge.expected_value.chars().count() > 120
            || !(0..=1_000).contains(&edge.priority)
            || !quest_ids.contains(&edge.target_quest_id)
            || !edge_ids.insert(edge.id.clone())
            || !semantics.insert(format!(
                "{}\0{}\0{}\0{}\0{}\0{}",
                edge.kind,
                edge.source_kind,
                edge.source_id,
                edge.predicate,
                edge.expected_value,
                edge.target_quest_id
            ))
        {
            return Err(CampaignStoreError::InvalidData);
        }
        if edge.kind == "CONSEQUENCE" && edge.unsatisfied_status.is_some() {
            return Err(CampaignStoreError::InvalidData);
        }
        validate_source(connection, campaign_id, edge)?;
    }
    validate_prerequisite_policies(edges)?;
    topological_order(edges, &quest_ids)
}

fn validate_source(
    connection: &Connection,
    campaign_id: &str,
    edge: &QuestGraphEdge,
) -> Result<(), CampaignStoreError> {
    let valid = match edge.source_kind.as_str() {
        "QUEST" => {
            edge.predicate == "STATUS_EQUALS"
                && status_valid(&edge.expected_value)
                && exists(
                    connection,
                    "SELECT 1 FROM quests WHERE campaign_id=?1 AND id=?2",
                    campaign_id,
                    &edge.source_id,
                )?
        }
        "WORLD_FACT" => {
            edge.predicate == "EXISTS"
                && edge.expected_value == "TRUE"
                && exists(
                    connection,
                    "SELECT 1 FROM world_facts WHERE campaign_id=?1 AND id=?2",
                    campaign_id,
                    &edge.source_id,
                )?
        }
        "NPC" => {
            edge.predicate == "STATUS_EQUALS"
                && exists(
                    connection,
                    "SELECT 1 FROM npcs WHERE campaign_id=?1 AND id=?2",
                    campaign_id,
                    &edge.source_id,
                )?
        }
        "FACTION" => {
            ((edge.predicate == "MATERIALIZATION_EQUALS"
                && ["OUTLINE", "ACTIVE"].contains(&edge.expected_value.as_str()))
                || (edge.predicate == "PLAYER_RELATION_EQUALS"
                    && [
                        "HOSTILE", "WARY", "NEUTRAL", "FRIENDLY", "ALLIED", "UNKNOWN",
                    ]
                    .contains(&edge.expected_value.as_str())))
                && exists(
                    connection,
                    "SELECT 1 FROM active_factions WHERE campaign_id=?1 AND id=?2",
                    campaign_id,
                    &edge.source_id,
                )?
        }
        "LOCATION" => {
            edge.predicate == "MATERIALIZATION_EQUALS"
                && ["OUTLINE", "DETAILED"].contains(&edge.expected_value.as_str())
                && exists(
                    connection,
                    "SELECT 1 FROM dynamic_locations WHERE campaign_id=?1 AND id=?2",
                    campaign_id,
                    &edge.source_id,
                )?
        }
        _ => false,
    };
    if !valid || !status_valid(&edge.satisfied_status) {
        return Err(CampaignStoreError::InvalidData);
    }
    if edge
        .unsatisfied_status
        .as_deref()
        .is_some_and(|status| !status_valid(status))
    {
        return Err(CampaignStoreError::InvalidData);
    }
    Ok(())
}

fn exists(
    connection: &Connection,
    sql: &str,
    campaign_id: &str,
    id: &str,
) -> Result<bool, CampaignStoreError> {
    Ok(connection
        .query_row(sql, params![campaign_id, id], |_| Ok(()))
        .optional()?
        .is_some())
}

fn validate_prerequisite_policies(edges: &[QuestGraphEdge]) -> Result<(), CampaignStoreError> {
    let mut policies: BTreeMap<&str, (&str, Option<&str>)> = BTreeMap::new();
    for edge in edges.iter().filter(|edge| edge.kind == "PREREQUISITE") {
        let policy = (
            edge.satisfied_status.as_str(),
            edge.unsatisfied_status.as_deref(),
        );
        if policies
            .insert(&edge.target_quest_id, policy)
            .is_some_and(|current| current != policy)
        {
            return Err(CampaignStoreError::InvalidData);
        }
    }
    Ok(())
}

fn load_quest_ids(
    connection: &Connection,
    campaign_id: &str,
) -> Result<BTreeSet<String>, CampaignStoreError> {
    let mut statement =
        connection.prepare("SELECT id FROM quests WHERE campaign_id=?1 ORDER BY id")?;
    Ok(statement
        .query_map([campaign_id], |row| row.get(0))?
        .collect::<Result<_, _>>()?)
}

fn topological_order(
    edges: &[QuestGraphEdge],
    quest_ids: &BTreeSet<String>,
) -> Result<Vec<String>, CampaignStoreError> {
    let mut adjacency = quest_ids
        .iter()
        .map(|id| (id.clone(), BTreeSet::new()))
        .collect::<BTreeMap<_, _>>();
    let mut indegree = quest_ids
        .iter()
        .map(|id| (id.clone(), 0_usize))
        .collect::<BTreeMap<_, _>>();
    for edge in edges.iter().filter(|edge| edge.source_kind == "QUEST") {
        let targets = adjacency
            .get_mut(&edge.source_id)
            .ok_or(CampaignStoreError::InvalidData)?;
        if targets.insert(edge.target_quest_id.clone()) {
            *indegree
                .get_mut(&edge.target_quest_id)
                .ok_or(CampaignStoreError::InvalidData)? += 1;
        }
    }
    let mut ready = indegree
        .iter()
        .filter(|(_, count)| **count == 0)
        .map(|(id, _)| id.clone())
        .collect::<BTreeSet<_>>();
    let mut result = Vec::new();
    while let Some(source) = ready.pop_first() {
        result.push(source.clone());
        for target in adjacency.get(&source).into_iter().flatten() {
            let count = indegree
                .get_mut(target)
                .ok_or(CampaignStoreError::InvalidData)?;
            *count -= 1;
            if *count == 0 {
                ready.insert(target.clone());
            }
        }
    }
    if result.len() != quest_ids.len() {
        return Err(CampaignStoreError::InvalidData);
    }
    Ok(result)
}

#[derive(Debug)]
struct Candidate {
    status: String,
    priority: i64,
    edge_ids: Vec<String>,
}

fn evaluate_in_transaction(
    connection: &Connection,
    campaign_id: &str,
    operation_id: &str,
    trigger_kind: &str,
    trigger_id: &str,
    occurred_at: &str,
) -> Result<(), CampaignStoreError> {
    validate_id(operation_id)?;
    validate_id(campaign_id)?;
    validate_id(trigger_id)?;
    validate_timestamp(occurred_at)?;
    if !TRIGGER_KINDS.contains(&trigger_kind) {
        return Err(CampaignStoreError::InvalidData);
    }
    if let Some((stored_campaign, stored_trigger, stored_id, stored_at)) = connection
        .query_row(
            "SELECT campaign_id,trigger_kind,trigger_id,occurred_at
             FROM quest_graph_evaluations WHERE operation_id=?1",
            [operation_id],
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
    {
        return if stored_campaign == campaign_id
            && stored_trigger == trigger_kind
            && stored_id == trigger_id
            && stored_at == occurred_at
        {
            Ok(())
        } else {
            Err(CampaignStoreError::InvalidData)
        };
    }
    let revision: i64 = connection
        .query_row(
            "SELECT revision FROM quest_graphs WHERE campaign_id=?1",
            [campaign_id],
            |row| row.get(0),
        )
        .optional()?
        .ok_or(CampaignStoreError::NotFound)?;
    let edges = load_quest_graph_snapshot(connection, campaign_id)?.edges;
    let order = validate_graph(connection, campaign_id, &edges)?;
    let mut statuses = load_quest_statuses(connection, campaign_id)?;
    let mut changes = Vec::new();
    for target in order {
        let target_edges = edges
            .iter()
            .filter(|edge| edge.target_quest_id == target)
            .collect::<Vec<_>>();
        if target_edges.is_empty() {
            continue;
        }
        let before = statuses
            .get(&target)
            .cloned()
            .ok_or(CampaignStoreError::InvalidData)?;
        if TERMINAL_STATUSES.contains(&before.as_str()) {
            continue;
        }
        let Some(candidate) = select_candidate(connection, &statuses, &target_edges)? else {
            continue;
        };
        if candidate.status == before {
            continue;
        }
        if !transition_allowed(&before, &candidate.status) {
            return Err(CampaignStoreError::InvalidState);
        }
        let index = changes.len();
        let changed = connection.execute(
            "UPDATE quest_pool_states SET status=?1,revision=revision+1,last_source='LOCAL_RULE',
             last_reason=?2,last_operation_id=?3,updated_at=?4
             WHERE quest_id=?5 AND campaign_id=?6 AND status=?7",
            params![
                candidate.status,
                format!(
                    "Quest graph edges {} deterministically changed the quest.",
                    candidate.edge_ids.join(", ")
                ),
                format!("{operation_id}:change:{index}"),
                occurred_at,
                target,
                campaign_id,
                before
            ],
        )?;
        if changed != 1 {
            return Err(CampaignStoreError::ConcurrentModification);
        }
        statuses.insert(target.clone(), candidate.status.clone());
        changes.push(QuestGraphStatusChange {
            quest_id: target,
            from_status: before,
            to_status: candidate.status,
            edge_ids: candidate.edge_ids,
        });
    }
    let mut evaluated_edge_ids = edges.iter().map(|edge| edge.id.clone()).collect::<Vec<_>>();
    evaluated_edge_ids.sort();
    connection.execute(
        "INSERT INTO quest_graph_evaluations (
           operation_id,campaign_id,graph_revision,trigger_kind,trigger_id,
           evaluated_edge_ids_json,changes_json,occurred_at
         ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
        params![
            operation_id,
            campaign_id,
            revision,
            trigger_kind,
            trigger_id,
            serde_json::to_string(&evaluated_edge_ids)
                .map_err(|_| CampaignStoreError::InvalidData)?,
            serde_json::to_string(&changes).map_err(|_| CampaignStoreError::InvalidData)?,
            occurred_at
        ],
    )?;
    Ok(())
}

fn load_quest_statuses(
    connection: &Connection,
    campaign_id: &str,
) -> Result<BTreeMap<String, String>, CampaignStoreError> {
    let mut statement = connection.prepare(
        "SELECT quest_id,status FROM quest_pool_states WHERE campaign_id=?1 ORDER BY quest_id",
    )?;
    Ok(statement
        .query_map([campaign_id], |row| Ok((row.get(0)?, row.get(1)?)))?
        .collect::<Result<_, _>>()?)
}

fn select_candidate(
    connection: &Connection,
    statuses: &BTreeMap<String, String>,
    edges: &[&QuestGraphEdge],
) -> Result<Option<Candidate>, CampaignStoreError> {
    let mut candidates = Vec::new();
    let prerequisites = edges
        .iter()
        .filter(|edge| edge.kind == "PREREQUISITE")
        .copied()
        .collect::<Vec<_>>();
    if let Some(first) = prerequisites.first() {
        let mut all_satisfied = true;
        for edge in &prerequisites {
            all_satisfied &= predicate_matches(connection, statuses, edge)?;
        }
        let status = if all_satisfied {
            Some(first.satisfied_status.clone())
        } else {
            first.unsatisfied_status.clone()
        };
        if let Some(status) = status {
            candidates.push(Candidate {
                status,
                priority: prerequisites
                    .iter()
                    .map(|edge| edge.priority)
                    .max()
                    .ok_or(CampaignStoreError::InvalidData)?,
                edge_ids: prerequisites.iter().map(|edge| edge.id.clone()).collect(),
            });
        }
    }
    for edge in edges.iter().filter(|edge| edge.kind == "CONSEQUENCE") {
        if predicate_matches(connection, statuses, edge)? {
            candidates.push(Candidate {
                status: edge.satisfied_status.clone(),
                priority: edge.priority,
                edge_ids: vec![edge.id.clone()],
            });
        }
    }
    let Some(highest) = candidates.iter().map(|candidate| candidate.priority).max() else {
        return Ok(None);
    };
    let winners = candidates
        .into_iter()
        .filter(|candidate| candidate.priority == highest)
        .collect::<Vec<_>>();
    if winners
        .iter()
        .map(|candidate| &candidate.status)
        .collect::<BTreeSet<_>>()
        .len()
        != 1
    {
        return Err(CampaignStoreError::InvalidData);
    }
    let mut edge_ids = winners
        .iter()
        .flat_map(|candidate| candidate.edge_ids.clone())
        .collect::<Vec<_>>();
    edge_ids.sort();
    Ok(Some(Candidate {
        status: winners
            .first()
            .ok_or(CampaignStoreError::InvalidData)?
            .status
            .clone(),
        priority: highest,
        edge_ids,
    }))
}

fn predicate_matches(
    connection: &Connection,
    statuses: &BTreeMap<String, String>,
    edge: &QuestGraphEdge,
) -> Result<bool, CampaignStoreError> {
    match edge.source_kind.as_str() {
        "QUEST" => Ok(statuses
            .get(&edge.source_id)
            .is_some_and(|status| status == &edge.expected_value)),
        "WORLD_FACT" => exists(
            connection,
            "SELECT 1 FROM world_facts WHERE campaign_id=?1 AND id=?2",
            &edge.campaign_id,
            &edge.source_id,
        ),
        "NPC" => Ok(connection
            .query_row(
                "SELECT current_status FROM npcs WHERE campaign_id=?1 AND id=?2",
                params![edge.campaign_id, edge.source_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?
            .is_some_and(|status| status == edge.expected_value)),
        "FACTION" => {
            let value = if edge.predicate == "MATERIALIZATION_EQUALS" {
                connection
                    .query_row(
                        "SELECT materialization FROM active_factions WHERE campaign_id=?1 AND id=?2",
                        params![edge.campaign_id, edge.source_id],
                        |row| row.get::<_, String>(0),
                    )
                    .optional()?
            } else {
                connection
                    .query_row(
                        "SELECT json_extract(profile_json,'$.playerRelation')
                         FROM active_factions WHERE campaign_id=?1 AND id=?2",
                        params![edge.campaign_id, edge.source_id],
                        |row| row.get::<_, String>(0),
                    )
                    .optional()?
            };
            Ok(value.is_some_and(|value| value == edge.expected_value))
        }
        "LOCATION" => Ok(connection
            .query_row(
                "SELECT materialization FROM dynamic_locations WHERE campaign_id=?1 AND id=?2",
                params![edge.campaign_id, edge.source_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?
            .is_some_and(|value| value == edge.expected_value)),
        _ => Err(CampaignStoreError::InvalidData),
    }
}

fn status_valid(status: &str) -> bool {
    [
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
    ]
    .contains(&status)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::quest_pool::transition_quest_pool_in_transaction;

    fn edge(id: &str, source: &str, target: &str) -> QuestGraphEdge {
        QuestGraphEdge {
            id: id.to_owned(),
            campaign_id: "campaign".to_owned(),
            kind: "PREREQUISITE".to_owned(),
            source_kind: "QUEST".to_owned(),
            source_id: source.to_owned(),
            predicate: "STATUS_EQUALS".to_owned(),
            expected_value: "COMPLETED".to_owned(),
            target_quest_id: target.to_owned(),
            satisfied_status: "AVAILABLE".to_owned(),
            unsatisfied_status: Some("BLOCKED".to_owned()),
            priority: 10,
            created_at: "2026-08-24T00:00:00.000Z".to_owned(),
        }
    }

    #[test]
    fn deterministic_topology_rejects_cycles() {
        let ids = ["a", "b", "c"]
            .into_iter()
            .map(str::to_owned)
            .collect::<BTreeSet<_>>();
        assert_eq!(
            topological_order(&[edge("ab", "a", "b"), edge("bc", "b", "c")], &ids).unwrap(),
            vec!["a", "b", "c"]
        );
        assert!(topological_order(&[edge("ab", "a", "b"), edge("ba", "b", "a")], &ids).is_err());
    }

    #[test]
    fn quest_transition_re_evaluates_chain_atomically_and_survives_reopen() {
        let directory = tempfile::tempdir().expect("temp directory");
        let path = directory.path().join("quest-graph.sqlite");
        let store = CampaignStore::open(&path).expect("open database");
        let connection = store.connect().expect("connect");
        connection
            .execute_batch(
                "INSERT INTO campaigns(id,schema_version,state,created_at,updated_at)
                 VALUES('campaign',1,'TAVERN','2026-08-24T00:00:00.000Z','2026-08-24T00:00:00.000Z');
                 INSERT INTO taverns(id,campaign_id,location_id,name,position,environment,
                   special_rules_json,long_term_problem,changes_json,created_at,updated_at)
                 VALUES('tavern','campaign','location','Ember','Road','Warm','[]','Storm','[]',
                   '2026-08-24T00:00:00.000Z','2026-08-24T00:00:00.000Z');
                 INSERT INTO npcs(id,campaign_id,tavern_id,residency,name,identity,appearance,
                   personality,goal,secret,speech_style,current_mood,current_status,memories_json,
                   created_at,updated_at)
                 VALUES('npc','campaign','tavern','OWNER','Keeper','Keeper','Coat','Steady',
                   'Protect','Hidden','Brief','Calm','ACTIVE','[]',
                   '2026-08-24T00:00:00.000Z','2026-08-24T00:00:00.000Z');
                 INSERT INTO quests(id,campaign_id,publisher_npc_id,content_json,status,risk,
                   recommended_attributes_json,expected_turns_min,expected_turns_max,reward_tier,
                   related_npc_ids_json,related_fact_ids_json,created_at,updated_at)
                 VALUES
                   ('a','campaign','npc','{}','ACTIVE','LOW','[]',8,12,'BASIC','[]','[]',
                    '2026-08-24T00:00:00.000Z','2026-08-24T00:00:00.000Z'),
                   ('b','campaign','npc','{}','AVAILABLE','LOW','[]',8,12,'BASIC','[]','[]',
                    '2026-08-24T00:00:00.000Z','2026-08-24T00:00:00.000Z');
                 UPDATE quest_pool_states SET status='BLOCKED',revision=revision+1,
                   last_source='SYSTEM',last_reason='Seed graph target.',
                   last_operation_id='seed-b',updated_at='2026-08-24T00:00:00.000Z'
                 WHERE quest_id='b';",
            )
            .expect("seed graph");
        drop(connection);

        store
            .replace_quest_graph(QuestGraphReplaceCommand {
                operation_id: "configure".to_owned(),
                campaign_id: "campaign".to_owned(),
                expected_revision: 1,
                edges: vec![QuestGraphEdge {
                    id: "a-b".to_owned(),
                    campaign_id: "campaign".to_owned(),
                    kind: "CONSEQUENCE".to_owned(),
                    source_kind: "QUEST".to_owned(),
                    source_id: "a".to_owned(),
                    predicate: "STATUS_EQUALS".to_owned(),
                    expected_value: "COMPLETED".to_owned(),
                    target_quest_id: "b".to_owned(),
                    satisfied_status: "AVAILABLE".to_owned(),
                    unsatisfied_status: None,
                    priority: 10,
                    created_at: "2026-08-24T00:00:00.000Z".to_owned(),
                }],
                occurred_at: "2026-08-24T00:00:00.000Z".to_owned(),
            })
            .expect("configure graph");
        let mut connection = store.connect().expect("reconnect");
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .expect("begin transition");
        transition_quest_pool_in_transaction(
            &transaction,
            "campaign",
            "a",
            Some(1),
            Some("ACTIVE"),
            "COMPLETED",
            "SYSTEM",
            "Source quest completed.",
            "complete-a",
            "2026-08-24T00:01:00.000Z",
        )
        .expect("complete source quest");
        transaction.commit().expect("commit graph transition");
        drop(connection);
        drop(store);

        let reopened = CampaignStore::open(&path).expect("reopen graph");
        let connection = reopened.connect().expect("read reopened graph");
        let status: String = connection
            .query_row(
                "SELECT status FROM quest_pool_states WHERE quest_id='b'",
                [],
                |row| row.get(0),
            )
            .expect("target status");
        assert_eq!(status, "AVAILABLE");
        let snapshot = reopened
            .quest_graph_snapshot("campaign")
            .expect("graph snapshot");
        assert_eq!(snapshot.revision, 2);
        assert_eq!(snapshot.evaluations[0].trigger_kind, "QUEST_TRANSITION");
        assert_eq!(snapshot.evaluations[0].changes[0].quest_id, "b");
    }
}

use std::cmp::Ordering;

use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

use crate::{CampaignStore, CampaignStoreError, validate_id, validate_timestamp};

const OPEN_STATUSES: &[&str] = &[
    "HIDDEN",
    "DISCOVERED",
    "AVAILABLE",
    "ACCEPTED",
    "ACTIVE",
    "BLOCKED",
    "UPDATED",
];
const MAX_PROPOSALS: usize = 8;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorldDirectorSignals {
    pub open_quest_count: usize,
    pub active_quest_count: usize,
    pub blocked_quest_count: usize,
    pub stale_quest_ids: Vec<String>,
    pub urgent_clock_ids: Vec<String>,
    pub foreshadow_clock_ids: Vec<String>,
    pub hostile_faction_ids: Vec<String>,
    pub recent_failure_count: usize,
    pub recent_event_count: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorldDirectorProposal {
    pub id: String,
    pub rank: usize,
    pub kind: String,
    pub actor_entity_id: Option<String>,
    pub target_entity_ids: Vec<String>,
    pub rationale: String,
    pub proposed_effects: Vec<String>,
    pub urgency: String,
    pub cooldown_key: String,
    pub route: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorldDirectorSuppression {
    pub kind: String,
    pub target_entity_id: Option<String>,
    pub reason: String,
    pub rationale: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorldDirectorPreparation {
    pub campaign_id: String,
    pub campaign_state: String,
    pub context_digest: String,
    pub pace: String,
    pub pressure_score: usize,
    pub signals: WorldDirectorSignals,
    pub proposals: Vec<WorldDirectorProposal>,
    pub suppressed: Vec<WorldDirectorSuppression>,
    pub source_snapshot: Value,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorldDirectorTrigger {
    pub kind: String,
    pub id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorldDirectorRun {
    pub id: String,
    pub campaign_id: String,
    pub campaign_state: String,
    pub trigger: WorldDirectorTrigger,
    pub context_digest: String,
    pub pace: String,
    pub pressure_score: usize,
    pub signals: WorldDirectorSignals,
    pub proposals: Vec<WorldDirectorProposal>,
    pub suppressed: Vec<WorldDirectorSuppression>,
    pub source_snapshot: Value,
    pub created_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorldDirectorPrepareCommand {
    pub campaign_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorldDirectorCommitCommand {
    pub id: String,
    pub campaign_id: String,
    pub trigger: WorldDirectorTrigger,
    pub expected_context_digest: String,
    pub occurred_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct QuestInput {
    id: String,
    status: String,
    created_at: String,
    updated_at: String,
    world_clock_advances_since_creation: usize,
}

#[derive(Debug, Clone, Serialize)]
struct ClockInput {
    id: String,
    current: i64,
    max: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FactionInput {
    id: String,
    materialization: String,
    player_relation: String,
    current_action: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TransitionInput {
    to_status: String,
    occurred_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct EventInput {
    id: String,
    r#type: String,
    occurred_at: String,
}

#[derive(Debug, Clone)]
struct Candidate {
    kind: &'static str,
    actor_entity_id: Option<String>,
    target_entity_ids: Vec<String>,
    rationale: &'static str,
    proposed_effect: &'static str,
    urgency: &'static str,
    route: &'static str,
}

impl CampaignStore {
    pub fn prepare_world_director(
        &self,
        command: WorldDirectorPrepareCommand,
    ) -> Result<WorldDirectorPreparation, CampaignStoreError> {
        validate_bounded_id(&command.campaign_id, 200)?;
        prepare(&self.connect()?, &command.campaign_id)
    }

    pub fn commit_world_director(
        &self,
        command: WorldDirectorCommitCommand,
    ) -> Result<WorldDirectorRun, CampaignStoreError> {
        validate_command(&command)?;
        let mut connection = self.connect()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        if let Some(existing_id) = transaction
            .query_row(
                "SELECT id FROM world_director_runs
                 WHERE campaign_id=?1 AND trigger_kind=?2 AND trigger_id=?3",
                params![
                    command.campaign_id,
                    command.trigger.kind,
                    command.trigger.id
                ],
                |row| row.get::<_, String>(0),
            )
            .optional()?
        {
            let existing = load_run(&transaction, &existing_id)?;
            if existing.id != command.id
                || existing.context_digest != command.expected_context_digest
                || existing.created_at != command.occurred_at
            {
                return Err(CampaignStoreError::InvalidData);
            }
            transaction.commit()?;
            return Ok(existing);
        }
        let prepared = prepare(&transaction, &command.campaign_id)?;
        if prepared.context_digest != command.expected_context_digest {
            return Err(CampaignStoreError::ConcurrentModification);
        }
        transaction.execute(
            "INSERT INTO world_director_runs(
               id,campaign_id,trigger_kind,trigger_id,context_digest,pace,pressure_score,
               signals_json,suppressed_json,source_snapshot_json,created_at
             ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
            params![
                command.id,
                command.campaign_id,
                command.trigger.kind,
                command.trigger.id,
                prepared.context_digest,
                prepared.pace,
                prepared.pressure_score as i64,
                serde_json::to_string(&prepared.signals)
                    .map_err(|_| CampaignStoreError::InvalidData)?,
                serde_json::to_string(&prepared.suppressed)
                    .map_err(|_| CampaignStoreError::InvalidData)?,
                serde_json::to_string(&prepared.source_snapshot)
                    .map_err(|_| CampaignStoreError::InvalidData)?,
                command.occurred_at,
            ],
        )?;
        for proposal in &prepared.proposals {
            transaction.execute(
                "INSERT INTO world_director_proposals(
                   run_id,campaign_id,ordinal,action_id,kind,actor_entity_id,
                   target_entity_ids_json,rationale,proposed_effects_json,urgency,cooldown_key,route
                 ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",
                params![
                    command.id,
                    command.campaign_id,
                    proposal.rank as i64,
                    proposal.id,
                    proposal.kind,
                    proposal.actor_entity_id,
                    serde_json::to_string(&proposal.target_entity_ids)
                        .map_err(|_| CampaignStoreError::InvalidData)?,
                    proposal.rationale,
                    serde_json::to_string(&proposal.proposed_effects)
                        .map_err(|_| CampaignStoreError::InvalidData)?,
                    proposal.urgency,
                    proposal.cooldown_key,
                    proposal.route,
                ],
            )?;
        }
        let saved = load_run(&transaction, &command.id)?;
        transaction.commit()?;
        Ok(saved)
    }

    pub fn world_director_history(
        &self,
        campaign_id: &str,
        limit: usize,
    ) -> Result<Vec<WorldDirectorRun>, CampaignStoreError> {
        validate_bounded_id(campaign_id, 200)?;
        if !(1..=100).contains(&limit) {
            return Err(CampaignStoreError::InvalidData);
        }
        let connection = self.connect()?;
        let mut statement = connection.prepare(
            "SELECT id FROM world_director_runs
             WHERE campaign_id=?1 ORDER BY created_at DESC,id DESC LIMIT ?2",
        )?;
        let ids = statement
            .query_map(params![campaign_id, limit as i64], |row| {
                row.get::<_, String>(0)
            })?
            .collect::<Result<Vec<_>, _>>()?;
        ids.iter().map(|id| load_run(&connection, id)).collect()
    }
}

fn prepare(
    connection: &Connection,
    campaign_id: &str,
) -> Result<WorldDirectorPreparation, CampaignStoreError> {
    let campaign_state = connection
        .query_row(
            "SELECT state FROM campaigns WHERE id=?1",
            [campaign_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .ok_or(CampaignStoreError::NotFound)?;
    if !["TAVERN", "ADVENTURE", "SETTLEMENT"].contains(&campaign_state.as_str()) {
        return Err(CampaignStoreError::InvalidState);
    }
    let constitution_revision = connection
        .query_row(
            "SELECT revision FROM world_constitutions WHERE campaign_id=?1 AND status='LOCKED'",
            [campaign_id],
            |row| row.get::<_, i64>(0),
        )
        .optional()?
        .ok_or(CampaignStoreError::InvalidData)?;
    let current_location_id = connection
        .query_row(
            "SELECT COALESCE(
               (SELECT current_location_id FROM campaign_location_states WHERE campaign_id=?1),
               (SELECT location_id FROM taverns WHERE campaign_id=?1)
             )",
            [campaign_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .ok_or(CampaignStoreError::InvalidData)?;
    let quests = load_quests(connection, campaign_id)?;
    let clocks = load_clocks(connection, campaign_id)?;
    let factions = load_factions(connection, campaign_id)?;
    let recent_transitions = load_transitions(connection, campaign_id)?;
    let recent_events = load_events(connection, campaign_id)?;
    let (pace, pressure_score, signals, proposals, suppressed) = evaluate(
        &current_location_id,
        &quests,
        &clocks,
        &factions,
        &recent_transitions,
        recent_events.len(),
    );
    let source_snapshot = json!({
        "schemaVersion": 1,
        "constitutionRevision": constitution_revision,
        "campaignId": campaign_id,
        "campaignState": campaign_state,
        "currentLocationId": current_location_id,
        "quests": quests,
        "clocks": clocks,
        "factions": factions,
        "recentTransitions": recent_transitions,
        "recentEvents": recent_events,
    });
    let context_digest = canonical_digest(&source_snapshot)?;
    Ok(WorldDirectorPreparation {
        campaign_id: campaign_id.to_owned(),
        campaign_state,
        context_digest,
        pace,
        pressure_score,
        signals,
        proposals,
        suppressed,
        source_snapshot,
    })
}

fn load_quests(
    connection: &Connection,
    campaign_id: &str,
) -> Result<Vec<QuestInput>, CampaignStoreError> {
    let mut statement = connection.prepare(
        "SELECT pool.quest_id,pool.status,pool.created_at,pool.updated_at,
                (SELECT COUNT(*) FROM game_events event
                 WHERE event.campaign_id=pool.campaign_id
                   AND event.type='WORLD_CLOCK_ADVANCED'
                   AND event.occurred_at>pool.created_at)
         FROM quest_pool_states pool WHERE pool.campaign_id=?1 ORDER BY pool.quest_id",
    )?;
    Ok(statement
        .query_map([campaign_id], |row| {
            Ok(QuestInput {
                id: row.get(0)?,
                status: row.get(1)?,
                created_at: row.get(2)?,
                updated_at: row.get(3)?,
                world_clock_advances_since_creation: row.get::<_, i64>(4)? as usize,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?)
}

fn load_clocks(
    connection: &Connection,
    campaign_id: &str,
) -> Result<Vec<ClockInput>, CampaignStoreError> {
    let mut statement = connection
        .prepare("SELECT id,current,max FROM world_clocks WHERE campaign_id=?1 ORDER BY id")?;
    Ok(statement
        .query_map([campaign_id], |row| {
            Ok(ClockInput {
                id: row.get(0)?,
                current: row.get(1)?,
                max: row.get(2)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?)
}

fn load_factions(
    connection: &Connection,
    campaign_id: &str,
) -> Result<Vec<FactionInput>, CampaignStoreError> {
    let mut statement = connection.prepare(
        "SELECT id,materialization,json_extract(profile_json,'$.playerRelation'),
                json_extract(profile_json,'$.currentAction')
         FROM active_factions WHERE campaign_id=?1 ORDER BY id",
    )?;
    Ok(statement
        .query_map([campaign_id], |row| {
            Ok(FactionInput {
                id: row.get(0)?,
                materialization: row.get(1)?,
                player_relation: row.get(2)?,
                current_action: row.get(3)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?)
}

fn load_transitions(
    connection: &Connection,
    campaign_id: &str,
) -> Result<Vec<TransitionInput>, CampaignStoreError> {
    let mut statement = connection.prepare(
        "SELECT to_status,occurred_at FROM (
           SELECT to_status,occurred_at,operation_id FROM quest_pool_transitions
           WHERE campaign_id=?1 ORDER BY occurred_at DESC,operation_id DESC LIMIT 20
         ) ORDER BY occurred_at,operation_id",
    )?;
    Ok(statement
        .query_map([campaign_id], |row| {
            Ok(TransitionInput {
                to_status: row.get(0)?,
                occurred_at: row.get(1)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?)
}

fn load_events(
    connection: &Connection,
    campaign_id: &str,
) -> Result<Vec<EventInput>, CampaignStoreError> {
    let mut statement = connection.prepare(
        "SELECT id,type,occurred_at FROM (
           SELECT id,type,occurred_at FROM game_events WHERE campaign_id=?1
           ORDER BY occurred_at DESC,id DESC LIMIT 20
         ) ORDER BY occurred_at,id",
    )?;
    Ok(statement
        .query_map([campaign_id], |row| {
            Ok(EventInput {
                id: row.get(0)?,
                r#type: row.get(1)?,
                occurred_at: row.get(2)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?)
}

fn evaluate(
    current_location_id: &str,
    quests: &[QuestInput],
    clocks: &[ClockInput],
    factions: &[FactionInput],
    transitions: &[TransitionInput],
    recent_event_count: usize,
) -> (
    String,
    usize,
    WorldDirectorSignals,
    Vec<WorldDirectorProposal>,
    Vec<WorldDirectorSuppression>,
) {
    let open = quests
        .iter()
        .filter(|quest| OPEN_STATUSES.contains(&quest.status.as_str()))
        .collect::<Vec<_>>();
    let active = quests
        .iter()
        .filter(|quest| quest.status == "ACTIVE")
        .collect::<Vec<_>>();
    let blocked = quests
        .iter()
        .filter(|quest| quest.status == "BLOCKED")
        .collect::<Vec<_>>();
    let stale = quests
        .iter()
        .filter(|quest| {
            ["DISCOVERED", "AVAILABLE", "BLOCKED"].contains(&quest.status.as_str())
                && quest.world_clock_advances_since_creation
                    >= if quest.status == "BLOCKED" { 5 } else { 3 }
        })
        .collect::<Vec<_>>();
    let urgent = clocks
        .iter()
        .filter(|clock| clock.max - clock.current <= 1)
        .collect::<Vec<_>>();
    let foreshadow = clocks
        .iter()
        .filter(|clock| clock.max - clock.current == 2)
        .collect::<Vec<_>>();
    let hostile = factions
        .iter()
        .filter(|faction| {
            faction.materialization == "ACTIVE"
                && faction.player_relation == "HOSTILE"
                && faction.current_action.is_some()
        })
        .collect::<Vec<_>>();
    let recent_failure_count = transitions
        .iter()
        .filter(|transition| ["FAILED", "EXPIRED"].contains(&transition.to_status.as_str()))
        .count();
    let pressure_score = (active.len() * 2
        + blocked.len() * 2
        + urgent.len() * 3
        + hostile.len()
        + recent_failure_count * 2)
        .min(99);
    let pace = match pressure_score {
        0..=2 => "QUIET",
        3..=6 => "BALANCED",
        7..=10 => "PRESSURED",
        _ => "OVERLOADED",
    };
    let signals = WorldDirectorSignals {
        open_quest_count: open.len(),
        active_quest_count: active.len(),
        blocked_quest_count: blocked.len(),
        stale_quest_ids: stale.iter().map(|quest| quest.id.clone()).collect(),
        urgent_clock_ids: urgent.iter().map(|clock| clock.id.clone()).collect(),
        foreshadow_clock_ids: foreshadow.iter().map(|clock| clock.id.clone()).collect(),
        hostile_faction_ids: hostile.iter().map(|faction| faction.id.clone()).collect(),
        recent_failure_count,
        recent_event_count,
    };
    let mut candidates = stale
        .iter()
        .map(|quest| {
            candidate(
                "QUEST_EXPIRE",
                None,
                vec![quest.id.clone()],
                "The Quest remained unresolved across enough committed world-clock advances.",
                "Request Rules validation for an EXPIRED Quest transition.",
                "HIGH",
                "RULES",
            )
        })
        .collect::<Vec<_>>();
    let mut suppressed = Vec::new();
    if pace == "OVERLOADED" {
        suppress(
            &mut suppressed,
            "PRESSURE",
            urgent.iter().map(|value| value.id.as_str()),
        );
        suppress(
            &mut suppressed,
            "FORESHADOW",
            foreshadow.iter().map(|value| value.id.as_str()),
        );
        suppress(
            &mut suppressed,
            "FACTION_ACTION",
            hostile.iter().map(|value| value.id.as_str()),
        );
        if urgent.is_empty() && foreshadow.is_empty() && hostile.is_empty() {
            suppressed.push(suppression("PRESSURE", None, "The world is overloaded, so the Director schedules no new content-producing action."));
        }
    } else {
        candidates.extend(urgent.iter().map(|clock| {
            candidate(
                "PRESSURE",
                None,
                vec![clock.id.clone()],
                "A committed world clock is one step or less from its maximum.",
                "Request one grounded pressure candidate without mutating the clock or world.",
                "HIGH",
                "GENERATOR",
            )
        }));
        candidates.extend(foreshadow.iter().map(|clock| {
            candidate(
                "FORESHADOW",
                None,
                vec![clock.id.clone()],
                "A committed world clock is exactly two steps from its maximum.",
                "Request one foreshadowing candidate grounded in the referenced clock.",
                "MEDIUM",
                "GENERATOR",
            )
        }));
        candidates.extend(hostile.iter().map(|faction| candidate(
            "FACTION_ACTION", Some(faction.id.clone()), Vec::new(),
            "An active hostile Faction has a committed current action.",
            "Request a Faction proposal; existing Faction Rules must validate every consequence.", "MEDIUM", "FACTION_RULES",
        )));
        if pace == "PRESSURED" && !blocked.is_empty() {
            candidates.push(candidate(
                "QUEST_UPDATE",
                None,
                vec![blocked[0].id.clone()],
                "A blocked Quest contributes to sustained world pressure.",
                "Request deterministic Quest Graph reevaluation; do not set status directly.",
                "HIGH",
                "RULES",
            ));
        }
        if pace == "QUIET" {
            let oldest = open.iter().min_by(|left, right| {
                left.updated_at
                    .cmp(&right.updated_at)
                    .then(left.id.cmp(&right.id))
            });
            candidates.push(match oldest {
                Some(quest) => candidate(
                    "FORESHADOW", None, vec![quest.id.clone()],
                    "The world is quiet while an open Quest remains unresolved.",
                    "Request one subtle reminder candidate without changing Quest state.", "LOW", "GENERATOR",
                ),
                None => candidate(
                    "OPPORTUNITY", None, vec![current_location_id.to_owned()],
                    "No open Quest or high-pressure signal exists in the current world state.",
                    "Request one local opportunity candidate without creating or committing a Quest.", "MEDIUM", "GENERATOR",
                ),
            });
        }
    }
    candidates.sort_by(compare_candidates);
    for overflow in candidates.iter().skip(MAX_PROPOSALS) {
        suppressed.push(WorldDirectorSuppression {
            kind: overflow.kind.to_owned(),
            target_entity_id: overflow.target_entity_ids.first().cloned().or_else(|| overflow.actor_entity_id.clone()),
            reason: "ACTION_LIMIT".to_owned(),
            rationale: "The bounded Director decision payload keeps only the first eight deterministic proposals.".to_owned(),
        });
    }
    let proposals = candidates
        .into_iter()
        .take(MAX_PROPOSALS)
        .enumerate()
        .map(|(index, value)| {
            let target = value
                .actor_entity_id
                .as_ref()
                .or_else(|| value.target_entity_ids.first())
                .map_or_else(
                    || "world".to_owned(),
                    |value| value.chars().take(80).collect(),
                );
            WorldDirectorProposal {
                id: format!("director-action-{}", index + 1),
                rank: index + 1,
                kind: value.kind.to_owned(),
                actor_entity_id: value.actor_entity_id,
                target_entity_ids: value.target_entity_ids,
                rationale: value.rationale.to_owned(),
                proposed_effects: vec![value.proposed_effect.to_owned()],
                urgency: value.urgency.to_owned(),
                cooldown_key: format!("director:{}:{target}", value.kind.to_lowercase()),
                route: value.route.to_owned(),
            }
        })
        .collect();
    suppressed.sort_by(|left, right| {
        left.reason
            .cmp(&right.reason)
            .then(left.kind.cmp(&right.kind))
            .then(left.target_entity_id.cmp(&right.target_entity_id))
    });
    (
        pace.to_owned(),
        pressure_score,
        signals,
        proposals,
        suppressed,
    )
}

fn candidate(
    kind: &'static str,
    actor_entity_id: Option<String>,
    target_entity_ids: Vec<String>,
    rationale: &'static str,
    proposed_effect: &'static str,
    urgency: &'static str,
    route: &'static str,
) -> Candidate {
    Candidate {
        kind,
        actor_entity_id,
        target_entity_ids,
        rationale,
        proposed_effect,
        urgency,
        route,
    }
}

fn suppression(kind: &str, target: Option<String>, rationale: &str) -> WorldDirectorSuppression {
    WorldDirectorSuppression {
        kind: kind.to_owned(),
        target_entity_id: target,
        reason: "OVERLOAD_GUARD".to_owned(),
        rationale: rationale.to_owned(),
    }
}

fn suppress<'a>(
    output: &mut Vec<WorldDirectorSuppression>,
    kind: &str,
    ids: impl Iterator<Item = &'a str>,
) {
    output.extend(ids.map(|id| {
        suppression(
            kind,
            Some(id.to_owned()),
            "The current pressure band forbids scheduling another content-producing action.",
        )
    }));
}

fn compare_candidates(left: &Candidate, right: &Candidate) -> Ordering {
    urgency_order(left.urgency)
        .cmp(&urgency_order(right.urgency))
        .then(kind_order(left.kind).cmp(&kind_order(right.kind)))
        .then(candidate_target(left).cmp(candidate_target(right)))
}

fn urgency_order(value: &str) -> usize {
    match value {
        "HIGH" => 0,
        "MEDIUM" => 1,
        _ => 2,
    }
}
fn kind_order(value: &str) -> usize {
    match value {
        "QUEST_EXPIRE" => 0,
        "QUEST_UPDATE" => 1,
        "PRESSURE" => 2,
        "FORESHADOW" => 3,
        "FACTION_ACTION" => 4,
        "OPPORTUNITY" => 5,
        "WORLD_CHANGE" => 6,
        _ => 7,
    }
}
fn candidate_target(value: &Candidate) -> &str {
    value
        .target_entity_ids
        .first()
        .or(value.actor_entity_id.as_ref())
        .map(String::as_str)
        .unwrap_or("")
}

fn load_run(connection: &Connection, id: &str) -> Result<WorldDirectorRun, CampaignStoreError> {
    let row = connection
        .query_row(
            "SELECT campaign_id,trigger_kind,trigger_id,context_digest,pace,pressure_score,
                signals_json,suppressed_json,source_snapshot_json,created_at
         FROM world_director_runs WHERE id=?1",
            [id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, i64>(5)?,
                    row.get::<_, String>(6)?,
                    row.get::<_, String>(7)?,
                    row.get::<_, String>(8)?,
                    row.get::<_, String>(9)?,
                ))
            },
        )
        .optional()?
        .ok_or(CampaignStoreError::NotFound)?;
    let source_snapshot: Value =
        serde_json::from_str(&row.8).map_err(|_| CampaignStoreError::InvalidData)?;
    let campaign_state = source_snapshot
        .get("campaignState")
        .and_then(Value::as_str)
        .ok_or(CampaignStoreError::InvalidData)?
        .to_owned();
    let signals = serde_json::from_str::<WorldDirectorSignals>(&row.6)
        .map_err(|_| CampaignStoreError::InvalidData)?;
    let suppressed = serde_json::from_str::<Vec<WorldDirectorSuppression>>(&row.7)
        .map_err(|_| CampaignStoreError::InvalidData)?;
    let mut statement = connection.prepare(
        "SELECT action_id,ordinal,kind,actor_entity_id,target_entity_ids_json,rationale,
                proposed_effects_json,urgency,cooldown_key,route
         FROM world_director_proposals WHERE run_id=?1 AND campaign_id=?2 ORDER BY ordinal",
    )?;
    let proposals =
        statement
            .query_map(params![id, row.0], |proposal| {
                Ok(WorldDirectorProposal {
                    id: proposal.get(0)?,
                    rank: proposal.get::<_, i64>(1)? as usize,
                    kind: proposal.get(2)?,
                    actor_entity_id: proposal.get(3)?,
                    target_entity_ids: serde_json::from_str(&proposal.get::<_, String>(4)?)
                        .map_err(|error| {
                            rusqlite::Error::FromSqlConversionFailure(
                                4,
                                rusqlite::types::Type::Text,
                                Box::new(error),
                            )
                        })?,
                    rationale: proposal.get(5)?,
                    proposed_effects: serde_json::from_str(&proposal.get::<_, String>(6)?)
                        .map_err(|error| {
                            rusqlite::Error::FromSqlConversionFailure(
                                6,
                                rusqlite::types::Type::Text,
                                Box::new(error),
                            )
                        })?,
                    urgency: proposal.get(7)?,
                    cooldown_key: proposal.get(8)?,
                    route: proposal.get(9)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
    Ok(WorldDirectorRun {
        id: id.to_owned(),
        campaign_id: row.0,
        campaign_state,
        trigger: WorldDirectorTrigger {
            kind: row.1,
            id: row.2,
        },
        context_digest: row.3,
        pace: row.4,
        pressure_score: row.5 as usize,
        signals,
        proposals,
        suppressed,
        source_snapshot,
        created_at: row.9,
    })
}

fn validate_command(command: &WorldDirectorCommitCommand) -> Result<(), CampaignStoreError> {
    validate_bounded_id(&command.id, 200)?;
    validate_bounded_id(&command.campaign_id, 200)?;
    validate_bounded_id(&command.trigger.id, 200)?;
    if ![
        "MANUAL",
        "WORLD_EVENT",
        "PLAYER_ACTION",
        "QUEST_TRANSITION",
        "SETTLEMENT",
    ]
    .contains(&command.trigger.kind.as_str())
        || command.expected_context_digest.len() != 64
        || !command
            .expected_context_digest
            .bytes()
            .all(|value| value.is_ascii_hexdigit() && !value.is_ascii_uppercase())
    {
        return Err(CampaignStoreError::InvalidData);
    }
    validate_timestamp(&command.occurred_at)
}

fn validate_bounded_id(value: &str, max: usize) -> Result<(), CampaignStoreError> {
    validate_id(value)?;
    if value.chars().count() > max {
        Err(CampaignStoreError::InvalidData)
    } else {
        Ok(())
    }
}

fn canonical_digest(value: &Value) -> Result<String, CampaignStoreError> {
    let mut hash = Sha256::new();
    hash.update(canonical_json(value)?);
    Ok(format!("{:x}", hash.finalize()))
}

fn canonical_json(value: &Value) -> Result<String, CampaignStoreError> {
    match value {
        Value::Null | Value::Bool(_) | Value::Number(_) | Value::String(_) => {
            serde_json::to_string(value).map_err(|_| CampaignStoreError::InvalidData)
        }
        Value::Array(values) => Ok(format!(
            "[{}]",
            values
                .iter()
                .map(canonical_json)
                .collect::<Result<Vec<_>, _>>()?
                .join(",")
        )),
        Value::Object(values) => {
            let mut keys = values.keys().collect::<Vec<_>>();
            keys.sort();
            Ok(format!(
                "{{{}}}",
                keys.into_iter()
                    .map(|key| Ok(format!(
                        "{}:{}",
                        serde_json::to_string(key).map_err(|_| CampaignStoreError::InvalidData)?,
                        canonical_json(&values[key])?
                    )))
                    .collect::<Result<Vec<_>, CampaignStoreError>>()?
                    .join(",")
            ))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const AT: &str = "2026-08-24T14:00:00.000Z";

    #[test]
    fn quiet_run_is_append_only_idempotent_and_survives_reopen() {
        let directory = tempfile::tempdir().expect("temp directory");
        let path = directory.path().join("world-director.sqlite");
        let store = CampaignStore::open(&path).expect("open database");
        seed(&store);
        let prepared = store
            .prepare_world_director(WorldDirectorPrepareCommand {
                campaign_id: "campaign-director".to_owned(),
            })
            .expect("prepare");
        assert_eq!(prepared.pace, "QUIET");
        assert_eq!(prepared.proposals[0].kind, "OPPORTUNITY");
        let command = WorldDirectorCommitCommand {
            id: "director-run-native".to_owned(),
            campaign_id: "campaign-director".to_owned(),
            trigger: WorldDirectorTrigger {
                kind: "MANUAL".to_owned(),
                id: "manual-native".to_owned(),
            },
            expected_context_digest: prepared.context_digest,
            occurred_at: AT.to_owned(),
        };
        let run = store
            .commit_world_director(WorldDirectorCommitCommand {
                id: command.id.clone(),
                campaign_id: command.campaign_id.clone(),
                trigger: command.trigger.clone(),
                expected_context_digest: command.expected_context_digest.clone(),
                occurred_at: command.occurred_at.clone(),
            })
            .expect("commit");
        assert_eq!(run.proposals.len(), 1);
        assert_eq!(
            store
                .commit_world_director(command)
                .expect("idempotent replay"),
            run
        );
        let connection = store.connect().expect("connect");
        assert_eq!(
            connection
                .query_row("SELECT COUNT(*) FROM world_facts", [], |row| row
                    .get::<_, i64>(0))
                .expect("facts"),
            0
        );
        assert_eq!(
            connection
                .query_row("SELECT COUNT(*) FROM game_events", [], |row| row
                    .get::<_, i64>(0))
                .expect("events"),
            0
        );
        drop(connection);
        drop(store);
        let reopened = CampaignStore::open(path).expect("reopen");
        assert_eq!(
            reopened
                .world_director_history("campaign-director", 20)
                .expect("history"),
            vec![run]
        );
    }

    #[test]
    fn stale_digest_fails_without_a_partial_audit_row() {
        let directory = tempfile::tempdir().expect("temp directory");
        let store = CampaignStore::open(directory.path().join("stale-director.sqlite"))
            .expect("open database");
        seed(&store);
        let prepared = store
            .prepare_world_director(WorldDirectorPrepareCommand {
                campaign_id: "campaign-director".to_owned(),
            })
            .expect("prepare");
        store
            .connect()
            .expect("connect")
            .execute(
                "INSERT INTO world_clocks(id,campaign_id,name,current,max,stages_json,created_at,updated_at)
                 VALUES('clock-new','campaign-director','Storm',0,4,'[]',?1,?1)",
                [AT],
            )
            .expect("clock");
        assert!(matches!(
            store.commit_world_director(WorldDirectorCommitCommand {
                id: "director-run-stale".to_owned(),
                campaign_id: "campaign-director".to_owned(),
                trigger: WorldDirectorTrigger {
                    kind: "MANUAL".to_owned(),
                    id: "manual-stale".to_owned(),
                },
                expected_context_digest: prepared.context_digest,
                occurred_at: AT.to_owned(),
            }),
            Err(CampaignStoreError::ConcurrentModification)
        ));
        assert!(
            store
                .world_director_history("campaign-director", 20)
                .expect("history")
                .is_empty()
        );
    }

    fn seed(store: &CampaignStore) {
        store
            .connect()
            .expect("connect")
            .execute_batch(&format!(
                "INSERT INTO campaigns(id,schema_version,state,created_at,updated_at)
                 VALUES('campaign-director',1,'TAVERN','{AT}','{AT}');
                 INSERT INTO world_constitutions(
                   campaign_id,schema_version,revision,status,world_type,era,technology,magic,
                   peoples_json,society,politics,economy,combat_scale,death_rules,career_rules,
                   equipment_rules,npc_rules,trait_rules,taboos_json,created_at,updated_at,locked_at
                 ) VALUES(
                   'campaign-director',1,1,'LOCKED','Fantasy','Old','Iron','Rare','[]','Guilds',
                   'Council','Trade','Local','Mortal','Open','Grounded','Persistent','Balanced','[]',
                   '{AT}','{AT}','{AT}'
                 );
                 INSERT INTO taverns(
                   id,campaign_id,location_id,name,position,environment,special_rules_json,
                   long_term_problem,changes_json,created_at,updated_at
                 ) VALUES(
                   'tavern-director','campaign-director','location-director','Ember Rest','Road',
                   'Warm','[]','Storm','[]','{AT}','{AT}'
                 );"
            ))
            .expect("seed");
    }
}

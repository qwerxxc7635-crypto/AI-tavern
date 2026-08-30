use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params};
use serde::{Deserialize, Serialize};

use crate::{CampaignStore, CampaignStoreError, validate_id, validate_timestamp};

const DAY_MINUTES: i64 = 1_440;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DirectorBudgetAdmitCommand {
    pub campaign_id: String,
    pub run_id: String,
    pub occurred_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectorBudgetUsage {
    pub daily_events: i64,
    pub urgent_events: i64,
    pub npc_proactive: i64,
    pub background_changes: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectorBudgetLimits {
    pub active_quests: i64,
    pub daily_events: i64,
    pub urgent_events: i64,
    pub npc_proactive: i64,
    pub background_changes: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectorBudgetEntry {
    pub run_id: String,
    pub ordinal: i64,
    pub action_id: String,
    pub kind: String,
    pub urgency: String,
    pub cooldown_key: String,
    pub category: String,
    pub status: String,
    pub requested_game_time: i64,
    pub eligible_game_time: i64,
    pub approved_game_time: Option<i64>,
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectorBudgetSnapshot {
    pub campaign_id: String,
    pub game_day: i64,
    pub game_time_minutes: i64,
    pub active_quest_count: i64,
    pub limits: DirectorBudgetLimits,
    pub usage: DirectorBudgetUsage,
    pub revision: i64,
    pub entries: Vec<DirectorBudgetEntry>,
    pub updated_at: String,
}

impl CampaignStore {
    pub fn admit_director_budget(
        &self,
        command: DirectorBudgetAdmitCommand,
    ) -> Result<DirectorBudgetSnapshot, CampaignStoreError> {
        validate_id(&command.campaign_id)?;
        validate_id(&command.run_id)?;
        validate_timestamp(&command.occurred_at)?;
        let mut connection = self.connect()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let run_campaign = transaction
            .query_row(
                "SELECT campaign_id FROM world_director_runs WHERE id=?1",
                [&command.run_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?
            .ok_or(CampaignStoreError::NotFound)?;
        if run_campaign != command.campaign_id {
            return Err(CampaignStoreError::InvalidData);
        }
        let exists = transaction
            .query_row(
                "SELECT 1 FROM director_budget_admissions WHERE run_id=?1",
                [&command.run_id],
                |_| Ok(()),
            )
            .optional()?
            .is_some();
        if exists {
            let result = load_snapshot(&transaction, &command.campaign_id)?;
            transaction.commit()?;
            return result.ok_or(CampaignStoreError::InvalidData);
        }
        transaction.execute(
            "INSERT INTO director_budget_admissions(run_id,campaign_id,admitted_at) VALUES(?1,?2,?3)",
            params![command.run_id, command.campaign_id, command.occurred_at],
        )?;
        let game_time = transaction
            .query_row(
                "SELECT game_time_minutes FROM character_rule_states WHERE campaign_id=?1",
                [&command.campaign_id],
                |row| row.get::<_, i64>(0),
            )
            .optional()?
            .ok_or(CampaignStoreError::InvalidData)?;
        let game_day = game_time / DAY_MINUTES;
        let prior = transaction
            .query_row(
                "SELECT game_day,game_time_minutes,daily_events_used,urgent_events_used,
                 npc_proactive_used,background_changes_used,revision
                 FROM director_budget_states WHERE campaign_id=?1",
                [&command.campaign_id],
                |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, i64>(2)?,
                        row.get::<_, i64>(3)?,
                        row.get::<_, i64>(4)?,
                        row.get::<_, i64>(5)?,
                        row.get::<_, i64>(6)?,
                    ))
                },
            )
            .optional()?;
        let (mut usage, revision) = match prior {
            Some((prior_day, prior_time, daily, urgent, npc, background, revision)) => {
                if game_time < prior_time {
                    return Err(CampaignStoreError::InvalidData);
                }
                let usage = if prior_day == game_day {
                    DirectorBudgetUsage {
                        daily_events: daily,
                        urgent_events: urgent,
                        npc_proactive: npc,
                        background_changes: background,
                    }
                } else {
                    empty_usage()
                };
                (usage, revision + 1)
            }
            None => (empty_usage(), 1),
        };
        {
            let mut query = transaction.prepare(
                "SELECT ordinal,kind FROM world_director_proposals WHERE run_id=?1 ORDER BY ordinal",
            )?;
            let proposals = query
                .query_map([&command.run_id], |row| {
                    Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            for (ordinal, kind) in proposals {
                transaction.execute(
                    "INSERT INTO director_budget_entries(run_id,campaign_id,ordinal,category,status,
                     requested_game_time,eligible_game_time,approved_game_time,reason,created_at,updated_at)
                     VALUES(?1,?2,?3,?4,'DEFERRED',?5,?5,NULL,'AVAILABLE',?6,?6)",
                    params![command.run_id, command.campaign_id, ordinal, category(&kind),
                        game_time, command.occurred_at],
                )?;
            }
        }
        let mut pending = load_pending(&transaction, &command.campaign_id)?;
        pending.sort_by(|left, right| {
            effective_priority(right, game_time)
                .cmp(&effective_priority(left, game_time))
                .then_with(|| left.requested_game_time.cmp(&right.requested_game_time))
                .then_with(|| left.run_id.cmp(&right.run_id))
                .then_with(|| left.ordinal.cmp(&right.ordinal))
        });
        let mut active = transaction.query_row(
            "SELECT COUNT(*) FROM quest_pool_states WHERE campaign_id=?1 AND status='ACTIVE'",
            [&command.campaign_id],
            |row| row.get::<_, i64>(0),
        )?;
        for entry in pending {
            let next_day = (game_day + 1) * DAY_MINUTES;
            let mut reason = None;
            let mut eligible = game_time;
            if entry.kind == "OPPORTUNITY" && active >= 4 {
                reason = Some("ACTIVE_QUEST_LIMIT");
                eligible = next_day;
            }
            let cooldown = transaction
                .query_row(
                    "SELECT next_eligible_game_time FROM director_budget_cooldowns
                 WHERE campaign_id=?1 AND cooldown_key=?2",
                    params![command.campaign_id, entry.cooldown_key],
                    |row| row.get::<_, i64>(0),
                )
                .optional()?
                .unwrap_or(0);
            if reason.is_none() && cooldown > game_time {
                reason = Some("COOLDOWN");
                eligible = cooldown;
            }
            if reason.is_none() {
                reason = capacity_reason(&entry.category, &usage);
                if reason.is_some() {
                    eligible = next_day;
                }
            }
            if let Some(reason) = reason {
                transaction.execute(
                    "UPDATE director_budget_entries SET eligible_game_time=?1,reason=?2,updated_at=?3
                     WHERE run_id=?4 AND ordinal=?5",
                    params![eligible.max(entry.requested_game_time), reason, command.occurred_at,
                        entry.run_id, entry.ordinal],)?;
                record_decision(
                    &transaction,
                    &command,
                    &entry,
                    "DEFERRED",
                    reason,
                    game_day,
                    game_time,
                )?;
            } else {
                transaction.execute(
                    "UPDATE director_budget_entries SET status='APPROVED',approved_game_time=?1,
                     eligible_game_time=?1,reason='AVAILABLE',updated_at=?2 WHERE run_id=?3 AND ordinal=?4",
                    params![game_time, command.occurred_at, entry.run_id, entry.ordinal],)?;
                consume(&entry.category, &mut usage);
                if entry.kind == "OPPORTUNITY" {
                    active += 1;
                }
                let duration = cooldown_minutes(&entry.kind);
                if duration > 0 {
                    transaction.execute(
                        "INSERT INTO director_budget_cooldowns(campaign_id,cooldown_key,
                         next_eligible_game_time,source_run_id,source_ordinal,updated_at)
                         VALUES(?1,?2,?3,?4,?5,?6) ON CONFLICT(campaign_id,cooldown_key) DO UPDATE SET
                         next_eligible_game_time=excluded.next_eligible_game_time,
                         source_run_id=excluded.source_run_id,source_ordinal=excluded.source_ordinal,
                         updated_at=excluded.updated_at",
                        params![command.campaign_id, entry.cooldown_key, game_time + duration,
                            entry.run_id, entry.ordinal, command.occurred_at],)?;
                }
                record_decision(
                    &transaction,
                    &command,
                    &entry,
                    "APPROVED",
                    "AVAILABLE",
                    game_day,
                    game_time,
                )?;
            }
        }
        transaction.execute(
            "INSERT INTO director_budget_states(campaign_id,schema_version,game_day,game_time_minutes,
             daily_events_used,urgent_events_used,npc_proactive_used,background_changes_used,revision,updated_at)
             VALUES(?1,1,?2,?3,?4,?5,?6,?7,?8,?9) ON CONFLICT(campaign_id) DO UPDATE SET
             game_day=excluded.game_day,game_time_minutes=excluded.game_time_minutes,
             daily_events_used=excluded.daily_events_used,urgent_events_used=excluded.urgent_events_used,
             npc_proactive_used=excluded.npc_proactive_used,background_changes_used=excluded.background_changes_used,
             revision=excluded.revision,updated_at=excluded.updated_at",
            params![command.campaign_id, game_day, game_time, usage.daily_events, usage.urgent_events,
                usage.npc_proactive, usage.background_changes, revision, command.occurred_at],)?;
        let result = load_snapshot(&transaction, &command.campaign_id)?
            .ok_or(CampaignStoreError::InvalidData)?;
        transaction.commit()?;
        Ok(result)
    }

    pub fn director_budget_snapshot(
        &self,
        campaign_id: &str,
    ) -> Result<Option<DirectorBudgetSnapshot>, CampaignStoreError> {
        validate_id(campaign_id)?;
        load_snapshot(&self.connect()?, campaign_id)
    }
}

fn empty_usage() -> DirectorBudgetUsage {
    DirectorBudgetUsage {
        daily_events: 0,
        urgent_events: 0,
        npc_proactive: 0,
        background_changes: 0,
    }
}
fn category(kind: &str) -> &'static str {
    match kind {
        "QUEST_UPDATE" | "QUEST_EXPIRE" => "MAINTENANCE",
        "OPPORTUNITY" | "FORESHADOW" => "DAILY_EVENT",
        "PRESSURE" => "URGENT_EVENT",
        "NPC_ACTION" => "NPC_PROACTIVE",
        _ => "BACKGROUND_CHANGE",
    }
}
fn cooldown_minutes(kind: &str) -> i64 {
    match kind {
        "QUEST_UPDATE" | "QUEST_EXPIRE" => 0,
        "PRESSURE" => 180,
        "FORESHADOW" => 360,
        _ => 720,
    }
}
fn effective_priority(entry: &DirectorBudgetEntry, now: i64) -> i64 {
    let base = match entry.urgency.as_str() {
        "HIGH" => 3,
        "MEDIUM" => 2,
        _ => 1,
    };
    base + ((now - entry.requested_game_time).max(0) / DAY_MINUTES).min(3)
}
fn capacity_reason(category: &str, usage: &DirectorBudgetUsage) -> Option<&'static str> {
    match category {
        "DAILY_EVENT" if usage.daily_events >= 4 => Some("DAILY_LIMIT"),
        "URGENT_EVENT" if usage.urgent_events >= 2 => Some("URGENT_LIMIT"),
        "URGENT_EVENT" if usage.daily_events >= 4 => Some("DAILY_LIMIT"),
        "NPC_PROACTIVE" if usage.npc_proactive >= 2 => Some("NPC_LIMIT"),
        "BACKGROUND_CHANGE" if usage.background_changes >= 3 => Some("BACKGROUND_LIMIT"),
        _ => None,
    }
}
fn consume(category: &str, usage: &mut DirectorBudgetUsage) {
    match category {
        "DAILY_EVENT" => usage.daily_events += 1,
        "URGENT_EVENT" => {
            usage.daily_events += 1;
            usage.urgent_events += 1
        }
        "NPC_PROACTIVE" => usage.npc_proactive += 1,
        "BACKGROUND_CHANGE" => usage.background_changes += 1,
        _ => {}
    }
}

fn load_pending(
    connection: &Connection,
    campaign_id: &str,
) -> Result<Vec<DirectorBudgetEntry>, CampaignStoreError> {
    let mut query = connection.prepare(
        "SELECT entry.run_id,entry.ordinal,proposal.action_id,proposal.kind,proposal.urgency,
         proposal.cooldown_key,entry.category,entry.status,entry.requested_game_time,
         entry.eligible_game_time,entry.approved_game_time,entry.reason
         FROM director_budget_entries entry JOIN world_director_proposals proposal
         ON proposal.run_id=entry.run_id AND proposal.ordinal=entry.ordinal
         WHERE entry.campaign_id=?1 AND entry.status='DEFERRED'",
    )?;
    Ok(query
        .query_map([campaign_id], map_entry)?
        .collect::<Result<Vec<_>, _>>()?)
}
fn load_snapshot(
    connection: &Connection,
    campaign_id: &str,
) -> Result<Option<DirectorBudgetSnapshot>, CampaignStoreError> {
    let state = connection.query_row(
        "SELECT game_day,game_time_minutes,daily_events_used,urgent_events_used,npc_proactive_used,
         background_changes_used,revision,updated_at FROM director_budget_states WHERE campaign_id=?1",
        [campaign_id], |row| Ok((row.get::<_,i64>(0)?,row.get::<_,i64>(1)?,row.get::<_,i64>(2)?,
            row.get::<_,i64>(3)?,row.get::<_,i64>(4)?,row.get::<_,i64>(5)?,row.get::<_,i64>(6)?,
            row.get::<_,String>(7)?)),).optional()?;
    let Some((day, time, daily, urgent, npc, background, revision, updated_at)) = state else {
        return Ok(None);
    };
    let active = connection.query_row(
        "SELECT COUNT(*) FROM quest_pool_states WHERE campaign_id=?1 AND status='ACTIVE'",
        [campaign_id],
        |row| row.get::<_, i64>(0),
    )?;
    let mut query = connection.prepare(
        "SELECT entry.run_id,entry.ordinal,proposal.action_id,proposal.kind,proposal.urgency,
         proposal.cooldown_key,entry.category,entry.status,entry.requested_game_time,
         entry.eligible_game_time,entry.approved_game_time,entry.reason
         FROM director_budget_entries entry JOIN world_director_proposals proposal
         ON proposal.run_id=entry.run_id AND proposal.ordinal=entry.ordinal
         WHERE entry.campaign_id=?1 ORDER BY entry.requested_game_time,entry.run_id,entry.ordinal",
    )?;
    let entries = query
        .query_map([campaign_id], map_entry)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(Some(DirectorBudgetSnapshot {
        campaign_id: campaign_id.to_owned(),
        game_day: day,
        game_time_minutes: time,
        active_quest_count: active,
        limits: DirectorBudgetLimits {
            active_quests: 4,
            daily_events: 4,
            urgent_events: 2,
            npc_proactive: 2,
            background_changes: 3,
        },
        usage: DirectorBudgetUsage {
            daily_events: daily,
            urgent_events: urgent,
            npc_proactive: npc,
            background_changes: background,
        },
        revision,
        entries,
        updated_at,
    }))
}
fn map_entry(row: &rusqlite::Row<'_>) -> rusqlite::Result<DirectorBudgetEntry> {
    Ok(DirectorBudgetEntry {
        run_id: row.get(0)?,
        ordinal: row.get(1)?,
        action_id: row.get(2)?,
        kind: row.get(3)?,
        urgency: row.get(4)?,
        cooldown_key: row.get(5)?,
        category: row.get(6)?,
        status: row.get(7)?,
        requested_game_time: row.get(8)?,
        eligible_game_time: row.get(9)?,
        approved_game_time: row.get(10)?,
        reason: row.get(11)?,
    })
}
fn record_decision(
    connection: &Connection,
    command: &DirectorBudgetAdmitCommand,
    entry: &DirectorBudgetEntry,
    outcome: &str,
    reason: &str,
    day: i64,
    time: i64,
) -> Result<(), CampaignStoreError> {
    connection.execute("INSERT INTO director_budget_decisions(campaign_id,evaluation_run_id,proposal_run_id,proposal_ordinal,outcome,reason,game_day,game_time_minutes,occurred_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)", params![command.campaign_id,command.run_id,entry.run_id,entry.ordinal,outcome,reason,day,time,command.occurred_at])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    const AT: &str = "2026-08-24T16:00:00.000Z";

    #[test]
    fn budget_is_persistent_and_recovers_at_the_next_game_day() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let path = directory.path().join("director-budget.sqlite");
        let store = CampaignStore::open(&path).expect("open store");
        seed(&store);
        for index in 1..=5 {
            insert_run(&store, &format!("run-{index}"), &format!("clock-{index}"));
            store
                .admit_director_budget(DirectorBudgetAdmitCommand {
                    campaign_id: "campaign-budget".to_owned(),
                    run_id: format!("run-{index}"),
                    occurred_at: AT.to_owned(),
                })
                .expect("admit run");
        }
        let first = store
            .director_budget_snapshot("campaign-budget")
            .expect("snapshot")
            .expect("state");
        assert_eq!(first.usage.daily_events, 4);
        assert_eq!(first.entries[4].reason, "DAILY_LIMIT");
        store.connect().expect("connection").execute(
            "UPDATE character_rule_states SET game_time_minutes=1440 WHERE campaign_id='campaign-budget'", [],
        ).expect("advance game time");
        insert_run(&store, "run-6", "clock-6");
        let rolled = store
            .admit_director_budget(DirectorBudgetAdmitCommand {
                campaign_id: "campaign-budget".to_owned(),
                run_id: "run-6".to_owned(),
                occurred_at: AT.to_owned(),
            })
            .expect("admit next day");
        assert_eq!(rolled.game_day, 1);
        assert_eq!(rolled.usage.daily_events, 2);
        drop(store);
        let reopened = CampaignStore::open(path).expect("reopen");
        assert_eq!(
            reopened
                .director_budget_snapshot("campaign-budget")
                .expect("read"),
            Some(rolled)
        );
    }

    fn seed(store: &CampaignStore) {
        store.connect().expect("connection").execute_batch(&format!(
            "INSERT INTO campaigns(id,schema_version,state,created_at,updated_at)
             VALUES('campaign-budget',1,'TAVERN','{AT}','{AT}');
             INSERT INTO player_characters(id,campaign_id,name,concept,story_preferences_json,
             content_boundaries_json,class_archetype,class_display_name,attributes_json,traits_json,
             personal_goal,background_json,created_at,updated_at)
             VALUES('character-budget','campaign-budget','Mara','Wanderer','[]','[]','ROGUE','Rogue',
             '{{\"physique\":2,\"agility\":3,\"knowledge\":2,\"charisma\":3}}','[]','Find truth','{{}}','{AT}','{AT}');"
        )).expect("seed");
    }

    fn insert_run(store: &CampaignStore, id: &str, target: &str) {
        let connection = store.connect().expect("connection");
        connection.execute(
            "INSERT INTO world_director_runs(id,campaign_id,trigger_kind,trigger_id,context_digest,
             pace,pressure_score,signals_json,suppressed_json,source_snapshot_json,created_at)
             VALUES(?1,'campaign-budget','MANUAL',?2,?3,'BALANCED',0,'{}','[]',
             '{\"campaignState\":\"TAVERN\"}',?4)",
            params![id, format!("manual-{id}"), "0".repeat(64), AT],
        ).expect("run");
        connection
            .execute(
                "INSERT INTO world_director_proposals(run_id,campaign_id,ordinal,action_id,kind,
             actor_entity_id,target_entity_ids_json,rationale,proposed_effects_json,urgency,
             cooldown_key,route) VALUES(?1,'campaign-budget',1,'action-1','FORESHADOW',NULL,
             '[]','Budget test','[\"Propose only\"]','MEDIUM',?2,'GENERATOR')",
                params![id, format!("director:foreshadow:{target}")],
            )
            .expect("proposal");
    }
}

use std::collections::HashSet;

use rusqlite::{OptionalExtension, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::{
    CampaignStore, CampaignStoreError, TavernGenerationAudit, current_timestamp, validate_id,
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AdventureSettlementCommit {
    pub campaign_id: String,
    pub adventure_id: String,
    pub outcome: String,
    pub summary: TavernGenerationAudit,
    pub world_event: TavernGenerationAudit,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdventureArchiveView {
    pub campaign_id: String,
    pub adventure_id: String,
    pub title: String,
    pub outcome: String,
    pub summary: String,
    pub key_decisions: Vec<String>,
    pub unresolved_threads: Vec<String>,
    pub next_directions: Vec<String>,
    pub dice_results: Vec<Value>,
    pub participant_npcs: Vec<Value>,
    pub unresolved_clues: Vec<Value>,
    pub tavern_change: Value,
    pub acquired_items: Vec<Value>,
    pub world_facts: Vec<Value>,
    pub generation_uses: Vec<Value>,
    pub completed_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SummaryOutput {
    summary: String,
    key_decisions: Vec<String>,
    unresolved_threads: Vec<String>,
    next_directions: Vec<String>,
    npc_updates: Vec<NpcUpdate>,
    tavern_change: TavernChange,
    state_patch_proposals: Vec<Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct NpcUpdate {
    npc_id: String,
    current_mood: String,
    relationship_patch: RelationshipPatch,
}
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RelationshipPatch {
    trust: Option<i64>,
    closeness: Option<i64>,
    awe: Option<i64>,
    obligation: Option<i64>,
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct TavernChange {
    kind: String,
    description: String,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct WorldEventOutput {
    title: String,
    description: String,
    new_facts: Vec<String>,
    clock_advances: Vec<ClockAdvance>,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ClockAdvance {
    clock_id: String,
    amount: i64,
    reason: String,
}

impl CampaignStore {
    pub fn list_adventure_archives(
        &self,
        campaign_id: &str,
    ) -> Result<Vec<AdventureArchiveView>, CampaignStoreError> {
        validate_id(campaign_id)?;
        let connection = self.connect()?;
        let exists = connection
            .query_row("SELECT 1 FROM campaigns WHERE id=?1", [campaign_id], |_| {
                Ok(())
            })
            .optional()?;
        if exists.is_none() {
            return Err(CampaignStoreError::NotFound);
        }
        let mut statement = connection.prepare("SELECT id FROM adventures WHERE campaign_id=?1 AND state='SETTLED' ORDER BY updated_at DESC, id")?;
        let ids = statement
            .query_map([campaign_id], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        ids.iter()
            .map(|id| load_archive(&connection, campaign_id, id))
            .collect()
    }

    pub fn commit_adventure_settlement(
        &self,
        command: AdventureSettlementCommit,
    ) -> Result<AdventureArchiveView, CampaignStoreError> {
        validate_id(&command.campaign_id)?;
        validate_id(&command.adventure_id)?;
        if command.outcome != "SUCCESS" {
            return Err(CampaignStoreError::InvalidData);
        }
        let summary: SummaryOutput =
            serde_json::from_value(command.summary.validated_output.clone())
                .map_err(|_| CampaignStoreError::InvalidData)?;
        let world: WorldEventOutput =
            serde_json::from_value(command.world_event.validated_output.clone())
                .map_err(|_| CampaignStoreError::InvalidData)?;
        validate_audit(&command.summary, "SUMMARIZE_ADVENTURE")?;
        validate_audit(&command.world_event, "GENERATE_WORLD_EVENT")?;
        if command
            .summary
            .context
            .get("adventureId")
            .and_then(Value::as_str)
            != Some(command.adventure_id.as_str())
            || command
                .world_event
                .context
                .get("adventureId")
                .and_then(Value::as_str)
                != Some(command.adventure_id.as_str())
        {
            return Err(CampaignStoreError::InvalidData);
        }
        validate_text(&summary.summary)?;
        validate_text(&world.title)?;
        validate_text(&world.description)?;
        validate_world_event(&world)?;
        let mut connection = self.connect()?;
        let tx = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        if let Some(state) = tx
            .query_row(
                "SELECT state FROM adventures WHERE id=?1 AND campaign_id=?2",
                params![command.adventure_id, command.campaign_id],
                |r| r.get::<_, String>(0),
            )
            .optional()?
        {
            if state == "SETTLED" {
                return load_archive(&tx, &command.campaign_id, &command.adventure_id);
            }
            if state != "ENDING" {
                return Err(CampaignStoreError::InvalidState);
            }
        } else {
            return Err(CampaignStoreError::NotFound);
        }
        let at = current_timestamp()?;
        let (quest_id, publisher_id, reward_tier): (String, String, String) = tx.query_row("SELECT q.id,q.publisher_npc_id,q.reward_tier FROM quests q JOIN adventures a ON a.quest_id=q.id WHERE a.id=?1 AND q.campaign_id=?2 AND q.status='ACTIVE'", params![command.adventure_id, command.campaign_id], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?))).map_err(|_| CampaignStoreError::InvalidState)?;
        let character_id: String = tx.query_row(
            "SELECT id FROM player_characters WHERE campaign_id=?1",
            [&command.campaign_id],
            |r| r.get(0),
        )?;
        let tavern_id: String = tx.query_row(
            "SELECT tavern_id FROM npcs WHERE id=?1 AND campaign_id=?2",
            params![publisher_id, command.campaign_id],
            |r| r.get(0),
        )?;
        validate_summary(&summary, &publisher_id)?;
        for update in &summary.npc_updates {
            let changed = tx.execute(
                "UPDATE npcs SET current_mood=?1,updated_at=?2 WHERE id=?3 AND campaign_id=?4",
                params![update.current_mood, at, publisher_id, command.campaign_id],
            )?;
            if changed != 1 {
                return Err(CampaignStoreError::InvalidData);
            }
            let p = &update.relationship_patch;
            tx.execute("UPDATE npc_relationships SET trust=MIN(5,MAX(-5,trust+?1)),closeness=MIN(5,MAX(-5,closeness+?2)),awe=MIN(5,MAX(-5,awe+?3)),obligation=MIN(5,MAX(-5,obligation+?4)),updated_at=?5 WHERE npc_id=?6 AND player_character_id=?7",params![p.trust.unwrap_or(0),p.closeness.unwrap_or(0),p.awe.unwrap_or(0),p.obligation.unwrap_or(0),at,publisher_id,character_id])?;
            insert_event(
                &tx,
                &command.campaign_id,
                &format!("settlement-event:{}:relationship", command.adventure_id),
                "RELATIONSHIP_CHANGED",
                json!({"npcId":publisher_id}),
                &at,
            )?;
        }
        let change_id = format!("tavern-change:{}", command.adventure_id);
        let change = json!({"id":change_id,"kind":summary.tavern_change.kind,"description":summary.tavern_change.description,"sourceAdventureId":command.adventure_id,"occurredAt":at});
        let mut changes: Vec<Value> = serde_json::from_str(&tx.query_row(
            "SELECT changes_json FROM taverns WHERE id=?1",
            [&tavern_id],
            |r| r.get::<_, String>(0),
        )?)
        .map_err(|_| CampaignStoreError::InvalidData)?;
        changes.push(change.clone());
        tx.execute(
            "UPDATE taverns SET changes_json=?1,updated_at=?2 WHERE id=?3",
            params![
                serde_json::to_string(&changes).map_err(|_| CampaignStoreError::InvalidData)?,
                at,
                tavern_id
            ],
        )?;
        tx.execute(
            "UPDATE quests SET status='COMPLETED',updated_at=?1 WHERE id=?2",
            params![at, quest_id],
        )?;
        let reward = reward_from(&summary.state_patch_proposals)?;
        let mut item_ids = Vec::new();
        if let Some((name, description, tier)) = reward {
            if tier != reward_tier {
                return Err(CampaignStoreError::InvalidData);
            }
            let id = format!("reward:{}", command.adventure_id);
            tx.execute("INSERT INTO items(id,campaign_id,owner_character_id,source_adventure_id,content_json,reward_tier,effect_json,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)",params![id,command.campaign_id,character_id,command.adventure_id,json!({"name":name,"description":description}).to_string(),tier,json!({"kind":"CHECK_MODIFIER","attribute":"knowledge","modifier":1}).to_string(),at])?;
            item_ids.push(id);
            insert_event(
                &tx,
                &command.campaign_id,
                &format!("settlement-event:{}:item", command.adventure_id),
                "ITEM_ACQUIRED",
                json!({"itemId":item_ids[0],"adventureId":command.adventure_id}),
                &at,
            )?;
        }
        let mut fact_ids = Vec::new();
        for (i, fact) in world.new_facts.iter().enumerate() {
            validate_text(fact)?;
            let id = format!("settlement-fact:{}:{i}", command.adventure_id);
            tx.execute("INSERT INTO world_facts(id,campaign_id,kind,statement,location_id,faction_ids_json,detail_json,supersedes_fact_id,created_at) VALUES(?1,?2,'DEVELOPING_FACT',?3,NULL,'[]','{}',NULL,?4)",params![id,command.campaign_id,fact,at])?;
            fact_ids.push(id);
        }
        for advance in &world.clock_advances {
            if advance.amount != 1 {
                return Err(CampaignStoreError::InvalidData);
            }
            validate_text(&advance.reason)?;
            let changed=tx.execute("UPDATE world_clocks SET current=current+1,updated_at=?1 WHERE id=?2 AND campaign_id=?3 AND current<max",params![at,advance.clock_id,command.campaign_id])?;
            if changed != 1 {
                return Err(CampaignStoreError::InvalidData);
            }
            insert_event(
                &tx,
                &command.campaign_id,
                &format!(
                    "settlement-event:{}:clock:{}",
                    command.adventure_id, advance.clock_id
                ),
                "WORLD_CLOCK_ADVANCED",
                json!({"clockId":advance.clock_id,"amount":1}),
                &at,
            )?;
        }
        insert_generation(
            &tx,
            &command.campaign_id,
            "SUMMARIZE_ADVENTURE",
            &command.summary,
            &at,
        )?;
        insert_generation(
            &tx,
            &command.campaign_id,
            "GENERATE_WORLD_EVENT",
            &command.world_event,
            &at,
        )?;
        let clues: Vec<Value> = serde_json::from_str(&tx.query_row(
            "SELECT clues_json FROM adventures WHERE id=?1",
            [&command.adventure_id],
            |r| r.get::<_, String>(0),
        )?)
        .map_err(|_| CampaignStoreError::InvalidData)?;
        let unresolved_clue_ids = clues
            .iter()
            .filter(|c| c.get("discoveredInTurnId").is_some_and(Value::is_null))
            .filter_map(|c| c.get("id").and_then(Value::as_str))
            .collect::<Vec<_>>();
        let ending = json!({"adventureId":command.adventure_id,"outcome":command.outcome,"summary":summary.summary,"keyDecisions":summary.key_decisions,"unresolvedThreads":summary.unresolved_threads,"nextDirections":summary.next_directions,"unresolvedClueIds":unresolved_clue_ids,"participantNpcIds":[publisher_id],"acquiredItemIds":item_ids,"worldFactIds":fact_ids,"tavernChangeId":change_id,"summaryGenerationRecordId":command.summary.generation_record_id,"worldEventGenerationRecordId":command.world_event.generation_record_id,"completedAt":at});
        tx.execute("UPDATE adventures SET state='SETTLED',ending_json=?1,updated_at=?2 WHERE id=?3 AND state='ENDING'",params![ending.to_string(),at,command.adventure_id])?;
        tx.execute("UPDATE campaigns SET state='TAVERN',resume_state=NULL,updated_at=?1 WHERE id=?2 AND state='ADVENTURE'",params![at,command.campaign_id])?;
        insert_event(
            &tx,
            &command.campaign_id,
            &format!("settlement-event:{}:completed", command.adventure_id),
            "ADVENTURE_COMPLETED",
            json!({"adventureId":command.adventure_id,"outcome":"SUCCESS"}),
            &at,
        )?;
        tx.commit()?;
        load_archive(&connection, &command.campaign_id, &command.adventure_id)
    }
}

fn validate_audit(a: &TavernGenerationAudit, task: &str) -> Result<(), CampaignStoreError> {
    validate_id(&a.request_id)?;
    validate_id(&a.generation_record_id)?;
    validate_id(&a.idempotency_key)?;
    let raw: Value =
        serde_json::from_str(&a.raw_response_text).map_err(|_| CampaignStoreError::InvalidData)?;
    if a.prompt_version < 1
        || !a.input.is_object()
        || a.context
            .get("adventureId")
            .and_then(Value::as_str)
            .is_none()
        || a.request.get("task").and_then(Value::as_str) != Some(task)
        || raw != a.validated_output
    {
        return Err(CampaignStoreError::InvalidData);
    }
    Ok(())
}
fn validate_text(s: &str) -> Result<(), CampaignStoreError> {
    if s.trim() != s || s.is_empty() || s.len() > 4000 {
        Err(CampaignStoreError::InvalidData)
    } else {
        Ok(())
    }
}
fn validate_summary(s: &SummaryOutput, npc: &str) -> Result<(), CampaignStoreError> {
    if s.npc_updates.len() != 1
        || s.npc_updates[0].npc_id != npc
        || s.key_decisions.len() > 20
        || s.unresolved_threads.len() > 20
        || s.next_directions.len() > 10
    {
        return Err(CampaignStoreError::InvalidData);
    };
    s.key_decisions
        .iter()
        .chain(&s.unresolved_threads)
        .chain(&s.next_directions)
        .try_for_each(|text| validate_text(text))?;
    validate_text(&s.npc_updates[0].current_mood)?;
    validate_text(&s.tavern_change.description)?;
    let patch = &s.npc_updates[0].relationship_patch;
    let deltas = [patch.trust, patch.closeness, patch.awe, patch.obligation];
    if deltas.iter().all(Option::is_none)
        || deltas
            .into_iter()
            .flatten()
            .any(|value| !(-1..=1).contains(&value))
    {
        return Err(CampaignStoreError::InvalidData);
    }
    let quest_ok = s.state_patch_proposals.iter().any(|p| {
        p.get("kind").and_then(Value::as_str) == Some("QUEST")
            && p.pointer("/payload/status").and_then(Value::as_str) == Some("COMPLETED")
    });
    if !quest_ok {
        return Err(CampaignStoreError::InvalidData);
    };
    let relationship_ok = s.state_patch_proposals.iter().any(|p| {
        p.get("kind").and_then(Value::as_str) == Some("RELATIONSHIP")
            && p.get("targetId").and_then(Value::as_str) == Some(npc)
    });
    if !relationship_ok
        || !["TROPHY", "MENU", "DAMAGE", "DECORATION", "LAYOUT", "OTHER"]
            .contains(&s.tavern_change.kind.as_str())
    {
        return Err(CampaignStoreError::InvalidData);
    }
    Ok(())
}
fn validate_world_event(world: &WorldEventOutput) -> Result<(), CampaignStoreError> {
    if world.new_facts.len() > 10 || world.clock_advances.len() > 10 {
        return Err(CampaignStoreError::InvalidData);
    }
    let mut ids = HashSet::new();
    for advance in &world.clock_advances {
        if !ids.insert(&advance.clock_id) {
            return Err(CampaignStoreError::InvalidData);
        }
    }
    Ok(())
}
fn reward_from(p: &[Value]) -> Result<Option<(String, String, String)>, CampaignStoreError> {
    let Some(v) = p
        .iter()
        .find(|v| v.get("kind").and_then(Value::as_str) == Some("ITEM_REWARD"))
    else {
        return Ok(None);
    };
    let get = |k: &str| {
        v.pointer(&format!("/payload/{k}"))
            .and_then(Value::as_str)
            .map(str::to_owned)
            .ok_or(CampaignStoreError::InvalidData)
    };
    Ok(Some((
        get("name")?,
        get("description")?,
        get("rewardTier")?,
    )))
}
fn insert_generation(
    tx: &rusqlite::Transaction<'_>,
    campaign: &str,
    task: &str,
    a: &TavernGenerationAudit,
    at: &str,
) -> Result<(), CampaignStoreError> {
    tx.execute("INSERT INTO pending_ai_requests(id,campaign_id,turn_id,idempotency_key,task,status,model_profile_id,input_json,context_json,attempt_count,last_error_json,created_at,updated_at) VALUES(?1,?2,NULL,?3,?4,'COMMITTED',NULL,?5,?6,1,NULL,?7,?7)",params![a.request_id,campaign,a.idempotency_key,task,a.input.to_string(),a.context.to_string(),at])?;
    tx.execute("INSERT INTO generation_records(id,campaign_id,request_id,task,model_profile_id,prompt_version,request_json,raw_response_text,validated_output_json,validation_error_json,started_at,completed_at) VALUES(?1,?2,?3,?4,NULL,?5,?6,?7,?8,NULL,?9,?9)",params![a.generation_record_id,campaign,a.request_id,task,a.prompt_version,a.request.to_string(),a.raw_response_text,a.validated_output.to_string(),at])?;
    Ok(())
}
fn insert_event(
    tx: &rusqlite::Transaction<'_>,
    campaign: &str,
    id: &str,
    kind: &str,
    payload: Value,
    at: &str,
) -> Result<(), CampaignStoreError> {
    tx.execute("INSERT INTO game_events(id,campaign_id,schema_version,type,payload_json,occurred_at) VALUES(?1,?2,1,?3,?4,?5)",params![id,campaign,kind,payload.to_string(),at])?;
    Ok(())
}
fn load_archive(
    c: &rusqlite::Connection,
    campaign: &str,
    id: &str,
) -> Result<AdventureArchiveView, CampaignStoreError> {
    let (content,ending):(String,String)=c.query_row("SELECT q.content_json,a.ending_json FROM adventures a JOIN quests q ON q.id=a.quest_id WHERE a.id=?1 AND a.campaign_id=?2 AND a.state='SETTLED'",params![id,campaign],|r|Ok((r.get(0)?,r.get(1)?))).map_err(|_|CampaignStoreError::NotFound)?;
    let q: Value = serde_json::from_str(&content).map_err(|_| CampaignStoreError::InvalidData)?;
    let e: Value = serde_json::from_str(&ending).map_err(|_| CampaignStoreError::InvalidData)?;
    let strings = |k: &str| {
        e.get(k)
            .and_then(Value::as_array)
            .ok_or(CampaignStoreError::InvalidData)?
            .iter()
            .map(|v| {
                v.as_str()
                    .map(str::to_owned)
                    .ok_or(CampaignStoreError::InvalidData)
            })
            .collect::<Result<Vec<_>, CampaignStoreError>>()
    };
    let change_id = e
        .get("tavernChangeId")
        .and_then(Value::as_str)
        .ok_or(CampaignStoreError::InvalidData)?;
    let changes: String = c.query_row(
        "SELECT changes_json FROM taverns WHERE campaign_id=?1",
        [campaign],
        |r| r.get(0),
    )?;
    let change = serde_json::from_str::<Vec<Value>>(&changes)
        .map_err(|_| CampaignStoreError::InvalidData)?
        .into_iter()
        .find(|v| v.get("id").and_then(Value::as_str) == Some(change_id))
        .ok_or(CampaignStoreError::InvalidData)?;
    let items = load_json_rows(
        c,
        "SELECT content_json FROM items WHERE source_adventure_id=?1",
        id,
    )?;
    let facts = load_json_rows(
        c,
        "SELECT json_object('statement',statement,'kind',kind) FROM world_facts WHERE id IN (SELECT value FROM json_each(?1))",
        &e.get("worldFactIds")
            .ok_or(CampaignStoreError::InvalidData)?
            .to_string(),
    )?;
    let dice_results = load_json_rows(
        c,
        "SELECT dice_result_json FROM adventure_turns WHERE adventure_id=?1 AND dice_result_json IS NOT NULL ORDER BY turn_number",
        id,
    )?;
    let participant_npcs = load_named_npcs(
        c,
        e.get("participantNpcIds")
            .ok_or(CampaignStoreError::InvalidData)?,
    )?;
    let clues_json: String =
        c.query_row("SELECT clues_json FROM adventures WHERE id=?1", [id], |r| {
            r.get(0)
        })?;
    let all_clues: Vec<Value> =
        serde_json::from_str(&clues_json).map_err(|_| CampaignStoreError::InvalidData)?;
    let unresolved_ids = e
        .get("unresolvedClueIds")
        .and_then(Value::as_array)
        .ok_or(CampaignStoreError::InvalidData)?
        .iter()
        .filter_map(Value::as_str)
        .collect::<HashSet<_>>();
    let unresolved_clues = all_clues
        .into_iter()
        .filter(|clue| {
            clue.get("id")
                .and_then(Value::as_str)
                .is_some_and(|id| unresolved_ids.contains(id))
        })
        .collect();
    let generation_uses = load_generation_uses(c, &e)?;
    Ok(AdventureArchiveView {
        campaign_id: campaign.to_owned(),
        adventure_id: id.to_owned(),
        title: q
            .get("title")
            .and_then(Value::as_str)
            .ok_or(CampaignStoreError::InvalidData)?
            .to_owned(),
        outcome: e
            .get("outcome")
            .and_then(Value::as_str)
            .ok_or(CampaignStoreError::InvalidData)?
            .to_owned(),
        summary: e
            .get("summary")
            .and_then(Value::as_str)
            .ok_or(CampaignStoreError::InvalidData)?
            .to_owned(),
        key_decisions: strings("keyDecisions")?,
        unresolved_threads: strings("unresolvedThreads")?,
        next_directions: strings("nextDirections")?,
        dice_results,
        participant_npcs,
        unresolved_clues,
        tavern_change: change,
        acquired_items: items,
        world_facts: facts,
        generation_uses,
        completed_at: e
            .get("completedAt")
            .and_then(Value::as_str)
            .ok_or(CampaignStoreError::InvalidData)?
            .to_owned(),
    })
}
fn load_named_npcs(
    c: &rusqlite::Connection,
    ids: &Value,
) -> Result<Vec<Value>, CampaignStoreError> {
    let ids = ids.as_array().ok_or(CampaignStoreError::InvalidData)?;
    let mut result = Vec::new();
    for id in ids
        .iter()
        .map(|v| v.as_str().ok_or(CampaignStoreError::InvalidData))
    {
        let id = id?;
        result.push(
            c.query_row(
                "SELECT json_object('id',id,'name',name) FROM npcs WHERE id=?1",
                [id],
                |r| r.get::<_, String>(0),
            )
            .optional()?
            .map(|raw| serde_json::from_str(&raw).map_err(|_| CampaignStoreError::InvalidData))
            .transpose()?
            .ok_or(CampaignStoreError::InvalidData)?,
        );
    }
    Ok(result)
}
fn load_generation_uses(
    c: &rusqlite::Connection,
    e: &Value,
) -> Result<Vec<Value>, CampaignStoreError> {
    let mut result = Vec::new();
    for key in ["summaryGenerationRecordId", "worldEventGenerationRecordId"] {
        let id = e
            .get(key)
            .and_then(Value::as_str)
            .ok_or(CampaignStoreError::InvalidData)?;
        let (task, prompt, request): (String, i64, String) = c.query_row(
            "SELECT task,prompt_version,request_json FROM generation_records WHERE id=?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )?;
        let request: Value =
            serde_json::from_str(&request).map_err(|_| CampaignStoreError::InvalidData)?;
        let model = request
            .get("modelName")
            .and_then(Value::as_str)
            .ok_or(CampaignStoreError::InvalidData)?;
        result.push(json!({"task":task,"modelName":model,"promptVersion":prompt}));
    }
    Ok(result)
}
fn load_json_rows(
    c: &rusqlite::Connection,
    sql: &str,
    arg: &str,
) -> Result<Vec<Value>, CampaignStoreError> {
    let mut s = c.prepare(sql)?;
    s.query_map([arg], |r| r.get::<_, String>(0))?
        .map(|x| serde_json::from_str(&x?).map_err(|_| rusqlite::Error::InvalidQuery))
        .collect::<Result<Vec<_>, _>>()
        .map_err(Into::into)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn settlement_is_atomic_persistent_and_idempotent() {
        let dir = tempdir().expect("temp directory");
        let store = CampaignStore::open(dir.path().join("settlement.sqlite")).expect("store");
        let connection = store.connect().expect("connection");
        connection.execute_batch("BEGIN;
          INSERT INTO campaigns(id,schema_version,state,resume_state,created_at,updated_at) VALUES('campaign',1,'ADVENTURE',NULL,'2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z');
          INSERT INTO player_characters VALUES('character','campaign','Mira',NULL,NULL,'Scout','[]','{}','SCHOLAR','Scholar','{\"physique\":0,\"agility\":0,\"knowledge\":1,\"charisma\":0}','[]','Learn','{}','[]','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z');
          INSERT INTO taverns VALUES('tavern','campaign','harbor','Hearth','Road','Warm','[]','Storm','owner','[]','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z');
          INSERT INTO npcs VALUES('owner','campaign','tavern','OWNER','Ilyra','Keeper','Tall','Steady','Help','None','Quiet','Worried','ACTIVE',NULL,'[]','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z');
          INSERT INTO npc_relationships VALUES('owner','character',0,0,0,0,'2026-01-01T00:00:00.000Z');
          INSERT INTO quests VALUES('quest','campaign','owner','{\"title\":\"Beacon\",\"summary\":\"Save it\",\"objective\":\"Light it\",\"failureCost\":\"Darkness\"}','ACTIVE','MODERATE','[]',8,12,'NOTABLE','[]','[]','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z');
          INSERT INTO adventures VALUES('adventure','campaign','quest','ENDING','{}',8,'[]',NULL,'2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z');
          INSERT INTO world_clocks VALUES('clock','campaign','Storm',0,4,'[]','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z'); COMMIT;").expect("seed");
        drop(connection);
        let mut invalid = command();
        invalid.world_event.validated_output["clockAdvances"][0]["clockId"] = json!("missing");
        assert!(store.commit_adventure_settlement(invalid).is_err());
        let connection = store.connect().expect("after failed settlement");
        assert_eq!(
            connection
                .query_row(
                    "SELECT state FROM adventures WHERE id='adventure'",
                    [],
                    |r| r.get::<_, String>(0)
                )
                .expect("adventure state"),
            "ENDING"
        );
        assert_eq!(
            connection
                .query_row("SELECT COUNT(*) FROM items", [], |r| r.get::<_, i64>(0))
                .expect("item count"),
            0
        );
        drop(connection);
        let settlement = command();
        let archive = store
            .commit_adventure_settlement(settlement)
            .expect("settle");
        assert_eq!(archive.outcome, "SUCCESS");
        assert_eq!(archive.acquired_items.len(), 1);
        assert_eq!(
            store
                .list_adventure_archives("campaign")
                .expect("archives")
                .len(),
            1
        );
        let replay = store
            .commit_adventure_settlement(command())
            .expect("replay");
        assert_eq!(replay.adventure_id, archive.adventure_id);
        let connection = store.connect().expect("reopen");
        assert_eq!(
            connection
                .query_row("SELECT state FROM campaigns WHERE id='campaign'", [], |r| r
                    .get::<_, String>(0))
                .expect("state"),
            "TAVERN"
        );
        assert_eq!(
            connection
                .query_row("SELECT COUNT(*) FROM items", [], |r| r.get::<_, i64>(0))
                .expect("items"),
            1
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT current FROM world_clocks WHERE id='clock'",
                    [],
                    |r| r.get::<_, i64>(0)
                )
                .expect("clock"),
            1
        );
    }

    fn command() -> AdventureSettlementCommit {
        AdventureSettlementCommit {
            campaign_id: "campaign".into(),
            adventure_id: "adventure".into(),
            outcome: "SUCCESS".into(),
            summary: audit(
                "summary-request",
                "summary-generation",
                "summary-key",
                "SUMMARIZE_ADVENTURE",
                json!({"summary":"The beacon burns.","keyDecisions":["Stayed"],"unresolvedThreads":[],"nextDirections":["Rest"],"npcUpdates":[{"npcId":"owner","currentMood":"Relieved","relationshipPatch":{"trust":1}}],"tavernChange":{"kind":"TROPHY","description":"A lens hangs above the hearth."},"statePatchProposals":[{"kind":"QUEST","targetId":"model-symbol","rationale":"Done","payload":{"status":"COMPLETED"}},{"kind":"RELATIONSHIP","targetId":"owner","rationale":"Trusted","payload":{"trust":1}},{"kind":"ITEM_REWARD","targetId":null,"rationale":"Reward","payload":{"questId":"model-symbol","name":"Compass","description":"Stormglass","rewardTier":"NOTABLE"}}]}),
            ),
            world_event: audit(
                "world-request",
                "world-generation",
                "world-key",
                "GENERATE_WORLD_EVENT",
                json!({"title":"Storm tide","description":"Road floods","newFacts":["The road is flooded."],"clockAdvances":[{"clockId":"clock","amount":1,"reason":"Storm"}]}),
            ),
        }
    }
    fn audit(
        request: &str,
        generation: &str,
        key: &str,
        task: &str,
        output: Value,
    ) -> TavernGenerationAudit {
        TavernGenerationAudit {
            request_id: request.into(),
            generation_record_id: generation.into(),
            idempotency_key: key.into(),
            prompt_version: 2,
            input: json!({}),
            context: json!({"adventureId":"adventure"}),
            request: json!({"task":task,"modelName":"ember-fake-v1"}),
            raw_response_text: output.to_string(),
            validated_output: output,
        }
    }
}

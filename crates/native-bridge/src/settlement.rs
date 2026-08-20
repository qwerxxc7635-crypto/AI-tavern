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
    pub equipment: TavernGenerationAudit,
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct EquipmentOutput {
    schema_version: i64,
    items: Vec<EquipmentCandidate>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct EquipmentCandidate {
    id: String,
    name: String,
    description: String,
    category: String,
    appearance: String,
    history: String,
    origin: String,
    narrative_abilities: Vec<String>,
    semantic_effects: Vec<String>,
    balance_tags: Vec<String>,
    bindings: Vec<EquipmentBinding>,
    constitution_evidence: EquipmentEvidence,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct EquipmentBinding {
    kind: String,
    target_id: String,
    trigger: String,
    summary: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct EquipmentEvidence {
    equipment_rules: String,
    technology: String,
    economy: String,
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
        let equipment: EquipmentOutput =
            serde_json::from_value(command.equipment.validated_output.clone())
                .map_err(|_| CampaignStoreError::InvalidData)?;
        validate_audit(&command.summary, "SUMMARIZE_ADVENTURE")?;
        validate_audit(&command.world_event, "GENERATE_WORLD_EVENT")?;
        validate_audit(&command.equipment, "GENERATE_ITEMS")?;
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
            || command
                .equipment
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
        let (quest_id, publisher_id, risk, reward_tier, recommended_attributes, related_npcs): (String, String, String, String, String, String) = tx.query_row("SELECT q.id,q.publisher_npc_id,q.risk,q.reward_tier,q.recommended_attributes_json,q.related_npc_ids_json FROM quests q JOIN adventures a ON a.quest_id=q.id WHERE a.id=?1 AND q.campaign_id=?2 AND q.status='ACTIVE'", params![command.adventure_id, command.campaign_id], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?))).map_err(|_| CampaignStoreError::InvalidState)?;
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
        if let Some(tier) = reward {
            if tier != reward_tier {
                return Err(CampaignStoreError::InvalidData);
            }
            let fact_ids = world
                .new_facts
                .iter()
                .enumerate()
                .map(|(index, _)| format!("settlement-fact:{}:{index}", command.adventure_id))
                .collect::<Vec<_>>();
            let related_npcs: Vec<String> =
                serde_json::from_str(&related_npcs).map_err(|_| CampaignStoreError::InvalidData)?;
            let primary_attribute = serde_json::from_str::<Vec<String>>(&recommended_attributes)
                .map_err(|_| CampaignStoreError::InvalidData)?
                .into_iter()
                .next()
                .unwrap_or_else(|| "knowledge".to_owned());
            let stored = build_semantic_equipment(
                &tx,
                &command,
                equipment,
                &quest_id,
                &publisher_id,
                &related_npcs,
                &fact_ids,
                &risk,
                &reward_tier,
                &primary_attribute,
                &at,
            )?;
            tx.execute("INSERT INTO items(id,campaign_id,owner_character_id,source_adventure_id,content_json,reward_tier,effect_json,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)",params![stored.id,command.campaign_id,character_id,command.adventure_id,stored.content.to_string(),reward_tier,stored.effect.to_string(),at])?;
            item_ids.push(stored.id);
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
            "GENERATE_ITEMS",
            &command.equipment,
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
        let ending = json!({"adventureId":command.adventure_id,"outcome":command.outcome,"summary":summary.summary,"keyDecisions":summary.key_decisions,"unresolvedThreads":summary.unresolved_threads,"nextDirections":summary.next_directions,"unresolvedClueIds":unresolved_clue_ids,"participantNpcIds":[publisher_id],"acquiredItemIds":item_ids,"worldFactIds":fact_ids,"tavernChangeId":change_id,"summaryGenerationRecordId":command.summary.generation_record_id,"worldEventGenerationRecordId":command.world_event.generation_record_id,"equipmentGenerationRecordId":command.equipment.generation_record_id,"completedAt":at});
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
fn reward_from(p: &[Value]) -> Result<Option<String>, CampaignStoreError> {
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
    get("name")?;
    get("description")?;
    get("questId")?;
    Ok(Some(get("rewardTier")?))
}

struct StoredSemanticEquipment {
    id: String,
    content: Value,
    effect: Value,
}

#[allow(clippy::too_many_arguments)]
fn build_semantic_equipment(
    tx: &rusqlite::Transaction<'_>,
    command: &AdventureSettlementCommit,
    output: EquipmentOutput,
    quest_id: &str,
    publisher_id: &str,
    related_npcs: &[String],
    fact_ids: &[String],
    risk: &str,
    rarity: &str,
    primary_attribute: &str,
    at: &str,
) -> Result<StoredSemanticEquipment, CampaignStoreError> {
    if output.schema_version != 1 || output.items.len() != 1 {
        return Err(CampaignStoreError::InvalidData);
    }
    let input = command
        .equipment
        .input
        .as_object()
        .ok_or(CampaignStoreError::InvalidData)?;
    let source = input
        .get("source")
        .and_then(Value::as_object)
        .ok_or(CampaignStoreError::InvalidData)?;
    if input.get("schemaVersion").and_then(Value::as_i64) != Some(1)
        || input.get("requestedCount").and_then(Value::as_i64) != Some(1)
        || input.get("requestedRarity").and_then(Value::as_str) != Some(rarity)
        || source.get("kind").and_then(Value::as_str) != Some("QUEST_REWARD")
        || source.get("questId").and_then(Value::as_str) != Some(quest_id)
        || source.get("adventureId").and_then(Value::as_str) != Some(command.adventure_id.as_str())
    {
        return Err(CampaignStoreError::InvalidData);
    }
    let maximum = match risk {
        "LOW" => "BASIC",
        "MODERATE" => "NOTABLE",
        "HIGH" => "RARE",
        "EXTREME" => "LEGENDARY",
        _ => return Err(CampaignStoreError::InvalidData),
    };
    if rarity_rank(rarity)? > rarity_rank(maximum)? {
        return Err(CampaignStoreError::InvalidData);
    }
    let locked: Option<(i64, String, String, String)> = tx
        .query_row(
            "SELECT revision,equipment_rules,technology,economy FROM world_constitutions WHERE campaign_id=?1 AND status='LOCKED'",
            [&command.campaign_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .optional()?;
    let (revision, equipment_rules, technology, economy) = if let Some(locked) = locked {
        locked
    } else {
        let technology: String = tx
            .query_row(
                "SELECT technology_level FROM world_bibles WHERE campaign_id=?1",
                [&command.campaign_id],
                |row| row.get(0),
            )
            .map_err(|_| CampaignStoreError::InvalidData)?;
        (
            1,
            "Legacy portable archive: preserve existing item effects and validate new mechanics locally."
                .to_owned(),
            technology,
            "Legacy portable archive economy is unspecified.".to_owned(),
        )
    };
    let expected_evidence = json!({
        "equipmentRules": equipment_rules,
        "technology": technology,
        "economy": economy,
    });
    if input.get("constitutionEvidence") != Some(&expected_evidence)
        || input
            .get("context")
            .and_then(|value| value.get("worldId"))
            .and_then(Value::as_str)
            != Some(command.campaign_id.as_str())
        || input
            .get("context")
            .and_then(|value| value.get("constitutionRevision"))
            .and_then(Value::as_i64)
            != Some(revision)
    {
        return Err(CampaignStoreError::InvalidData);
    }
    let candidate = output
        .items
        .into_iter()
        .next()
        .ok_or(CampaignStoreError::InvalidData)?;
    validate_id(&candidate.id)?;
    for text in [
        &candidate.name,
        &candidate.description,
        &candidate.appearance,
        &candidate.history,
        &candidate.origin,
    ] {
        validate_text(text)?;
    }
    if ![
        "WEAPON",
        "ARMOR",
        "TOOL",
        "CONSUMABLE",
        "CLUE",
        "TREASURE",
        "OTHER",
    ]
    .contains(&candidate.category.as_str())
        || candidate.balance_tags.is_empty()
        || candidate.narrative_abilities.is_empty()
        || candidate.semantic_effects.is_empty()
        || candidate.narrative_abilities.len() > 24
        || candidate.semantic_effects.len() > 24
    {
        return Err(CampaignStoreError::InvalidData);
    }
    candidate
        .narrative_abilities
        .iter()
        .chain(&candidate.semantic_effects)
        .chain(&candidate.balance_tags)
        .try_for_each(|text| validate_text(text))?;
    if candidate
        .balance_tags
        .iter()
        .map(|tag| normalize_equipment_name(tag))
        .collect::<HashSet<_>>()
        .len()
        != candidate.balance_tags.len()
    {
        return Err(CampaignStoreError::InvalidData);
    }
    if candidate.constitution_evidence.equipment_rules != expected_evidence["equipmentRules"]
        || candidate.constitution_evidence.technology != expected_evidence["technology"]
        || candidate.constitution_evidence.economy != expected_evidence["economy"]
    {
        return Err(CampaignStoreError::InvalidData);
    }
    validate_equipment_bindings(
        input,
        &candidate.bindings,
        quest_id,
        publisher_id,
        related_npcs,
        fact_ids,
    )?;
    let mut statement = tx.prepare("SELECT id,content_json FROM items WHERE campaign_id=?1")?;
    let rows = statement.query_map([&command.campaign_id], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;
    let normalized_name = normalize_equipment_name(&candidate.name);
    for row in rows {
        let (id, raw) = row?;
        let content: Value =
            serde_json::from_str(&raw).map_err(|_| CampaignStoreError::InvalidData)?;
        if id == candidate.id
            || content
                .get("name")
                .and_then(Value::as_str)
                .is_some_and(|name| normalize_equipment_name(name) == normalized_name)
        {
            return Err(CampaignStoreError::InvalidData);
        }
    }
    let (price, damage, defense, effect, budget, cost) =
        equipment_mechanics(&candidate.category, rarity, primary_attribute)?;
    let rationale = std::iter::once(format!("rarity:{rarity}"))
        .chain(std::iter::once(format!("category:{}", candidate.category)))
        .chain(
            candidate
                .balance_tags
                .iter()
                .map(|tag| format!("semantic:{tag}")),
        )
        .collect::<Vec<_>>();
    let semantic = json!({
        "kind": "SEMANTIC_EQUIPMENT",
        "schemaVersion": 1,
        "id": candidate.id,
        "campaignId": command.campaign_id,
        "constitutionRevision": revision,
        "content": {
            "name": candidate.name,
            "description": candidate.description,
            "category": candidate.category,
            "appearance": candidate.appearance,
            "history": candidate.history,
            "origin": candidate.origin,
            "narrativeAbilities": candidate.narrative_abilities,
            "semanticEffects": candidate.semantic_effects,
        },
        "mechanics": {
            "rarity": rarity,
            "price": price,
            "damage": damage,
            "defense": defense,
            "numericEffect": effect,
            "balance": {
                "policyVersion": 1,
                "budget": budget,
                "cost": cost,
                "rationale": rationale,
            },
        },
        "bindings": candidate.bindings,
        "constitutionEvidence": expected_evidence,
        "source": {"kind":"QUEST_REWARD","questId":quest_id,"adventureId":command.adventure_id},
        "generationRecordId": command.equipment.generation_record_id,
        "createdAt": at,
    });
    Ok(StoredSemanticEquipment {
        id: candidate.id,
        content: json!({
            "name": semantic["content"]["name"],
            "description": semantic["content"]["description"],
            "semanticEquipment": semantic,
        }),
        effect,
    })
}

fn validate_equipment_bindings(
    input: &serde_json::Map<String, Value>,
    bindings: &[EquipmentBinding],
    quest_id: &str,
    publisher_id: &str,
    related_npcs: &[String],
    fact_ids: &[String],
) -> Result<(), CampaignStoreError> {
    let targets = input
        .get("bindingTargets")
        .and_then(Value::as_array)
        .ok_or(CampaignStoreError::InvalidData)?;
    let mut has_quest = false;
    let mut has_npc = false;
    let mut unique = HashSet::new();
    for binding in bindings {
        validate_text(&binding.summary)?;
        let declared = targets.iter().any(|target| {
            target.get("kind").and_then(Value::as_str) == Some(binding.kind.as_str())
                && target.get("targetId").and_then(Value::as_str)
                    == Some(binding.target_id.as_str())
                && target
                    .get("allowedTriggers")
                    .and_then(Value::as_array)
                    .is_some_and(|values| values.iter().any(|value| value == &binding.trigger))
        });
        let valid = match binding.kind.as_str() {
            "QUEST" => {
                has_quest = true;
                binding.target_id == quest_id && binding.trigger == "QUEST_CONTEXT"
            }
            "NPC" => {
                has_npc = true;
                (binding.target_id == publisher_id || related_npcs.contains(&binding.target_id))
                    && ["NPC_RECOGNITION", "RELATIONSHIP_HOOK"].contains(&binding.trigger.as_str())
            }
            "WORLD_FACT" => {
                fact_ids.contains(&binding.target_id) && binding.trigger == "FACT_EVIDENCE"
            }
            _ => false,
        };
        if !unique.insert(format!(
            "{}:{}:{}",
            binding.kind, binding.target_id, binding.trigger
        )) || !declared
            || !valid
        {
            return Err(CampaignStoreError::InvalidData);
        }
    }
    if !has_quest || !has_npc {
        return Err(CampaignStoreError::InvalidData);
    }
    Ok(())
}

fn equipment_mechanics(
    category: &str,
    rarity: &str,
    attribute: &str,
) -> Result<(i64, i64, i64, Value, i64, i64), CampaignStoreError> {
    if !["physique", "agility", "knowledge", "charisma"].contains(&attribute) {
        return Err(CampaignStoreError::InvalidData);
    }
    let rank = rarity_rank(rarity)?;
    let budget = [0, 2, 4, 7, 10][rank as usize];
    let base_price = [0, 25, 100, 500, 2500][rank as usize];
    let (factor, damage, defense, effect, cost) = match category {
        "WEAPON" => (3, rank, 0, json!({"kind":"NONE"}), rank),
        "ARMOR" => (4, 0, rank, json!({"kind":"NONE"}), rank),
        "TOOL" => {
            let modifier = (rank + 1) / 2;
            (
                2,
                0,
                0,
                json!({"kind":"CHECK_MODIFIER","attribute":attribute,"modifier":modifier}),
                modifier * 2,
            )
        }
        "CONSUMABLE" => (
            1,
            0,
            0,
            json!({"kind":"CONSUMABLE_RECOVERY","resource":"STRESS","amount":rank * 4,"uses":1}),
            rank,
        ),
        "CLUE" => (0, 0, 0, json!({"kind":"NONE"}), 0),
        "TREASURE" => (5, 0, 0, json!({"kind":"NONE"}), 0),
        "OTHER" => (1, 0, 0, json!({"kind":"NONE"}), 0),
        _ => return Err(CampaignStoreError::InvalidData),
    };
    if cost > budget {
        return Err(CampaignStoreError::InvalidData);
    }
    Ok((base_price * factor, damage, defense, effect, budget, cost))
}

fn rarity_rank(rarity: &str) -> Result<i64, CampaignStoreError> {
    match rarity {
        "BASIC" => Ok(1),
        "NOTABLE" => Ok(2),
        "RARE" => Ok(3),
        "LEGENDARY" => Ok(4),
        _ => Err(CampaignStoreError::InvalidData),
    }
}

fn normalize_equipment_name(value: &str) -> String {
    value
        .chars()
        .map(|character| match character as u32 {
            0x3000 => ' ',
            code @ 0xff01..=0xff5e => char::from_u32(code - 0xfee0).unwrap_or(character),
            _ => character,
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
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
    for key in [
        "summaryGenerationRecordId",
        "worldEventGenerationRecordId",
        "equipmentGenerationRecordId",
    ] {
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
          INSERT INTO world_constitutions VALUES('campaign',1,1,'LOCKED','Harbor','Late','Late medieval','Low','[]','Guilds','Councils','Fishing and coastal trade','Human','Ordinary','Guild work','Equipment follows local craft.','Grounded','Narrative','[]','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z');
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
        let (content, effect): (String, String) = connection
            .query_row("SELECT content_json,effect_json FROM items", [], |row| {
                Ok((row.get(0)?, row.get(1)?))
            })
            .expect("semantic item");
        let content: Value = serde_json::from_str(&content).expect("content JSON");
        let effect: Value = serde_json::from_str(&effect).expect("effect JSON");
        assert_eq!(content["semanticEquipment"]["mechanics"]["damage"], 0);
        assert_eq!(content["semanticEquipment"]["mechanics"]["price"], 200);
        assert_eq!(effect["kind"], "CHECK_MODIFIER");
        assert_eq!(effect["modifier"], 1);
        assert_eq!(archive.generation_uses.len(), 3);
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
                json!({"summary":"The beacon burns.","keyDecisions":["Stayed"],"unresolvedThreads":[],"nextDirections":["Rest"],"npcUpdates":[{"npcId":"owner","currentMood":"Relieved","relationshipPatch":{"trust":1}}],"tavernChange":{"kind":"TROPHY","description":"A lens hangs above the hearth."},"statePatchProposals":[{"kind":"QUEST","targetId":"quest","rationale":"Done","payload":{"status":"COMPLETED"}},{"kind":"RELATIONSHIP","targetId":"owner","rationale":"Trusted","payload":{"trust":1}},{"kind":"ITEM_REWARD","targetId":null,"rationale":"Reward","payload":{"questId":"quest","name":"Compass","description":"Stormglass","rewardTier":"NOTABLE"}}]}),
            ),
            world_event: audit(
                "world-request",
                "world-generation",
                "world-key",
                "GENERATE_WORLD_EVENT",
                json!({"title":"Storm tide","description":"Road floods","newFacts":["The road is flooded."],"clockAdvances":[{"clockId":"clock","amount":1,"reason":"Storm"}]}),
            ),
            equipment: equipment_audit(),
        }
    }
    fn equipment_audit() -> TavernGenerationAudit {
        let mut audit = audit(
            "equipment-request",
            "equipment-generation",
            "equipment-key",
            "GENERATE_ITEMS",
            json!({"schemaVersion":1,"items":[{
                "id":"item-stormglass-compass",
                "name":"Stormglass Compass",
                "description":"Stories claim +99 damage, but this prose has no rules authority.",
                "category":"TOOL",
                "appearance":"A clouded glass compass.",
                "history":"Carried by a lost route warden.",
                "origin":"The lantern guild workshop.",
                "narrativeAbilities":["Reveals faded route marks"],
                "semanticEffects":["Recognized by route wardens"],
                "balanceTags":["NON_COMBAT"],
                "bindings":[
                    {"kind":"QUEST","targetId":"quest","trigger":"QUEST_CONTEXT","summary":"Recovered during the beacon quest."},
                    {"kind":"NPC","targetId":"owner","trigger":"NPC_RECOGNITION","summary":"The owner recognizes the guild mark."},
                    {"kind":"WORLD_FACT","targetId":"settlement-fact:adventure:0","trigger":"FACT_EVIDENCE","summary":"The compass records the flooded road."}
                ],
                "constitutionEvidence":{"equipmentRules":"Equipment follows local craft.","technology":"Late medieval","economy":"Fishing and coastal trade"}
            }]}),
        );
        audit.input = json!({
            "schemaVersion":1,
            "context":{"worldId":"campaign","constitutionRevision":1,"contextSummary":"Harbor"},
            "purpose":"Quest reward",
            "requestedCount":1,
            "requestedRarity":"NOTABLE",
            "source":{"kind":"QUEST_REWARD","questId":"quest","adventureId":"adventure"},
            "bindingTargets":[
                {"kind":"QUEST","targetId":"quest","allowedTriggers":["QUEST_CONTEXT"],"summary":"Quest"},
                {"kind":"NPC","targetId":"owner","allowedTriggers":["NPC_RECOGNITION","RELATIONSHIP_HOOK"],"summary":"Owner"},
                {"kind":"WORLD_FACT","targetId":"settlement-fact:adventure:0","allowedTriggers":["FACT_EVIDENCE"],"summary":"Fact"}
            ],
            "constitutionEvidence":{"equipmentRules":"Equipment follows local craft.","technology":"Late medieval","economy":"Fishing and coastal trade"},
            "existingItemIds":[],
            "existingItemNames":[]
        });
        audit
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

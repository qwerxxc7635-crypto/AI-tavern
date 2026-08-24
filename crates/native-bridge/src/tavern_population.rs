use std::collections::{HashMap, HashSet};

use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

use crate::{
    ActiveFactionProfile, CampaignStore, CampaignStoreError, NpcLodConstitutionEvidence,
    NpcLodProfile, current_timestamp, validate_id,
};

const TRIGGERS: [&str; 5] = [
    "ENTERED",
    "TIME_ADVANCED",
    "EVENT_COMMITTED",
    "ADVENTURE_RETURNED",
    "MANUAL_REFRESH",
];

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TavernPopulationClockFactor {
    pub id: String,
    pub current: i64,
    pub max: i64,
    pub updated_at: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TavernPopulationFactionFactor {
    pub id: String,
    pub revision: i64,
    pub current_action: String,
    pub player_relation: String,
    pub territory_location_ids: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TavernPopulationContext {
    pub campaign_id: String,
    pub tavern_id: String,
    pub world_updated_at: String,
    pub current_location_id: String,
    pub location_revision: i64,
    pub clocks: Vec<TavernPopulationClockFactor>,
    pub active_factions: Vec<TavernPopulationFactionFactor>,
    pub recent_event_ids: Vec<String>,
    pub history_npc_ids: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TavernOpportunity {
    pub id: String,
    pub kind: String,
    pub source_id: String,
    pub title: String,
    pub detail: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TavernPopulationState {
    pub campaign_id: String,
    pub tavern_id: String,
    pub revision: i64,
    pub trigger: String,
    pub context: TavernPopulationContext,
    pub opportunities: Vec<TavernOpportunity>,
    pub empty_state: bool,
    pub projected_at: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TavernPopulationMember {
    pub npc_id: String,
    pub source_kind: String,
    pub source_id: String,
    pub population_role: String,
    pub presence: String,
    pub is_important: bool,
    pub first_seen_at: String,
    pub last_seen_at: String,
    pub encounter_count: i64,
    pub profile: NpcLodProfile,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TavernPopulationCycle {
    pub id: String,
    pub operation_id: String,
    pub campaign_id: String,
    pub tavern_id: String,
    pub trigger: String,
    pub before_revision: i64,
    pub after_revision: i64,
    pub context: TavernPopulationContext,
    pub present_npc_ids: Vec<String>,
    pub opportunity_ids: Vec<String>,
    pub occurred_at: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TavernPopulationFocusEvent {
    pub id: String,
    pub operation_id: String,
    pub campaign_id: String,
    pub tavern_id: String,
    pub npc_id: String,
    pub before_revision: i64,
    pub after_revision: i64,
    pub npc_lod: i64,
    pub occurred_at: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TavernPopulationSnapshot {
    pub state: Option<TavernPopulationState>,
    pub members: Vec<TavernPopulationMember>,
    pub cycles: Vec<TavernPopulationCycle>,
    pub focus_history: Vec<TavernPopulationFocusEvent>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TavernPopulationProjectCommand {
    pub campaign_id: String,
    pub trigger: String,
    pub operation_id: String,
    pub cycle_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TavernPopulationFocusCommand {
    pub campaign_id: String,
    pub npc_id: String,
    pub expected_revision: i64,
    pub operation_id: String,
    pub event_id: String,
}

#[derive(Clone)]
struct Factor {
    source_kind: String,
    source_id: String,
    population_role: String,
}

#[derive(Clone)]
struct Candidate {
    profile: NpcLodProfile,
    source_kind: String,
    source_id: String,
    population_role: String,
}

struct ProjectionFacts {
    context: TavernPopulationContext,
    factors: Vec<Factor>,
    opportunities: Vec<TavernOpportunity>,
    constitution_revision: i64,
    evidence: NpcLodConstitutionEvidence,
}

impl CampaignStore {
    pub fn tavern_population_snapshot(
        &self,
        campaign_id: &str,
    ) -> Result<TavernPopulationSnapshot, CampaignStoreError> {
        validate_id(campaign_id)?;
        load_snapshot(&self.connect()?, campaign_id)
    }

    pub fn project_tavern_population(
        &self,
        command: TavernPopulationProjectCommand,
    ) -> Result<TavernPopulationSnapshot, CampaignStoreError> {
        validate_project(&command)?;
        let mut connection = self.connect()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let replay = transaction
            .query_row(
                "SELECT campaign_id,trigger FROM tavern_population_cycles WHERE operation_id=?1",
                [&command.operation_id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .optional()?;
        if let Some((campaign_id, trigger)) = replay {
            if campaign_id != command.campaign_id || trigger != command.trigger {
                return Err(CampaignStoreError::InvalidData);
            }
            let saved = load_snapshot(&transaction, &command.campaign_id)?;
            transaction.commit()?;
            return Ok(saved);
        }
        let before = load_snapshot(&transaction, &command.campaign_id)?;
        let facts = projection_facts(&transaction, &command.campaign_id, &before.members)?;
        if before.state.as_ref().is_some_and(|state| {
            state.context == facts.context && state.opportunities == facts.opportunities
        }) {
            transaction.commit()?;
            return Ok(before);
        }
        let at = current_timestamp()?;
        let candidates = candidates(
            &transaction,
            &command.campaign_id,
            &before.members,
            &facts,
            &at,
        )?;
        let (state, members) = project(
            before.state.as_ref(),
            &before.members,
            facts,
            candidates,
            &command.trigger,
            &at,
        )?;
        write_projection(&transaction, &state, &members)?;
        let present_npc_ids = members
            .iter()
            .filter(|member| member.presence == "PRESENT")
            .map(|member| member.npc_id.clone())
            .collect::<Vec<_>>();
        let opportunity_ids = state
            .opportunities
            .iter()
            .map(|opportunity| opportunity.id.clone())
            .collect::<Vec<_>>();
        transaction.execute(
            "INSERT INTO tavern_population_cycles (id,operation_id,campaign_id,tavern_id,trigger,before_revision,after_revision,context_json,present_npc_ids_json,opportunity_ids_json,occurred_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
            params![command.cycle_id,command.operation_id,command.campaign_id,state.tavern_id,command.trigger,before.state.as_ref().map_or(0,|value|value.revision),state.revision,to_json(&state.context)?,to_json(&present_npc_ids)?,to_json(&opportunity_ids)?,at],
        )?;
        let saved = load_snapshot(&transaction, &command.campaign_id)?;
        transaction.commit()?;
        Ok(saved)
    }

    pub fn focus_tavern_population(
        &self,
        command: TavernPopulationFocusCommand,
    ) -> Result<TavernPopulationSnapshot, CampaignStoreError> {
        validate_id(&command.campaign_id)?;
        validate_id(&command.npc_id)?;
        validate_id(&command.operation_id)?;
        validate_id(&command.event_id)?;
        if command.expected_revision < 1 {
            return Err(CampaignStoreError::InvalidData);
        }
        let mut connection = self.connect()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let replay = transaction
            .query_row(
                "SELECT campaign_id,npc_id,before_revision FROM tavern_population_focus_events WHERE operation_id=?1",
                [&command.operation_id],
                |row| Ok((row.get::<_, String>(0)?,row.get::<_, String>(1)?,row.get::<_, i64>(2)?)),
            )
            .optional()?;
        if let Some((campaign_id, npc_id, before_revision)) = replay {
            if campaign_id != command.campaign_id
                || npc_id != command.npc_id
                || before_revision != command.expected_revision
            {
                return Err(CampaignStoreError::InvalidData);
            }
            let saved = load_snapshot(&transaction, &command.campaign_id)?;
            transaction.commit()?;
            return Ok(saved);
        }
        let before = load_snapshot(&transaction, &command.campaign_id)?;
        let state = before.state.ok_or(CampaignStoreError::InvalidState)?;
        if state.revision != command.expected_revision {
            return Err(CampaignStoreError::InvalidState);
        }
        let profile_json = transaction
            .query_row(
                "SELECT profile_json FROM npc_lod_profiles WHERE id=?1 AND campaign_id=?2",
                params![command.npc_id, command.campaign_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?
            .ok_or(CampaignStoreError::NotFound)?;
        let profile = parse_profile(&profile_json)?;
        let member = before
            .members
            .iter()
            .find(|member| member.npc_id == command.npc_id)
            .ok_or(CampaignStoreError::NotFound)?;
        if member.presence != "PRESENT"
            || profile.lod < 1
            || profile.identity_anchor != member.profile.identity_anchor
            || profile.population_role != member.population_role
            || profile.revision < member.profile.revision
        {
            return Err(CampaignStoreError::InvalidState);
        }
        let at = current_timestamp()?;
        let revision = state.revision + 1;
        let changed = transaction.execute(
            "UPDATE tavern_population_states SET revision=?1 WHERE tavern_id=?2 AND campaign_id=?3 AND revision=?4",
            params![revision,state.tavern_id,command.campaign_id,state.revision],
        )?;
        if changed != 1 {
            return Err(CampaignStoreError::InvalidState);
        }
        transaction.execute(
            "UPDATE tavern_population_members SET is_important=1,last_seen_at=?1,encounter_count=encounter_count+1 WHERE tavern_id=?2 AND campaign_id=?3 AND npc_id=?4 AND presence='PRESENT'",
            params![at,state.tavern_id,command.campaign_id,command.npc_id],
        )?;
        transaction.execute(
            "INSERT INTO tavern_population_focus_events (id,operation_id,campaign_id,tavern_id,npc_id,before_revision,after_revision,npc_lod,occurred_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
            params![command.event_id,command.operation_id,command.campaign_id,state.tavern_id,command.npc_id,state.revision,revision,profile.lod,at],
        )?;
        let saved = load_snapshot(&transaction, &command.campaign_id)?;
        transaction.commit()?;
        Ok(saved)
    }
}

fn validate_project(command: &TavernPopulationProjectCommand) -> Result<(), CampaignStoreError> {
    validate_id(&command.campaign_id)?;
    validate_id(&command.operation_id)?;
    validate_id(&command.cycle_id)?;
    if !TRIGGERS.contains(&command.trigger.as_str()) {
        return Err(CampaignStoreError::InvalidData);
    }
    Ok(())
}

fn load_snapshot(
    connection: &Connection,
    campaign_id: &str,
) -> Result<TavernPopulationSnapshot, CampaignStoreError> {
    let tavern_id = tavern_identity(connection, campaign_id)?.0;
    let state = connection
        .query_row(
            "SELECT revision,last_trigger,context_json,opportunities_json,empty_state,projected_at FROM tavern_population_states WHERE tavern_id=?1 AND campaign_id=?2",
            params![tavern_id,campaign_id],
            |row| Ok((row.get::<_,i64>(0)?,row.get::<_,String>(1)?,row.get::<_,String>(2)?,row.get::<_,String>(3)?,row.get::<_,i64>(4)?,row.get::<_,String>(5)?)),
        )
        .optional()?
        .map(|(revision,trigger,context,opportunities,empty_state,projected_at)| {
            Ok::<_, CampaignStoreError>(TavernPopulationState { campaign_id: campaign_id.to_owned(), tavern_id: tavern_id.clone(), revision, trigger, context: from_json(&context)?, opportunities: from_json(&opportunities)?, empty_state: empty_state == 1, projected_at })
        })
        .transpose()?;
    let mut member_statement = connection.prepare("SELECT member.npc_id,member.source_kind,member.source_id,member.population_role,member.presence,member.is_important,member.first_seen_at,member.last_seen_at,member.encounter_count,profile.profile_json FROM tavern_population_members member JOIN npc_lod_profiles profile ON profile.id=member.npc_id WHERE member.tavern_id=?1 AND member.campaign_id=?2 ORDER BY CASE member.presence WHEN 'PRESENT' THEN 0 ELSE 1 END,member.source_kind,member.npc_id")?;
    let members = member_statement
        .query_map(params![tavern_id, campaign_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, i64>(5)?,
                row.get::<_, String>(6)?,
                row.get::<_, String>(7)?,
                row.get::<_, i64>(8)?,
                row.get::<_, String>(9)?,
            ))
        })?
        .map(|value| {
            let (
                npc_id,
                source_kind,
                source_id,
                population_role,
                presence,
                important,
                first_seen_at,
                last_seen_at,
                encounter_count,
                profile_json,
            ) = value?;
            Ok(TavernPopulationMember {
                npc_id,
                source_kind,
                source_id,
                population_role,
                presence,
                is_important: important == 1,
                first_seen_at,
                last_seen_at,
                encounter_count,
                profile: parse_profile(&profile_json)?,
            })
        })
        .collect::<Result<Vec<_>, CampaignStoreError>>()?;
    let mut cycle_statement = connection.prepare("SELECT id,operation_id,trigger,before_revision,after_revision,context_json,present_npc_ids_json,opportunity_ids_json,occurred_at FROM tavern_population_cycles WHERE tavern_id=?1 AND campaign_id=?2 ORDER BY occurred_at,id")?;
    let cycles = cycle_statement
        .query_map(params![tavern_id, campaign_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, i64>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, String>(6)?,
                row.get::<_, String>(7)?,
                row.get::<_, String>(8)?,
            ))
        })?
        .map(|value| {
            let (
                id,
                operation_id,
                trigger,
                before_revision,
                after_revision,
                context,
                present,
                opportunities,
                occurred_at,
            ) = value?;
            Ok(TavernPopulationCycle {
                id,
                operation_id,
                campaign_id: campaign_id.to_owned(),
                tavern_id: tavern_id.clone(),
                trigger,
                before_revision,
                after_revision,
                context: from_json(&context)?,
                present_npc_ids: from_json(&present)?,
                opportunity_ids: from_json(&opportunities)?,
                occurred_at,
            })
        })
        .collect::<Result<Vec<_>, CampaignStoreError>>()?;
    let mut focus_statement = connection.prepare("SELECT id,operation_id,npc_id,before_revision,after_revision,npc_lod,occurred_at FROM tavern_population_focus_events WHERE tavern_id=?1 AND campaign_id=?2 ORDER BY occurred_at,id")?;
    let focus_history = focus_statement
        .query_map(params![tavern_id, campaign_id], |row| {
            Ok(TavernPopulationFocusEvent {
                id: row.get(0)?,
                operation_id: row.get(1)?,
                campaign_id: campaign_id.to_owned(),
                tavern_id: tavern_id.clone(),
                npc_id: row.get(2)?,
                before_revision: row.get(3)?,
                after_revision: row.get(4)?,
                npc_lod: row.get(5)?,
                occurred_at: row.get(6)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(TavernPopulationSnapshot {
        state,
        members,
        cycles,
        focus_history,
    })
}

fn tavern_identity(
    connection: &Connection,
    campaign_id: &str,
) -> Result<(String, String), CampaignStoreError> {
    connection.query_row("SELECT id,owner_npc_id FROM taverns WHERE campaign_id=?1 ORDER BY created_at,id LIMIT 1",[campaign_id],|row|Ok((row.get(0)?,row.get(1)?))).optional()?.ok_or(CampaignStoreError::NotFound)
}

fn projection_facts(
    connection: &Connection,
    campaign_id: &str,
    current: &[TavernPopulationMember],
) -> Result<ProjectionFacts, CampaignStoreError> {
    let (tavern_id, _) = tavern_identity(connection, campaign_id)?;
    let (world_updated_at,constitution_revision,npc_rules,society,technology):(String,i64,String,String,String)=connection.query_row("SELECT bible.updated_at,constitution.revision,constitution.npc_rules,constitution.society,constitution.technology FROM world_bibles bible JOIN world_constitutions constitution ON constitution.campaign_id=bible.campaign_id AND constitution.status='LOCKED' WHERE bible.campaign_id=?1",[campaign_id],|row|Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?,row.get(4)?))).map_err(|_|CampaignStoreError::InvalidState)?;
    let (current_location_id,location_revision,location_name):(String,i64,String)=connection.query_row("SELECT state.current_location_id,state.revision,location.name FROM campaign_location_states state JOIN dynamic_locations location ON location.id=state.current_location_id WHERE state.campaign_id=?1",[campaign_id],|row|Ok((row.get(0)?,row.get(1)?,row.get(2)?))).map_err(|_|CampaignStoreError::InvalidState)?;
    let mut clock_statement = connection.prepare(
        "SELECT id,name,current,max,updated_at FROM world_clocks WHERE campaign_id=?1 ORDER BY id",
    )?;
    let clock_rows = clock_statement
        .query_map([campaign_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, String>(4)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let clocks = clock_rows
        .iter()
        .map(
            |(id, _, current, max, updated_at)| TavernPopulationClockFactor {
                id: id.clone(),
                current: *current,
                max: *max,
                updated_at: updated_at.clone(),
            },
        )
        .collect::<Vec<_>>();
    let mut faction_statement=connection.prepare("SELECT profile_json FROM active_factions WHERE campaign_id=?1 AND materialization='ACTIVE' ORDER BY id")?;
    let factions = faction_statement
        .query_map([campaign_id], |row| row.get::<_, String>(0))?
        .map(|value| from_json::<ActiveFactionProfile>(&value?))
        .collect::<Result<Vec<_>, _>>()?;
    let faction_factors = factions
        .iter()
        .map(|profile| TavernPopulationFactionFactor {
            id: profile.id.clone(),
            revision: profile.revision,
            current_action: profile
                .current_action
                .clone()
                .unwrap_or_else(|| profile.goal.clone()),
            player_relation: profile.player_relation.clone(),
            territory_location_ids: profile.territory_location_ids.clone(),
        })
        .collect::<Vec<_>>();
    let mut event_statement=connection.prepare("SELECT id,type,payload_json FROM game_events WHERE campaign_id=?1 ORDER BY occurred_at DESC,id DESC LIMIT 8")?;
    let events = event_statement
        .query_map([campaign_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let mut history = current
        .iter()
        .filter(|member| member.is_important)
        .map(|member| member.npc_id.clone())
        .collect::<HashSet<_>>();
    let mut history_statement=connection.prepare("SELECT DISTINCT npc_id FROM conversations WHERE campaign_id=?1 AND kind='NPC' AND npc_id IS NOT NULL ORDER BY npc_id")?;
    for value in history_statement.query_map([campaign_id], |row| row.get::<_, String>(0))? {
        history.insert(value?);
    }
    let mut history_npc_ids = history.into_iter().collect::<Vec<_>>();
    history_npc_ids.sort();
    let context = TavernPopulationContext {
        campaign_id: campaign_id.to_owned(),
        tavern_id,
        world_updated_at,
        current_location_id: current_location_id.clone(),
        location_revision,
        clocks: clocks.clone(),
        active_factions: faction_factors,
        recent_event_ids: events.iter().map(|value| value.0.clone()).collect(),
        history_npc_ids,
    };
    let mut factors = Vec::new();
    if location_revision > 1 {
        factors.push(Factor {
            source_kind: "LOCATION".to_owned(),
            source_id: current_location_id.clone(),
            population_role: format!("{location_name}的旅人"),
        });
    }
    for (id, name, current, _, _) in &clock_rows {
        if *current > 0 {
            factors.push(Factor {
                source_kind: "CLOCK".to_owned(),
                source_id: id.clone(),
                population_role: format!("{name}的关注者"),
            });
        }
    }
    for faction in &factions {
        if faction
            .territory_location_ids
            .contains(&current_location_id)
        {
            factors.push(Factor {
                source_kind: "FACTION".to_owned(),
                source_id: faction.id.clone(),
                population_role: format!("{}的联络人", faction.name),
            });
        }
    }
    if let Some((id, kind, _)) = events.first() {
        factors.push(Factor {
            source_kind: "EVENT".to_owned(),
            source_id: id.clone(),
            population_role: format!("{kind}的见证者"),
        });
    }
    let opportunities = opportunities(
        connection,
        campaign_id,
        &factors,
        &factions,
        &clock_rows,
        &events,
    )?;
    Ok(ProjectionFacts {
        context,
        factors,
        opportunities,
        constitution_revision,
        evidence: NpcLodConstitutionEvidence {
            npc_rules,
            society,
            technology,
        },
    })
}

fn opportunities(
    connection: &Connection,
    campaign_id: &str,
    factors: &[Factor],
    factions: &[ActiveFactionProfile],
    clocks: &[(String, String, i64, i64, String)],
    events: &[(String, String, String)],
) -> Result<Vec<TavernOpportunity>, CampaignStoreError> {
    let mut present = HashSet::new();
    let mut npc_statement = connection.prepare(
        "SELECT id FROM npcs WHERE campaign_id=?1 AND current_status='ACTIVE'
         AND tavern_id=(SELECT id FROM taverns WHERE campaign_id=?1 ORDER BY created_at,id LIMIT 1)
         ORDER BY id",
    )?;
    for value in npc_statement.query_map([campaign_id], |row| row.get::<_, String>(0))? {
        present.insert(value?);
    }
    let mut result = Vec::new();
    let mut rumor_statement=connection.prepare("SELECT id,statement,detail_json FROM world_facts WHERE campaign_id=?1 AND kind='RUMOR' ORDER BY created_at,id")?;
    for value in rumor_statement.query_map([campaign_id], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
        ))
    })? {
        let (id, statement, detail) = value?;
        let detail: Value = from_json(&detail)?;
        if let Some(source) = detail
            .get("sourceNpcId")
            .and_then(Value::as_str)
            .filter(|source| present.contains(*source))
        {
            result.push(TavernOpportunity {
                id: format!("rumor:{id}"),
                kind: "RUMOR".to_owned(),
                source_id: source.to_owned(),
                title: statement.clone(),
                detail: statement,
            });
        }
    }
    let mut quest_statement=connection.prepare("SELECT id,publisher_npc_id,content_json FROM quests WHERE campaign_id=?1 AND status='AVAILABLE' ORDER BY created_at,id")?;
    for value in quest_statement.query_map([campaign_id], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
        ))
    })? {
        let (id, source, content) = value?;
        if present.contains(&source) {
            let content: Value = from_json(&content)?;
            result.push(TavernOpportunity {
                id: format!("quest:{id}"),
                kind: "QUEST".to_owned(),
                source_id: source,
                title: value_text(&content, "title")?,
                detail: value_text(&content, "summary")?,
            });
        }
    }
    for faction in factions {
        if factors
            .iter()
            .any(|factor| factor.source_kind == "FACTION" && factor.source_id == faction.id)
        {
            result.push(TavernOpportunity {
                id: format!("faction:{}:{}", faction.id, faction.revision),
                kind: "FACTION".to_owned(),
                source_id: faction.id.clone(),
                title: faction.name.clone(),
                detail: faction
                    .current_action
                    .clone()
                    .unwrap_or_else(|| faction.goal.clone()),
            });
        }
    }
    for (id, name, current, max, _) in clocks {
        if *current > 0 {
            result.push(TavernOpportunity {
                id: format!("clock:{id}:{current}"),
                kind: "CLOCK".to_owned(),
                source_id: id.clone(),
                title: name.clone(),
                detail: format!("进度 {current}/{max}"),
            });
        }
    }
    if let Some((id, kind, payload)) = events.first() {
        result.push(TavernOpportunity {
            id: format!("event:{id}"),
            kind: "EVENT".to_owned(),
            source_id: id.clone(),
            title: kind.clone(),
            detail: payload.clone(),
        });
    }
    Ok(result)
}

fn candidates(
    connection: &Connection,
    campaign_id: &str,
    current: &[TavernPopulationMember],
    facts: &ProjectionFacts,
    at: &str,
) -> Result<Vec<Candidate>, CampaignStoreError> {
    let (tavern_id, owner) = tavern_identity(connection, campaign_id)?;
    let mut result = Vec::new();
    let mut established_statement=connection.prepare("SELECT npc.id,profile.profile_json FROM npcs npc JOIN npc_lod_profiles profile ON profile.id=npc.id WHERE npc.campaign_id=?1 AND npc.tavern_id=?2 AND npc.current_status='ACTIVE' ORDER BY CASE npc.residency WHEN 'OWNER' THEN 0 WHEN 'RESIDENT' THEN 1 ELSE 2 END,npc.id")?;
    for value in established_statement.query_map(params![campaign_id, tavern_id], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })? {
        let (id, profile_json) = value?;
        let profile = parse_profile(&profile_json)?;
        result.push(Candidate {
            source_kind: if id == owner { "OWNER" } else { "ESTABLISHED" }.to_owned(),
            source_id: id,
            population_role: profile.population_role.clone(),
            profile,
        });
    }
    let current_by_source = current
        .iter()
        .map(|member| {
            (
                (member.source_kind.clone(), member.source_id.clone()),
                member,
            )
        })
        .collect::<HashMap<_, _>>();
    for factor in &facts.factors {
        let prior = current_by_source.get(&(factor.source_kind.clone(), factor.source_id.clone()));
        let profile = if let Some(member) = prior {
            member.profile.clone()
        } else {
            let profile = NpcLodProfile {
                kind: "NPC_LOD_PROFILE".to_owned(),
                schema_version: 1,
                id: format!("npc-population-{}", Uuid::new_v4()),
                campaign_id: campaign_id.to_owned(),
                constitution_revision: facts.constitution_revision,
                lod: 0,
                revision: 1,
                identity_anchor: format!(
                    "population:{}:{}",
                    factor.source_kind.to_lowercase(),
                    factor.source_id
                ),
                population_role: factor.population_role.clone(),
                name: None,
                appearance: None,
                current_behavior: None,
                career: None,
                personality: None,
                goals: Vec::new(),
                knowledge_fact_ids: Vec::new(),
                relationship_npc_ids: Vec::new(),
                memory_ids: Vec::new(),
                secret_fact_ids: Vec::new(),
                quest_ids: Vec::new(),
                item_ids: Vec::new(),
                experience_event_ids: Vec::new(),
                constitution_evidence: facts.evidence.clone(),
                generation_record_id: None,
                created_at: at.to_owned(),
                updated_at: at.to_owned(),
            };
            connection.execute("INSERT INTO npc_lod_profiles (id,campaign_id,schema_version,constitution_revision,lod,revision,profile_json,generation_record_id,created_at,updated_at) VALUES (?1,?2,1,?3,0,1,?4,NULL,?5,?5)",params![profile.id,profile.campaign_id,profile.constitution_revision,to_json(&profile)?,at])?;
            profile
        };
        result.push(Candidate {
            profile,
            source_kind: factor.source_kind.clone(),
            source_id: factor.source_id.clone(),
            population_role: factor.population_role.clone(),
        });
    }
    Ok(result)
}

fn project(
    current_state: Option<&TavernPopulationState>,
    current: &[TavernPopulationMember],
    facts: ProjectionFacts,
    candidates: Vec<Candidate>,
    trigger: &str,
    at: &str,
) -> Result<(TavernPopulationState, Vec<TavernPopulationMember>), CampaignStoreError> {
    let by_npc = current
        .iter()
        .map(|member| (member.npc_id.clone(), member))
        .collect::<HashMap<_, _>>();
    let by_source = current
        .iter()
        .map(|member| {
            (
                (member.source_kind.clone(), member.source_id.clone()),
                member,
            )
        })
        .collect::<HashMap<_, _>>();
    let mut selected = HashSet::new();
    let mut members = Vec::new();
    for candidate in candidates {
        if let Some(prior) =
            by_source.get(&(candidate.source_kind.clone(), candidate.source_id.clone()))
            && prior.npc_id != candidate.profile.id
        {
            return Err(CampaignStoreError::InvalidData);
        }
        if let Some(prior) = by_npc.get(&candidate.profile.id)
            && (prior.source_kind != candidate.source_kind
                || prior.source_id != candidate.source_id)
        {
            return Err(CampaignStoreError::InvalidData);
        }
        selected.insert(candidate.profile.id.clone());
        let prior = by_npc.get(&candidate.profile.id);
        members.push(TavernPopulationMember {
            npc_id: candidate.profile.id.clone(),
            source_kind: candidate.source_kind,
            source_id: candidate.source_id,
            population_role: candidate.population_role,
            presence: "PRESENT".to_owned(),
            is_important: prior.is_some_and(|value| value.is_important),
            first_seen_at: prior.map_or_else(|| at.to_owned(), |value| value.first_seen_at.clone()),
            last_seen_at: at.to_owned(),
            encounter_count: prior.map_or(1, |value| value.encounter_count + 1),
            profile: candidate.profile,
        });
    }
    let history = facts.context.history_npc_ids.iter().collect::<HashSet<_>>();
    for prior in current {
        if selected.contains(&prior.npc_id) {
            continue;
        }
        let present = prior.is_important || history.contains(&prior.npc_id);
        let mut member = prior.clone();
        member.presence = if present { "PRESENT" } else { "ABSENT" }.to_owned();
        if present {
            member.last_seen_at = at.to_owned();
            member.encounter_count += 1;
        }
        members.push(member);
    }
    let empty_state = !members
        .iter()
        .any(|member| member.presence == "PRESENT" && member.source_kind != "OWNER")
        && facts.opportunities.is_empty();
    let state = TavernPopulationState {
        campaign_id: facts.context.campaign_id.clone(),
        tavern_id: facts.context.tavern_id.clone(),
        revision: current_state.map_or(1, |value| value.revision + 1),
        trigger: trigger.to_owned(),
        context: facts.context,
        opportunities: facts.opportunities,
        empty_state,
        projected_at: at.to_owned(),
    };
    Ok((state, members))
}

fn write_projection(
    connection: &Connection,
    state: &TavernPopulationState,
    members: &[TavernPopulationMember],
) -> Result<(), CampaignStoreError> {
    let revision = connection
        .query_row(
            "SELECT revision FROM tavern_population_states WHERE tavern_id=?1",
            [&state.tavern_id],
            |row| row.get::<_, i64>(0),
        )
        .optional()?;
    if let Some(before) = revision {
        if before + 1 != state.revision {
            return Err(CampaignStoreError::InvalidState);
        }
        let changed=connection.execute("UPDATE tavern_population_states SET revision=?1,last_trigger=?2,context_json=?3,opportunities_json=?4,empty_state=?5,projected_at=?6 WHERE tavern_id=?7 AND campaign_id=?8 AND revision=?9",params![state.revision,state.trigger,to_json(&state.context)?,to_json(&state.opportunities)?,i64::from(state.empty_state),state.projected_at,state.tavern_id,state.campaign_id,before])?;
        if changed != 1 {
            return Err(CampaignStoreError::InvalidState);
        }
    } else {
        connection.execute("INSERT INTO tavern_population_states (tavern_id,campaign_id,revision,last_trigger,context_json,opportunities_json,empty_state,projected_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",params![state.tavern_id,state.campaign_id,state.revision,state.trigger,to_json(&state.context)?,to_json(&state.opportunities)?,i64::from(state.empty_state),state.projected_at])?;
    }
    for member in members {
        let exists = connection
            .query_row(
                "SELECT 1 FROM tavern_population_members WHERE tavern_id=?1 AND npc_id=?2",
                params![state.tavern_id, member.npc_id],
                |row| row.get::<_, i64>(0),
            )
            .optional()?;
        if exists.is_some() {
            connection.execute("UPDATE tavern_population_members SET presence=?1,is_important=?2,last_seen_at=?3,encounter_count=?4 WHERE tavern_id=?5 AND campaign_id=?6 AND npc_id=?7",params![member.presence,i64::from(member.is_important),member.last_seen_at,member.encounter_count,state.tavern_id,state.campaign_id,member.npc_id])?;
        } else {
            connection.execute("INSERT INTO tavern_population_members (tavern_id,campaign_id,npc_id,source_kind,source_id,population_role,presence,is_important,first_seen_at,last_seen_at,encounter_count) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",params![state.tavern_id,state.campaign_id,member.npc_id,member.source_kind,member.source_id,member.population_role,member.presence,i64::from(member.is_important),member.first_seen_at,member.last_seen_at,member.encounter_count])?;
        }
    }
    Ok(())
}

fn parse_profile(value: &str) -> Result<NpcLodProfile, CampaignStoreError> {
    from_json(value)
}
fn from_json<T: serde::de::DeserializeOwned>(value: &str) -> Result<T, CampaignStoreError> {
    serde_json::from_str(value).map_err(|_| CampaignStoreError::InvalidData)
}
fn to_json<T: Serialize>(value: &T) -> Result<String, CampaignStoreError> {
    serde_json::to_string(value).map_err(|_| CampaignStoreError::InvalidData)
}
fn value_text(value: &Value, key: &str) -> Result<String, CampaignStoreError> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or(CampaignStoreError::InvalidData)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn projection_preserves_established_identity_and_supports_an_empty_tavern() {
        let owner = profile("npc-owner", 3, "Tavern keeper");
        let initial_context = context(Vec::new());
        let facts = ProjectionFacts {
            context: initial_context,
            factors: Vec::new(),
            opportunities: Vec::new(),
            constitution_revision: 1,
            evidence: evidence(),
        };
        let (first_state, first_members) = project(
            None,
            &[],
            facts,
            vec![Candidate {
                profile: owner.clone(),
                source_kind: "OWNER".to_owned(),
                source_id: owner.id.clone(),
                population_role: owner.population_role.clone(),
            }],
            "ENTERED",
            "2026-08-24T10:00:00.000Z",
        )
        .expect("project empty tavern");
        assert!(first_state.empty_state);
        assert_eq!(first_members[0].npc_id, owner.id);

        let visitor = profile("npc-event", 0, "A storm witness");
        let mut changed_context = context(vec!["event-storm".to_owned()]);
        changed_context.location_revision = 2;
        let facts = ProjectionFacts {
            context: changed_context,
            factors: vec![Factor {
                source_kind: "EVENT".to_owned(),
                source_id: "event-storm".to_owned(),
                population_role: visitor.population_role.clone(),
            }],
            opportunities: vec![TavernOpportunity {
                id: "event:event-storm".to_owned(),
                kind: "EVENT".to_owned(),
                source_id: "event-storm".to_owned(),
                title: "WORLD_CLOCK_ADVANCED".to_owned(),
                detail: "{}".to_owned(),
            }],
            constitution_revision: 1,
            evidence: evidence(),
        };
        let (second_state, second_members) = project(
            Some(&first_state),
            &first_members,
            facts,
            vec![
                Candidate {
                    profile: owner.clone(),
                    source_kind: "OWNER".to_owned(),
                    source_id: owner.id.clone(),
                    population_role: owner.population_role.clone(),
                },
                Candidate {
                    profile: visitor.clone(),
                    source_kind: "EVENT".to_owned(),
                    source_id: "event-storm".to_owned(),
                    population_role: visitor.population_role.clone(),
                },
            ],
            "EVENT_COMMITTED",
            "2026-08-24T11:00:00.000Z",
        )
        .expect("project changed context");
        assert_eq!(second_state.revision, 2);
        assert!(!second_state.empty_state);
        assert_eq!(
            second_members
                .iter()
                .find(|member| member.source_kind == "OWNER")
                .expect("owner")
                .npc_id,
            owner.id
        );
    }

    fn context(events: Vec<String>) -> TavernPopulationContext {
        TavernPopulationContext {
            campaign_id: "campaign-population".to_owned(),
            tavern_id: "tavern-population".to_owned(),
            world_updated_at: "2026-08-24T10:00:00.000Z".to_owned(),
            current_location_id: "location-harbor".to_owned(),
            location_revision: 1,
            clocks: Vec::new(),
            active_factions: Vec::new(),
            recent_event_ids: events,
            history_npc_ids: Vec::new(),
        }
    }

    fn evidence() -> NpcLodConstitutionEvidence {
        NpcLodConstitutionEvidence {
            npc_rules: "NPC knowledge is bounded.".to_owned(),
            society: "Guild towns".to_owned(),
            technology: "Late medieval".to_owned(),
        }
    }

    fn profile(id: &str, lod: i64, role: &str) -> NpcLodProfile {
        NpcLodProfile {
            kind: "NPC_LOD_PROFILE".to_owned(),
            schema_version: 1,
            id: id.to_owned(),
            campaign_id: "campaign-population".to_owned(),
            constitution_revision: 1,
            lod,
            revision: 1,
            identity_anchor: format!("anchor:{id}"),
            population_role: role.to_owned(),
            name: (lod >= 1).then(|| "Mara".to_owned()),
            appearance: (lod >= 1).then(|| "A weathered cloak.".to_owned()),
            current_behavior: (lod >= 1).then(|| "Watching the door.".to_owned()),
            career: (lod >= 2).then(|| "Keeper".to_owned()),
            personality: (lod >= 2).then(|| "Watchful".to_owned()),
            goals: if lod >= 2 {
                vec!["Keep the tavern safe.".to_owned()]
            } else {
                Vec::new()
            },
            knowledge_fact_ids: Vec::new(),
            relationship_npc_ids: Vec::new(),
            memory_ids: Vec::new(),
            secret_fact_ids: Vec::new(),
            quest_ids: Vec::new(),
            item_ids: Vec::new(),
            experience_event_ids: Vec::new(),
            constitution_evidence: evidence(),
            generation_record_id: None,
            created_at: "2026-08-24T10:00:00.000Z".to_owned(),
            updated_at: "2026-08-24T10:00:00.000Z".to_owned(),
        }
    }
}

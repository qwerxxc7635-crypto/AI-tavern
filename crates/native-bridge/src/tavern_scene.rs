use std::collections::{HashMap, HashSet};

use rusqlite::{Connection, OptionalExtension, Transaction, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::{
    CampaignStore, CampaignStoreError, CharacterGenerationAudit, current_timestamp, validate_id,
};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TavernSceneParticipant {
    pub npc_id: String,
    pub name: String,
    pub population_role: String,
    pub status: String,
    pub joined_at: String,
    pub left_at: Option<String>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TavernSceneTurn {
    pub id: String,
    pub operation_id: String,
    pub scene_id: String,
    pub sequence: i64,
    pub before_revision: i64,
    pub after_revision: i64,
    pub player_intent: String,
    pub addressed_npc_id: Option<String>,
    pub actions: Value,
    pub occurred_at: String,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TavernSceneSnapshot {
    pub id: String,
    pub campaign_id: String,
    pub tavern_id: String,
    pub revision: i64,
    pub status: String,
    pub participants: Vec<TavernSceneParticipant>,
    pub turns: Vec<TavernSceneTurn>,
    pub created_at: String,
    pub updated_at: String,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TavernSceneStart {
    pub campaign_id: String,
    pub scene_id: String,
    pub operation_id: String,
    pub participant_npc_ids: Vec<String>,
    pub listening_npc_ids: Vec<String>,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TavernScenePrepare {
    pub campaign_id: String,
    pub scene_id: String,
    pub player_intent: String,
    pub addressed_npc_id: Option<String>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TavernSceneActorInput {
    pub actor_id: String,
    pub input: Value,
    pub authorized_knowledge_ids: Vec<String>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TavernSceneGenerationRequest {
    pub scene: TavernSceneSnapshot,
    pub actor_inputs: Vec<TavernSceneActorInput>,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TavernSceneActorGeneration {
    pub actor_id: String,
    pub generation: CharacterGenerationAudit,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TavernSceneCommit {
    pub campaign_id: String,
    pub scene_id: String,
    pub expected_revision: i64,
    pub turn_id: String,
    pub operation_id: String,
    pub player_intent: String,
    pub addressed_npc_id: Option<String>,
    pub generations: Vec<TavernSceneActorGeneration>,
}
#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Proposal {
    actor_id: String,
    action: String,
    target_npc_id: Option<String>,
    utterance: Option<String>,
    cited_knowledge_ids: Vec<String>,
    urgency: i64,
    rationale: String,
}

impl CampaignStore {
    pub fn tavern_scene_snapshot(
        &self,
        campaign_id: &str,
        scene_id: &str,
    ) -> Result<TavernSceneSnapshot, CampaignStoreError> {
        validate_id(campaign_id)?;
        validate_id(scene_id)?;
        load_snapshot(&self.connect()?, campaign_id, scene_id)
    }
    pub fn start_tavern_scene(
        &self,
        command: TavernSceneStart,
    ) -> Result<TavernSceneSnapshot, CampaignStoreError> {
        validate_id(&command.campaign_id)?;
        validate_id(&command.scene_id)?;
        validate_id(&command.operation_id)?;
        if !(2..=6).contains(&command.participant_npc_ids.len()) {
            return Err(CampaignStoreError::InvalidData);
        }
        let ids: HashSet<_> = command.participant_npc_ids.iter().collect();
        if ids.len() != command.participant_npc_ids.len()
            || command.listening_npc_ids.iter().any(|id| !ids.contains(id))
        {
            return Err(CampaignStoreError::InvalidData);
        }
        let mut connection = self.connect()?;
        let tx = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        if let Some(id) = tx
            .query_row(
                "SELECT id FROM tavern_scenes WHERE operation_id=?1",
                [&command.operation_id],
                |r| r.get::<_, String>(0),
            )
            .optional()?
        {
            let out = load_snapshot(&tx, &command.campaign_id, &id)?;
            tx.commit()?;
            return Ok(out);
        }
        let tavern_id: String = tx.query_row(
            "SELECT id FROM taverns WHERE campaign_id=?1",
            [&command.campaign_id],
            |r| r.get(0),
        )?;
        if let Some(active_id) = tx
            .query_row(
                "SELECT id FROM tavern_scenes WHERE tavern_id=?1 AND status='ACTIVE'",
                [&tavern_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?
        {
            let active = load_snapshot(&tx, &command.campaign_id, &active_id)?;
            let active_ids: HashSet<_> = active.participants.iter().map(|p| &p.npc_id).collect();
            if active_ids != ids {
                return Err(CampaignStoreError::InvalidState);
            }
            tx.commit()?;
            return Ok(active);
        }
        let at = current_timestamp()?;
        tx.execute("INSERT INTO tavern_scenes(id,operation_id,campaign_id,tavern_id,revision,status,created_at,updated_at) VALUES(?1,?2,?3,?4,1,'ACTIVE',?5,?5)", params![command.scene_id,command.operation_id,command.campaign_id,tavern_id,at])?;
        for npc_id in &command.participant_npc_ids {
            let (name, role):(String,String)=tx.query_row("SELECT COALESCE(json_extract(profile_json,'$.name'),'Unknown'),population_role FROM npc_lod_profiles WHERE id=?1 AND campaign_id=?2 AND lod>=1", params![npc_id,command.campaign_id], |r| Ok((r.get(0)?,r.get(1)?)))?;
            let status = if command.listening_npc_ids.contains(npc_id) {
                "LISTENING"
            } else {
                "ACTIVE"
            };
            tx.execute("INSERT INTO tavern_scene_participants(scene_id,campaign_id,npc_id,name,population_role,status,joined_at,left_at) VALUES(?1,?2,?3,?4,?5,?6,?7,NULL)",params![command.scene_id,command.campaign_id,npc_id,name,role,status,at])?;
        }
        let out = load_snapshot(&tx, &command.campaign_id, &command.scene_id)?;
        tx.commit()?;
        Ok(out)
    }
    pub fn prepare_tavern_scene_turn(
        &self,
        command: TavernScenePrepare,
    ) -> Result<TavernSceneGenerationRequest, CampaignStoreError> {
        validate_text(&command.player_intent, 4000)?;
        let connection = self.connect()?;
        let scene = load_snapshot(&connection, &command.campaign_id, &command.scene_id)?;
        if scene.status != "ACTIVE"
            || command.addressed_npc_id.as_ref().is_some_and(|id| {
                !scene
                    .participants
                    .iter()
                    .any(|p| &p.npc_id == id && p.status != "LEFT")
            })
        {
            return Err(CampaignStoreError::InvalidData);
        }
        let actor_inputs = build_inputs(
            &connection,
            &scene,
            &command.player_intent,
            command.addressed_npc_id.as_deref(),
        )?;
        Ok(TavernSceneGenerationRequest {
            scene,
            actor_inputs,
        })
    }
    pub fn commit_tavern_scene_turn(
        &self,
        command: TavernSceneCommit,
    ) -> Result<TavernSceneSnapshot, CampaignStoreError> {
        validate_text(&command.player_intent, 4000)?;
        let mut connection = self.connect()?;
        let tx = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        if let Some(scene_id) = tx
            .query_row(
                "SELECT scene_id FROM tavern_scene_turns WHERE operation_id=?1",
                [&command.operation_id],
                |r| r.get::<_, String>(0),
            )
            .optional()?
        {
            if scene_id != command.scene_id {
                return Err(CampaignStoreError::InvalidData);
            }
            let out = load_snapshot(&tx, &command.campaign_id, &scene_id)?;
            tx.commit()?;
            return Ok(out);
        }
        let before = load_snapshot(&tx, &command.campaign_id, &command.scene_id)?;
        if before.revision != command.expected_revision || before.status != "ACTIVE" {
            return Err(CampaignStoreError::InvalidData);
        }
        let expected = build_inputs(
            &tx,
            &before,
            &command.player_intent,
            command.addressed_npc_id.as_deref(),
        )?;
        if expected.len() != command.generations.len() {
            return Err(CampaignStoreError::InvalidData);
        }
        let expected_map: HashMap<_, _> = expected
            .into_iter()
            .map(|v| (v.actor_id.clone(), v))
            .collect();
        let participant_ids: HashSet<_> = before
            .participants
            .iter()
            .map(|p| p.npc_id.as_str())
            .collect();
        let mut proposals = Vec::new();
        for actor in &command.generations {
            let expected = expected_map
                .get(&actor.actor_id)
                .ok_or(CampaignStoreError::InvalidData)?;
            validate_audit(&actor.generation, &expected.input)?;
            let proposal: Proposal =
                serde_json::from_value(actor.generation.validated_output.clone())
                    .map_err(|_| CampaignStoreError::InvalidData)?;
            validate_proposal(
                &proposal,
                &actor.actor_id,
                &expected.authorized_knowledge_ids,
                &participant_ids,
                &before,
            )?;
            proposals.push((proposal, &actor.generation));
        }
        let addressed = command.addressed_npc_id.as_deref();
        let mut vocal: Vec<_> = proposals
            .iter()
            .filter(|(p, _)| matches!(p.action.as_str(), "SPEAK" | "INTERRUPT" | "INTERVENE"))
            .collect();
        vocal.sort_by(|(a, _), (b, _)| {
            score(b, addressed)
                .cmp(&score(a, addressed))
                .then(a.actor_id.cmp(&b.actor_id))
        });
        let winner = vocal.first().map(|(p, _)| p.actor_id.as_str());
        let actions: Vec<Value> = proposals
            .iter()
            .map(|(p, _)| {
                let selected = !matches!(p.action.as_str(), "SPEAK" | "INTERRUPT" | "INTERVENE")
                    || winner == Some(p.actor_id.as_str());
                let mut value = serde_json::to_value(p).expect("proposal serializes");
                value
                    .as_object_mut()
                    .expect("object")
                    .insert("selected".into(), Value::Bool(selected));
                value
            })
            .collect();
        let at = current_timestamp()?;
        let sequence = before.turns.last().map_or(1, |t| t.sequence + 1);
        tx.execute("INSERT INTO tavern_scene_turns(id,operation_id,scene_id,campaign_id,sequence,before_revision,after_revision,player_intent,addressed_npc_id,actions_json,occurred_at) VALUES(?1,?2,?3,?4,?5,?6,?6+1,?7,?8,?9,?10)",params![command.turn_id,command.operation_id,command.scene_id,command.campaign_id,sequence,command.expected_revision,command.player_intent,command.addressed_npc_id,serde_json::to_string(&actions).map_err(|_|CampaignStoreError::InvalidData)?,at])?;
        for ((proposal, audit), action) in proposals.iter().zip(actions.iter()) {
            insert_generation(&tx, &command.campaign_id, audit, &at)?;
            let expected = expected_map
                .get(&proposal.actor_id)
                .ok_or(CampaignStoreError::InvalidData)?;
            tx.execute("INSERT INTO tavern_scene_actor_proposals(id,scene_id,turn_id,campaign_id,actor_npc_id,generation_record_id,context_digest,authorized_knowledge_ids_json,proposal_json,selected,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",params![format!("{}:{}",command.turn_id,proposal.actor_id),command.scene_id,command.turn_id,command.campaign_id,proposal.actor_id,audit.generation_record_id,audit.request_id,serde_json::to_string(&expected.authorized_knowledge_ids).map_err(|_|CampaignStoreError::InvalidData)?,serde_json::to_string(proposal).map_err(|_|CampaignStoreError::InvalidData)?,action["selected"].as_bool().unwrap_or(false) as i64,at])?;
            if proposal.action == "LEAVE" {
                tx.execute("UPDATE tavern_scene_participants SET status='LEFT',left_at=?1 WHERE scene_id=?2 AND npc_id=?3",params![at,command.scene_id,proposal.actor_id])?;
            }
        }
        tx.execute(
            "UPDATE tavern_scenes SET revision=revision+1,updated_at=?1 WHERE id=?2",
            params![at, command.scene_id],
        )?;
        let out = load_snapshot(&tx, &command.campaign_id, &command.scene_id)?;
        tx.commit()?;
        Ok(out)
    }
}

fn build_inputs(
    connection: &Connection,
    scene: &TavernSceneSnapshot,
    player_intent: &str,
    addressed: Option<&str>,
) -> Result<Vec<TavernSceneActorInput>, CampaignStoreError> {
    let visible:Vec<Value>=scene.participants.iter().filter(|p|p.status!="LEFT").map(|p|json!({"id":p.npc_id,"name":p.name,"populationRole":p.population_role,"status":p.status})).collect();
    let recent:Vec<Value>=scene.turns.iter().rev().take(12).rev().flat_map(|t|t.actions.as_array().into_iter().flatten().filter(|a|a["selected"]==true).map(|a|json!({"speakerNpcId":a["actorId"],"text":a["utterance"].as_str().unwrap_or(&t.player_intent)}))).collect();
    let mut result = Vec::new();
    for participant in scene.participants.iter().filter(|p| p.status != "LEFT") {
        let profile: String = connection.query_row(
            "SELECT profile_json FROM npc_lod_profiles WHERE id=?1 AND campaign_id=?2",
            params![participant.npc_id, scene.campaign_id],
            |r| r.get(0),
        )?;
        let profile: Value =
            serde_json::from_str(&profile).map_err(|_| CampaignStoreError::InvalidData)?;
        let mut knowledge = Vec::new();
        let mut stmt=connection.prepare("SELECT knowledge.id,COALESCE(truth.object_json,claim.object_json) FROM actor_knowledge knowledge LEFT JOIN world_truths truth ON truth.id=knowledge.truth_id LEFT JOIN knowledge_claims claim ON claim.id=knowledge.claim_id WHERE knowledge.campaign_id=?1 AND knowledge.actor_type='NPC' AND knowledge.actor_id=?2 ORDER BY knowledge.id")?;
        for row in stmt.query_map(params![scene.campaign_id, participant.npc_id], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        })? {
            let (id, content) = row?;
            knowledge.push(json!({"id":id,"content":content}));
        }
        let ids = knowledge
            .iter()
            .filter_map(|v| v["id"].as_str().map(str::to_owned))
            .collect();
        let mut memories = Vec::new();
        let mut stmt=connection.prepare("SELECT id,summary FROM knowledge_memories WHERE campaign_id=?1 AND actor_type='NPC' AND actor_id=?2 ORDER BY created_at,id LIMIT 30")?;
        for row in stmt.query_map(params![scene.campaign_id, participant.npc_id], |r| {
            Ok(json!({"id":r.get::<_,String>(0)?,"summary":r.get::<_,String>(1)?}))
        })? {
            memories.push(row?)
        }
        let allowed = if participant.status == "LISTENING" {
            json!(["INTERVENE", "EAVESDROP", "LEAVE", "SILENCE"])
        } else {
            json!(["SPEAK", "INTERRUPT", "SILENCE", "EAVESDROP", "LEAVE"])
        };
        let input = json!({"sceneId":scene.id,"sceneRevision":scene.revision,"actor":{"id":participant.npc_id,"name":participant.name,"populationRole":participant.population_role,"currentBehavior":profile["currentBehavior"],"personality":profile["personality"],"goals":profile["goals"]},"visibleParticipants":visible,"authorizedKnowledge":knowledge,"memories":memories,"recentPublicTurns":recent,"playerIntent":player_intent,"addressedNpcId":addressed,"allowedActions":allowed});
        result.push(TavernSceneActorInput {
            actor_id: participant.npc_id.clone(),
            input,
            authorized_knowledge_ids: ids,
        });
    }
    Ok(result)
}
fn validate_proposal(
    p: &Proposal,
    actor: &str,
    authorized: &[String],
    participants: &HashSet<&str>,
    scene: &TavernSceneSnapshot,
) -> Result<(), CampaignStoreError> {
    let actions = [
        "SPEAK",
        "INTERRUPT",
        "SILENCE",
        "EAVESDROP",
        "LEAVE",
        "INTERVENE",
    ];
    if p.actor_id != actor
        || !actions.contains(&p.action.as_str())
        || !(0..=3).contains(&p.urgency)
        || p.target_npc_id
            .as_ref()
            .is_some_and(|id| !participants.contains(id.as_str()))
        || p.cited_knowledge_ids
            .iter()
            .any(|id| !authorized.contains(id))
    {
        return Err(CampaignStoreError::InvalidData);
    }
    let vocal = matches!(p.action.as_str(), "SPEAK" | "INTERRUPT" | "INTERVENE");
    if vocal != p.utterance.as_ref().is_some_and(|v| !v.trim().is_empty())
        || p.action == "INTERRUPT" && scene.turns.is_empty()
    {
        return Err(CampaignStoreError::InvalidData);
    }
    let status = &scene
        .participants
        .iter()
        .find(|v| v.npc_id == actor)
        .ok_or(CampaignStoreError::InvalidData)?
        .status;
    if p.action == "INTERVENE" && status != "LISTENING" {
        return Err(CampaignStoreError::InvalidData);
    }
    Ok(())
}
fn score(p: &Proposal, addressed: Option<&str>) -> i64 {
    p.urgency * 10
        + p.cited_knowledge_ids.len() as i64 * 4
        + if addressed == Some(&p.actor_id) {
            30
        } else {
            0
        }
        + match p.action.as_str() {
            "INTERRUPT" => 3,
            "INTERVENE" => 2,
            _ => 1,
        }
}
fn validate_audit(a: &CharacterGenerationAudit, input: &Value) -> Result<(), CampaignStoreError> {
    if a.prompt_version < 1
        || a.input != *input
        || a.context != json!({"actorId":input["actor"]["id"],"sceneId":input["sceneId"]})
        || a.raw_response_text.trim().is_empty()
        || serde_json::from_str::<Value>(&a.raw_response_text)
            .ok()
            .as_ref()
            != Some(&a.validated_output)
    {
        return Err(CampaignStoreError::InvalidData);
    }
    Ok(())
}
fn insert_generation(
    tx: &Transaction<'_>,
    campaign: &str,
    a: &CharacterGenerationAudit,
    at: &str,
) -> Result<(), CampaignStoreError> {
    tx.execute("INSERT INTO generation_records(id,campaign_id,request_id,task,model_profile_id,prompt_version,request_json,raw_response_text,validated_output_json,validation_error_json,started_at,completed_at) VALUES(?1,?2,?3,'PROPOSE_TAVERN_SCENE_ACTION',NULL,?4,?5,?6,?7,NULL,?8,?8)",params![a.generation_record_id,campaign,a.request_id,a.prompt_version,serde_json::to_string(&a.request).map_err(|_|CampaignStoreError::InvalidData)?,a.raw_response_text,serde_json::to_string(&a.validated_output).map_err(|_|CampaignStoreError::InvalidData)?,at])?;
    Ok(())
}
fn load_snapshot(
    connection: &Connection,
    campaign: &str,
    scene: &str,
) -> Result<TavernSceneSnapshot, CampaignStoreError> {
    let mut base=connection.query_row("SELECT id,campaign_id,tavern_id,revision,status,created_at,updated_at FROM tavern_scenes WHERE id=?1 AND campaign_id=?2",params![scene,campaign],|r|Ok(TavernSceneSnapshot{id:r.get(0)?,campaign_id:r.get(1)?,tavern_id:r.get(2)?,revision:r.get(3)?,status:r.get(4)?,participants:vec![],turns:vec![],created_at:r.get(5)?,updated_at:r.get(6)?})).map_err(|e|if matches!(e,rusqlite::Error::QueryReturnedNoRows){CampaignStoreError::NotFound}else{e.into()})?;
    let mut stmt=connection.prepare("SELECT npc_id,name,population_role,status,joined_at,left_at FROM tavern_scene_participants WHERE scene_id=?1 ORDER BY joined_at,npc_id")?;
    base.participants = stmt
        .query_map([scene], |r| {
            Ok(TavernSceneParticipant {
                npc_id: r.get(0)?,
                name: r.get(1)?,
                population_role: r.get(2)?,
                status: r.get(3)?,
                joined_at: r.get(4)?,
                left_at: r.get(5)?,
            })
        })?
        .collect::<Result<_, _>>()?;
    let mut stmt=connection.prepare("SELECT id,operation_id,scene_id,sequence,before_revision,after_revision,player_intent,addressed_npc_id,actions_json,occurred_at FROM tavern_scene_turns WHERE scene_id=?1 ORDER BY sequence")?;
    base.turns = stmt
        .query_map([scene], |r| {
            let raw: String = r.get(8)?;
            let actions = serde_json::from_str(&raw).map_err(|e| {
                rusqlite::Error::FromSqlConversionFailure(
                    8,
                    rusqlite::types::Type::Text,
                    Box::new(e),
                )
            })?;
            Ok(TavernSceneTurn {
                id: r.get(0)?,
                operation_id: r.get(1)?,
                scene_id: r.get(2)?,
                sequence: r.get(3)?,
                before_revision: r.get(4)?,
                after_revision: r.get(5)?,
                player_intent: r.get(6)?,
                addressed_npc_id: r.get(7)?,
                actions,
                occurred_at: r.get(9)?,
            })
        })?
        .collect::<Result<_, _>>()?;
    Ok(base)
}
fn validate_text(value: &str, max: usize) -> Result<(), CampaignStoreError> {
    if value.trim().is_empty() || value.len() > max {
        Err(CampaignStoreError::InvalidData)
    } else {
        Ok(())
    }
}

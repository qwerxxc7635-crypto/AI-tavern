use std::collections::HashSet;

use rusqlite::{Connection, OptionalExtension, Transaction, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use uuid::Uuid;

use crate::{
    CampaignStore, CampaignStoreError, CharacterGenerationAudit, current_timestamp,
    insert_character_generation, validate_character_generation_audit, validate_id,
};

const TRIGGERS: [&str; 3] = ["OBSERVED", "INTERACTED", "RECURRING"];

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NpcLodConstitutionEvidence {
    pub npc_rules: String,
    pub society: String,
    pub technology: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NpcLodProfile {
    pub kind: String,
    pub schema_version: i64,
    pub id: String,
    pub campaign_id: String,
    pub constitution_revision: i64,
    pub lod: i64,
    pub revision: i64,
    pub identity_anchor: String,
    pub population_role: String,
    pub name: Option<String>,
    pub appearance: Option<String>,
    pub current_behavior: Option<String>,
    pub career: Option<String>,
    pub personality: Option<String>,
    pub goals: Vec<String>,
    pub knowledge_fact_ids: Vec<String>,
    pub relationship_npc_ids: Vec<String>,
    pub memory_ids: Vec<String>,
    pub secret_fact_ids: Vec<String>,
    pub quest_ids: Vec<String>,
    pub item_ids: Vec<String>,
    pub experience_event_ids: Vec<String>,
    pub constitution_evidence: NpcLodConstitutionEvidence,
    pub generation_record_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NpcLodGenerationSnapshot {
    pub profile: NpcLodProfile,
    pub input: Option<Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NpcLodSeedCommand {
    pub campaign_id: String,
    pub population_role: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NpcLodUpgradeCommit {
    pub campaign_id: String,
    pub npc_id: String,
    pub expected_revision: i64,
    pub trigger: String,
    pub generation: CharacterGenerationAudit,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct NpcLodCandidate {
    npc_id: String,
    lod: i64,
    identity_anchor: String,
    population_role: String,
    name: Option<String>,
    appearance: Option<String>,
    current_behavior: Option<String>,
    career: Option<String>,
    personality: Option<String>,
    goals: Vec<String>,
    knowledge_fact_ids: Vec<String>,
    relationship_npc_ids: Vec<String>,
    memory_ids: Vec<String>,
    secret_fact_ids: Vec<String>,
    quest_ids: Vec<String>,
    item_ids: Vec<String>,
    experience_event_ids: Vec<String>,
    constitution_evidence: NpcLodConstitutionEvidence,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct NpcLodGenerationOutput {
    schema_version: i64,
    npc: NpcLodCandidate,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
struct NpcLodReferences {
    knowledge_fact_ids: Vec<String>,
    relationship_npc_ids: Vec<String>,
    memory_ids: Vec<String>,
    secret_fact_ids: Vec<String>,
    quest_ids: Vec<String>,
    item_ids: Vec<String>,
    experience_event_ids: Vec<String>,
}

impl CampaignStore {
    pub fn create_npc_lod_seed(
        &self,
        command: NpcLodSeedCommand,
    ) -> Result<NpcLodGenerationSnapshot, CampaignStoreError> {
        validate_id(&command.campaign_id)?;
        validate_text(&command.population_role, 200)?;
        let mut connection = self.connect()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let (constitution_revision, evidence) =
            locked_constitution(&transaction, &command.campaign_id)?;
        let at = current_timestamp()?;
        let profile = NpcLodProfile {
            kind: "NPC_LOD_PROFILE".to_owned(),
            schema_version: 1,
            id: format!("npc-lod-{}", Uuid::new_v4()),
            campaign_id: command.campaign_id,
            constitution_revision,
            lod: 0,
            revision: 1,
            identity_anchor: format!("anchor-{}", Uuid::new_v4()),
            population_role: command.population_role,
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
            constitution_evidence: evidence,
            generation_record_id: None,
            created_at: at.clone(),
            updated_at: at,
        };
        validate_profile(&profile)?;
        insert_profile(&transaction, &profile)?;
        let input = generation_input(&transaction, &profile)?;
        transaction.commit()?;
        Ok(NpcLodGenerationSnapshot {
            profile,
            input: Some(input),
        })
    }

    pub fn npc_lod_generation_snapshot(
        &self,
        campaign_id: &str,
        npc_id: &str,
    ) -> Result<NpcLodGenerationSnapshot, CampaignStoreError> {
        validate_id(campaign_id)?;
        validate_id(npc_id)?;
        let connection = self.connect()?;
        let profile = load_profile(&connection, npc_id)?.ok_or(CampaignStoreError::NotFound)?;
        if profile.campaign_id != campaign_id {
            return Err(CampaignStoreError::NotFound);
        }
        let input = if profile.lod == 3 {
            None
        } else {
            Some(generation_input(&connection, &profile)?)
        };
        Ok(NpcLodGenerationSnapshot { profile, input })
    }

    pub fn commit_npc_lod_upgrade(
        &self,
        command: NpcLodUpgradeCommit,
    ) -> Result<NpcLodGenerationSnapshot, CampaignStoreError> {
        validate_id(&command.campaign_id)?;
        validate_id(&command.npc_id)?;
        validate_character_generation_audit(&command.generation, "GENERATE_NPC_LOD")?;
        let expected_trigger = trigger_for_revision(command.expected_revision)?;
        if command.trigger != expected_trigger {
            return Err(CampaignStoreError::InvalidData);
        }
        let output: NpcLodGenerationOutput =
            serde_json::from_value(command.generation.validated_output.clone())
                .map_err(|_| CampaignStoreError::InvalidData)?;
        if output.schema_version != 1 {
            return Err(CampaignStoreError::InvalidData);
        }

        let mut connection = self.connect()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        if generation_replayed(
            &transaction,
            &command.campaign_id,
            &command.npc_id,
            &command.generation.idempotency_key,
        )? {
            let profile = load_profile(&transaction, &command.npc_id)?
                .ok_or(CampaignStoreError::InvalidData)?;
            let input = if profile.lod == 3 {
                None
            } else {
                Some(generation_input(&transaction, &profile)?)
            };
            transaction.commit()?;
            return Ok(NpcLodGenerationSnapshot { profile, input });
        }
        let current =
            load_profile(&transaction, &command.npc_id)?.ok_or(CampaignStoreError::NotFound)?;
        if current.campaign_id != command.campaign_id
            || current.revision != command.expected_revision
            || current.lod == 3
            || command.expected_revision != current.lod + 1
        {
            return Err(CampaignStoreError::InvalidState);
        }
        let expected_input = generation_input(&transaction, &current)?;
        if command.generation.input != expected_input
            || command.generation.context
                != json!({
                    "campaignId": command.campaign_id,
                    "npcId": command.npc_id,
                    "expectedRevision": command.expected_revision,
                })
        {
            return Err(CampaignStoreError::InvalidData);
        }
        let references = allowed_references(&transaction, &current)?;
        validate_candidate(&current, &output.npc, &references)?;
        let at = current_timestamp()?;
        let next = profile_from_candidate(
            &current,
            output.npc,
            &command.generation.generation_record_id,
            &at,
        );
        validate_profile(&next)?;
        insert_character_generation(
            &transaction,
            &command.campaign_id,
            "GENERATE_NPC_LOD",
            &command.generation,
            &at,
        )?;
        update_profile(&transaction, &current, &next)?;
        insert_transition(
            &transaction,
            &current,
            &next,
            &command.trigger,
            &command.generation.idempotency_key,
        )?;
        let input = if next.lod == 3 {
            None
        } else {
            Some(generation_input(&transaction, &next)?)
        };
        transaction.commit()?;
        Ok(NpcLodGenerationSnapshot {
            profile: next,
            input,
        })
    }
}

fn trigger_for_revision(revision: i64) -> Result<&'static str, CampaignStoreError> {
    match revision {
        1 => Ok(TRIGGERS[0]),
        2 => Ok(TRIGGERS[1]),
        3 => Ok(TRIGGERS[2]),
        _ => Err(CampaignStoreError::InvalidState),
    }
}

fn locked_constitution(
    connection: &Connection,
    campaign_id: &str,
) -> Result<(i64, NpcLodConstitutionEvidence), CampaignStoreError> {
    connection
        .query_row(
            "SELECT revision,npc_rules,society,technology FROM world_constitutions
             WHERE campaign_id=?1 AND status='LOCKED'",
            [campaign_id],
            |row| {
                Ok((
                    row.get(0)?,
                    NpcLodConstitutionEvidence {
                        npc_rules: row.get(1)?,
                        society: row.get(2)?,
                        technology: row.get(3)?,
                    },
                ))
            },
        )
        .optional()?
        .ok_or(CampaignStoreError::InvalidState)
}

fn generation_input(
    connection: &Connection,
    profile: &NpcLodProfile,
) -> Result<Value, CampaignStoreError> {
    if profile.lod >= 3 {
        return Err(CampaignStoreError::InvalidState);
    }
    let references = allowed_references(connection, profile)?;
    Ok(json!({
        "schemaVersion": 1,
        "context": {
            "worldId": profile.campaign_id,
            "constitutionRevision": profile.constitution_revision,
            "contextSummary": format!("Promote {} without changing established identity or knowledge.", profile.population_role),
        },
        "currentProfile": candidate_projection(profile),
        "targetLod": profile.lod + 1,
        "trigger": TRIGGERS[profile.lod as usize],
        "allowedReferences": references,
        "constitutionEvidence": profile.constitution_evidence,
    }))
}

fn candidate_projection(profile: &NpcLodProfile) -> Value {
    json!({
        "npcId": profile.id,
        "lod": profile.lod,
        "identityAnchor": profile.identity_anchor,
        "populationRole": profile.population_role,
        "name": profile.name,
        "appearance": profile.appearance,
        "currentBehavior": profile.current_behavior,
        "career": profile.career,
        "personality": profile.personality,
        "goals": profile.goals,
        "knowledgeFactIds": profile.knowledge_fact_ids,
        "relationshipNpcIds": profile.relationship_npc_ids,
        "memoryIds": profile.memory_ids,
        "secretFactIds": profile.secret_fact_ids,
        "questIds": profile.quest_ids,
        "itemIds": profile.item_ids,
        "experienceEventIds": profile.experience_event_ids,
        "constitutionEvidence": profile.constitution_evidence,
    })
}

fn allowed_references(
    connection: &Connection,
    profile: &NpcLodProfile,
) -> Result<NpcLodReferences, CampaignStoreError> {
    Ok(NpcLodReferences {
        knowledge_fact_ids: query_ids(
            connection,
            "SELECT truth_id FROM actor_knowledge WHERE campaign_id=?1 AND actor_type='NPC'
             AND actor_id=?2 AND target_kind='TRUTH' AND knowledge_state='KNOWN'
             ORDER BY truth_id LIMIT 64",
            &profile.campaign_id,
            &profile.id,
        )?,
        relationship_npc_ids: query_ids(
            connection,
            "SELECT id FROM npc_lod_profiles WHERE campaign_id=?1 AND id<>?2 ORDER BY id LIMIT 64",
            &profile.campaign_id,
            &profile.id,
        )?,
        memory_ids: query_ids(
            connection,
            "SELECT memory.id FROM knowledge_memories memory
             WHERE memory.campaign_id=?1 AND memory.actor_type='NPC' AND memory.actor_id=?2
             AND EXISTS (SELECT 1 FROM memory_artifact_sources source
               WHERE source.artifact_kind='LONG_TERM' AND source.artifact_id=memory.id)
             AND NOT EXISTS (
               SELECT 1 FROM memory_artifact_sources source
               WHERE source.artifact_kind='LONG_TERM' AND source.artifact_id=memory.id AND (
                 (source.source_kind='KNOWLEDGE' AND NOT EXISTS (
                   SELECT 1 FROM actor_knowledge knowledge
                   WHERE knowledge.id=source.source_id AND knowledge.campaign_id=memory.campaign_id
                     AND knowledge.actor_type=memory.actor_type AND knowledge.actor_id=memory.actor_id
                     AND knowledge.revision=source.source_revision
                 )) OR
                 (source.source_kind='GAME_EVENT' AND NOT EXISTS (
                   SELECT 1 FROM game_events event WHERE event.id=source.source_id
                     AND event.campaign_id=memory.campaign_id
                     AND event.schema_version=source.source_revision
                 )) OR source.source_kind NOT IN ('KNOWLEDGE','GAME_EVENT')
               )
             ) ORDER BY memory.id LIMIT 64",
            &profile.campaign_id,
            &profile.id,
        )?,
        secret_fact_ids: query_ids(
            connection,
            "SELECT ak.truth_id FROM actor_knowledge ak JOIN world_truths wt ON wt.id=ak.truth_id
             WHERE ak.campaign_id=?1 AND ak.actor_type='NPC' AND ak.actor_id=?2
             AND ak.target_kind='TRUTH' AND ak.knowledge_state='KNOWN' AND wt.visibility='SECRET'
             ORDER BY ak.truth_id LIMIT 64",
            &profile.campaign_id,
            &profile.id,
        )?,
        quest_ids: query_campaign_ids(
            connection,
            "SELECT id FROM quests WHERE campaign_id=?1 AND
             (publisher_npc_id=?2 OR EXISTS
               (SELECT 1 FROM json_each(related_npc_ids_json) WHERE value=?2))
             ORDER BY id LIMIT 64",
            &profile.campaign_id,
            &profile.id,
        )?,
        item_ids: query_campaign_ids(
            connection,
            "SELECT id FROM items WHERE campaign_id=?1 AND EXISTS (
               SELECT 1 FROM json_each(content_json,'$.semanticEquipment.content.bindings') binding
               WHERE json_extract(binding.value,'$.kind')='NPC'
                 AND json_extract(binding.value,'$.targetId')=?2)
             ORDER BY id LIMIT 64",
            &profile.campaign_id,
            &profile.id,
        )?,
        experience_event_ids: query_ids(
            connection,
            "SELECT id FROM game_events WHERE campaign_id=?1 AND
             (json_extract(payload_json,'$.npcId')=?2 OR json_extract(payload_json,'$.actorId')=?2)
             ORDER BY occurred_at DESC,id LIMIT 64",
            &profile.campaign_id,
            &profile.id,
        )?,
    })
}

fn query_ids(
    connection: &Connection,
    sql: &str,
    campaign_id: &str,
    npc_id: &str,
) -> Result<Vec<String>, CampaignStoreError> {
    let mut statement = connection.prepare(sql)?;
    Ok(statement
        .query_map(params![campaign_id, npc_id], |row| row.get(0))?
        .collect::<Result<Vec<_>, _>>()?)
}

fn query_campaign_ids(
    connection: &Connection,
    sql: &str,
    campaign_id: &str,
    npc_id: &str,
) -> Result<Vec<String>, CampaignStoreError> {
    query_ids(connection, sql, campaign_id, npc_id)
}

fn validate_candidate(
    current: &NpcLodProfile,
    candidate: &NpcLodCandidate,
    allowed: &NpcLodReferences,
) -> Result<(), CampaignStoreError> {
    if candidate.npc_id != current.id
        || candidate.lod != current.lod + 1
        || candidate.identity_anchor != current.identity_anchor
        || candidate.population_role != current.population_role
        || candidate.constitution_evidence != current.constitution_evidence
    {
        return Err(CampaignStoreError::InvalidData);
    }
    preserve_optional(&current.name, &candidate.name)?;
    preserve_optional(&current.appearance, &candidate.appearance)?;
    preserve_optional(&current.current_behavior, &candidate.current_behavior)?;
    preserve_optional(&current.career, &candidate.career)?;
    preserve_optional(&current.personality, &candidate.personality)?;
    preserve_list(&current.goals, &candidate.goals)?;
    validate_reference_list(
        &current.knowledge_fact_ids,
        &candidate.knowledge_fact_ids,
        &allowed.knowledge_fact_ids,
    )?;
    validate_reference_list(
        &current.relationship_npc_ids,
        &candidate.relationship_npc_ids,
        &allowed.relationship_npc_ids,
    )?;
    validate_reference_list(
        &current.memory_ids,
        &candidate.memory_ids,
        &allowed.memory_ids,
    )?;
    validate_reference_list(
        &current.secret_fact_ids,
        &candidate.secret_fact_ids,
        &allowed.secret_fact_ids,
    )?;
    validate_reference_list(&current.quest_ids, &candidate.quest_ids, &allowed.quest_ids)?;
    validate_reference_list(&current.item_ids, &candidate.item_ids, &allowed.item_ids)?;
    validate_reference_list(
        &current.experience_event_ids,
        &candidate.experience_event_ids,
        &allowed.experience_event_ids,
    )?;
    validate_candidate_shape(candidate)
}

fn validate_candidate_shape(candidate: &NpcLodCandidate) -> Result<(), CampaignStoreError> {
    let lod_one = [
        &candidate.name,
        &candidate.appearance,
        &candidate.current_behavior,
    ];
    let lod_two = [&candidate.career, &candidate.personality];
    if candidate.lod >= 1 && lod_one.iter().any(|value| value.is_none()) {
        return Err(CampaignStoreError::InvalidData);
    }
    if candidate.lod < 2
        && (lod_two.iter().any(|value| value.is_some()) || !candidate.goals.is_empty())
    {
        return Err(CampaignStoreError::InvalidData);
    }
    if candidate.lod >= 2
        && (lod_two.iter().any(|value| value.is_none()) || candidate.goals.is_empty())
    {
        return Err(CampaignStoreError::InvalidData);
    }
    if candidate.lod < 2
        && (!candidate.knowledge_fact_ids.is_empty() || !candidate.relationship_npc_ids.is_empty())
    {
        return Err(CampaignStoreError::InvalidData);
    }
    if candidate.lod < 3
        && (!candidate.memory_ids.is_empty()
            || !candidate.secret_fact_ids.is_empty()
            || !candidate.quest_ids.is_empty()
            || !candidate.item_ids.is_empty()
            || !candidate.experience_event_ids.is_empty())
    {
        return Err(CampaignStoreError::InvalidData);
    }
    Ok(())
}

fn validate_profile(profile: &NpcLodProfile) -> Result<(), CampaignStoreError> {
    validate_id(&profile.id)?;
    validate_id(&profile.campaign_id)?;
    validate_text(&profile.identity_anchor, 200)?;
    validate_text(&profile.population_role, 200)?;
    if profile.kind != "NPC_LOD_PROFILE"
        || profile.schema_version != 1
        || !(0..=3).contains(&profile.lod)
        || profile.revision < 1
        || profile.constitution_revision < 1
    {
        return Err(CampaignStoreError::InvalidData);
    }
    validate_candidate_shape(&NpcLodCandidate {
        npc_id: profile.id.clone(),
        lod: profile.lod,
        identity_anchor: profile.identity_anchor.clone(),
        population_role: profile.population_role.clone(),
        name: profile.name.clone(),
        appearance: profile.appearance.clone(),
        current_behavior: profile.current_behavior.clone(),
        career: profile.career.clone(),
        personality: profile.personality.clone(),
        goals: profile.goals.clone(),
        knowledge_fact_ids: profile.knowledge_fact_ids.clone(),
        relationship_npc_ids: profile.relationship_npc_ids.clone(),
        memory_ids: profile.memory_ids.clone(),
        secret_fact_ids: profile.secret_fact_ids.clone(),
        quest_ids: profile.quest_ids.clone(),
        item_ids: profile.item_ids.clone(),
        experience_event_ids: profile.experience_event_ids.clone(),
        constitution_evidence: profile.constitution_evidence.clone(),
    })
}

fn preserve_optional(
    current: &Option<String>,
    candidate: &Option<String>,
) -> Result<(), CampaignStoreError> {
    if current
        .as_ref()
        .is_some_and(|value| candidate.as_ref() != Some(value))
    {
        return Err(CampaignStoreError::InvalidData);
    }
    Ok(())
}

fn preserve_list(current: &[String], candidate: &[String]) -> Result<(), CampaignStoreError> {
    let next = candidate.iter().collect::<HashSet<_>>();
    if current.iter().any(|value| !next.contains(value)) {
        return Err(CampaignStoreError::InvalidData);
    }
    validate_unique(candidate)
}

fn validate_reference_list(
    current: &[String],
    candidate: &[String],
    allowed: &[String],
) -> Result<(), CampaignStoreError> {
    preserve_list(current, candidate)?;
    let authority = allowed.iter().collect::<HashSet<_>>();
    if candidate.iter().any(|value| !authority.contains(value)) {
        return Err(CampaignStoreError::InvalidData);
    }
    Ok(())
}

fn validate_unique(values: &[String]) -> Result<(), CampaignStoreError> {
    if values.len() > 64 || values.iter().collect::<HashSet<_>>().len() != values.len() {
        return Err(CampaignStoreError::InvalidData);
    }
    for value in values {
        validate_text(value, 1_000)?;
    }
    Ok(())
}

fn validate_text(value: &str, max: usize) -> Result<(), CampaignStoreError> {
    if value.is_empty() || value.trim() != value || value.chars().count() > max {
        return Err(CampaignStoreError::InvalidData);
    }
    Ok(())
}

fn profile_from_candidate(
    current: &NpcLodProfile,
    candidate: NpcLodCandidate,
    generation_record_id: &str,
    at: &str,
) -> NpcLodProfile {
    NpcLodProfile {
        kind: current.kind.clone(),
        schema_version: current.schema_version,
        id: current.id.clone(),
        campaign_id: current.campaign_id.clone(),
        constitution_revision: current.constitution_revision,
        lod: candidate.lod,
        revision: current.revision + 1,
        identity_anchor: current.identity_anchor.clone(),
        population_role: current.population_role.clone(),
        name: candidate.name,
        appearance: candidate.appearance,
        current_behavior: candidate.current_behavior,
        career: candidate.career,
        personality: candidate.personality,
        goals: candidate.goals,
        knowledge_fact_ids: candidate.knowledge_fact_ids,
        relationship_npc_ids: candidate.relationship_npc_ids,
        memory_ids: candidate.memory_ids,
        secret_fact_ids: candidate.secret_fact_ids,
        quest_ids: candidate.quest_ids,
        item_ids: candidate.item_ids,
        experience_event_ids: candidate.experience_event_ids,
        constitution_evidence: current.constitution_evidence.clone(),
        generation_record_id: Some(generation_record_id.to_owned()),
        created_at: current.created_at.clone(),
        updated_at: at.to_owned(),
    }
}

fn insert_profile(
    transaction: &Transaction<'_>,
    profile: &NpcLodProfile,
) -> Result<(), CampaignStoreError> {
    transaction.execute(
        "INSERT INTO npc_lod_profiles
         (id,campaign_id,schema_version,constitution_revision,lod,revision,profile_json,
          generation_record_id,created_at,updated_at)
         VALUES (?1,?2,1,?3,0,1,?4,NULL,?5,?5)",
        params![
            profile.id,
            profile.campaign_id,
            profile.constitution_revision,
            serde_json::to_string(profile).map_err(|_| CampaignStoreError::InvalidData)?,
            profile.created_at,
        ],
    )?;
    Ok(())
}

fn update_profile(
    transaction: &Transaction<'_>,
    current: &NpcLodProfile,
    next: &NpcLodProfile,
) -> Result<(), CampaignStoreError> {
    let changed = transaction.execute(
        "UPDATE npc_lod_profiles SET lod=?1,revision=?2,profile_json=?3,
         generation_record_id=?4,updated_at=?5 WHERE id=?6 AND revision=?7 AND lod=?8",
        params![
            next.lod,
            next.revision,
            serde_json::to_string(next).map_err(|_| CampaignStoreError::InvalidData)?,
            next.generation_record_id,
            next.updated_at,
            next.id,
            current.revision,
            current.lod,
        ],
    )?;
    if changed != 1 {
        return Err(CampaignStoreError::InvalidState);
    }
    Ok(())
}

fn insert_transition(
    transaction: &Transaction<'_>,
    current: &NpcLodProfile,
    next: &NpcLodProfile,
    trigger: &str,
    idempotency_key: &str,
) -> Result<(), CampaignStoreError> {
    transaction.execute(
        "INSERT INTO npc_lod_transitions
         (id,campaign_id,npc_id,idempotency_key,from_lod,to_lod,trigger,before_revision,
          after_revision,before_profile_json,after_profile_json,generation_record_id,occurred_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)",
        params![
            format!("npc-lod-transition-{}", Uuid::new_v4()),
            next.campaign_id,
            next.id,
            idempotency_key,
            current.lod,
            next.lod,
            trigger,
            current.revision,
            next.revision,
            serde_json::to_string(current).map_err(|_| CampaignStoreError::InvalidData)?,
            serde_json::to_string(next).map_err(|_| CampaignStoreError::InvalidData)?,
            next.generation_record_id,
            next.updated_at,
        ],
    )?;
    Ok(())
}

fn load_profile(
    connection: &Connection,
    npc_id: &str,
) -> Result<Option<NpcLodProfile>, CampaignStoreError> {
    let value = connection
        .query_row(
            "SELECT profile_json FROM npc_lod_profiles WHERE id=?1",
            [npc_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    value
        .map(|json| {
            let profile: NpcLodProfile =
                serde_json::from_str(&json).map_err(|_| CampaignStoreError::InvalidData)?;
            validate_profile(&profile)?;
            let (revision, evidence) = locked_constitution(connection, &profile.campaign_id)?;
            if revision != profile.constitution_revision
                || evidence != profile.constitution_evidence
            {
                return Err(CampaignStoreError::InvalidData);
            }
            Ok(profile)
        })
        .transpose()
}

fn generation_replayed(
    connection: &Connection,
    campaign_id: &str,
    npc_id: &str,
    idempotency_key: &str,
) -> Result<bool, CampaignStoreError> {
    let row = connection
        .query_row(
            "SELECT campaign_id,npc_id FROM npc_lod_transitions WHERE idempotency_key=?1",
            [idempotency_key],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()?;
    match row {
        None => Ok(false),
        Some((stored_campaign, stored_npc))
            if stored_campaign == campaign_id && stored_npc == npc_id =>
        {
            Ok(true)
        }
        Some(_) => Err(CampaignStoreError::InvalidState),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn promotes_each_lod_idempotently_and_reloads_the_same_identity() {
        let directory = tempfile::tempdir().expect("temp directory");
        let path = directory.path().join("npc-lod.sqlite");
        let store = CampaignStore::open(&path).expect("open");
        seed_world(&store, "campaign-native-lod");
        let seed = store
            .create_npc_lod_seed(NpcLodSeedCommand {
                campaign_id: "campaign-native-lod".to_owned(),
                population_role: "Harbor passerby".to_owned(),
            })
            .expect("seed");
        assert_eq!(seed.profile.lod, 0);

        let first_command = generation_command(&seed, "first");
        let first = store.commit_npc_lod_upgrade(first_command).expect("LOD1");
        assert_eq!(first.profile.lod, 1);
        let replay = store
            .commit_npc_lod_upgrade(generation_command(&seed, "first"))
            .expect("replay");
        assert_eq!(replay.profile, first.profile);
        let second = store
            .commit_npc_lod_upgrade(generation_command(&first, "second"))
            .expect("LOD2");
        let third = store
            .commit_npc_lod_upgrade(generation_command(&second, "third"))
            .expect("LOD3");
        assert_eq!((second.profile.lod, third.profile.lod), (2, 3));
        assert_eq!(third.profile.revision, 4);
        assert_eq!(third.profile.identity_anchor, seed.profile.identity_anchor);
        assert_eq!(third.profile.name, first.profile.name);
        assert_eq!(third.profile.career, second.profile.career);
        assert!(third.input.is_none());
        drop(store);

        let reopened = CampaignStore::open(path).expect("reopen");
        let restored = reopened
            .npc_lod_generation_snapshot("campaign-native-lod", &seed.profile.id)
            .expect("restored");
        assert_eq!(restored, third);
    }

    #[test]
    fn rejects_stale_concurrency_identity_rewrite_and_unauthorized_fact() {
        let directory = tempfile::tempdir().expect("temp directory");
        let store =
            CampaignStore::open(directory.path().join("npc-lod-reject.sqlite")).expect("open");
        seed_world(&store, "campaign-native-lod-reject");
        let seed = store
            .create_npc_lod_seed(NpcLodSeedCommand {
                campaign_id: "campaign-native-lod-reject".to_owned(),
                population_role: "Market onlooker".to_owned(),
            })
            .expect("seed");
        let stale = generation_command(&seed, "stale");
        store
            .commit_npc_lod_upgrade(generation_command(&seed, "winner"))
            .expect("winner");
        assert!(matches!(
            store.commit_npc_lod_upgrade(stale),
            Err(CampaignStoreError::InvalidState)
        ));

        let current = store
            .npc_lod_generation_snapshot("campaign-native-lod-reject", &seed.profile.id)
            .expect("current");
        let mut rewrite = generation_command(&current, "rewrite");
        rewrite.generation.validated_output["npc"]["identityAnchor"] =
            Value::String("replacement-anchor".to_owned());
        rewrite.generation.raw_response_text = rewrite.generation.validated_output.to_string();
        assert!(matches!(
            store.commit_npc_lod_upgrade(rewrite),
            Err(CampaignStoreError::InvalidData)
        ));

        let mut leak = generation_command(&current, "leak");
        leak.generation.validated_output["npc"]["knowledgeFactIds"] = json!(["fact-not-known"]);
        leak.generation.raw_response_text = leak.generation.validated_output.to_string();
        assert!(matches!(
            store.commit_npc_lod_upgrade(leak),
            Err(CampaignStoreError::InvalidData)
        ));
    }

    fn generation_command(
        snapshot: &NpcLodGenerationSnapshot,
        suffix: &str,
    ) -> NpcLodUpgradeCommit {
        let input = snapshot.input.clone().expect("generation input");
        let target_lod = input["targetLod"].as_i64().expect("target LOD");
        let mut npc = input["currentProfile"].clone();
        npc["lod"] = json!(target_lod);
        match target_lod {
            1 => {
                npc["name"] = json!("Nera Fen");
                npc["appearance"] = json!("A rain-dark cloak.");
                npc["currentBehavior"] = json!("Studies the tide marks.");
            }
            2 => {
                npc["career"] = json!("Tide runner");
                npc["personality"] = json!("Watchful and patient.");
                npc["goals"] = json!(["Protect the harbor road"]);
            }
            3 => {}
            _ => panic!("unexpected LOD"),
        }
        let output = json!({"schemaVersion": 1, "npc": npc});
        NpcLodUpgradeCommit {
            campaign_id: snapshot.profile.campaign_id.clone(),
            npc_id: snapshot.profile.id.clone(),
            expected_revision: snapshot.profile.revision,
            trigger: input["trigger"].as_str().expect("trigger").to_owned(),
            generation: CharacterGenerationAudit {
                request_id: format!("request-npc-lod-{suffix}"),
                generation_record_id: format!("generation-npc-lod-{suffix}"),
                idempotency_key: format!("npc-lod:{suffix}"),
                prompt_version: 1,
                input,
                context: json!({
                    "campaignId": snapshot.profile.campaign_id,
                    "npcId": snapshot.profile.id,
                    "expectedRevision": snapshot.profile.revision,
                }),
                request: json!({"task": "GENERATE_NPC_LOD", "modelName": "fake"}),
                raw_response_text: output.to_string(),
                validated_output: output,
            },
        }
    }

    fn seed_world(store: &CampaignStore, campaign_id: &str) {
        store
            .create_at(
                campaign_id.to_owned(),
                "2026-08-20T00:00:00.000Z".to_owned(),
            )
            .expect("campaign");
        let connection = store.connect().expect("connection");
        connection
            .execute(
                "INSERT INTO world_constitutions
                 (campaign_id,schema_version,revision,status,world_type,era,technology,magic,
                  peoples_json,society,politics,economy,combat_scale,death_rules,career_rules,
                  equipment_rules,npc_rules,trait_rules,taboos_json,created_at,updated_at,locked_at)
                 VALUES (?1,1,1,'LOCKED','Low fantasy','Late medieval','Late medieval',
                  'Magic leaves a warm trace.','[\"Harbor folk\"]','Guild towns','Harbor councils',
                  'Coin and barter','Small-scale','Death is permanent.','Careers are social roles.',
                  'Equipment follows local craft.','NPC knowledge is bounded.',
                  'Traits require tradeoffs.','[]',?2,?2,?2)",
                params![campaign_id, "2026-08-20T00:00:00.000Z"],
            )
            .expect("constitution");
    }
}

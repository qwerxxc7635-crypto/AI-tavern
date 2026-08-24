use std::collections::HashSet;

use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

use crate::{
    CampaignStore, CampaignStoreError, CharacterGenerationAudit, current_timestamp,
    validate_character_generation_audit, validate_id,
};

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DialogueSuggestionPrepareCommand {
    pub campaign_id: String,
    pub scope_kind: String,
    pub scope_id: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DialogueSuggestion {
    pub id: String,
    pub text: String,
    pub addressed_npc_id: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DialogueSuggestionSet {
    pub cache_id: String,
    pub campaign_id: String,
    pub scope_kind: String,
    pub scope_id: String,
    pub context_digest: String,
    pub suggestions: Vec<DialogueSuggestion>,
    pub source: String,
    pub created_at: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DialogueSuggestionPreparation {
    pub input: Value,
    pub context_digest: String,
    pub cached: Option<DialogueSuggestionSet>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DialogueSuggestionCommit {
    pub cache_id: String,
    pub campaign_id: String,
    pub scope_kind: String,
    pub scope_id: String,
    pub expected_context_digest: String,
    pub generation: CharacterGenerationAudit,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct GeneratedSuggestion {
    text: String,
    addressed_npc_id: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct SuggestionOutput {
    suggestions: Vec<GeneratedSuggestion>,
}

impl CampaignStore {
    pub fn prepare_dialogue_suggestions(
        &self,
        command: DialogueSuggestionPrepareCommand,
    ) -> Result<DialogueSuggestionPreparation, CampaignStoreError> {
        validate_scope(&command.campaign_id, &command.scope_kind, &command.scope_id)?;
        build_preparation(
            &self.connect()?,
            &command.campaign_id,
            &command.scope_kind,
            &command.scope_id,
        )
    }

    pub fn commit_dialogue_suggestions(
        &self,
        command: DialogueSuggestionCommit,
    ) -> Result<DialogueSuggestionSet, CampaignStoreError> {
        validate_id(&command.cache_id)?;
        validate_scope(&command.campaign_id, &command.scope_kind, &command.scope_id)?;
        validate_digest(&command.expected_context_digest)?;
        validate_character_generation_audit(&command.generation, "GENERATE_DIALOGUE_SUGGESTIONS")?;
        let mut connection = self.connect()?;
        let tx = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let current = build_preparation(
            &tx,
            &command.campaign_id,
            &command.scope_kind,
            &command.scope_id,
        )?;
        if let Some(cached) = current.cached.clone() {
            tx.commit()?;
            return Ok(cached);
        }
        if current.context_digest != command.expected_context_digest
            || current.input != command.generation.input
            || command.generation.context
                != json!({
                    "scopeKind": command.scope_kind,
                    "scopeId": command.scope_id,
                    "contextDigest": command.expected_context_digest,
                })
        {
            return Err(CampaignStoreError::FactConflict);
        }
        let output: SuggestionOutput =
            serde_json::from_value(command.generation.validated_output.clone())
                .map_err(|_| CampaignStoreError::InvalidData)?;
        validate_suggestions(&current.input, &output.suggestions)?;
        let at = current_timestamp()?;
        tx.execute(
            "INSERT INTO pending_ai_requests(
               id,campaign_id,turn_id,idempotency_key,task,status,model_profile_id,
               input_json,context_json,attempt_count,last_error_json,created_at,updated_at
             ) VALUES(?1,?2,NULL,?3,'GENERATE_DIALOGUE_SUGGESTIONS','COMMITTED',NULL,
               ?4,?5,1,NULL,?6,?6)",
            params![
                command.generation.request_id,
                command.campaign_id,
                command.generation.idempotency_key,
                current.input.to_string(),
                command.generation.context.to_string(),
                at,
            ],
        )?;
        tx.execute(
            "INSERT INTO generation_records(
               id,campaign_id,request_id,task,model_profile_id,prompt_version,request_json,
               raw_response_text,validated_output_json,validation_error_json,started_at,completed_at
             ) VALUES(?1,?2,?3,'GENERATE_DIALOGUE_SUGGESTIONS',NULL,?4,?5,?6,?7,NULL,?8,?8)",
            params![
                command.generation.generation_record_id,
                command.campaign_id,
                command.generation.request_id,
                command.generation.prompt_version,
                command.generation.request.to_string(),
                command.generation.raw_response_text,
                serde_json::to_string(&output).map_err(|_| CampaignStoreError::InvalidData)?,
                at,
            ],
        )?;
        tx.execute(
            "INSERT INTO dialogue_suggestion_cache(
               id,campaign_id,scope_kind,scope_id,context_digest,suggestions_json,
               generation_record_id,created_at
             ) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)",
            params![
                command.cache_id,
                command.campaign_id,
                command.scope_kind,
                command.scope_id,
                command.expected_context_digest,
                serde_json::to_string(&output.suggestions)
                    .map_err(|_| CampaignStoreError::InvalidData)?,
                command.generation.generation_record_id,
                at,
            ],
        )?;
        let result = load_cached(
            &tx,
            &command.campaign_id,
            &command.scope_kind,
            &command.scope_id,
            &command.expected_context_digest,
            "GENERATED",
        )?
        .ok_or(CampaignStoreError::InvalidData)?;
        tx.commit()?;
        Ok(result)
    }
}

fn build_preparation(
    connection: &Connection,
    campaign_id: &str,
    scope_kind: &str,
    scope_id: &str,
) -> Result<DialogueSuggestionPreparation, CampaignStoreError> {
    let (summary, current_region): (String, String) = connection
        .query_row(
            "SELECT summary,current_region FROM world_bibles WHERE campaign_id=?1",
            [campaign_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?
        .ok_or(CampaignStoreError::InvalidData)?;
    let (player_name, concept, personal_goal): (String, String, String) = connection
        .query_row(
            "SELECT name,concept,personal_goal FROM player_characters WHERE campaign_id=?1",
            [campaign_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()?
        .ok_or(CampaignStoreError::InvalidData)?;
    let (participants, relationship, recent_messages) = match scope_kind {
        "NPC_DIALOGUE" => npc_context(connection, campaign_id, scope_id)?,
        "TAVERN_SCENE" => scene_context(connection, campaign_id, scope_id)?,
        _ => return Err(CampaignStoreError::InvalidData),
    };
    let open_quests = query_json_rows(
        connection,
        "SELECT json_object(
           'id',id,'title',COALESCE(json_extract(content_json,'$.title'),id),'status',status
         ) FROM quests
         WHERE campaign_id=?1 AND status IN ('AVAILABLE','ACCEPTED','ACTIVE')
         ORDER BY updated_at DESC,id LIMIT 12",
        campaign_id,
    )?;
    let input = json!({
        "scopeKind": scope_kind,
        "scopeId": scope_id,
        "world": { "summary": summary, "currentRegion": current_region },
        "player": { "name": player_name, "concept": concept, "personalGoal": personal_goal },
        "participants": participants,
        "relationship": relationship,
        "recentMessages": recent_messages,
        "openQuests": open_quests,
    });
    let campaign_signal = parse_json_text(connection.query_row(
        "SELECT json_object('state',state,'updatedAt',updated_at) FROM campaigns WHERE id=?1",
        [campaign_id],
        |row| row.get::<_, String>(0),
    )?)?;
    let scope_signal = match scope_kind {
        "NPC_DIALOGUE" => parse_json_text(connection.query_row(
            "SELECT json_object(
               'npcUpdatedAt',n.updated_at,
               'relationshipUpdatedAt',r.updated_at,
               'conversationUpdatedAt',COALESCE(c.updated_at,'')
             ) FROM npcs n JOIN npc_relationships r ON r.npc_id=n.id
             LEFT JOIN conversations c ON c.id=(
               SELECT id FROM conversations
               WHERE campaign_id=?1 AND kind='NPC' AND npc_id=?2
               ORDER BY created_at,id LIMIT 1
             )
             WHERE n.campaign_id=?1 AND n.id=?2",
            params![campaign_id, scope_id],
            |row| row.get::<_, String>(0),
        )?)?,
        "TAVERN_SCENE" => parse_json_text(connection.query_row(
            "SELECT json_object('revision',revision,'status',status,'updatedAt',updated_at)
             FROM tavern_scenes WHERE campaign_id=?1 AND id=?2",
            params![campaign_id, scope_id],
            |row| row.get::<_, String>(0),
        )?)?,
        _ => return Err(CampaignStoreError::InvalidData),
    };
    let signals = json!({
        "campaign": campaign_signal,
        "scope": scope_signal,
        "worldFacts": query_json_rows(connection,
            "SELECT json_object('id',id,'kind',kind,'supersedesFactId',supersedes_fact_id,'createdAt',created_at)
             FROM world_facts WHERE campaign_id=?1 ORDER BY created_at,id", campaign_id)?,
        "clocks": query_json_rows(connection,
            "SELECT json_object('id',id,'current',current,'max',max,'updatedAt',updated_at)
             FROM world_clocks WHERE campaign_id=?1 ORDER BY id", campaign_id)?,
        "factions": query_json_rows(connection,
            "SELECT json_object('id',id,'revision',revision,'updatedAt',updated_at)
             FROM active_factions WHERE campaign_id=?1 ORDER BY id", campaign_id)?,
        "location": query_json_rows(connection,
            "SELECT json_object('id',current_location_id,'revision',revision,'updatedAt',updated_at)
             FROM campaign_location_states WHERE campaign_id=?1", campaign_id)?,
        "population": query_json_rows(connection,
            "SELECT json_object('tavernId',tavern_id,'revision',revision,'projectedAt',projected_at)
             FROM tavern_population_states WHERE campaign_id=?1 ORDER BY tavern_id", campaign_id)?,
        "latestEvent": query_json_rows(connection,
            "SELECT json_object('id',id,'type',type,'occurredAt',occurred_at)
             FROM game_events WHERE campaign_id=?1 ORDER BY occurred_at DESC,id DESC LIMIT 1",
            campaign_id)?,
    });
    let digest = hex_sha256(
        json!({ "campaignId": campaign_id, "input": &input, "signals": signals })
            .to_string()
            .as_bytes(),
    );
    let cached = load_cached(
        connection,
        campaign_id,
        scope_kind,
        scope_id,
        &digest,
        "CACHE",
    )?;
    if let Some(cached) = &cached {
        let cached_values = cached
            .suggestions
            .iter()
            .map(|suggestion| GeneratedSuggestion {
                text: suggestion.text.clone(),
                addressed_npc_id: suggestion.addressed_npc_id.clone(),
            })
            .collect::<Vec<_>>();
        validate_suggestions(&input, &cached_values)?;
    }
    Ok(DialogueSuggestionPreparation {
        input,
        context_digest: digest,
        cached,
    })
}

fn npc_context(
    connection: &Connection,
    campaign_id: &str,
    npc_id: &str,
) -> Result<(Vec<Value>, Value, Vec<Value>), CampaignStoreError> {
    let participant: String = connection
        .query_row(
            "SELECT json_object(
               'id',id,'name',name,'identity',identity,'status','ACTIVE'
             ) FROM npcs WHERE id=?1 AND campaign_id=?2 AND current_status='ACTIVE'",
            params![npc_id, campaign_id],
            |row| row.get(0),
        )
        .optional()?
        .ok_or(CampaignStoreError::NotFound)?;
    let relationship: String = connection.query_row(
        "SELECT json_object('trust',trust,'closeness',closeness,'awe',awe,'obligation',obligation)
         FROM npc_relationships WHERE npc_id=?1",
        [npc_id],
        |row| row.get(0),
    )?;
    let messages = query_json_rows_with_two(
        connection,
        "SELECT json_object(
           'role',role,'speakerNpcId',speaker_npc_id,'content',content
         ) FROM messages WHERE conversation_id=(
           SELECT id FROM conversations
           WHERE campaign_id=?1 AND kind='NPC' AND npc_id=?2 ORDER BY created_at,id LIMIT 1
         ) ORDER BY sequence_number DESC LIMIT 12",
        campaign_id,
        npc_id,
    )?;
    Ok((
        vec![parse_json_text(participant)?],
        parse_json_text(relationship)?,
        messages.into_iter().rev().collect(),
    ))
}

fn scene_context(
    connection: &Connection,
    campaign_id: &str,
    scene_id: &str,
) -> Result<(Vec<Value>, Value, Vec<Value>), CampaignStoreError> {
    let status: String = connection
        .query_row(
            "SELECT status FROM tavern_scenes WHERE id=?1 AND campaign_id=?2",
            params![scene_id, campaign_id],
            |row| row.get(0),
        )
        .optional()?
        .ok_or(CampaignStoreError::NotFound)?;
    if status != "ACTIVE" {
        return Err(CampaignStoreError::InvalidState);
    }
    let participants = query_json_rows_with_two(
        connection,
        "SELECT json_object(
           'id',npc_id,'name',name,'identity',population_role,'status',status
         ) FROM tavern_scene_participants
         WHERE scene_id=?2 AND campaign_id=?1 AND status<>'LEFT'
         ORDER BY joined_at,npc_id",
        campaign_id,
        scene_id,
    )?;
    if participants.len() < 2 {
        return Err(CampaignStoreError::InvalidState);
    }
    let mut messages = Vec::new();
    let mut statement = connection.prepare(
        "SELECT player_intent,actions_json FROM tavern_scene_turns
         WHERE scene_id=?1 AND campaign_id=?2 ORDER BY sequence DESC LIMIT 6",
    )?;
    let turns = statement
        .query_map(params![scene_id, campaign_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    for (player_intent, actions) in turns.into_iter().rev() {
        messages.push(json!({
            "role": "PLAYER", "speakerNpcId": null, "content": player_intent
        }));
        let actions: Vec<Value> =
            serde_json::from_str(&actions).map_err(|_| CampaignStoreError::InvalidData)?;
        for action in actions
            .into_iter()
            .filter(|action| action["selected"].as_bool() == Some(true))
        {
            let content = action["utterance"]
                .as_str()
                .or_else(|| action["action"].as_str())
                .ok_or(CampaignStoreError::InvalidData)?;
            messages.push(json!({
                "role": if action["utterance"].is_string() { "NPC" } else { "SYSTEM" },
                "speakerNpcId": action["actorId"],
                "content": content,
            }));
        }
    }
    Ok((participants, Value::Null, messages))
}

fn load_cached(
    connection: &Connection,
    campaign_id: &str,
    scope_kind: &str,
    scope_id: &str,
    context_digest: &str,
    source: &str,
) -> Result<Option<DialogueSuggestionSet>, CampaignStoreError> {
    let row = connection
        .query_row(
            "SELECT id,suggestions_json,created_at FROM dialogue_suggestion_cache
             WHERE campaign_id=?1 AND scope_kind=?2 AND scope_id=?3 AND context_digest=?4",
            params![campaign_id, scope_kind, scope_id, context_digest],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            },
        )
        .optional()?;
    row.map(|(id, suggestions, created_at)| {
        let generated: Vec<GeneratedSuggestion> =
            serde_json::from_str(&suggestions).map_err(|_| CampaignStoreError::InvalidData)?;
        Ok(DialogueSuggestionSet {
            cache_id: id.clone(),
            campaign_id: campaign_id.to_owned(),
            scope_kind: scope_kind.to_owned(),
            scope_id: scope_id.to_owned(),
            context_digest: context_digest.to_owned(),
            suggestions: generated
                .into_iter()
                .enumerate()
                .map(|(index, suggestion)| DialogueSuggestion {
                    id: format!("{id}:{}", index + 1),
                    text: suggestion.text,
                    addressed_npc_id: suggestion.addressed_npc_id,
                })
                .collect(),
            source: source.to_owned(),
            created_at,
        })
    })
    .transpose()
}

fn validate_suggestions(
    input: &Value,
    values: &[GeneratedSuggestion],
) -> Result<(), CampaignStoreError> {
    if !(3..=5).contains(&values.len()) {
        return Err(CampaignStoreError::InvalidData);
    }
    let participants = input["participants"]
        .as_array()
        .ok_or(CampaignStoreError::InvalidData)?;
    let participant_ids = participants
        .iter()
        .filter_map(|participant| participant["id"].as_str())
        .collect::<HashSet<_>>();
    let npc_scope = input["scopeKind"] == "NPC_DIALOGUE";
    let mut unique = HashSet::new();
    for suggestion in values {
        let normalized = suggestion.text.trim().to_lowercase();
        if normalized.is_empty()
            || normalized.chars().count() > 4_000
            || !unique.insert(normalized)
            || suggestion
                .addressed_npc_id
                .as_ref()
                .is_some_and(|id| !participant_ids.contains(id.as_str()))
            || npc_scope && suggestion.addressed_npc_id.as_deref() != participants[0]["id"].as_str()
        {
            return Err(CampaignStoreError::InvalidData);
        }
    }
    Ok(())
}

fn query_json_rows(
    connection: &Connection,
    sql: &str,
    campaign_id: &str,
) -> Result<Vec<Value>, CampaignStoreError> {
    let mut statement = connection.prepare(sql)?;
    statement
        .query_map([campaign_id], |row| row.get::<_, String>(0))?
        .map(|row| parse_json_text(row?))
        .collect::<Result<Vec<_>, _>>()
}

fn query_json_rows_with_two(
    connection: &Connection,
    sql: &str,
    first: &str,
    second: &str,
) -> Result<Vec<Value>, CampaignStoreError> {
    let mut statement = connection.prepare(sql)?;
    statement
        .query_map(params![first, second], |row| row.get::<_, String>(0))?
        .map(|row| parse_json_text(row?))
        .collect::<Result<Vec<_>, _>>()
}

fn parse_json_text(value: String) -> Result<Value, CampaignStoreError> {
    serde_json::from_str(&value).map_err(|_| CampaignStoreError::InvalidData)
}

fn validate_scope(
    campaign_id: &str,
    scope_kind: &str,
    scope_id: &str,
) -> Result<(), CampaignStoreError> {
    validate_id(campaign_id)?;
    validate_id(scope_id)?;
    if !matches!(scope_kind, "NPC_DIALOGUE" | "TAVERN_SCENE") {
        return Err(CampaignStoreError::InvalidData);
    }
    Ok(())
}

fn validate_digest(value: &str) -> Result<(), CampaignStoreError> {
    if value.len() != 64
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(CampaignStoreError::InvalidData);
    }
    Ok(())
}

fn hex_sha256(value: &[u8]) -> String {
    let digest = Sha256::digest(value);
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn public_context_cache_and_world_invalidation_are_enforced() {
        let directory = tempfile::tempdir().expect("temp directory");
        let store =
            CampaignStore::open(directory.path().join("suggestions.sqlite")).expect("open store");
        seed_npc_scope(&store);

        let first = prepare(&store);
        assert!(first.cached.is_none());
        let serialized = first.input.to_string();
        assert!(serialized.contains("The cellar is sealed"));
        assert!(!serialized.contains("royal tunnel"));
        let committed = store
            .commit_dialogue_suggestions(commit(&first, "one"))
            .expect("commit suggestions");
        assert_eq!(committed.suggestions.len(), 3);
        assert_eq!(committed.source, "GENERATED");

        let cached = prepare(&store);
        assert_eq!(cached.context_digest, first.context_digest);
        assert_eq!(cached.cached.expect("cached suggestions").source, "CACHE");

        let connection = store.connect().expect("connect");
        connection
            .execute(
                "UPDATE npc_relationships SET trust=1,updated_at='2026-08-24T01:00:00.000Z'
                 WHERE npc_id='npc-owner'",
                [],
            )
            .expect("change public world state");
        drop(connection);
        let changed = prepare(&store);
        assert_ne!(changed.context_digest, first.context_digest);
        assert!(changed.cached.is_none());

        let connection = store.connect().expect("inspect persistence");
        let cache_count: i64 = connection
            .query_row(
                "SELECT count(*) FROM dialogue_suggestion_cache",
                [],
                |row| row.get(0),
            )
            .expect("count cache");
        let action_count: i64 = connection
            .query_row("SELECT count(*) FROM messages", [], |row| row.get(0))
            .expect("count messages");
        assert_eq!(cache_count, 1);
        assert_eq!(action_count, 1);
        drop(connection);
        store
            .delete_campaign("campaign-dialogue")
            .expect("delete campaign with derived cache");
    }

    #[test]
    fn stale_context_and_unknown_addressee_cannot_commit() {
        let directory = tempfile::tempdir().expect("temp directory");
        let store =
            CampaignStore::open(directory.path().join("invalid.sqlite")).expect("open store");
        seed_npc_scope(&store);
        let prepared = prepare(&store);
        let mut stale = commit(&prepared, "stale");
        stale.expected_context_digest = "b".repeat(64);
        assert!(matches!(
            store.commit_dialogue_suggestions(stale),
            Err(CampaignStoreError::FactConflict)
        ));

        let mut invalid = commit(&prepared, "invalid");
        invalid.generation.validated_output["suggestions"][0]["addressedNpcId"] =
            json!("npc-hidden");
        invalid.generation.raw_response_text = invalid.generation.validated_output.to_string();
        assert!(matches!(
            store.commit_dialogue_suggestions(invalid),
            Err(CampaignStoreError::InvalidData)
        ));
    }

    fn prepare(store: &CampaignStore) -> DialogueSuggestionPreparation {
        store
            .prepare_dialogue_suggestions(DialogueSuggestionPrepareCommand {
                campaign_id: "campaign-dialogue".to_owned(),
                scope_kind: "NPC_DIALOGUE".to_owned(),
                scope_id: "npc-owner".to_owned(),
            })
            .expect("prepare suggestions")
    }

    fn commit(prepared: &DialogueSuggestionPreparation, suffix: &str) -> DialogueSuggestionCommit {
        let output = json!({
            "suggestions": [
                { "text": "Who sealed the cellar?", "addressedNpcId": "npc-owner" },
                { "text": "Ask about the harbor road.", "addressedNpcId": "npc-owner" },
                { "text": "Offer to inspect the door.", "addressedNpcId": "npc-owner" }
            ]
        });
        DialogueSuggestionCommit {
            cache_id: format!("suggestion-cache-{suffix}"),
            campaign_id: "campaign-dialogue".to_owned(),
            scope_kind: "NPC_DIALOGUE".to_owned(),
            scope_id: "npc-owner".to_owned(),
            expected_context_digest: prepared.context_digest.clone(),
            generation: CharacterGenerationAudit {
                request_id: format!("suggestion-request-{suffix}"),
                generation_record_id: format!("suggestion-generation-{suffix}"),
                idempotency_key: format!("suggestion-key-{suffix}"),
                prompt_version: 1,
                input: prepared.input.clone(),
                context: json!({
                    "scopeKind": "NPC_DIALOGUE",
                    "scopeId": "npc-owner",
                    "contextDigest": prepared.context_digest,
                }),
                request: json!({ "task": "GENERATE_DIALOGUE_SUGGESTIONS" }),
                raw_response_text: output.to_string(),
                validated_output: output,
            },
        }
    }

    fn seed_npc_scope(store: &CampaignStore) {
        store
            .connect()
            .expect("connect")
            .execute_batch(
                r#"INSERT INTO campaigns(id,schema_version,state,resume_state,created_at,updated_at)
                   VALUES('campaign-dialogue',22,'TAVERN',NULL,'2026-08-24T00:00:00.000Z','2026-08-24T00:00:00.000Z');
                   INSERT INTO world_bibles(
                     campaign_id,schema_version,name,current_region,summary,core_conflict,
                     technology_level,power_rules_json,factions_json,locations_json,narrative_style,
                     forbidden_elements_json,tavern_reason,story_hooks_json,locked_fields_json,
                     created_at,updated_at
                   ) VALUES(
                     'campaign-dialogue',1,'Ember Coast','Ash Harbor','A storm-bound coast.',
                     'The beacon is fading.','Late medieval','[]','[]','[]','Grounded','[]',
                     'Travelers gather here.','[]','[]','2026-08-24T00:00:00.000Z','2026-08-24T00:00:00.000Z'
                   );
                   INSERT INTO player_characters(
                     id,campaign_id,name,gender,age,concept,story_preferences_json,
                     content_boundaries_json,class_archetype,class_display_name,attributes_json,
                     traits_json,personal_goal,background_json,initial_equipment_ids_json,
                     created_at,updated_at
                   ) VALUES(
                     'character-player','campaign-dialogue','Mara',NULL,NULL,'Scout','[]','[]',
                     'ROGUE','Scout','{}','[]','Find the road.','{}','[]',
                     '2026-08-24T00:00:00.000Z','2026-08-24T00:00:00.000Z'
                   );
                   INSERT INTO taverns(
                     id,campaign_id,location_id,name,position,environment,special_rules_json,
                     long_term_problem,owner_npc_id,changes_json,created_at,updated_at
                   ) VALUES(
                     'tavern-rest','campaign-dialogue','location-harbor','Ember Rest','Crossroads',
                     'Warm stone hall.','[]','Cellar light.',NULL,'[]',
                     '2026-08-24T00:00:00.000Z','2026-08-24T00:00:00.000Z'
                   );
                   INSERT INTO npcs(
                     id,campaign_id,tavern_id,residency,name,identity,appearance,personality,goal,
                     secret,speech_style,current_mood,current_status,visit_json,memories_json,
                     created_at,updated_at
                   ) VALUES(
                     'npc-owner','campaign-dialogue','tavern-rest','OWNER','Ilyra','Innkeeper',
                     'A red coat.','Observant.','Keep the road open.','The royal tunnel is below.',
                     'Measured.','Wary','ACTIVE',NULL,'[]',
                     '2026-08-24T00:00:00.000Z','2026-08-24T00:00:00.000Z'
                   );
                   UPDATE taverns SET owner_npc_id='npc-owner' WHERE id='tavern-rest';
                   INSERT INTO npc_relationships(
                     npc_id,player_character_id,trust,closeness,awe,obligation,updated_at
                   ) VALUES('npc-owner','character-player',0,0,0,0,'2026-08-24T00:00:00.000Z');
                   INSERT INTO world_constitutions(
                     campaign_id,schema_version,revision,status,world_type,era,technology,magic,
                     peoples_json,society,politics,economy,combat_scale,death_rules,career_rules,
                     equipment_rules,npc_rules,trait_rules,taboos_json,created_at,updated_at,locked_at
                   ) VALUES(
                     'campaign-dialogue',1,1,'LOCKED','Fantasy','Medieval','Steel','Rare','[]',
                     'Guilds','Council','Coin','Personal','Final','Open','Grounded','Persistent',
                     'Balanced','[]','2026-08-24T00:00:00.000Z','2026-08-24T00:00:00.000Z',
                     '2026-08-24T00:00:00.000Z'
                   );
                   INSERT INTO npc_lod_profiles(
                     id,campaign_id,schema_version,constitution_revision,lod,revision,profile_json,
                     generation_record_id,created_at,updated_at
                   ) VALUES(
                     'npc-owner','campaign-dialogue',1,1,3,1,'{}',NULL,
                     '2026-08-24T00:00:00.000Z','2026-08-24T00:00:00.000Z'
                   );
                   INSERT INTO conversations(
                     id,campaign_id,kind,npc_id,adventure_id,created_at,updated_at
                   ) VALUES(
                     'conversation-owner','campaign-dialogue','NPC','npc-owner',NULL,
                     '2026-08-24T00:00:00.000Z','2026-08-24T00:00:00.000Z'
                   );
                   INSERT INTO messages(
                     id,conversation_id,sequence_number,role,speaker_npc_id,content,created_at
                   ) VALUES(
                     'message-owner','conversation-owner',1,'NPC','npc-owner',
                     'The cellar is sealed.','2026-08-24T00:00:00.000Z'
                   );"#,
            )
            .expect("seed NPC suggestion scope");
    }
}

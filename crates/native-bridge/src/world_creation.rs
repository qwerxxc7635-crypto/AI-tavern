use std::collections::{HashMap, HashSet};

use rusqlite::{Connection, OptionalExtension, Transaction, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

use crate::{CampaignStore, CampaignStoreError, current_timestamp, validate_id};

const LOCKABLE_FIELDS: &[&str] = &[
    "name",
    "currentRegion",
    "summary",
    "coreConflict",
    "technologyLevel",
    "powerRules",
    "narrativeStyle",
    "forbiddenElements",
    "tavernReason",
];

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct FactionDraft {
    pub name: String,
    pub description: String,
    pub goals: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct LocationDraft {
    pub name: String,
    pub description: String,
    pub parent_name: Option<String>,
    pub faction_names: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct WorldDraft {
    pub name: String,
    pub current_region: String,
    pub summary: String,
    pub core_conflict: String,
    pub technology_level: String,
    pub power_rules: Vec<String>,
    pub factions: Vec<FactionDraft>,
    pub locations: Vec<LocationDraft>,
    pub narrative_style: String,
    pub forbidden_elements: Vec<String>,
    pub tavern_reason: String,
    pub story_hooks: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorldBibleView {
    pub campaign_id: String,
    #[serde(flatten)]
    pub draft: WorldDraft,
    pub locked_fields: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorldCreationSnapshot {
    pub campaign_state: String,
    pub world: Option<WorldBibleView>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum WorldGenerationTask {
    GenerateWorld,
    RefineWorld,
}

impl WorldGenerationTask {
    fn database_name(self) -> &'static str {
        match self {
            Self::GenerateWorld => "GENERATE_WORLD",
            Self::RefineWorld => "REFINE_WORLD",
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct WorldGenerationCommit {
    pub campaign_id: String,
    pub task: WorldGenerationTask,
    pub request_id: String,
    pub generation_record_id: String,
    pub idempotency_key: String,
    pub prompt_version: i64,
    pub input: Value,
    pub request: Value,
    pub raw_response_text: String,
    pub validated_output: Value,
    pub world: WorldDraft,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct WorldManualUpdate {
    pub campaign_id: String,
    pub world: WorldDraft,
    pub locked_fields: Vec<String>,
}

impl CampaignStore {
    pub fn world_creation_snapshot(
        &self,
        campaign_id: &str,
    ) -> Result<WorldCreationSnapshot, CampaignStoreError> {
        validate_id(campaign_id)?;
        let connection = self.connect()?;
        snapshot(&connection, campaign_id)
    }

    pub fn commit_world_generation(
        &self,
        command: WorldGenerationCommit,
    ) -> Result<WorldCreationSnapshot, CampaignStoreError> {
        validate_generation_command(&command)?;
        let mut connection = self.connect()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;

        if let Some((status, campaign_id, task)) = transaction
            .query_row(
                "SELECT status, campaign_id, task
                 FROM pending_ai_requests WHERE idempotency_key = ?1",
                [&command.idempotency_key],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                    ))
                },
            )
            .optional()?
        {
            if status == "COMMITTED"
                && campaign_id == command.campaign_id
                && task == command.task.database_name()
            {
                let result = snapshot(&transaction, &command.campaign_id)?;
                transaction.commit()?;
                return Ok(result);
            }
            return Err(CampaignStoreError::InvalidState);
        }

        let state = require_campaign_state(&transaction, &command.campaign_id)?;
        let current = load_world(&transaction, &command.campaign_id)?;
        match command.task {
            WorldGenerationTask::GenerateWorld
                if state == "CREATING_WORLD" && current.is_none() => {}
            WorldGenerationTask::RefineWorld if state == "REVIEWING_WORLD" && current.is_some() => {
            }
            _ => return Err(CampaignStoreError::InvalidState),
        }
        validate_world_draft(&command.world)?;
        if let Some(existing) = &current {
            validate_locked_values(existing, &command.world)?;
        }

        let at = current_timestamp()?;
        let world = build_world_view(&command.campaign_id, command.world, current.as_ref(), &at)?;
        save_world(&transaction, &world, current.as_ref())?;
        transaction.execute(
            "UPDATE campaigns SET state = 'REVIEWING_WORLD', resume_state = NULL, updated_at = ?1
             WHERE id = ?2",
            params![at, command.campaign_id],
        )?;
        transaction.execute(
            "INSERT INTO pending_ai_requests (
               id, campaign_id, turn_id, idempotency_key, task, status, model_profile_id,
               input_json, context_json, attempt_count, last_error_json, created_at, updated_at
             ) VALUES (?1, ?2, NULL, ?3, ?4, 'COMMITTED', NULL, ?5, ?5, 1, NULL, ?6, ?6)",
            params![
                command.request_id,
                command.campaign_id,
                command.idempotency_key,
                command.task.database_name(),
                serde_json::to_string(&command.input)
                    .map_err(|_| CampaignStoreError::InvalidData)?,
                at
            ],
        )?;
        transaction.execute(
            "INSERT INTO generation_records (
               id, campaign_id, request_id, task, model_profile_id, prompt_version,
               request_json, raw_response_text, validated_output_json,
               validation_error_json, started_at, completed_at
             ) VALUES (?1, ?2, ?3, ?4, NULL, ?5, ?6, ?7, ?8, NULL, ?9, ?9)",
            params![
                command.generation_record_id,
                command.campaign_id,
                command.request_id,
                command.task.database_name(),
                command.prompt_version,
                serde_json::to_string(&command.request)
                    .map_err(|_| CampaignStoreError::InvalidData)?,
                command.raw_response_text,
                serde_json::to_string(&command.validated_output)
                    .map_err(|_| CampaignStoreError::InvalidData)?,
                at
            ],
        )?;
        transaction.commit()?;
        self.world_creation_snapshot(&command.campaign_id)
    }

    pub fn update_world_draft(
        &self,
        command: WorldManualUpdate,
    ) -> Result<WorldCreationSnapshot, CampaignStoreError> {
        validate_id(&command.campaign_id)?;
        validate_world_draft(&command.world)?;
        validate_locks(&command.locked_fields)?;
        let mut connection = self.connect()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        if require_campaign_state(&transaction, &command.campaign_id)? != "REVIEWING_WORLD" {
            return Err(CampaignStoreError::InvalidState);
        }
        let current = load_world(&transaction, &command.campaign_id)?
            .ok_or(CampaignStoreError::InvalidData)?;
        validate_locked_values(&current, &command.world)?;
        let at = current_timestamp()?;
        let mut world = build_world_view(&command.campaign_id, command.world, Some(&current), &at)?;
        world.locked_fields = command.locked_fields;
        save_world(&transaction, &world, Some(&current))?;
        transaction.execute(
            "UPDATE campaigns SET updated_at = ?1 WHERE id = ?2",
            params![at, command.campaign_id],
        )?;
        transaction.commit()?;
        self.world_creation_snapshot(&command.campaign_id)
    }

    pub fn confirm_world(
        &self,
        campaign_id: &str,
    ) -> Result<WorldCreationSnapshot, CampaignStoreError> {
        validate_id(campaign_id)?;
        let at = current_timestamp()?;
        let mut connection = self.connect()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        if require_campaign_state(&transaction, campaign_id)? != "REVIEWING_WORLD"
            || load_world(&transaction, campaign_id)?.is_none()
        {
            return Err(CampaignStoreError::InvalidState);
        }
        let changed = transaction.execute(
            "UPDATE campaigns
             SET state = 'CREATING_CHARACTER', resume_state = NULL, updated_at = ?1
             WHERE id = ?2 AND state = 'REVIEWING_WORLD'",
            params![at, campaign_id],
        )?;
        if changed != 1 {
            return Err(CampaignStoreError::InvalidState);
        }
        transaction.commit()?;
        self.world_creation_snapshot(campaign_id)
    }
}

fn validate_generation_command(command: &WorldGenerationCommit) -> Result<(), CampaignStoreError> {
    validate_id(&command.campaign_id)?;
    validate_id(&command.request_id)?;
    validate_id(&command.generation_record_id)?;
    validate_id(&command.idempotency_key)?;
    if command.prompt_version < 1
        || command.raw_response_text.trim().is_empty()
        || command.raw_response_text.len() > 1_000_000
    {
        return Err(CampaignStoreError::InvalidData);
    }
    let expected_world =
        serde_json::to_value(&command.world).map_err(|_| CampaignStoreError::InvalidData)?;
    let output_world = match command.task {
        WorldGenerationTask::GenerateWorld => &command.validated_output,
        WorldGenerationTask::RefineWorld => command
            .validated_output
            .as_object()
            .and_then(|output| output.get("world"))
            .ok_or(CampaignStoreError::InvalidData)?,
    };
    if output_world != &expected_world
        || command
            .request
            .as_object()
            .and_then(|request| request.get("task"))
            .and_then(Value::as_str)
            != Some(command.task.database_name())
        || !command.input.is_object()
    {
        return Err(CampaignStoreError::InvalidData);
    }
    Ok(())
}

fn snapshot(
    connection: &Connection,
    campaign_id: &str,
) -> Result<WorldCreationSnapshot, CampaignStoreError> {
    Ok(WorldCreationSnapshot {
        campaign_state: require_campaign_state(connection, campaign_id)?,
        world: load_world(connection, campaign_id)?,
    })
}

fn require_campaign_state(
    connection: &Connection,
    campaign_id: &str,
) -> Result<String, CampaignStoreError> {
    connection
        .query_row(
            "SELECT state FROM campaigns WHERE id = ?1",
            [campaign_id],
            |row| row.get(0),
        )
        .optional()?
        .ok_or(CampaignStoreError::NotFound)
}

fn load_world(
    connection: &Connection,
    campaign_id: &str,
) -> Result<Option<WorldBibleView>, CampaignStoreError> {
    connection
        .query_row(
            "SELECT name, current_region, summary, core_conflict, technology_level,
                    power_rules_json, factions_json, locations_json, narrative_style,
                    forbidden_elements_json, tavern_reason, story_hooks_json,
                    locked_fields_json, created_at, updated_at
             FROM world_bibles WHERE campaign_id = ?1",
            [campaign_id],
            |row| {
                let factions: Vec<StoredFaction> = parse_json(row.get::<_, String>(6)?)?;
                let locations: Vec<StoredLocation> = parse_json(row.get::<_, String>(7)?)?;
                let faction_names = factions
                    .iter()
                    .map(|faction| (faction.id.clone(), faction.name.clone()))
                    .collect::<HashMap<_, _>>();
                let location_names = locations
                    .iter()
                    .map(|location| (location.id.clone(), location.name.clone()))
                    .collect::<HashMap<_, _>>();
                Ok(WorldBibleView {
                    campaign_id: campaign_id.to_owned(),
                    draft: WorldDraft {
                        name: row.get(0)?,
                        current_region: row.get(1)?,
                        summary: row.get(2)?,
                        core_conflict: row.get(3)?,
                        technology_level: row.get(4)?,
                        power_rules: parse_json(row.get::<_, String>(5)?)?,
                        factions: factions
                            .into_iter()
                            .map(|value| FactionDraft {
                                name: value.name,
                                description: value.description,
                                goals: value.goals,
                            })
                            .collect(),
                        locations: locations
                            .into_iter()
                            .map(|value| {
                                let parent_name = value
                                    .parent_location_id
                                    .map(|id| {
                                        location_names
                                            .get(&id)
                                            .cloned()
                                            .ok_or(rusqlite::Error::InvalidQuery)
                                    })
                                    .transpose()?;
                                let names = value
                                    .faction_ids
                                    .into_iter()
                                    .map(|id| {
                                        faction_names
                                            .get(&id)
                                            .cloned()
                                            .ok_or(rusqlite::Error::InvalidQuery)
                                    })
                                    .collect::<Result<Vec<_>, _>>()?;
                                Ok(LocationDraft {
                                    name: value.name,
                                    description: value.description,
                                    parent_name,
                                    faction_names: names,
                                })
                            })
                            .collect::<Result<Vec<_>, rusqlite::Error>>()?,
                        narrative_style: row.get(8)?,
                        forbidden_elements: parse_json(row.get::<_, String>(9)?)?,
                        tavern_reason: row.get(10)?,
                        story_hooks: parse_json(row.get::<_, String>(11)?)?,
                    },
                    locked_fields: parse_json(row.get::<_, String>(12)?)?,
                    created_at: row.get(13)?,
                    updated_at: row.get(14)?,
                })
            },
        )
        .optional()?
        .map(|world| {
            validate_world_draft(&world.draft)?;
            validate_locks(&world.locked_fields)?;
            Ok(world)
        })
        .transpose()
}

fn parse_json<T: for<'de> Deserialize<'de>>(value: String) -> rusqlite::Result<T> {
    serde_json::from_str(&value).map_err(|_| rusqlite::Error::InvalidQuery)
}

fn build_world_view(
    campaign_id: &str,
    draft: WorldDraft,
    current: Option<&WorldBibleView>,
    at: &str,
) -> Result<WorldBibleView, CampaignStoreError> {
    Ok(WorldBibleView {
        campaign_id: campaign_id.to_owned(),
        draft,
        locked_fields: current
            .map(|world| world.locked_fields.clone())
            .unwrap_or_default(),
        created_at: current
            .map(|world| world.created_at.clone())
            .unwrap_or_else(|| at.to_owned()),
        updated_at: at.to_owned(),
    })
}

fn save_world(
    transaction: &Transaction<'_>,
    world: &WorldBibleView,
    current: Option<&WorldBibleView>,
) -> Result<(), CampaignStoreError> {
    let current_factions = current
        .map(|value| load_stored_factions(transaction, &value.campaign_id))
        .transpose()?
        .unwrap_or_default();
    let current_locations = current
        .map(|value| load_stored_locations(transaction, &value.campaign_id))
        .transpose()?
        .unwrap_or_default();

    let factions = world
        .draft
        .factions
        .iter()
        .map(|value| StoredFaction {
            id: current_factions
                .iter()
                .find(|candidate| candidate.name == value.name)
                .map(|candidate| candidate.id.clone())
                .unwrap_or_else(|| Uuid::new_v4().to_string()),
            name: value.name.clone(),
            description: value.description.clone(),
            goals: value.goals.clone(),
            relations: current_factions
                .iter()
                .find(|candidate| candidate.name == value.name)
                .map(|candidate| candidate.relations.clone())
                .unwrap_or_default(),
        })
        .collect::<Vec<_>>();
    let faction_ids = factions
        .iter()
        .map(|faction| (faction.name.clone(), faction.id.clone()))
        .collect::<HashMap<_, _>>();
    let location_ids = world
        .draft
        .locations
        .iter()
        .map(|value| {
            (
                value.name.clone(),
                current_locations
                    .iter()
                    .find(|candidate| candidate.name == value.name)
                    .map(|candidate| candidate.id.clone())
                    .unwrap_or_else(|| Uuid::new_v4().to_string()),
            )
        })
        .collect::<HashMap<_, _>>();
    let locations = world
        .draft
        .locations
        .iter()
        .map(|value| {
            Ok(StoredLocation {
                id: location_ids
                    .get(&value.name)
                    .cloned()
                    .ok_or(CampaignStoreError::InvalidData)?,
                name: value.name.clone(),
                description: value.description.clone(),
                parent_location_id: value
                    .parent_name
                    .as_ref()
                    .map(|name| {
                        location_ids
                            .get(name)
                            .cloned()
                            .ok_or(CampaignStoreError::InvalidData)
                    })
                    .transpose()?,
                faction_ids: value
                    .faction_names
                    .iter()
                    .map(|name| {
                        faction_ids
                            .get(name)
                            .cloned()
                            .ok_or(CampaignStoreError::InvalidData)
                    })
                    .collect::<Result<Vec<_>, _>>()?,
            })
        })
        .collect::<Result<Vec<_>, CampaignStoreError>>()?;

    transaction.execute(
        "INSERT INTO world_bibles (
           campaign_id, schema_version, name, current_region, summary, core_conflict,
           technology_level, power_rules_json, factions_json, locations_json,
           narrative_style, forbidden_elements_json, tavern_reason, story_hooks_json,
           locked_fields_json, created_at, updated_at
         ) VALUES (?1, 1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)
         ON CONFLICT(campaign_id) DO UPDATE SET
           name = excluded.name, current_region = excluded.current_region,
           summary = excluded.summary, core_conflict = excluded.core_conflict,
           technology_level = excluded.technology_level,
           power_rules_json = excluded.power_rules_json,
           factions_json = excluded.factions_json, locations_json = excluded.locations_json,
           narrative_style = excluded.narrative_style,
           forbidden_elements_json = excluded.forbidden_elements_json,
           tavern_reason = excluded.tavern_reason, story_hooks_json = excluded.story_hooks_json,
           locked_fields_json = excluded.locked_fields_json, updated_at = excluded.updated_at",
        params![
            world.campaign_id,
            world.draft.name,
            world.draft.current_region,
            world.draft.summary,
            world.draft.core_conflict,
            world.draft.technology_level,
            to_json(&world.draft.power_rules)?,
            to_json(&factions)?,
            to_json(&locations)?,
            world.draft.narrative_style,
            to_json(&world.draft.forbidden_elements)?,
            world.draft.tavern_reason,
            to_json(&world.draft.story_hooks)?,
            to_json(&world.locked_fields)?,
            world.created_at,
            world.updated_at
        ],
    )?;
    Ok(())
}

fn load_stored_factions(
    connection: &Connection,
    campaign_id: &str,
) -> Result<Vec<StoredFaction>, CampaignStoreError> {
    let value: String = connection.query_row(
        "SELECT factions_json FROM world_bibles WHERE campaign_id = ?1",
        [campaign_id],
        |row| row.get(0),
    )?;
    serde_json::from_str(&value).map_err(|_| CampaignStoreError::InvalidData)
}

fn load_stored_locations(
    connection: &Connection,
    campaign_id: &str,
) -> Result<Vec<StoredLocation>, CampaignStoreError> {
    let value: String = connection.query_row(
        "SELECT locations_json FROM world_bibles WHERE campaign_id = ?1",
        [campaign_id],
        |row| row.get(0),
    )?;
    serde_json::from_str(&value).map_err(|_| CampaignStoreError::InvalidData)
}

fn to_json(value: &impl Serialize) -> Result<String, CampaignStoreError> {
    serde_json::to_string(value).map_err(|_| CampaignStoreError::InvalidData)
}

fn validate_world_draft(world: &WorldDraft) -> Result<(), CampaignStoreError> {
    validate_text(&world.name, 200)?;
    validate_text(&world.current_region, 200)?;
    validate_text(&world.summary, 4_000)?;
    validate_text(&world.core_conflict, 4_000)?;
    validate_text(&world.technology_level, 200)?;
    validate_text(&world.narrative_style, 4_000)?;
    validate_text(&world.tavern_reason, 4_000)?;
    validate_text_list(&world.power_rules, 1, 30, 4_000)?;
    validate_text_list(&world.forbidden_elements, 0, 30, 4_000)?;
    validate_text_list(&world.story_hooks, 1, 12, 4_000)?;
    if world.factions.is_empty() || world.factions.len() > 12 {
        return Err(CampaignStoreError::InvalidData);
    }
    if world.locations.is_empty() || world.locations.len() > 30 {
        return Err(CampaignStoreError::InvalidData);
    }
    let mut faction_names = HashSet::new();
    for faction in &world.factions {
        validate_text(&faction.name, 200)?;
        validate_text(&faction.description, 4_000)?;
        validate_text_list(&faction.goals, 1, 30, 4_000)?;
        if !faction_names.insert(faction.name.as_str()) {
            return Err(CampaignStoreError::InvalidData);
        }
    }
    let mut location_names = HashSet::new();
    for location in &world.locations {
        validate_text(&location.name, 200)?;
        validate_text(&location.description, 4_000)?;
        if !location_names.insert(location.name.as_str()) {
            return Err(CampaignStoreError::InvalidData);
        }
    }
    for location in &world.locations {
        if location.parent_name.as_deref() == Some(location.name.as_str())
            || location
                .parent_name
                .as_ref()
                .is_some_and(|name| !location_names.contains(name.as_str()))
            || location
                .faction_names
                .iter()
                .any(|name| !faction_names.contains(name.as_str()))
        {
            return Err(CampaignStoreError::InvalidData);
        }
    }
    Ok(())
}

fn validate_text(value: &str, max: usize) -> Result<(), CampaignStoreError> {
    if value.is_empty() || value.trim() != value || value.chars().count() > max {
        return Err(CampaignStoreError::InvalidData);
    }
    Ok(())
}

fn validate_text_list(
    values: &[String],
    min: usize,
    max: usize,
    text_max: usize,
) -> Result<(), CampaignStoreError> {
    if values.len() < min || values.len() > max {
        return Err(CampaignStoreError::InvalidData);
    }
    values
        .iter()
        .try_for_each(|value| validate_text(value, text_max))
}

fn validate_locks(locks: &[String]) -> Result<(), CampaignStoreError> {
    let mut unique = HashSet::new();
    if locks
        .iter()
        .any(|field| !LOCKABLE_FIELDS.contains(&field.as_str()) || !unique.insert(field.as_str()))
    {
        return Err(CampaignStoreError::InvalidData);
    }
    Ok(())
}

fn validate_locked_values(
    current: &WorldBibleView,
    next: &WorldDraft,
) -> Result<(), CampaignStoreError> {
    for field in &current.locked_fields {
        let unchanged = match field.as_str() {
            "name" => current.draft.name == next.name,
            "currentRegion" => current.draft.current_region == next.current_region,
            "summary" => current.draft.summary == next.summary,
            "coreConflict" => current.draft.core_conflict == next.core_conflict,
            "technologyLevel" => current.draft.technology_level == next.technology_level,
            "powerRules" => current.draft.power_rules == next.power_rules,
            "narrativeStyle" => current.draft.narrative_style == next.narrative_style,
            "forbiddenElements" => current.draft.forbidden_elements == next.forbidden_elements,
            "tavernReason" => current.draft.tavern_reason == next.tavern_reason,
            _ => false,
        };
        if !unchanged {
            return Err(CampaignStoreError::InvalidData);
        }
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredFaction {
    id: String,
    name: String,
    description: String,
    goals: Vec<String>,
    relations: Vec<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredLocation {
    id: String,
    name: String,
    description: String,
    parent_location_id: Option<String>,
    faction_ids: Vec<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generated_world_survives_reopen_and_confirmation() {
        let directory = tempfile::tempdir().expect("temp directory");
        let database_path = directory.path().join("ember-tavern.sqlite");
        let store = CampaignStore::open(&database_path).expect("open database");
        store
            .create_at(
                "campaign-world".to_owned(),
                "2026-07-31T01:02:03.004Z".to_owned(),
            )
            .expect("create campaign");
        let committed = store
            .commit_world_generation(generation_command(sample_world()))
            .expect("commit generated world");
        assert_eq!(committed.campaign_state, "REVIEWING_WORLD");
        assert_eq!(
            committed
                .world
                .as_ref()
                .map(|world| world.draft.name.as_str()),
            Some("Ember Coast")
        );
        drop(store);

        let reopened = CampaignStore::open(&database_path).expect("reopen database");
        let loaded = reopened
            .world_creation_snapshot("campaign-world")
            .expect("load world");
        assert_eq!(loaded, committed);
        let confirmed = reopened
            .confirm_world("campaign-world")
            .expect("confirm world");
        assert_eq!(confirmed.campaign_state, "CREATING_CHARACTER");
    }

    #[test]
    fn locked_world_fields_cannot_change_during_refinement() {
        let directory = tempfile::tempdir().expect("temp directory");
        let database_path = directory.path().join("ember-tavern.sqlite");
        let store = CampaignStore::open(&database_path).expect("open database");
        store
            .create_at(
                "campaign-world".to_owned(),
                "2026-07-31T01:02:03.004Z".to_owned(),
            )
            .expect("create campaign");
        store
            .commit_world_generation(generation_command(sample_world()))
            .expect("commit generated world");
        store
            .update_world_draft(WorldManualUpdate {
                campaign_id: "campaign-world".to_owned(),
                world: sample_world(),
                locked_fields: vec!["powerRules".to_owned()],
            })
            .expect("lock power rules");
        let mut changed = sample_world();
        changed.power_rules = vec!["A forbidden replacement rule.".to_owned()];
        let mut command = generation_command(changed);
        command.task = WorldGenerationTask::RefineWorld;
        command.request_id = "request-refine".to_owned();
        command.generation_record_id = "generation-refine".to_owned();
        command.idempotency_key = "world:refine".to_owned();
        command.request = serde_json::json!({"task": "REFINE_WORLD"});
        let changed_output = serde_json::to_value(&command.world).expect("changed world value");
        command.validated_output = serde_json::json!({
            "world": changed_output,
            "changeSummary": ["Changed unlocked fields."]
        });

        assert!(matches!(
            store.commit_world_generation(command),
            Err(CampaignStoreError::InvalidData)
        ));
        assert_eq!(
            store
                .world_creation_snapshot("campaign-world")
                .expect("reload world")
                .world
                .expect("world")
                .draft
                .power_rules,
            vec!["Weather magic changes the nearby climate."]
        );
    }

    #[test]
    fn rejects_a_commit_when_validated_output_and_game_world_differ() {
        let directory = tempfile::tempdir().expect("temp directory");
        let database_path = directory.path().join("ember-tavern.sqlite");
        let store = CampaignStore::open(&database_path).expect("open database");
        store
            .create_at(
                "campaign-world".to_owned(),
                "2026-07-31T01:02:03.004Z".to_owned(),
            )
            .expect("create campaign");
        let mut command = generation_command(sample_world());
        command.validated_output = serde_json::json!({
            "name": "A different unvalidated world"
        });

        assert!(matches!(
            store.commit_world_generation(command),
            Err(CampaignStoreError::InvalidData)
        ));
        assert!(
            store
                .world_creation_snapshot("campaign-world")
                .expect("load campaign")
                .world
                .is_none()
        );
    }

    fn generation_command(world: WorldDraft) -> WorldGenerationCommit {
        WorldGenerationCommit {
            campaign_id: "campaign-world".to_owned(),
            task: WorldGenerationTask::GenerateWorld,
            request_id: "request-generate".to_owned(),
            generation_record_id: "generation-generate".to_owned(),
            idempotency_key: "world:generate".to_owned(),
            prompt_version: 1,
            input: serde_json::json!({"concept": "A storm coast"}),
            request: serde_json::json!({"task": "GENERATE_WORLD"}),
            raw_response_text: serde_json::to_string(&world).expect("serialize world"),
            validated_output: serde_json::to_value(&world).expect("world value"),
            world,
        }
    }

    fn sample_world() -> WorldDraft {
        WorldDraft {
            name: "Ember Coast".to_owned(),
            current_region: "Ash Harbor".to_owned(),
            summary: "A storm-bound coast of old beacon roads.".to_owned(),
            core_conflict: "The lighthouse guild is losing control.".to_owned(),
            technology_level: "Early industrial".to_owned(),
            power_rules: vec!["Weather magic changes the nearby climate.".to_owned()],
            factions: vec![FactionDraft {
                name: "Lantern Guild".to_owned(),
                description: "Keepers of the coast lights.".to_owned(),
                goals: vec!["Restore the old beacon.".to_owned()],
            }],
            locations: vec![LocationDraft {
                name: "Ash Harbor".to_owned(),
                description: "A sheltered port beneath black cliffs.".to_owned(),
                parent_name: None,
                faction_names: vec!["Lantern Guild".to_owned()],
            }],
            narrative_style: "Grounded mystery and hopeful adventure.".to_owned(),
            forbidden_elements: vec![],
            tavern_reason: "Travelers wait here for the storms to pass.".to_owned(),
            story_hooks: vec!["A beacon shines beneath the harbor.".to_owned()],
        }
    }
}

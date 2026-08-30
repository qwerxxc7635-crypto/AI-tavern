use std::collections::{HashMap, HashSet};

use rusqlite::{Connection, OptionalExtension, Transaction, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::{
    CampaignStore, CampaignStoreError, CharacterGenerationAudit, current_timestamp,
    insert_character_generation, validate_character_generation_audit, validate_id,
};

const LOCATION_KINDS: [&str; 10] = [
    "REGION", "COUNTRY", "CITY", "VILLAGE", "DISTRICT", "TAVERN", "SHOP", "RUIN", "DUNGEON",
    "SPECIAL",
];
const EXPANSION_MODES: [&str; 2] = ["CHILDREN", "CONNECTED"];
const TRAVEL_MODES: [&str; 5] = ["FOOT", "ROAD", "WATER", "MOUNT", "SPECIAL"];
const MAX_DEPTH: usize = 8;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocationConstitutionEvidence {
    pub technology: String,
    pub magic: String,
    pub society: String,
    pub politics: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DynamicLocationProfile {
    pub kind: String,
    pub schema_version: i64,
    pub id: String,
    pub campaign_id: String,
    pub constitution_revision: i64,
    pub location_kind: String,
    pub materialization: String,
    pub name: String,
    pub description: String,
    pub parent_location_id: Option<String>,
    pub atmosphere: Option<String>,
    pub features: Vec<String>,
    pub faction_ids: Vec<String>,
    pub current_situation: Option<String>,
    pub constitution_evidence: LocationConstitutionEvidence,
    pub generation_record_id: Option<String>,
    pub revision: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocationConnectionView {
    pub id: String,
    pub campaign_id: String,
    pub first_location_id: String,
    pub second_location_id: String,
    pub source: String,
    pub generation_record_id: Option<String>,
    pub created_at: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CampaignLocationStateView {
    pub campaign_id: String,
    pub current_location_id: String,
    pub revision: i64,
    pub updated_at: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocationTravelEventView {
    pub id: String,
    pub campaign_id: String,
    pub from_location_id: String,
    pub to_location_id: String,
    pub mode: String,
    pub before_revision: i64,
    pub after_revision: i64,
    pub occurred_at: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DynamicLocationSnapshot {
    pub state: CampaignLocationStateView,
    pub locations: Vec<DynamicLocationProfile>,
    pub connections: Vec<LocationConnectionView>,
    pub travel_history: Vec<LocationTravelEventView>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DynamicLocationGenerationSnapshot {
    pub graph: DynamicLocationSnapshot,
    pub input: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DynamicLocationGenerationRequest {
    pub campaign_id: String,
    pub origin_location_id: String,
    pub expansion_mode: String,
    pub requested_count: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DynamicLocationGenerationCommit {
    pub campaign_id: String,
    pub origin_location_id: String,
    pub expansion_mode: String,
    pub requested_count: i64,
    pub generation: CharacterGenerationAudit,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DynamicLocationTravelCommand {
    pub campaign_id: String,
    pub target_location_id: String,
    pub expected_revision: i64,
    pub mode: String,
    pub event_id: String,
    pub operation_id: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DynamicLocationCandidate {
    id: String,
    name: String,
    kind: String,
    parent_location_id: Option<String>,
    description: String,
    atmosphere: String,
    features: Vec<String>,
    faction_ids: Vec<String>,
    connections: Vec<String>,
    current_situation: String,
    constitution_evidence: LocationConstitutionEvidence,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DynamicLocationOutput {
    schema_version: i64,
    locations: Vec<DynamicLocationCandidate>,
}

impl CampaignStore {
    pub fn dynamic_location_snapshot(
        &self,
        campaign_id: &str,
    ) -> Result<DynamicLocationSnapshot, CampaignStoreError> {
        validate_id(campaign_id)?;
        let connection = self.connect()?;
        load_snapshot(&connection, campaign_id)
    }

    pub fn dynamic_location_generation_snapshot(
        &self,
        command: DynamicLocationGenerationRequest,
    ) -> Result<DynamicLocationGenerationSnapshot, CampaignStoreError> {
        validate_generation_request(&command)?;
        let connection = self.connect()?;
        let graph = load_snapshot(&connection, &command.campaign_id)?;
        let input = generation_input(
            &connection,
            &graph,
            &command.origin_location_id,
            &command.expansion_mode,
            command.requested_count,
        )?;
        Ok(DynamicLocationGenerationSnapshot { graph, input })
    }

    pub fn commit_dynamic_location_generation(
        &self,
        command: DynamicLocationGenerationCommit,
    ) -> Result<DynamicLocationSnapshot, CampaignStoreError> {
        validate_id(&command.campaign_id)?;
        validate_id(&command.origin_location_id)?;
        validate_expansion(&command.expansion_mode, command.requested_count)?;
        validate_character_generation_audit(&command.generation, "GENERATE_LOCATIONS")?;
        let output: DynamicLocationOutput =
            serde_json::from_value(command.generation.validated_output.clone())
                .map_err(|_| CampaignStoreError::InvalidData)?;
        if output.schema_version != 1 || output.locations.len() != command.requested_count as usize
        {
            return Err(CampaignStoreError::InvalidData);
        }

        let mut connection = self.connect()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        if generation_replayed(&transaction, &command.campaign_id, &command)? {
            let snapshot = load_snapshot(&transaction, &command.campaign_id)?;
            if let Some(artifact) = output.locations.first() {
                let at = current_timestamp()?;
                crate::lazy_world_generation::reconcile_lazy_artifact(
                    &transaction,
                    &command.campaign_id,
                    "LOCATION_DETAILS",
                    &command.origin_location_id,
                    &artifact.id,
                    &at,
                )?;
            }
            transaction.commit()?;
            return Ok(snapshot);
        }
        let graph = load_snapshot(&transaction, &command.campaign_id)?;
        let expected_input = generation_input(
            &transaction,
            &graph,
            &command.origin_location_id,
            &command.expansion_mode,
            command.requested_count,
        )?;
        let expected_context = json!({
            "campaignId": command.campaign_id,
            "originLocationId": command.origin_location_id,
            "expansionMode": command.expansion_mode,
            "requestedCount": command.requested_count,
        });
        if command.generation.input != expected_input
            || command.generation.context != expected_context
        {
            return Err(CampaignStoreError::InvalidData);
        }
        let origin = graph
            .locations
            .iter()
            .find(|location| location.id == command.origin_location_id)
            .ok_or(CampaignStoreError::NotFound)?;
        let evidence = locked_constitution(&transaction, &command.campaign_id)?.1;
        let allowed_factions = allowed_faction_ids(&transaction, &command.campaign_id)?
            .into_iter()
            .collect::<HashSet<_>>();
        validate_candidates(
            &graph.locations,
            origin,
            &command.expansion_mode,
            &output.locations,
            &evidence,
            &allowed_factions,
        )?;
        let at = current_timestamp()?;
        insert_character_generation(
            &transaction,
            &command.campaign_id,
            "GENERATE_LOCATIONS",
            &command.generation,
            &at,
        )?;
        let profiles = output
            .locations
            .iter()
            .map(|candidate| profile_from_candidate(candidate, &command, &evidence, &at))
            .collect::<Vec<_>>();
        for profile in &profiles {
            insert_location(&transaction, profile)?;
        }
        insert_generated_connections(
            &transaction,
            &command.campaign_id,
            &command.generation.generation_record_id,
            &at,
            &output.locations,
            origin,
            &command.expansion_mode,
        )?;
        let artifact_id = profiles
            .first()
            .map(|profile| profile.id.as_str())
            .ok_or(CampaignStoreError::InvalidData)?;
        crate::lazy_world_generation::reconcile_lazy_artifact(
            &transaction,
            &command.campaign_id,
            "LOCATION_DETAILS",
            &command.origin_location_id,
            artifact_id,
            &at,
        )?;
        let snapshot = load_snapshot(&transaction, &command.campaign_id)?;
        transaction.commit()?;
        Ok(snapshot)
    }

    pub fn travel_dynamic_location(
        &self,
        command: DynamicLocationTravelCommand,
    ) -> Result<DynamicLocationSnapshot, CampaignStoreError> {
        validate_id(&command.campaign_id)?;
        validate_id(&command.target_location_id)?;
        validate_id(&command.event_id)?;
        validate_id(&command.operation_id)?;
        if command.expected_revision < 1 || !TRAVEL_MODES.contains(&command.mode.as_str()) {
            return Err(CampaignStoreError::InvalidData);
        }
        let mut connection = self.connect()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        if let Some((campaign, target, revision, mode)) = transaction
            .query_row(
                "SELECT campaign_id,to_location_id,before_revision,mode
                 FROM location_travel_events WHERE operation_id=?1",
                [&command.operation_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, i64>(2)?,
                        row.get::<_, String>(3)?,
                    ))
                },
            )
            .optional()?
        {
            if campaign != command.campaign_id
                || target != command.target_location_id
                || revision != command.expected_revision
                || mode != command.mode
            {
                return Err(CampaignStoreError::InvalidData);
            }
            let snapshot = load_snapshot(&transaction, &command.campaign_id)?;
            transaction.commit()?;
            return Ok(snapshot);
        }
        let graph = load_snapshot(&transaction, &command.campaign_id)?;
        if graph.state.revision != command.expected_revision
            || graph.state.current_location_id == command.target_location_id
            || !graph
                .locations
                .iter()
                .any(|location| location.id == command.target_location_id)
            || !adjacent(
                &graph.state.current_location_id,
                &command.target_location_id,
                &graph.locations,
                &graph.connections,
            )
        {
            return Err(CampaignStoreError::InvalidState);
        }
        let at = current_timestamp()?;
        transaction.execute(
            "INSERT INTO location_travel_events
             (id,campaign_id,operation_id,from_location_id,to_location_id,mode,
              before_revision,after_revision,occurred_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?7+1,?8)",
            params![
                command.event_id,
                command.campaign_id,
                command.operation_id,
                graph.state.current_location_id,
                command.target_location_id,
                command.mode,
                command.expected_revision,
                at,
            ],
        )?;
        let changed = transaction.execute(
            "UPDATE campaign_location_states SET current_location_id=?1,revision=revision+1,updated_at=?2
             WHERE campaign_id=?3 AND revision=?4",
            params![command.target_location_id, at, command.campaign_id, command.expected_revision],
        )?;
        if changed != 1 {
            return Err(CampaignStoreError::InvalidState);
        }
        let snapshot = load_snapshot(&transaction, &command.campaign_id)?;
        transaction.commit()?;
        Ok(snapshot)
    }
}

fn validate_generation_request(
    command: &DynamicLocationGenerationRequest,
) -> Result<(), CampaignStoreError> {
    validate_id(&command.campaign_id)?;
    validate_id(&command.origin_location_id)?;
    validate_expansion(&command.expansion_mode, command.requested_count)
}

fn validate_expansion(mode: &str, count: i64) -> Result<(), CampaignStoreError> {
    if !EXPANSION_MODES.contains(&mode) || !(1..=8).contains(&count) {
        return Err(CampaignStoreError::InvalidData);
    }
    Ok(())
}

fn locked_constitution(
    connection: &Connection,
    campaign_id: &str,
) -> Result<(i64, LocationConstitutionEvidence), CampaignStoreError> {
    connection
        .query_row(
            "SELECT revision,technology,magic,society,politics FROM world_constitutions
             WHERE campaign_id=?1 AND status='LOCKED'",
            [campaign_id],
            |row| {
                Ok((
                    row.get(0)?,
                    LocationConstitutionEvidence {
                        technology: row.get(1)?,
                        magic: row.get(2)?,
                        society: row.get(3)?,
                        politics: row.get(4)?,
                    },
                ))
            },
        )
        .optional()?
        .ok_or(CampaignStoreError::InvalidState)
}

fn generation_input(
    connection: &Connection,
    graph: &DynamicLocationSnapshot,
    origin_id: &str,
    expansion_mode: &str,
    requested_count: i64,
) -> Result<Value, CampaignStoreError> {
    let origin = graph
        .locations
        .iter()
        .find(|location| location.id == origin_id)
        .ok_or(CampaignStoreError::NotFound)?;
    let (revision, evidence) = locked_constitution(connection, &origin.campaign_id)?;
    if revision != origin.constitution_revision {
        return Err(CampaignStoreError::InvalidData);
    }
    let mut locations = graph.locations.iter().take(64).collect::<Vec<_>>();
    locations.sort_by(|left, right| left.id.cmp(&right.id));
    Ok(json!({
        "schemaVersion": 1,
        "context": {
            "worldId": origin.campaign_id,
            "constitutionRevision": revision,
            "contextSummary": format!("Materialize one explicit {expansion_mode} expansion from {} without generating a full map.", origin.name),
        },
        "expansionMode": expansion_mode,
        "originLocation": {
            "id": origin.id,
            "name": origin.name,
            "kind": origin.location_kind,
            "parentLocationId": origin.parent_location_id,
            "description": origin.description,
        },
        "requestedCount": requested_count,
        "existingLocationIds": locations.iter().map(|location| &location.id).collect::<Vec<_>>(),
        "existingLocationNames": locations.iter().map(|location| &location.name).collect::<Vec<_>>(),
        "allowedFactionIds": allowed_faction_ids(connection, &origin.campaign_id)?,
        "constitutionEvidence": evidence,
    }))
}

fn allowed_faction_ids(
    connection: &Connection,
    campaign_id: &str,
) -> Result<Vec<String>, CampaignStoreError> {
    let factions: String = connection.query_row(
        "SELECT factions_json FROM world_bibles WHERE campaign_id=?1",
        [campaign_id],
        |row| row.get(0),
    )?;
    let values: Vec<Value> =
        serde_json::from_str(&factions).map_err(|_| CampaignStoreError::InvalidData)?;
    let mut ids = values
        .into_iter()
        .map(|value| {
            value
                .get("id")
                .and_then(Value::as_str)
                .map(str::to_owned)
                .ok_or(CampaignStoreError::InvalidData)
        })
        .collect::<Result<Vec<_>, _>>()?;
    ids.sort();
    if ids.windows(2).any(|pair| pair[0] == pair[1]) {
        return Err(CampaignStoreError::InvalidData);
    }
    Ok(ids)
}

fn validate_candidates(
    existing: &[DynamicLocationProfile],
    origin: &DynamicLocationProfile,
    expansion_mode: &str,
    candidates: &[DynamicLocationCandidate],
    evidence: &LocationConstitutionEvidence,
    allowed_factions: &HashSet<String>,
) -> Result<(), CampaignStoreError> {
    let mut ids = existing
        .iter()
        .map(|location| location.id.clone())
        .collect::<HashSet<_>>();
    let mut names = existing
        .iter()
        .map(|location| normalize(&location.name))
        .collect::<HashSet<_>>();
    for candidate in candidates {
        validate_candidate_shape(candidate)?;
        if !ids.insert(candidate.id.clone())
            || !names.insert(normalize(&candidate.name))
            || candidate.constitution_evidence != *evidence
            || candidate
                .faction_ids
                .iter()
                .any(|id| !allowed_factions.contains(id))
            || (expansion_mode == "CHILDREN"
                && candidate.parent_location_id.as_deref() != Some(&origin.id))
            || (expansion_mode == "CONNECTED"
                && candidate.parent_location_id != origin.parent_location_id)
            || (expansion_mode == "CONNECTED" && !candidate.connections.contains(&origin.id))
        {
            return Err(CampaignStoreError::InvalidData);
        }
    }
    for candidate in candidates {
        if candidate
            .connections
            .iter()
            .any(|id| id == &candidate.id || !ids.contains(id))
        {
            return Err(CampaignStoreError::InvalidData);
        }
    }
    let mut parents = existing
        .iter()
        .map(|location| (location.id.clone(), location.parent_location_id.clone()))
        .collect::<HashMap<_, _>>();
    parents.extend(
        candidates
            .iter()
            .map(|candidate| (candidate.id.clone(), candidate.parent_location_id.clone())),
    );
    validate_topology(&parents)
}

fn validate_candidate_shape(
    candidate: &DynamicLocationCandidate,
) -> Result<(), CampaignStoreError> {
    validate_id(&candidate.id)?;
    validate_text(&candidate.name, 120)?;
    validate_text(&candidate.description, 4_000)?;
    validate_text(&candidate.atmosphere, 4_000)?;
    validate_text(&candidate.current_situation, 4_000)?;
    if !LOCATION_KINDS.contains(&candidate.kind.as_str())
        || candidate.features.is_empty()
        || candidate.features.len() > 24
        || candidate.faction_ids.len() > 64
        || candidate.connections.len() > 64
    {
        return Err(CampaignStoreError::InvalidData);
    }
    validate_unique_text(&candidate.features, 200)?;
    validate_unique_ids(&candidate.faction_ids)?;
    validate_unique_ids(&candidate.connections)
}

fn validate_topology(parents: &HashMap<String, Option<String>>) -> Result<(), CampaignStoreError> {
    for (id, parent) in parents {
        if parent
            .as_ref()
            .is_some_and(|value| !parents.contains_key(value))
        {
            return Err(CampaignStoreError::InvalidData);
        }
        let mut visited = HashSet::new();
        let mut current = Some(id.as_str());
        let mut depth = 0;
        while let Some(location_id) = current {
            if !visited.insert(location_id) || depth > MAX_DEPTH {
                return Err(CampaignStoreError::InvalidData);
            }
            current = parents.get(location_id).and_then(|value| value.as_deref());
            depth += 1;
        }
    }
    Ok(())
}

fn profile_from_candidate(
    candidate: &DynamicLocationCandidate,
    command: &DynamicLocationGenerationCommit,
    evidence: &LocationConstitutionEvidence,
    at: &str,
) -> DynamicLocationProfile {
    DynamicLocationProfile {
        kind: "DYNAMIC_LOCATION".to_owned(),
        schema_version: 1,
        id: candidate.id.clone(),
        campaign_id: command.campaign_id.clone(),
        constitution_revision: command.generation.input["context"]["constitutionRevision"]
            .as_i64()
            .unwrap_or_default(),
        location_kind: candidate.kind.clone(),
        materialization: "DETAILED".to_owned(),
        name: candidate.name.clone(),
        description: candidate.description.clone(),
        parent_location_id: candidate.parent_location_id.clone(),
        atmosphere: Some(candidate.atmosphere.clone()),
        features: candidate.features.clone(),
        faction_ids: candidate.faction_ids.clone(),
        current_situation: Some(candidate.current_situation.clone()),
        constitution_evidence: evidence.clone(),
        generation_record_id: Some(command.generation.generation_record_id.clone()),
        revision: 1,
        created_at: at.to_owned(),
        updated_at: at.to_owned(),
    }
}

fn insert_location(
    transaction: &Transaction<'_>,
    profile: &DynamicLocationProfile,
) -> Result<(), CampaignStoreError> {
    transaction.execute(
        "INSERT INTO dynamic_locations
         (id,campaign_id,schema_version,constitution_revision,location_kind,materialization,
          name,parent_location_id,profile_json,generation_record_id,revision,created_at,updated_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)",
        params![
            profile.id,
            profile.campaign_id,
            profile.schema_version,
            profile.constitution_revision,
            profile.location_kind,
            profile.materialization,
            profile.name,
            profile.parent_location_id,
            serde_json::to_string(profile).map_err(|_| CampaignStoreError::InvalidData)?,
            profile.generation_record_id,
            profile.revision,
            profile.created_at,
            profile.updated_at,
        ],
    )?;
    Ok(())
}

fn insert_generated_connections(
    transaction: &Transaction<'_>,
    campaign_id: &str,
    generation_id: &str,
    at: &str,
    candidates: &[DynamicLocationCandidate],
    origin: &DynamicLocationProfile,
    expansion_mode: &str,
) -> Result<(), CampaignStoreError> {
    let mut pairs = HashSet::new();
    for candidate in candidates {
        for connected in &candidate.connections {
            pairs.insert(ordered_pair(&candidate.id, connected));
        }
        if expansion_mode == "CHILDREN" {
            pairs.insert(ordered_pair(&candidate.id, &origin.id));
        }
    }
    for (first, second) in pairs {
        transaction.execute(
            "INSERT INTO location_connections
             (id,campaign_id,first_location_id,second_location_id,source,generation_record_id,created_at)
             VALUES (?1,?2,?3,?4,'GENERATED',?5,?6)",
            params![format!("location-edge:{first}:{second}"), campaign_id, first, second, generation_id, at],
        )?;
    }
    Ok(())
}

fn ordered_pair(left: &str, right: &str) -> (String, String) {
    if left < right {
        (left.to_owned(), right.to_owned())
    } else {
        (right.to_owned(), left.to_owned())
    }
}

fn adjacent(
    from: &str,
    to: &str,
    locations: &[DynamicLocationProfile],
    connections: &[LocationConnectionView],
) -> bool {
    let parent_adjacent = locations.iter().any(|location| {
        (location.id == from && location.parent_location_id.as_deref() == Some(to))
            || (location.id == to && location.parent_location_id.as_deref() == Some(from))
    });
    parent_adjacent
        || connections.iter().any(|connection| {
            (connection.first_location_id == from && connection.second_location_id == to)
                || (connection.first_location_id == to && connection.second_location_id == from)
        })
}

fn load_snapshot(
    connection: &Connection,
    campaign_id: &str,
) -> Result<DynamicLocationSnapshot, CampaignStoreError> {
    let state = connection
        .query_row(
            "SELECT campaign_id,current_location_id,revision,updated_at
             FROM campaign_location_states WHERE campaign_id=?1",
            [campaign_id],
            |row| {
                Ok(CampaignLocationStateView {
                    campaign_id: row.get(0)?,
                    current_location_id: row.get(1)?,
                    revision: row.get(2)?,
                    updated_at: row.get(3)?,
                })
            },
        )
        .optional()?
        .ok_or(CampaignStoreError::NotFound)?;
    let mut statement = connection.prepare(
        "SELECT profile_json FROM dynamic_locations WHERE campaign_id=?1
         ORDER BY parent_location_id IS NOT NULL,parent_location_id,name,id",
    )?;
    let locations = statement
        .query_map([campaign_id], |row| row.get::<_, String>(0))?
        .map(|result| {
            let json = result?;
            serde_json::from_str(&json).map_err(|_| rusqlite::Error::InvalidQuery)
        })
        .collect::<Result<Vec<DynamicLocationProfile>, _>>()?;
    let (constitution_revision, evidence) = locked_constitution(connection, campaign_id)?;
    let allowed_factions = allowed_faction_ids(connection, campaign_id)?
        .into_iter()
        .collect::<HashSet<_>>();
    for location in &locations {
        validate_profile(
            location,
            campaign_id,
            constitution_revision,
            &evidence,
            &allowed_factions,
        )?;
    }
    let parents = locations
        .iter()
        .map(|location| (location.id.clone(), location.parent_location_id.clone()))
        .collect::<HashMap<_, _>>();
    validate_topology(&parents)?;
    let mut statement = connection.prepare(
        "SELECT id,campaign_id,first_location_id,second_location_id,source,generation_record_id,created_at
         FROM location_connections WHERE campaign_id=?1 ORDER BY first_location_id,second_location_id,id",
    )?;
    let connections = statement
        .query_map([campaign_id], |row| {
            Ok(LocationConnectionView {
                id: row.get(0)?,
                campaign_id: row.get(1)?,
                first_location_id: row.get(2)?,
                second_location_id: row.get(3)?,
                source: row.get(4)?,
                generation_record_id: row.get(5)?,
                created_at: row.get(6)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let mut statement = connection.prepare(
        "SELECT id,campaign_id,from_location_id,to_location_id,mode,before_revision,after_revision,occurred_at
         FROM location_travel_events WHERE campaign_id=?1 ORDER BY occurred_at,id",
    )?;
    let travel_history = statement
        .query_map([campaign_id], |row| {
            Ok(LocationTravelEventView {
                id: row.get(0)?,
                campaign_id: row.get(1)?,
                from_location_id: row.get(2)?,
                to_location_id: row.get(3)?,
                mode: row.get(4)?,
                before_revision: row.get(5)?,
                after_revision: row.get(6)?,
                occurred_at: row.get(7)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(DynamicLocationSnapshot {
        state,
        locations,
        connections,
        travel_history,
    })
}

fn generation_replayed(
    transaction: &Transaction<'_>,
    campaign_id: &str,
    command: &DynamicLocationGenerationCommit,
) -> Result<bool, CampaignStoreError> {
    match transaction
        .query_row(
            "SELECT pending.campaign_id,pending.task,pending.status,pending.input_json,
                    pending.context_json,generation.id,generation.validated_output_json
             FROM pending_ai_requests pending
             JOIN generation_records generation ON generation.request_id=pending.id
             WHERE pending.idempotency_key=?1",
            [&command.generation.idempotency_key],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, String>(6)?,
                ))
            },
        )
        .optional()?
    {
        None => Ok(false),
        Some((campaign, task, status, input, context, generation_id, output))
            if campaign == campaign_id && task == "GENERATE_LOCATIONS" && status == "COMMITTED" =>
        {
            let expected_context = json!({
                "campaignId": command.campaign_id,
                "originLocationId": command.origin_location_id,
                "expansionMode": command.expansion_mode,
                "requestedCount": command.requested_count,
            });
            let stored_input: Value =
                serde_json::from_str(&input).map_err(|_| CampaignStoreError::InvalidData)?;
            let stored_context: Value =
                serde_json::from_str(&context).map_err(|_| CampaignStoreError::InvalidData)?;
            let stored_output: Value =
                serde_json::from_str(&output).map_err(|_| CampaignStoreError::InvalidData)?;
            if stored_input != command.generation.input
                || stored_context != expected_context
                || generation_id != command.generation.generation_record_id
                || stored_output != command.generation.validated_output
            {
                return Err(CampaignStoreError::InvalidData);
            }
            Ok(true)
        }
        Some(_) => Err(CampaignStoreError::InvalidState),
    }
}

fn validate_profile(
    profile: &DynamicLocationProfile,
    campaign_id: &str,
    constitution_revision: i64,
    evidence: &LocationConstitutionEvidence,
    allowed_factions: &HashSet<String>,
) -> Result<(), CampaignStoreError> {
    validate_id(&profile.id)?;
    validate_text(&profile.name, 120)?;
    validate_text(&profile.description, 4_000)?;
    validate_unique_text(&profile.features, 200)?;
    validate_unique_ids(&profile.faction_ids)?;
    if profile.kind != "DYNAMIC_LOCATION"
        || profile.schema_version != 1
        || profile.campaign_id != campaign_id
        || profile.constitution_revision != constitution_revision
        || profile.constitution_evidence != *evidence
        || !LOCATION_KINDS.contains(&profile.location_kind.as_str())
        || !["OUTLINE", "DETAILED"].contains(&profile.materialization.as_str())
        || profile.revision < 1
        || profile.parent_location_id.as_deref() == Some(profile.id.as_str())
        || profile
            .faction_ids
            .iter()
            .any(|id| !allowed_factions.contains(id))
    {
        return Err(CampaignStoreError::InvalidData);
    }
    if let Some(parent) = &profile.parent_location_id {
        validate_id(parent)?;
    }
    if let Some(generation) = &profile.generation_record_id {
        validate_id(generation)?;
    }
    match profile.materialization.as_str() {
        "OUTLINE" if profile.generation_record_id.is_some() => Err(CampaignStoreError::InvalidData),
        "DETAILED" => {
            validate_text(
                profile
                    .atmosphere
                    .as_deref()
                    .ok_or(CampaignStoreError::InvalidData)?,
                4_000,
            )?;
            validate_text(
                profile
                    .current_situation
                    .as_deref()
                    .ok_or(CampaignStoreError::InvalidData)?,
                4_000,
            )?;
            if profile.features.is_empty() || profile.generation_record_id.is_none() {
                return Err(CampaignStoreError::InvalidData);
            }
            Ok(())
        }
        "OUTLINE" => Ok(()),
        _ => Err(CampaignStoreError::InvalidData),
    }
}

fn validate_text(value: &str, maximum: usize) -> Result<(), CampaignStoreError> {
    if value.trim() != value || value.is_empty() || value.len() > maximum {
        return Err(CampaignStoreError::InvalidData);
    }
    Ok(())
}

fn validate_unique_text(values: &[String], maximum: usize) -> Result<(), CampaignStoreError> {
    let mut seen = HashSet::new();
    for value in values {
        validate_text(value, maximum)?;
        if !seen.insert(normalize(value)) {
            return Err(CampaignStoreError::InvalidData);
        }
    }
    Ok(())
}

fn validate_unique_ids(values: &[String]) -> Result<(), CampaignStoreError> {
    let mut seen = HashSet::new();
    for value in values {
        validate_id(value)?;
        if !seen.insert(value) {
            return Err(CampaignStoreError::InvalidData);
        }
    }
    Ok(())
}

fn normalize(value: &str) -> String {
    value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lazily_materializes_connected_places_travels_and_reopens() {
        let directory = tempfile::tempdir().expect("temp directory");
        let path = directory.path().join("dynamic-locations.sqlite");
        let store = CampaignStore::open(&path).expect("open");
        seed_world(&store, "campaign-locations");
        let initial = store
            .dynamic_location_snapshot("campaign-locations")
            .expect("initial");
        assert_eq!(initial.locations.len(), 2);
        assert!(
            initial
                .locations
                .iter()
                .all(|location| location.materialization == "OUTLINE")
        );
        let request = DynamicLocationGenerationRequest {
            campaign_id: "campaign-locations".to_owned(),
            origin_location_id: "location-city".to_owned(),
            expansion_mode: "CONNECTED".to_owned(),
            requested_count: 1,
        };
        let generation = store
            .dynamic_location_generation_snapshot(request)
            .expect("input");
        let expanded = store
            .commit_dynamic_location_generation(generation_commit(&generation, "connected"))
            .expect("commit");
        let replayed = store
            .commit_dynamic_location_generation(generation_commit(&generation, "connected"))
            .expect("replay");
        assert_eq!(replayed, expanded);
        assert_eq!(expanded.locations.len(), 3);
        assert_eq!(expanded.travel_history.len(), 0);
        let moved = store
            .travel_dynamic_location(DynamicLocationTravelCommand {
                campaign_id: "campaign-locations".to_owned(),
                target_location_id: "location-road-village".to_owned(),
                expected_revision: 1,
                mode: "ROAD".to_owned(),
                event_id: "travel-connected".to_owned(),
                operation_id: "travel-op-connected".to_owned(),
            })
            .expect("travel");
        assert_eq!(moved.state.current_location_id, "location-road-village");
        drop(store);
        let reopened = CampaignStore::open(path).expect("reopen");
        assert_eq!(
            reopened
                .dynamic_location_snapshot("campaign-locations")
                .expect("reload"),
            moved
        );
    }

    #[test]
    fn rejects_invalid_topology_and_constitution_evidence() {
        let directory = tempfile::tempdir().expect("temp directory");
        let store =
            CampaignStore::open(directory.path().join("invalid-locations.sqlite")).expect("open");
        seed_world(&store, "campaign-location-invalid");
        let snapshot = store
            .dynamic_location_generation_snapshot(DynamicLocationGenerationRequest {
                campaign_id: "campaign-location-invalid".to_owned(),
                origin_location_id: "location-city".to_owned(),
                expansion_mode: "CHILDREN".to_owned(),
                requested_count: 1,
            })
            .expect("input");
        let mut bad_parent = generation_commit(&snapshot, "bad-parent");
        bad_parent.generation.validated_output["locations"][0]["parentLocationId"] =
            json!("location-region");
        bad_parent.generation.raw_response_text =
            bad_parent.generation.validated_output.to_string();
        assert!(matches!(
            store.commit_dynamic_location_generation(bad_parent),
            Err(CampaignStoreError::InvalidData)
        ));

        let mut bad_evidence = generation_commit(&snapshot, "bad-evidence");
        bad_evidence.generation.validated_output["locations"][0]["constitutionEvidence"]["magic"] =
            json!("Unbounded magic");
        bad_evidence.generation.raw_response_text =
            bad_evidence.generation.validated_output.to_string();
        assert!(matches!(
            store.commit_dynamic_location_generation(bad_evidence),
            Err(CampaignStoreError::InvalidData)
        ));
    }

    fn generation_commit(
        snapshot: &DynamicLocationGenerationSnapshot,
        suffix: &str,
    ) -> DynamicLocationGenerationCommit {
        let mode = snapshot.input["expansionMode"].as_str().expect("mode");
        let origin = snapshot.input["originLocation"].clone();
        let candidate = json!({
            "id": "location-road-village",
            "name": "Roadside Ember",
            "kind": if mode == "CHILDREN" { "DISTRICT" } else { "VILLAGE" },
            "parentLocationId": if mode == "CHILDREN" { Some(origin["id"].clone()) } else { origin["parentLocationId"].as_str().map(|value| json!(value)) },
            "description": "A settlement beyond the preset city.",
            "atmosphere": "Wind-worn and inhabited.",
            "features": ["A marked shelter"],
            "factionIds": ["faction-harbor"],
            "connections": if mode == "CONNECTED" { vec![origin["id"].clone()] } else { Vec::<Value>::new() },
            "currentSituation": "Travelers are reopening the old route.",
            "constitutionEvidence": snapshot.input["constitutionEvidence"],
        });
        let output = json!({"schemaVersion": 1, "locations": [candidate]});
        DynamicLocationGenerationCommit {
            campaign_id: snapshot.graph.state.campaign_id.clone(),
            origin_location_id: origin["id"].as_str().expect("origin").to_owned(),
            expansion_mode: mode.to_owned(),
            requested_count: 1,
            generation: CharacterGenerationAudit {
                request_id: format!("request-location-{suffix}"),
                generation_record_id: format!("generation-location-{suffix}"),
                idempotency_key: format!("location:{suffix}"),
                prompt_version: 1,
                input: snapshot.input.clone(),
                context: json!({
                    "campaignId": snapshot.graph.state.campaign_id,
                    "originLocationId": origin["id"],
                    "expansionMode": mode,
                    "requestedCount": 1,
                }),
                request: json!({"task": "GENERATE_LOCATIONS", "modelName": "fake"}),
                raw_response_text: output.to_string(),
                validated_output: output,
            },
        }
    }

    fn seed_world(store: &CampaignStore, campaign_id: &str) {
        let at = "2026-08-20T00:00:00.000Z";
        store
            .create_at(campaign_id.to_owned(), at.to_owned())
            .expect("campaign");
        let connection = store.connect().expect("connection");
        connection.execute(
            "INSERT INTO world_bibles
             (campaign_id,schema_version,name,current_region,summary,core_conflict,technology_level,
              power_rules_json,factions_json,locations_json,narrative_style,forbidden_elements_json,
              tavern_reason,story_hooks_json,locked_fields_json,created_at,updated_at)
             VALUES (?1,1,'Ember Coast','Ash Harbor','A coast.','Old roads.','Late medieval','[]',?2,?3,
              'Grounded','[]','Crossroads','[]','[]',?4,?4)",
            params![
                campaign_id,
                r#"[{"id":"faction-harbor","name":"Harbor Wardens","description":"Road keepers","goals":[],"relations":[]}]"#,
                r#"[{"id":"location-region","name":"Ember Coast","description":"A storm coast.","parentLocationId":null,"factionIds":["faction-harbor"]},{"id":"location-city","name":"Ash Harbor","description":"The preset city.","parentLocationId":"location-region","factionIds":["faction-harbor"]}]"#,
                at,
            ],
        ).expect("world bible");
        connection.execute(
            "INSERT INTO world_constitutions
             (campaign_id,schema_version,revision,status,world_type,era,technology,magic,peoples_json,
              society,politics,economy,combat_scale,death_rules,career_rules,equipment_rules,npc_rules,
              trait_rules,taboos_json,created_at,updated_at,locked_at)
             VALUES (?1,1,1,'DRAFT','Low fantasy','Late medieval','Late medieval','Magic leaves a warm trace.',
              '[\"Harbor folk\"]','Guild towns','Harbor councils','Coin and barter','Small-scale',
              'Death is permanent.','Careers are social roles.','Local craft.','Bounded knowledge.',
              'Tradeoffs.','[]',?2,?2,NULL)",
            params![campaign_id, at],
        ).expect("constitution");
        connection
            .execute(
                "UPDATE world_constitutions SET status='LOCKED',locked_at=?2 WHERE campaign_id=?1",
                params![campaign_id, at],
            )
            .expect("lock");
    }
}

use std::collections::{HashMap, HashSet};

use rusqlite::{Connection, OptionalExtension, Transaction, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::{
    CampaignStore, CampaignStoreError, CharacterGenerationAudit, current_timestamp,
    insert_character_generation,
    quest_graph::evaluate_after_source_change,
    quest_pool::{
        transition_allowed as legal_quest_transition, transition_quest_pool_in_transaction,
    },
    validate_character_generation_audit, validate_id,
};

const PLAYER_RELATIONS: [&str; 6] = [
    "HOSTILE", "WARY", "NEUTRAL", "FRIENDLY", "ALLIED", "UNKNOWN",
];
const ACTION_KINDS: [&str; 6] = [
    "MOBILIZE",
    "EXPAND_TERRITORY",
    "DIPLOMACY",
    "SUPPORT_QUEST",
    "UNDERMINE_QUEST",
    "RECOVER",
];
const ACTION_SOURCES: [&str; 3] = ["PLAYER", "WORLD_EVENT", "DIRECTOR"];

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FactionConstitutionEvidence {
    pub technology: String,
    pub society: String,
    pub politics: String,
    pub economy: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ActiveFactionProfile {
    pub kind: String,
    pub schema_version: i64,
    pub id: String,
    pub campaign_id: String,
    pub constitution_revision: i64,
    pub materialization: String,
    pub name: String,
    pub description: String,
    pub goal: String,
    pub resources: Vec<String>,
    pub leadership: Vec<String>,
    pub enemy_faction_ids: Vec<String>,
    pub ally_faction_ids: Vec<String>,
    pub territory_location_ids: Vec<String>,
    pub current_action: Option<String>,
    pub player_relation: String,
    pub constitution_evidence: FactionConstitutionEvidence,
    pub generation_record_id: Option<String>,
    pub revision: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FactionActionEventView {
    pub id: String,
    pub campaign_id: String,
    pub faction_id: String,
    pub source: String,
    pub action_kind: String,
    pub summary: String,
    pub cost: i64,
    pub budget_decision_id: String,
    pub before_revision: i64,
    pub after_revision: i64,
    pub proposal: Value,
    pub occurred_at: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveFactionSnapshot {
    pub factions: Vec<ActiveFactionProfile>,
    pub action_history: Vec<FactionActionEventView>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveFactionGenerationSnapshot {
    pub factions: ActiveFactionSnapshot,
    pub input: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ActiveFactionGenerationRequest {
    pub campaign_id: String,
    pub requested_faction_ids: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ActiveFactionGenerationCommit {
    pub campaign_id: String,
    pub requested_faction_ids: Vec<String>,
    pub generation: CharacterGenerationAudit,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ActiveFactionCandidate {
    id: String,
    name: String,
    goal: String,
    resources: Vec<String>,
    leadership: Vec<String>,
    enemy_faction_ids: Vec<String>,
    ally_faction_ids: Vec<String>,
    territory_location_ids: Vec<String>,
    current_action: String,
    player_relation: String,
    constitution_evidence: FactionConstitutionEvidence,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ActiveFactionOutput {
    schema_version: i64,
    factions: Vec<ActiveFactionCandidate>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FactionActionBudget {
    pub decision_id: String,
    pub action_points: i64,
    pub quest_changes: i64,
    pub world_facts: i64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum FactionActionConsequence {
    ResourceAdd {
        resource: String,
    },
    ResourceRemove {
        resource: String,
    },
    TerritoryAdd {
        location_id: String,
    },
    TerritoryRemove {
        location_id: String,
    },
    RelationSet {
        faction_id: String,
        relation: String,
    },
    PlayerRelationSet {
        relation: String,
    },
    QuestStatusSet {
        quest_id: String,
        status: String,
    },
    WorldFact {
        statement: String,
        location_id: Option<String>,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FactionActionProposal {
    pub id: String,
    pub faction_id: String,
    pub kind: String,
    pub source: String,
    pub summary: String,
    pub required_resources: Vec<String>,
    pub target_faction_id: Option<String>,
    pub target_location_id: Option<String>,
    pub target_quest_id: Option<String>,
    pub consequences: Vec<FactionActionConsequence>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FactionActionCommand {
    pub event_id: String,
    pub operation_id: String,
    pub campaign_id: String,
    pub expected_revision: i64,
    pub proposal: FactionActionProposal,
    pub budget: FactionActionBudget,
    pub world_fact_id: Option<String>,
}

impl CampaignStore {
    pub fn active_faction_snapshot(
        &self,
        campaign_id: &str,
    ) -> Result<ActiveFactionSnapshot, CampaignStoreError> {
        validate_id(campaign_id)?;
        load_snapshot(&self.connect()?, campaign_id)
    }

    pub fn active_faction_generation_snapshot(
        &self,
        command: ActiveFactionGenerationRequest,
    ) -> Result<ActiveFactionGenerationSnapshot, CampaignStoreError> {
        validate_requested(&command.campaign_id, &command.requested_faction_ids)?;
        let connection = self.connect()?;
        let factions = load_snapshot(&connection, &command.campaign_id)?;
        let input = generation_input(&connection, &factions, &command.requested_faction_ids)?;
        Ok(ActiveFactionGenerationSnapshot { factions, input })
    }

    pub fn commit_active_faction_generation(
        &self,
        command: ActiveFactionGenerationCommit,
    ) -> Result<ActiveFactionSnapshot, CampaignStoreError> {
        validate_requested(&command.campaign_id, &command.requested_faction_ids)?;
        validate_character_generation_audit(&command.generation, "GENERATE_FACTIONS")?;
        let output: ActiveFactionOutput =
            serde_json::from_value(command.generation.validated_output.clone())
                .map_err(|_| CampaignStoreError::InvalidData)?;
        if output.schema_version != 1
            || output.factions.len() != command.requested_faction_ids.len()
            || output
                .factions
                .iter()
                .map(|candidate| &candidate.id)
                .collect::<HashSet<_>>()
                != command.requested_faction_ids.iter().collect::<HashSet<_>>()
        {
            return Err(CampaignStoreError::InvalidData);
        }
        let mut connection = self.connect()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        if generation_replayed(&transaction, &command)? {
            let snapshot = load_snapshot(&transaction, &command.campaign_id)?;
            transaction.commit()?;
            return Ok(snapshot);
        }
        let snapshot = load_snapshot(&transaction, &command.campaign_id)?;
        let expected_input =
            generation_input(&transaction, &snapshot, &command.requested_faction_ids)?;
        let expected_context = json!({ "campaignId": command.campaign_id, "requestedFactionIds": command.requested_faction_ids });
        if command.generation.input != expected_input
            || command.generation.context != expected_context
        {
            return Err(CampaignStoreError::InvalidData);
        }
        let evidence = locked_evidence(&transaction, &command.campaign_id)?.1;
        validate_candidates(
            &snapshot.factions,
            &command.requested_faction_ids,
            &output.factions,
            &evidence,
            &allowed_location_ids(&transaction, &command.campaign_id)?,
        )?;
        let at = current_timestamp()?;
        insert_character_generation(
            &transaction,
            &command.campaign_id,
            "GENERATE_FACTIONS",
            &command.generation,
            &at,
        )?;
        let by_id = snapshot
            .factions
            .iter()
            .map(|profile| (profile.id.as_str(), profile))
            .collect::<HashMap<_, _>>();
        for candidate in output.factions {
            let current = by_id
                .get(candidate.id.as_str())
                .ok_or(CampaignStoreError::InvalidData)?;
            let profile = ActiveFactionProfile {
                kind: "ACTIVE_FACTION".to_owned(),
                schema_version: 1,
                id: current.id.clone(),
                campaign_id: current.campaign_id.clone(),
                constitution_revision: current.constitution_revision,
                materialization: "ACTIVE".to_owned(),
                name: current.name.clone(),
                description: current.description.clone(),
                goal: current.goal.clone(),
                resources: candidate.resources,
                leadership: candidate.leadership,
                enemy_faction_ids: candidate.enemy_faction_ids,
                ally_faction_ids: candidate.ally_faction_ids,
                territory_location_ids: candidate.territory_location_ids,
                current_action: Some(candidate.current_action),
                player_relation: candidate.player_relation,
                constitution_evidence: evidence.clone(),
                generation_record_id: Some(command.generation.generation_record_id.clone()),
                revision: current.revision + 1,
                created_at: current.created_at.clone(),
                updated_at: at.clone(),
            };
            update_profile(&transaction, &profile, current.revision)?;
        }
        let saved = load_snapshot(&transaction, &command.campaign_id)?;
        transaction.commit()?;
        Ok(saved)
    }

    pub fn apply_faction_action(
        &self,
        command: FactionActionCommand,
    ) -> Result<ActiveFactionSnapshot, CampaignStoreError> {
        validate_action_command(&command)?;
        let mut connection = self.connect()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        if action_replayed(&transaction, &command)? {
            let snapshot = load_snapshot(&transaction, &command.campaign_id)?;
            transaction.commit()?;
            return Ok(snapshot);
        }
        let before = load_snapshot(&transaction, &command.campaign_id)?;
        let mut profiles = before
            .factions
            .iter()
            .cloned()
            .map(|profile| (profile.id.clone(), profile))
            .collect::<HashMap<_, _>>();
        let actor = profiles
            .get(&command.proposal.faction_id)
            .ok_or(CampaignStoreError::NotFound)?;
        if actor.materialization != "ACTIVE" || actor.revision != command.expected_revision {
            return Err(CampaignStoreError::InvalidState);
        }
        if command.proposal.required_resources.iter().any(|required| {
            !actor
                .resources
                .iter()
                .any(|resource| normalize(resource) == normalize(required))
        }) {
            return Err(CampaignStoreError::InvalidState);
        }
        let (_, evidence) = locked_evidence(&transaction, &command.campaign_id)?;
        if actor.constitution_evidence != evidence {
            return Err(CampaignStoreError::InvalidData);
        }
        let at = current_timestamp()?;
        let mut changed = HashSet::new();
        changed.insert(command.proposal.faction_id.clone());
        let mut quest_change: Option<(String, String, String)> = None;
        let mut world_fact: Option<(String, Option<String>)> = None;
        apply_consequences(
            &transaction,
            &command,
            &mut profiles,
            &mut changed,
            &mut quest_change,
            &mut world_fact,
        )?;
        for id in &changed {
            let profile = profiles
                .get_mut(id)
                .ok_or(CampaignStoreError::InvalidData)?;
            profile.revision += 1;
            profile.updated_at.clone_from(&at);
            if id == &command.proposal.faction_id {
                profile.current_action = Some(command.proposal.summary.clone());
            }
            let prior = before
                .factions
                .iter()
                .find(|value| &value.id == id)
                .ok_or(CampaignStoreError::InvalidData)?;
            update_profile(&transaction, profile, prior.revision)?;
        }
        if let Some((quest_id, before_status, after_status)) = &quest_change {
            transition_quest_pool_in_transaction(
                &transaction,
                &command.campaign_id,
                quest_id,
                None,
                Some(before_status),
                after_status,
                "FACTION",
                "Faction action changed quest conditions",
                &format!("quest:faction:{}", command.operation_id),
                &at,
            )?;
        }
        match (&world_fact, &command.world_fact_id) {
            (Some((statement, location)), Some(id)) => {
                validate_id(id)?;
                transaction.execute("INSERT INTO world_facts (id,campaign_id,kind,statement,location_id,faction_ids_json,detail_json,supersedes_fact_id,created_at) VALUES (?1,?2,'DEVELOPING_FACT',?3,?4,?5,'{}',NULL,?6)", params![id, command.campaign_id, statement, location, serde_json::to_string(&vec![&command.proposal.faction_id]).map_err(|_| CampaignStoreError::InvalidData)?, at])?;
            }
            (None, None) => {}
            _ => return Err(CampaignStoreError::InvalidData),
        }
        evaluate_after_source_change(
            &transaction,
            &command.campaign_id,
            &format!("quest-graph:faction:{}", command.operation_id),
            "FACTION_CHANGE",
            &command.proposal.faction_id,
            &at,
        )?;
        let after_actor = profiles
            .get(&command.proposal.faction_id)
            .ok_or(CampaignStoreError::InvalidData)?;
        let affected_before = before
            .factions
            .iter()
            .filter(|profile| changed.contains(&profile.id))
            .collect::<Vec<_>>();
        let affected_after = profiles
            .values()
            .filter(|profile| changed.contains(&profile.id))
            .collect::<Vec<_>>();
        let proposal_json =
            serde_json::to_value(&command.proposal).map_err(|_| CampaignStoreError::InvalidData)?;
        let budget_json =
            serde_json::to_value(&command.budget).map_err(|_| CampaignStoreError::InvalidData)?;
        transaction.execute("INSERT INTO faction_action_events (id,campaign_id,faction_id,operation_id,source,action_kind,summary,cost,budget_decision_id,budget_json,proposal_json,affected_before_json,affected_after_json,before_revision,after_revision,quest_id,quest_before_status,quest_after_status,world_fact_id,occurred_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20)", params![command.event_id, command.campaign_id, command.proposal.faction_id, command.operation_id, command.proposal.source, command.proposal.kind, command.proposal.summary, action_cost(&command.proposal.consequences), command.budget.decision_id, serde_json::to_string(&budget_json).map_err(|_| CampaignStoreError::InvalidData)?, serde_json::to_string(&proposal_json).map_err(|_| CampaignStoreError::InvalidData)?, serde_json::to_string(&affected_before).map_err(|_| CampaignStoreError::InvalidData)?, serde_json::to_string(&affected_after).map_err(|_| CampaignStoreError::InvalidData)?, command.expected_revision, after_actor.revision, quest_change.as_ref().map(|value| &value.0), quest_change.as_ref().map(|value| &value.1), quest_change.as_ref().map(|value| &value.2), command.world_fact_id, at])?;
        let saved = load_snapshot(&transaction, &command.campaign_id)?;
        transaction.commit()?;
        Ok(saved)
    }
}

fn load_snapshot(
    connection: &Connection,
    campaign_id: &str,
) -> Result<ActiveFactionSnapshot, CampaignStoreError> {
    let mut statement = connection.prepare(
        "SELECT profile_json FROM active_factions WHERE campaign_id=?1 ORDER BY name,id",
    )?;
    let factions = statement
        .query_map([campaign_id], |row| row.get::<_, String>(0))?
        .map(|value| {
            serde_json::from_str::<ActiveFactionProfile>(&value?)
                .map_err(|_| rusqlite::Error::InvalidQuery)
        })
        .collect::<Result<Vec<_>, _>>()?;
    if factions.is_empty() {
        return Err(CampaignStoreError::NotFound);
    }
    for profile in &factions {
        validate_profile(profile)?;
    }
    let mut history_statement = connection.prepare("SELECT id,campaign_id,faction_id,source,action_kind,summary,cost,budget_decision_id,before_revision,after_revision,proposal_json,occurred_at FROM faction_action_events WHERE campaign_id=?1 ORDER BY occurred_at,id")?;
    let action_history = history_statement
        .query_map([campaign_id], |row| {
            let proposal: String = row.get(10)?;
            Ok(FactionActionEventView {
                id: row.get(0)?,
                campaign_id: row.get(1)?,
                faction_id: row.get(2)?,
                source: row.get(3)?,
                action_kind: row.get(4)?,
                summary: row.get(5)?,
                cost: row.get(6)?,
                budget_decision_id: row.get(7)?,
                before_revision: row.get(8)?,
                after_revision: row.get(9)?,
                proposal: serde_json::from_str(&proposal)
                    .map_err(|_| rusqlite::Error::InvalidQuery)?,
                occurred_at: row.get(11)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(ActiveFactionSnapshot {
        factions,
        action_history,
    })
}

fn generation_input(
    connection: &Connection,
    snapshot: &ActiveFactionSnapshot,
    requested: &[String],
) -> Result<Value, CampaignStoreError> {
    let (revision, evidence) = locked_evidence(connection, &snapshot.factions[0].campaign_id)?;
    let requested_set = requested.iter().collect::<HashSet<_>>();
    let existing = snapshot.factions.iter().filter(|profile| requested_set.contains(&profile.id)).map(|profile| json!({ "id": profile.id, "name": profile.name, "description": profile.description, "goal": profile.goal, "enemyFactionIds": profile.enemy_faction_ids, "allyFactionIds": profile.ally_faction_ids, "territoryLocationIds": profile.territory_location_ids, "playerRelation": profile.player_relation })).collect::<Vec<_>>();
    Ok(
        json!({ "schemaVersion": 1, "context": { "worldId": snapshot.factions[0].campaign_id, "constitutionRevision": revision, "contextSummary": "Activate only the requested established factions without executing their actions." }, "requestedFactionIds": requested, "existingFactions": existing, "allowedFactionIds": snapshot.factions.iter().map(|profile| &profile.id).collect::<Vec<_>>(), "allowedLocationIds": allowed_location_ids(connection, &snapshot.factions[0].campaign_id)?, "constitutionEvidence": evidence }),
    )
}

fn validate_candidates(
    existing: &[ActiveFactionProfile],
    requested: &[String],
    candidates: &[ActiveFactionCandidate],
    evidence: &FactionConstitutionEvidence,
    allowed_locations: &[String],
) -> Result<(), CampaignStoreError> {
    let by_id = existing
        .iter()
        .map(|profile| (profile.id.as_str(), profile))
        .collect::<HashMap<_, _>>();
    let requested_set = requested.iter().map(String::as_str).collect::<HashSet<_>>();
    let candidate_ids = candidates
        .iter()
        .map(|candidate| candidate.id.as_str())
        .collect::<HashSet<_>>();
    if candidate_ids.len() != candidates.len() || candidate_ids != requested_set {
        return Err(CampaignStoreError::InvalidData);
    }
    let locations = allowed_locations
        .iter()
        .map(String::as_str)
        .collect::<HashSet<_>>();
    for candidate in candidates {
        let current = by_id
            .get(candidate.id.as_str())
            .ok_or(CampaignStoreError::InvalidData)?;
        validate_id(&candidate.id)?;
        if current.materialization != "OUTLINE"
            || candidate.name != current.name
            || candidate.goal != current.goal
            || candidate.player_relation != current.player_relation
            || candidate.constitution_evidence != *evidence
            || candidate.resources.is_empty()
            || candidate.leadership.is_empty()
            || !valid_text(&candidate.current_action, 4_000)
            || !unique_text(&candidate.resources)
            || !unique_text(&candidate.leadership)
            || !unique_ids(&candidate.enemy_faction_ids)
            || !unique_ids(&candidate.ally_faction_ids)
            || !unique_ids(&candidate.territory_location_ids)
            || candidate.enemy_faction_ids.contains(&candidate.id)
            || candidate.ally_faction_ids.contains(&candidate.id)
            || candidate
                .enemy_faction_ids
                .iter()
                .any(|id| candidate.ally_faction_ids.contains(id))
            || candidate
                .enemy_faction_ids
                .iter()
                .chain(&candidate.ally_faction_ids)
                .any(|id| !by_id.contains_key(id.as_str()))
            || candidate
                .territory_location_ids
                .iter()
                .any(|id| !locations.contains(id.as_str()))
            || current
                .territory_location_ids
                .iter()
                .any(|id| !candidate.territory_location_ids.contains(id))
            || current
                .enemy_faction_ids
                .iter()
                .any(|id| !candidate.enemy_faction_ids.contains(id))
            || current
                .ally_faction_ids
                .iter()
                .any(|id| !candidate.ally_faction_ids.contains(id))
        {
            return Err(CampaignStoreError::InvalidData);
        }
    }
    for candidate in candidates {
        let current = by_id
            .get(candidate.id.as_str())
            .ok_or(CampaignStoreError::InvalidData)?;
        for enemy in &candidate.enemy_faction_ids {
            let counterpart = candidates.iter().find(|other| &other.id == enemy);
            if counterpart.is_some_and(|other| !other.enemy_faction_ids.contains(&candidate.id))
                || (counterpart.is_none() && !current.enemy_faction_ids.contains(enemy))
            {
                return Err(CampaignStoreError::InvalidData);
            }
        }
        for ally in &candidate.ally_faction_ids {
            let counterpart = candidates.iter().find(|other| &other.id == ally);
            if counterpart.is_some_and(|other| !other.ally_faction_ids.contains(&candidate.id))
                || (counterpart.is_none() && !current.ally_faction_ids.contains(ally))
            {
                return Err(CampaignStoreError::InvalidData);
            }
        }
    }
    Ok(())
}

fn apply_consequences(
    connection: &Transaction<'_>,
    command: &FactionActionCommand,
    profiles: &mut HashMap<String, ActiveFactionProfile>,
    changed: &mut HashSet<String>,
    quest_change: &mut Option<(String, String, String)>,
    world_fact: &mut Option<(String, Option<String>)>,
) -> Result<(), CampaignStoreError> {
    let actor_id = command.proposal.faction_id.clone();
    let locations = allowed_location_ids(connection, &command.campaign_id)?
        .into_iter()
        .collect::<HashSet<_>>();
    for consequence in &command.proposal.consequences {
        match consequence {
            FactionActionConsequence::ResourceAdd { resource } => {
                if !valid_text(resource, 200)
                    || profiles.get(&actor_id).is_some_and(|actor| {
                        actor
                            .resources
                            .iter()
                            .any(|value| normalize(value) == normalize(resource))
                    })
                {
                    return Err(CampaignStoreError::InvalidData);
                }
                profiles
                    .get_mut(&actor_id)
                    .unwrap()
                    .resources
                    .push(resource.clone());
            }
            FactionActionConsequence::ResourceRemove { resource } => {
                let actor = profiles.get_mut(&actor_id).unwrap();
                let index = actor
                    .resources
                    .iter()
                    .position(|value| normalize(value) == normalize(resource))
                    .ok_or(CampaignStoreError::InvalidState)?;
                actor.resources.remove(index);
            }
            FactionActionConsequence::TerritoryAdd { location_id } => {
                if !locations.contains(location_id)
                    || profiles
                        .get(&actor_id)
                        .unwrap()
                        .territory_location_ids
                        .contains(location_id)
                {
                    return Err(CampaignStoreError::InvalidData);
                }
                profiles
                    .get_mut(&actor_id)
                    .unwrap()
                    .territory_location_ids
                    .push(location_id.clone());
            }
            FactionActionConsequence::TerritoryRemove { location_id } => {
                let actor = profiles.get_mut(&actor_id).unwrap();
                let index = actor
                    .territory_location_ids
                    .iter()
                    .position(|id| id == location_id)
                    .ok_or(CampaignStoreError::InvalidState)?;
                actor.territory_location_ids.remove(index);
            }
            FactionActionConsequence::RelationSet {
                faction_id,
                relation,
            } => {
                if faction_id == &actor_id
                    || !["ALLY", "ENEMY", "NEUTRAL"].contains(&relation.as_str())
                {
                    return Err(CampaignStoreError::InvalidData);
                }
                let target = profiles
                    .get(faction_id)
                    .ok_or(CampaignStoreError::NotFound)?;
                if target.materialization != "ACTIVE" {
                    return Err(CampaignStoreError::InvalidState);
                }
                let actor = profiles
                    .get(&actor_id)
                    .ok_or(CampaignStoreError::InvalidData)?;
                let current = if actor.ally_faction_ids.contains(faction_id) {
                    "ALLY"
                } else if actor.enemy_faction_ids.contains(faction_id) {
                    "ENEMY"
                } else {
                    "NEUTRAL"
                };
                if current == relation {
                    return Err(CampaignStoreError::InvalidState);
                }
                set_relation(profiles.get_mut(&actor_id).unwrap(), faction_id, relation);
                set_relation(profiles.get_mut(faction_id).unwrap(), &actor_id, relation);
                changed.insert(faction_id.clone());
            }
            FactionActionConsequence::PlayerRelationSet { relation } => {
                if !PLAYER_RELATIONS.contains(&relation.as_str())
                    || profiles.get(&actor_id).unwrap().player_relation == *relation
                {
                    return Err(CampaignStoreError::InvalidData);
                }
                profiles
                    .get_mut(&actor_id)
                    .unwrap()
                    .player_relation
                    .clone_from(relation);
            }
            FactionActionConsequence::QuestStatusSet { quest_id, status } => {
                if quest_change.is_some() {
                    return Err(CampaignStoreError::InvalidData);
                }
                let before: String = connection
                    .query_row(
                        "SELECT status FROM quest_pool_states WHERE quest_id=?1 AND campaign_id=?2",
                        params![quest_id, command.campaign_id],
                        |row| row.get(0),
                    )
                    .optional()?
                    .ok_or(CampaignStoreError::NotFound)?;
                if !legal_quest_transition(&before, status) {
                    return Err(CampaignStoreError::InvalidState);
                }
                *quest_change = Some((quest_id.clone(), before, status.clone()));
            }
            FactionActionConsequence::WorldFact {
                statement,
                location_id,
            } => {
                if world_fact.is_some()
                    || !valid_text(statement, 4_000)
                    || location_id
                        .as_ref()
                        .is_some_and(|id| !locations.contains(id))
                {
                    return Err(CampaignStoreError::InvalidData);
                }
                *world_fact = Some((statement.clone(), location_id.clone()));
            }
        }
    }
    validate_action_targets(&command.proposal, quest_change, world_fact)
}

fn validate_action_command(command: &FactionActionCommand) -> Result<(), CampaignStoreError> {
    for id in [
        &command.event_id,
        &command.operation_id,
        &command.campaign_id,
        &command.proposal.id,
        &command.proposal.faction_id,
        &command.budget.decision_id,
    ] {
        validate_id(id)?;
    }
    if command.expected_revision < 1
        || !ACTION_KINDS.contains(&command.proposal.kind.as_str())
        || !ACTION_SOURCES.contains(&command.proposal.source.as_str())
        || !valid_text(&command.proposal.summary, 4_000)
        || command.proposal.consequences.is_empty()
        || command.proposal.consequences.len() > 8
        || command.budget.action_points < 0
        || command.budget.action_points > 6
        || !(0..=1).contains(&command.budget.quest_changes)
        || !(0..=1).contains(&command.budget.world_facts)
    {
        return Err(CampaignStoreError::InvalidData);
    }
    let cost = action_cost(&command.proposal.consequences);
    let quests = command
        .proposal
        .consequences
        .iter()
        .filter(|value| matches!(value, FactionActionConsequence::QuestStatusSet { .. }))
        .count() as i64;
    let facts = command
        .proposal
        .consequences
        .iter()
        .filter(|value| matches!(value, FactionActionConsequence::WorldFact { .. }))
        .count() as i64;
    if cost > 6
        || cost > command.budget.action_points
        || quests > command.budget.quest_changes
        || facts > command.budget.world_facts
    {
        return Err(CampaignStoreError::InvalidState);
    }
    Ok(())
}

fn validate_action_targets(
    proposal: &FactionActionProposal,
    quest: &Option<(String, String, String)>,
    fact: &Option<(String, Option<String>)>,
) -> Result<(), CampaignStoreError> {
    match proposal.kind.as_str() {
        "EXPAND_TERRITORY"
            if proposal.target_location_id.is_none()
                || !proposal.consequences.iter().any(|value| matches!(value, FactionActionConsequence::TerritoryAdd { location_id } if Some(location_id) == proposal.target_location_id.as_ref()))
                || proposal.consequences.iter().any(|value| matches!(value, FactionActionConsequence::TerritoryAdd { location_id } | FactionActionConsequence::TerritoryRemove { location_id } if Some(location_id) != proposal.target_location_id.as_ref())) => Err(CampaignStoreError::InvalidData),
        "DIPLOMACY"
            if proposal.target_faction_id.is_none()
                || !proposal.consequences.iter().any(|value| matches!(value, FactionActionConsequence::RelationSet { faction_id, .. } if Some(faction_id) == proposal.target_faction_id.as_ref()))
                || proposal.consequences.iter().any(|value| matches!(value, FactionActionConsequence::RelationSet { faction_id, .. } if Some(faction_id) != proposal.target_faction_id.as_ref())) => Err(CampaignStoreError::InvalidData),
        "SUPPORT_QUEST" if quest.as_ref().is_none_or(|(id, _, status)| Some(id) != proposal.target_quest_id.as_ref() || status != "COMPLETED") => Err(CampaignStoreError::InvalidData),
        "UNDERMINE_QUEST" if quest.as_ref().is_none_or(|(id, _, status)| Some(id) != proposal.target_quest_id.as_ref() || status != "FAILED") => Err(CampaignStoreError::InvalidData),
        _ => { let _ = fact; Ok(()) }
    }
}

fn action_cost(values: &[FactionActionConsequence]) -> i64 {
    values
        .iter()
        .map(|value| match value {
            FactionActionConsequence::ResourceAdd { .. }
            | FactionActionConsequence::ResourceRemove { .. }
            | FactionActionConsequence::PlayerRelationSet { .. } => 1,
            FactionActionConsequence::TerritoryAdd { .. }
            | FactionActionConsequence::TerritoryRemove { .. }
            | FactionActionConsequence::RelationSet { .. }
            | FactionActionConsequence::WorldFact { .. } => 2,
            FactionActionConsequence::QuestStatusSet { .. } => 3,
        })
        .sum()
}

fn update_profile(
    transaction: &Transaction<'_>,
    profile: &ActiveFactionProfile,
    expected: i64,
) -> Result<(), CampaignStoreError> {
    let changed = transaction.execute("UPDATE active_factions SET materialization=?1,profile_json=?2,generation_record_id=?3,revision=?4,updated_at=?5 WHERE id=?6 AND campaign_id=?7 AND revision=?8", params![profile.materialization, serde_json::to_string(profile).map_err(|_| CampaignStoreError::InvalidData)?, profile.generation_record_id, profile.revision, profile.updated_at, profile.id, profile.campaign_id, expected])?;
    if changed != 1 {
        return Err(CampaignStoreError::InvalidState);
    }
    Ok(())
}

fn locked_evidence(
    connection: &Connection,
    campaign_id: &str,
) -> Result<(i64, FactionConstitutionEvidence), CampaignStoreError> {
    connection.query_row("SELECT revision,technology,society,politics,economy FROM world_constitutions WHERE campaign_id=?1 AND status='LOCKED'", [campaign_id], |row| Ok((row.get(0)?, FactionConstitutionEvidence { technology: row.get(1)?, society: row.get(2)?, politics: row.get(3)?, economy: row.get(4)? }))).optional()?.ok_or(CampaignStoreError::InvalidState)
}
fn allowed_location_ids(
    connection: &Connection,
    campaign_id: &str,
) -> Result<Vec<String>, CampaignStoreError> {
    let mut statement =
        connection.prepare("SELECT id FROM dynamic_locations WHERE campaign_id=?1 ORDER BY id")?;
    Ok(statement
        .query_map([campaign_id], |row| row.get(0))?
        .collect::<Result<Vec<_>, _>>()?)
}
fn validate_requested(campaign: &str, requested: &[String]) -> Result<(), CampaignStoreError> {
    validate_id(campaign)?;
    if requested.is_empty() || requested.len() > 16 || !unique_ids(requested) {
        return Err(CampaignStoreError::InvalidData);
    }
    for id in requested {
        validate_id(id)?;
    }
    Ok(())
}
fn validate_profile(profile: &ActiveFactionProfile) -> Result<(), CampaignStoreError> {
    if profile.kind != "ACTIVE_FACTION"
        || profile.schema_version != 1
        || profile.revision < 1
        || !["OUTLINE", "ACTIVE"].contains(&profile.materialization.as_str())
        || !PLAYER_RELATIONS.contains(&profile.player_relation.as_str())
        || !valid_text(&profile.name, 120)
        || !valid_text(&profile.description, 4_000)
        || !valid_text(&profile.goal, 4_000)
        || !unique_ids(&profile.enemy_faction_ids)
        || !unique_ids(&profile.ally_faction_ids)
        || profile.enemy_faction_ids.contains(&profile.id)
        || profile.ally_faction_ids.contains(&profile.id)
    {
        return Err(CampaignStoreError::InvalidData);
    }
    if profile.materialization == "ACTIVE"
        && (profile.resources.is_empty()
            || profile.leadership.is_empty()
            || profile.current_action.is_none()
            || profile.generation_record_id.is_none())
    {
        return Err(CampaignStoreError::InvalidData);
    }
    Ok(())
}
fn set_relation(profile: &mut ActiveFactionProfile, target: &str, relation: &str) {
    profile.enemy_faction_ids.retain(|id| id != target);
    profile.ally_faction_ids.retain(|id| id != target);
    if relation == "ALLY" {
        profile.ally_faction_ids.push(target.to_owned());
    } else if relation == "ENEMY" {
        profile.enemy_faction_ids.push(target.to_owned());
    }
}
fn valid_text(value: &str, max: usize) -> bool {
    !value.is_empty() && value.trim() == value && value.chars().count() <= max
}
fn normalize(value: &str) -> String {
    value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}
fn unique_ids(values: &[String]) -> bool {
    values.len() <= 64 && values.iter().collect::<HashSet<_>>().len() == values.len()
}
fn unique_text(values: &[String]) -> bool {
    values.len() <= 24
        && values.iter().all(|value| valid_text(value, 200))
        && values
            .iter()
            .map(|value| normalize(value))
            .collect::<HashSet<_>>()
            .len()
            == values.len()
}

fn generation_replayed(
    transaction: &Transaction<'_>,
    command: &ActiveFactionGenerationCommit,
) -> Result<bool, CampaignStoreError> {
    let prior = transaction
        .query_row(
            "SELECT campaign_id,validated_output_json FROM generation_records WHERE id=?1",
            [&command.generation.generation_record_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?)),
        )
        .optional()?;
    match prior {
        None => Ok(false),
        Some((campaign, output))
            if campaign == command.campaign_id
                && output
                    .as_deref()
                    .and_then(|value| serde_json::from_str::<Value>(value).ok())
                    .as_ref()
                    == Some(&command.generation.validated_output) =>
        {
            Ok(true)
        }
        Some(_) => Err(CampaignStoreError::InvalidState),
    }
}

fn action_replayed(
    transaction: &Transaction<'_>,
    command: &FactionActionCommand,
) -> Result<bool, CampaignStoreError> {
    let prior = transaction.query_row("SELECT campaign_id,before_revision,budget_decision_id,budget_json,proposal_json FROM faction_action_events WHERE operation_id=?1", [&command.operation_id], |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?, row.get::<_, String>(2)?, row.get::<_, String>(3)?, row.get::<_, String>(4)?))).optional()?;
    match prior {
        None => Ok(false),
        Some((campaign, revision, decision, budget, proposal))
            if campaign == command.campaign_id
                && revision == command.expected_revision
                && decision == command.budget.decision_id
                && serde_json::from_str::<FactionActionBudget>(&budget)
                    .ok()
                    .as_ref()
                    == Some(&command.budget)
                && serde_json::from_str::<FactionActionProposal>(&proposal)
                    .ok()
                    .as_ref()
                    == Some(&command.proposal) =>
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
    fn activates_factions_applies_symmetric_action_and_reopens() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("active-factions.sqlite");
        let store = CampaignStore::open(&path).unwrap();
        seed_world(&store);

        let generation = store
            .active_faction_generation_snapshot(ActiveFactionGenerationRequest {
                campaign_id: "campaign-factions-native".to_owned(),
                requested_faction_ids: vec![
                    "faction-ferrymen".to_owned(),
                    "faction-wardens".to_owned(),
                ],
            })
            .unwrap();
        let evidence = FactionConstitutionEvidence {
            technology: "Late medieval".to_owned(),
            society: "Guild towns".to_owned(),
            politics: "Harbor councils".to_owned(),
            economy: "Coin and barter".to_owned(),
        };
        let output = json!({
            "schemaVersion": 1,
            "factions": [
                candidate("faction-ferrymen", "Ash Ferrymen", "Protect the river route.", "River boats", "Speaker Iven", &evidence),
                candidate("faction-wardens", "Road Wardens", "Reopen the king road.", "Road permits", "Captain Mara", &evidence),
            ]
        });
        let raw = serde_json::to_string(&output).unwrap();
        let committed = store
            .commit_active_faction_generation(ActiveFactionGenerationCommit {
                campaign_id: "campaign-factions-native".to_owned(),
                requested_faction_ids: vec![
                    "faction-ferrymen".to_owned(),
                    "faction-wardens".to_owned(),
                ],
                generation: CharacterGenerationAudit {
                    request_id: "request-factions-native".to_owned(),
                    generation_record_id: "generation-factions-native".to_owned(),
                    idempotency_key: "factions:native".to_owned(),
                    prompt_version: 1,
                    input: generation.input,
                    context: json!({
                        "campaignId": "campaign-factions-native",
                        "requestedFactionIds": ["faction-ferrymen", "faction-wardens"]
                    }),
                    request: json!({ "task": "GENERATE_FACTIONS" }),
                    raw_response_text: raw,
                    validated_output: output,
                },
            })
            .unwrap();
        assert!(
            committed
                .factions
                .iter()
                .all(|value| value.materialization == "ACTIVE")
        );

        let command = FactionActionCommand {
            event_id: "event-factions-native".to_owned(),
            operation_id: "operation-factions-native".to_owned(),
            campaign_id: "campaign-factions-native".to_owned(),
            expected_revision: 2,
            proposal: FactionActionProposal {
                id: "proposal-factions-native".to_owned(),
                faction_id: "faction-wardens".to_owned(),
                kind: "DIPLOMACY".to_owned(),
                source: "PLAYER".to_owned(),
                summary: "The wardens recognize the ferrymen as allies.".to_owned(),
                required_resources: vec!["Road permits".to_owned()],
                target_faction_id: Some("faction-ferrymen".to_owned()),
                target_location_id: None,
                target_quest_id: None,
                consequences: vec![
                    FactionActionConsequence::RelationSet {
                        faction_id: "faction-ferrymen".to_owned(),
                        relation: "ALLY".to_owned(),
                    },
                    FactionActionConsequence::PlayerRelationSet {
                        relation: "FRIENDLY".to_owned(),
                    },
                ],
            },
            budget: FactionActionBudget {
                decision_id: "budget-factions-native".to_owned(),
                action_points: 3,
                quest_changes: 0,
                world_facts: 0,
            },
            world_fact_id: None,
        };
        let acted = store.apply_faction_action(command).unwrap();
        assert_eq!(acted.action_history.len(), 1);
        assert!(acted.factions.iter().all(|profile| {
            if profile.id == "faction-wardens" {
                profile.ally_faction_ids == ["faction-ferrymen"]
                    && profile.player_relation == "FRIENDLY"
            } else {
                profile.ally_faction_ids == ["faction-wardens"]
            }
        }));

        drop(store);
        let reopened = CampaignStore::open(path).unwrap();
        assert_eq!(
            reopened
                .active_faction_snapshot("campaign-factions-native")
                .unwrap(),
            acted
        );
    }

    fn candidate(
        id: &str,
        name: &str,
        goal: &str,
        resource: &str,
        leader: &str,
        evidence: &FactionConstitutionEvidence,
    ) -> Value {
        json!({
            "id": id,
            "name": name,
            "goal": goal,
            "resources": [resource],
            "leadership": [leader],
            "enemyFactionIds": [],
            "allyFactionIds": [],
            "territoryLocationIds": if id == "faction-wardens" { vec!["location-city"] } else { vec!["location-region"] },
            "currentAction": "Securing the old routes.",
            "playerRelation": "UNKNOWN",
            "constitutionEvidence": evidence,
        })
    }

    fn seed_world(store: &CampaignStore) {
        let connection = store.connect().unwrap();
        let at = "2026-08-20T10:00:00Z";
        connection.execute("INSERT INTO campaigns (id,schema_version,state,created_at,updated_at) VALUES ('campaign-factions-native',1,'REVIEWING_WORLD',?1,?1)", [at]).unwrap();
        connection.execute("INSERT INTO world_bibles (campaign_id,schema_version,name,current_region,summary,core_conflict,technology_level,power_rules_json,factions_json,locations_json,narrative_style,forbidden_elements_json,tavern_reason,story_hooks_json,locked_fields_json,created_at,updated_at) VALUES ('campaign-factions-native',1,'Ember Coast','Ash Harbor','A coast.','Old roads.','Late medieval','[]',?1,?2,'Grounded','[]','Crossroads','[]','[]',?3,?3)", params![
            serde_json::to_string(&json!([
                { "id": "faction-wardens", "name": "Road Wardens", "description": "Keep the roads.", "goals": ["Reopen the king road."], "relations": [] },
                { "id": "faction-ferrymen", "name": "Ash Ferrymen", "description": "Keep the crossings.", "goals": ["Protect the river route."], "relations": [] }
            ])).unwrap(),
            serde_json::to_string(&json!([
                { "id": "location-region", "name": "Ember Coast", "description": "A coast.", "parentLocationId": null, "factionIds": ["faction-ferrymen"] },
                { "id": "location-city", "name": "Ash Harbor", "description": "A city.", "parentLocationId": "location-region", "factionIds": ["faction-wardens"] }
            ])).unwrap(),
            at,
        ]).unwrap();
        connection.execute("INSERT INTO world_constitutions (campaign_id,schema_version,revision,status,world_type,era,technology,magic,peoples_json,society,politics,economy,combat_scale,death_rules,career_rules,equipment_rules,npc_rules,trait_rules,taboos_json,created_at,updated_at,locked_at) VALUES ('campaign-factions-native',1,1,'DRAFT','Low fantasy','Late medieval','Late medieval','Rare','[\"Harbor folk\"]','Guild towns','Harbor councils','Coin and barter','Small','Permanent','Social','Local','Bounded','Tradeoffs','[]',?1,?1,NULL)", [at]).unwrap();
        connection.execute("UPDATE world_constitutions SET status='LOCKED',locked_at=?1 WHERE campaign_id='campaign-factions-native'", [at]).unwrap();
    }
}

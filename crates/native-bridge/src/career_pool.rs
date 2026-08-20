use std::collections::{HashMap, HashSet};

use rusqlite::{Connection, OptionalExtension, Transaction, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::{
    CampaignStore, CampaignStoreError, CharacterGenerationAudit, current_timestamp,
    insert_character_generation, validate_character_generation_audit, validate_id,
};

const RARITIES: &[&str] = &["COMMON", "UNCOMMON", "RARE", "SPECIAL"];
const ARCHETYPES: &[&str] = &["WARRIOR", "ROGUE", "SCHOLAR", "DIPLOMAT"];

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CareerConstitutionEvidence {
    pub career_rules: String,
    pub society: String,
    pub technology: String,
    pub economy: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CareerDefinition {
    pub kind: String,
    pub schema_version: i64,
    pub id: String,
    pub campaign_id: String,
    pub constitution_revision: i64,
    pub name: String,
    pub rarity: String,
    pub role: String,
    pub skills: Vec<String>,
    pub equipment_tags: Vec<String>,
    pub social_position: String,
    pub relationship_hooks: Vec<String>,
    pub risks: Vec<String>,
    pub requirements: Vec<String>,
    pub constitution_evidence: CareerConstitutionEvidence,
    pub legacy_archetype: String,
    pub source: String,
    pub generation_record_id: Option<String>,
    pub created_at: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CareerPool {
    pub kind: String,
    pub schema_version: i64,
    pub campaign_id: String,
    pub constitution_revision: i64,
    pub careers: Vec<CareerDefinition>,
    pub revision: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CareerPoolGenerationCommit {
    pub campaign_id: String,
    pub expected_revision: i64,
    pub generation: CharacterGenerationAudit,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CareerGenerationContext {
    world_id: String,
    constitution_revision: i64,
    context_summary: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CareerGenerationInput {
    schema_version: i64,
    context: CareerGenerationContext,
    generation_mode: String,
    requested_count: usize,
    requested_rarities: Vec<String>,
    existing_career_ids: Vec<String>,
    existing_career_names: Vec<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CareerCandidate {
    id: String,
    name: String,
    rarity: String,
    role: String,
    skills: Vec<String>,
    equipment_tags: Vec<String>,
    social_position: String,
    relationship_hooks: Vec<String>,
    risks: Vec<String>,
    requirements: Vec<String>,
    constitution_evidence: CareerConstitutionEvidence,
    legacy_archetype: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CareerGenerationOutput {
    schema_version: i64,
    careers: Vec<CareerCandidate>,
}

impl CampaignStore {
    pub fn career_pool_snapshot(
        &self,
        campaign_id: &str,
    ) -> Result<Option<CareerPool>, CampaignStoreError> {
        validate_id(campaign_id)?;
        let connection = self.connect()?;
        load_career_pool(&connection, campaign_id)
    }

    pub fn commit_career_pool_generation(
        &self,
        command: CareerPoolGenerationCommit,
    ) -> Result<CareerPool, CampaignStoreError> {
        validate_id(&command.campaign_id)?;
        if command.expected_revision < 0 {
            return Err(CampaignStoreError::InvalidData);
        }
        validate_character_generation_audit(&command.generation, "GENERATE_CAREER_POOL")?;
        let input: CareerGenerationInput = serde_json::from_value(command.generation.input.clone())
            .map_err(|_| CampaignStoreError::InvalidData)?;
        let output: CareerGenerationOutput =
            serde_json::from_value(command.generation.validated_output.clone())
                .map_err(|_| CampaignStoreError::InvalidData)?;
        let mut connection = self.connect()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        if career_generation_replayed(
            &transaction,
            &command.campaign_id,
            &command.generation.idempotency_key,
        )? {
            let pool = load_career_pool(&transaction, &command.campaign_id)?
                .ok_or(CampaignStoreError::InvalidData)?;
            transaction.commit()?;
            return Ok(pool);
        }
        let current = load_career_pool(&transaction, &command.campaign_id)?;
        if current.as_ref().map_or(0, |pool| pool.revision) != command.expected_revision {
            return Err(CampaignStoreError::InvalidState);
        }
        let (revision, constitution, constitution_value) =
            locked_constitution(&transaction, &command.campaign_id)?;
        if command.generation.context
            != json!({
                "campaignId": command.campaign_id,
                "constitutionRevision": revision,
                "expectedPoolRevision": command.expected_revision,
            })
        {
            return Err(CampaignStoreError::InvalidData);
        }
        validate_generation_input(
            &input,
            &command.campaign_id,
            revision,
            &constitution_value,
            current.as_ref(),
        )?;
        let at = current_timestamp()?;
        let additions = validate_candidates(
            &output,
            &input,
            &command.campaign_id,
            revision,
            &constitution,
            current.as_ref(),
            &command.generation.generation_record_id,
            &at,
        )?;
        let pool = CareerPool {
            kind: "CAREER_POOL".to_owned(),
            schema_version: 1,
            campaign_id: command.campaign_id.clone(),
            constitution_revision: revision,
            careers: current
                .as_ref()
                .map(|pool| pool.careers.clone())
                .unwrap_or_default()
                .into_iter()
                .chain(additions)
                .collect(),
            revision: command.expected_revision + 1,
            created_at: current
                .as_ref()
                .map(|pool| pool.created_at.clone())
                .unwrap_or_else(|| at.clone()),
            updated_at: at.clone(),
        };
        validate_pool(&pool)?;
        insert_character_generation(
            &transaction,
            &command.campaign_id,
            "GENERATE_CAREER_POOL",
            &command.generation,
            &at,
        )?;
        persist_pool(&transaction, &pool, command.expected_revision)?;
        transaction.commit()?;
        Ok(pool)
    }
}

pub(crate) fn load_career_pool_value(
    connection: &Connection,
    campaign_id: &str,
) -> Result<Option<Value>, CampaignStoreError> {
    load_career_pool(connection, campaign_id)?
        .map(|pool| serde_json::to_value(pool).map_err(|_| CampaignStoreError::InvalidData))
        .transpose()
}

pub(crate) fn career_pool_generation_context(
    connection: &Connection,
    campaign_id: &str,
) -> Result<Value, CampaignStoreError> {
    let pool = load_career_pool(connection, campaign_id)?.ok_or(CampaignStoreError::InvalidData)?;
    Ok(Value::Array(
        pool.careers
            .into_iter()
            .map(|career| {
                json!({
                    "id": career.id,
                    "name": career.name,
                    "rarity": career.rarity,
                    "role": career.role,
                    "requirements": career.requirements,
                    "legacyArchetype": career.legacy_archetype,
                })
            })
            .collect(),
    ))
}

pub(crate) fn validate_character_career_reference(
    connection: &Connection,
    campaign_id: &str,
    career_id: Option<&str>,
    display_name: &str,
    legacy_archetype: Option<&str>,
) -> Result<(), CampaignStoreError> {
    let pool = load_career_pool(connection, campaign_id)?.ok_or(CampaignStoreError::InvalidData)?;
    let career_id = career_id.ok_or(CampaignStoreError::InvalidData)?;
    let career = pool
        .careers
        .iter()
        .find(|career| career.id == career_id)
        .ok_or(CampaignStoreError::InvalidData)?;
    if career.name != display_name || Some(career.legacy_archetype.as_str()) != legacy_archetype {
        return Err(CampaignStoreError::InvalidData);
    }
    Ok(())
}

fn validate_generation_input(
    input: &CareerGenerationInput,
    campaign_id: &str,
    constitution_revision: i64,
    constitution_value: &Value,
    current: Option<&CareerPool>,
) -> Result<(), CampaignStoreError> {
    let summarized: Value = serde_json::from_str(&input.context.context_summary)
        .map_err(|_| CampaignStoreError::InvalidData)?;
    let existing_ids: Vec<String> = current
        .map(|pool| {
            pool.careers
                .iter()
                .map(|career| career.id.clone())
                .collect()
        })
        .unwrap_or_default();
    let existing_names: Vec<String> = current
        .map(|pool| {
            pool.careers
                .iter()
                .map(|career| career.name.clone())
                .collect()
        })
        .unwrap_or_default();
    let mode_valid = match current {
        None => input.generation_mode == "INITIAL",
        Some(_) => input.generation_mode == "RUNTIME_DISCOVERY",
    };
    if input.schema_version != 1
        || input.context.world_id != campaign_id
        || input.context.constitution_revision != constitution_revision
        || summarized != *constitution_value
        || !mode_valid
        || input.requested_count == 0
        || input.requested_count > 24
        || input.requested_count != input.requested_rarities.len()
        || input.existing_career_ids != existing_ids
        || input.existing_career_names != existing_names
        || input
            .requested_rarities
            .iter()
            .any(|rarity| !RARITIES.contains(&rarity.as_str()))
    {
        return Err(CampaignStoreError::InvalidData);
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn validate_candidates(
    output: &CareerGenerationOutput,
    input: &CareerGenerationInput,
    campaign_id: &str,
    constitution_revision: i64,
    evidence: &CareerConstitutionEvidence,
    current: Option<&CareerPool>,
    generation_record_id: &str,
    at: &str,
) -> Result<Vec<CareerDefinition>, CampaignStoreError> {
    if output.schema_version != 1 || output.careers.len() != input.requested_count {
        return Err(CampaignStoreError::InvalidData);
    }
    let expected_counts = rarity_counts(&input.requested_rarities)?;
    let actual_counts = rarity_counts(
        &output
            .careers
            .iter()
            .map(|career| career.rarity.clone())
            .collect::<Vec<_>>(),
    )?;
    if expected_counts != actual_counts {
        return Err(CampaignStoreError::InvalidData);
    }
    let mut ids = current
        .map(|pool| {
            pool.careers
                .iter()
                .map(|career| career.id.clone())
                .collect::<HashSet<_>>()
        })
        .unwrap_or_default();
    let mut names = current
        .map(|pool| {
            pool.careers
                .iter()
                .map(|career| normalize_name(&career.name))
                .collect::<HashSet<_>>()
        })
        .unwrap_or_default();
    output
        .careers
        .iter()
        .map(|candidate| {
            validate_id(&candidate.id)?;
            if !ids.insert(candidate.id.clone()) || !names.insert(normalize_name(&candidate.name)) {
                return Err(CampaignStoreError::InvalidData);
            }
            validate_candidate(candidate, evidence)?;
            Ok(CareerDefinition {
                kind: "CAREER_DEFINITION".to_owned(),
                schema_version: 1,
                id: candidate.id.clone(),
                campaign_id: campaign_id.to_owned(),
                constitution_revision,
                name: candidate.name.clone(),
                rarity: candidate.rarity.clone(),
                role: candidate.role.clone(),
                skills: candidate.skills.clone(),
                equipment_tags: candidate.equipment_tags.clone(),
                social_position: candidate.social_position.clone(),
                relationship_hooks: candidate.relationship_hooks.clone(),
                risks: candidate.risks.clone(),
                requirements: candidate.requirements.clone(),
                constitution_evidence: candidate.constitution_evidence.clone(),
                legacy_archetype: candidate.legacy_archetype.clone(),
                source: if current.is_none() {
                    "INITIAL_GENERATION".to_owned()
                } else {
                    "RUNTIME_DISCOVERY".to_owned()
                },
                generation_record_id: Some(generation_record_id.to_owned()),
                created_at: at.to_owned(),
            })
        })
        .collect()
}

fn validate_candidate(
    candidate: &CareerCandidate,
    evidence: &CareerConstitutionEvidence,
) -> Result<(), CampaignStoreError> {
    validate_text(&candidate.name, 120)?;
    validate_text(&candidate.role, 4_000)?;
    validate_text(&candidate.social_position, 4_000)?;
    validate_list(&candidate.skills, true)?;
    validate_list(&candidate.equipment_tags, false)?;
    validate_list(&candidate.relationship_hooks, true)?;
    validate_list(&candidate.risks, true)?;
    validate_list(&candidate.requirements, true)?;
    if !RARITIES.contains(&candidate.rarity.as_str())
        || !ARCHETYPES.contains(&candidate.legacy_archetype.as_str())
        || candidate.constitution_evidence != *evidence
    {
        return Err(CampaignStoreError::InvalidData);
    }
    Ok(())
}

fn validate_pool(pool: &CareerPool) -> Result<(), CampaignStoreError> {
    validate_id(&pool.campaign_id)?;
    if pool.kind != "CAREER_POOL"
        || pool.schema_version != 1
        || pool.constitution_revision < 1
        || pool.revision < 1
        || pool.careers.is_empty()
        || pool.careers.len() > 64
        || pool.updated_at < pool.created_at
    {
        return Err(CampaignStoreError::InvalidData);
    }
    let mut ids = HashSet::new();
    let mut names = HashSet::new();
    for career in &pool.careers {
        validate_id(&career.id)?;
        validate_id(
            career
                .generation_record_id
                .as_deref()
                .ok_or(CampaignStoreError::InvalidData)?,
        )?;
        if career.kind != "CAREER_DEFINITION"
            || career.schema_version != 1
            || career.campaign_id != pool.campaign_id
            || career.constitution_revision != pool.constitution_revision
            || !["INITIAL_GENERATION", "RUNTIME_DISCOVERY"].contains(&career.source.as_str())
            || !ids.insert(career.id.clone())
            || !names.insert(normalize_name(&career.name))
        {
            return Err(CampaignStoreError::InvalidData);
        }
        validate_candidate(
            &CareerCandidate {
                id: career.id.clone(),
                name: career.name.clone(),
                rarity: career.rarity.clone(),
                role: career.role.clone(),
                skills: career.skills.clone(),
                equipment_tags: career.equipment_tags.clone(),
                social_position: career.social_position.clone(),
                relationship_hooks: career.relationship_hooks.clone(),
                risks: career.risks.clone(),
                requirements: career.requirements.clone(),
                constitution_evidence: career.constitution_evidence.clone(),
                legacy_archetype: career.legacy_archetype.clone(),
            },
            &career.constitution_evidence,
        )?;
    }
    Ok(())
}

fn persist_pool(
    transaction: &Transaction<'_>,
    pool: &CareerPool,
    expected_revision: i64,
) -> Result<(), CampaignStoreError> {
    let serialized = serde_json::to_string(pool).map_err(|_| CampaignStoreError::InvalidData)?;
    if expected_revision == 0 {
        transaction.execute(
            "INSERT INTO career_pools (
               campaign_id, schema_version, constitution_revision, pool_json,
               revision, created_at, updated_at
             ) VALUES (?1, 1, ?2, ?3, ?4, ?5, ?6)",
            params![
                pool.campaign_id,
                pool.constitution_revision,
                serialized,
                pool.revision,
                pool.created_at,
                pool.updated_at
            ],
        )?;
    } else {
        let changed = transaction.execute(
            "UPDATE career_pools SET pool_json = ?1, revision = ?2, updated_at = ?3
             WHERE campaign_id = ?4 AND revision = ?5",
            params![
                serialized,
                pool.revision,
                pool.updated_at,
                pool.campaign_id,
                expected_revision
            ],
        )?;
        if changed != 1 {
            return Err(CampaignStoreError::InvalidState);
        }
    }
    Ok(())
}

fn load_career_pool(
    connection: &Connection,
    campaign_id: &str,
) -> Result<Option<CareerPool>, CampaignStoreError> {
    let row = connection
        .query_row(
            "SELECT schema_version, constitution_revision, pool_json, revision, created_at, updated_at
             FROM career_pools WHERE campaign_id = ?1",
            [campaign_id],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                ))
            },
        )
        .optional()?;
    row.map(|value| {
        let pool: CareerPool =
            serde_json::from_str(&value.2).map_err(|_| CampaignStoreError::InvalidData)?;
        validate_pool(&pool)?;
        let (constitution_revision, evidence, _) = locked_constitution(connection, campaign_id)?;
        if pool.campaign_id != campaign_id
            || pool.schema_version != value.0
            || pool.constitution_revision != value.1
            || pool.constitution_revision != constitution_revision
            || pool.revision != value.3
            || pool.created_at != value.4
            || pool.updated_at != value.5
            || pool
                .careers
                .iter()
                .any(|career| career.constitution_evidence != evidence)
        {
            return Err(CampaignStoreError::InvalidData);
        }
        Ok(pool)
    })
    .transpose()
}

fn locked_constitution(
    connection: &Connection,
    campaign_id: &str,
) -> Result<(i64, CareerConstitutionEvidence, Value), CampaignStoreError> {
    connection
        .query_row(
            "SELECT revision, world_type, era, technology, magic, peoples_json, society,
                    politics, economy, combat_scale, death_rules, career_rules,
                    equipment_rules, npc_rules, trait_rules, taboos_json
             FROM world_constitutions WHERE campaign_id = ?1 AND status = 'LOCKED'",
            [campaign_id],
            |row| {
                let revision = row.get::<_, i64>(0)?;
                let technology = row.get::<_, String>(3)?;
                let society = row.get::<_, String>(6)?;
                let economy = row.get::<_, String>(8)?;
                let career_rules = row.get::<_, String>(11)?;
                let value = json!({
                    "schemaVersion": 1,
                    "worldType": row.get::<_, String>(1)?,
                    "era": row.get::<_, String>(2)?,
                    "technology": technology,
                    "magic": row.get::<_, String>(4)?,
                    "peoples": serde_json::from_str::<Value>(&row.get::<_, String>(5)?)
                        .map_err(|error| rusqlite::Error::FromSqlConversionFailure(5, rusqlite::types::Type::Text, Box::new(error)))?,
                    "society": society,
                    "politics": row.get::<_, String>(7)?,
                    "economy": economy,
                    "combatScale": row.get::<_, String>(9)?,
                    "deathRules": row.get::<_, String>(10)?,
                    "careerRules": career_rules,
                    "equipmentRules": row.get::<_, String>(12)?,
                    "npcRules": row.get::<_, String>(13)?,
                    "traitRules": row.get::<_, String>(14)?,
                    "taboos": serde_json::from_str::<Value>(&row.get::<_, String>(15)?)
                        .map_err(|error| rusqlite::Error::FromSqlConversionFailure(15, rusqlite::types::Type::Text, Box::new(error)))?,
                });
                Ok((
                    revision,
                    CareerConstitutionEvidence {
                        career_rules: value["careerRules"].as_str().unwrap_or_default().to_owned(),
                        society: value["society"].as_str().unwrap_or_default().to_owned(),
                        technology: value["technology"].as_str().unwrap_or_default().to_owned(),
                        economy: value["economy"].as_str().unwrap_or_default().to_owned(),
                    },
                    value,
                ))
            },
        )
        .optional()?
        .ok_or(CampaignStoreError::InvalidState)
}

fn career_generation_replayed(
    connection: &Connection,
    campaign_id: &str,
    idempotency_key: &str,
) -> Result<bool, CampaignStoreError> {
    let row = connection
        .query_row(
            "SELECT campaign_id, task, status FROM pending_ai_requests WHERE idempotency_key = ?1",
            [idempotency_key],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            },
        )
        .optional()?;
    match row {
        None => Ok(false),
        Some((stored_campaign, task, status))
            if stored_campaign == campaign_id
                && task == "GENERATE_CAREER_POOL"
                && status == "COMMITTED" =>
        {
            Ok(true)
        }
        Some(_) => Err(CampaignStoreError::InvalidState),
    }
}

fn rarity_counts(values: &[String]) -> Result<HashMap<String, usize>, CampaignStoreError> {
    let mut counts = HashMap::new();
    for value in values {
        if !RARITIES.contains(&value.as_str()) {
            return Err(CampaignStoreError::InvalidData);
        }
        *counts.entry(value.clone()).or_default() += 1;
    }
    Ok(counts)
}

fn validate_text(value: &str, max: usize) -> Result<(), CampaignStoreError> {
    if value.is_empty() || value.trim() != value || value.chars().count() > max {
        return Err(CampaignStoreError::InvalidData);
    }
    Ok(())
}

fn validate_list(values: &[String], required: bool) -> Result<(), CampaignStoreError> {
    if values.len() > 24 || (required && values.is_empty()) {
        return Err(CampaignStoreError::InvalidData);
    }
    let mut normalized = HashSet::new();
    for value in values {
        validate_text(value, 200)?;
        if !normalized.insert(normalize_name(value)) {
            return Err(CampaignStoreError::InvalidData);
        }
    }
    Ok(())
}

fn normalize_name(value: &str) -> String {
    value
        .chars()
        .map(|character| match character {
            '\u{3000}' => ' ',
            '\u{ff01}'..='\u{ff5e}' => {
                char::from_u32(character as u32 - 0xfee0).expect("full-width ASCII offset is valid")
            }
            _ => character,
        })
        .flat_map(char::to_lowercase)
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn initial_and_runtime_careers_commit_replay_and_reopen_without_duplicates() {
        let directory = tempfile::tempdir().expect("temp directory");
        let path = directory.path().join("careers.sqlite");
        let store = CampaignStore::open(&path).expect("open");
        seed_world(&store, "campaign-career-native");
        let initial = generation_command("campaign-career-native", 0, "INITIAL", initial_output());
        let pool = store
            .commit_career_pool_generation(initial)
            .expect("initial pool");
        assert_eq!(pool.revision, 1);
        assert_eq!(
            pool.careers
                .iter()
                .map(|career| career.rarity.as_str())
                .collect::<Vec<_>>(),
            vec!["COMMON", "UNCOMMON", "RARE", "SPECIAL"]
        );
        let replayed = store
            .commit_career_pool_generation(generation_command(
                "campaign-career-native",
                0,
                "INITIAL",
                initial_output(),
            ))
            .expect("idempotent replay");
        assert_eq!(replayed, pool);

        let runtime = generation_command(
            "campaign-career-native",
            1,
            "RUNTIME_DISCOVERY",
            json!({
                "schemaVersion": 1,
                "careers": [candidate("career-night-ferryman", "Night Ferryman", "COMMON", "SCHOLAR")]
            }),
        );
        let expanded = store
            .commit_career_pool_generation(runtime)
            .expect("runtime career");
        assert_eq!(expanded.revision, 2);
        assert_eq!(expanded.careers.len(), 5);
        drop(store);

        let reopened = CampaignStore::open(path).expect("reopen");
        let restored = reopened
            .career_pool_snapshot("campaign-career-native")
            .expect("snapshot")
            .expect("pool");
        assert_eq!(restored, expanded);
        validate_character_career_reference(
            &reopened.connect().expect("connection"),
            "campaign-career-native",
            Some("career-night-ferryman"),
            "Night Ferryman",
            Some("SCHOLAR"),
        )
        .expect("character reference");
    }

    #[test]
    fn native_boundary_rejects_rarity_evidence_and_normalized_name_arbitrage() {
        let directory = tempfile::tempdir().expect("temp directory");
        let store =
            CampaignStore::open(directory.path().join("career-reject.sqlite")).expect("open");
        seed_world(&store, "campaign-career-reject");
        let mut wrong_rarity = initial_output();
        wrong_rarity["careers"][1]["rarity"] = Value::String("COMMON".to_owned());
        let mut wrong_rarity_command =
            generation_command("campaign-career-reject", 0, "INITIAL", wrong_rarity);
        wrong_rarity_command.generation.input["requestedRarities"] =
            json!(["COMMON", "UNCOMMON", "RARE", "SPECIAL"]);
        assert!(matches!(
            store.commit_career_pool_generation(wrong_rarity_command),
            Err(CampaignStoreError::InvalidData)
        ));

        let mut wrong_evidence = initial_output();
        wrong_evidence["careers"][0]["constitutionEvidence"]["technology"] =
            Value::String("Orbital lasers".to_owned());
        assert!(matches!(
            store.commit_career_pool_generation(generation_command_with_suffix(
                "campaign-career-reject",
                0,
                "INITIAL",
                wrong_evidence,
                "evidence",
            )),
            Err(CampaignStoreError::InvalidData)
        ));

        store
            .commit_career_pool_generation(generation_command_with_suffix(
                "campaign-career-reject",
                0,
                "INITIAL",
                initial_output(),
                "valid",
            ))
            .expect("valid pool");
        let duplicate = json!({
            "schemaVersion": 1,
            "careers": [candidate("career-copy", "Ｈａｒｂｏｒ　Ｒｕｎｎｅｒ", "COMMON", "ROGUE")]
        });
        assert!(matches!(
            store.commit_career_pool_generation(generation_command_with_suffix(
                "campaign-career-reject",
                1,
                "RUNTIME_DISCOVERY",
                duplicate,
                "duplicate",
            )),
            Err(CampaignStoreError::InvalidData)
        ));
        assert_eq!(
            store
                .career_pool_snapshot("campaign-career-reject")
                .expect("snapshot")
                .expect("pool")
                .revision,
            1
        );
        let connection = store.connect().expect("connection");
        connection
            .execute(
                "UPDATE career_pools
                 SET pool_json = json_set(
                   pool_json,
                   '$.revision',
                   2,
                   '$.updatedAt',
                   '2026-08-20T03:00:00.000Z',
                   '$.careers[0].constitutionEvidence.technology',
                   'Orbital lasers'
                 ),
                 revision = 2,
                 updated_at = '2026-08-20T03:00:00.000Z'
                 WHERE campaign_id = 'campaign-career-reject'",
                [],
            )
            .expect("tamper pool evidence");
        assert!(matches!(
            store.career_pool_snapshot("campaign-career-reject"),
            Err(CampaignStoreError::InvalidData)
        ));
    }

    fn generation_command(
        campaign_id: &str,
        expected_revision: i64,
        mode: &str,
        output: Value,
    ) -> CareerPoolGenerationCommit {
        generation_command_with_suffix(campaign_id, expected_revision, mode, output, "default")
    }

    fn generation_command_with_suffix(
        campaign_id: &str,
        expected_revision: i64,
        mode: &str,
        output: Value,
        suffix: &str,
    ) -> CareerPoolGenerationCommit {
        let existing = if expected_revision == 0 {
            Vec::new()
        } else {
            initial_output()["careers"]
                .as_array()
                .expect("careers")
                .clone()
        };
        let requested_rarities = output["careers"]
            .as_array()
            .expect("careers")
            .iter()
            .map(|career| career["rarity"].clone())
            .collect::<Vec<_>>();
        let input = json!({
            "schemaVersion": 1,
            "context": {
                "worldId": campaign_id,
                "constitutionRevision": 1,
                "contextSummary": constitution_value().to_string(),
            },
            "generationMode": mode,
            "requestedCount": requested_rarities.len(),
            "requestedRarities": requested_rarities,
            "existingCareerIds": existing.iter().map(|career| career["id"].clone()).collect::<Vec<_>>(),
            "existingCareerNames": existing.iter().map(|career| career["name"].clone()).collect::<Vec<_>>(),
        });
        let idempotency_suffix = if suffix == "default" {
            format!("{mode}:{expected_revision}")
        } else {
            suffix.to_owned()
        };
        CareerPoolGenerationCommit {
            campaign_id: campaign_id.to_owned(),
            expected_revision,
            generation: CharacterGenerationAudit {
                request_id: format!("request-career-{idempotency_suffix}"),
                generation_record_id: format!("generation-career-{idempotency_suffix}"),
                idempotency_key: format!("career:{idempotency_suffix}"),
                prompt_version: 1,
                input,
                context: json!({
                    "campaignId": campaign_id,
                    "constitutionRevision": 1,
                    "expectedPoolRevision": expected_revision,
                }),
                request: json!({"task": "GENERATE_CAREER_POOL", "modelName": "fake"}),
                raw_response_text: output.to_string(),
                validated_output: output,
            },
        }
    }

    fn initial_output() -> Value {
        json!({
            "schemaVersion": 1,
            "careers": [
                candidate("career-harbor-runner", "Harbor Runner", "COMMON", "ROGUE"),
                candidate("career-shoal-pilot", "Shoal Pilot", "UNCOMMON", "SCHOLAR"),
                candidate("career-storm-reader", "Storm Reader", "RARE", "SCHOLAR"),
                candidate("career-council-envoy", "Council Envoy", "SPECIAL", "DIPLOMAT"),
            ]
        })
    }

    fn candidate(id: &str, name: &str, rarity: &str, archetype: &str) -> Value {
        json!({
            "id": id,
            "name": name,
            "rarity": rarity,
            "role": "Keeps a necessary harbor route operating.",
            "skills": ["Navigation"],
            "equipmentTags": ["Charts"],
            "socialPosition": "Licensed guild worker",
            "relationshipHooks": ["Answers to the harbor master"],
            "risks": ["Accused when a ship is lost"],
            "requirements": ["Guild sponsorship"],
            "constitutionEvidence": {
                "careerRules": "Careers arise from local guilds.",
                "society": "Harbor guilds connect isolated settlements.",
                "technology": "Late medieval",
                "economy": "Fishing, coastal trade, and beacon tolls."
            },
            "legacyArchetype": archetype
        })
    }

    fn constitution_value() -> Value {
        json!({
            "schemaVersion": 1,
            "worldType": "Low heroic fantasy",
            "era": "Late medieval sail age",
            "technology": "Late medieval",
            "magic": "Magic always leaves a warm trace.",
            "peoples": ["Coastal humans"],
            "society": "Harbor guilds connect isolated settlements.",
            "politics": "Local councils negotiate with navigation guilds.",
            "economy": "Fishing, coastal trade, and beacon tolls.",
            "combatScale": "Personal conflict.",
            "deathRules": "Death is permanent.",
            "careerRules": "Careers arise from local guilds.",
            "equipmentRules": "Equipment follows grounded craft.",
            "npcRules": "NPC motives follow bounded knowledge.",
            "traitRules": "Traits require local validation.",
            "taboos": []
        })
    }

    fn seed_world(store: &CampaignStore, campaign_id: &str) {
        store
            .create_at(
                campaign_id.to_owned(),
                "2026-08-20T02:00:00.000Z".to_owned(),
            )
            .expect("create campaign");
        let connection = store.connect().expect("connection");
        connection
            .execute(
                "INSERT INTO world_constitutions (
                   campaign_id, schema_version, revision, status, world_type, era, technology,
                   magic, peoples_json, society, politics, economy, combat_scale, death_rules,
                   career_rules, equipment_rules, npc_rules, trait_rules, taboos_json,
                   created_at, updated_at, locked_at
                 ) VALUES (?1, 1, 1, 'LOCKED', 'Low heroic fantasy', 'Late medieval sail age',
                   'Late medieval', 'Magic always leaves a warm trace.', '[\"Coastal humans\"]',
                   'Harbor guilds connect isolated settlements.',
                   'Local councils negotiate with navigation guilds.',
                   'Fishing, coastal trade, and beacon tolls.', 'Personal conflict.',
                   'Death is permanent.', 'Careers arise from local guilds.',
                   'Equipment follows grounded craft.', 'NPC motives follow bounded knowledge.',
                   'Traits require local validation.', '[]', ?2, ?2, ?2)",
                params![campaign_id, "2026-08-20T02:00:00.000Z"],
            )
            .expect("constitution");
        connection
            .execute(
                "UPDATE campaigns SET state = 'CREATING_CHARACTER' WHERE id = ?1",
                [campaign_id],
            )
            .expect("advance campaign");
    }
}

use std::collections::BTreeSet;

use ember_combat_core::{CombatState, WorldCombatProfileId};
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use thiserror::Error;
use uuid::Uuid;

use crate::{CampaignStore, CombatPersistenceError, RestoredCombatCheckpoint};

const ORIGIN_SCHEMA_VERSION: u32 = 1;

/// Immutable authoring provenance carried by the first BattleRecord event.
/// It is not a second event ledger: the same BattleRecord and COMBAT_STARTED
/// transaction remain the durable sources for combat history.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AuthoredEncounterOrigin {
    pub schema_version: u32,
    pub operation_id: String,
    pub rule_id: String,
    pub rule_version: u32,
    pub definition_id: String,
    pub definition_version: u32,
    pub world_profile_id: WorldCombatProfileId,
    pub player_character_id: String,
    pub roster_combatant_ids: Vec<String>,
    pub objective_ids: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum AuthoredEncounterEvent {
    EncounterStarted {
        sequence: u64,
        origin: AuthoredEncounterOrigin,
    },
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum AuthoredEncounterError {
    #[error("authored encounter origin is invalid")]
    InvalidOrigin,
    #[error("authored encounter origin does not match the initial state")]
    InitialStateMismatch,
}

impl AuthoredEncounterOrigin {
    pub fn combat_instance_id(&self, campaign_id: &str) -> Result<String, AuthoredEncounterError> {
        self.validate()?;
        valid_stable_id(campaign_id)?;
        let mut digest = Sha256::new();
        digest.update(b"ember-authored-encounter-v1");
        digest.update((campaign_id.len() as u64).to_be_bytes());
        digest.update(campaign_id.as_bytes());
        digest.update((self.operation_id.len() as u64).to_be_bytes());
        digest.update(self.operation_id.as_bytes());
        Ok(format!("combat:encounter:{:x}", digest.finalize()))
    }

    pub fn validate_initial_state(
        &self,
        campaign_id: &str,
        state: &CombatState,
    ) -> Result<(), AuthoredEncounterError> {
        if state.combat_instance_id != self.combat_instance_id(campaign_id)?
            || !state
                .formal_party_member_ids
                .contains(&self.player_character_id)
        {
            return Err(AuthoredEncounterError::InitialStateMismatch);
        }
        let roster = state
            .combatants
            .iter()
            .map(|combatant| combatant.combatant_id.as_str())
            .collect::<BTreeSet<_>>();
        let expected_roster = self
            .roster_combatant_ids
            .iter()
            .map(String::as_str)
            .collect::<BTreeSet<_>>();
        let objectives = state
            .objectives
            .objectives
            .iter()
            .map(|objective| objective.objective_id.as_str())
            .collect::<BTreeSet<_>>();
        let expected_objectives = self
            .objective_ids
            .iter()
            .map(String::as_str)
            .collect::<BTreeSet<_>>();
        if roster != expected_roster || objectives != expected_objectives {
            return Err(AuthoredEncounterError::InitialStateMismatch);
        }
        Ok(())
    }

    fn validate(&self) -> Result<(), AuthoredEncounterError> {
        if self.schema_version != ORIGIN_SCHEMA_VERSION
            || self.rule_version == 0
            || self.definition_version == 0
            || Uuid::parse_str(&self.operation_id)
                .ok()
                .is_none_or(|id| id.to_string() != self.operation_id)
            || self.roster_combatant_ids.is_empty()
            || self.objective_ids.is_empty()
        {
            return Err(AuthoredEncounterError::InvalidOrigin);
        }
        for id in [
            self.rule_id.as_str(),
            self.definition_id.as_str(),
            self.player_character_id.as_str(),
        ] {
            valid_stable_id(id)?;
        }
        unique_ids(&self.roster_combatant_ids)?;
        unique_ids(&self.objective_ids)?;
        if !self
            .roster_combatant_ids
            .contains(&self.player_character_id)
        {
            return Err(AuthoredEncounterError::InvalidOrigin);
        }
        Ok(())
    }
}

impl AuthoredEncounterEvent {
    pub fn from_first_event(
        value: &Value,
    ) -> Result<AuthoredEncounterOrigin, AuthoredEncounterError> {
        match serde_json::from_value::<Self>(value.clone()) {
            Ok(Self::EncounterStarted {
                sequence: 1,
                origin,
            }) => {
                origin.validate()?;
                Ok(origin)
            }
            _ => Err(AuthoredEncounterError::InvalidOrigin),
        }
    }
}

impl CampaignStore {
    /// An authored battle can only be resumed when the immutable first event,
    /// resolved InitialState and canonical start fact agree. Legacy demo
    /// checkpoints intentionally fail this production provenance gate.
    pub fn restore_authored_encounter_checkpoint(
        &self,
        campaign_id: &str,
        combat_instance_id: &str,
    ) -> Result<(RestoredCombatCheckpoint, AuthoredEncounterOrigin), CombatPersistenceError> {
        let restored = self.restore_combat_checkpoint(combat_instance_id)?;
        if restored.campaign_id != campaign_id {
            return Err(CombatPersistenceError::InvalidCheckpoint);
        }
        if restored
            .events
            .iter()
            .skip(1)
            .any(|value| value.get("kind").and_then(Value::as_str) == Some("ENCOUNTER_STARTED"))
        {
            return Err(CombatPersistenceError::InvalidCheckpoint);
        }
        let origin = restored
            .events
            .first()
            .ok_or(CombatPersistenceError::InvalidCheckpoint)
            .and_then(|value| {
                AuthoredEncounterEvent::from_first_event(value)
                    .map_err(|_| CombatPersistenceError::InvalidCheckpoint)
            })?;
        origin
            .validate_initial_state(campaign_id, &restored.initial_state)
            .map_err(|_| CombatPersistenceError::InvalidCheckpoint)?;
        let payload: Option<String> = self
            .connect()
            .map_err(CombatPersistenceError::Store)?
            .query_row(
                "SELECT payload_json FROM event_ledger
                 WHERE campaign_id=?1 AND aggregate_type='COMBAT' AND aggregate_id=?2
                   AND revision=1 AND event_type='COMBAT_STARTED'",
                [campaign_id, combat_instance_id],
                |row| row.get(0),
            )
            .optional()?;
        let payload: Value =
            serde_json::from_str(&payload.ok_or(CombatPersistenceError::InvalidCheckpoint)?)?;
        if payload.get("encounterOrigin") != Some(&serde_json::to_value(&origin)?)
            || payload.get("combatInstanceId").and_then(Value::as_str) != Some(combat_instance_id)
            || payload.get("initialStateHash").and_then(Value::as_str)
                != Some(restored.initial_state.state_hash_sha256()?.as_str())
        {
            return Err(CombatPersistenceError::InvalidCheckpoint);
        }
        Ok((restored, origin))
    }
}

fn unique_ids(values: &[String]) -> Result<(), AuthoredEncounterError> {
    let mut seen = BTreeSet::new();
    for value in values {
        valid_stable_id(value)?;
        if !seen.insert(value) {
            return Err(AuthoredEncounterError::InvalidOrigin);
        }
    }
    Ok(())
}

fn valid_stable_id(value: &str) -> Result<(), AuthoredEncounterError> {
    if value.is_empty()
        || value.len() > 128
        || !value.starts_with(|character: char| character.is_ascii_alphanumeric())
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b':' | b'.' | b'_' | b'-'))
    {
        return Err(AuthoredEncounterError::InvalidOrigin);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn origin() -> AuthoredEncounterOrigin {
        AuthoredEncounterOrigin {
            schema_version: 1,
            operation_id: "9a4bd1a5-cc5d-488d-b786-23a60d7be82a".to_owned(),
            rule_id: "tavern.sparring".to_owned(),
            rule_version: 1,
            definition_id: "encounter.sparring.fantasy".to_owned(),
            definition_version: 1,
            world_profile_id: WorldCombatProfileId::Fantasy,
            player_character_id: "player-1".to_owned(),
            roster_combatant_ids: vec!["player-1".to_owned(), "npc-1".to_owned()],
            objective_ids: vec!["objective.defeat-npc".to_owned()],
        }
    }

    #[test]
    fn operation_identity_is_stable_and_campaign_scoped() {
        let value = origin();
        let first = value.combat_instance_id("campaign-1").unwrap();
        assert_eq!(first, value.combat_instance_id("campaign-1").unwrap());
        assert_ne!(first, value.combat_instance_id("campaign-2").unwrap());
        let mut retry = value.clone();
        retry.operation_id = "56421170-746f-4b15-82f9-c50e030a46b4".to_owned();
        assert_ne!(first, retry.combat_instance_id("campaign-1").unwrap());
    }

    #[test]
    fn origin_rejects_missing_or_ambiguous_authorship() {
        let mut value = origin();
        value.objective_ids.clear();
        assert_eq!(
            value.combat_instance_id("campaign-1"),
            Err(AuthoredEncounterError::InvalidOrigin)
        );
        value = origin();
        value.roster_combatant_ids.push("npc-1".to_owned());
        assert_eq!(
            value.combat_instance_id("campaign-1"),
            Err(AuthoredEncounterError::InvalidOrigin)
        );
        value = origin();
        value.operation_id = "random prose".to_owned();
        assert_eq!(
            value.combat_instance_id("campaign-1"),
            Err(AuthoredEncounterError::InvalidOrigin)
        );
    }

    #[test]
    fn only_the_first_explicit_event_is_a_valid_origin() {
        let event = AuthoredEncounterEvent::EncounterStarted {
            sequence: 1,
            origin: origin(),
        };
        let value = serde_json::to_value(event).unwrap();
        assert_eq!(
            AuthoredEncounterEvent::from_first_event(&value).unwrap(),
            origin()
        );
        assert!(
            AuthoredEncounterEvent::from_first_event(&serde_json::json!({
                "kind": "ENCOUNTER_STARTED", "sequence": 2, "origin": origin()
            }))
            .is_err()
        );
    }
}

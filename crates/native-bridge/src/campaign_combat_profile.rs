use ember_combat_core::WorldCombatProfileId;
use rusqlite::{OptionalExtension, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{CampaignStore, CampaignStoreError, current_timestamp, validate_id};

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CampaignCombatProfileSelection {
    pub campaign_id: String,
    pub operation_id: String,
    pub profile_id: WorldCombatProfileId,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CampaignCombatProfileBinding {
    pub campaign_id: String,
    pub schema_version: u32,
    pub world_constitution_revision: u64,
    pub profile_id: WorldCombatProfileId,
    pub selection_operation_id: String,
    pub selected_at: String,
}

impl CampaignStore {
    /// Explicitly binds a locked freeform world to one of the four versioned
    /// Combat profiles. Narrative `world_type` text never selects mechanics.
    pub fn select_campaign_combat_profile(
        &self,
        selection: CampaignCombatProfileSelection,
    ) -> Result<CampaignCombatProfileBinding, CampaignStoreError> {
        validate_id(&selection.campaign_id)?;
        if Uuid::parse_str(&selection.operation_id)
            .ok()
            .is_none_or(|id| id.to_string() != selection.operation_id)
        {
            return Err(CampaignStoreError::InvalidData);
        }
        let mut connection = self.connect()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        if let Some(existing) = load_binding(&transaction, &selection.campaign_id)? {
            if existing.selection_operation_id == selection.operation_id
                && existing.profile_id == selection.profile_id
            {
                transaction.commit()?;
                return Ok(existing);
            }
            return Err(CampaignStoreError::InvalidState);
        }
        let campaign_state: String = transaction
            .query_row(
                "SELECT state FROM campaigns WHERE id=?1",
                [&selection.campaign_id],
                |row| row.get(0),
            )
            .optional()?
            .ok_or(CampaignStoreError::NotFound)?;
        if campaign_state != "TAVERN" {
            return Err(CampaignStoreError::InvalidState);
        }
        let constitution_revision: i64 = transaction
            .query_row(
                "SELECT revision FROM world_constitutions
                 WHERE campaign_id=?1 AND status='LOCKED'",
                [&selection.campaign_id],
                |row| row.get(0),
            )
            .optional()?
            .ok_or(CampaignStoreError::InvalidState)?;
        let player_count: i64 = transaction.query_row(
            "SELECT COUNT(*) FROM player_characters WHERE campaign_id=?1",
            [&selection.campaign_id],
            |row| row.get(0),
        )?;
        if player_count != 1 {
            return Err(CampaignStoreError::InvalidState);
        }
        let at = current_timestamp()?;
        transaction.execute(
            "INSERT INTO campaign_combat_profiles (
               campaign_id,schema_version,world_constitution_revision,profile_id,
               selection_operation_id,selected_at
             ) VALUES (?1,1,?2,?3,?4,?5)",
            params![
                selection.campaign_id,
                constitution_revision,
                profile_name(selection.profile_id),
                selection.operation_id,
                at,
            ],
        )?;
        let binding = load_binding(&transaction, &selection.campaign_id)?
            .ok_or(CampaignStoreError::InvalidData)?;
        transaction.commit()?;
        Ok(binding)
    }

    pub fn campaign_combat_profile(
        &self,
        campaign_id: &str,
    ) -> Result<Option<CampaignCombatProfileBinding>, CampaignStoreError> {
        validate_id(campaign_id)?;
        let connection = self.connect()?;
        load_binding(&connection, campaign_id)
    }
}

fn load_binding(
    connection: &rusqlite::Connection,
    campaign_id: &str,
) -> Result<Option<CampaignCombatProfileBinding>, CampaignStoreError> {
    let row = connection
        .query_row(
            "SELECT schema_version,world_constitution_revision,profile_id,
                    selection_operation_id,selected_at
             FROM campaign_combat_profiles WHERE campaign_id=?1",
            [campaign_id],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                ))
            },
        )
        .optional()?;
    row.map(|(version, revision, profile, operation, at)| {
        if version != 1 || revision < 1 {
            return Err(CampaignStoreError::InvalidData);
        }
        Ok(CampaignCombatProfileBinding {
            campaign_id: campaign_id.to_owned(),
            schema_version: 1,
            world_constitution_revision: u64::try_from(revision)
                .map_err(|_| CampaignStoreError::InvalidData)?,
            profile_id: parse_profile(&profile)?,
            selection_operation_id: operation,
            selected_at: at,
        })
    })
    .transpose()
}

const fn profile_name(profile: WorldCombatProfileId) -> &'static str {
    match profile {
        WorldCombatProfileId::Fantasy => "FANTASY",
        WorldCombatProfileId::SciFi => "SCI_FI",
        WorldCombatProfileId::Cultivation => "CULTIVATION",
        WorldCombatProfileId::Urban => "URBAN",
    }
}

fn parse_profile(value: &str) -> Result<WorldCombatProfileId, CampaignStoreError> {
    match value {
        "FANTASY" => Ok(WorldCombatProfileId::Fantasy),
        "SCI_FI" => Ok(WorldCombatProfileId::SciFi),
        "CULTIVATION" => Ok(WorldCombatProfileId::Cultivation),
        "URBAN" => Ok(WorldCombatProfileId::Urban),
        _ => Err(CampaignStoreError::InvalidData),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const OPERATION: &str = "8569becf-7ced-4d32-901d-b3d2cb13ca25";
    const AT: &str = "2026-10-06T10:00:00.000Z";

    #[test]
    fn explicit_profile_binding_is_durable_idempotent_and_not_inferred_from_prose() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("profile.sqlite");
        let store = CampaignStore::open(&path).unwrap();
        let campaign = store.create_campaign().unwrap();
        seed_locked_world_and_player(&store, &campaign.id);
        assert_eq!(store.campaign_combat_profile(&campaign.id).unwrap(), None);
        let selection = CampaignCombatProfileSelection {
            campaign_id: campaign.id.clone(),
            operation_id: OPERATION.to_owned(),
            profile_id: WorldCombatProfileId::Urban,
        };
        let bound = store
            .select_campaign_combat_profile(selection.clone())
            .unwrap();
        assert_eq!(bound.profile_id, WorldCombatProfileId::Urban);
        assert_eq!(bound.world_constitution_revision, 1);
        assert_eq!(
            store.select_campaign_combat_profile(selection).unwrap(),
            bound
        );
        assert!(matches!(
            store.select_campaign_combat_profile(CampaignCombatProfileSelection {
                campaign_id: campaign.id.clone(),
                operation_id: "158264bd-1c2a-4b31-b55f-172281e254ba".to_owned(),
                profile_id: WorldCombatProfileId::Fantasy,
            }),
            Err(CampaignStoreError::InvalidState)
        ));
        assert!(
            store
                .connect()
                .unwrap()
                .execute(
                    "UPDATE campaign_combat_profiles SET profile_id='FANTASY' WHERE campaign_id=?1",
                    [&campaign.id],
                )
                .is_err()
        );
        drop(store);
        let reopened = CampaignStore::open(path).unwrap();
        assert_eq!(
            reopened.campaign_combat_profile(&campaign.id).unwrap(),
            Some(bound)
        );
    }

    #[test]
    fn selection_rejects_unlocked_world_missing_character_and_invalid_operation() {
        let directory = tempfile::tempdir().unwrap();
        let store = CampaignStore::open(directory.path().join("profile.sqlite")).unwrap();
        let campaign = store.create_campaign().unwrap();
        let selection = CampaignCombatProfileSelection {
            campaign_id: campaign.id.clone(),
            operation_id: OPERATION.to_owned(),
            profile_id: WorldCombatProfileId::Fantasy,
        };
        assert!(matches!(
            store.select_campaign_combat_profile(selection.clone()),
            Err(CampaignStoreError::InvalidState)
        ));
        seed_locked_world(&store, &campaign.id);
        assert!(matches!(
            store.select_campaign_combat_profile(selection.clone()),
            Err(CampaignStoreError::InvalidState)
        ));
        seed_player(&store, &campaign.id);
        let mut invalid = selection.clone();
        invalid.operation_id = "free text".to_owned();
        assert!(matches!(
            store.select_campaign_combat_profile(invalid),
            Err(CampaignStoreError::InvalidData)
        ));
        assert!(
            store
                .campaign_combat_profile(&campaign.id)
                .unwrap()
                .is_none()
        );
        assert_eq!(
            store
                .select_campaign_combat_profile(selection)
                .unwrap()
                .profile_id,
            WorldCombatProfileId::Fantasy
        );
    }

    fn seed_locked_world_and_player(store: &CampaignStore, campaign_id: &str) {
        seed_locked_world(store, campaign_id);
        seed_player(store, campaign_id);
    }

    fn seed_locked_world(store: &CampaignStore, campaign_id: &str) {
        let connection = store.connect().unwrap();
        connection
            .execute(
                "UPDATE campaigns SET state='TAVERN' WHERE id=?1",
                [campaign_id],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO world_constitutions (
                   campaign_id,schema_version,revision,status,world_type,era,technology,magic,
                   peoples_json,society,politics,economy,combat_scale,death_rules,career_rules,
                   equipment_rules,npc_rules,trait_rules,taboos_json,created_at,updated_at,locked_at
                 ) VALUES (?1,1,1,'LOCKED','混合怪谈世界','当代','低','不定','[]','社群','议会',
                   '贸易','中等','普通','开放','普通','普通','普通','[]',?2,?2,?2)",
                params![campaign_id, AT],
            )
            .unwrap();
    }

    fn seed_player(store: &CampaignStore, campaign_id: &str) {
        store
            .connect()
            .unwrap()
            .execute(
                "INSERT INTO player_characters (
                   id,campaign_id,name,concept,class_archetype,class_display_name,
                   attributes_json,traits_json,personal_goal,background_json,
                   story_preferences_json,content_boundaries_json,created_at,updated_at
                 ) VALUES (?1,?2,'旅人','旅人','WARRIOR','战士',
                   '{\"physique\":3,\"agility\":3,\"knowledge\":2,\"charisma\":2}',
                   '[]','旅行','{}','[]','[]',?3,?3)",
                params![format!("player-{campaign_id}"), campaign_id, AT],
            )
            .unwrap();
    }
}

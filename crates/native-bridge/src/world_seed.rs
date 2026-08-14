use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};

use super::{
    CampaignStore, CampaignStoreError, current_timestamp, validate_id, validate_timestamp,
};

const ALGORITHM: &str = "EMBER_STREAM_V1";
const MAX_POSITION: i64 = 9_007_199_254_740_991;
const MAX_RESERVATION: i64 = 4_096;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorldSeedSnapshot {
    pub campaign_id: String,
    pub schema_version: i64,
    pub algorithm: String,
    pub seed: String,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorldRandomReservation {
    pub campaign_id: String,
    pub algorithm: String,
    pub seed: String,
    pub stream_id: String,
    pub start_position: i64,
    pub count: i64,
}

impl CampaignStore {
    pub fn world_seed(&self, campaign_id: &str) -> Result<WorldSeedSnapshot, CampaignStoreError> {
        validate_id(campaign_id)?;
        let connection = self.connect()?;
        load_seed(&connection, campaign_id)?.ok_or(CampaignStoreError::NotFound)
    }

    pub fn reserve_world_random(
        &self,
        campaign_id: &str,
        stream_id: &str,
        count: i64,
    ) -> Result<WorldRandomReservation, CampaignStoreError> {
        self.reserve_world_random_at(campaign_id, stream_id, count, &current_timestamp()?)
    }

    fn reserve_world_random_at(
        &self,
        campaign_id: &str,
        stream_id: &str,
        count: i64,
        at: &str,
    ) -> Result<WorldRandomReservation, CampaignStoreError> {
        validate_id(campaign_id)?;
        validate_stream_id(stream_id)?;
        validate_timestamp(at)?;
        if !(1..=MAX_RESERVATION).contains(&count) {
            return Err(CampaignStoreError::InvalidData);
        }
        let connection = self.connect()?;
        let seed = load_seed(&connection, campaign_id)?.ok_or(CampaignStoreError::NotFound)?;
        let end_position = connection
            .query_row(
                "INSERT INTO world_random_streams (
                   campaign_id, stream_id, position, created_at, updated_at
                 ) VALUES (?1, ?2, ?3, ?4, ?4)
                 ON CONFLICT(campaign_id, stream_id) DO UPDATE SET
                   position = world_random_streams.position + excluded.position,
                   updated_at = excluded.updated_at
                 WHERE world_random_streams.position <= ?5
                 RETURNING position",
                params![campaign_id, stream_id, count, at, MAX_POSITION - count],
                |row| row.get::<_, i64>(0),
            )
            .optional()?
            .ok_or(CampaignStoreError::InvalidData)?;
        Ok(WorldRandomReservation {
            campaign_id: campaign_id.to_owned(),
            algorithm: seed.algorithm,
            seed: seed.seed,
            stream_id: stream_id.to_owned(),
            start_position: end_position - count,
            count,
        })
    }
}

pub fn deterministic_world_u32(
    algorithm: &str,
    seed: &str,
    stream_id: &str,
    position: i64,
) -> Result<u32, CampaignStoreError> {
    if algorithm != ALGORITHM || !valid_seed(seed) || !(0..=MAX_POSITION).contains(&position) {
        return Err(CampaignStoreError::InvalidData);
    }
    validate_stream_id(stream_id)?;
    let input = format!("{seed}:{stream_id}:{position}");
    let mut hash = 0x811c_9dc5_u32;
    for byte in input.bytes() {
        hash = (hash ^ u32::from(byte)).wrapping_mul(0x0100_0193);
    }
    hash ^= hash >> 16;
    hash = hash.wrapping_mul(0x7feb_352d);
    hash ^= hash >> 15;
    hash = hash.wrapping_mul(0x846c_a68b);
    hash ^= hash >> 16;
    Ok(hash)
}

fn load_seed(
    connection: &rusqlite::Connection,
    campaign_id: &str,
) -> Result<Option<WorldSeedSnapshot>, CampaignStoreError> {
    let result = connection
        .query_row(
            "SELECT campaign_id, schema_version, algorithm, seed, created_at
             FROM world_seeds WHERE campaign_id = ?1",
            [campaign_id],
            |row| {
                Ok(WorldSeedSnapshot {
                    campaign_id: row.get(0)?,
                    schema_version: row.get(1)?,
                    algorithm: row.get(2)?,
                    seed: row.get(3)?,
                    created_at: row.get(4)?,
                })
            },
        )
        .optional()?;
    if let Some(seed) = &result {
        if seed.campaign_id != campaign_id
            || seed.schema_version != 1
            || seed.algorithm != ALGORITHM
            || !valid_seed(&seed.seed)
        {
            return Err(CampaignStoreError::InvalidData);
        }
        validate_timestamp(&seed.created_at)?;
    }
    Ok(result)
}

fn valid_seed(seed: &str) -> bool {
    seed.len() == 32
        && seed
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn validate_stream_id(value: &str) -> Result<(), CampaignStoreError> {
    let valid_shape = !value.is_empty()
        && value.len() <= 64
        && value.as_bytes()[0].is_ascii_lowercase()
        && value.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || b"._-".contains(&byte)
        });
    let reserved = ["d20", "dice"].iter().any(|prefix| {
        value == *prefix
            || value
                .strip_prefix(prefix)
                .is_some_and(|rest| rest.starts_with(['.', '_', '-']))
    });
    if !valid_shape || reserved {
        return Err(CampaignStoreError::InvalidData);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seed_and_independent_stream_cursors_survive_reopen() {
        let directory = tempfile::tempdir().expect("temp directory");
        let path = directory.path().join("seed.sqlite");
        let store = CampaignStore::open(&path).expect("open");
        store
            .create_at(
                "campaign-seed".to_owned(),
                "2026-08-14T02:00:00.000Z".to_owned(),
            )
            .expect("create");
        let seed = store.world_seed("campaign-seed").expect("seed");
        let map = store
            .reserve_world_random_at("campaign-seed", "map.layout", 3, "2026-08-14T02:01:00.000Z")
            .expect("map reservation");
        let event = store
            .reserve_world_random_at(
                "campaign-seed",
                "event.sample",
                2,
                "2026-08-14T02:01:00.000Z",
            )
            .expect("event reservation");
        assert_eq!(map.start_position, 0);
        assert_eq!(event.start_position, 0);
        drop(store);

        let reopened = CampaignStore::open(&path).expect("reopen");
        assert_eq!(reopened.world_seed("campaign-seed").expect("seed"), seed);
        assert_eq!(
            reopened
                .reserve_world_random_at(
                    "campaign-seed",
                    "map.layout",
                    1,
                    "2026-08-14T02:02:00.000Z",
                )
                .expect("continued")
                .start_position,
            3
        );
    }

    #[test]
    fn deterministic_vector_matches_the_typescript_contract_and_excludes_dice_streams() {
        assert_eq!(
            deterministic_world_u32(
                ALGORITHM,
                "00112233445566778899aabbccddeeff",
                "map.layout",
                0,
            )
            .expect("vector"),
            177_449_918
        );
        assert!(
            deterministic_world_u32(ALGORITHM, "00112233445566778899aabbccddeeff", "d20", 0,)
                .is_err()
        );
    }
}

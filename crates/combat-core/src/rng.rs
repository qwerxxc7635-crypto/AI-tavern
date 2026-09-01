use std::{error::Error, fmt};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::{CURRENT_COMBAT_VERSIONS, CombatVersion};

const DERIVATION_DOMAIN: &[u8] = b"EMBER_COMBAT_RNG_CHANNEL_V1";
const SPLITMIX64_GAMMA: u64 = 0x9e37_79b9_7f4a_7c15;
const MAX_CURSOR: u64 = 9_007_199_254_740_991;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum RngChannel {
    #[serde(rename = "initiative")]
    Initiative,
    #[serde(rename = "resolution")]
    Resolution,
    #[serde(rename = "utilityTieBreak")]
    UtilityTieBreak,
}

impl RngChannel {
    pub const ALL: [Self; 3] = [Self::Initiative, Self::Resolution, Self::UtilityTieBreak];

    #[must_use]
    pub const fn id(self) -> &'static str {
        match self {
            Self::Initiative => "initiative",
            Self::Resolution => "resolution",
            Self::UtilityTieBreak => "utilityTieBreak",
        }
    }

    const fn index(self) -> usize {
        match self {
            Self::Initiative => 0,
            Self::Resolution => 1,
            Self::UtilityTieBreak => 2,
        }
    }
}

pub const COMBAT_RNG_CHANNELS: [RngChannel; 3] = RngChannel::ALL;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RngStreamSnapshot {
    pub channel_id: RngChannel,
    /// Lowercase, fixed-width hexadecimal SplitMix64 state. A string avoids
    /// precision loss when the snapshot crosses a JavaScript JSON boundary.
    pub state_hex: String,
    /// Safe-integer bound is enforced by snapshot/restore.
    pub cursor: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CombatRngSnapshot {
    pub rng_contract_version: CombatVersion,
    /// Always serialized in [`COMBAT_RNG_CHANNELS`] order.
    pub streams: [RngStreamSnapshot; 3],
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct RngStream {
    state: u64,
    cursor: u64,
}

impl RngStream {
    fn next_u64(&mut self) -> Result<u64, CombatRngError> {
        if self.cursor >= MAX_CURSOR {
            return Err(CombatRngError::CursorExhausted);
        }
        self.state = self.state.wrapping_add(SPLITMIX64_GAMMA);
        self.cursor += 1;
        let mut value = self.state;
        value = (value ^ (value >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
        value = (value ^ (value >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
        Ok(value ^ (value >> 31))
    }

    fn draw_bounded(&mut self, upper_exclusive: u32) -> Result<u32, CombatRngError> {
        if upper_exclusive == 0 {
            return Err(CombatRngError::InvalidRange);
        }
        let bound = u64::from(upper_exclusive);
        let threshold = bound.wrapping_neg() % bound;
        loop {
            let value = self.next_u64()?;
            if value >= threshold {
                return Ok((value % bound) as u32);
            }
        }
    }

    fn snapshot(self, channel_id: RngChannel) -> RngStreamSnapshot {
        RngStreamSnapshot {
            channel_id,
            state_hex: format!("{:016x}", self.state),
            cursor: self.cursor,
        }
    }
}

/// The only mutable rules RNG state. Cloning is intentionally private to Core
/// implementation; read-only consumers receive snapshots and cannot advance it.
#[derive(Debug, PartialEq, Eq)]
pub struct CombatRng {
    rng_contract_version: CombatVersion,
    streams: [RngStream; 3],
}

impl CombatRng {
    pub fn new(
        random_seed: &str,
        combat_instance_id: &str,
        rng_contract_version: CombatVersion,
    ) -> Result<Self, CombatRngError> {
        ensure_supported_contract(rng_contract_version)?;
        validate_seed(random_seed)?;
        validate_combat_instance_id(combat_instance_id)?;
        let streams = RngChannel::ALL.map(|channel| RngStream {
            state: derive_stream_state(
                random_seed,
                combat_instance_id,
                rng_contract_version,
                channel,
            ),
            cursor: 0,
        });
        Ok(Self {
            rng_contract_version,
            streams,
        })
    }

    /// Restores the exact saved state/cursor. Stream order, IDs, version and
    /// JavaScript-safe cursor range are all part of the persisted contract.
    pub fn restore(snapshot: CombatRngSnapshot) -> Result<Self, CombatRngError> {
        ensure_supported_contract(snapshot.rng_contract_version)?;
        let mut streams = [RngStream {
            state: 0,
            cursor: 0,
        }; 3];
        for (index, saved) in snapshot.streams.into_iter().enumerate() {
            let expected_channel = RngChannel::ALL[index];
            if saved.channel_id != expected_channel || saved.cursor > MAX_CURSOR {
                return Err(CombatRngError::InvalidSnapshot);
            }
            streams[index] = RngStream {
                state: parse_state_hex(&saved.state_hex)?,
                cursor: saved.cursor,
            };
        }
        Ok(Self {
            rng_contract_version: snapshot.rng_contract_version,
            streams,
        })
    }

    #[must_use]
    pub fn snapshot(&self) -> CombatRngSnapshot {
        CombatRngSnapshot {
            rng_contract_version: self.rng_contract_version,
            streams: RngChannel::ALL.map(|channel| self.streams[channel.index()].snapshot(channel)),
        }
    }

    /// Draws one unbiased value in `0..upper_exclusive` from the explicitly
    /// selected rules channel.
    pub fn draw_bounded(
        &mut self,
        channel: RngChannel,
        upper_exclusive: u32,
    ) -> Result<u32, CombatRngError> {
        self.streams[channel.index()].draw_bounded(upper_exclusive)
    }

    /// Draws a conventional die in `1..=sides` from the explicitly selected
    /// rules channel.
    pub fn roll_die(&mut self, channel: RngChannel, sides: u32) -> Result<u32, CombatRngError> {
        self.draw_bounded(channel, sides).map(|value| value + 1)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CombatRngError {
    InvalidSeed,
    InvalidCombatInstanceId,
    UnsupportedContract {
        expected: CombatVersion,
        actual: CombatVersion,
    },
    InvalidRange,
    InvalidSnapshot,
    CursorExhausted,
}

impl fmt::Display for CombatRngError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidSeed => formatter.write_str("combat random seed is invalid"),
            Self::InvalidCombatInstanceId => formatter.write_str("combat instance id is invalid"),
            Self::UnsupportedContract { expected, actual } => write!(
                formatter,
                "unsupported rngContractVersion: expected {}, received {}",
                expected.get(),
                actual.get(),
            ),
            Self::InvalidRange => formatter.write_str("combat RNG range is invalid"),
            Self::InvalidSnapshot => formatter.write_str("combat RNG snapshot is invalid"),
            Self::CursorExhausted => formatter.write_str("combat RNG cursor is exhausted"),
        }
    }
}

impl Error for CombatRngError {}

fn ensure_supported_contract(version: CombatVersion) -> Result<(), CombatRngError> {
    let expected = CURRENT_COMBAT_VERSIONS.rng_contract_version;
    if version == expected {
        Ok(())
    } else {
        Err(CombatRngError::UnsupportedContract {
            expected,
            actual: version,
        })
    }
}

fn validate_seed(seed: &str) -> Result<(), CombatRngError> {
    if seed.len() == 32
        && seed
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        Ok(())
    } else {
        Err(CombatRngError::InvalidSeed)
    }
}

fn validate_combat_instance_id(value: &str) -> Result<(), CombatRngError> {
    if !value.is_empty() && value.trim() == value && value.len() <= 256 {
        Ok(())
    } else {
        Err(CombatRngError::InvalidCombatInstanceId)
    }
}

fn derive_stream_state(
    random_seed: &str,
    combat_instance_id: &str,
    rng_contract_version: CombatVersion,
    channel: RngChannel,
) -> u64 {
    let mut hasher = Sha256::new();
    append_part(&mut hasher, DERIVATION_DOMAIN);
    append_part(&mut hasher, random_seed.as_bytes());
    append_part(&mut hasher, combat_instance_id.as_bytes());
    append_part(&mut hasher, &rng_contract_version.get().to_be_bytes());
    append_part(&mut hasher, channel.id().as_bytes());
    let digest = hasher.finalize();
    u64::from_be_bytes(digest[..8].try_into().expect("SHA-256 has eight bytes"))
}

fn append_part(hasher: &mut Sha256, value: &[u8]) {
    let length = u32::try_from(value.len()).expect("validated RNG derivation input fits u32");
    hasher.update(length.to_be_bytes());
    hasher.update(value);
}

fn parse_state_hex(value: &str) -> Result<u64, CombatRngError> {
    if value.len() != 16
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(CombatRngError::InvalidSnapshot);
    }
    u64::from_str_radix(value, 16).map_err(|_| CombatRngError::InvalidSnapshot)
}

#[cfg(test)]
mod tests {
    use std::num::NonZeroU32;

    use serde_json::{Value, json};

    use super::*;

    const SEED: &str = "0123456789abcdef0123456789abcdef";
    const COMBAT_ID: &str = "combat-rng-contract-fixture";
    const SHARED_RNG_FIXTURE: &str =
        include_str!("../../../packages/contracts/src/combat-rng-contract.fixture.json");

    #[test]
    fn same_seed_instance_and_version_produce_stable_channel_vectors() {
        let mut first = rng();
        let mut second = rng();
        let first_rolls = RngChannel::ALL.map(|channel| {
            [
                first.roll_die(channel, 20).unwrap(),
                first.roll_die(channel, 20).unwrap(),
                first.roll_die(channel, 20).unwrap(),
            ]
        });
        let second_rolls = RngChannel::ALL.map(|channel| {
            [
                second.roll_die(channel, 20).unwrap(),
                second.roll_die(channel, 20).unwrap(),
                second.roll_die(channel, 20).unwrap(),
            ]
        });
        assert_eq!(first_rolls, second_rolls);
        assert_eq!(first_rolls, [[12, 9, 4], [10, 8, 8], [19, 17, 20]]);
    }

    #[test]
    fn channels_have_independent_cursors_and_values() {
        let mut isolated = rng();
        let expected_resolution = isolated.roll_die(RngChannel::Resolution, 20).unwrap();

        let mut noisy_utility = rng();
        for _ in 0..100 {
            noisy_utility
                .draw_bounded(RngChannel::UtilityTieBreak, 7)
                .unwrap();
        }
        assert_eq!(
            noisy_utility.roll_die(RngChannel::Resolution, 20).unwrap(),
            expected_resolution
        );
        let snapshot = noisy_utility.snapshot();
        assert_eq!(snapshot.streams[0].cursor, 0);
        assert_eq!(snapshot.streams[1].cursor, 1);
        assert_eq!(snapshot.streams[2].cursor, 100);
    }

    #[test]
    fn seed_and_combat_identity_are_both_in_the_derivation() {
        let baseline = rng().snapshot();
        let other_seed = CombatRng::new(
            "1123456789abcdef0123456789abcdef",
            COMBAT_ID,
            CURRENT_COMBAT_VERSIONS.rng_contract_version,
        )
        .unwrap()
        .snapshot();
        let other_combat = CombatRng::new(
            SEED,
            "combat-rng-contract-other",
            CURRENT_COMBAT_VERSIONS.rng_contract_version,
        )
        .unwrap()
        .snapshot();
        assert_ne!(baseline.streams, other_seed.streams);
        assert_ne!(baseline.streams, other_combat.streams);
    }

    #[test]
    fn snapshot_restore_resumes_exact_state_and_is_read_only() {
        let mut original = rng();
        original.roll_die(RngChannel::Initiative, 20).unwrap();
        original.roll_die(RngChannel::Resolution, 6).unwrap();
        let before_inspection = original.snapshot();
        assert_eq!(original.snapshot(), before_inspection);

        let encoded = serde_json::to_string(&before_inspection).unwrap();
        let decoded: CombatRngSnapshot = serde_json::from_str(&encoded).unwrap();
        let mut restored = CombatRng::restore(decoded).unwrap();
        assert_eq!(restored.snapshot(), before_inspection);

        for channel in RngChannel::ALL {
            assert_eq!(
                original.roll_die(channel, 100).unwrap(),
                restored.roll_die(channel, 100).unwrap()
            );
        }
    }

    #[test]
    fn snapshot_has_canonical_safe_json_shape() {
        let snapshot = rng().snapshot();
        let value = serde_json::to_value(snapshot).unwrap();
        let shared: Value = serde_json::from_str(SHARED_RNG_FIXTURE).unwrap();
        assert_eq!(value, shared);
        assert_eq!(value["rngContractVersion"], 1);
        assert_eq!(value["streams"][0]["channelId"], "initiative");
        assert_eq!(value["streams"][1]["channelId"], "resolution");
        assert_eq!(value["streams"][2]["channelId"], "utilityTieBreak");
        for stream in value["streams"].as_array().unwrap() {
            assert_eq!(stream["stateHex"].as_str().unwrap().len(), 16);
            assert_eq!(stream["cursor"], 0);
        }
    }

    #[test]
    fn restore_rejects_wrong_order_bad_state_cursor_and_unknown_fields() {
        let mut wrong_order = rng().snapshot();
        wrong_order.streams.swap(0, 1);
        assert_eq!(
            CombatRng::restore(wrong_order),
            Err(CombatRngError::InvalidSnapshot)
        );

        let mut bad_state = rng().snapshot();
        bad_state.streams[0].state_hex = "ABCDEF0123456789".to_owned();
        assert_eq!(
            CombatRng::restore(bad_state),
            Err(CombatRngError::InvalidSnapshot)
        );

        let mut bad_cursor = rng().snapshot();
        bad_cursor.streams[2].cursor = MAX_CURSOR + 1;
        assert_eq!(
            CombatRng::restore(bad_cursor),
            Err(CombatRngError::InvalidSnapshot)
        );

        let mut unknown: Value = serde_json::to_value(rng().snapshot()).unwrap();
        unknown["previewCursor"] = json!(0);
        assert!(serde_json::from_value::<CombatRngSnapshot>(unknown).is_err());
    }

    #[test]
    fn invalid_inputs_ranges_and_future_contract_fail_closed() {
        let current = CURRENT_COMBAT_VERSIONS.rng_contract_version;
        assert_eq!(
            CombatRng::new("not-a-seed", COMBAT_ID, current),
            Err(CombatRngError::InvalidSeed)
        );
        assert_eq!(
            CombatRng::new(SEED, " combat", current),
            Err(CombatRngError::InvalidCombatInstanceId)
        );
        assert_eq!(
            rng().roll_die(RngChannel::Resolution, 0),
            Err(CombatRngError::InvalidRange)
        );
        let future = CombatVersion::new(NonZeroU32::new(2).unwrap());
        assert!(matches!(
            CombatRng::new(SEED, COMBAT_ID, future),
            Err(CombatRngError::UnsupportedContract { .. })
        ));

        let mut exhausted = rng().snapshot();
        exhausted.streams[1].cursor = MAX_CURSOR;
        let mut exhausted = CombatRng::restore(exhausted).unwrap();
        assert_eq!(
            exhausted.roll_die(RngChannel::Resolution, 20),
            Err(CombatRngError::CursorExhausted)
        );
    }

    fn rng() -> CombatRng {
        CombatRng::new(
            SEED,
            COMBAT_ID,
            CURRENT_COMBAT_VERSIONS.rng_contract_version,
        )
        .unwrap()
    }
}

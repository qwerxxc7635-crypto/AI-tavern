use std::{error::Error, fmt, num::NonZeroU32};

use serde::{Deserialize, Serialize};

/// A persisted positive semantic version number.
///
/// This is deliberately numeric rather than a package/build timestamp. Migration
/// and compatibility code can parse a future positive version before deciding
/// whether the local engine supports it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct CombatVersion(NonZeroU32);

impl CombatVersion {
    #[must_use]
    pub const fn new(value: NonZeroU32) -> Self {
        Self(value)
    }

    #[must_use]
    pub const fn get(self) -> u32 {
        self.0.get()
    }
}

const VERSION_ONE: CombatVersion = CombatVersion::new(NonZeroU32::new(1).expect("one is non-zero"));

/// Complete deterministic rule identity required by BattleRecord and
/// ActiveCombatSave.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CombatVersionSet {
    pub combat_schema_version: CombatVersion,
    pub ruleset_version: CombatVersion,
    pub balance_version: CombatVersion,
    pub engine_version: CombatVersion,
    pub world_profile_version: CombatVersion,
    pub attribute_mapping_version: CombatVersion,
    pub rng_contract_version: CombatVersion,
}

pub const CURRENT_COMBAT_VERSIONS: CombatVersionSet = CombatVersionSet {
    combat_schema_version: VERSION_ONE,
    ruleset_version: VERSION_ONE,
    balance_version: VERSION_ONE,
    engine_version: VERSION_ONE,
    world_profile_version: VERSION_ONE,
    attribute_mapping_version: VERSION_ONE,
    rng_contract_version: VERSION_ONE,
};

impl CombatVersionSet {
    /// Rejects a structurally valid version set that this engine cannot execute.
    /// Future migration code must run before this check rather than silently
    /// substituting [`CURRENT_COMBAT_VERSIONS`].
    pub fn ensure_supported(self) -> Result<(), UnsupportedCombatVersion> {
        for field in CombatVersionField::ALL {
            let expected = CURRENT_COMBAT_VERSIONS.value(field);
            let actual = self.value(field);
            if actual != expected {
                return Err(UnsupportedCombatVersion {
                    field,
                    expected,
                    actual,
                });
            }
        }
        Ok(())
    }

    #[must_use]
    pub const fn value(self, field: CombatVersionField) -> CombatVersion {
        match field {
            CombatVersionField::CombatSchema => self.combat_schema_version,
            CombatVersionField::Ruleset => self.ruleset_version,
            CombatVersionField::Balance => self.balance_version,
            CombatVersionField::Engine => self.engine_version,
            CombatVersionField::WorldProfile => self.world_profile_version,
            CombatVersionField::AttributeMapping => self.attribute_mapping_version,
            CombatVersionField::RngContract => self.rng_contract_version,
        }
    }

    /// Stable, human-readable identity for debug traces and persisted diagnostics.
    /// Field order is contractual and contains no system/build time.
    #[must_use]
    pub fn deterministic_identity(self) -> String {
        format!(
            "combatSchemaVersion={}|rulesetVersion={}|balanceVersion={}|engineVersion={}|worldProfileVersion={}|attributeMappingVersion={}|rngContractVersion={}",
            self.combat_schema_version.get(),
            self.ruleset_version.get(),
            self.balance_version.get(),
            self.engine_version.get(),
            self.world_profile_version.get(),
            self.attribute_mapping_version.get(),
            self.rng_contract_version.get(),
        )
    }
}

impl Default for CombatVersionSet {
    fn default() -> Self {
        CURRENT_COMBAT_VERSIONS
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CombatVersionField {
    CombatSchema,
    Ruleset,
    Balance,
    Engine,
    WorldProfile,
    AttributeMapping,
    RngContract,
}

impl CombatVersionField {
    pub const ALL: [Self; 7] = [
        Self::CombatSchema,
        Self::Ruleset,
        Self::Balance,
        Self::Engine,
        Self::WorldProfile,
        Self::AttributeMapping,
        Self::RngContract,
    ];

    #[must_use]
    pub const fn wire_name(self) -> &'static str {
        match self {
            Self::CombatSchema => "combatSchemaVersion",
            Self::Ruleset => "rulesetVersion",
            Self::Balance => "balanceVersion",
            Self::Engine => "engineVersion",
            Self::WorldProfile => "worldProfileVersion",
            Self::AttributeMapping => "attributeMappingVersion",
            Self::RngContract => "rngContractVersion",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct UnsupportedCombatVersion {
    pub field: CombatVersionField,
    pub expected: CombatVersion,
    pub actual: CombatVersion,
}

impl fmt::Display for UnsupportedCombatVersion {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "unsupported {}: expected {}, received {}",
            self.field.wire_name(),
            self.expected.get(),
            self.actual.get(),
        )
    }
}

impl Error for UnsupportedCombatVersion {}

#[cfg(test)]
mod tests {
    use serde::{Deserialize, Serialize};
    use serde_json::{Value, json};

    use super::*;

    const SHARED_FIXTURE: &str =
        include_str!("../../../packages/contracts/src/combat-version-contract.fixture.json");

    #[derive(Debug, PartialEq, Eq, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct BattleRecordVersionFixture {
        combat_instance_id: String,
        #[serde(flatten)]
        versions: CombatVersionSet,
    }

    #[derive(Debug, PartialEq, Eq, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct ActiveCombatSaveVersionFixture {
        combat_instance_id: String,
        last_committed_sequence: u64,
        #[serde(flatten)]
        versions: CombatVersionSet,
    }

    #[test]
    fn shared_fixture_round_trips_the_exact_current_wire_shape() {
        let versions: CombatVersionSet = serde_json::from_str(SHARED_FIXTURE).unwrap();
        assert_eq!(versions, CURRENT_COMBAT_VERSIONS);
        assert_eq!(serde_json::to_value(versions).unwrap(), fixture_value());
        versions.ensure_supported().unwrap();
    }

    #[test]
    fn battle_record_and_active_save_can_flatten_and_restore_versions() {
        let record = BattleRecordVersionFixture {
            combat_instance_id: "combat-version-fixture".to_owned(),
            versions: CURRENT_COMBAT_VERSIONS,
        };
        let save = ActiveCombatSaveVersionFixture {
            combat_instance_id: "combat-version-fixture".to_owned(),
            last_committed_sequence: 17,
            versions: CURRENT_COMBAT_VERSIONS,
        };

        let record_json = serde_json::to_string(&record).unwrap();
        let save_json = serde_json::to_string(&save).unwrap();
        assert_eq!(
            serde_json::from_str::<BattleRecordVersionFixture>(&record_json).unwrap(),
            record
        );
        assert_eq!(
            serde_json::from_str::<ActiveCombatSaveVersionFixture>(&save_json).unwrap(),
            save
        );
        assert_eq!(
            serde_json::from_str::<Value>(&record_json).unwrap()["rngContractVersion"],
            1
        );
    }

    #[test]
    fn structural_decode_rejects_zero_missing_and_unknown_fields() {
        let mut zero = fixture_value();
        zero["engineVersion"] = json!(0);
        assert!(serde_json::from_value::<CombatVersionSet>(zero).is_err());

        let mut missing = fixture_value();
        missing.as_object_mut().unwrap().remove("rulesetVersion");
        assert!(serde_json::from_value::<CombatVersionSet>(missing).is_err());

        let mut unknown = fixture_value();
        unknown["buildTimeVersion"] = json!(1);
        assert!(serde_json::from_value::<CombatVersionSet>(unknown).is_err());
    }

    #[test]
    fn future_positive_version_is_parseable_but_explicitly_unsupported() {
        let mut future = fixture_value();
        future["worldProfileVersion"] = json!(2);
        let versions: CombatVersionSet = serde_json::from_value(future).unwrap();
        let error = versions.ensure_supported().unwrap_err();
        assert_eq!(error.field, CombatVersionField::WorldProfile);
        assert_eq!(error.expected.get(), 1);
        assert_eq!(error.actual.get(), 2);
        assert_eq!(
            error.to_string(),
            "unsupported worldProfileVersion: expected 1, received 2"
        );
    }

    #[test]
    fn deterministic_identity_has_fixed_order_and_no_time_component() {
        let expected = "combatSchemaVersion=1|rulesetVersion=1|balanceVersion=1|engineVersion=1|worldProfileVersion=1|attributeMappingVersion=1|rngContractVersion=1";
        assert_eq!(CURRENT_COMBAT_VERSIONS.deterministic_identity(), expected);
        assert_eq!(CURRENT_COMBAT_VERSIONS.deterministic_identity(), expected);
    }

    fn fixture_value() -> Value {
        serde_json::from_str(SHARED_FIXTURE).unwrap()
    }
}

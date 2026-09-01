//! Deterministic, platform-independent Ember Tavern combat rules.
//!
//! This crate must remain independent of persistence, UI, providers, system time,
//! and platform services. Runtime behavior is added only by the owning milestone.

mod version;

pub use version::{
    CURRENT_COMBAT_VERSIONS, CombatVersion, CombatVersionField, CombatVersionSet,
    UnsupportedCombatVersion,
};

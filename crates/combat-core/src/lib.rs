//! Deterministic, platform-independent Ember Tavern combat rules.
//!
//! This crate must remain independent of persistence, UI, providers, system time,
//! and platform services. Runtime behavior is added only by the owning milestone.

mod invariant;
mod rng;
mod state;
mod version;

pub use invariant::{
    CombatStateInvariantCode, CombatStateInvariantError, CombatStateInvariantValidator,
};
pub use rng::{
    COMBAT_RNG_CHANNELS, CombatRng, CombatRngError, CombatRngSnapshot, RngChannel,
    RngStreamSnapshot,
};
pub use state::{
    AbilityUsageState, CombatPhase, CombatResultType, CombatSide, CombatState, CombatStateEnvelope,
    CombatStateHashError, CombatStateRestoreError, CombatantRuntime, CombatantState,
    CostCommitState, DurationClock, EventSchedulerCheckpoint, HookPhase, ObjectiveKind,
    ObjectiveRuntime, ObjectiveRuntimeState, PendingReactionWindow, ProvisionalDeltaEntry,
    ProvisionalRuntimeDelta, ReinforcementRuntime, ReinforcementRuntimeState, ResourceState,
    ResultCandidate, RoundRosterEntry, RoundRosterStatus, RoundRuntimeState, SchedulerItem,
    SchedulerItemKind, StatusRuntime, TimelineEntry,
};
pub use version::{
    CURRENT_COMBAT_VERSIONS, CombatVersion, CombatVersionField, CombatVersionSet,
    UnsupportedCombatVersion,
};

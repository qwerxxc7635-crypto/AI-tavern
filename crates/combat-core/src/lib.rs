//! Deterministic, platform-independent Ember Tavern combat rules.
//!
//! This crate must remain independent of persistence, UI, providers, system time,
//! and platform services. Runtime behavior is added only by the owning milestone.

mod attribute;
mod command;
mod cost;
mod invariant;
mod precondition;
mod rng;
mod state;
mod version;

pub use attribute::{
    CombatAttributeProfile, CombatAttributeResolver, CombatAttributeResolverError,
    CombatAttributeResolverErrorCode, CombatAttributeRole, CombatProficiencyDefinition,
    CombatSaveType, LegacyAttributeModifier, LegacyAttributeModifierKind, ResolvedCombatAttributes,
    ResolvedProficiency, V03BaseAttributes, V03CombatAttributeSource, V03HitPoints,
    V03PlayerCombatSource, V03RuleSkill, V03UniversalAttributeProjection, WorldCombatProfileId,
};
pub use command::{
    AcceptedCombatCommand, AcceptedCommandLedger, AcceptedCommandReceipt, AcceptedCommandSource,
    CombatCommandBoundaryError, CombatCommandBoundaryErrorCode, CombatCommandEnvelope,
    CombatCommandPayload, CombatCommandSource, CommandAcceptanceStatus, InternalCombatCommand,
    ReactionDecisionChoice, TacticalPreferenceValue,
};
pub use cost::{
    CombatCostAsset, CombatCostRequestLine, CombatInventoryItemState, CostReservationError,
    CostReservationErrorCode, CostReservationModel, CostReservationMutationStatus,
    CostReservationReceipt, CostReservationRecord, CostReservationRequest, CostReservationStatus,
    ReservedCombatCost,
};
pub use invariant::{
    CombatStateInvariantCode, CombatStateInvariantError, CombatStateInvariantValidator,
};
pub use precondition::{
    EntityTagFacts, PreconditionDefinitionError, PreconditionDefinitionErrorCode,
    PreconditionEvaluation, PreconditionEvaluationContext, PreconditionFailure,
    PreconditionFailureCode, PreconditionRule, PreconditionRuleSpec, PreconditionRuleSystem,
    PreconditionTiming,
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

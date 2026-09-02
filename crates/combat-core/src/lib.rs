//! Deterministic, platform-independent Ember Tavern combat rules.
//!
//! This crate must remain independent of persistence, UI, providers, system time,
//! and platform services. Runtime behavior is added only by the owning milestone.

mod attack;
mod attribute;
mod command;
mod cost;
mod damage_channel;
mod execution;
mod invariant;
mod mitigation;
mod numeric;
mod objective;
mod precondition;
mod resolution;
mod resolution_context;
mod rng;
mod runtime_commit;
mod scheduler;
mod state;
mod submission;
mod terminal;
mod turn;
mod version;

pub use attack::{
    AttackClassification, AttackRuleError, AttackRuleErrorCode, BasicAttackBalanceConfig,
    BasicAttackRules, BasicAttackUsageDecision, CriticalDamageOverride, CriticalDamagePlan,
    CriticalDamageRules, CriticalEligibility, DamageComponentTiming, DamageDiceDefinition,
    MultipleAttackPenaltyOverride,
};
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
pub use damage_channel::{
    DamageChannelCatalog, DamageChannelCatalogError, DamageChannelCatalogErrorCode,
    DamageChannelDefinition, DamageChannelId,
};
pub use execution::{
    AbilityUsageCommitPlan, ExecutionRevalidationError, ExecutionRevalidationOutcome,
    ExecutionRevalidationRequest, ExecutionRevalidationService, OnceUsageCommit,
};
pub use invariant::{
    CombatStateInvariantCode, CombatStateInvariantError, CombatStateInvariantValidator,
};
pub use mitigation::{
    DamageDefenseProfile, DamageImmunity, DamageMitigationRequest, DamageMitigationResult,
    MitigationBalanceConfig, MitigationError, MitigationErrorCode, MitigationPipeline,
    PrimaryMitigation, ZeroDamageReason,
};
pub use numeric::{
    COMBAT_FIXED_SCALE, CombatFixed, CombatNumeric, CombatNumericError, CombatNumericErrorCode,
};
pub use objective::{
    CombatObjectiveRuntime, ObjectiveEvaluation, ObjectiveEvaluationPoint, ObjectiveRuntimeError,
    ObjectiveRuntimeErrorCode,
};
pub use precondition::{
    EntityTagFacts, PreconditionDefinitionError, PreconditionDefinitionErrorCode,
    PreconditionEvaluation, PreconditionEvaluationContext, PreconditionFailure,
    PreconditionFailureCode, PreconditionRule, PreconditionRuleSpec, PreconditionRuleSystem,
    PreconditionTiming,
};
pub use resolution::{
    ConditionalComparison, OpposedTieRule, ResolutionError, ResolutionErrorCode, ResolutionRequest,
    ResolutionResolver, ResolutionResult, ResolutionType,
};
pub use resolution_context::{
    ResolutionContext, ResolutionContextError, ResolutionContextErrorCode,
    ResolutionContextLifecycle, ResolutionContextStatus, ResolutionSuspensionRecord,
    ResolvedRollRecord, TargetRedirectRecord,
};
pub use rng::{
    COMBAT_RNG_CHANNELS, CombatRng, CombatRngError, CombatRngSnapshot, RngChannel,
    RngStreamSnapshot,
};
pub use runtime_commit::{
    CanonicalDomainDelta, CanonicalDomainValue, CombatFinishedFact, PreCombatSnapshot,
    ResultPersistencePolicy, RuntimeCommitContract, RuntimeCommitError, RuntimeCommitErrorCode,
    RuntimeFinalizationPlan, RuntimeFinalizationRequest,
};
pub use scheduler::{
    CanonicalEventChainScheduler, EventSchedulerError, EventSchedulerErrorCode,
    NON_COMBATANT_INITIATIVE_ORDER, SchedulerCandidate, SchedulerExecutionGateOutcome,
};
pub use state::{
    AbilityUsageState, CombatPhase, CombatResultType, CombatSide, CombatState, CombatStateEnvelope,
    CombatStateHashError, CombatStateRestoreError, CombatantRuntime, CombatantState,
    CostCommitState, DurationClock, EventSchedulerCheckpoint, EventSchedulerStatus, HookPhase,
    LoopGuardEngineFailure, LoopGuardFailureReason, LoopGuardRollbackPolicy,
    ObjectiveCommittedOutcome, ObjectiveCommittedSignal, ObjectiveFailureReason,
    ObjectiveFailureRecord, ObjectiveKind, ObjectiveRuntime, ObjectiveRuntimeState,
    PendingReactionWindow, ProvisionalDeltaEntry, ProvisionalRuntimeDelta, ReinforcementRuntime,
    ReinforcementRuntimeState, ResourceState, ResultCandidate, RoundRosterEntry, RoundRosterStatus,
    RoundRuntimeState, SchedulerItem, SchedulerItemKind, StatusRuntime, TerminalPriorityPolicy,
    TerminalPriorityTier, TimelineEntry, UsageCounterScope, UsageCounterState,
};
pub use submission::{
    CombatControlAssignment, CombatControlAuthority, CombatSubmissionAccepted,
    CombatSubmissionError, CombatSubmissionRequest, CombatSubmissionService,
};
pub use terminal::{
    TerminalArbitrationError, TerminalArbitrationErrorCode, TerminalArbitrationOutcome,
    TerminalOutcomeArbitrator,
};
pub use turn::{
    NextTurnOutcome, OwnerTurnStartOutcome, TurnRoundStateMachine, TurnStateError,
    TurnStateErrorCode,
};
pub use version::{
    CURRENT_COMBAT_VERSIONS, CombatVersion, CombatVersionField, CombatVersionSet,
    UnsupportedCombatVersion,
};

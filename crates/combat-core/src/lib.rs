//! Deterministic, platform-independent Ember Tavern combat rules.
//!
//! This crate must remain independent of persistence, UI, providers, system time,
//! and platform services. Runtime behavior is added only by the owning milestone.

mod ai_mechanical_exposure;
mod attack;
mod attribute;
mod clock;
mod command;
mod control;
mod cost;
mod cross_world_profile;
mod cultivation;
mod damage_bundle;
mod damage_channel;
mod effect;
mod encounter;
mod execution;
mod fantasy;
mod gameplay_tag;
mod invariant;
mod lethal;
mod mechanical_intent;
mod mitigation;
mod numeric;
mod objective;
mod power_budget;
mod precondition;
mod reaction;
mod recovery;
mod resolution;
mod resolution_context;
mod rng;
mod runtime_commit;
mod scheduler;
mod sci_fi;
mod shield;
mod state;
mod status;
mod status_merge;
mod submission;
mod terminal;
mod trigger;
mod turn;
mod urban;
mod version;
mod world_profile;

pub use ai_mechanical_exposure::{
    AiMechanicalExposure, AiMechanicalExposureError, AiMechanicalExposureErrorCode,
    AiMechanicalExposurePolicy,
};
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
pub use clock::{
    ClockLifecycleWindow, StatusApplicationClockContext, StatusClockAssignment, StatusClockEngine,
    StatusClockError, StatusClockErrorCode, StatusClockObservation, StatusClockPolicy,
    StatusDurationAdvancePoint, StatusDurationTransition, StatusTickDecision,
};
pub use command::{
    AcceptedCombatCommand, AcceptedCommandLedger, AcceptedCommandReceipt, AcceptedCommandSource,
    CombatCommandBoundaryError, CombatCommandBoundaryErrorCode, CombatCommandEnvelope,
    CombatCommandPayload, CombatCommandSource, CommandAcceptanceStatus, InternalCombatCommand,
    ReactionDecisionChoice, TacticalPreferenceValue,
};
pub use control::{
    ControlApplicationDecision, ControlApplicationEngine, ControlApplicationRejection,
    ControlBalanceConfig, ControlError, ControlErrorCode, ControlImmunityEvidence,
    ControlResolutionGate, ControlTargetTier, ControlTurnCompletion, HardCcDrEngine,
    PendingHardCcDrCommit,
};
pub use cost::{
    CombatCostAsset, CombatCostRequestLine, CombatInventoryItemState, CostReservationError,
    CostReservationErrorCode, CostReservationModel, CostReservationMutationStatus,
    CostReservationReceipt, CostReservationRecord, CostReservationRequest, CostReservationStatus,
    ReservedCombatCost,
};
pub use cultivation::{
    CultivationBalanceConfig, CultivationProfile, CultivationRuleError, CultivationRuleErrorCode,
    CultivationSoulOpposedInput, CultivationSubProfile,
};
pub use damage_bundle::{
    CommittedDamageEvent, DamageBundle, DamageBundleCommit, DamageBundleComponent,
    DamageBundleError, DamageBundleErrorCode, DamageBundleProcessor, WorkingDamageResult,
};
pub use damage_channel::{
    DamageChannelCatalog, DamageChannelCatalogError, DamageChannelCatalogErrorCode,
    DamageChannelDefinition, DamageChannelId,
};
pub use effect::{
    EffectAmount, EffectDefinition, EffectError, EffectErrorCode, EffectHandlerSet,
    EffectPrimitiveId, EffectValueContext, ResolvedEffect, StatModification,
};
pub use encounter::{
    CommittedEncounterEvent, EncounterDamageRule, EncounterDamageServices, EncounterRuleError,
    EncounterRuleErrorCode, EncounterRuleExecutor, ReinforcementActivationCommit,
};
pub use execution::{
    AbilityUsageCommitPlan, ExecutionRevalidationError, ExecutionRevalidationOutcome,
    ExecutionRevalidationRequest, ExecutionRevalidationService, OnceUsageCommit,
};
pub use fantasy::{
    FantasyBalanceConfig, FantasyOwnerTurnRecovery, FantasyProfile, FantasyRuleError,
    FantasyRuleErrorCode,
};
pub use gameplay_tag::{
    GameplayTagCatalog, GameplayTagCatalogError, GameplayTagCatalogErrorCode,
    GameplayTagDefinition, GameplayTagId, GameplayTagNamespace, StaticGameplayTagDefinition,
};
pub use invariant::{
    CombatStateInvariantCode, CombatStateInvariantError, CombatStateInvariantValidator,
};
pub use lethal::{
    AtomicHealthTransitionProcessor, CommittedLethalEvent, DirectHealthMutationOrigin,
    HealthMutation, HealthTransitionCommit, HealthTransitionError, HealthTransitionErrorCode,
    HealthTransitionRequest, LethalOutcomeResolver, LethalResolutionCore, LethalResolutionError,
    LethalResolutionErrorCode, PendingLethalOutcome, PendingLethalOutcomeKind, TargetDefeatedFact,
    lethal_error,
};
pub use mechanical_intent::{
    CanonicalLocalOverride, CanonicalMechanicalDefinition, CombatMechanicalConcept,
    MechanicalIntentError, MechanicalIntentErrorCode, MechanicalIntentMapper, MechanicalTarget,
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
pub use power_budget::{
    BudgetedMechanicalCandidate, CostIntensity, PowerBudgetBalanceConfig, PowerBudgetBasis,
    PowerBudgetEngine, PowerBudgetError, PowerBudgetErrorCode, PowerBudgetReceipt,
    ProgrammaticCombatNumbers, ProgrammaticNumberRequest, ProgrammaticResourceCost,
    ResourceCostIntent, ResourceCostOperation,
};
pub use precondition::{
    EntityTagFacts, PreconditionDefinitionError, PreconditionDefinitionErrorCode,
    PreconditionEvaluation, PreconditionEvaluationContext, PreconditionFailure,
    PreconditionFailureCode, PreconditionRule, PreconditionRuleSpec, PreconditionRuleSystem,
    PreconditionTiming,
};
pub use reaction::{
    CURRENT_REACTION_SCHEMA_VERSION, CanonicalReactionCore, CombatantCostSnapshot, CostSnapshot,
    PendingReactionSnapshot, ReactionBinding, ReactionContinuationSnapshot,
    ReactionDecisionOutcome, ReactionDecisionStatus, ReactionDefinition, ReactionExecutionMode,
    ReactionExecutionPermit, ReactionRouteOutcome, ReactionRuleError, ReactionRuleErrorCode,
    ResolutionContextSnapshot, UtilityReactionDecision,
};
pub use recovery::{
    CombatPartyMode, CombatPartyPolicy, CommittedRecoveryEvent, ExecutableRecoveryPath,
    NoReviveFollowups, RecoveryEffectCommit, RecoveryEffectProcessor, RecoveryEffectRequest,
    RecoveryRuleError, RecoveryRuleErrorCode, ReviveFollowupApplier, SoloRecoveryBalanceConfig,
    StandardLethalPolicy,
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
pub use sci_fi::{
    SciFiAbilityHeatClass, SciFiBalanceConfig, SciFiHeatDecision, SciFiOwnerTurnRecovery,
    SciFiProfile, SciFiRechargeOutcome, SciFiRuleError, SciFiRuleErrorCode,
};
pub use shield::{
    DamageSourceRelation, RechargeInterruptionDecision, RechargeInterruptionPolicy,
    RechargeInterruptionReason, ShieldInteraction, ShieldRechargeEvaluator, ShieldResolution,
    ShieldResolutionError, ShieldResolutionErrorCode, ShieldResolutionRequest,
    ShieldResolutionResult,
};
pub use state::{
    AbilityUsageState, CombatPhase, CombatResultType, CombatSide, CombatState, CombatStateEnvelope,
    CombatStateHashError, CombatStateRestoreError, CombatantRuntime, CombatantState,
    CostCommitState, DurationClock, EventSchedulerCheckpoint, EventSchedulerStatus,
    HardCcDrRuntime, HookPhase, LoopGuardEngineFailure, LoopGuardFailureReason,
    LoopGuardRollbackPolicy, ObjectiveCommittedOutcome, ObjectiveCommittedSignal,
    ObjectiveFailureReason, ObjectiveFailureRecord, ObjectiveKind, ObjectiveRuntime,
    ObjectiveRuntimeState, PendingReactionItem, PendingReactionWindow, ProvisionalDeltaEntry,
    ProvisionalRuntimeDelta, ReactionWindowStatus, ReinforcementRuntime, ReinforcementRuntimeState,
    ResourceState, ResultCandidate, RoundRosterEntry, RoundRosterStatus, RoundRuntimeState,
    SchedulerItem, SchedulerItemKind, ShieldRechargeRuntime, StatusRuntime, TerminalPriorityPolicy,
    TerminalPriorityTier, TimelineEntry, UsageCounterScope, UsageCounterState,
};
pub use status::{
    CURRENT_STATUS_SCHEMA_VERSION, ControlCategory, StatusActivationPolicy, StatusDefinition,
    StatusDurationDefinition, StatusExpiryPhase, StatusRefreshPolicy, StatusSchemaError,
    StatusSchemaErrorCode, StatusSchemaValidator, StatusStackMode, StatusTickPhase,
    StatusTriggerDefinition, StatusTriggerHook,
};
pub use status_merge::{
    StatusMergeEngine, StatusMergeError, StatusMergeErrorCode, StatusMergeNoOpReason,
    StatusMergeOutcome, StatusMergePolicy,
};
pub use submission::{
    CombatControlAssignment, CombatControlAuthority, CombatSubmissionAccepted,
    CombatSubmissionError, CombatSubmissionRequest, CombatSubmissionService,
};
pub use terminal::{
    TerminalArbitrationError, TerminalArbitrationErrorCode, TerminalArbitrationOutcome,
    TerminalOutcomeArbitrator,
};
pub use trigger::{
    CalculatedTriggerHook, CanonicalTriggerPipeline, CommittedTriggerEvent, LifecycleTriggerHook,
    ScheduledTriggerPermit, TRIGGER_PHASE_PRIORITY_CONTRACT_VERSION, TriggerDispatchOutcome,
    TriggerPipelineError, TriggerPipelineErrorCode, TriggerSignal,
};
pub use turn::{
    NextTurnOutcome, OwnerTurnStartOutcome, TurnRoundStateMachine, TurnStateError,
    TurnStateErrorCode,
};
pub use urban::{
    UrbanBalanceConfig, UrbanHealingDecision, UrbanHealingSource, UrbanOwnerTurnRecovery,
    UrbanProfile, UrbanRuleError, UrbanRuleErrorCode, UrbanSubProfile, UrbanTacticalAction,
    UrbanTacticalRecovery,
};
pub use version::{
    CURRENT_COMBAT_VERSIONS, CombatVersion, CombatVersionField, CombatVersionSet,
    UnsupportedCombatVersion,
};
pub use world_profile::{
    ChannelMitigationRule, DefenseBehavior, DeveloperRuleModule, NormalOwnerTurnResourcePolicy,
    RecoveryRules, ResourceLifecycle, ResourceLifecycleRule, ResourceStorage, SignatureMechanic,
    WorldCombatProfile, WorldCombatProfileDefinition, WorldCombatProfileResolver,
    WorldProfileError, WorldProfileErrorCode, WorldRuleFacet, WorldType,
};

export {
  CampaignNotFoundError,
  CampaignRepository,
  PersistenceDataError,
} from './campaign-repository.js';
export {
  createConsistentDatabaseBackup,
  DatabaseBackupError,
  listConsistentDatabaseBackups,
} from './database-backup.mjs';
export type {
  DatabaseBackupFailureCode,
  DatabaseBackupOptions,
  DatabaseBackupResult,
} from './database-backup.mjs';
export { AdventureSettlementRepository } from './adventure-settlement-repository.js';
export type {
  AdventureSettlementCommit,
  SettlementCommitResult,
  SettlementNpcUpdate,
} from './adventure-settlement-repository.js';
export { DatabaseStartupError, prepareDatabaseFile } from './database-startup.mjs';
export type { DatabaseStartupFailureCode, DatabaseStartupResult } from './database-startup.mjs';
export { GameEventRepository } from './game-event-repository.js';
export { EventLedgerRepository } from './event-ledger-repository.js';
export type { AppendEventLedgerEntry } from './event-ledger-repository.js';
export { AICandidateRepository, AICandidateTransitionError } from './ai-candidate-repository.js';
export type { CreateAICandidate } from './ai-candidate-repository.js';
export { GenerationRecordRepository } from './generation-record-repository.js';
export type {
  CompleteGenerationRecord,
  CreateGenerationRecord,
} from './generation-record-repository.js';
export { CacheMetricsRepository } from './cache-metrics-repository.js';
export type { CacheMetric, CacheMetricInput } from './cache-metrics-repository.js';
export { ModelProfileRepository } from './model-profile-repository.js';
export type {
  RegisteredModelCapabilities,
  RegisteredModelCostStatus,
  RegisteredModelProfile,
} from './model-profile-repository.js';
export {
  ConversationRepository,
  ItemRepository,
  WorldClockRepository,
} from './conversation-item-clock-repository.js';
export {
  PlayerCharacterNotFoundError,
  PlayerCharacterRepository,
} from './player-character-repository.js';
export {
  AiRequestTransitionError,
  IdempotencyConflictError,
  PendingAiRequestRepository,
} from './pending-ai-request-repository.js';
export type {
  CreatePendingAiRequest,
  IdempotentCommitResult,
  NpcInitializationRecord,
} from './pending-ai-request-repository.js';
export { NpcRepository, TavernRepository } from './tavern-npc-repository.js';
export { AdventureRepository, QuestRepository } from './quest-adventure-repository.js';
export { QuestPoolRepository } from './quest-pool-repository.js';
export type { TransitionQuestPoolState } from './quest-pool-repository.js';
export { QuestGraphRepository, loadEntityStates } from './quest-graph-repository.js';
export type { EvaluateQuestGraph, ReplaceQuestGraph } from './quest-graph-repository.js';
export { DynamicQuestSourceRepository } from './dynamic-quest-source-repository.js';
export type { CommitDynamicQuest } from './dynamic-quest-source-repository.js';
export { TurnTransaction } from './turn-transaction.js';
export type { TurnCommit, TurnStatePatch } from './turn-transaction.js';
export { WorldRepository } from './world-repository.js';
export { WorldConstitutionRepository } from './world-constitution-repository.js';
export { WorldSeedRepository } from './world-seed-repository.js';
export { WorldDirectorRepository } from './world-director-repository.js';
export type { CommitWorldDirectorRun } from './world-director-repository.js';
export { RulesEngineRepository, RulesIdempotencyConflictError } from './rules-engine-repository.js';
export type { CommitRulesCommand, RulesCommitResult } from './rules-engine-repository.js';
export { KnowledgeBoundaryRepository } from './knowledge-boundary-repository.js';
export type {
  ForgetKnowledgeOnceInput,
  KnowledgeCommitReceipt,
  KnowledgeMutationIdentity,
  SaveKnowledgeOnceInput,
} from './knowledge-boundary-repository.js';
export { UniversalCharacterRepository } from './universal-character-repository.js';
export { CharacterCreationSessionRepository } from './character-creation-session-repository.js';
export { CareerPoolRepository } from './career-pool-repository.js';
export { NpcLodRepository } from './npc-lod-repository.js';
export type { CommitNpcLodUpgrade } from './npc-lod-repository.js';
export { DynamicLocationRepository } from './dynamic-location-repository.js';
export type {
  CommitLocationMaterialization,
  CommitLocationTravel,
  DynamicLocationSnapshot,
} from './dynamic-location-repository.js';
export { ActiveFactionRepository } from './active-faction-repository.js';
export type {
  ActiveFactionSnapshot,
  CommitFactionAction,
  CommitFactionActivation,
} from './active-faction-repository.js';
export { TavernPopulationRepository } from './tavern-population-repository.js';
export type {
  FocusTavernPopulation,
  ProjectTavernPopulation,
} from './tavern-population-repository.js';
export type { CharacterCreationConfirmation } from './character-creation-session-repository.js';
export { SnapshotRepository } from './snapshot-repository.js';
export type { CreateSnapshot } from './snapshot-repository.js';
export { exportCampaignSave } from './save-export.js';
export type {
  CampaignSaveExport,
  CampaignSaveExportOptions,
  CampaignSaveManifest,
} from './save-export.js';
export { importCampaignSave } from './save-import.js';
export type { CampaignSaveImportOptions, CampaignSaveImportResult } from './save-import.js';
export type {
  SqliteDatabase,
  SqliteRunResult,
  SqliteStatement,
  SqliteValue,
  TransactionalSqliteDatabase,
} from './sqlite-port.js';

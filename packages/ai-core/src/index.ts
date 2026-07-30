export { AI_TASKS, PROVIDER_PRESET_KEYS, PROVIDER_TYPES } from './protocol.js';
export { FakeAIProvider, FakeAIProviderError } from './fake-ai-provider.js';
export { FAKE_TASK_OUTPUTS } from './fake-task-outputs.js';
export { AI_TASK_SCHEMAS, taskSchemas } from './task-schema-registry.js';
export type { AITaskSchemaDefinition } from './task-schema-registry.js';
export * from './task-schemas.js';
export type {
  AIProvider,
  AITask,
  ConnectionErrorCode,
  ModelCapabilities,
  ModelCostStatus,
  ModelInfo,
  NormalizedAIRequest,
  NormalizedAIResponse,
  NormalizedFinishReason,
  NormalizedMessage,
  NormalizedMessageRole,
  NormalizedResponseFormat,
  NormalizedTokenUsage,
  ProviderConfig,
  ProviderPresetKey,
  ProviderType,
  TestResult,
} from './protocol.js';

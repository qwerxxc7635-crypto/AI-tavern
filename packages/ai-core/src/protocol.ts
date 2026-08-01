import type { AiRequestId, IsoTimestamp, JsonValue, PromptVersion } from '@ember-tavern/contracts';

export const AI_TASKS = [
  'GENERATE_WORLD',
  'REFINE_WORLD',
  'GENERATE_CHARACTER_TRAITS',
  'COMPLETE_CHARACTER_BACKGROUND',
  'GENERATE_TAVERN',
  'GENERATE_NPCS',
  'NPC_REPLY',
  'GENERATE_QUEST',
  'GENERATE_ADVENTURE_PLAN',
  'GENERATE_ADVENTURE_TURN',
  'RESOLVE_DICE_RESULT',
  'GENERATE_WORLD_EVENT',
  'SUMMARIZE_ADVENTURE',
  'EXTRACT_MEMORIES',
  'CHECK_CONSISTENCY',
] as const;

export type AITask = (typeof AI_TASKS)[number];

export const PROVIDER_TYPES = [
  'OPENAI_NATIVE',
  'ANTHROPIC_NATIVE',
  'GEMINI_NATIVE',
  'OPENAI_COMPATIBLE',
  'LOCAL_OPENAI_COMPATIBLE',
] as const;

export type ProviderType = (typeof PROVIDER_TYPES)[number];

export const PROVIDER_PRESET_KEYS = [
  'deepseek',
  'qwen',
  'zhipu-glm',
  'moonshot-kimi',
  'minimax',
  'doubao',
  'hunyuan',
  'qianfan',
  'siliconflow',
  'openrouter',
  'groq',
  'openai',
  'anthropic',
  'gemini',
  'ollama',
  'lm-studio',
  'custom',
] as const;

export type ProviderPresetKey = (typeof PROVIDER_PRESET_KEYS)[number];

export interface ProviderConfig {
  readonly id: string;
  readonly providerType: ProviderType;
  readonly presetKey: ProviderPresetKey;
  readonly displayName: string;
  readonly baseUrl: string | null;
  readonly credentialRef: string | null;
  readonly options: Readonly<Record<string, JsonValue>>;
  readonly enabled: boolean;
}

export type ModelCostStatus = 'FREE' | 'PAID' | 'UNKNOWN';

export interface ModelCapabilities {
  readonly text: boolean;
  readonly streaming: boolean;
  readonly systemMessages: boolean;
  readonly jsonMode: boolean;
  readonly jsonSchema: boolean;
  readonly toolCalling: boolean;
  readonly reasoning: boolean;
  readonly contextWindowTokens: number | null;
  readonly costStatus: ModelCostStatus;
  readonly checkedAt: IsoTimestamp;
}

export interface ModelInfo {
  readonly name: string;
  readonly displayName: string;
  readonly capabilities: ModelCapabilities;
}

export type NormalizedMessageRole = 'SYSTEM' | 'USER' | 'ASSISTANT';

export interface NormalizedMessage {
  readonly role: NormalizedMessageRole;
  readonly content: string;
}

export type NormalizedResponseFormat =
  | { readonly kind: 'TEXT' }
  | { readonly kind: 'JSON_OBJECT' }
  | {
      readonly kind: 'JSON_SCHEMA';
      readonly name: string;
      readonly schema: Readonly<Record<string, JsonValue>>;
    };

export interface NormalizedAIRequest {
  readonly requestId: AiRequestId;
  readonly task: AITask;
  readonly promptVersion: PromptVersion;
  readonly modelName: string;
  readonly messages: readonly NormalizedMessage[];
  readonly responseFormat: NormalizedResponseFormat;
  readonly temperature: number;
  readonly maxOutputTokens: number;
  readonly timeoutMs: number;
}

export type NormalizedFinishReason =
  'STOP' | 'LENGTH' | 'CONTENT_FILTER' | 'TOOL_CALL' | 'ERROR' | 'UNKNOWN';

export interface NormalizedTokenUsage {
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly totalTokens: number | null;
}

export interface NormalizedAIResponse {
  readonly requestId: AiRequestId;
  readonly providerRequestId: string | null;
  readonly modelName: string;
  readonly content: string;
  readonly finishReason: NormalizedFinishReason;
  readonly usage: NormalizedTokenUsage;
  readonly receivedAt: IsoTimestamp;
}

export type ConnectionErrorCode =
  | 'QUOTA_EXCEEDED'
  | 'AUTHENTICATION'
  | 'NETWORK'
  | 'RATE_LIMITED'
  | 'TIMEOUT'
  | 'MODEL_NOT_FOUND'
  | 'UNSUPPORTED'
  | 'UNKNOWN';

export type TestResult =
  | Readonly<{ ok: true; latencyMs: number }>
  | Readonly<{
      ok: false;
      latencyMs: number | null;
      errorCode: ConnectionErrorCode;
      message: string;
    }>;

export interface AIProvider {
  readonly id: string;
  listModels(): Promise<readonly ModelInfo[]>;
  testConnection(config: ProviderConfig): Promise<TestResult>;
  generate(request: NormalizedAIRequest, config: ProviderConfig): Promise<NormalizedAIResponse>;
}

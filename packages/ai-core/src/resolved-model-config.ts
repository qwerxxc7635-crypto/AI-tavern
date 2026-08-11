import type { JsonValue, ModelProfileId, PromptVersion } from '@ember-tavern/contracts';

import { sha256CanonicalJson } from './canonical-json.js';
import type {
  AITask,
  ModelCapabilities,
  NormalizedAIRequest,
  ProviderConfig,
  ProviderPresetKey,
  ProviderType,
} from './protocol.js';

export interface FrozenGenerationParameters {
  readonly temperature: number;
  readonly maxOutputTokens: number;
  readonly timeoutMs: number;
}

export interface FrozenPromptProfile {
  readonly task: AITask;
  readonly promptVersion: PromptVersion;
  readonly responseFormat: NormalizedAIRequest['responseFormat']['kind'];
  readonly responseSchemaName: string | null;
}

export interface ResolvedModelConfig {
  readonly connectionProfileId: string;
  readonly providerType: ProviderType;
  readonly presetKey: ProviderPresetKey;
  readonly endpoint: string | null;
  readonly credentialRef: string | null;
  readonly providerOptions: Readonly<Record<string, JsonValue>>;
  readonly modelProfileId: ModelProfileId | null;
  readonly modelName: string;
  readonly capabilities: ModelCapabilities;
  readonly generation: FrozenGenerationParameters;
  readonly promptProfile: FrozenPromptProfile;
  readonly cacheProfile: JsonValue | null;
  readonly fingerprint: string;
}

export interface ResolveModelConfigInput {
  readonly connectionProfile: ProviderConfig;
  readonly modelProfileId: ModelProfileId | null;
  readonly capabilities: ModelCapabilities;
  readonly request: NormalizedAIRequest;
  readonly cacheProfile?: JsonValue | null;
}

export class ResolvedModelConfigError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'ResolvedModelConfigError';
  }
}

export async function resolveModelConfig(
  input: ResolveModelConfigInput,
): Promise<ResolvedModelConfig> {
  validateInput(input);
  const endpoint = normalizeEndpoint(input.connectionProfile.baseUrl);
  const providerOptions = freezeJson(input.connectionProfile.options) as Readonly<
    Record<string, JsonValue>
  >;
  const capabilities = Object.freeze({ ...input.capabilities });
  const generation = Object.freeze({
    temperature: input.request.temperature,
    maxOutputTokens: input.request.maxOutputTokens,
    timeoutMs: input.request.timeoutMs,
  });
  const promptProfile = Object.freeze({
    task: input.request.task,
    promptVersion: input.request.promptVersion,
    responseFormat: input.request.responseFormat.kind,
    responseSchemaName:
      input.request.responseFormat.kind === 'JSON_SCHEMA'
        ? input.request.responseFormat.name
        : null,
  });
  const cacheProfile = freezeJson(input.cacheProfile ?? null);
  const payload = fingerprintPayload({
    connectionProfileId: input.connectionProfile.id,
    providerType: input.connectionProfile.providerType,
    presetKey: input.connectionProfile.presetKey,
    endpoint,
    credentialRef: input.connectionProfile.credentialRef,
    providerOptions,
    modelProfileId: input.modelProfileId,
    modelName: input.request.modelName,
    capabilities,
    generation,
    promptProfile,
    cacheProfile,
  });
  return Object.freeze({
    ...payload,
    fingerprint: await sha256CanonicalJson(payload as unknown as JsonValue),
  });
}

export async function verifyResolvedModelConfig(config: ResolvedModelConfig): Promise<boolean> {
  try {
    return (
      (await sha256CanonicalJson(fingerprintPayload(config) as unknown as JsonValue)) ===
      config.fingerprint
    );
  } catch {
    return false;
  }
}

export function providerConfigFromResolved(config: ResolvedModelConfig): ProviderConfig {
  return Object.freeze({
    id: config.connectionProfileId,
    providerType: config.providerType,
    presetKey: config.presetKey,
    displayName: config.connectionProfileId,
    baseUrl: config.endpoint,
    credentialRef: config.credentialRef,
    options: config.providerOptions,
    enabled: true,
  });
}

function fingerprintPayload(
  config: Omit<ResolvedModelConfig, 'fingerprint'> | ResolvedModelConfig,
): Omit<ResolvedModelConfig, 'fingerprint'> {
  return Object.freeze({
    connectionProfileId: config.connectionProfileId,
    providerType: config.providerType,
    presetKey: config.presetKey,
    endpoint: config.endpoint,
    credentialRef: config.credentialRef,
    providerOptions: config.providerOptions,
    modelProfileId: config.modelProfileId,
    modelName: config.modelName,
    capabilities: config.capabilities,
    generation: config.generation,
    promptProfile: config.promptProfile,
    cacheProfile: config.cacheProfile,
  });
}

function validateInput(input: ResolveModelConfigInput): void {
  if (!input.connectionProfile.enabled) {
    throw new ResolvedModelConfigError('Connection profile must be enabled');
  }
  for (const [label, value] of [
    ['connectionProfile.id', input.connectionProfile.id],
    ['request.modelName', input.request.modelName],
  ] as const) {
    if (value.length === 0 || value.trim() !== value || value.normalize('NFC') !== value) {
      throw new ResolvedModelConfigError(`${label} must be non-empty canonical text`);
    }
  }
}

function normalizeEndpoint(value: string | null): string | null {
  if (value === null) return null;
  try {
    const parsed = new URL(value);
    if (
      (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') ||
      parsed.username.length > 0 ||
      parsed.password.length > 0 ||
      parsed.search.length > 0 ||
      parsed.hash.length > 0
    ) {
      throw new ResolvedModelConfigError('Provider endpoint is not canonical');
    }
    return parsed.toString();
  } catch (error) {
    if (error instanceof ResolvedModelConfigError) throw error;
    throw new ResolvedModelConfigError('Provider endpoint is invalid');
  }
}

function freezeJson(value: JsonValue): JsonValue {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return Object.freeze(value.map(freezeJson));
  return Object.freeze(
    Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, freezeJson(entry)])),
  );
}

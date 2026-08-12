import { invoke } from '@tauri-apps/api/core';

import {
  FakeAIProvider,
  assertTaskContextBudget,
  validateAIOutput,
  type AIProvider,
  type AITask,
  type ModelInfo,
  type NormalizedAIRequest,
  type NormalizedAIResponse,
  type ProviderConfig,
} from '@ember-tavern/ai-core';
import { aiRequestId, isoTimestamp } from '@ember-tavern/contracts';
import {
  formatOutputRepairPrompt,
  formatTaskPrompt,
  renderStablePromptProfile,
} from '@ember-tavern/prompts';
import { recordContextInspection } from './context-inspector-service.js';
import {
  tauriModelSettingsGateway,
  type ModelProfile,
  type ModelSettingsGateway,
} from './model-settings-service.js';

export interface DesktopAIExecution {
  readonly request: NormalizedAIRequest;
  readonly response: NormalizedAIResponse;
  readonly validatedOutput: unknown;
  readonly selectedProfileId: string;
  readonly selectedProviderId: string;
  readonly selectedPresetKey: string;
  readonly selectedProviderDisplayName: string;
  readonly cachePrefixHash: string;
}

export interface DesktopAIExecuteOptions {
  readonly requestId: string;
  readonly temperature: number;
  readonly maxOutputTokens: number;
  readonly timeoutMs: number;
}

export interface DesktopAIEngine {
  execute(
    task: AITask,
    input: unknown,
    options: DesktopAIExecuteOptions,
  ): Promise<DesktopAIExecution>;
}

interface RuntimeSelection {
  readonly profile: ModelProfile;
  readonly model: ModelInfo;
  readonly providerConfig: ProviderConfig;
}

interface NativeGenerateResponse extends NormalizedAIResponse {
  readonly selectedProfileId: string;
  readonly selectedProviderId: string;
  readonly selectedPresetKey: string;
  readonly selectedProviderDisplayName: string;
}

export class DesktopAIOrchestrator implements DesktopAIEngine {
  public constructor(
    private readonly settings: ModelSettingsGateway,
    private readonly provider: AIProvider,
  ) {}

  public async execute(
    task: AITask,
    input: unknown,
    options: DesktopAIExecuteOptions,
  ): Promise<DesktopAIExecution> {
    let selections: Awaited<ReturnType<typeof resolveSelections>>;
    try {
      selections = await resolveSelections(this.settings);
    } catch (error) {
      throw preserveOrchestrationError(error, 'MODEL_SETTINGS_RESOLUTION_FAILED');
    }
    try {
      assertTaskContextBudget(task, input);
      await recordContextInspection(task, input);
    } catch (error) {
      throw preserveOrchestrationError(error, 'CONTEXT_PREPARATION_FAILED');
    }
    try {
      return await this.executeWithSelection(selections.primary, task, input, options);
    } catch (error) {
      if (selections.fallback === null || !canUseFallback(error)) throw error;
      return this.executeWithSelection(selections.fallback, task, input, options);
    }
  }

  private async executeWithSelection(
    selection: RuntimeSelection,
    task: AITask,
    input: unknown,
    options: DesktopAIExecuteOptions,
  ): Promise<DesktopAIExecution> {
    let prompt: ReturnType<typeof formatTaskPrompt>;
    let cachePrefixHash: string;
    try {
      prompt = formatTaskPrompt(task, input, selection.model.capabilities);
      cachePrefixHash = await sha256(renderStablePromptProfile(prompt.stableProfile));
    } catch (error) {
      throw preserveOrchestrationError(error, 'PROMPT_PREPARATION_FAILED');
    }
    let request: NormalizedAIRequest = {
      requestId: aiRequestId(options.requestId),
      task,
      promptVersion: prompt.promptVersion,
      modelName: selection.model.name,
      messages: prompt.messages,
      responseFormat: prompt.responseFormat,
      temperature: options.temperature,
      maxOutputTokens: options.maxOutputTokens,
      timeoutMs: effectiveTimeoutMs(selection.profile, options.timeoutMs),
    };
    const providerConfig = {
      ...selection.providerConfig,
      options: { ...selection.providerConfig.options, cachePrefixHash },
    };
    let response = await this.provider.generate(request, providerConfig);
    assertResponseIdentity(request, response);
    let validated = validateAIOutput(task, response.content);
    if (!validated.ok) {
      const repair = formatOutputRepairPrompt(
        task,
        input,
        response.content,
        validated.error,
        selection.model.capabilities,
      );
      request = {
        ...request,
        requestId: aiRequestId(`${options.requestId}-repair`),
        messages: repair.messages,
        responseFormat: repair.responseFormat,
      };
      response = await this.provider.generate(request, providerConfig);
      assertResponseIdentity(request, response);
      validated = validateAIOutput(task, response.content);
    }
    if (!validated.ok) {
      throw new DesktopAIOrchestrationError(validationFailureCode(validated.error));
    }
    const native = response as Partial<NativeGenerateResponse>;
    if (
      native.selectedProfileId !== undefined &&
      (native.selectedProfileId !== selection.profile.id ||
        native.selectedProviderId !== selection.profile.providerId ||
        native.selectedPresetKey !== selection.profile.presetKey)
    ) {
      throw new DesktopAIOrchestrationError('MODEL_SELECTION_DRIFT');
    }
    return Object.freeze({
      request,
      response,
      validatedOutput: validated.validatedOutput,
      selectedProfileId: native.selectedProfileId ?? selection.profile.id,
      selectedProviderId: native.selectedProviderId ?? selection.profile.providerId,
      selectedPresetKey: native.selectedPresetKey ?? selection.profile.presetKey,
      selectedProviderDisplayName:
        native.selectedProviderDisplayName ?? selection.profile.providerDisplayName,
      cachePrefixHash,
    });
  }
}

function validationFailureCode(error: {
  readonly code: string;
  readonly issues: readonly {
    readonly path: readonly (string | number)[];
    readonly message: string;
  }[];
}): string {
  if (error.issues.some((issue) => issue.message.startsWith('repeated '))) {
    return 'REPETITION_DETECTED';
  }
  const path = error.issues[0]?.path
    .map(String)
    .join('_')
    .replace(/[^A-Za-z0-9_]/g, '')
    .toUpperCase();
  return path === undefined || path.length === 0
    ? error.code
    : `SCHEMA_${path.slice(0, 40)}_INVALID`;
}

function assertResponseIdentity(
  request: NormalizedAIRequest,
  response: NormalizedAIResponse,
): void {
  if (response.requestId !== request.requestId || response.modelName !== request.modelName) {
    throw new DesktopAIOrchestrationError('PROVIDER_IDENTITY_MISMATCH');
  }
}

class TauriNativeAIProvider implements AIProvider {
  public readonly id = 'tauri-native-ai-runtime';

  public async listModels(): Promise<readonly ModelInfo[]> {
    const selections = await resolveSelections(tauriModelSettingsGateway);
    return [selections.primary.model];
  }

  public async testConnection(): Promise<never> {
    throw new DesktopAIOrchestrationError('USE_PROVIDER_PROBE');
  }

  public async generate(
    request: NormalizedAIRequest,
    config: ProviderConfig,
  ): Promise<NormalizedAIResponse> {
    const cachePrefixHash = config.options['cachePrefixHash'];
    if (typeof cachePrefixHash !== 'string') {
      throw new DesktopAIOrchestrationError('CACHE_PREFIX_INVALID');
    }
    const selectedProfileId = config.options['profileId'];
    if (typeof selectedProfileId !== 'string') {
      throw new DesktopAIOrchestrationError('MODEL_NOT_CONFIGURED');
    }
    try {
      return parseNativeResponse(
        await invoke<unknown>('ai_generate', {
          request: { ...request, selectedProfileId, cachePrefixHash },
        }),
      );
    } catch (error) {
      const code = tauriCommandErrorCode(error);
      throw code === null ? error : new DesktopAIOrchestrationError(code);
    }
  }
}

export const tauriDesktopAIOrchestrator = new DesktopAIOrchestrator(
  tauriModelSettingsGateway,
  new TauriNativeAIProvider(),
);

export function desktopAIEngine(source?: DesktopAIEngine | AIProvider): DesktopAIEngine {
  if (source !== undefined && 'execute' in source) return source;
  const provider = source ?? new FakeAIProvider();
  return new DesktopAIOrchestrator(fakeSettings(provider), provider);
}

export class DesktopAIOrchestrationError extends Error {
  public constructor(public readonly code: string) {
    super('Desktop AI orchestration failed');
    this.name = 'DesktopAIOrchestrationError';
  }
}

function preserveOrchestrationError(
  error: unknown,
  fallbackCode: string,
): DesktopAIOrchestrationError {
  return error instanceof DesktopAIOrchestrationError
    ? error
    : new DesktopAIOrchestrationError(fallbackCode);
}

async function resolveSelections(settings: ModelSettingsGateway): Promise<{
  readonly primary: RuntimeSelection;
  readonly fallback: RuntimeSelection | null;
}> {
  const snapshot = await settings.load();
  const primary = resolveProfile(snapshot.profiles, snapshot.defaultModelProfileId);
  const fallback =
    snapshot.fallbackModelProfileId === null ||
    snapshot.fallbackModelProfileId === snapshot.defaultModelProfileId
      ? null
      : resolveProfile(snapshot.profiles, snapshot.fallbackModelProfileId);
  return { primary, fallback };
}

function resolveProfile(
  profiles: readonly ModelProfile[],
  profileId: string | null,
): RuntimeSelection {
  const profile = profiles.find(({ id }) => id === profileId);
  if (profile?.capabilities === null || profile === undefined) {
    throw new DesktopAIOrchestrationError('MODEL_NOT_CONFIGURED');
  }
  return {
    profile,
    model: {
      name: profile.modelName,
      displayName: profile.modelDisplayName,
      capabilities: {
        ...profile.capabilities,
        checkedAt: isoTimestamp(profile.capabilities.checkedAt),
      },
    },
    providerConfig: {
      id: profile.providerId,
      providerType:
        profile.presetKey === 'ollama' ? 'LOCAL_OPENAI_COMPATIBLE' : 'OPENAI_COMPATIBLE',
      presetKey: profile.presetKey === 'custom' ? 'custom' : 'openai',
      displayName: profile.providerDisplayName,
      baseUrl: profile.baseUrl,
      credentialRef: null,
      options: { profileId: profile.id, presetKey: profile.presetKey },
      enabled: true,
    },
  };
}

function canUseFallback(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || Array.isArray(error)) return false;
  const code = (error as Record<string, unknown>)['code'];
  return (
    code === 'NETWORK_FAILED' ||
    code === 'RATE_LIMITED' ||
    code === 'TIMEOUT' ||
    code === 'PROVIDER_UNAVAILABLE'
  );
}

function fakeSettings(provider: AIProvider): ModelSettingsGateway {
  return {
    async load() {
      const model = (await provider.listModels())[0];
      if (model === undefined) throw new DesktopAIOrchestrationError('MODEL_NOT_FOUND');
      return {
        profiles: [
          {
            id: 'offline-fake-profile',
            providerId: provider.id,
            presetKey: 'custom',
            providerDisplayName: 'Ember Fake',
            baseUrl: 'http://127.0.0.1/',
            endpointFingerprint: null,
            hasCredential: false,
            modelName: model.name,
            modelDisplayName: model.displayName,
            capabilities: model.capabilities,
            capabilitySource: 'UNKNOWN',
            probeFingerprint: null,
          },
        ],
        defaultModelProfileId: 'offline-fake-profile',
        fallbackModelProfileId: null,
        pendingCredentialCleanupCount: 0,
      };
    },
    async save() {
      throw new DesktopAIOrchestrationError('TEST_SETTINGS_READ_ONLY');
    },
    async forgetCredential() {
      throw new DesktopAIOrchestrationError('TEST_SETTINGS_READ_ONLY');
    },
    async saveSecret() {
      throw new DesktopAIOrchestrationError('TEST_SETTINGS_READ_ONLY');
    },
    async deleteSecret() {
      throw new DesktopAIOrchestrationError('TEST_SETTINGS_READ_ONLY');
    },
    async probe() {
      throw new DesktopAIOrchestrationError('TEST_SETTINGS_READ_ONLY');
    },
  };
}

function parseNativeResponse(value: unknown): NativeGenerateResponse {
  const record = requireRecord(value);
  const usage = requireRecord(record['usage']);
  const finishReason = requireText(record['finishReason']);
  if (
    !['STOP', 'LENGTH', 'CONTENT_FILTER', 'TOOL_CALL', 'ERROR', 'UNKNOWN'].includes(finishReason)
  ) {
    throw new TypeError('AI finish reason is invalid');
  }
  return Object.freeze({
    requestId: aiRequestId(requireText(record['requestId'])),
    providerRequestId: optionalText(record['providerRequestId']),
    modelName: requireText(record['modelName']),
    content: requireText(record['content']),
    finishReason: finishReason as NativeGenerateResponse['finishReason'],
    usage: Object.freeze({
      inputTokens: optionalNonNegativeInteger(usage['inputTokens']),
      outputTokens: optionalNonNegativeInteger(usage['outputTokens']),
      totalTokens: optionalNonNegativeInteger(usage['totalTokens']),
      promptCacheHitTokens: optionalNonNegativeInteger(usage['promptCacheHitTokens']),
      promptCacheMissTokens: optionalNonNegativeInteger(usage['promptCacheMissTokens']),
    }),
    receivedAt: canonicalRuntimeTimestamp(record['receivedAt']),
    selectedProfileId: requireText(record['selectedProfileId']),
    selectedProviderId: requireText(record['selectedProviderId']),
    selectedPresetKey: requireText(record['selectedPresetKey']),
    selectedProviderDisplayName: requireText(record['selectedProviderDisplayName']),
  });
}

export function canonicalRuntimeTimestamp(value: unknown): ReturnType<typeof isoTimestamp> {
  const parsed = new Date(requireText(value));
  if (Number.isNaN(parsed.getTime())) throw new TypeError('AI response timestamp is invalid');
  return isoTimestamp(parsed.toISOString());
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function effectiveTimeoutMs(profile: ModelProfile, requested: number): number {
  const minimum = profile.presetKey === 'ollama' ? 30_000 : 60_000;
  return Math.max(requested, minimum);
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('AI response is invalid');
  }
  return value as Record<string, unknown>;
}

function requireText(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4 * 1024 * 1024) {
    throw new TypeError('AI response text is invalid');
  }
  return value;
}

function optionalText(value: unknown): string | null {
  return value === null ? null : requireText(value);
}

function optionalNonNegativeInteger(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeError('AI usage is invalid');
  }
  return value as number;
}

function tauriCommandErrorCode(error: unknown): string | null {
  if (typeof error === 'string') {
    try {
      return tauriCommandErrorCode(JSON.parse(error) as unknown);
    } catch {
      return null;
    }
  }
  if (typeof error !== 'object' || error === null || Array.isArray(error)) return null;
  const code = (error as Record<string, unknown>)['code'];
  return typeof code === 'string' && /^[A-Z0-9_]{2,64}$/.test(code) ? code : null;
}

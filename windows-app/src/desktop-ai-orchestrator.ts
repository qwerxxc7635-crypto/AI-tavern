import { Channel, invoke } from '@tauri-apps/api/core';

import {
  FakeAIProvider,
  GenerateWorldOutputSchema,
  GeneratorRunner,
  NOOP_GENERATOR_TRANSACTION,
  buildUnifiedTaskContext,
  classifyApplicationError,
  validateAIOutput,
  type AIProvider,
  type AIRequestOptions,
  type AIStreamChunk,
  type AITask,
  type Generator,
  type GeneratorAuditEntry,
  type ContextAssembly,
  type ModelInfo,
  type NormalizedAIRequest,
  type NormalizedAIResponse,
  type ProviderConfig,
  RefineWorldOutputSchema,
} from '@ember-tavern/ai-core';
import { aiRequestId, isoTimestamp } from '@ember-tavern/contracts';
import { assertWorldConstitutionCompliance } from '@ember-tavern/domain';
import {
  formatOutputRepairPrompt,
  formatTaskPrompt,
  renderStablePromptProfile,
  stableWorldTruthsFromContext,
  type ResolvedPromptPreset,
} from '@ember-tavern/prompts';
import { recordContextAssemblyInspection } from './context-inspector-service.js';
import { recordAIInspectionFailure, recordAIInspectionSuccess } from './ai-inspector-service.js';
import {
  tauriModelSettingsGateway,
  type ModelProfile,
  type ModelSettingsGateway,
} from './model-settings-service.js';
import {
  defaultPromptProfileSource,
  tauriPromptProfileSource,
  type PromptProfileSource,
} from './prompt-manager-service.js';

export interface DesktopAIExecution {
  readonly request: NormalizedAIRequest;
  readonly response: NormalizedAIResponse;
  readonly validatedOutput: unknown;
  readonly selectedProfileId: string;
  readonly selectedProviderId: string;
  readonly selectedPresetKey: string;
  readonly selectedProviderDisplayName: string;
  readonly cachePrefixHash: string;
  readonly lifecycle: readonly GeneratorAuditEntry[];
}

export interface DesktopAIExecuteOptions {
  readonly requestId: string;
  readonly temperature: number;
  readonly maxOutputTokens: number;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
  readonly stream?: DesktopAIStreamControl;
}

export interface DesktopAIStreamControl {
  readonly signal: AbortSignal;
  readonly onChunk: (chunk: AIStreamChunk) => void;
  readonly onReset?: () => void;
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
  private readonly settings: ModelSettingsGateway;
  private readonly provider: AIProvider;
  private readonly promptProfiles: PromptProfileSource;

  public constructor(
    settings: ModelSettingsGateway,
    provider: AIProvider,
    promptProfiles: PromptProfileSource = defaultPromptProfileSource,
  ) {
    this.settings = settings;
    this.provider = provider;
    this.promptProfiles = promptProfiles;
  }

  public async execute(
    task: AITask,
    input: unknown,
    options: DesktopAIExecuteOptions,
  ): Promise<DesktopAIExecution> {
    let streamed = false;
    const executionOptions: DesktopAIExecuteOptions =
      options.stream === undefined
        ? options
        : {
            ...options,
            stream: {
              signal: options.stream.signal,
              onChunk(chunk) {
                streamed = true;
                options.stream?.onChunk(chunk);
              },
              onReset() {
                options.stream?.onReset?.();
              },
            },
          };
    let contextInput: unknown;
    let contextAssembly: ContextAssembly;
    try {
      const prepared = await buildUnifiedTaskContext(task, input, {
        sourceId: `windows:${task}`,
        sourceRevision: 1,
      });
      contextInput = prepared.content;
      contextAssembly = prepared.assembly;
      recordContextAssemblyInspection(task, prepared.assembly);
    } catch (error) {
      throw preserveOrchestrationError(error, 'CONTEXT_PREPARATION_FAILED');
    }
    let selections: Awaited<ReturnType<typeof resolveSelections>>;
    let userPreset: ResolvedPromptPreset | null;
    try {
      [selections, userPreset] = await Promise.all([
        resolveSelections(this.settings).catch((error: unknown) => {
          throw preserveOrchestrationError(error, 'MODEL_SETTINGS_RESOLUTION_FAILED');
        }),
        this.promptProfiles.resolve(task).catch((error: unknown) => {
          throw preserveOrchestrationError(error, 'PROMPT_MANAGER_RESOLUTION_FAILED');
        }),
      ]);
    } catch (error) {
      throw preserveOrchestrationError(error, 'RUNTIME_PROFILE_RESOLUTION_FAILED');
    }
    try {
      return await this.executeWithSelection(
        selections.primary,
        task,
        contextInput,
        contextAssembly,
        executionOptions,
        userPreset,
      );
    } catch (error) {
      if (selections.fallback === null || streamed || !canUseFallback(error)) throw error;
      return this.executeWithSelection(
        selections.fallback,
        task,
        contextInput,
        contextAssembly,
        executionOptions,
        userPreset,
      );
    }
  }

  private async executeWithSelection(
    selection: RuntimeSelection,
    task: AITask,
    input: unknown,
    contextAssembly: ContextAssembly,
    options: DesktopAIExecuteOptions,
    userPreset: ResolvedPromptPreset | null,
  ): Promise<DesktopAIExecution> {
    const startedAt = Date.now();
    const lifecycle: GeneratorAuditEntry[] = [];
    const generator = new DesktopStructuredGenerator(this.provider);
    try {
      const result = await new GeneratorRunner({
        transaction: NOOP_GENERATOR_TRANSACTION,
        observe(entry) {
          lifecycle.push(entry);
        },
      }).run(
        generator,
        { selection, task, input, contextAssembly, options, userPreset },
        { executionId: options.requestId, idempotencyKey: options.requestId },
      );
      const execution = Object.freeze({ ...result.value, lifecycle: result.audit });
      await recordAIInspectionSuccess({
        task,
        providerId: execution.selectedProviderId,
        providerDisplayName: execution.selectedProviderDisplayName,
        request: execution.request,
        response: execution.response,
        parsed: execution.validatedOutput,
        cachePrefixHash: execution.cachePrefixHash,
        latencyMs: Date.now() - startedAt,
        lifecycle: result.audit,
      });
      return execution;
    } catch (error) {
      const validation = findValidationFailure(error);
      const inspection = generator.inspectionState();
      await recordAIInspectionFailure({
        task,
        providerId: selection.profile.providerId,
        providerDisplayName: selection.profile.providerDisplayName,
        model: selection.model.name,
        ...(inspection.request === null ? {} : { request: inspection.request }),
        ...(inspection.raw === null ? {} : { raw: inspection.raw }),
        latencyMs: Date.now() - startedAt,
        errorCode: errorCodeForInspection(error),
        ...(validation === null ? {} : { validation: validation.validation }),
        lifecycle,
      });
      throw error;
    }
  }
}

interface DesktopGeneratorInput {
  readonly selection: RuntimeSelection;
  readonly task: AITask;
  readonly input: unknown;
  readonly contextAssembly: ContextAssembly;
  readonly options: DesktopAIExecuteOptions;
  readonly userPreset: ResolvedPromptPreset | null;
}

interface DesktopPreparedPrompt extends DesktopGeneratorInput {
  readonly request: NormalizedAIRequest;
  readonly providerConfig: ProviderConfig;
  readonly cachePrefixHash: string;
}

interface DesktopRawGeneration {
  readonly prepared: DesktopPreparedPrompt;
  readonly request: NormalizedAIRequest;
  readonly response: NormalizedAIResponse;
}

interface DesktopValidatedGeneration extends DesktopRawGeneration {
  readonly validatedOutput: unknown;
}

class DesktopStructuredGenerator implements Generator<
  DesktopGeneratorInput,
  DesktopGeneratorInput,
  DesktopPreparedPrompt,
  DesktopRawGeneration,
  DesktopRawGeneration,
  DesktopValidatedGeneration,
  DesktopValidatedGeneration,
  Omit<DesktopAIExecution, 'lifecycle'>,
  never
> {
  private readonly provider: AIProvider;
  private lastRequest: NormalizedAIRequest | null = null;
  private lastRaw: string | null = null;

  public constructor(provider: AIProvider) {
    this.provider = provider;
  }

  public inspectionState(): Readonly<{
    request: NormalizedAIRequest | null;
    raw: string | null;
  }> {
    return Object.freeze({ request: this.lastRequest, raw: this.lastRaw });
  }

  public buildContext(input: DesktopGeneratorInput) {
    return input;
  }

  public async buildPrompt(context: DesktopGeneratorInput): Promise<DesktopPreparedPrompt> {
    let prompt: ReturnType<typeof formatTaskPrompt>;
    let cachePrefixHash: string;
    try {
      prompt = formatTaskPrompt(context.task, context.input, context.selection.model.capabilities, {
        stableWorldTruths: stableWorldTruthsFromContext(context.contextAssembly),
        userPreset: context.userPreset,
      });
      cachePrefixHash = await sha256(renderStablePromptProfile(prompt.stableProfile));
    } catch (error) {
      throw preserveOrchestrationError(error, 'PROMPT_PREPARATION_FAILED');
    }
    const request: NormalizedAIRequest = {
      requestId: aiRequestId(context.options.requestId),
      task: context.task,
      promptVersion: prompt.promptVersion,
      modelName: context.selection.model.name,
      messages: prompt.messages,
      responseFormat: prompt.responseFormat,
      temperature: context.options.temperature,
      maxOutputTokens: context.options.maxOutputTokens,
      timeoutMs: effectiveTimeoutMs(context.selection.profile, context.options.timeoutMs),
    };
    this.lastRequest = request;
    return Object.freeze({
      ...context,
      request,
      cachePrefixHash,
      providerConfig: Object.freeze({
        ...context.selection.providerConfig,
        options: { ...context.selection.providerConfig.options, cachePrefixHash },
      }),
    });
  }

  public async generate(prepared: DesktopPreparedPrompt): Promise<DesktopRawGeneration> {
    const stream = prepared.options.stream;
    const signal = stream?.signal ?? prepared.options.signal;
    let expectedSequence = 1;
    let streamedContent = '';
    const generateStream = this.provider.generateStream?.bind(this.provider);
    const useStream = stream !== undefined && prepared.selection.model.capabilities.streaming;
    const response =
      useStream && generateStream !== undefined
        ? await generateStream(prepared.request, prepared.providerConfig, {
            signal: stream.signal,
            onChunk(chunk) {
              if (chunk.sequence !== expectedSequence || chunk.content.length === 0) {
                throw new DesktopAIOrchestrationError('STREAM_ORDER_INVALID');
              }
              expectedSequence += 1;
              streamedContent += chunk.content;
              if (streamedContent.length > 4 * 1024 * 1024) {
                throw new DesktopAIOrchestrationError('STREAM_LIMIT_EXCEEDED');
              }
              stream.onChunk(chunk);
            },
          })
        : await this.provider.generate(
            prepared.request,
            prepared.providerConfig,
            signal === undefined ? undefined : { signal },
          );
    if (useStream && generateStream !== undefined && response.content !== streamedContent) {
      throw new DesktopAIOrchestrationError('STREAM_FINAL_MISMATCH');
    }
    this.lastRaw = response.content;
    return Object.freeze({ prepared, request: prepared.request, response });
  }

  public parse(raw: DesktopRawGeneration): DesktopRawGeneration {
    assertResponseIdentity(raw.request, raw.response);
    return raw;
  }

  public validate(parsed: DesktopRawGeneration): DesktopValidatedGeneration {
    const attempt =
      parsed.request.requestId === parsed.prepared.request.requestId ? 'INITIAL' : 'REPAIR';
    if (parsed.response.finishReason === 'LENGTH') {
      throw new DesktopOutputValidationError(
        'RESPONSE_TRUNCATED',
        Object.freeze({
          code: 'RESPONSE_TRUNCATED',
          issues: Object.freeze([
            Object.freeze({
              path: Object.freeze([]),
              code: 'response_truncated',
              message: 'Provider stopped because the output token limit was reached',
            }),
          ]),
        }),
        parsed.response.content,
        attempt,
      );
    }
    if (parsed.response.finishReason === 'CONTENT_FILTER') {
      throw new DesktopAIOrchestrationError('CONTENT_FILTERED');
    }
    if (parsed.response.finishReason !== 'STOP') {
      throw new DesktopAIOrchestrationError('PROVIDER_RESPONSE_INCOMPLETE');
    }
    const validated = validateAIOutput(parsed.prepared.task, parsed.response.content);
    if (!validated.ok) {
      throw new DesktopOutputValidationError(
        validationFailureCode(validated.error),
        validated.error,
        parsed.response.content,
        attempt,
      );
    }
    return Object.freeze({ ...parsed, validatedOutput: validated.validatedOutput });
  }

  public async repair({
    failedStage,
    raw,
    error,
  }: {
    readonly failedStage: 'PARSE' | 'VALIDATE';
    readonly raw: DesktopRawGeneration;
    readonly error: unknown;
  }): Promise<DesktopRawGeneration | null> {
    if (failedStage !== 'VALIDATE' || !(error instanceof DesktopOutputValidationError)) return null;
    const prepared = raw.prepared;
    prepared.options.stream?.onReset?.();
    const repair = formatOutputRepairPrompt(
      prepared.task,
      prepared.input,
      raw.response.content,
      error.validation,
      prepared.selection.model.capabilities,
      {
        stableWorldTruths: stableWorldTruthsFromContext(prepared.contextAssembly),
        userPreset: prepared.userPreset,
      },
    );
    const request: NormalizedAIRequest = {
      ...raw.request,
      requestId: aiRequestId(`${prepared.options.requestId}-repair`),
      messages: repair.messages,
      responseFormat: repair.responseFormat,
    };
    this.lastRequest = request;
    const signal = prepared.options.stream?.signal ?? prepared.options.signal;
    let response: NormalizedAIResponse;
    try {
      response = await this.provider.generate(
        request,
        prepared.providerConfig,
        signal === undefined ? undefined : { signal },
      );
    } catch (repairError) {
      throw new DesktopAIOrchestrationError(errorCodeForInspection(repairError), error);
    }
    this.lastRaw = response.content;
    return Object.freeze({ prepared, request, response });
  }

  public rulesCheck(validated: DesktopValidatedGeneration): DesktopValidatedGeneration {
    const native = validated.response as Partial<NativeGenerateResponse>;
    const selection = validated.prepared.selection;
    if (
      native.selectedProfileId !== undefined &&
      (native.selectedProfileId !== selection.profile.id ||
        native.selectedProviderId !== selection.profile.providerId ||
        native.selectedPresetKey !== selection.profile.presetKey)
    ) {
      throw new DesktopAIOrchestrationError('MODEL_SELECTION_DRIFT');
    }
    try {
      const world =
        validated.prepared.task === 'GENERATE_WORLD'
          ? GenerateWorldOutputSchema.parse(validated.validatedOutput)
          : validated.prepared.task === 'REFINE_WORLD'
            ? RefineWorldOutputSchema.parse(validated.validatedOutput).world
            : null;
      if (world !== null) {
        assertWorldConstitutionCompliance(world.constitution, world);
      }
    } catch (error) {
      throw new DesktopAIOrchestrationError('WORLD_BUSINESS_RULE_INVALID', error);
    }
    return validated;
  }

  public persist(checked: DesktopValidatedGeneration) {
    const native = checked.response as Partial<NativeGenerateResponse>;
    const selection = checked.prepared.selection;
    return Object.freeze({
      status: 'COMMITTED' as const,
      value: Object.freeze({
        request: checked.request,
        response: checked.response,
        validatedOutput: checked.validatedOutput,
        selectedProfileId: native.selectedProfileId ?? selection.profile.id,
        selectedProviderId: native.selectedProviderId ?? selection.profile.providerId,
        selectedPresetKey: native.selectedPresetKey ?? selection.profile.presetKey,
        selectedProviderDisplayName:
          native.selectedProviderDisplayName ?? selection.profile.providerDisplayName,
        cachePrefixHash: checked.prepared.cachePrefixHash,
      }),
    });
  }

  public emitEvents(): readonly never[] {
    return Object.freeze([]);
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
    options?: AIRequestOptions,
  ): Promise<NormalizedAIResponse> {
    const { selectedProfileId, cachePrefixHash } = nativeGenerationOptions(config);
    const signal = options?.signal;
    if (isAborted(signal)) throw new DesktopAIOrchestrationError('CANCELLED');
    const cancel = () => {
      void invoke('ai_stream_cancel', { requestId: request.requestId });
    };
    signal?.addEventListener('abort', cancel, { once: true });
    try {
      const response = parseNativeResponse(
        await invoke<unknown>('ai_generate', {
          request: { ...request, selectedProfileId, cachePrefixHash },
        }),
      );
      if (isAborted(signal)) throw new DesktopAIOrchestrationError('CANCELLED');
      return response;
    } catch (error) {
      if (isAborted(signal)) throw new DesktopAIOrchestrationError('CANCELLED');
      const code = tauriCommandErrorCode(error);
      throw code === null ? error : new DesktopAIOrchestrationError(code);
    } finally {
      signal?.removeEventListener('abort', cancel);
    }
  }

  public async generateStream(
    request: NormalizedAIRequest,
    config: ProviderConfig,
    options: DesktopAIStreamControl,
  ): Promise<NormalizedAIResponse> {
    const { selectedProfileId, cachePrefixHash } = nativeGenerationOptions(config);
    if (options.signal.aborted) throw new DesktopAIOrchestrationError('CANCELLED');
    let expectedSequence = 1;
    let streamedContent = '';
    let streamError: DesktopAIOrchestrationError | null = null;
    const channel = new Channel<unknown>();
    channel.onmessage = (value) => {
      if (streamError !== null || options.signal.aborted) return;
      try {
        const event = parseNativeStreamEvent(value);
        if (event.requestId !== request.requestId || event.sequence !== expectedSequence) {
          throw new DesktopAIOrchestrationError('STREAM_ORDER_INVALID');
        }
        expectedSequence += 1;
        streamedContent += event.content;
        if (streamedContent.length > 4 * 1024 * 1024) {
          throw new DesktopAIOrchestrationError('STREAM_LIMIT_EXCEEDED');
        }
        options.onChunk(event);
      } catch (error) {
        streamError = preserveOrchestrationError(error, 'STREAM_CHUNK_INVALID');
        void invoke('ai_stream_cancel', { requestId: request.requestId });
      }
    };
    const cancel = () => {
      void invoke('ai_stream_cancel', { requestId: request.requestId });
    };
    options.signal.addEventListener('abort', cancel, { once: true });
    try {
      const response = await invoke<unknown>('ai_generate_stream', {
        request: { ...request, selectedProfileId, cachePrefixHash },
        onEvent: channel,
      });
      if (options.signal.aborted) throw new DesktopAIOrchestrationError('CANCELLED');
      if (streamError !== null) throw streamError;
      const parsed = parseNativeResponse(response);
      if (parsed.content !== streamedContent) {
        throw new DesktopAIOrchestrationError('STREAM_FINAL_MISMATCH');
      }
      return parsed;
    } catch (error) {
      if (streamError !== null) throw streamError;
      if (options.signal.aborted) throw new DesktopAIOrchestrationError('CANCELLED');
      const code = tauriCommandErrorCode(error);
      throw code === null ? error : new DesktopAIOrchestrationError(code);
    } finally {
      options.signal.removeEventListener('abort', cancel);
    }
  }
}

function nativeGenerationOptions(config: ProviderConfig): {
  readonly selectedProfileId: string;
  readonly cachePrefixHash: string;
} {
  const cachePrefixHash = config.options['cachePrefixHash'];
  if (typeof cachePrefixHash !== 'string') {
    throw new DesktopAIOrchestrationError('CACHE_PREFIX_INVALID');
  }
  const selectedProfileId = config.options['profileId'];
  if (typeof selectedProfileId !== 'string') {
    throw new DesktopAIOrchestrationError('MODEL_NOT_CONFIGURED');
  }
  return { selectedProfileId, cachePrefixHash };
}

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

function parseNativeStreamEvent(value: unknown): AIStreamChunk & { readonly requestId: string } {
  const record = requireRecord(value);
  const sequence = record['sequence'];
  if (!Number.isSafeInteger(sequence) || (sequence as number) < 1) {
    throw new TypeError('AI stream sequence is invalid');
  }
  return Object.freeze({
    requestId: requireText(record['requestId']),
    sequence: sequence as number,
    content: requireText(record['content']),
  });
}

export const tauriDesktopAIOrchestrator = new DesktopAIOrchestrator(
  tauriModelSettingsGateway,
  new TauriNativeAIProvider(),
  tauriPromptProfileSource,
);

export function desktopAIEngine(source?: DesktopAIEngine | AIProvider): DesktopAIEngine {
  if (source !== undefined && 'execute' in source) return source;
  const provider = source ?? new FakeAIProvider();
  return new DesktopAIOrchestrator(fakeSettings(provider), provider);
}

export class DesktopAIOrchestrationError extends Error {
  public readonly code: string;

  public constructor(code: string, cause?: unknown) {
    super('Desktop AI orchestration failed', { cause });
    this.name = 'DesktopAIOrchestrationError';
    this.code = code;
  }
}

class DesktopOutputValidationError extends DesktopAIOrchestrationError {
  public readonly validation: Parameters<typeof formatOutputRepairPrompt>[3];
  public readonly raw: string;
  public readonly attempt: 'INITIAL' | 'REPAIR';

  public constructor(
    code: string,
    validation: Parameters<typeof formatOutputRepairPrompt>[3],
    raw: string,
    attempt: 'INITIAL' | 'REPAIR',
  ) {
    super(code);
    this.name = 'DesktopOutputValidationError';
    this.validation = validation;
    this.raw = raw;
    this.attempt = attempt;
  }
}

function findValidationFailure(error: unknown): DesktopOutputValidationError | null {
  let current: unknown = error;
  for (let depth = 0; depth < 8; depth += 1) {
    if (current instanceof DesktopOutputValidationError) return current;
    if (typeof current !== 'object' || current === null || !('cause' in current)) return null;
    current = current.cause;
  }
  return null;
}

function errorCodeForInspection(error: unknown): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
  ) {
    return error.code;
  }
  return classifyApplicationError(error).code;
}

function preserveOrchestrationError(
  error: unknown,
  fallbackCode: string,
): DesktopAIOrchestrationError {
  return error instanceof DesktopAIOrchestrationError
    ? error
    : new DesktopAIOrchestrationError(fallbackCode, error);
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
  return classifyApplicationError(error).fallbackEligible;
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

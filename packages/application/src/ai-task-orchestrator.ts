import {
  assembleTaskContext,
  contextBudgetForTask,
  createContextBlock,
  providerConfigFromResolved,
  resolveModelConfig,
  standardizeAIError,
  verifyResolvedModelConfig,
  type AIProvider,
  type AITask,
  type ContextAssembly,
  type ModelCapabilities,
  type NormalizedAIRequest,
  type NormalizedAIResponse,
  type NormalizedTokenUsage,
  type ProviderConfig,
  type ResolvedModelConfig,
  type StandardAIErrorCode,
} from '@ember-tavern/ai-core';
import {
  aiOperationId,
  type AiOperationId,
  type AiRequestId,
  type CampaignId,
  type JsonValue,
  type ModelProfileId,
} from '@ember-tavern/contracts';

export const AI_ROUTE_KINDS = ['PRIMARY', 'RETRY', 'FALLBACK', 'REPAIR'] as const;
export type AIRouteKind = (typeof AI_ROUTE_KINDS)[number];

export const AI_ERROR_CATEGORIES = [
  'configuration',
  'credential',
  'capability',
  'network_policy',
  'timeout',
  'provider',
  'schema',
  'domain_policy',
  'stale_revision',
  'cancelled',
] as const;
export type AIErrorCategory = (typeof AI_ERROR_CATEGORIES)[number];

export interface AIExecutionRoute {
  readonly kind: AIRouteKind;
  readonly attempt: number;
  readonly providerId: string;
  readonly modelProfileId: ModelProfileId | null;
  readonly modelName: string;
}

export interface AITaskRequest {
  readonly operationId: AiOperationId;
  readonly requestId: AiRequestId;
  readonly taskType: AITask;
  readonly campaignId: CampaignId;
  readonly actorId: string | null;
  readonly contextAssembly: ContextAssembly;
  readonly resolvedModelConfig: ResolvedModelConfig;
  readonly route: AIExecutionRoute;
  readonly providerRequest: NormalizedAIRequest;
}

export interface AITaskResult {
  readonly status: 'SUCCEEDED';
  readonly operationId: AiOperationId;
  readonly requestId: AiRequestId;
  readonly taskType: AITask;
  readonly contextManifest: ContextAssembly['manifest'];
  readonly resolvedModelFingerprint: string;
  readonly route: AIExecutionRoute;
  readonly usage: NormalizedTokenUsage;
  readonly response: NormalizedAIResponse;
}

export class AITaskExecutionError extends Error {
  public constructor(
    public readonly operationId: AiOperationId,
    public readonly requestId: AiRequestId,
    public readonly category: AIErrorCategory,
    public readonly code: string,
    public readonly retryable: boolean,
    options?: ErrorOptions,
  ) {
    super(`AI task failed: ${category}/${code}`, options);
    this.name = 'AITaskExecutionError';
  }
}

export class AITaskOrchestrator {
  public constructor(
    private readonly provider: AIProvider,
    private readonly providerConfig: ProviderConfig,
  ) {}

  public async execute(request: AITaskRequest): Promise<AITaskResult> {
    await validateTaskRequest(request, this.providerConfig);
    try {
      const response = await this.provider.generate(
        request.providerRequest,
        providerConfigFromResolved(request.resolvedModelConfig),
      );
      if (
        response.requestId !== request.requestId ||
        response.modelName !== request.route.modelName
      ) {
        throw Object.freeze({ code: 'PROVIDER_RESPONSE_MISMATCH' });
      }
      return Object.freeze({
        status: 'SUCCEEDED',
        operationId: request.operationId,
        requestId: request.requestId,
        taskType: request.taskType,
        contextManifest: request.contextAssembly.manifest,
        resolvedModelFingerprint: request.resolvedModelConfig.fingerprint,
        route: Object.freeze({ ...request.route }),
        usage: normalizeUsage(response.usage),
        response,
      });
    } catch (error) {
      if (error instanceof AITaskExecutionError) throw error;
      const classification = classifyAIOrchestrationError(error);
      throw new AITaskExecutionError(
        request.operationId,
        request.requestId,
        classification.category,
        classification.code,
        classification.retryable,
        { cause: error },
      );
    }
  }
}

export async function executePrimaryAITask(
  provider: AIProvider,
  providerConfig: ProviderConfig,
  campaignId: CampaignId,
  request: NormalizedAIRequest,
  context: JsonValue,
  modelProfileId: ModelProfileId | null,
  capabilities: ModelCapabilities,
): Promise<NormalizedAIResponse> {
  const prepared = await assembleTaskContext(
    request.task,
    request.requestId,
    1,
    context,
    contextBudgetForTask(request.task).maxCharacters,
  );
  const resolvedModelConfig = await resolveModelConfig({
    connectionProfile: providerConfig,
    modelProfileId,
    capabilities,
    request,
  });
  const result = await new AITaskOrchestrator(provider, providerConfig).execute({
    operationId: aiOperationId(`operation:${request.requestId}`),
    requestId: request.requestId,
    taskType: request.task,
    campaignId,
    actorId: null,
    contextAssembly: prepared.assembly,
    resolvedModelConfig,
    route: Object.freeze({
      kind: 'PRIMARY',
      attempt: 1,
      providerId: providerConfig.id,
      modelProfileId: null,
      modelName: request.modelName,
    }),
    providerRequest: request,
  });
  return result.response;
}

export function classifyAIOrchestrationError(error: unknown): Readonly<{
  category: AIErrorCategory;
  code: string;
  retryable: boolean;
}> {
  const code = readCode(error);
  if (code === 'CANCELLED' || readName(error) === 'AbortError') {
    return Object.freeze({ category: 'cancelled', code: 'CANCELLED', retryable: true });
  }
  if (code === 'STALE_REVISION') {
    return Object.freeze({ category: 'stale_revision', code, retryable: false });
  }
  if (code?.startsWith('DOMAIN_') === true) {
    return Object.freeze({ category: 'domain_policy', code, retryable: false });
  }
  if (code?.startsWith('NETWORK_POLICY_') === true) {
    return Object.freeze({ category: 'network_policy', code, retryable: false });
  }
  if (code === 'NO_MODEL_CANDIDATE' || code === 'MODEL_PROFILE_MISSING') {
    return Object.freeze({ category: 'capability', code, retryable: false });
  }
  if (code?.startsWith('CONFIGURATION_') === true) {
    return Object.freeze({ category: 'configuration', code, retryable: false });
  }
  if (code === 'PROVIDER_RESPONSE_MISMATCH') {
    return Object.freeze({ category: 'provider', code, retryable: false });
  }
  const standardized = standardizeAIError(error);
  return Object.freeze({
    category: standardCategory(standardized.code),
    code: standardized.code,
    retryable: standardized.retryable,
  });
}

async function validateTaskRequest(request: AITaskRequest, config: ProviderConfig): Promise<void> {
  const route = request.route;
  const includedEntries = request.contextAssembly.manifest.entries.filter(
    ({ included }) => included,
  );
  const resolved = request.resolvedModelConfig;
  if (
    request.providerRequest.requestId !== request.requestId ||
    request.providerRequest.task !== request.taskType ||
    route.providerId !== config.id ||
    route.modelName !== request.providerRequest.modelName ||
    request.contextAssembly.blocks.length === 0 ||
    includedEntries.length !== request.contextAssembly.blocks.length ||
    request.contextAssembly.manifest.estimatedTokens !==
      includedEntries.reduce((total, entry) => total + entry.estimatedTokens, 0) ||
    request.contextAssembly.manifest.estimatedTokens > request.contextAssembly.manifest.maxTokens ||
    !Number.isSafeInteger(route.attempt) ||
    route.attempt < 1 ||
    (route.kind === 'PRIMARY' && route.attempt !== 1) ||
    (route.kind === 'RETRY' && route.attempt < 2)
  ) {
    throw new AITaskExecutionError(
      request.operationId,
      request.requestId,
      'configuration',
      'CONFIGURATION_ROUTE_INVALID',
      false,
    );
  }
  if (
    !(await verifyResolvedModelConfig(resolved)) ||
    resolved.connectionProfileId !== config.id ||
    resolved.providerType !== config.providerType ||
    resolved.presetKey !== config.presetKey ||
    resolved.modelProfileId !== route.modelProfileId ||
    resolved.modelName !== route.modelName ||
    resolved.generation.temperature !== request.providerRequest.temperature ||
    resolved.generation.maxOutputTokens !== request.providerRequest.maxOutputTokens ||
    resolved.generation.timeoutMs !== request.providerRequest.timeoutMs ||
    resolved.promptProfile.task !== request.taskType ||
    resolved.promptProfile.promptVersion !== request.providerRequest.promptVersion ||
    resolved.promptProfile.responseFormat !== request.providerRequest.responseFormat.kind ||
    resolved.promptProfile.responseSchemaName !==
      (request.providerRequest.responseFormat.kind === 'JSON_SCHEMA'
        ? request.providerRequest.responseFormat.name
        : null)
  ) {
    throw new AITaskExecutionError(
      request.operationId,
      request.requestId,
      'configuration',
      'CONFIGURATION_RESOLVED_MODEL_INVALID',
      false,
    );
  }
  for (const [index, block] of request.contextAssembly.blocks.entries()) {
    const entry = includedEntries[index];
    const recalculated = await createContextBlock(block);
    if (
      entry === undefined ||
      entry.blockId !== block.id ||
      entry.sourceId !== block.sourceId ||
      entry.sourceRevision !== block.sourceRevision ||
      entry.stability !== block.stability ||
      entry.version !== block.version ||
      entry.contentHash !== block.contentHash ||
      recalculated.contentHash !== block.contentHash
    ) {
      throw new AITaskExecutionError(
        request.operationId,
        request.requestId,
        'configuration',
        'CONFIGURATION_CONTEXT_INVALID',
        false,
      );
    }
  }
}

function normalizeUsage(usage: NormalizedTokenUsage): NormalizedTokenUsage {
  for (const value of [usage.inputTokens, usage.outputTokens, usage.totalTokens]) {
    if (value !== null && (!Number.isSafeInteger(value) || value < 0)) {
      throw Object.freeze({ code: 'PROVIDER_RESPONSE_MISMATCH' });
    }
  }
  if (
    usage.inputTokens !== null &&
    usage.outputTokens !== null &&
    usage.totalTokens !== null &&
    usage.inputTokens + usage.outputTokens !== usage.totalTokens
  ) {
    throw Object.freeze({ code: 'PROVIDER_RESPONSE_MISMATCH' });
  }
  return Object.freeze({ ...usage });
}

function standardCategory(code: StandardAIErrorCode): AIErrorCategory {
  switch (code) {
    case 'AUTHENTICATION_FAILED':
      return 'credential';
    case 'TIMEOUT':
      return 'timeout';
    case 'NETWORK_FAILED':
      return 'provider';
    case 'INVALID_OUTPUT':
      return 'schema';
    case 'MODEL_NOT_FOUND':
      return 'capability';
    case 'QUOTA_EXCEEDED':
    case 'RATE_LIMITED':
    case 'UNKNOWN':
      return 'provider';
  }
}

function readCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null || Array.isArray(error)) return null;
  const value = (error as Readonly<Record<string, unknown>>)['code'];
  return typeof value === 'string' ? value : null;
}

function readName(error: unknown): string | null {
  if (typeof error !== 'object' || error === null || Array.isArray(error)) return null;
  const value = (error as Readonly<Record<string, unknown>>)['name'];
  return typeof value === 'string' ? value : null;
}

import {
  StandardAIError,
  createContextBlock,
  resolveModelConfig,
  type AIProvider,
  type ContextAssembly,
  type ModelCapabilities,
  type NormalizedAIRequest,
  type NormalizedAIResponse,
  type ProviderConfig,
} from '@ember-tavern/ai-core';
import {
  aiOperationId,
  aiRequestId,
  campaignId,
  isoTimestamp,
  modelProfileId,
  promptVersion,
} from '@ember-tavern/contracts';
import { describe, expect, it } from 'vitest';

import {
  AI_ERROR_CATEGORIES,
  AITaskExecutionError,
  AITaskOrchestrator,
  classifyAIOrchestrationError,
  type AIRouteKind,
} from './ai-task-orchestrator.js';

const requestId = aiRequestId('request-task-orchestrator');
const operationId = aiOperationId('operation-task-orchestrator');
const request: NormalizedAIRequest = {
  requestId,
  task: 'GENERATE_WORLD',
  promptVersion: promptVersion(1),
  modelName: 'model-a',
  messages: [{ role: 'USER', content: 'Build a world.' }],
  responseFormat: { kind: 'JSON_OBJECT' },
  temperature: 0,
  maxOutputTokens: 1000,
  timeoutMs: 30_000,
};
const config: ProviderConfig = {
  id: 'provider-a',
  providerType: 'OPENAI_COMPATIBLE',
  presetKey: 'custom',
  displayName: 'Provider A',
  baseUrl: 'https://example.com/',
  credentialRef: null,
  options: {},
  enabled: true,
};
const capabilities: ModelCapabilities = {
  text: true,
  streaming: false,
  systemMessages: true,
  jsonMode: true,
  jsonSchema: false,
  toolCalling: false,
  reasoning: false,
  contextWindowTokens: 32_000,
  costStatus: 'UNKNOWN',
  checkedAt: isoTimestamp('2026-08-08T00:00:00.000Z'),
};
const resolvedModelConfig = await resolveModelConfig({
  connectionProfile: config,
  modelProfileId: modelProfileId('profile-a'),
  capabilities,
  request,
});
const contextBlock = await createContextBlock({
  id: 'context-a',
  type: 'task',
  content: { world: 'Ember Coast' },
  sourceId: requestId,
  sourceRevision: 1,
  stability: 'dynamic',
  priority: 100,
  tokenBudget: 100,
  privacyClass: 'game_private',
  version: 1,
});
const contextAssembly: ContextAssembly = {
  blocks: [contextBlock],
  manifest: {
    maxTokens: 100,
    estimatedTokens: 6,
    entries: [
      {
        blockId: 'context-a',
        type: 'task',
        sourceId: requestId,
        sourceRevision: 1,
        stability: 'dynamic',
        version: 1,
        contentHash: contextBlock.contentHash,
        privacyClass: 'game_private',
        estimatedTokens: 6,
        relevance: 1,
        required: true,
        included: true,
        reason: 'required',
      },
    ],
  },
};

describe('AITaskOrchestrator', () => {
  it.each([
    ['PRIMARY', 1],
    ['RETRY', 2],
    ['FALLBACK', 1],
    ['REPAIR', 1],
  ] as const)('unifies %s route identity and normalized usage', async (kind, attempt) => {
    const response = responseFor(request);
    const provider = providerReturning(response);
    const result = await new AITaskOrchestrator(provider, config).execute(
      taskRequest(kind, attempt),
    );

    expect(result).toMatchObject({
      status: 'SUCCEEDED',
      operationId,
      requestId,
      taskType: 'GENERATE_WORLD',
      route: { kind, attempt, providerId: 'provider-a', modelName: 'model-a' },
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    });
  });

  it('rejects route/request drift before invoking the provider', async () => {
    let calls = 0;
    const provider = providerReturning(responseFor(request), () => {
      calls += 1;
    });
    const invalid = {
      ...taskRequest('PRIMARY', 1),
      route: { ...taskRequest('PRIMARY', 1).route, modelName: 'forged-model' },
    };

    await expect(new AITaskOrchestrator(provider, config).execute(invalid)).rejects.toMatchObject({
      category: 'configuration',
      code: 'CONFIGURATION_ROUTE_INVALID',
      retryable: false,
    });
    expect(calls).toBe(0);

    const forgedContext = {
      ...taskRequest('PRIMARY', 1),
      contextAssembly: {
        ...contextAssembly,
        blocks: [{ ...contextBlock, content: { world: 'Forged Coast' } }],
      },
    };
    await expect(
      new AITaskOrchestrator(provider, config).execute(forgedContext),
    ).rejects.toMatchObject({
      category: 'configuration',
      code: 'CONFIGURATION_CONTEXT_INVALID',
      retryable: false,
    });
    expect(calls).toBe(0);
  });

  it('normalizes provider errors and rejects inconsistent usage', async () => {
    const timeout = providerThrowing(new StandardAIError('TIMEOUT'));
    await expect(
      new AITaskOrchestrator(timeout, config).execute(taskRequest('PRIMARY', 1)),
    ).rejects.toMatchObject({ category: 'timeout', code: 'TIMEOUT', retryable: true });

    const invalidUsage = responseFor(request, {
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 14,
    });
    await expect(
      new AITaskOrchestrator(providerReturning(invalidUsage), config).execute(
        taskRequest('PRIMARY', 1),
      ),
    ).rejects.toMatchObject({
      category: 'provider',
      code: 'PROVIDER_RESPONSE_MISMATCH',
      retryable: false,
    });
  });

  it('projects only the frozen configuration even when editable settings change', async () => {
    const editable: ProviderConfig = {
      ...config,
      baseUrl: 'https://original.example/',
      credentialRef: 'vault:original',
      options: { mode: 'original' },
    };
    const frozen = await resolveModelConfig({
      connectionProfile: editable,
      modelProfileId: modelProfileId('profile-a'),
      capabilities,
      request,
    });
    let received: ProviderConfig | null = null;
    const provider: AIProvider = {
      ...providerReturning(responseFor(request)),
      async generate(_request, providerConfig) {
        received = providerConfig;
        return responseFor(request);
      },
    };
    const changed = {
      ...editable,
      baseUrl: 'https://changed.example/',
      credentialRef: 'vault:changed',
      options: { mode: 'changed' },
    };

    await new AITaskOrchestrator(provider, changed).execute({
      ...taskRequest('PRIMARY', 1),
      resolvedModelConfig: frozen,
    });
    expect(received).toMatchObject({
      baseUrl: 'https://original.example/',
      credentialRef: 'vault:original',
      options: { mode: 'original' },
    });
  });

  it('exposes the complete stable application error taxonomy', () => {
    expect(AI_ERROR_CATEGORIES).toEqual([
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
    ]);
    expect(classifyAIOrchestrationError({ code: 'DOMAIN_RULE_REJECTED' })).toMatchObject({
      category: 'domain_policy',
      retryable: false,
    });
    expect(classifyAIOrchestrationError({ name: 'AbortError' })).toMatchObject({
      category: 'cancelled',
      code: 'CANCELLED',
    });
    expect(
      new AITaskExecutionError(operationId, requestId, 'schema', 'INVALID_OUTPUT', true),
    ).toMatchObject({ operationId, requestId, category: 'schema' });
  });
});

function taskRequest(kind: AIRouteKind, attempt: number) {
  return {
    operationId,
    requestId,
    taskType: 'GENERATE_WORLD' as const,
    campaignId: campaignId('campaign-task-orchestrator'),
    actorId: null,
    contextAssembly,
    resolvedModelConfig,
    route: {
      kind,
      attempt,
      providerId: 'provider-a',
      modelProfileId: modelProfileId('profile-a'),
      modelName: 'model-a',
    },
    providerRequest: request,
  };
}

function responseFor(
  source: NormalizedAIRequest,
  usage = { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
): NormalizedAIResponse {
  return {
    requestId: source.requestId,
    providerRequestId: 'provider-request-a',
    modelName: source.modelName,
    content: '{"name":"Ember Coast"}',
    finishReason: 'STOP',
    usage,
    receivedAt: isoTimestamp('2026-08-08T00:00:00.000Z'),
  };
}

function providerReturning(
  response: NormalizedAIResponse,
  called: () => void = () => {},
): AIProvider {
  return {
    id: 'provider-a',
    async listModels() {
      return [];
    },
    async testConnection() {
      return { ok: true, latencyMs: 1 };
    },
    async generate() {
      called();
      return response;
    },
  };
}

function providerThrowing(error: unknown): AIProvider {
  return {
    ...providerReturning(responseFor(request)),
    async generate() {
      throw error;
    },
  };
}

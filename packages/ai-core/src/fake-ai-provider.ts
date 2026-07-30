import { isoTimestamp, type IsoTimestamp } from '@ember-tavern/contracts';

import { AI_TASK_SCHEMAS } from './task-schema-registry.js';
import { FAKE_TASK_OUTPUTS } from './fake-task-outputs.js';
import type {
  AIProvider,
  ModelInfo,
  NormalizedAIRequest,
  NormalizedAIResponse,
  ProviderConfig,
  TestResult,
} from './protocol.js';

const deterministicTime = isoTimestamp('2000-01-01T00:00:00.000Z');
const fakeModel = Object.freeze({
  name: 'ember-fake-v1',
  displayName: 'Ember Fake v1',
  capabilities: Object.freeze({
    text: true,
    streaming: false,
    systemMessages: true,
    jsonMode: true,
    jsonSchema: true,
    toolCalling: false,
    reasoning: false,
    contextWindowTokens: 32_768,
    costStatus: 'FREE',
    checkedAt: deterministicTime,
  }),
}) satisfies ModelInfo;

export class FakeAIProviderError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'FakeAIProviderError';
  }
}

export class FakeAIProvider implements AIProvider {
  public readonly id = 'fake';

  public constructor(private readonly now: () => IsoTimestamp = () => deterministicTime) {}

  public async listModels(): Promise<readonly ModelInfo[]> {
    return [fakeModel];
  }

  public async testConnection(config: ProviderConfig): Promise<TestResult> {
    if (!config.enabled) {
      return {
        ok: false,
        latencyMs: 0,
        errorCode: 'UNSUPPORTED',
        message: 'Fake provider config is disabled',
      };
    }
    return { ok: true, latencyMs: 0 };
  }

  public async generate(
    request: NormalizedAIRequest,
    config: ProviderConfig,
  ): Promise<NormalizedAIResponse> {
    if (!config.enabled) throw new FakeAIProviderError('Fake provider config is disabled');
    if (request.modelName !== fakeModel.name) {
      throw new FakeAIProviderError(`Unknown fake model: ${request.modelName}`);
    }
    const output = AI_TASK_SCHEMAS[request.task].output.parse(FAKE_TASK_OUTPUTS[request.task]);
    return Object.freeze({
      requestId: request.requestId,
      providerRequestId: `fake:${request.requestId}`,
      modelName: fakeModel.name,
      content: JSON.stringify(output),
      finishReason: 'STOP',
      usage: Object.freeze({
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
      }),
      receivedAt: this.now(),
    });
  }
}

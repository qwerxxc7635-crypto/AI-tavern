import { aiRequestId, isoTimestamp, promptVersion } from '@ember-tavern/contracts';
import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  AI_TASKS,
  PROVIDER_PRESET_KEYS,
  PROVIDER_TYPES,
  type AIProvider,
  type ModelInfo,
  type NormalizedAIRequest,
  type NormalizedAIResponse,
  type ProviderConfig,
} from './index.js';

const checkedAt = isoTimestamp('2026-07-31T00:15:00.000Z');
const config: ProviderConfig = {
  id: 'provider-local',
  providerType: 'LOCAL_OPENAI_COMPATIBLE',
  presetKey: 'ollama',
  displayName: 'Local Ollama',
  baseUrl: 'http://127.0.0.1:11434/v1',
  credentialRef: null,
  options: { requestHeaders: {} },
  enabled: true,
};
const model: ModelInfo = {
  name: 'ember-test',
  displayName: 'Ember Test',
  capabilities: {
    text: true,
    streaming: true,
    systemMessages: true,
    jsonMode: true,
    jsonSchema: false,
    toolCalling: false,
    reasoning: false,
    contextWindowTokens: 8192,
    costStatus: 'UNKNOWN',
    checkedAt,
  },
};
const request: NormalizedAIRequest = {
  requestId: aiRequestId('request-protocol'),
  task: 'GENERATE_WORLD',
  promptVersion: promptVersion(1),
  modelName: model.name,
  messages: [
    { role: 'SYSTEM', content: 'Return a compact fantasy world.' },
    { role: 'USER', content: 'Create a coastal region.' },
  ],
  responseFormat: {
    kind: 'JSON_SCHEMA',
    name: 'world',
    schema: { type: 'object' },
  },
  temperature: 0.7,
  maxOutputTokens: 1200,
  timeoutMs: 30_000,
};
const response: NormalizedAIResponse = {
  requestId: request.requestId,
  providerRequestId: null,
  modelName: model.name,
  content: '{"name":"Ember Coast"}',
  finishReason: 'STOP',
  usage: { inputTokens: null, outputTokens: null, totalTokens: null },
  receivedAt: checkedAt,
};

const provider: AIProvider = {
  id: 'protocol-test-provider',
  async listModels() {
    return [model];
  },
  async testConnection() {
    return { ok: true, latencyMs: 1 };
  },
  async generate(receivedRequest) {
    return { ...response, requestId: receivedRequest.requestId };
  },
};

describe('vendor-neutral AI protocol', () => {
  it('lists every provider family and preset reserved by the specification', () => {
    expect(PROVIDER_TYPES).toHaveLength(5);
    expect(PROVIDER_PRESET_KEYS).toEqual(
      expect.arrayContaining(['deepseek', 'qwen', 'openrouter', 'ollama', 'custom']),
    );
  });

  it('lists all initial AI tasks without defining task schemas', () => {
    expect(AI_TASKS).toHaveLength(15);
    expect(AI_TASKS).toContain('GENERATE_ADVENTURE_TURN');
    expect(AI_TASKS).toContain('CHECK_CONSISTENCY');
  });

  it('allows a provider implementation without vendor SDK types', async () => {
    await expect(provider.listModels()).resolves.toEqual([model]);
    await expect(provider.testConnection(config)).resolves.toEqual({
      ok: true,
      latencyMs: 1,
    });
    await expect(provider.generate(request, config)).resolves.toEqual(response);
    expectTypeOf(provider).toMatchTypeOf<AIProvider>();
  });

  it('keeps credentials indirect and capability cost status dynamically timestamped', () => {
    expect(config).not.toHaveProperty('apiKey');
    expect(config.credentialRef).toBeNull();
    expect(model.capabilities).toMatchObject({
      costStatus: 'UNKNOWN',
      checkedAt,
    });
  });
});

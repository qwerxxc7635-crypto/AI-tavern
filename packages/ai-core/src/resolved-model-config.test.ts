import { aiRequestId, isoTimestamp, modelProfileId, promptVersion } from '@ember-tavern/contracts';
import { describe, expect, it } from 'vitest';

import type { ModelCapabilities, NormalizedAIRequest, ProviderConfig } from './protocol.js';
import {
  providerConfigFromResolved,
  resolveModelConfig,
  ResolvedModelConfigError,
  verifyResolvedModelConfig,
} from './resolved-model-config.js';

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
const request: NormalizedAIRequest = {
  requestId: aiRequestId('request-resolved-config'),
  task: 'GENERATE_WORLD',
  promptVersion: promptVersion(2),
  modelName: 'model-a',
  messages: [{ role: 'USER', content: 'Generate.' }],
  responseFormat: { kind: 'JSON_OBJECT' },
  temperature: 0.4,
  maxOutputTokens: 2_000,
  timeoutMs: 30_000,
};

describe('ResolvedModelConfig', () => {
  it('freezes endpoint, model, credential reference, generation, capability and prompt profile', async () => {
    const options = { headers: { 'X-Mode': 'safe' } };
    const profile = connectionProfile(options);
    const resolved = await resolveModelConfig({
      connectionProfile: profile,
      modelProfileId: modelProfileId('profile-a'),
      capabilities,
      request,
      cacheProfile: { kind: 'none' },
    });

    options.headers['X-Mode'] = 'mutated';
    expect(resolved).toMatchObject({
      endpoint: 'https://example.com/v1',
      credentialRef: 'vault:provider-a',
      modelName: 'model-a',
      generation: { temperature: 0.4, maxOutputTokens: 2_000, timeoutMs: 30_000 },
      promptProfile: { task: 'GENERATE_WORLD', promptVersion: 2 },
      providerOptions: { headers: { 'X-Mode': 'safe' } },
    });
    expect(Object.isFrozen(resolved.providerOptions['headers'])).toBe(true);
    expect(resolved.fingerprint).toMatch(/^[0-9a-f]{64}$/u);
    expect(await verifyResolvedModelConfig(resolved)).toBe(true);
    expect(providerConfigFromResolved(resolved)).toMatchObject({
      id: 'provider-a',
      baseUrl: 'https://example.com/v1',
      credentialRef: 'vault:provider-a',
    });
  });

  it('changes the fingerprint when any execution parameter changes', async () => {
    const base = await resolveModelConfig({
      connectionProfile: connectionProfile({ b: 2, a: 1 }),
      modelProfileId: modelProfileId('profile-a'),
      capabilities,
      request,
    });
    const reordered = await resolveModelConfig({
      connectionProfile: connectionProfile({ a: 1, b: 2 }),
      modelProfileId: modelProfileId('profile-a'),
      capabilities,
      request,
    });
    const changed = await resolveModelConfig({
      connectionProfile: connectionProfile({ a: 1, b: 2 }),
      modelProfileId: modelProfileId('profile-a'),
      capabilities,
      request: { ...request, temperature: 0.5 },
    });
    expect(reordered.fingerprint).toBe(base.fingerprint);
    expect(changed.fingerprint).not.toBe(base.fingerprint);
    expect(await verifyResolvedModelConfig({ ...base, modelName: 'forged' })).toBe(false);
  });

  it('rejects disabled profiles and endpoints containing authority secrets or query state', async () => {
    await expect(
      resolveModelConfig({
        connectionProfile: { ...connectionProfile({}), enabled: false },
        modelProfileId: null,
        capabilities,
        request,
      }),
    ).rejects.toBeInstanceOf(ResolvedModelConfigError);
    await expect(
      resolveModelConfig({
        connectionProfile: {
          ...connectionProfile({}),
          baseUrl: 'https://user:secret@example.com/v1?key=value',
        },
        modelProfileId: null,
        capabilities,
        request,
      }),
    ).rejects.toBeInstanceOf(ResolvedModelConfigError);
  });
});

function connectionProfile(options: ProviderConfig['options']): ProviderConfig {
  return {
    id: 'provider-a',
    providerType: 'OPENAI_COMPATIBLE',
    presetKey: 'custom',
    displayName: 'Provider A',
    baseUrl: 'https://example.com/v1',
    credentialRef: 'vault:provider-a',
    options,
    enabled: true,
  };
}

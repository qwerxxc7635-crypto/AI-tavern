import { describe, expect, it } from 'vitest';

import { parseModelSettingsSnapshot, type ModelSettingsGateway } from './model-settings-service.js';

describe('model settings contract', () => {
  it('keeps API keys outside saved provider settings', async () => {
    const calls: string[] = [];
    const gateway: ModelSettingsGateway = {
      async load() {
        return { profiles: [], defaultModelProfileId: null, fallbackModelProfileId: null };
      },
      async save(update) {
        calls.push(JSON.stringify(update));
        return { profiles: [], defaultModelProfileId: null, fallbackModelProfileId: null };
      },
      async saveSecret(secret) {
        expect(secret).toBe('runtime-secret');
        return 'credential:v1:00000000-0000-4000-8000-000000000001';
      },
      async deleteSecret(reference) {
        calls.push(`delete:${reference}`);
      },
      async probe() {
        return [];
      },
    };

    const reference = await gateway.saveSecret('runtime-secret');
    await gateway.save({
      presetKey: 'deepseek',
      providerDisplayName: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com/',
      credentialRef: reference,
      modelName: 'deepseek-v4-flash',
      modelDisplayName: 'DeepSeek V4 Flash',
      capabilities: {
        text: true,
        streaming: false,
        systemMessages: true,
        jsonMode: true,
        jsonSchema: false,
        toolCalling: false,
        reasoning: true,
        contextWindowTokens: 1048576,
        costStatus: 'UNKNOWN',
        checkedAt: '2026-08-01T00:00:00Z',
      },
      useAsDefault: true,
      useAsFallback: false,
    });
    expect(calls.join('\n')).not.toContain('runtime-secret');
    expect(calls.join('\n')).toContain('credential:v1:');
  });

  it('rejects a capability timestamp that is not RFC3339', () => {
    expect(() =>
      parseModelSettingsSnapshot({
        profiles: [
          {
            id: 'profile-1',
            providerId: 'provider-1',
            presetKey: 'custom',
            providerDisplayName: 'Local',
            baseUrl: 'http://127.0.0.1:11434/',
            hasCredential: false,
            modelName: 'local-model',
            modelDisplayName: 'Local Model',
            capabilities: {
              text: true,
              streaming: false,
              systemMessages: true,
              jsonMode: false,
              jsonSchema: false,
              toolCalling: false,
              reasoning: false,
              contextWindowTokens: 8192,
              costStatus: 'UNKNOWN',
              checkedAt: '2026-08-01 00:00:00Z',
            },
          },
        ],
        defaultModelProfileId: null,
        fallbackModelProfileId: null,
      }),
    ).toThrow('timestamp');
  });
});

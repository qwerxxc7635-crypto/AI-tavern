import { describe, expect, it } from 'vitest';

import {
  DEEPSEEK_FLASH_PROFILE,
  parseModelSettingsSnapshot,
  type ModelSettingsGateway,
} from './model-settings-service.js';

describe('model settings contract', () => {
  it('keeps the DeepSeek API id separate from its required UI label', () => {
    const snapshot = parseModelSettingsSnapshot({
      profiles: [
        {
          id: 'profile-1',
          providerId: 'provider-1',
          presetKey: 'deepseek',
          providerDisplayName: 'DeepSeek',
          baseUrl: 'https://api.deepseek.com/',
          endpointFingerprint: null,
          hasCredential: true,
          modelName: 'deepseek-v4-flash',
          modelDisplayName: 'DeepSeek V4 Flash',
          capabilities: null,
          capabilitySource: null,
          probeFingerprint: null,
        },
      ],
      defaultModelProfileId: 'profile-1',
      fallbackModelProfileId: null,
      pendingCredentialCleanupCount: 0,
    });

    expect(snapshot.profiles[0]?.modelName).toBe(DEEPSEEK_FLASH_PROFILE.apiModelId);
    expect(snapshot.profiles[0]?.modelDisplayName).toBe(DEEPSEEK_FLASH_PROFILE.uiDisplayName);
  });

  it('keeps API keys outside saved provider settings', async () => {
    const calls: string[] = [];
    const gateway: ModelSettingsGateway = {
      async load() {
        return {
          profiles: [],
          defaultModelProfileId: null,
          fallbackModelProfileId: null,
          pendingCredentialCleanupCount: 0,
        };
      },
      async save(update) {
        calls.push(JSON.stringify(update));
        return {
          profiles: [],
          defaultModelProfileId: null,
          fallbackModelProfileId: null,
          pendingCredentialCleanupCount: 0,
        };
      },
      async forgetCredential() {
        return {
          profiles: [],
          defaultModelProfileId: null,
          fallbackModelProfileId: null,
          pendingCredentialCleanupCount: 0,
        };
      },
      async saveSecret(secret) {
        expect(secret).toBe('runtime-secret');
        return 'credential:v1:00000000-0000-4000-8000-000000000001';
      },
      async deleteSecret(reference) {
        calls.push(`delete:${reference}`);
      },
      async probe() {
        return {
          receiptId: '00000000-0000-4000-8000-000000000002',
          normalizedBaseUrl: 'https://api.deepseek.com/',
          endpointFingerprint: 'a'.repeat(64),
          models: [],
        };
      },
    };

    const reference = await gateway.saveSecret('runtime-secret');
    await gateway.save({
      presetKey: 'deepseek',
      providerDisplayName: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com/',
      endpointFingerprint: 'a'.repeat(64),
      credentialRef: reference,
      credentialAction: 'REPLACE',
      modelName: 'deepseek-v4-flash',
      modelDisplayName: DEEPSEEK_FLASH_PROFILE.uiDisplayName,
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
      capabilitySource: 'PRESET_METADATA',
      probeFingerprint: 'b'.repeat(64),
      probeReceiptId: '00000000-0000-4000-8000-000000000002',
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
            endpointFingerprint: null,
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
            capabilitySource: null,
            probeFingerprint: null,
          },
        ],
        defaultModelProfileId: null,
        fallbackModelProfileId: null,
        pendingCredentialCleanupCount: 0,
      }),
    ).toThrow('timestamp');
  });

  it('normalizes Rust RFC3339 sub-millisecond precision for the shared runtime contract', () => {
    const snapshot = parseModelSettingsSnapshot({
      profiles: [
        {
          id: 'profile-1',
          providerId: 'provider-1',
          presetKey: 'deepseek',
          providerDisplayName: 'DeepSeek',
          baseUrl: 'https://api.deepseek.com/',
          endpointFingerprint: null,
          hasCredential: true,
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
            checkedAt: '2026-08-12T10:01:28.700286Z',
          },
          capabilitySource: 'PRESET_METADATA',
          probeFingerprint: null,
        },
      ],
      defaultModelProfileId: 'profile-1',
      fallbackModelProfileId: null,
      pendingCredentialCleanupCount: 0,
    });

    expect(snapshot.profiles[0]?.capabilities?.checkedAt).toBe('2026-08-12T10:01:28.700Z');
  });
});

import { describe, expect, it } from 'vitest';

import type { ModelSettingsGateway } from './model-settings-service.js';

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
      useAsDefault: true,
      useAsFallback: false,
    });
    expect(calls.join('\n')).not.toContain('runtime-secret');
    expect(calls.join('\n')).toContain('credential:v1:');
  });
});

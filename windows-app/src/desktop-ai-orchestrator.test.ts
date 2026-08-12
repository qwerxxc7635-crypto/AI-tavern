import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  FakeAIProvider,
  type AIProvider,
  type ModelCapabilities,
  type NormalizedAIRequest,
  type ProviderConfig,
} from '@ember-tavern/ai-core';
import { isoTimestamp } from '@ember-tavern/contracts';
import { DesktopAIOrchestrator, canonicalRuntimeTimestamp } from './desktop-ai-orchestrator.js';
import type {
  ModelProfile,
  ModelSettingsGateway,
  ModelSettingsSnapshot,
} from './model-settings-service.js';

describe('DesktopAIOrchestrator', () => {
  it('normalizes Rust RFC3339 sub-millisecond timestamps at the native boundary', () => {
    expect(canonicalRuntimeTimestamp('2026-08-12T10:24:01.77312Z')).toBe(
      '2026-08-12T10:24:01.773Z',
    );
  });

  it('repairs one structurally invalid provider response through the same selected runtime', async () => {
    const settings = new MutableSettings(
      profile('deepseek-profile', 'deepseek', 'deepseek-v4-flash'),
    );
    const provider = new InvalidThenCapturingProvider();
    const result = await new DesktopAIOrchestrator(settings, provider).execute(
      'GENERATE_WORLD',
      worldInput('雾海边境'),
      options('repair'),
    );

    expect(provider.calls).toHaveLength(2);
    expect(provider.calls[1]?.request.requestId).toBe('orchestrator-repair-repair');
    expect(provider.calls[1]?.config.options['profileId']).toBe('deepseek-profile');
    expect(result.validatedOutput).toBeDefined();
  });

  it('uses the saved default Provider and Model for the final generation request', async () => {
    const settings = new MutableSettings(
      profile('deepseek-profile', 'deepseek', 'deepseek-v4-flash'),
    );
    const provider = new CapturingProvider();
    const orchestrator = new DesktopAIOrchestrator(settings, provider);

    const first = await orchestrator.execute(
      'GENERATE_WORLD',
      worldInput('风暴群岛'),
      options('one'),
    );
    expect(first).toMatchObject({
      selectedProfileId: 'deepseek-profile',
      selectedPresetKey: 'deepseek',
      request: { modelName: 'deepseek-v4-flash' },
    });
    expect(provider.calls[0]).toMatchObject({
      request: { modelName: 'deepseek-v4-flash' },
      config: { id: 'provider-deepseek-profile', options: { presetKey: 'deepseek' } },
    });

    settings.current = snapshot(profile('custom-profile', 'custom', 'campaign-model'));
    const second = await orchestrator.execute(
      'GENERATE_WORLD',
      worldInput('雾海城邦'),
      options('two'),
    );
    expect(second).toMatchObject({
      selectedProfileId: 'custom-profile',
      selectedPresetKey: 'custom',
      request: { modelName: 'campaign-model' },
    });
    expect(provider.calls[1]).toMatchObject({
      request: { modelName: 'campaign-model' },
      config: { id: 'provider-custom-profile', options: { presetKey: 'custom' } },
    });
  });

  it('keeps the cache prefix stable when only dynamic player input changes', async () => {
    const orchestrator = new DesktopAIOrchestrator(
      new MutableSettings(profile('deepseek-profile', 'deepseek', 'deepseek-v4-flash')),
      new CapturingProvider(),
    );
    const first = await orchestrator.execute(
      'GENERATE_WORLD',
      worldInput('风暴群岛'),
      options('a'),
    );
    const second = await orchestrator.execute(
      'GENERATE_WORLD',
      worldInput('沙海王国'),
      options('b'),
    );
    expect(first.cachePrefixHash).toBe(second.cachePrefixHash);
    expect(first.request.messages).not.toEqual(second.request.messages);
  });

  it('uses the saved fallback only for a retryable Provider failure', async () => {
    const primary = profile('primary-profile', 'deepseek', 'deepseek-v4-flash');
    const fallback = profile('fallback-profile', 'custom', 'fallback-model');
    const settings = new MutableSettings(primary);
    settings.current = {
      profiles: [primary, fallback],
      defaultModelProfileId: primary.id,
      fallbackModelProfileId: fallback.id,
      pendingCredentialCleanupCount: 0,
    };
    const provider = new CapturingProvider('provider-primary-profile');
    const result = await new DesktopAIOrchestrator(settings, provider).execute(
      'GENERATE_WORLD',
      worldInput('风暴群岛'),
      options('fallback'),
    );

    expect(provider.calls.map(({ request }) => request.modelName)).toEqual([
      'deepseek-v4-flash',
      'fallback-model',
    ]);
    expect(result).toMatchObject({
      selectedProfileId: 'fallback-profile',
      request: { modelName: 'fallback-model' },
    });
  });

  it('keeps production game services behind the shared orchestration facade', async () => {
    const directory = fileURLToPath(new URL('.', import.meta.url));
    const files = [
      'world-creation-service.ts',
      'character-creation-service.ts',
      'tavern-service.ts',
      'npc-dialogue-service.ts',
      'quest-board-service.ts',
      'adventure-service.ts',
      'settlement-service.ts',
    ];
    for (const file of files) {
      const source = await readFile(`${directory}${file}`, 'utf8');
      expect(source, file).toContain('tauriDesktopAIOrchestrator');
      expect(source, file).not.toContain('new FakeAIProvider()');
      expect(source, file).not.toContain('.provider.generate(');
    }
  });
});

class MutableSettings implements ModelSettingsGateway {
  public current: ModelSettingsSnapshot;

  public constructor(initial: ModelProfile) {
    this.current = snapshot(initial);
  }

  public async load() {
    return this.current;
  }
  public async save(): Promise<never> {
    throw new Error('not used');
  }
  public async forgetCredential(): Promise<never> {
    throw new Error('not used');
  }
  public async saveSecret(): Promise<never> {
    throw new Error('not used');
  }
  public async deleteSecret(): Promise<never> {
    throw new Error('not used');
  }
  public async probe(): Promise<never> {
    throw new Error('not used');
  }
}

class CapturingProvider implements AIProvider {
  public readonly id = 'capturing-provider';
  public readonly calls: { request: NormalizedAIRequest; config: ProviderConfig }[] = [];
  private readonly fake = new FakeAIProvider();

  public constructor(private readonly failingConfigId: string | null = null) {}

  public async listModels() {
    return [];
  }
  public async testConnection(): Promise<never> {
    throw new Error('not used');
  }
  public async generate(request: NormalizedAIRequest, config: ProviderConfig) {
    this.calls.push({ request, config });
    if (config.id === this.failingConfigId) {
      throw Object.freeze({ code: 'NETWORK_FAILED' });
    }
    const response = await this.fake.generate(
      { ...request, modelName: 'ember-fake-v1' },
      { ...config, enabled: true },
    );
    return { ...response, requestId: request.requestId, modelName: request.modelName };
  }
}

class InvalidThenCapturingProvider extends CapturingProvider {
  private invalidPending = true;

  public override async generate(request: NormalizedAIRequest, config: ProviderConfig) {
    if (this.invalidPending) {
      this.invalidPending = false;
      this.calls.push({ request, config });
      return {
        requestId: request.requestId,
        providerRequestId: null,
        modelName: request.modelName,
        content: '{',
        finishReason: 'LENGTH' as const,
        usage: { inputTokens: null, outputTokens: null, totalTokens: null },
        receivedAt: isoTimestamp('2026-08-01T00:00:00.000Z'),
      };
    }
    return super.generate(request, config);
  }
}

function snapshot(profileValue: ModelProfile): ModelSettingsSnapshot {
  return {
    profiles: [profileValue],
    defaultModelProfileId: profileValue.id,
    fallbackModelProfileId: null,
    pendingCredentialCleanupCount: 0,
  };
}

function profile(
  id: string,
  presetKey: ModelProfile['presetKey'],
  modelName: string,
): ModelProfile {
  return {
    id,
    providerId: `provider-${id}`,
    presetKey,
    providerDisplayName: presetKey === 'deepseek' ? 'DeepSeek' : 'Custom',
    baseUrl: presetKey === 'deepseek' ? 'https://api.deepseek.com/' : 'https://example.test/',
    endpointFingerprint: 'a'.repeat(64),
    hasCredential: presetKey !== 'ollama',
    modelName,
    modelDisplayName: modelName,
    capabilities: capabilities(),
    capabilitySource: 'PRESET_METADATA',
    probeFingerprint: 'b'.repeat(64),
  };
}

function capabilities(): ModelCapabilities {
  return {
    text: true,
    streaming: false,
    systemMessages: true,
    jsonMode: true,
    jsonSchema: false,
    toolCalling: false,
    reasoning: true,
    contextWindowTokens: 131_072,
    costStatus: 'PAID',
    checkedAt: isoTimestamp('2026-08-12T00:00:00.000Z'),
  };
}

function worldInput(concept: string) {
  return {
    concept,
    storyPreferences: ['奇幻', '探索'],
    contentBoundaries: {
      allowHorror: false,
      allowPermanentDeath: false,
      allowRomance: true,
      allowBetrayal: true,
      excludedContent: [],
    },
  };
}

function options(suffix: string) {
  return {
    requestId: `orchestrator-${suffix}`,
    temperature: 0.8,
    maxOutputTokens: 4_000,
    timeoutMs: 5_000,
  };
}

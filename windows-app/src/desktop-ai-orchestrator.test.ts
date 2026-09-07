import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  FAKE_TASK_OUTPUTS,
  FakeAIProvider,
  type AIProvider,
  type ModelCapabilities,
  type NormalizedAIRequest,
  type ProviderConfig,
} from '@ember-tavern/ai-core';
import { isoTimestamp } from '@ember-tavern/contracts';
import { DesktopAIOrchestrator, canonicalRuntimeTimestamp } from './desktop-ai-orchestrator.js';
import { resetAIInspectorForTests, sessionAIInspectorGateway } from './ai-inspector-service.js';
import type {
  ModelProfile,
  ModelSettingsGateway,
  ModelSettingsSnapshot,
} from './model-settings-service.js';
import type { PromptProfileSource } from './prompt-manager-service.js';

describe('DesktopAIOrchestrator', () => {
  it('normalizes Rust RFC3339 sub-millisecond timestamps at the native boundary', () => {
    expect(canonicalRuntimeTimestamp('2026-08-12T10:24:01.77312Z')).toBe(
      '2026-08-12T10:24:01.773Z',
    );
  });

  it('repairs one structurally invalid provider response through the same selected runtime', async () => {
    resetAIInspectorForTests();
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
    expect(
      result.lifecycle.filter(({ status }) => status === 'SUCCEEDED').map(({ stage }) => stage),
    ).toEqual([
      'BUILD_CONTEXT',
      'BUILD_PROMPT',
      'GENERATE',
      'PARSE',
      'REPAIR',
      'PARSE',
      'VALIDATE',
      'RULES_CHECK',
      'EMIT_EVENTS',
      'PERSIST',
    ]);
    expect(await sessionAIInspectorGateway.load('ADVANCED')).toMatchObject({
      generation: { task: 'GENERATE_WORLD', status: 'SUCCEEDED' },
      provider: { model: 'deepseek-v4-flash' },
      repair: { attempted: true, status: 'SUCCEEDED' },
      validation: { status: 'PASSED' },
    });
  });

  it('records the failed repair and validation boundary without publishing raw content', async () => {
    resetAIInspectorForTests();
    const settings = new MutableSettings(
      profile('deepseek-profile', 'deepseek', 'deepseek-v4-flash'),
    );
    await expect(
      new DesktopAIOrchestrator(settings, new InvalidThenCapturingProvider(2)).execute(
        'GENERATE_WORLD',
        worldInput('结构损坏的世界'),
        options('failed-repair'),
      ),
    ).rejects.toMatchObject({ code: 'RESPONSE_TRUNCATED' });

    expect(await sessionAIInspectorGateway.load('ADVANCED')).toMatchObject({
      generation: { status: 'FAILED', errorCode: 'RESPONSE_TRUNCATED' },
      raw: { characters: 1, content: '［原始输出内容已遮罩］' },
      validation: { status: 'FAILED', code: 'RESPONSE_TRUNCATED' },
      repair: { attempted: true, status: 'FAILED' },
    });
  });

  it('accepts one markdown-fenced world without spending a repair request', async () => {
    const settings = new MutableSettings(
      profile('deepseek-profile', 'deepseek', 'deepseek-v4-flash'),
    );
    const provider = new WrappedJsonProvider('FENCE');
    const result = await new DesktopAIOrchestrator(settings, provider).execute(
      'GENERATE_WORLD',
      worldInput('围栏世界'),
      options('fenced'),
    );

    expect(provider.calls).toHaveLength(1);
    expect(result.validatedOutput).toEqual(FAKE_TASK_OUTPUTS.GENERATE_WORLD);
    expect(result.lifecycle).toContainEqual(
      expect.objectContaining({ stage: 'REPAIR', status: 'SKIPPED' }),
    );
  });

  it('repairs a schema-invalid world and reruns the complete schema', async () => {
    const settings = new MutableSettings(
      profile('deepseek-profile', 'deepseek', 'deepseek-v4-flash'),
    );
    const provider = new SchemaInvalidThenCapturingProvider();
    const result = await new DesktopAIOrchestrator(settings, provider).execute(
      'GENERATE_WORLD',
      worldInput('缺字段世界'),
      options('schema-repair'),
    );

    expect(provider.calls).toHaveLength(2);
    expect(result.validatedOutput).toEqual(FAKE_TASK_OUTPUTS.GENERATE_WORLD);
    expect(result.lifecycle.filter(({ stage }) => stage === 'VALIDATE')).toMatchObject([
      { status: 'STARTED' },
      { status: 'FAILED', code: 'SCHEMA_NAME_INVALID' },
      { status: 'STARTED' },
      { status: 'SUCCEEDED' },
    ]);
  });

  it('reports constitution drift as a business-rule failure without structural repair', async () => {
    const provider = new BusinessInvalidProvider();
    await expect(
      new DesktopAIOrchestrator(
        new MutableSettings(profile('deepseek-profile', 'deepseek', 'deepseek-v4-flash')),
        provider,
      ).execute('GENERATE_WORLD', worldInput('规则漂移世界'), options('business-rule')),
    ).rejects.toMatchObject({ code: 'WORLD_BUSINESS_RULE_INVALID' });
    expect(provider.calls).toHaveLength(1);
  });

  it('fails closed when the repair response still violates the schema', async () => {
    const settings = new MutableSettings(
      profile('deepseek-profile', 'deepseek', 'deepseek-v4-flash'),
    );
    const provider = new SchemaInvalidThenCapturingProvider(2);

    await expect(
      new DesktopAIOrchestrator(settings, provider).execute(
        'GENERATE_WORLD',
        worldInput('持续缺字段世界'),
        options('schema-repair-failed'),
      ),
    ).rejects.toMatchObject({
      code: 'SCHEMA_NAME_INVALID',
      cause: { attempt: 'REPAIR', validation: { code: 'SCHEMA_VALIDATION_FAILED' } },
    });
    expect(provider.calls).toHaveLength(2);
  });

  it('keeps the initial validation path when the independent repair request times out', async () => {
    resetAIInspectorForTests();
    const settings = new MutableSettings(
      profile('deepseek-profile', 'deepseek', 'deepseek-v4-flash'),
    );

    await expect(
      new DesktopAIOrchestrator(settings, new SchemaInvalidThenTimeoutProvider()).execute(
        'GENERATE_WORLD',
        worldInput('修复超时世界'),
        options('schema-repair-timeout'),
      ),
    ).rejects.toMatchObject({ code: 'TIMEOUT' });
    expect(await sessionAIInspectorGateway.load('ADVANCED')).toMatchObject({
      generation: { status: 'FAILED', errorCode: 'TIMEOUT' },
      validation: {
        status: 'FAILED',
        code: 'SCHEMA_VALIDATION_FAILED',
        issues: [expect.objectContaining({ path: 'name' })],
      },
      repair: { attempted: true, status: 'FAILED' },
    });
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
    expect(first.lifecycle).toContainEqual(
      expect.objectContaining({ stage: 'REPAIR', status: 'SKIPPED' }),
    );
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

  it('routes combat content through the same selected provider, repair, and cache-prefix pipeline', async () => {
    const settings = new MutableSettings(
      profile('deepseek-profile', 'deepseek', 'deepseek-v4-flash'),
    );
    const provider = new CapturingProvider();
    const result = await new DesktopAIOrchestrator(settings, provider).execute(
      'COMBAT_CONTENT_GENERATION',
      {
        schemaVersion: 1,
        contentKind: 'ABILITY',
        submissionPolicy: 'USER_REQUESTED',
        worldType: 'CULTIVATION',
        requestText: '构思一道以雷鸣压制敌人的术法。',
      },
      options('combat-content'),
    );

    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]).toMatchObject({
      request: { task: 'COMBAT_CONTENT_GENERATION', modelName: 'deepseek-v4-flash' },
      config: { id: 'provider-deepseek-profile' },
    });
    expect(result.validatedOutput).toEqual(FAKE_TASK_OUTPUTS.COMBAT_CONTENT_GENERATION);
    expect(result.cachePrefixHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(result.lifecycle).toContainEqual(
      expect.objectContaining({ stage: 'REPAIR', status: 'SKIPPED' }),
    );
  });

  it('repairs an invalid combat proposal through the existing structured-output path', async () => {
    const settings = new MutableSettings(
      profile('deepseek-profile', 'deepseek', 'deepseek-v4-flash'),
    );
    const provider = new InvalidThenCapturingProvider();
    const result = await new DesktopAIOrchestrator(settings, provider).execute(
      'COMBAT_CONTENT_GENERATION',
      {
        schemaVersion: 1,
        contentKind: 'STATUS',
        submissionPolicy: 'BACKGROUND_WORLD_CONTENT',
        worldType: 'SCI_FI',
        requestText: '构思一种电磁干扰状态。',
      },
      options('combat-content-repair'),
    );

    expect(provider.calls).toHaveLength(2);
    expect(provider.calls.map(({ request }) => request.task)).toEqual([
      'COMBAT_CONTENT_GENERATION',
      'COMBAT_CONTENT_GENERATION',
    ]);
    expect(result.validatedOutput).toEqual(FAKE_TASK_OUTPUTS.COMBAT_CONTENT_GENERATION);
    expect(result.lifecycle).toContainEqual(
      expect.objectContaining({ stage: 'REPAIR', status: 'SUCCEEDED' }),
    );
  });

  it('streams only through an optional capable provider and preserves the final validation path', async () => {
    const base = profile('stream-profile', 'deepseek', 'deepseek-v4-flash');
    if (base.capabilities === null) throw new Error('expected capabilities');
    const settings = new MutableSettings({
      ...base,
      capabilities: { ...base.capabilities, streaming: true },
    });
    const provider = new StreamingProvider();
    const chunks: string[] = [];
    const result = await new DesktopAIOrchestrator(settings, provider).execute(
      'GENERATE_WORLD',
      worldInput('流光群岛'),
      {
        ...options('stream'),
        stream: {
          signal: new AbortController().signal,
          onChunk: ({ content }) => chunks.push(content),
        },
      },
    );

    expect(provider.streamCalls).toBe(1);
    expect(chunks.join('')).toBe(result.response.content);
    expect(result.validatedOutput).toBeDefined();
  });

  it('keeps providers without streaming capability on the existing generate contract', async () => {
    const provider = new CapturingProvider();
    const chunks: string[] = [];
    await new DesktopAIOrchestrator(
      new MutableSettings(profile('legacy-profile', 'custom', 'legacy-model')),
      provider,
    ).execute('GENERATE_WORLD', worldInput('兼容世界'), {
      ...options('legacy-stream'),
      stream: {
        signal: new AbortController().signal,
        onChunk: ({ content }) => chunks.push(content),
      },
    });

    expect(provider.calls).toHaveLength(1);
    expect(chunks).toEqual([]);
  });

  it('rejects out-of-order chunks before final output can enter validation', async () => {
    const base = profile('broken-stream-profile', 'deepseek', 'deepseek-v4-flash');
    if (base.capabilities === null) throw new Error('expected capabilities');
    const settings = new MutableSettings({
      ...base,
      capabilities: { ...base.capabilities, streaming: true },
    });
    const provider = new StreamingProvider(2);

    await expect(
      new DesktopAIOrchestrator(settings, provider).execute(
        'GENERATE_WORLD',
        worldInput('乱序世界'),
        {
          ...options('broken-stream'),
          stream: { signal: new AbortController().signal, onChunk() {} },
        },
      ),
    ).rejects.toMatchObject({ code: 'STREAM_ORDER_INVALID' });
  });

  it('clears an invalid streamed draft before the existing non-stream repair succeeds', async () => {
    const base = profile('repair-stream-profile', 'deepseek', 'deepseek-v4-flash');
    if (base.capabilities === null) throw new Error('expected capabilities');
    const chunks: string[] = [];
    let resets = 0;
    const result = await new DesktopAIOrchestrator(
      new MutableSettings({
        ...base,
        capabilities: { ...base.capabilities, streaming: true },
      }),
      new RepairingStreamingProvider(),
    ).execute('GENERATE_WORLD', worldInput('修复世界'), {
      ...options('repair-stream'),
      stream: {
        signal: new AbortController().signal,
        onChunk: ({ content }) => chunks.push(content),
        onReset() {
          resets += 1;
        },
      },
    });

    expect(chunks).toEqual(['{']);
    expect(resets).toBe(1);
    expect(result.validatedOutput).toBeDefined();
    expect(result.lifecycle).toContainEqual(
      expect.objectContaining({ stage: 'REPAIR', status: 'SUCCEEDED' }),
    );
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

  it('keeps stable rules in the prefix and invalidates it when those rules change', async () => {
    const orchestrator = new DesktopAIOrchestrator(
      new MutableSettings(profile('deepseek-profile', 'deepseek', 'deepseek-v4-flash')),
      new CapturingProvider(),
    );
    const first = await orchestrator.execute(
      'CHECK_CONSISTENCY',
      consistencyInput(['死亡结果不可刷新'], '玩家查看门锁。'),
      options('stable-rules-a'),
    );
    const dynamicChange = await orchestrator.execute(
      'CHECK_CONSISTENCY',
      consistencyInput(['死亡结果不可刷新'], '玩家离开酒馆。'),
      options('stable-rules-b'),
    );
    const ruleChange = await orchestrator.execute(
      'CHECK_CONSISTENCY',
      consistencyInput(['死亡结果不可刷新', '低魔法世界'], '玩家离开酒馆。'),
      options('stable-rules-c'),
    );

    expect(dynamicChange.cachePrefixHash).toBe(first.cachePrefixHash);
    expect(ruleChange.cachePrefixHash).not.toBe(first.cachePrefixHash);
    expect(first.request.messages[0]?.content).toContain('[STABLE_WORLD_TRUTHS]');
  });

  it('changes the cache revision for user guidance without changing core prompt order', async () => {
    const settings = new MutableSettings(
      profile('deepseek-profile', 'deepseek', 'deepseek-v4-flash'),
    );
    const baseline = await new DesktopAIOrchestrator(settings, new CapturingProvider()).execute(
      'GENERATE_WORLD',
      worldInput('风暴群岛'),
      options('prompt-default'),
    );
    const customized = await new DesktopAIOrchestrator(
      settings,
      new CapturingProvider(),
      promptSource(8),
    ).execute('GENERATE_WORLD', worldInput('风暴群岛'), options('prompt-custom'));

    expect(customized.cachePrefixHash).not.toBe(baseline.cachePrefixHash);
    expect(customized.request.messages[0]?.content).toContain('[GAME_RULES]');
    expect(customized.request.messages[0]?.content).toContain('[USER_GUIDANCE]');
    expect(customized.request.messages[0]?.content.indexOf('[GAME_RULES]')).toBeLessThan(
      customized.request.messages[0]?.content.indexOf('[USER_GUIDANCE]') ?? -1,
    );
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

  it('freezes one prompt preset across primary failure and fallback execution', async () => {
    const primary = profile('primary-profile', 'deepseek', 'deepseek-v4-flash');
    const fallback = profile('fallback-profile', 'custom', 'fallback-model');
    const settings = new MutableSettings(primary);
    settings.current = {
      profiles: [primary, fallback],
      defaultModelProfileId: primary.id,
      fallbackModelProfileId: fallback.id,
      pendingCredentialCleanupCount: 0,
    };
    let resolutions = 0;
    const source = promptSource(12, () => {
      resolutions += 1;
    });
    const provider = new CapturingProvider('provider-primary-profile');
    await new DesktopAIOrchestrator(settings, provider, source).execute(
      'GENERATE_WORLD',
      worldInput('同一意图'),
      options('prompt-fallback'),
    );

    expect(resolutions).toBe(1);
    expect(provider.calls).toHaveLength(2);
    expect(provider.calls[0]?.request.messages).toEqual(provider.calls[1]?.request.messages);
  });

  it.each([
    'AUTHENTICATION_FAILED',
    'QUOTA_EXCEEDED',
    'INVALID_OUTPUT',
    'DOMAIN_RULE_REJECTED',
    'LOCAL_STORAGE_UNAVAILABLE',
  ])('does not silently fallback for %s', async (code) => {
    resetAIInspectorForTests();
    const primary = profile('primary-profile', 'deepseek', 'deepseek-v4-flash');
    const fallback = profile('fallback-profile', 'custom', 'fallback-model');
    const settings = new MutableSettings(primary);
    settings.current = {
      profiles: [primary, fallback],
      defaultModelProfileId: primary.id,
      fallbackModelProfileId: fallback.id,
      pendingCredentialCleanupCount: 0,
    };
    const provider = new CapturingProvider('provider-primary-profile', code);

    await expect(
      new DesktopAIOrchestrator(settings, provider).execute(
        'GENERATE_WORLD',
        worldInput('风暴群岛'),
        options(`no-fallback-${code}`),
      ),
    ).rejects.toMatchObject({ code });
    expect(provider.calls).toHaveLength(1);
    expect(await sessionAIInspectorGateway.load('ADVANCED')).toMatchObject({
      generation: { task: 'GENERATE_WORLD', status: 'FAILED', errorCode: code },
      provider: { id: 'provider-primary-profile', model: 'deepseek-v4-flash' },
      raw: null,
      validation: { status: 'NOT_REACHED' },
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
      'universal-character-creation-service.ts',
      'npc-lod-service.ts',
      'dynamic-location-service.ts',
      'active-faction-service.ts',
      'tavern-scene-service.ts',
      'dialogue-suggestion-service.ts',
      'dynamic-quest-source-service.ts',
    ];
    for (const file of files) {
      const source = await readFile(`${directory}${file}`, 'utf8');
      expect(source, file).toMatch(/tauriDesktopAIOrchestrator|desktopAIEngine/u);
      expect(source, file).not.toContain('new FakeAIProvider()');
      expect(source, file).not.toContain('.provider.generate(');
    }
    const orchestrator = await readFile(`${directory}desktop-ai-orchestrator.ts`, 'utf8');
    expect(orchestrator).toContain('buildUnifiedTaskContext');
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

  public constructor(
    private readonly failingConfigId: string | null = null,
    private readonly failureCode = 'NETWORK_FAILED',
  ) {}

  public async listModels() {
    return [];
  }
  public async testConnection(): Promise<never> {
    throw new Error('not used');
  }
  public async generate(request: NormalizedAIRequest, config: ProviderConfig) {
    this.calls.push({ request, config });
    if (config.id === this.failingConfigId) {
      throw Object.freeze({ code: this.failureCode });
    }
    const response = await this.fake.generate(
      { ...request, modelName: 'ember-fake-v1' },
      { ...config, enabled: true },
    );
    return { ...response, requestId: request.requestId, modelName: request.modelName };
  }
}

class InvalidThenCapturingProvider extends CapturingProvider {
  public constructor(private invalidRemaining = 1) {
    super();
  }

  public override async generate(request: NormalizedAIRequest, config: ProviderConfig) {
    if (this.invalidRemaining > 0) {
      this.invalidRemaining -= 1;
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

class BusinessInvalidProvider extends CapturingProvider {
  public override async generate(request: NormalizedAIRequest, config: ProviderConfig) {
    const response = await super.generate(request, config);
    const output = JSON.parse(response.content) as Record<string, unknown>;
    output['technologyLevel'] = '不符合世界宪法的技术水平';
    return { ...response, content: JSON.stringify(output) };
  }
}

class WrappedJsonProvider extends CapturingProvider {
  public constructor(private readonly wrapper: 'FENCE' | 'PROSE') {
    super();
  }

  public override async generate(request: NormalizedAIRequest, config: ProviderConfig) {
    const response = await super.generate(request, config);
    const content =
      this.wrapper === 'FENCE'
        ? `\`\`\`json\n${response.content}\n\`\`\``
        : `生成结果如下：\n${response.content}\n生成结束。`;
    return { ...response, content };
  }
}

class SchemaInvalidThenCapturingProvider extends CapturingProvider {
  public constructor(private invalidRemaining = 1) {
    super();
  }

  public override async generate(request: NormalizedAIRequest, config: ProviderConfig) {
    if (this.invalidRemaining <= 0) return super.generate(request, config);
    this.invalidRemaining -= 1;
    this.calls.push({ request, config });
    const invalid: Record<string, unknown> = { ...FAKE_TASK_OUTPUTS.GENERATE_WORLD };
    delete invalid['name'];
    return {
      requestId: request.requestId,
      providerRequestId: 'schema-invalid-request',
      modelName: request.modelName,
      content: JSON.stringify(invalid),
      finishReason: 'STOP' as const,
      usage: { inputTokens: null, outputTokens: null, totalTokens: null },
      receivedAt: isoTimestamp('2026-08-01T00:00:00.000Z'),
    };
  }
}

class SchemaInvalidThenTimeoutProvider extends SchemaInvalidThenCapturingProvider {
  private attempts = 0;

  public override async generate(request: NormalizedAIRequest, config: ProviderConfig) {
    this.attempts += 1;
    if (this.attempts === 2) throw Object.freeze({ code: 'TIMEOUT' });
    return super.generate(request, config);
  }
}

class StreamingProvider extends CapturingProvider {
  public streamCalls = 0;

  public constructor(private readonly firstSequence = 1) {
    super();
  }

  public async generateStream(
    request: NormalizedAIRequest,
    config: ProviderConfig,
    stream: NonNullable<Parameters<NonNullable<AIProvider['generateStream']>>[2]>,
  ) {
    this.streamCalls += 1;
    const response = await this.generate(request, config);
    const split = Math.max(1, Math.floor(response.content.length / 2));
    stream.onChunk({ sequence: this.firstSequence, content: response.content.slice(0, split) });
    stream.onChunk({ sequence: this.firstSequence + 1, content: response.content.slice(split) });
    return response;
  }
}

class RepairingStreamingProvider extends CapturingProvider {
  public async generateStream(
    request: NormalizedAIRequest,
    _config: ProviderConfig,
    stream: Parameters<NonNullable<AIProvider['generateStream']>>[2],
  ) {
    stream.onChunk({ sequence: 1, content: '{' });
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

function consistencyInput(lockedRules: readonly string[], proposedContent: string) {
  return {
    world: {
      name: '暮湾',
      currentRegion: '旧港',
      summary: '潮雾笼罩的低魔港城。',
      coreConflict: '守灯人与走私者争夺旧航道。',
      technologyLevel: '铁器时代',
      powerRules: ['魔法稀少且代价明确。'],
    },
    lockedRules,
    knownFacts: ['旧灯塔仍在运转。'],
    proposedContent,
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

function promptSource(revision: number, onResolve: () => void = () => {}): PromptProfileSource {
  return {
    async resolve() {
      onResolve();
      return {
        managerRevision: revision,
        presetId: 'preset-candle',
        presetName: 'Candlelit',
        presetVersion: 3,
        blocks: [
          {
            id: 'tone',
            name: 'Tone',
            content: 'Use restrained candlelit prose.',
            enabled: true,
            tasks: [],
          },
        ],
      };
    },
  };
}

import { aiRequestId, isoTimestamp, promptVersion } from '@ember-tavern/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  AI_TASKS,
  AI_TASK_SCHEMAS,
  FAKE_TASK_OUTPUTS,
  FakeAIProvider,
  FakeAIProviderError,
  type AITask,
  type NormalizedAIRequest,
  type ProviderConfig,
} from './index.js';

const enabledConfig: ProviderConfig = {
  id: 'fake-provider',
  providerType: 'LOCAL_OPENAI_COMPATIBLE',
  presetKey: 'custom',
  displayName: 'Deterministic Fake Provider',
  baseUrl: null,
  credentialRef: null,
  options: {},
  enabled: true,
};

function requestFor(task: AITask, suffix = 'fixture'): NormalizedAIRequest {
  return {
    requestId: aiRequestId(`fake-${task.toLowerCase()}-${suffix}`),
    task,
    promptVersion: promptVersion(1),
    modelName: 'ember-fake-v1',
    messages: [{ role: 'USER', content: `Generate deterministic output for ${task}.` }],
    responseFormat: { kind: 'JSON_OBJECT' },
    temperature: 0,
    maxOutputTokens: 2_048,
    timeoutMs: 1_000,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('FakeAIProvider', () => {
  it('advertises a deterministic free model and passes an enabled connection check', async () => {
    const provider = new FakeAIProvider();

    await expect(provider.listModels()).resolves.toEqual([
      expect.objectContaining({
        name: 'ember-fake-v1',
        capabilities: expect.objectContaining({
          jsonSchema: true,
          costStatus: 'FREE',
          checkedAt: isoTimestamp('2000-01-01T00:00:00.000Z'),
        }),
      }),
    ]);
    await expect(provider.testConnection(enabledConfig)).resolves.toEqual({
      ok: true,
      latencyMs: 0,
    });
  });

  it.each(AI_TASKS)('%s returns repeatable output accepted by its task schema', async (task) => {
    const provider = new FakeAIProvider();
    const request = requestFor(task);
    const first = await provider.generate(request, enabledConfig);
    const second = await provider.generate(request, enabledConfig);
    const parsed: unknown = JSON.parse(first.content);

    expect(second).toEqual(first);
    expect(first).toMatchObject({
      requestId: request.requestId,
      providerRequestId: `fake:${request.requestId}`,
      modelName: 'ember-fake-v1',
      finishReason: 'STOP',
      receivedAt: isoTimestamp('2000-01-01T00:00:00.000Z'),
    });
    expect(AI_TASK_SCHEMAS[task].output.safeParse(parsed).success).toBe(true);
  });

  it('keeps every bundled task fixture valid before it can become provider output', () => {
    expect(Object.keys(FAKE_TASK_OUTPUTS)).toEqual(AI_TASKS);
    for (const task of AI_TASKS) {
      expect(AI_TASK_SCHEMAS[task].output.safeParse(FAKE_TASK_OUTPUTS[task]).success).toBe(true);
    }
  });

  it('generates the initial game content and a complete eight-turn adventure offline', async () => {
    const network = vi.fn(() => Promise.reject(new Error('Network access is forbidden')));
    vi.stubGlobal('fetch', network);
    const provider = new FakeAIProvider();
    const setupTasks: readonly AITask[] = [
      'GENERATE_WORLD',
      'GENERATE_CHARACTER_TRAITS',
      'COMPLETE_CHARACTER_BACKGROUND',
      'GENERATE_TAVERN',
      'GENERATE_NPCS',
      'GENERATE_QUEST',
      'GENERATE_ADVENTURE_PLAN',
    ];

    for (const task of setupTasks) {
      await expect(provider.generate(requestFor(task), enabledConfig)).resolves.toMatchObject({
        finishReason: 'STOP',
      });
    }
    for (let turn = 1; turn <= 8; turn += 1) {
      await expect(
        provider.generate(requestFor('GENERATE_ADVENTURE_TURN', `turn-${turn}`), enabledConfig),
      ).resolves.toMatchObject({ finishReason: 'STOP' });
      await expect(
        provider.generate(requestFor('RESOLVE_DICE_RESULT', `turn-${turn}`), enabledConfig),
      ).resolves.toMatchObject({ finishReason: 'STOP' });
    }
    await expect(
      provider.generate(requestFor('SUMMARIZE_ADVENTURE'), enabledConfig),
    ).resolves.toMatchObject({ finishReason: 'STOP' });
    expect(network).not.toHaveBeenCalled();
  });

  it('rejects disabled configs and unknown model names without hiding the failure', async () => {
    const provider = new FakeAIProvider();
    const disabledConfig = { ...enabledConfig, enabled: false };

    await expect(provider.testConnection(disabledConfig)).resolves.toMatchObject({
      ok: false,
      errorCode: 'UNSUPPORTED',
    });
    await expect(
      provider.generate(requestFor('GENERATE_WORLD'), disabledConfig),
    ).rejects.toBeInstanceOf(FakeAIProviderError);
    await expect(
      provider.generate(
        { ...requestFor('GENERATE_WORLD'), modelName: 'missing-model' },
        enabledConfig,
      ),
    ).rejects.toThrow('Unknown fake model: missing-model');
  });

  it('uses an injected clock for the normalized response timestamp', async () => {
    const receivedAt = isoTimestamp('2026-07-31T12:34:56.000Z');
    const provider = new FakeAIProvider(() => receivedAt);

    await expect(
      provider.generate(requestFor('CHECK_CONSISTENCY'), enabledConfig),
    ).resolves.toMatchObject({ receivedAt });
  });

  it('makes freeform adventure intent change the resulting scene instead of only advancing turn', async () => {
    const provider = new FakeAIProvider();
    const baseInput = {
      currentTurnNumber: 1,
      adventurePlan: { expectedTurns: { min: 8, max: 12 } },
      playerActionMode: 'ACTION',
    };
    const request = (playerAction: string): NormalizedAIRequest => ({
      ...requestFor('GENERATE_ADVENTURE_TURN', playerAction),
      messages: [
        {
          role: 'USER',
          content: `Task input JSON:\n${JSON.stringify({ ...baseInput, playerAction })}`,
        },
      ],
    });
    const forceDoor = JSON.parse(
      (await provider.generate(request('用肩膀撞开生锈的侧门'), enabledConfig)).content,
    ) as Record<string, unknown>;
    const inspectMarks = JSON.parse(
      (await provider.generate(request('检查门框上的盐渍和焦痕'), enabledConfig)).content,
    ) as Record<string, unknown>;

    expect(forceDoor['sceneText']).toContain('撞开生锈的侧门');
    expect(inspectMarks['sceneText']).toContain('检查门框上的盐渍和焦痕');
    expect(forceDoor['sceneText']).not.toBe(inspectMarks['sceneText']);
    expect(forceDoor['suggestedActions']).not.toEqual(inspectMarks['suggestedActions']);
  });
});

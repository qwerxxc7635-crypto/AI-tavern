import { describe, expect, it } from 'vitest';

import type { DesktopAIEngine } from './desktop-ai-orchestrator.js';
import {
  DialogueSuggestionServiceError,
  WindowsDialogueSuggestionService,
} from './dialogue-suggestion-service.js';

const digest = 'a'.repeat(64);
const input = {
  scopeKind: 'NPC_DIALOGUE',
  scopeId: 'npc-owner',
  world: { summary: 'A storm-bound coast.', currentRegion: 'Ash Harbor' },
  player: { name: 'Mira', concept: 'Scout', personalGoal: 'Find the road.' },
  participants: [{ id: 'npc-owner', name: 'Ilyra', identity: 'Innkeeper', status: 'ACTIVE' }],
  relationship: { trust: 1, closeness: 0, awe: 0, obligation: 0 },
  recentMessages: [{ role: 'NPC', speakerNpcId: 'npc-owner', content: 'The cellar is sealed.' }],
  openQuests: [{ id: 'quest-1', title: 'The Lantern Below', status: 'AVAILABLE' }],
};
const output = {
  suggestions: [
    { text: 'Who sealed the cellar?', addressedNpcId: 'npc-owner' },
    { text: 'Ask about the lantern quest.', addressedNpcId: 'npc-owner' },
    { text: 'Offer to inspect the cellar.', addressedNpcId: 'npc-owner' },
  ],
};

describe('dialogue suggestion service', () => {
  it('generates 3–5 suggestions from the exact public NPC and scene context', async () => {
    const gateway = new FakeGateway();
    const ai = new FakeAI();
    const service = new WindowsDialogueSuggestionService(gateway, ai, fixedRandomness);

    const result = await service.load('campaign-tavern', 'NPC_DIALOGUE', 'npc-owner');

    expect(result.suggestions).toHaveLength(3);
    expect(ai.inputs).toEqual([input]);
    expect(JSON.stringify(ai.inputs)).not.toContain('secret');
    expect(gateway.commits[0]).toMatchObject({
      campaignId: 'campaign-tavern',
      scopeKind: 'NPC_DIALOGUE',
      scopeId: 'npc-owner',
      expectedContextDigest: digest,
    });
  });

  it('uses an exact-digest cache without another model call', async () => {
    const gateway = new FakeGateway(set('CACHE'));
    const ai = new FakeAI();
    const result = await new WindowsDialogueSuggestionService(gateway, ai, fixedRandomness).load(
      'campaign-tavern',
      'NPC_DIALOGUE',
      'npc-owner',
    );
    expect(result.source).toBe('CACHE');
    expect(ai.inputs).toEqual([]);
    expect(gateway.commits).toEqual([]);
  });

  it('does not commit a late result after cancellation', async () => {
    const gateway = new FakeGateway();
    let resolveGeneration!: (value: unknown) => void;
    const deferred = new Promise<unknown>((resolve) => {
      resolveGeneration = resolve;
    });
    const ai = new FakeAI(deferred);
    const controller = new AbortController();
    const pending = new WindowsDialogueSuggestionService(gateway, ai, fixedRandomness).load(
      'campaign-tavern',
      'NPC_DIALOGUE',
      'npc-owner',
      controller.signal,
    );
    await Promise.resolve();
    controller.abort();
    resolveGeneration(execution());
    await expect(pending).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(gateway.commits).toEqual([]);
  });

  it('preserves the generation error as a cause and leaves persistence untouched', async () => {
    const gateway = new FakeGateway();
    const failure = new Error('offline');
    const ai = new FakeAI(Promise.reject(failure));
    await expect(
      new WindowsDialogueSuggestionService(gateway, ai, fixedRandomness).load(
        'campaign-tavern',
        'NPC_DIALOGUE',
        'npc-owner',
      ),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof DialogueSuggestionServiceError &&
        error.code === 'GENERATION_FAILED' &&
        error.cause === failure,
    );
    expect(gateway.commits).toEqual([]);
  });
});

class FakeGateway {
  public readonly commits: Readonly<Record<string, unknown>>[] = [];
  public constructor(private readonly cached: unknown | null = null) {}
  public async prepare() {
    return { input, contextDigest: digest, cached: this.cached };
  }
  public async commit(command: Readonly<Record<string, unknown>>) {
    this.commits.push(command);
    return set('GENERATED');
  }
}

class FakeAI implements DesktopAIEngine {
  public readonly inputs: unknown[] = [];
  public constructor(private readonly result: Promise<unknown> = Promise.resolve(execution())) {}
  public async execute(_task: never, received: unknown): Promise<never> {
    this.inputs.push(received);
    return (await this.result) as never;
  }
}

const fixedRandomness = {
  async resolveTemperature() {
    return 0.7;
  },
};

function execution() {
  return {
    request: { promptVersion: 1 },
    response: { content: JSON.stringify(output) },
    validatedOutput: output,
  };
}

function set(source: 'CACHE' | 'GENERATED') {
  return {
    cacheId: 'suggestion-cache-1',
    campaignId: 'campaign-tavern',
    scopeKind: 'NPC_DIALOGUE',
    scopeId: 'npc-owner',
    contextDigest: digest,
    suggestions: output.suggestions.map((suggestion, index) => ({
      id: `suggestion-${index + 1}`,
      ...suggestion,
    })),
    source,
    createdAt: '2026-08-24T00:00:00Z',
  };
}

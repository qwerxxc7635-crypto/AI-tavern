import { describe, expect, it, vi } from 'vitest';

import type { DynamicQuestPreparation } from '@ember-tavern/contracts';

import type { DesktopAIEngine } from './desktop-ai-orchestrator.js';
import {
  DynamicQuestSourceService,
  DynamicQuestSourceServiceError,
  type DynamicQuestSourceGateway,
} from './dynamic-quest-source-service.js';
import type { QuestBoardSnapshot } from './quest-board-service.js';

const digest = 'b'.repeat(64);
const sourceInput = {
  world: {
    name: 'Ember Coast',
    currentRegion: 'Ash Harbor',
    summary: 'A storm coast.',
    coreConflict: 'The beacon is failing.',
    technologyLevel: 'Iron',
    powerRules: ['Magic is rare.'],
  },
  tavernName: 'Ember Rest',
  publisher: {
    id: 'npc-source',
    name: 'Ilyra',
    identity: 'Keeper',
    personality: 'Steady',
    goal: 'Protect the harbor',
    currentMood: 'Calm',
  },
  availableNpcs: [
    {
      id: 'npc-source',
      name: 'Ilyra',
      identity: 'Keeper',
      personality: 'Steady',
      goal: 'Protect the harbor',
      currentMood: 'Calm',
    },
  ],
  playerConcept: 'Scout',
  recentQuestTitles: [],
  recentQuestStructures: [],
  dynamicSource: {
    kind: 'PLAYER_ACTION',
    occurrenceId: 'event-action',
    entityKind: 'PLAYER_ACTION',
    entityId: 'adventure-one',
    summary: 'The player protects the beacon road.',
    actorNpcId: null,
    visibility: 'PLAYER_VISIBLE',
    playerIntervened: true,
  },
  relevantFacts: [],
  constitution: {
    revision: 1,
    technology: 'Iron',
    magic: 'Rare',
    society: 'Guilds',
    politics: 'Council',
    economy: 'Trade',
    taboos: ['No resurrection'],
  },
  generationBudget: {
    policyVersion: 1,
    openQuestLimit: 12,
    currentOpenQuests: 0,
    remainingSlots: 12,
  },
};
const generatedOutput = {
  content: {
    title: 'Guard the Beacon Road',
    summary: 'Wardens need a path through the storm.',
    objective: 'Escort the repair crew to the beacon.',
    failureCost: 'The harbor loses its warning light.',
  },
  risk: 'MODERATE',
  recommendedAttributes: ['agility', 'knowledge'],
  expectedTurns: { min: 8, max: 10 },
  rewardTier: 'NOTABLE',
  relatedNpcIds: ['npc-source'],
  relatedFactIds: [],
};

describe('DynamicQuestSourceService', () => {
  it('coalesces one explicit source and commits the exact source-bound generation context', async () => {
    const gateway = new FakeGateway(preparation(null));
    const ai = new FakeAI();
    const service = new DynamicQuestSourceService(gateway, ai, identity, fixedRandomness);

    const [first, second] = await Promise.all([
      service.createFromSource('campaign-dynamic', 'PLAYER_ACTION', 'event-action'),
      service.createFromSource('campaign-dynamic', 'PLAYER_ACTION', 'event-action'),
    ]);

    expect(first).toBe(second);
    expect(gateway.prepare).toHaveBeenCalledTimes(1);
    expect(ai.inputs).toEqual([sourceInput]);
    expect(gateway.commits).toHaveLength(1);
    expect(gateway.commits[0]).toMatchObject({
      campaignId: 'campaign-dynamic',
      sourceKind: 'PLAYER_ACTION',
      occurrenceId: 'event-action',
      expectedContextDigest: digest,
      generation: {
        idempotencyKey: 'quest:dynamic:player_action:event-action',
        context: {
          campaignId: 'campaign-dynamic',
          sourceKind: 'PLAYER_ACTION',
          occurrenceId: 'event-action',
          contextDigest: digest,
        },
      },
    });
  });

  it('loads the existing quest without invoking AI for a replayed source', async () => {
    const gateway = new FakeGateway(preparation('quest-existing'));
    const ai = new FakeAI();
    const service = new DynamicQuestSourceService(gateway, ai, identity, fixedRandomness);

    await service.createFromSource('campaign-dynamic', 'PLAYER_ACTION', 'event-action');

    expect(ai.inputs).toEqual([]);
    expect(gateway.load).toHaveBeenCalledTimes(1);
    expect(gateway.commits).toEqual([]);
  });

  it('preserves a budget preparation rejection as the service error cause', async () => {
    const rejection = new Error('budget exceeded');
    const gateway = new FakeGateway(Promise.reject(rejection));
    const service = new DynamicQuestSourceService(gateway, new FakeAI(), identity, fixedRandomness);

    await expect(
      service.createFromSource('campaign-dynamic', 'WORLD_EVENT', 'event-world'),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof DynamicQuestSourceServiceError &&
        error.code === 'PREPARE_FAILED' &&
        error.cause === rejection,
    );
    expect(gateway.commits).toEqual([]);
  });
});

class FakeGateway implements DynamicQuestSourceGateway {
  public readonly commits: Readonly<Record<string, unknown>>[] = [];
  public readonly prepare = vi.fn(async () => this.resolvePreparation());
  public readonly load = vi.fn(async () => snapshot);

  public constructor(
    private readonly prepared: DynamicQuestPreparation | Promise<DynamicQuestPreparation>,
  ) {}

  public async commit(command: Readonly<Record<string, unknown>>): Promise<QuestBoardSnapshot> {
    this.commits.push(command);
    return snapshot;
  }

  private resolvePreparation(): Promise<DynamicQuestPreparation> {
    return Promise.resolve(this.prepared);
  }
}

class FakeAI implements DesktopAIEngine {
  public readonly inputs: unknown[] = [];

  public async execute(_task: never, input: unknown): Promise<never> {
    this.inputs.push(input);
    return {
      request: { promptVersion: 3 },
      response: { content: JSON.stringify(generatedOutput) },
      validatedOutput: generatedOutput,
    } as never;
  }
}

function preparation(existingQuestId: string | null): DynamicQuestPreparation {
  return {
    campaignId: 'campaign-dynamic',
    source: sourceInput.dynamicSource,
    publisherNpcId: 'npc-source',
    relevantFacts: [],
    constitution: sourceInput.constitution,
    budget: sourceInput.generationBudget,
    initialStatus: 'ACTIVE',
    contextDigest: digest,
    existingQuestId,
    input: sourceInput,
  } as unknown as DynamicQuestPreparation;
}

function identity() {
  return {
    requestId: 'dynamic-quest-request-test',
    generationRecordId: 'dynamic-quest-generation-test',
  } as never;
}

const fixedRandomness = {
  async resolveTemperature() {
    return 0.7;
  },
};

const snapshot = Object.freeze({
  campaignId: 'campaign-dynamic',
  campaignState: 'TAVERN',
  source: Object.freeze({}),
  quests: Object.freeze([]),
}) as unknown as QuestBoardSnapshot;

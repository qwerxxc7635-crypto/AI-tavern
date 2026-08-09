import { describe, expect, it } from 'vitest';

import { FakeAIProvider, questStructureSignature } from '@ember-tavern/ai-core';

import {
  WindowsQuestBoardService,
  type QuestBoardGateway,
  type QuestBoardSnapshot,
} from './quest-board-service.js';

describe('WindowsQuestBoardService', () => {
  it('generates two validated quests once and accepts only through the gateway', async () => {
    const gateway = new MemoryQuestGateway();
    let identity = 0;
    const service = new WindowsQuestBoardService(gateway, new FakeAIProvider(), () => {
      identity += 1;
      return {
        requestId: `quest-request-${identity}`,
        generationRecordId: `quest-generation-${identity}`,
        idempotencyKey: `quest-key-${identity}`,
      };
    });

    const [first, second] = await Promise.all([
      service.initialize('campaign-tavern'),
      service.initialize('campaign-tavern'),
    ]);
    expect(first.quests).toHaveLength(2);
    expect(second).toBe(first);
    expect(gateway.commits).toHaveLength(2);
    expect(gateway.commits.map(({ publisherNpcId }) => publisherNpcId)).toEqual([
      'npc-owner',
      'npc-resident',
    ]);
    expect(gateway.inputs[1]).toMatchObject({
      recentQuestTitles: ['The Fading Beacon'],
      recentQuestStructures: ['moderate|notable|8-12|agility,knowledge'],
    });

    const accepted = await service.accept('campaign-tavern', required(first.quests[0]).id);
    expect(accepted.quests[0]?.status).toBe('ACCEPTED');
    expect(gateway.accepts).toEqual(['quest-1']);
  });
});

class MemoryQuestGateway implements QuestBoardGateway {
  public readonly commits: Parameters<QuestBoardGateway['commit']>[0][] = [];
  public readonly inputs: unknown[] = [];
  public readonly accepts: string[] = [];
  private snapshot = emptySnapshot();

  public async load() {
    return this.snapshot;
  }

  public async commit(command: Parameters<QuestBoardGateway['commit']>[0]) {
    this.commits.push(command);
    this.inputs.push(command.generation.input);
    const output = command.generation.validatedOutput as {
      content: QuestBoardSnapshot['quests'][number]['content'];
      risk: QuestBoardSnapshot['quests'][number]['risk'];
      recommendedAttributes: QuestBoardSnapshot['quests'][number]['recommendedAttributes'];
      expectedTurns: { min: number; max: number };
      rewardTier: QuestBoardSnapshot['quests'][number]['rewardTier'];
    };
    const publisher = required(
      this.snapshot.source.availableNpcs.find(({ id }) => id === command.publisherNpcId),
    );
    const quest = {
      id: `quest-${this.snapshot.quests.length + 1}`,
      publisherNpcId: publisher.id,
      publisherName: publisher.name,
      content: output.content,
      status: 'AVAILABLE' as const,
      risk: output.risk,
      recommendedAttributes: output.recommendedAttributes,
      expectedTurnsMin: output.expectedTurns.min,
      expectedTurnsMax: output.expectedTurns.max,
      rewardTier: output.rewardTier,
      createdAt: '2026-07-31T06:00:00.000Z',
      updatedAt: '2026-07-31T06:00:00.000Z',
    };
    this.snapshot = {
      ...this.snapshot,
      quests: [...this.snapshot.quests, quest],
      source: {
        ...this.snapshot.source,
        recentQuestTitles: [...this.snapshot.source.recentQuestTitles, quest.content.title],
        recentQuestStructures: [
          ...this.snapshot.source.recentQuestStructures,
          questStructureSignature({
            risk: quest.risk,
            rewardTier: quest.rewardTier,
            expectedTurns: { min: quest.expectedTurnsMin, max: quest.expectedTurnsMax },
            recommendedAttributes: quest.recommendedAttributes,
          }),
        ],
      },
    };
    return this.snapshot;
  }

  public async accept(_campaignId: string, questId: string) {
    this.accepts.push(questId);
    this.snapshot = {
      ...this.snapshot,
      quests: this.snapshot.quests.map((quest) =>
        quest.id === questId ? { ...quest, status: 'ACCEPTED' as const } : quest,
      ),
    };
    return this.snapshot;
  }
}

function emptySnapshot(): QuestBoardSnapshot {
  return {
    campaignId: 'campaign-tavern',
    campaignState: 'TAVERN',
    source: {
      tavernId: 'tavern-rest',
      tavernName: 'Ember Rest',
      playerCharacterId: 'character-player',
      playerConcept: 'Curious scout',
      world: {
        name: 'Ember Coast',
        currentRegion: 'Ash Harbor',
        summary: 'A storm-bound coast.',
        coreConflict: 'The lighthouse is fading.',
        technologyLevel: 'Late medieval',
        powerRules: ['Magic leaves warmth.'],
      },
      availableNpcs: [npc('npc-owner', 'Ilyra Venn'), npc('npc-resident', 'Tomas Reed')],
      recentQuestTitles: [],
      recentQuestStructures: [],
    },
    quests: [],
  };
}

function npc(id: string, name: string) {
  return {
    id,
    name,
    identity: 'Innkeeper',
    personality: 'Observant',
    goal: 'Keep the road open.',
    currentMood: 'Concerned',
  };
}

function required<Value>(value: Value | undefined): Value {
  if (value === undefined) throw new Error('Expected test fixture value');
  return value;
}

import { describe, expect, it } from 'vitest';

import { FakeAIProvider } from '@ember-tavern/ai-core';

import {
  WindowsNpcDialogueService,
  type NpcDialogueGateway,
  type NpcDialogueSnapshot,
} from './npc-dialogue-service.js';

describe('WindowsNpcDialogueService', () => {
  it('sends consecutive validated replies with prior messages in the next context', async () => {
    const gateway = new MemoryDialogueGateway();
    let identity = 0;
    const service = new WindowsNpcDialogueService(gateway, new FakeAIProvider(), () => {
      identity += 1;
      return {
        requestId: `request-${identity}`,
        generationRecordId: `generation-${identity}`,
        idempotencyKey: `dialogue-${identity}`,
      };
    });

    const first = await service.send('campaign-tavern', 'npc-owner', 'Show me the cellar.');
    expect(first.messages.map(({ role }) => role)).toEqual(['PLAYER', 'NPC']);
    expect(first.relationship.trust).toBe(1);

    const second = await service.send('campaign-tavern', 'npc-owner', 'What is warm down there?');
    expect(second.messages).toHaveLength(4);
    expect(second.relationship.trust).toBe(2);
    expect(gateway.inputs[1]).toMatchObject({
      playerMessage: 'What is warm down there?',
      recentMessages: [
        { role: 'PLAYER', content: 'Show me the cellar.' },
        {
          role: 'NPC',
          content: 'I will show you the cellar door, but stay close and touch nothing warm.',
        },
      ],
    });
  });
});

class MemoryDialogueGateway implements NpcDialogueGateway {
  public readonly inputs: unknown[] = [];
  private snapshot = emptySnapshot();

  public async load(): Promise<NpcDialogueSnapshot> {
    return this.snapshot;
  }

  public async commit(command: Parameters<NpcDialogueGateway['commit']>[0]) {
    this.inputs.push(command.generation.input);
    const output = command.generation.validatedOutput as {
      reply: string;
      mood: string;
      suggestedTopics: string[];
      relationshipProposal: { trust?: number };
    };
    const nextMessages = [
      ...this.snapshot.messages,
      message(`player-${this.snapshot.messages.length}`, 'PLAYER', command.playerMessage),
      message(`npc-${this.snapshot.messages.length}`, 'NPC', output.reply),
    ];
    this.snapshot = {
      ...this.snapshot,
      conversationId: 'conversation-owner',
      npc: { ...this.snapshot.npc, currentMood: output.mood },
      relationship: {
        ...this.snapshot.relationship,
        trust: this.snapshot.relationship.trust + (output.relationshipProposal.trust ?? 0),
      },
      messages: nextMessages,
      suggestedTopics: output.suggestedTopics,
      generationContext: {
        ...this.snapshot.generationContext,
        npc: {
          ...(this.snapshot.generationContext['npc'] as Record<string, unknown>),
          currentMood: output.mood,
        },
        relationship: {
          ...this.snapshot.relationship,
          trust: this.snapshot.relationship.trust + (output.relationshipProposal.trust ?? 0),
        },
        recentMessages: nextMessages.map(({ role, content }) => ({ role, content })),
      },
    };
    return this.snapshot;
  }
}

function emptySnapshot(): NpcDialogueSnapshot {
  const npc = {
    id: 'npc-owner',
    name: 'Ilyra Venn',
    identity: 'Innkeeper',
    appearance: 'A weathered red coat.',
    personality: 'Practical and observant.',
    currentMood: 'Concerned',
  };
  const relationship = { trust: 0, closeness: 0, awe: 0, obligation: 0 };
  return {
    campaignId: 'campaign-tavern',
    conversationId: null,
    npc,
    relationship,
    messages: [],
    suggestedTopics: [],
    generationContext: {
      worldSummary: 'A storm-bound coast.',
      currentRegion: 'Ash Harbor',
      npc: {
        ...npc,
        goal: 'Keep the road open.',
        secret: 'A sealed tunnel reaches the lighthouse.',
        speechStyle: 'Measured statements.',
        currentStatus: 'ACTIVE',
      },
      relationship,
      knowledge: [],
      recentMessages: [],
      longTermMemories: [],
    },
  };
}

function message(id: string, role: 'PLAYER' | 'NPC', content: string) {
  return {
    id,
    sequenceNumber: Number(id.split('-')[1]) + 1,
    role,
    content,
    createdAt: '2026-07-31T05:00:00.000Z',
  };
}

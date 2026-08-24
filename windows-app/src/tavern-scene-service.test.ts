import { describe, expect, it } from 'vitest';

import { isoTimestamp, type TavernSceneSnapshot } from '@ember-tavern/contracts';
import type { DesktopAIEngine } from './desktop-ai-orchestrator.js';
import { TavernSceneService, type TavernSceneGateway } from './tavern-scene-service.js';

describe('TavernSceneService', () => {
  it('generates every actor independently and coalesces a concurrent turn', async () => {
    const gateway = new MemorySceneGateway();
    const engine: DesktopAIEngine = {
      async execute(_task, rawInput, options) {
        const input = rawInput as { actor: { id: string }; authorizedKnowledge: { id: string }[] };
        const output = {
          actorId: input.actor.id,
          action: input.actor.id === 'npc-a' ? 'SPEAK' : 'SILENCE',
          targetNpcId: null,
          utterance: input.actor.id === 'npc-a' ? 'I know my own fact.' : null,
          citedKnowledgeIds: input.authorizedKnowledge.map(({ id }) => id),
          urgency: 1,
          rationale: 'Own goal and knowledge.',
        };
        return {
          request: { requestId: options.requestId, promptVersion: 1 },
          response: { content: JSON.stringify(output) },
          validatedOutput: output,
        } as never;
      },
    };
    const service = new TavernSceneService(gateway, engine);
    const scene = snapshot();
    const first = service.send('campaign-1', scene, 'Who knows?', 'npc-a');
    const second = service.send('campaign-1', scene, 'Who knows?', 'npc-a');
    expect(second).toBe(first);
    await first;
    expect(gateway.commits).toHaveLength(1);
    const generations = gateway.commits[0]?.generations ?? [];
    expect(generations.map(({ actorId }) => actorId)).toEqual(['npc-a', 'npc-b']);
    expect(generations[0]?.generation.input).toMatchObject({
      authorizedKnowledge: [{ id: 'knowledge-a' }],
    });
    expect(generations[1]?.generation.input).toMatchObject({
      authorizedKnowledge: [{ id: 'knowledge-b' }],
    });
  });
});

class MemorySceneGateway implements TavernSceneGateway {
  public readonly commits: Parameters<TavernSceneGateway['commit']>[0][] = [];
  public async start() {
    return snapshot();
  }
  public async prepare(command: Parameters<TavernSceneGateway['prepare']>[0]) {
    return {
      scene: snapshot(),
      actorInputs: ['npc-a', 'npc-b'].map((actorId) => ({
        actorId,
        authorizedKnowledgeIds: [`knowledge-${actorId.slice(-1)}`],
        input: {
          sceneId: command.sceneId,
          sceneRevision: 1,
          actor: {
            id: actorId,
            name: actorId,
            populationRole: 'patron',
            currentBehavior: 'Listens.',
            personality: null,
            goals: [],
          },
          visibleParticipants: [
            { id: 'npc-a', name: 'A', populationRole: 'patron', status: 'ACTIVE' },
            { id: 'npc-b', name: 'B', populationRole: 'patron', status: 'LISTENING' },
          ],
          authorizedKnowledge: [
            { id: `knowledge-${actorId.slice(-1)}`, content: 'Actor private fact.' },
          ],
          memories: [],
          recentPublicTurns: [],
          playerIntent: command.playerIntent,
          addressedNpcId: command.addressedNpcId,
          allowedActions: actorId === 'npc-a' ? ['SPEAK', 'SILENCE'] : ['INTERVENE', 'SILENCE'],
        },
      })),
    };
  }
  public async commit(command: Parameters<TavernSceneGateway['commit']>[0]) {
    this.commits.push(command);
    return { ...snapshot(), revision: 2 };
  }
}

function snapshot(): TavernSceneSnapshot {
  const at = isoTimestamp('2026-01-01T00:00:00.000Z');
  return {
    id: 'scene-1',
    campaignId: 'campaign-1' as TavernSceneSnapshot['campaignId'],
    tavernId: 'tavern-1',
    revision: 1,
    status: 'ACTIVE',
    participants: [
      {
        npcId: 'npc-a',
        name: 'A',
        populationRole: 'patron',
        status: 'ACTIVE',
        joinedAt: at,
        leftAt: null,
      },
      {
        npcId: 'npc-b',
        name: 'B',
        populationRole: 'patron',
        status: 'LISTENING',
        joinedAt: at,
        leftAt: null,
      },
    ],
    turns: [],
    createdAt: at,
    updatedAt: at,
  };
}

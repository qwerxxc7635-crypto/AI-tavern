import { describe, expect, it } from 'vitest';

import {
  isoTimestamp,
  type NpcTimelineOperation,
  type TavernSceneSnapshot,
} from '@ember-tavern/contracts';
import { classifyApplicationError } from '@ember-tavern/ai-core';
import type { DesktopAIEngine } from './desktop-ai-orchestrator.js';
import type { NpcTimelineService } from './npc-timeline-service.js';
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
    const service = new TavernSceneService(gateway, engine, undefined, memoryTimeline());
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

  it('retries every actor in the same order and commits the scene only once', async () => {
    const gateway = new MemorySceneGateway();
    const timeline = new StatefulSceneTimeline();
    let failed = false;
    const requests: string[] = [];
    const engine: DesktopAIEngine = {
      async execute(_task, rawInput, options) {
        const input = rawInput as { actor: { id: string }; authorizedKnowledge: { id: string }[] };
        requests.push(`${input.actor.id}:${options.requestId}`);
        if (input.actor.id === 'npc-b' && !failed) {
          failed = true;
          throw { code: 'NETWORK_FAILED' };
        }
        const output = {
          actorId: input.actor.id,
          action: input.actor.id === 'npc-a' ? 'SPEAK' : 'SILENCE',
          targetNpcId: null,
          utterance: input.actor.id === 'npc-a' ? 'I remember the road.' : null,
          citedKnowledgeIds: input.authorizedKnowledge.map(({ id }) => id),
          urgency: 1,
          rationale: 'Own knowledge.',
        };
        return {
          request: { requestId: options.requestId, promptVersion: 1 },
          response: { content: JSON.stringify(output) },
          validatedOutput: output,
        } as never;
      },
    };
    const service = new TavernSceneService(gateway, engine, undefined, timeline);
    const scene = snapshot();

    await expect(service.send('campaign-1', scene, 'Who knows?', 'npc-a')).rejects.toMatchObject({
      code: 'NETWORK_FAILED',
    });
    await expect(service.retry('campaign-1', scene)).resolves.toMatchObject({ revision: 2 });

    expect(gateway.commits).toHaveLength(1);
    expect(gateway.commits[0]?.generations.map(({ actorId }) => actorId)).toEqual([
      'npc-a',
      'npc-b',
    ]);
    expect(timeline.operation?.attempts).toHaveLength(2);
    expect(timeline.operation?.attempts[0]?.idempotencyKeys).toEqual(
      timeline.operation?.attempts[1]?.idempotencyKeys,
    );
    expect(requests.map((entry) => entry.split(':')[0])).toEqual([
      'npc-a',
      'npc-b',
      'npc-a',
      'npc-b',
    ]);
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

function memoryTimeline(): Pick<NpcTimelineService, 'latest' | 'begin' | 'recordFailure'> {
  return {
    async latest() {
      return null;
    },
    async begin(intent, identity, existing) {
      const at = isoTimestamp('2026-01-01T00:00:00.000Z');
      return {
        id: existing?.id ?? 'timeline-scene-operation',
        operationId: existing?.operationId ?? 'timeline-scene-operation-key',
        campaignId: intent.campaignId,
        scopeKind: intent.scopeKind,
        scopeId: intent.scopeId,
        playerIntent: intent.playerIntent,
        addressedNpcId: intent.addressedNpcId,
        hardResultKey: intent.hardResultKey,
        status: 'PENDING',
        committedRefId: null,
        attempts: [
          {
            id: identity.attemptId,
            sequence: 1,
            requestIds: identity.requestIds,
            generationRecordIds: identity.generationRecordIds,
            idempotencyKeys: identity.idempotencyKeys,
            status: 'STARTED',
            errorKind: null,
            errorCode: null,
            retryable: null,
            startedAt: at,
            completedAt: null,
          },
        ],
        createdAt: at,
        updatedAt: at,
      } satisfies NpcTimelineOperation;
    },
    async recordFailure(_operation, _attemptId, error) {
      throw error;
    },
  };
}

class StatefulSceneTimeline implements Pick<
  NpcTimelineService,
  'latest' | 'begin' | 'recordFailure'
> {
  public operation: NpcTimelineOperation | null = null;

  public async latest() {
    return this.operation;
  }

  public async begin(
    intent: Parameters<NpcTimelineService['begin']>[0],
    identity: Parameters<NpcTimelineService['begin']>[1],
    existing: NpcTimelineOperation | null = null,
  ) {
    const at = isoTimestamp('2026-01-01T00:00:00.000Z');
    this.operation = Object.freeze({
      id: existing?.id ?? 'timeline-scene-operation',
      operationId: existing?.operationId ?? 'timeline-scene-operation-key',
      campaignId: intent.campaignId,
      scopeKind: intent.scopeKind,
      scopeId: intent.scopeId,
      playerIntent: intent.playerIntent,
      addressedNpcId: intent.addressedNpcId,
      hardResultKey: intent.hardResultKey,
      status: 'PENDING',
      committedRefId: null,
      attempts: Object.freeze([
        ...(existing?.attempts ?? []),
        {
          id: identity.attemptId,
          sequence: (existing?.attempts.length ?? 0) + 1,
          requestIds: identity.requestIds,
          generationRecordIds: identity.generationRecordIds,
          idempotencyKeys: identity.idempotencyKeys,
          status: 'STARTED' as const,
          errorKind: null,
          errorCode: null,
          retryable: null,
          startedAt: at,
          completedAt: null,
        },
      ]),
      createdAt: existing?.createdAt ?? at,
      updatedAt: at,
    });
    return this.operation;
  }

  public async recordFailure(_operation: NpcTimelineOperation, attemptId: string, error: unknown) {
    const classified = classifyApplicationError(error);
    if (this.operation === null) throw new Error('missing timeline');
    const at = isoTimestamp('2026-01-01T00:01:00.000Z');
    this.operation = Object.freeze({
      ...this.operation,
      status: classified.retryable ? 'FAILED_RETRYABLE' : 'FAILED_FINAL',
      attempts: Object.freeze(
        this.operation.attempts.map((attempt) =>
          attempt.id === attemptId
            ? Object.freeze({
                ...attempt,
                status: 'FAILED' as const,
                errorKind: classified.kind,
                errorCode: classified.code,
                retryable: classified.retryable,
                completedAt: at,
              })
            : attempt,
        ),
      ),
      updatedAt: at,
    });
    return classified;
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

import { describe, expect, it } from 'vitest';

import { FakeAIProvider, classifyApplicationError } from '@ember-tavern/ai-core';
import { isoTimestamp, type NpcTimelineOperation } from '@ember-tavern/contracts';

import type { DesktopAIEngine } from './desktop-ai-orchestrator.js';

import {
  WindowsNpcDialogueService,
  type NpcDialogueGateway,
  type NpcDialogueSnapshot,
} from './npc-dialogue-service.js';
import type { NpcTimelineService } from './npc-timeline-service.js';

describe('WindowsNpcDialogueService', () => {
  it('sends consecutive validated replies with prior messages in the next context', async () => {
    const gateway = new MemoryDialogueGateway();
    let identity = 0;
    const service = new WindowsNpcDialogueService(
      gateway,
      new FakeAIProvider(),
      () => {
        identity += 1;
        return {
          requestId: `request-${identity}`,
          generationRecordId: `generation-${identity}`,
          idempotencyKey: `dialogue-${identity}`,
        };
      },
      undefined,
      memoryTimeline(),
    );

    const first = await service.send('campaign-tavern', 'npc-owner', 'Show me the cellar.');
    expect(first.messages.map(({ role }) => role)).toEqual(['PLAYER', 'NPC']);
    expect(first.relationship.trust).toBe(1);

    const second = await service.send('campaign-tavern', 'npc-owner', 'What is warm down there?');
    expect(second.messages).toHaveLength(4);
    expect(second.relationship.trust).toBe(2);
    expect(gateway.inputs[1]).toMatchObject({
      playerMessage: 'What is warm down there?',
      relevantLore: [],
      recentMessages: [
        { role: 'PLAYER', content: 'Show me the cellar.' },
        {
          role: 'NPC',
          content: 'I will show you the cellar door, but stay close and touch nothing warm.',
        },
      ],
    });

    for (let turn = 3; turn <= 12; turn += 1) {
      await expect(
        service.send('campaign-tavern', 'npc-owner', `Continue the conversation ${turn}.`),
      ).resolves.toMatchObject({ relationship: { trust: Math.min(turn, 5) } });
    }
  });

  it('retries a network failure with the locked intent and stable idempotency key', async () => {
    const gateway = new MemoryDialogueGateway();
    const timeline = new StatefulTimeline();
    const requests: string[] = [];
    let executions = 0;
    const engine: DesktopAIEngine = {
      async execute(_task, _input, options) {
        requests.push(options.requestId);
        executions += 1;
        if (executions === 1) throw { code: 'TIMEOUT' };
        const output = {
          reply: 'The cellar seal is intact.',
          mood: 'Wary',
          suggestedTopics: ['The old tunnel', 'The cellar seal', 'The lighthouse road'],
          memoryCandidate: null,
          relationshipProposal: { trust: 1 },
        };
        return {
          request: { requestId: options.requestId, promptVersion: 3 },
          response: { content: JSON.stringify(output) },
          validatedOutput: output,
        } as never;
      },
    };
    let identity = 0;
    const service = new WindowsNpcDialogueService(
      gateway,
      engine,
      () => {
        identity += 1;
        return {
          requestId: `request-${identity}`,
          generationRecordId: `generation-${identity}`,
          idempotencyKey: `dialogue-key-${identity}`,
        };
      },
      undefined,
      timeline,
    );

    await expect(
      service.send('campaign-tavern', 'npc-owner', 'Tell me about the cellar.'),
    ).rejects.toMatchObject({ code: 'TIMEOUT' });
    expect(timeline.operation).toMatchObject({
      status: 'FAILED_RETRYABLE',
      playerIntent: 'Tell me about the cellar.',
    });

    await expect(service.retry('campaign-tavern', 'npc-owner')).resolves.toMatchObject({
      messages: [{ role: 'PLAYER' }, { role: 'NPC' }],
    });
    expect(gateway.inputs).toHaveLength(1);
    expect(requests).toEqual(['request-1', 'request-2']);
    expect(timeline.operation?.attempts.map(({ idempotencyKeys }) => idempotencyKeys[0])).toEqual([
      'dialogue-key-1',
      'dialogue-key-1',
    ]);
    expect(timeline.operation?.attempts.map(({ requestIds }) => requestIds[0])).toEqual([
      'request-1',
      'request-2',
    ]);
  });

  it('recovers a committed reply when the native response is lost without committing twice', async () => {
    const gateway = new MemoryDialogueGateway();
    const timeline = new StatefulTimeline();
    gateway.afterCommit = () => timeline.markCommitted('npc-message-1');
    gateway.throwAfterCommit = true;
    const service = new WindowsNpcDialogueService(
      gateway,
      new FakeAIProvider(),
      () => ({
        requestId: 'request-response-loss',
        generationRecordId: 'generation-response-loss',
        idempotencyKey: 'dialogue-response-loss',
      }),
      undefined,
      timeline,
    );

    const saved = await service.send('campaign-tavern', 'npc-owner', 'Show me the cellar.');
    expect(saved.messages).toHaveLength(2);
    expect(gateway.inputs).toHaveLength(1);
    expect(timeline.operation?.status).toBe('COMMITTED');
  });
});

class MemoryDialogueGateway implements NpcDialogueGateway {
  public readonly inputs: unknown[] = [];
  public afterCommit: (() => void) | null = null;
  public throwAfterCommit = false;
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
        trust: Math.min(
          5,
          this.snapshot.relationship.trust + (output.relationshipProposal.trust ?? 0),
        ),
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
          trust: Math.min(
            5,
            this.snapshot.relationship.trust + (output.relationshipProposal.trust ?? 0),
          ),
        },
        recentMessages: nextMessages.slice(-12).map(({ role, content }) => ({ role, content })),
      },
    };
    this.afterCommit?.();
    if (this.throwAfterCommit) throw new Error('native response channel closed');
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
    timeline: null,
  };
}

function memoryTimeline(): Pick<NpcTimelineService, 'latest' | 'begin' | 'recordFailure'> {
  return {
    async latest() {
      return null;
    },
    async begin(intent, identity, existing) {
      const at = isoTimestamp('2026-07-31T05:00:00.000Z');
      return {
        id: existing?.id ?? 'timeline-operation',
        operationId: existing?.operationId ?? 'timeline-operation-key',
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

class StatefulTimeline implements Pick<NpcTimelineService, 'latest' | 'begin' | 'recordFailure'> {
  public operation: NpcTimelineOperation | null = null;

  public async latest() {
    return this.operation;
  }

  public async begin(
    intent: Parameters<NpcTimelineService['begin']>[0],
    identity: Parameters<NpcTimelineService['begin']>[1],
    existing: NpcTimelineOperation | null = null,
  ) {
    const at = isoTimestamp('2026-07-31T05:00:00.000Z');
    const attempt = {
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
    };
    this.operation = Object.freeze({
      id: existing?.id ?? 'timeline-dialogue',
      operationId: existing?.operationId ?? 'timeline-dialogue-operation',
      campaignId: intent.campaignId,
      scopeKind: intent.scopeKind,
      scopeId: intent.scopeId,
      playerIntent: intent.playerIntent,
      addressedNpcId: intent.addressedNpcId,
      hardResultKey: intent.hardResultKey,
      status: 'PENDING',
      committedRefId: null,
      attempts: Object.freeze([...(existing?.attempts ?? []), attempt]),
      createdAt: existing?.createdAt ?? at,
      updatedAt: at,
    });
    return this.operation;
  }

  public async recordFailure(_operation: NpcTimelineOperation, attemptId: string, error: unknown) {
    const classified = classifyApplicationError(error);
    if (this.operation === null) throw new Error('missing timeline');
    const at = isoTimestamp('2026-07-31T05:01:00.000Z');
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

  public markCommitted(committedRefId: string): void {
    if (this.operation === null) throw new Error('missing timeline');
    const at = isoTimestamp('2026-07-31T05:02:00.000Z');
    this.operation = Object.freeze({
      ...this.operation,
      status: 'COMMITTED',
      committedRefId,
      attempts: Object.freeze(
        this.operation.attempts.map((attempt, index, attempts) =>
          index === attempts.length - 1
            ? Object.freeze({ ...attempt, status: 'COMMITTED' as const, completedAt: at })
            : attempt,
        ),
      ),
      updatedAt: at,
    });
  }
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

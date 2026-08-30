import { describe, expect, it } from 'vitest';

import { isoTimestamp, type NpcTimelineOperation } from '@ember-tavern/contracts';

import {
  NpcTimelineService,
  NpcTimelineServiceError,
  type NpcTimelineGateway,
  type NpcTimelineIntent,
} from './npc-timeline-service.js';

const intent: NpcTimelineIntent = {
  campaignId: 'campaign-1',
  scopeKind: 'NPC_DIALOGUE',
  scopeId: 'npc-1',
  playerIntent: 'Ask about the sealed cellar.',
  addressedNpcId: 'npc-1',
  hardResultKey: 'd20-result-17',
};

describe('NpcTimelineService', () => {
  it('keeps the locked intent and hard result across a technical retry', async () => {
    const gateway = new MemoryTimelineGateway();
    const service = new NpcTimelineService(gateway);
    const first = await service.begin(intent, identity('attempt-1', 'request-1'));

    const failure = await service.recordFailure(first, 'attempt-1', { code: 'TIMEOUT' });
    expect(failure).toMatchObject({ kind: 'NETWORK', code: 'TIMEOUT', retryable: true });
    const failed = await service.latest('campaign-1', 'NPC_DIALOGUE', 'npc-1');
    expect(failed).toMatchObject({ status: 'FAILED_RETRYABLE', playerIntent: intent.playerIntent });

    const retried = await service.begin(intent, identity('attempt-2', 'request-2'), failed);
    expect(retried).toMatchObject({
      id: first.id,
      operationId: first.operationId,
      playerIntent: intent.playerIntent,
      hardResultKey: 'd20-result-17',
      status: 'PENDING',
    });
    expect(retried.attempts.map(({ id }) => id)).toEqual(['attempt-1', 'attempt-2']);
  });

  it('rejects native data that changes a locked intent', async () => {
    const gateway = new MemoryTimelineGateway();
    gateway.mutateReturnedIntent = true;
    await expect(
      new NpcTimelineService(gateway).begin(intent, identity('attempt-1', 'request-1')),
    ).rejects.toMatchObject({ code: 'LOCKED_INTENT_MISMATCH' });
  });

  it('seals final failures and committed operations against another attempt', async () => {
    const gateway = new MemoryTimelineGateway();
    const service = new NpcTimelineService(gateway);
    const operation = await service.begin(intent, identity('attempt-1', 'request-1'));
    await service.recordFailure(operation, 'attempt-1', { code: 'AUTHENTICATION_FAILED' });
    const final = await service.latest('campaign-1', 'NPC_DIALOGUE', 'npc-1');
    expect(final?.status).toBe('FAILED_FINAL');
    await expect(service.begin(intent, identity('attempt-2', 'request-2'), final)).rejects.toThrow(
      NpcTimelineServiceError,
    );

    gateway.operation = operationWith(operation, {
      status: 'COMMITTED',
      committedRefId: 'reply-1',
    });
    await expect(
      service.begin(intent, identity('attempt-3', 'request-3'), gateway.operation),
    ).rejects.toThrow(NpcTimelineServiceError);
  });

  it('does not expose Retry when the general application policy is broader than timeline policy', async () => {
    const gateway = new MemoryTimelineGateway();
    const service = new NpcTimelineService(gateway);
    const operation = await service.begin(intent, identity('attempt-1', 'request-1'));
    const failure = await service.recordFailure(operation, 'attempt-1', {
      code: 'CONCURRENT_MODIFICATION',
    });
    expect(failure).toMatchObject({
      kind: 'PERSISTENCE',
      code: 'CONCURRENT_MODIFICATION',
      retryable: false,
      actions: ['DISMISS'],
    });
    expect(gateway.operation?.status).toBe('FAILED_FINAL');
  });
});

class MemoryTimelineGateway implements NpcTimelineGateway {
  public operation: NpcTimelineOperation | null = null;
  public mutateReturnedIntent = false;

  public async latest() {
    return this.operation;
  }

  public async begin(command: Parameters<NpcTimelineGateway['begin']>[0]) {
    if (this.operation !== null) {
      if (this.operation.status !== 'FAILED_RETRYABLE') {
        throw new NpcTimelineServiceError('TIMELINE_TERMINAL');
      }
      if (
        this.operation.id !== command.id ||
        this.operation.operationId !== command.operationId ||
        this.operation.playerIntent !== command.playerIntent ||
        this.operation.hardResultKey !== command.hardResultKey
      ) {
        throw new NpcTimelineServiceError('LOCKED_INTENT_MISMATCH');
      }
    }
    const at = isoTimestamp('2026-08-24T01:00:00.000Z');
    const attempts = [
      ...(this.operation?.attempts ?? []),
      {
        id: command.attemptId,
        sequence: (this.operation?.attempts.length ?? 0) + 1,
        requestIds: command.requestIds,
        generationRecordIds: command.generationRecordIds,
        idempotencyKeys: command.idempotencyKeys,
        status: 'STARTED' as const,
        errorKind: null,
        errorCode: null,
        retryable: null,
        startedAt: at,
        completedAt: null,
      },
    ];
    this.operation = Object.freeze({
      id: command.id,
      operationId: command.operationId,
      campaignId: command.campaignId,
      scopeKind: command.scopeKind,
      scopeId: command.scopeId,
      playerIntent: this.mutateReturnedIntent ? 'Changed by storage' : command.playerIntent,
      addressedNpcId: command.addressedNpcId,
      hardResultKey: command.hardResultKey,
      status: 'PENDING',
      committedRefId: null,
      attempts: Object.freeze(attempts),
      createdAt: this.operation?.createdAt ?? at,
      updatedAt: at,
    });
    return this.operation;
  }

  public async fail(command: Parameters<NpcTimelineGateway['fail']>[0]) {
    if (this.operation === null) throw new NpcTimelineServiceError('TIMELINE_MISSING');
    const retryable = ['TIMEOUT', 'NETWORK_FAILED', 'FACT_CONFLICT'].includes(command.errorCode);
    const at = isoTimestamp('2026-08-24T01:01:00.000Z');
    this.operation = operationWith(this.operation, {
      status: retryable ? 'FAILED_RETRYABLE' : 'FAILED_FINAL',
      attempts: this.operation.attempts.map((attempt) =>
        attempt.id === command.attemptId
          ? Object.freeze({
              ...attempt,
              status: 'FAILED' as const,
              errorKind: command.errorKind,
              errorCode: command.errorCode,
              retryable,
              completedAt: at,
            })
          : attempt,
      ),
      updatedAt: at,
    });
    return this.operation;
  }
}

function identity(attemptId: string, requestId: string) {
  return {
    attemptId,
    requestIds: [requestId],
    generationRecordIds: [`generation-${requestId}`],
    idempotencyKeys: ['stable-idempotency-key'],
  };
}

function operationWith(
  operation: NpcTimelineOperation,
  changes: Partial<NpcTimelineOperation>,
): NpcTimelineOperation {
  return Object.freeze({ ...operation, ...changes });
}

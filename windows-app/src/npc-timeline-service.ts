import { invoke } from '@tauri-apps/api/core';

import {
  ApplicationError,
  classifyApplicationError,
  type ApplicationErrorKind,
} from '@ember-tavern/ai-core';
import {
  NPC_TIMELINE_ATTEMPT_STATUSES,
  NPC_TIMELINE_SCOPE_KINDS,
  NPC_TIMELINE_STATUSES,
  isoTimestamp,
  type NpcTimelineOperation,
  type NpcTimelineScopeKind,
} from '@ember-tavern/contracts';
import { npcTimelineFailure } from '@ember-tavern/domain';

export interface NpcTimelineAttemptIdentity {
  readonly attemptId: string;
  readonly requestIds: readonly string[];
  readonly generationRecordIds: readonly string[];
  readonly idempotencyKeys: readonly string[];
}

export interface NpcTimelineIntent {
  readonly campaignId: string;
  readonly scopeKind: NpcTimelineScopeKind;
  readonly scopeId: string;
  readonly playerIntent: string;
  readonly addressedNpcId: string | null;
  readonly hardResultKey: string | null;
}

export interface NpcTimelineGateway {
  latest(
    campaignId: string,
    scopeKind: NpcTimelineScopeKind,
    scopeId: string,
  ): Promise<NpcTimelineOperation | null>;
  begin(
    command: NpcTimelineIntent &
      NpcTimelineAttemptIdentity & {
        readonly id: string;
        readonly operationId: string;
      },
  ): Promise<NpcTimelineOperation>;
  fail(command: {
    readonly campaignId: string;
    readonly operationId: string;
    readonly attemptId: string;
    readonly errorKind: ApplicationErrorKind;
    readonly errorCode: string;
  }): Promise<NpcTimelineOperation>;
}

export const tauriNpcTimelineGateway: NpcTimelineGateway = {
  async latest(campaignId, scopeKind, scopeId) {
    const value = await invoke<unknown>('npc_timeline_get', { campaignId, scopeKind, scopeId });
    return value === null ? null : parseOperation(value);
  },
  async begin(command) {
    return parseOperation(await invoke<unknown>('npc_timeline_begin', { command }));
  },
  async fail(command) {
    return parseOperation(await invoke<unknown>('npc_timeline_fail', { command }));
  },
};

export class NpcTimelineService {
  public constructor(private readonly gateway: NpcTimelineGateway = tauriNpcTimelineGateway) {}

  public latest(
    campaignId: string,
    scopeKind: NpcTimelineScopeKind,
    scopeId: string,
  ): Promise<NpcTimelineOperation | null> {
    return this.gateway.latest(campaignId, scopeKind, scopeId);
  }

  public async begin(
    intent: NpcTimelineIntent,
    identity: NpcTimelineAttemptIdentity,
    existing: NpcTimelineOperation | null = null,
  ): Promise<NpcTimelineOperation> {
    const suffix = crypto.randomUUID();
    const operation = await this.gateway.begin({
      ...intent,
      ...identity,
      id: existing?.id ?? `npc-timeline-${suffix}`,
      operationId: existing?.operationId ?? `npc-timeline-operation-${suffix}`,
    });
    if (
      operation.playerIntent !== intent.playerIntent ||
      operation.scopeKind !== intent.scopeKind ||
      operation.scopeId !== intent.scopeId ||
      operation.addressedNpcId !== intent.addressedNpcId ||
      operation.hardResultKey !== intent.hardResultKey
    ) {
      throw new NpcTimelineServiceError('LOCKED_INTENT_MISMATCH');
    }
    return operation;
  }

  public async recordFailure(
    operation: NpcTimelineOperation,
    attemptId: string,
    error: unknown,
  ): Promise<ApplicationError> {
    const classified = classifyApplicationError(error);
    const policy = npcTimelineFailure(classified.kind, classified.code);
    try {
      await this.gateway.fail({
        campaignId: operation.campaignId,
        operationId: operation.operationId,
        attemptId,
        errorKind: policy.kind,
        errorCode: policy.code,
      });
    } catch (recordError) {
      throw new NpcTimelineServiceError('FAILURE_AUDIT_FAILED', {
        cause: new AggregateError([error, recordError]),
      });
    }
    return new ApplicationError(
      policy.kind,
      policy.code,
      policy.retryable,
      policy.retryable && classified.fallbackEligible,
      classified.surface,
      { cause: error },
    );
  }
}

export class NpcTimelineServiceError extends Error {
  public constructor(
    public readonly code: string,
    options?: ErrorOptions,
  ) {
    super('NPC timeline operation failed', options);
    this.name = 'NpcTimelineServiceError';
  }
}

function parseOperation(value: unknown): NpcTimelineOperation {
  const record = object(value);
  const scopeKind = member(NPC_TIMELINE_SCOPE_KINDS, record['scopeKind']);
  const status = member(NPC_TIMELINE_STATUSES, record['status']);
  return Object.freeze({
    id: text(record['id']),
    operationId: text(record['operationId']),
    campaignId: text(record['campaignId']),
    scopeKind,
    scopeId: text(record['scopeId']),
    playerIntent: text(record['playerIntent']),
    addressedNpcId: nullableText(record['addressedNpcId']),
    hardResultKey: nullableText(record['hardResultKey']),
    status,
    committedRefId: nullableText(record['committedRefId']),
    attempts: Object.freeze(
      array(record['attempts']).map((value) => {
        const attempt = object(value);
        const retryable = attempt['retryable'];
        if (retryable !== null && typeof retryable !== 'boolean')
          throw new TypeError('Timeline retry flag is invalid');
        return Object.freeze({
          id: text(attempt['id']),
          sequence: positiveInteger(attempt['sequence']),
          requestIds: Object.freeze(array(attempt['requestIds']).map(text)),
          generationRecordIds: Object.freeze(array(attempt['generationRecordIds']).map(text)),
          idempotencyKeys: Object.freeze(array(attempt['idempotencyKeys']).map(text)),
          status: member(NPC_TIMELINE_ATTEMPT_STATUSES, attempt['status']),
          errorKind: nullableText(attempt['errorKind']),
          errorCode: nullableText(attempt['errorCode']),
          retryable,
          startedAt: isoTimestamp(text(attempt['startedAt'])),
          completedAt:
            attempt['completedAt'] === null ? null : isoTimestamp(text(attempt['completedAt'])),
        });
      }),
    ),
    createdAt: isoTimestamp(text(record['createdAt'])),
    updatedAt: isoTimestamp(text(record['updatedAt'])),
  });
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new TypeError('Timeline value must be an object');
  return value as Record<string, unknown>;
}
function array(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) throw new TypeError('Timeline value must be an array');
  return value;
}
function text(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0)
    throw new TypeError('Timeline text is invalid');
  return value;
}
function nullableText(value: unknown): string | null {
  return value === null ? null : text(value);
}
function positiveInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1)
    throw new TypeError('Timeline number is invalid');
  return value as number;
}
function member<const Values extends readonly string[]>(
  values: Values,
  value: unknown,
): Values[number] {
  if (typeof value !== 'string' || !values.includes(value))
    throw new TypeError('Timeline enum is invalid');
  return value as Values[number];
}

export const npcTimelineService = new NpcTimelineService();

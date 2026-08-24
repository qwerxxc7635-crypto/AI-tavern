import {
  PREFETCH_EVENT_KINDS,
  PREFETCH_EVENT_REASONS,
  PREFETCH_PREDICTION_REASONS,
  PREFETCH_PRIORITIES,
  PREFETCH_STATES,
  campaignId,
  isoTimestamp,
  type CampaignId,
  type IsoTimestamp,
  type PrefetchCandidate,
  type PrefetchCandidateSeed,
  type PrefetchEvent,
  type PrefetchEventReason,
  type PrefetchMetrics,
} from '@ember-tavern/contracts';

import { PersistenceDataError } from './campaign-repository.js';
import {
  requireEnum,
  requireNullableString,
  requireNumber,
  requireRecord,
  requireString,
} from './persistence-validation.js';
import type { TransactionalSqliteDatabase } from './sqlite-port.js';

const MAX_CANDIDATES = 256;
const MAX_EVENTS = 4_096;
const OPEN_STATES = ['PREDICTED', 'RUNNING', 'READY'] as const;

interface StartPrefetch {
  readonly id: string;
  readonly executionId: string;
  readonly processId: string;
  readonly occurredAt: IsoTimestamp;
  readonly queueWaitMs: number;
}

interface ReadyPrefetch {
  readonly id: string;
  readonly executionId: string;
  readonly processId: string;
  readonly occurredAt: IsoTimestamp;
  readonly generationMs: number;
}

export class PrefetchRepository {
  public constructor(private readonly database: TransactionalSqliteDatabase) {}

  public savePredictions(seeds: readonly PrefetchCandidateSeed[]): readonly PrefetchCandidate[] {
    if (seeds.length === 0) return Object.freeze([]);
    if (seeds.length > 4) throw new PersistenceDataError('Prefetch prediction exceeds its limit');
    const campaign = seeds[0]?.campaignId;
    const runId = seeds[0]?.directorRunId;
    if (
      campaign === undefined ||
      runId === undefined ||
      seeds.some((seed) => seed.campaignId !== campaign || seed.directorRunId !== runId)
    ) {
      throw new PersistenceDataError('Prefetch prediction batch is inconsistent');
    }
    return this.inTransaction(() => {
      for (const seed of seeds) this.insertSeed(seed);
      return Object.freeze(
        seeds.map(({ id }) => this.require(id)).sort((a, b) => compareCandidate(a, b)),
      );
    });
  }

  public get(id: string): PrefetchCandidate | null {
    identity(id, 'Prefetch candidate');
    const row = this.database.prepare('SELECT * FROM prefetch_candidates WHERE id=?').get(id);
    return row === undefined ? null : mapCandidate(row);
  }

  public require(id: string): PrefetchCandidate {
    const candidate = this.get(id);
    if (candidate === null) throw new PersistenceDataError(`Prefetch candidate not found: ${id}`);
    return candidate;
  }

  public list(campaign: CampaignId): readonly PrefetchCandidate[] {
    const rows = this.database
      .prepare(
        `SELECT * FROM prefetch_candidates WHERE campaign_id=?
         ORDER BY CASE priority WHEN 'P1' THEN 0 ELSE 1 END,predicted_at,id LIMIT ?`,
      )
      .all(campaign, MAX_CANDIDATES + 1);
    if (rows.length > MAX_CANDIDATES)
      throw new PersistenceDataError('Prefetch candidates exceed the resource limit');
    return Object.freeze(rows.map(mapCandidate));
  }

  public start(command: StartPrefetch): PrefetchCandidate {
    const executionId = identity(command.executionId, 'Prefetch execution');
    const processId = identity(command.processId, 'Prefetch process');
    duration(command.queueWaitMs, 'queue wait');
    return this.inTransaction(() => {
      const current = this.require(command.id);
      if (current.state === 'RUNNING') {
        if (current.activeExecutionId === executionId && current.processId === processId)
          return current;
        throw new PersistenceDataError('Prefetch candidate is owned by another execution');
      }
      if (current.state !== 'PREDICTED')
        throw new PersistenceDataError('Prefetch candidate is not schedulable');
      const updated = this.transition(current, 'RUNNING', command.occurredAt, {
        activeExecutionId: executionId,
        processId,
        errorCode: null,
        startedAt: command.occurredAt,
        readyAt: null,
        resolvedAt: null,
      });
      this.event(updated, 'STARTED', 'EXECUTION_STARTED', command.occurredAt, {
        queueWaitMs: command.queueWaitMs,
      });
      return updated;
    });
  }

  public ready(command: ReadyPrefetch): PrefetchCandidate {
    duration(command.generationMs, 'generation');
    return this.inTransaction(() => {
      const current = this.require(command.id);
      if (current.state === 'READY') return current;
      if (
        current.state !== 'RUNNING' ||
        current.activeExecutionId !== command.executionId ||
        current.processId !== command.processId
      ) {
        throw new PersistenceDataError('Prefetch completion does not own the execution');
      }
      const updated = this.transition(current, 'READY', command.occurredAt, {
        activeExecutionId: null,
        processId: current.processId,
        errorCode: null,
        startedAt: current.startedAt,
        readyAt: command.occurredAt,
        resolvedAt: null,
      });
      this.event(updated, 'READY', 'CANDIDATE_READY', command.occurredAt, {
        generationMs: command.generationMs,
      });
      return updated;
    });
  }

  public hit(id: string, contextDigest: string, at: IsoTimestamp): PrefetchCandidate {
    digest(contextDigest);
    return this.inTransaction(() => {
      const current = this.require(id);
      if (current.contextDigest !== contextDigest)
        return this.resolve(current, 'INVALIDATED', 'CONTEXT_CHANGED', at);
      if (current.state !== 'READY')
        throw new PersistenceDataError('Prefetch candidate is not ready for adoption');
      return this.resolve(current, 'HIT', 'EXACT_MATCH', at);
    });
  }

  public miss(
    id: string,
    reason: 'NOT_READY' | 'CONTEXT_CHANGED',
    at: IsoTimestamp,
  ): PrefetchCandidate {
    return this.inTransaction(() => {
      const current = this.require(id);
      if (!isOpen(current.state)) return current;
      return this.resolve(
        current,
        reason === 'CONTEXT_CHANGED' ? 'INVALIDATED' : 'MISSED',
        reason,
        at,
      );
    });
  }

  public recordUnpredictedMiss(
    campaign: CampaignId,
    kind: PrefetchCandidateSeed['kind'],
    targetId: string,
    at: IsoTimestamp,
  ): void {
    identity(targetId, 'Prefetch target');
    this.insertEvent({
      campaignId: campaign,
      candidateId: null,
      kind,
      targetId,
      priority: null,
      event: 'MISS',
      reason: 'NOT_PREDICTED',
      queueWaitMs: null,
      generationMs: null,
      occurredAt: at,
    });
  }

  public invalidateOpen(
    campaign: CampaignId,
    reason: 'SUPERSEDED' | 'PROCESS_RESTART' | 'P0_PREEMPTED',
    at: IsoTimestamp,
    exceptRunId: string | null = null,
  ): readonly PrefetchCandidate[] {
    return this.inTransaction(() => {
      for (const current of this.list(campaign)) {
        if (
          isOpen(current.state) &&
          (exceptRunId === null || current.directorRunId !== exceptRunId)
        )
          this.resolve(current, 'INVALIDATED', reason, at);
      }
      return this.list(campaign);
    });
  }

  public cancel(id: string, at: IsoTimestamp): PrefetchCandidate {
    return this.inTransaction(() => {
      const current = this.require(id);
      if (!isOpen(current.state)) return current;
      return this.resolve(current, 'CANCELLED', 'USER_CANCELLED', at);
    });
  }

  public reject(id: string, errorCode: string, at: IsoTimestamp): PrefetchCandidate {
    errorIdentity(errorCode);
    return this.inTransaction(() => {
      const current = this.require(id);
      if (current.state === 'FAILED') {
        if (current.errorCode === errorCode) return current;
        throw new PersistenceDataError('Prefetch queue rejection identity drift');
      }
      if (current.state !== 'PREDICTED')
        throw new PersistenceDataError('Prefetch candidate is not awaiting queue admission');
      const updated = this.transition(current, 'FAILED', at, {
        activeExecutionId: null,
        processId: null,
        errorCode,
        startedAt: null,
        readyAt: null,
        resolvedAt: at,
      });
      this.event(updated, 'FAILED', 'QUEUE_REJECTED', at);
      return updated;
    });
  }

  public fail(
    id: string,
    executionId: string,
    errorCode: string,
    at: IsoTimestamp,
  ): PrefetchCandidate {
    identity(executionId, 'Prefetch execution');
    errorIdentity(errorCode);
    return this.inTransaction(() => {
      const current = this.require(id);
      if (current.state !== 'RUNNING' || current.activeExecutionId !== executionId)
        throw new PersistenceDataError('Prefetch failure does not own the execution');
      const updated = this.transition(current, 'FAILED', at, {
        activeExecutionId: null,
        processId: current.processId,
        errorCode,
        startedAt: current.startedAt,
        readyAt: null,
        resolvedAt: at,
      });
      this.event(updated, 'FAILED', 'EXECUTION_FAILED', at);
      return updated;
    });
  }

  public events(campaign: CampaignId): readonly PrefetchEvent[] {
    const rows = this.database
      .prepare('SELECT * FROM prefetch_events WHERE campaign_id=? ORDER BY id LIMIT ?')
      .all(campaign, MAX_EVENTS + 1);
    if (rows.length > MAX_EVENTS)
      throw new PersistenceDataError('Prefetch events exceed the resource limit');
    return Object.freeze(rows.map(mapEvent));
  }

  public metrics(campaign: CampaignId): PrefetchMetrics {
    const events = this.events(campaign);
    const count = (event: PrefetchEvent['event']) =>
      events.filter((value) => value.event === event).length;
    const hits = count('HIT');
    const misses = count('MISS');
    return Object.freeze({
      campaignId: campaign,
      predicted: count('PREDICTED'),
      ready: count('READY'),
      hits,
      misses,
      invalidated: count('INVALIDATED'),
      cancelled: count('CANCELLED'),
      failed: count('FAILED'),
      hitRatio: hits + misses === 0 ? null : hits / (hits + misses),
      averageQueueWaitMs: average(events.flatMap(({ queueWaitMs }) => queueWaitMs ?? [])),
      averageGenerationMs: average(events.flatMap(({ generationMs }) => generationMs ?? [])),
    });
  }

  private insertSeed(seed: PrefetchCandidateSeed): void {
    const current = this.get(seed.id);
    if (current !== null) {
      if (!sameSeed(current, seed)) throw new PersistenceDataError('Prefetch seed identity drift');
      return;
    }
    this.database
      .prepare(
        `INSERT INTO prefetch_candidates (
           id,campaign_id,director_run_id,lazy_intent_key,kind,target_id,priority,
           source_action_id,prediction_reason,context_digest,state,active_execution_id,
           process_id,error_code,revision,predicted_at,started_at,ready_at,resolved_at,updated_at
         ) VALUES (?,?,?,?,?,?,?,?,?,?,'PREDICTED',NULL,NULL,NULL,1,?,NULL,NULL,NULL,?)`,
      )
      .run(
        identity(seed.id, 'Prefetch candidate'),
        seed.campaignId,
        identity(seed.directorRunId, 'Director run'),
        identity(seed.lazyIntentKey, 'Lazy generation intent'),
        seed.kind,
        identity(seed.targetId, 'Prefetch target'),
        seed.priority,
        seed.sourceActionId,
        seed.predictionReason,
        digest(seed.contextDigest),
        seed.predictedAt,
        seed.predictedAt,
      );
    const inserted = this.require(seed.id);
    this.event(inserted, 'PREDICTED', inserted.predictionReason, seed.predictedAt);
  }

  private resolve(
    current: PrefetchCandidate,
    state: 'HIT' | 'MISSED' | 'INVALIDATED' | 'CANCELLED',
    reason: PrefetchEventReason,
    at: IsoTimestamp,
  ): PrefetchCandidate {
    const updated = this.transition(current, state, at, {
      activeExecutionId: null,
      processId: current.processId,
      errorCode: null,
      startedAt: current.startedAt,
      readyAt: current.readyAt,
      resolvedAt: at,
    });
    const event =
      state === 'HIT'
        ? 'HIT'
        : state === 'MISSED'
          ? 'MISS'
          : state === 'CANCELLED'
            ? 'CANCELLED'
            : 'INVALIDATED';
    this.event(updated, event, reason, at);
    return updated;
  }

  private transition(
    current: PrefetchCandidate,
    state: PrefetchCandidate['state'],
    at: IsoTimestamp,
    values: Pick<
      PrefetchCandidate,
      'activeExecutionId' | 'processId' | 'errorCode' | 'startedAt' | 'readyAt' | 'resolvedAt'
    >,
  ): PrefetchCandidate {
    const changed = this.database
      .prepare(
        `UPDATE prefetch_candidates SET state=?,active_execution_id=?,process_id=?,error_code=?,
           revision=?,started_at=?,ready_at=?,resolved_at=?,updated_at=?
         WHERE id=? AND revision=?`,
      )
      .run(
        state,
        values.activeExecutionId,
        values.processId,
        values.errorCode,
        current.revision + 1,
        values.startedAt,
        values.readyAt,
        values.resolvedAt,
        at,
        current.id,
        current.revision,
      ).changes;
    if (changed !== 1) throw new PersistenceDataError('Prefetch revision drift');
    return this.require(current.id);
  }

  private event(
    candidate: PrefetchCandidate,
    event: PrefetchEvent['event'],
    reason: PrefetchEventReason,
    at: IsoTimestamp,
    metric: { readonly queueWaitMs?: number; readonly generationMs?: number } = {},
  ): void {
    this.insertEvent({
      campaignId: candidate.campaignId,
      candidateId: candidate.id,
      kind: candidate.kind,
      targetId: candidate.targetId,
      priority: candidate.priority,
      event,
      reason,
      queueWaitMs: metric.queueWaitMs ?? null,
      generationMs: metric.generationMs ?? null,
      occurredAt: at,
    });
  }

  private insertEvent(event: Omit<PrefetchEvent, 'id'>): void {
    this.database
      .prepare(
        `INSERT INTO prefetch_events (
           campaign_id,candidate_id,kind,target_id,priority,event,reason,
           queue_wait_ms,generation_ms,occurred_at
         ) VALUES (?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        event.campaignId,
        event.candidateId,
        event.kind,
        event.targetId,
        event.priority,
        event.event,
        event.reason,
        event.queueWaitMs,
        event.generationMs,
        event.occurredAt,
      );
  }

  private inTransaction<Value>(operation: () => Value): Value {
    this.database.exec('SAVEPOINT prefetch');
    try {
      const value = operation();
      this.database.exec('RELEASE SAVEPOINT prefetch');
      return value;
    } catch (error) {
      try {
        this.database.exec('ROLLBACK TO SAVEPOINT prefetch');
        this.database.exec('RELEASE SAVEPOINT prefetch');
      } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], 'Prefetch rollback failed', {
          cause: rollbackError,
        });
      }
      throw error;
    }
  }
}

function mapCandidate(value: unknown): PrefetchCandidate {
  const row = requireRecord(value, 'Prefetch candidate');
  return Object.freeze({
    id: requireString(row['id'], 'candidate.id'),
    campaignId: campaignId(requireString(row['campaign_id'], 'candidate.campaignId')),
    directorRunId: requireString(row['director_run_id'], 'candidate.directorRunId'),
    lazyIntentKey: requireString(row['lazy_intent_key'], 'candidate.lazyIntentKey'),
    kind: requireEnum(['LOCATION_DETAILS', 'FACTION_DETAILS'] as const, row['kind'], 'kind'),
    targetId: requireString(row['target_id'], 'candidate.targetId'),
    priority: requireEnum(PREFETCH_PRIORITIES, row['priority'], 'priority'),
    sourceActionId: requireNullableString(row['source_action_id'], 'sourceActionId'),
    predictionReason: requireEnum(
      PREFETCH_PREDICTION_REASONS,
      row['prediction_reason'],
      'predictionReason',
    ),
    contextDigest: digest(requireString(row['context_digest'], 'contextDigest')),
    state: requireEnum(PREFETCH_STATES, row['state'], 'state'),
    activeExecutionId: requireNullableString(row['active_execution_id'], 'activeExecutionId'),
    processId: requireNullableString(row['process_id'], 'processId'),
    errorCode: requireNullableString(row['error_code'], 'errorCode'),
    revision: integer(row['revision'], 'revision', 1),
    predictedAt: isoTimestamp(requireString(row['predicted_at'], 'predictedAt')),
    startedAt: timestamp(row['started_at'], 'startedAt'),
    readyAt: timestamp(row['ready_at'], 'readyAt'),
    resolvedAt: timestamp(row['resolved_at'], 'resolvedAt'),
    updatedAt: isoTimestamp(requireString(row['updated_at'], 'updatedAt')),
  });
}

function mapEvent(value: unknown): PrefetchEvent {
  const row = requireRecord(value, 'Prefetch event');
  return Object.freeze({
    id: integer(row['id'], 'event.id', 1),
    campaignId: campaignId(requireString(row['campaign_id'], 'event.campaignId')),
    candidateId: requireNullableString(row['candidate_id'], 'event.candidateId'),
    kind: requireEnum(['LOCATION_DETAILS', 'FACTION_DETAILS'] as const, row['kind'], 'event.kind'),
    targetId: requireString(row['target_id'], 'event.targetId'),
    priority:
      row['priority'] === null
        ? null
        : requireEnum(PREFETCH_PRIORITIES, row['priority'], 'event.priority'),
    event: requireEnum(PREFETCH_EVENT_KINDS, row['event'], 'event.event'),
    reason: requireEnum(PREFETCH_EVENT_REASONS, row['reason'], 'event.reason'),
    queueWaitMs: nullableInteger(row['queue_wait_ms'], 'event.queueWaitMs'),
    generationMs: nullableInteger(row['generation_ms'], 'event.generationMs'),
    occurredAt: isoTimestamp(requireString(row['occurred_at'], 'event.occurredAt')),
  });
}

function sameSeed(candidate: PrefetchCandidate, seed: PrefetchCandidateSeed): boolean {
  return (
    candidate.campaignId === seed.campaignId &&
    candidate.directorRunId === seed.directorRunId &&
    candidate.lazyIntentKey === seed.lazyIntentKey &&
    candidate.kind === seed.kind &&
    candidate.targetId === seed.targetId &&
    candidate.priority === seed.priority &&
    candidate.sourceActionId === seed.sourceActionId &&
    candidate.predictionReason === seed.predictionReason &&
    candidate.contextDigest === seed.contextDigest &&
    candidate.predictedAt === seed.predictedAt
  );
}

function compareCandidate(left: PrefetchCandidate, right: PrefetchCandidate): number {
  return (
    (left.priority === 'P1' ? 0 : 1) - (right.priority === 'P1' ? 0 : 1) ||
    (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
  );
}

function isOpen(state: PrefetchCandidate['state']): boolean {
  return OPEN_STATES.includes(state as (typeof OPEN_STATES)[number]);
}

function timestamp(value: unknown, label: string): IsoTimestamp | null {
  const parsed = requireNullableString(value, label);
  return parsed === null ? null : isoTimestamp(parsed);
}

function integer(value: unknown, label: string, minimum: number): number {
  const parsed = requireNumber(value, label);
  if (!Number.isSafeInteger(parsed) || parsed < minimum)
    throw new PersistenceDataError(`Prefetch ${label} is invalid`);
  return parsed;
}

function nullableInteger(value: unknown, label: string): number | null {
  return value === null ? null : integer(value, label, 0);
}

function duration(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 86_400_000)
    throw new PersistenceDataError(`Prefetch ${label} is invalid`);
}

function identity(value: string, label: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,255}$/u.test(value))
    throw new PersistenceDataError(`${label} is invalid`);
  return value;
}

function digest(value: string): string {
  if (!/^[0-9a-f]{64}$/u.test(value)) throw new PersistenceDataError('Prefetch digest is invalid');
  return value;
}

function errorIdentity(value: string): void {
  if (!/^[A-Z0-9_]{1,120}$/u.test(value))
    throw new PersistenceDataError('Prefetch error code is invalid');
}

function average(values: readonly number[]): number | null {
  return values.length === 0
    ? null
    : values.reduce((total, value) => total + value, 0) / values.length;
}

import {
  LAZY_WORLD_EXECUTION_MODES,
  LAZY_WORLD_GENERATION_KINDS,
  LAZY_WORLD_GENERATION_PRIORITIES,
  LAZY_WORLD_GENERATION_STATES,
  LAZY_WORLD_TRANSITION_REASONS,
  campaignId,
  createLazyWorldGenerationPlanSeed,
  isoTimestamp,
  type CampaignId,
  type CoreWorldGenerationPlanInput,
  type IsoTimestamp,
  type LazyWorldGenerationPlan,
  type LazyWorldGenerationPlanSeed,
  type LazyWorldGenerationState,
  type LazyWorldGenerationTransition,
  type LazyWorldTransitionReason,
} from '@ember-tavern/contracts';
import { buildCoreWorldGenerationPlan } from '@ember-tavern/domain';

import { PersistenceDataError } from './campaign-repository.js';
import {
  requireEnum,
  requireNullableString,
  requireNumber,
  requireRecord,
  requireString,
} from './persistence-validation.js';
import type { TransactionalSqliteDatabase } from './sqlite-port.js';

const MAX_PLANS = 64;
const MAX_TRANSITIONS = 4_096;

export interface ClaimLazyWorldGeneration {
  readonly campaignId: CampaignId;
  readonly intentKey: string;
  readonly runId: string;
  readonly occurredAt: IsoTimestamp;
}

export interface CompleteLazyWorldGeneration extends ClaimLazyWorldGeneration {
  readonly artifactRef: string;
}

export interface FailLazyWorldGeneration extends ClaimLazyWorldGeneration {
  readonly errorCode: string;
  readonly retryable: boolean;
}

export interface CancelLazyWorldGeneration {
  readonly campaignId: CampaignId;
  readonly intentKey: string;
  readonly runId: string | null;
  readonly cancelledAt: IsoTimestamp;
}

export class LazyWorldGenerationRepository {
  public constructor(private readonly database: TransactionalSqliteDatabase) {}

  public seedCoreWorldPlan(
    input: CoreWorldGenerationPlanInput,
  ): readonly LazyWorldGenerationPlan[] {
    const seeds = buildCoreWorldGenerationPlan(input);
    return this.inTransaction(() => {
      for (const seed of seeds) this.insertSeedOnce(seed);
      return this.list(input.world.campaignId);
    });
  }

  public get(campaign: CampaignId, intentKey: string): LazyWorldGenerationPlan | null {
    identity(intentKey, 'Lazy generation intent');
    const row = this.database
      .prepare('SELECT * FROM lazy_world_generation_plans WHERE campaign_id=? AND intent_key=?')
      .get(campaign, intentKey);
    return row === undefined ? null : mapPlan(row);
  }

  public require(campaign: CampaignId, intentKey: string): LazyWorldGenerationPlan {
    const plan = this.get(campaign, intentKey);
    if (plan === null)
      throw new PersistenceDataError(`Lazy generation plan not found: ${intentKey}`);
    return plan;
  }

  public list(campaign: CampaignId): readonly LazyWorldGenerationPlan[] {
    const rows = this.database
      .prepare(
        `SELECT * FROM lazy_world_generation_plans WHERE campaign_id=?
         ORDER BY CASE priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 ELSE 2 END,
           created_at,intent_key LIMIT ?`,
      )
      .all(campaign, MAX_PLANS + 1);
    if (rows.length > MAX_PLANS) {
      throw new PersistenceDataError('Lazy generation plan exceeds the resource limit');
    }
    return Object.freeze(rows.map(mapPlan));
  }

  public listTransitions(campaign: CampaignId): readonly LazyWorldGenerationTransition[] {
    const rows = this.database
      .prepare(
        `SELECT * FROM lazy_world_generation_transitions WHERE campaign_id=?
         ORDER BY id LIMIT ?`,
      )
      .all(campaign, MAX_TRANSITIONS + 1);
    if (rows.length > MAX_TRANSITIONS) {
      throw new PersistenceDataError('Lazy generation history exceeds the resource limit');
    }
    return Object.freeze(rows.map(mapTransition));
  }

  public claim(command: ClaimLazyWorldGeneration): LazyWorldGenerationPlan {
    const runId = identity(command.runId, 'Lazy generation run');
    return this.inTransaction(() => {
      const current = this.require(command.campaignId, command.intentKey);
      if (current.state === 'SUCCEEDED') return current;
      if (current.state === 'RUNNING') {
        if (current.activeRunId === runId) return current;
        throw new PersistenceDataError('Lazy generation intent is already running');
      }
      if (current.state === 'FAILED' && !current.retryable) {
        throw new PersistenceDataError('Lazy generation failure is not retryable');
      }
      if (current.dependsOnIntentKey !== null) {
        const dependency = this.require(command.campaignId, current.dependsOnIntentKey);
        if (dependency.state !== 'SUCCEEDED') {
          throw new PersistenceDataError('Lazy generation dependency is not complete');
        }
      }
      this.updatePlan(
        current,
        {
          state: 'RUNNING',
          attemptCount: current.attemptCount + 1,
          activeRunId: runId,
          artifactRef: null,
          lastErrorCode: null,
          retryable: false,
          startedAt: command.occurredAt,
          completedAt: null,
          updatedAt: command.occurredAt,
        },
        'CLAIMED',
        runId,
        null,
      );
      return this.require(command.campaignId, command.intentKey);
    });
  }

  public complete(command: CompleteLazyWorldGeneration): LazyWorldGenerationPlan {
    const runId = identity(command.runId, 'Lazy generation run');
    const artifactRef = identity(command.artifactRef, 'Lazy generation artifact');
    return this.inTransaction(() => {
      const current = this.require(command.campaignId, command.intentKey);
      if (current.state === 'SUCCEEDED') {
        if (current.artifactRef !== artifactRef) {
          throw new PersistenceDataError('Lazy generation artifact identity drift');
        }
        return current;
      }
      if (current.state !== 'RUNNING' || current.activeRunId !== runId) {
        throw new PersistenceDataError('Lazy generation completion does not own the active run');
      }
      this.updatePlan(
        current,
        {
          state: 'SUCCEEDED',
          attemptCount: current.attemptCount,
          activeRunId: null,
          artifactRef,
          lastErrorCode: null,
          retryable: false,
          startedAt: current.startedAt,
          completedAt: command.occurredAt,
          updatedAt: command.occurredAt,
        },
        'ARTIFACT_COMMITTED',
        runId,
        null,
      );
      return this.require(command.campaignId, command.intentKey);
    });
  }

  public fail(command: FailLazyWorldGeneration): LazyWorldGenerationPlan {
    const runId = identity(command.runId, 'Lazy generation run');
    const errorCode = errorIdentity(command.errorCode);
    return this.inTransaction(() => {
      const current = this.require(command.campaignId, command.intentKey);
      if (current.state === 'FAILED' && current.activeRunId === null) return current;
      if (current.state !== 'RUNNING' || current.activeRunId !== runId) {
        throw new PersistenceDataError('Lazy generation failure does not own the active run');
      }
      this.updatePlan(
        current,
        {
          state: 'FAILED',
          attemptCount: current.attemptCount,
          activeRunId: null,
          artifactRef: null,
          lastErrorCode: errorCode,
          retryable: command.retryable,
          startedAt: current.startedAt,
          completedAt: command.occurredAt,
          updatedAt: command.occurredAt,
        },
        'EXECUTION_FAILED',
        runId,
        errorCode,
      );
      return this.require(command.campaignId, command.intentKey);
    });
  }

  public cancel(command: CancelLazyWorldGeneration): LazyWorldGenerationPlan {
    const runId = command.runId === null ? null : identity(command.runId, 'Lazy generation run');
    return this.inTransaction(() => {
      const current = this.require(command.campaignId, command.intentKey);
      if (current.state === 'SUCCEEDED' || current.state === 'CANCELLED') return current;
      if (current.state === 'RUNNING' && current.activeRunId !== runId) {
        throw new PersistenceDataError('Lazy generation cancellation does not own the active run');
      }
      if (current.state === 'FAILED' && !current.retryable) {
        throw new PersistenceDataError('Non-retryable lazy generation failure cannot be cancelled');
      }
      this.updatePlan(
        current,
        {
          state: 'CANCELLED',
          attemptCount: current.attemptCount,
          activeRunId: null,
          artifactRef: null,
          lastErrorCode: 'CANCELLED',
          retryable: true,
          startedAt: current.startedAt,
          completedAt: command.cancelledAt,
          updatedAt: command.cancelledAt,
        },
        'CANCELLED',
        runId,
        'CANCELLED',
      );
      return this.require(command.campaignId, command.intentKey);
    });
  }

  public recoverInterrupted(
    campaign: CampaignId,
    at: IsoTimestamp,
  ): readonly LazyWorldGenerationPlan[] {
    return this.inTransaction(() => {
      for (const current of this.list(campaign).filter(({ state }) => state === 'RUNNING')) {
        const artifact = this.findCommittedArtifact(current);
        if (artifact !== null) {
          this.reconcileSuccess(current, artifact, at);
          continue;
        }
        this.updatePlan(
          current,
          {
            state: 'FAILED',
            attemptCount: current.attemptCount,
            activeRunId: null,
            artifactRef: null,
            lastErrorCode: 'INTERRUPTED',
            retryable: true,
            startedAt: current.startedAt,
            completedAt: at,
            updatedAt: at,
          },
          'INTERRUPTED',
          current.activeRunId,
          'INTERRUPTED',
        );
      }
      return this.list(campaign);
    });
  }

  public reconcile(campaign: CampaignId, at: IsoTimestamp): readonly LazyWorldGenerationPlan[] {
    return this.inTransaction(() => {
      for (const current of this.list(campaign).filter(({ state }) => state !== 'SUCCEEDED')) {
        const artifact = this.findCommittedArtifact(current);
        if (artifact !== null) this.reconcileSuccess(current, artifact, at);
      }
      return this.list(campaign);
    });
  }

  private insertSeedOnce(seedInput: LazyWorldGenerationPlanSeed): void {
    const seed = createLazyWorldGenerationPlanSeed(seedInput);
    const current = this.get(seed.campaignId, seed.intentKey);
    if (current !== null) {
      if (
        current.kind !== seed.kind ||
        current.targetId !== seed.targetId ||
        current.executionMode !== seed.executionMode ||
        current.priority !== seed.priority ||
        current.dependsOnIntentKey !== seed.dependsOnIntentKey ||
        current.createdAt !== seed.createdAt
      ) {
        throw new PersistenceDataError('Lazy generation seed conflicts with its durable plan');
      }
      return;
    }
    this.database
      .prepare(
        `INSERT INTO lazy_world_generation_plans (
           intent_key,campaign_id,kind,target_id,execution_mode,priority,state,
           depends_on_intent_key,attempt_count,active_run_id,artifact_ref,last_error_code,
           retryable,revision,created_at,started_at,completed_at,updated_at
         ) VALUES (?,?,?,?,?,?,'PLANNED',?,0,NULL,NULL,NULL,0,1,?,NULL,NULL,?)`,
      )
      .run(
        seed.intentKey,
        seed.campaignId,
        seed.kind,
        seed.targetId,
        seed.executionMode,
        seed.priority,
        seed.dependsOnIntentKey,
        seed.createdAt,
        seed.createdAt,
      );
    this.insertTransition(
      seed.campaignId,
      seed.intentKey,
      null,
      'PLANNED',
      'CORE_BOOTSTRAP',
      null,
      0,
      1,
      null,
      false,
      seed.createdAt,
    );
  }

  private reconcileSuccess(
    current: LazyWorldGenerationPlan,
    artifactRef: string,
    at: IsoTimestamp,
  ): void {
    this.updatePlan(
      current,
      {
        state: 'SUCCEEDED',
        attemptCount: current.attemptCount,
        activeRunId: null,
        artifactRef,
        lastErrorCode: null,
        retryable: false,
        startedAt: current.startedAt,
        completedAt: at,
        updatedAt: at,
      },
      'RECONCILED',
      current.activeRunId,
      null,
    );
  }

  private findCommittedArtifact(plan: LazyWorldGenerationPlan): string | null {
    switch (plan.kind) {
      case 'INITIAL_CAREER_POOL':
        return this.exists('SELECT 1 FROM career_pools WHERE campaign_id=?', plan.campaignId)
          ? plan.campaignId
          : null;
      case 'TAVERN':
        return this.scalar(
          'SELECT id FROM taverns WHERE campaign_id=? ORDER BY created_at,id LIMIT 1',
          plan.campaignId,
        );
      case 'TAVERN_ROSTER':
        return this.scalar(
          `SELECT tavern.id FROM taverns tavern
           WHERE tavern.campaign_id=?
             AND (SELECT count(*) FROM npcs WHERE tavern_id=tavern.id)>=4
             AND (SELECT count(*) FROM world_facts WHERE campaign_id=? AND kind='RUMOR')>=3
             AND (SELECT count(*) FROM world_clocks WHERE campaign_id=?)>=2
           ORDER BY tavern.created_at,tavern.id LIMIT 1`,
          plan.campaignId,
          plan.campaignId,
          plan.campaignId,
        );
      case 'LOCATION_DETAILS':
        return this.scalar(
          `SELECT artifact.id FROM dynamic_locations artifact
           WHERE artifact.campaign_id=? AND artifact.materialization='DETAILED'
             AND (artifact.parent_location_id=? OR EXISTS(
               SELECT 1 FROM location_connections edge
               WHERE edge.campaign_id=?
                 AND ((edge.first_location_id=? AND edge.second_location_id=artifact.id)
                   OR (edge.second_location_id=? AND edge.first_location_id=artifact.id))))
           ORDER BY artifact.created_at,artifact.id LIMIT 1`,
          plan.campaignId,
          plan.targetId,
          plan.campaignId,
          plan.targetId,
          plan.targetId,
        );
      case 'FACTION_DETAILS':
        return this.exists(
          `SELECT 1 FROM active_factions
           WHERE id=? AND campaign_id=? AND materialization='ACTIVE'`,
          plan.targetId,
          plan.campaignId,
        )
          ? plan.targetId
          : null;
    }
  }

  private exists(query: string, ...values: string[]): boolean {
    return this.database.prepare(query).get(...values) !== undefined;
  }

  private scalar(query: string, ...values: string[]): string | null {
    const value = this.database.prepare(query).get(...values);
    if (value === undefined) return null;
    const row = requireRecord(value, 'Lazy generation artifact');
    return requireString(row['id'], 'artifact.id');
  }

  private updatePlan(
    current: LazyWorldGenerationPlan,
    next: Pick<
      LazyWorldGenerationPlan,
      | 'state'
      | 'attemptCount'
      | 'activeRunId'
      | 'artifactRef'
      | 'lastErrorCode'
      | 'retryable'
      | 'startedAt'
      | 'completedAt'
      | 'updatedAt'
    >,
    reason: LazyWorldTransitionReason,
    runId: string | null,
    errorCode: string | null,
  ): void {
    const revision = current.revision + 1;
    const changed = this.database
      .prepare(
        `UPDATE lazy_world_generation_plans SET
           state=?,attempt_count=?,active_run_id=?,artifact_ref=?,last_error_code=?,retryable=?,
           revision=?,started_at=?,completed_at=?,updated_at=?
         WHERE intent_key=? AND campaign_id=? AND revision=?`,
      )
      .run(
        next.state,
        next.attemptCount,
        next.activeRunId,
        next.artifactRef,
        next.lastErrorCode,
        Number(next.retryable),
        revision,
        next.startedAt,
        next.completedAt,
        next.updatedAt,
        current.intentKey,
        current.campaignId,
        current.revision,
      ).changes;
    if (changed !== 1) throw new PersistenceDataError('Lazy generation revision drift');
    this.insertTransition(
      current.campaignId,
      current.intentKey,
      current.state,
      next.state,
      reason,
      runId,
      current.revision,
      revision,
      errorCode,
      next.retryable,
      next.updatedAt,
    );
  }

  private insertTransition(
    campaign: CampaignId,
    intentKey: string,
    fromState: LazyWorldGenerationState | null,
    toState: LazyWorldGenerationState,
    reason: LazyWorldTransitionReason,
    runId: string | null,
    beforeRevision: number,
    afterRevision: number,
    errorCode: string | null,
    retryable: boolean,
    at: IsoTimestamp,
  ): void {
    this.database
      .prepare(
        `INSERT INTO lazy_world_generation_transitions (
           campaign_id,intent_key,from_state,to_state,reason,run_id,before_revision,
           after_revision,error_code,retryable,occurred_at
         ) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        campaign,
        intentKey,
        fromState,
        toState,
        reason,
        runId,
        beforeRevision,
        afterRevision,
        errorCode,
        Number(retryable),
        at,
      );
  }

  private inTransaction<Value>(operation: () => Value): Value {
    this.database.exec('SAVEPOINT lazy_world_generation');
    try {
      const value = operation();
      this.database.exec('RELEASE SAVEPOINT lazy_world_generation');
      return value;
    } catch (error) {
      try {
        this.database.exec('ROLLBACK TO SAVEPOINT lazy_world_generation');
        this.database.exec('RELEASE SAVEPOINT lazy_world_generation');
      } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], 'Lazy generation rollback failed', {
          cause: rollbackError,
        });
      }
      throw error;
    }
  }
}

function mapPlan(value: unknown): LazyWorldGenerationPlan {
  const row = requireRecord(value, 'Lazy generation plan');
  return Object.freeze({
    intentKey: requireString(row['intent_key'], 'intent_key'),
    campaignId: campaignId(requireString(row['campaign_id'], 'campaign_id')),
    kind: requireEnum(LAZY_WORLD_GENERATION_KINDS, row['kind'], 'kind'),
    targetId: requireString(row['target_id'], 'target_id'),
    executionMode: requireEnum(LAZY_WORLD_EXECUTION_MODES, row['execution_mode'], 'mode'),
    priority: requireEnum(LAZY_WORLD_GENERATION_PRIORITIES, row['priority'], 'priority'),
    state: requireEnum(LAZY_WORLD_GENERATION_STATES, row['state'], 'state'),
    dependsOnIntentKey: requireNullableString(row['depends_on_intent_key'], 'dependency'),
    attemptCount: safeInteger(row['attempt_count'], 'attempt_count', 0),
    activeRunId: requireNullableString(row['active_run_id'], 'active_run_id'),
    artifactRef: requireNullableString(row['artifact_ref'], 'artifact_ref'),
    lastErrorCode: requireNullableString(row['last_error_code'], 'last_error_code'),
    retryable: booleanInteger(row['retryable'], 'retryable'),
    revision: safeInteger(row['revision'], 'revision', 1),
    createdAt: isoTimestamp(requireString(row['created_at'], 'created_at')),
    startedAt: nullableTimestamp(row['started_at'], 'started_at'),
    completedAt: nullableTimestamp(row['completed_at'], 'completed_at'),
    updatedAt: isoTimestamp(requireString(row['updated_at'], 'updated_at')),
  });
}

function mapTransition(value: unknown): LazyWorldGenerationTransition {
  const row = requireRecord(value, 'Lazy generation transition');
  const from = row['from_state'];
  return Object.freeze({
    id: safeInteger(row['id'], 'id', 1),
    campaignId: campaignId(requireString(row['campaign_id'], 'campaign_id')),
    intentKey: requireString(row['intent_key'], 'intent_key'),
    fromState: from === null ? null : requireEnum(LAZY_WORLD_GENERATION_STATES, from, 'from_state'),
    toState: requireEnum(LAZY_WORLD_GENERATION_STATES, row['to_state'], 'to_state'),
    reason: requireEnum(LAZY_WORLD_TRANSITION_REASONS, row['reason'], 'reason'),
    runId: requireNullableString(row['run_id'], 'run_id'),
    beforeRevision: safeInteger(row['before_revision'], 'before_revision', 0),
    afterRevision: safeInteger(row['after_revision'], 'after_revision', 1),
    errorCode: requireNullableString(row['error_code'], 'error_code'),
    retryable: booleanInteger(row['retryable'], 'retryable'),
    occurredAt: isoTimestamp(requireString(row['occurred_at'], 'occurred_at')),
  });
}

function nullableTimestamp(value: unknown, label: string): IsoTimestamp | null {
  const text = requireNullableString(value, label);
  return text === null ? null : isoTimestamp(text);
}

function safeInteger(value: unknown, label: string, min: number): number {
  const number = requireNumber(value, label);
  if (!Number.isSafeInteger(number) || number < min) {
    throw new PersistenceDataError(`Lazy generation ${label} is invalid`);
  }
  return number;
}

function booleanInteger(value: unknown, label: string): boolean {
  const number = safeInteger(value, label, 0);
  if (number !== 0 && number !== 1) {
    throw new PersistenceDataError(`Lazy generation ${label} is invalid`);
  }
  return number === 1;
}

function identity(value: string, label: string): string {
  if (
    value.length < 1 ||
    value.length > 256 ||
    value.trim() !== value ||
    !/^[a-zA-Z0-9][a-zA-Z0-9:._-]*$/u.test(value)
  ) {
    throw new PersistenceDataError(`${label} is invalid`);
  }
  return value;
}

function errorIdentity(value: string): string {
  if (!/^[A-Z0-9_]{1,120}$/u.test(value)) {
    throw new PersistenceDataError('Lazy generation error code is invalid');
  }
  return value;
}

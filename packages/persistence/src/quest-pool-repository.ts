import {
  QUEST_STATUSES,
  QUEST_TRANSITION_SOURCES,
  campaignId,
  isoTimestamp,
  questId,
  type IsoTimestamp,
  type QuestPoolState,
  type QuestStatus,
  type QuestTransition,
  type QuestTransitionSource,
} from '@ember-tavern/contracts';
import { assertQuestPoolTransition } from '@ember-tavern/domain';

import { PersistenceDataError } from './campaign-repository.js';
import {
  requireEnum,
  requireNullableString,
  requireNumber,
  requireRecord,
  requireString,
} from './persistence-validation.js';
import type { TransactionalSqliteDatabase } from './sqlite-port.js';

export interface TransitionQuestPoolState {
  readonly operationId: string;
  readonly campaignId: QuestPoolState['campaignId'];
  readonly questId: QuestPoolState['questId'];
  readonly expectedRevision: number;
  readonly toStatus: QuestStatus;
  readonly source: QuestTransitionSource;
  readonly reason: string;
  readonly occurredAt: IsoTimestamp;
}

export class QuestPoolRepository {
  private readonly database: TransactionalSqliteDatabase;

  public constructor(database: TransactionalSqliteDatabase) {
    this.database = database;
  }

  public get(quest: QuestPoolState['questId']): QuestPoolState | null {
    const row = this.database
      .prepare('SELECT * FROM quest_pool_states WHERE quest_id=?')
      .get(quest);
    return row === undefined ? null : mapState(row);
  }

  public list(campaign: QuestPoolState['campaignId']): readonly QuestPoolState[] {
    return Object.freeze(
      this.database
        .prepare(
          `SELECT * FROM quest_pool_states
           WHERE campaign_id=? ORDER BY updated_at DESC, quest_id`,
        )
        .all(campaign)
        .map(mapState),
    );
  }

  public transitions(quest: QuestPoolState['questId']): readonly QuestTransition[] {
    return Object.freeze(
      this.database
        .prepare(
          `SELECT * FROM quest_pool_transitions
           WHERE quest_id=? ORDER BY after_revision`,
        )
        .all(quest)
        .map(mapTransition),
    );
  }

  public transition(input: TransitionQuestPoolState): QuestPoolState {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const result = this.transitionInCurrentTransaction(input);
      this.database.exec('COMMIT');
      return result;
    } catch (error) {
      try {
        this.database.exec('ROLLBACK');
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          'Quest transition and rollback both failed',
          { cause: rollbackError },
        );
      }
      throw error;
    }
  }

  public transitionInCurrentTransaction(input: TransitionQuestPoolState): QuestPoolState {
    validateInput(input);
    const replay = this.database
      .prepare('SELECT * FROM quest_pool_transitions WHERE operation_id=?')
      .get(input.operationId);
    if (replay !== undefined) {
      const transition = mapTransition(replay);
      if (
        transition.questId !== input.questId ||
        transition.campaignId !== input.campaignId ||
        transition.beforeRevision !== input.expectedRevision ||
        transition.toStatus !== input.toStatus ||
        transition.source !== input.source ||
        transition.reason !== input.reason ||
        transition.occurredAt !== input.occurredAt
      ) {
        throw new PersistenceDataError('Quest transition operation was reused with other input');
      }
      const state = this.get(input.questId);
      if (
        state === null ||
        state.campaignId !== input.campaignId ||
        state.revision < transition.afterRevision
      ) {
        throw new PersistenceDataError('Quest transition replay state is inconsistent');
      }
      return state;
    }
    const before = this.get(input.questId);
    if (
      before === null ||
      before.campaignId !== input.campaignId ||
      before.revision !== input.expectedRevision
    ) {
      throw new PersistenceDataError('Quest pool revision or campaign changed');
    }
    assertQuestPoolTransition(before.status, input.toStatus, input.source);
    const changed = this.database
      .prepare(
        `UPDATE quest_pool_states SET
           status=?,revision=revision+1,last_source=?,last_reason=?,last_operation_id=?,updated_at=?
         WHERE quest_id=? AND campaign_id=? AND revision=? AND status=?`,
      )
      .run(
        input.toStatus,
        input.source,
        input.reason,
        input.operationId,
        input.occurredAt,
        input.questId,
        input.campaignId,
        input.expectedRevision,
        before.status,
      );
    if (Number(changed.changes) !== 1) {
      throw new PersistenceDataError('Quest pool changed during transition');
    }
    const result = this.get(input.questId);
    if (result === null) throw new PersistenceDataError('Transitioned quest pool state is missing');
    return result;
  }
}

function validateInput(input: TransitionQuestPoolState): void {
  if (
    input.operationId.trim() !== input.operationId ||
    input.operationId.length === 0 ||
    input.operationId.length > 200 ||
    input.reason.trim() !== input.reason ||
    input.reason.length === 0 ||
    input.reason.length > 4_000 ||
    !Number.isSafeInteger(input.expectedRevision) ||
    input.expectedRevision < 1
  ) {
    throw new PersistenceDataError('Quest transition input is invalid');
  }
}

function mapState(value: unknown): QuestPoolState {
  const row = requireRecord(value, 'Quest pool state row');
  return Object.freeze({
    questId: questId(requireString(row['quest_id'], 'quest_id')),
    campaignId: campaignId(requireString(row['campaign_id'], 'campaign_id')),
    status: requireEnum(QUEST_STATUSES, row['status'], 'status'),
    revision: positiveInteger(row['revision'], 'revision'),
    lastSource: requireEnum(QUEST_TRANSITION_SOURCES, row['last_source'], 'last_source'),
    lastReason: requireString(row['last_reason'], 'last_reason'),
    lastOperationId: requireString(row['last_operation_id'], 'last_operation_id'),
    createdAt: isoTimestamp(requireString(row['created_at'], 'created_at')),
    updatedAt: isoTimestamp(requireString(row['updated_at'], 'updated_at')),
  });
}

function mapTransition(value: unknown): QuestTransition {
  const row = requireRecord(value, 'Quest pool transition row');
  const from = requireNullableString(row['from_status'], 'from_status');
  return Object.freeze({
    operationId: requireString(row['operation_id'], 'operation_id'),
    questId: questId(requireString(row['quest_id'], 'quest_id')),
    campaignId: campaignId(requireString(row['campaign_id'], 'campaign_id')),
    fromStatus: from === null ? null : requireEnum(QUEST_STATUSES, from, 'from_status'),
    toStatus: requireEnum(QUEST_STATUSES, row['to_status'], 'to_status'),
    source: requireEnum(QUEST_TRANSITION_SOURCES, row['source'], 'source'),
    reason: requireString(row['reason'], 'reason'),
    beforeRevision: requireNumber(row['before_revision'], 'before_revision'),
    afterRevision: positiveInteger(row['after_revision'], 'after_revision'),
    occurredAt: isoTimestamp(requireString(row['occurred_at'], 'occurred_at')),
  });
}

function positiveInteger(value: unknown, label: string): number {
  const parsed = requireNumber(value, label);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new PersistenceDataError(`${label} must be a positive integer`);
  }
  return parsed;
}

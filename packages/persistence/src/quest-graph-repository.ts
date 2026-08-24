import {
  QUEST_GRAPH_EDGE_KINDS,
  QUEST_GRAPH_PREDICATES,
  QUEST_GRAPH_SOURCE_KINDS,
  QUEST_GRAPH_TRIGGER_KINDS,
  QUEST_STATUSES,
  campaignId,
  isoTimestamp,
  questId,
  type CampaignId,
  type IsoTimestamp,
  type QuestGraphEdge,
  type QuestGraphEntityState,
  type QuestGraphEvaluation,
  type QuestGraphSnapshot,
  type QuestGraphStatusChange,
  type QuestGraphTriggerKind,
} from '@ember-tavern/contracts';
import { evaluateQuestGraph, validateQuestGraph } from '@ember-tavern/domain';

import { PersistenceDataError } from './campaign-repository.js';
import {
  parseJson,
  requireArray,
  requireEnum,
  requireNullableString,
  requireNumber,
  requireRecord,
  requireString,
  requireStringArray,
} from './persistence-validation.js';
import type { TransactionalSqliteDatabase } from './sqlite-port.js';

export interface ReplaceQuestGraph {
  readonly operationId: string;
  readonly campaignId: CampaignId;
  readonly expectedRevision: number;
  readonly edges: readonly QuestGraphEdge[];
  readonly occurredAt: IsoTimestamp;
}

export interface EvaluateQuestGraph {
  readonly operationId: string;
  readonly campaignId: CampaignId;
  readonly triggerKind: QuestGraphTriggerKind;
  readonly triggerId: string;
  readonly occurredAt: IsoTimestamp;
}

export class QuestGraphRepository {
  private readonly database: TransactionalSqliteDatabase;

  public constructor(database: TransactionalSqliteDatabase) {
    this.database = database;
  }

  public get(campaign: CampaignId): QuestGraphSnapshot {
    const graph = requireRecord(
      this.database.prepare('SELECT * FROM quest_graphs WHERE campaign_id=?').get(campaign),
      `Quest graph not found: ${campaign}`,
    );
    const edges = this.database
      .prepare(
        `SELECT * FROM quest_graph_edges
         WHERE campaign_id=? ORDER BY priority DESC,id`,
      )
      .all(campaign)
      .map(mapEdge);
    const evaluations = this.database
      .prepare(
        `SELECT * FROM quest_graph_evaluations
         WHERE campaign_id=? ORDER BY occurred_at DESC,operation_id DESC LIMIT 20`,
      )
      .all(campaign)
      .map(mapEvaluation);
    return Object.freeze({
      campaignId: campaignId(requireString(graph['campaign_id'], 'campaign_id')),
      revision: positiveInteger(graph['revision'], 'revision'),
      edges: Object.freeze(edges),
      evaluations: Object.freeze(evaluations),
      updatedAt: isoTimestamp(requireString(graph['updated_at'], 'updated_at')),
    });
  }

  public replace(input: ReplaceQuestGraph): QuestGraphSnapshot {
    return this.transaction('Quest graph replacement', () =>
      this.replaceInCurrentTransaction(input),
    );
  }

  public replaceInCurrentTransaction(input: ReplaceQuestGraph): QuestGraphSnapshot {
    validateOperation(input.operationId, input.occurredAt);
    if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1) {
      throw new PersistenceDataError('Quest graph expected revision is invalid');
    }
    if (input.edges.some(({ campaignId: edgeCampaign }) => edgeCampaign !== input.campaignId)) {
      throw new PersistenceDataError('Quest graph edge belongs to another campaign');
    }
    const edges = Object.freeze(
      [...input.edges].sort((left, right) => left.id.localeCompare(right.id)),
    );
    const entities = loadEntityStates(this.database, input.campaignId);
    validateQuestGraph(edges, entities);
    const serialized = JSON.stringify(edges);
    const replay = this.database
      .prepare(
        'SELECT revision,edges_json,occurred_at FROM quest_graph_revisions WHERE operation_id=?',
      )
      .get(input.operationId);
    if (replay !== undefined) {
      const row = requireRecord(replay, 'Quest graph revision replay');
      if (
        requireNumber(row['revision'], 'revision') !== input.expectedRevision + 1 ||
        requireString(row['edges_json'], 'edges_json') !== serialized ||
        requireString(row['occurred_at'], 'occurred_at') !== input.occurredAt
      ) {
        throw new PersistenceDataError('Quest graph operation was reused with other input');
      }
      return this.get(input.campaignId);
    }
    const current = this.get(input.campaignId);
    if (current.revision !== input.expectedRevision) {
      throw new PersistenceDataError('Quest graph revision changed');
    }
    this.database
      .prepare('DELETE FROM quest_graph_edges WHERE campaign_id=?')
      .run(input.campaignId);
    const insert = this.database.prepare(
      `INSERT INTO quest_graph_edges (
         id,campaign_id,edge_kind,source_kind,source_id,predicate,expected_value,
         target_quest_id,satisfied_status,unsatisfied_status,priority,created_at
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    );
    for (const edge of edges) {
      insert.run(
        edge.id,
        edge.campaignId,
        edge.kind,
        edge.sourceKind,
        edge.sourceId,
        edge.predicate,
        edge.expectedValue,
        edge.targetQuestId,
        edge.satisfiedStatus,
        edge.unsatisfiedStatus,
        edge.priority,
        edge.createdAt,
      );
    }
    const nextRevision = current.revision + 1;
    one(
      this.database
        .prepare(
          `UPDATE quest_graphs SET revision=?,updated_at=?
           WHERE campaign_id=? AND revision=?`,
        )
        .run(nextRevision, input.occurredAt, input.campaignId, current.revision),
      'Quest graph changed during replacement',
    );
    this.database
      .prepare(
        `INSERT INTO quest_graph_revisions (
           operation_id,campaign_id,revision,edges_json,occurred_at
         ) VALUES (?,?,?,?,?)`,
      )
      .run(input.operationId, input.campaignId, nextRevision, serialized, input.occurredAt);
    this.evaluateInCurrentTransaction({
      operationId: `${input.operationId}:evaluation`,
      campaignId: input.campaignId,
      triggerKind: 'GRAPH_CHANGED',
      triggerId: input.operationId,
      occurredAt: input.occurredAt,
    });
    return this.get(input.campaignId);
  }

  public evaluate(input: EvaluateQuestGraph): QuestGraphSnapshot {
    return this.transaction('Quest graph evaluation', () =>
      this.evaluateInCurrentTransaction(input),
    );
  }

  public evaluateInCurrentTransaction(input: EvaluateQuestGraph): QuestGraphSnapshot {
    validateOperation(input.operationId, input.occurredAt);
    canonicalText(input.triggerId, 'Quest graph trigger ID', 200);
    if (!QUEST_GRAPH_TRIGGER_KINDS.includes(input.triggerKind)) {
      throw new PersistenceDataError('Quest graph trigger kind is invalid');
    }
    const replay = this.database
      .prepare('SELECT * FROM quest_graph_evaluations WHERE operation_id=?')
      .get(input.operationId);
    if (replay !== undefined) {
      const evaluation = mapEvaluation(replay);
      if (
        evaluation.campaignId !== input.campaignId ||
        evaluation.triggerKind !== input.triggerKind ||
        evaluation.triggerId !== input.triggerId ||
        evaluation.occurredAt !== input.occurredAt
      ) {
        throw new PersistenceDataError('Quest graph evaluation was reused with other input');
      }
      return this.get(input.campaignId);
    }
    const graph = this.get(input.campaignId);
    const entities = loadEntityStates(this.database, input.campaignId);
    const changes = evaluateQuestGraph(graph.edges, entities);
    for (const [index, change] of changes.entries()) {
      one(
        this.database
          .prepare(
            `UPDATE quest_pool_states SET
               status=?,revision=revision+1,last_source='LOCAL_RULE',last_reason=?,
               last_operation_id=?,updated_at=?
             WHERE quest_id=? AND campaign_id=? AND status=?`,
          )
          .run(
            change.toStatus,
            `Quest graph edges ${change.edgeIds.join(', ')} deterministically changed the quest.`,
            `${input.operationId}:change:${index}`,
            input.occurredAt,
            change.questId,
            input.campaignId,
            change.fromStatus,
          ),
        `Quest graph target changed during evaluation: ${change.questId}`,
      );
    }
    this.database
      .prepare(
        `INSERT INTO quest_graph_evaluations (
           operation_id,campaign_id,graph_revision,trigger_kind,trigger_id,
           evaluated_edge_ids_json,changes_json,occurred_at
         ) VALUES (?,?,?,?,?,?,?,?)`,
      )
      .run(
        input.operationId,
        input.campaignId,
        graph.revision,
        input.triggerKind,
        input.triggerId,
        JSON.stringify(graph.edges.map(({ id }) => id).sort()),
        JSON.stringify(changes),
        input.occurredAt,
      );
    return this.get(input.campaignId);
  }

  private transaction(label: string, run: () => QuestGraphSnapshot): QuestGraphSnapshot {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const result = run();
      this.database.exec('COMMIT');
      return result;
    } catch (error) {
      try {
        this.database.exec('ROLLBACK');
      } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], `${label} and rollback both failed`, {
          cause: rollbackError,
        });
      }
      throw error;
    }
  }
}

export function loadEntityStates(
  database: TransactionalSqliteDatabase,
  campaign: CampaignId,
): readonly QuestGraphEntityState[] {
  const entities: QuestGraphEntityState[] = [];
  for (const value of database
    .prepare(
      'SELECT quest_id AS id,status FROM quest_pool_states WHERE campaign_id=? ORDER BY quest_id',
    )
    .all(campaign)) {
    const row = requireRecord(value, 'Quest graph quest source');
    entities.push({
      kind: 'QUEST',
      id: requireString(row['id'], 'quest.id'),
      status: requireEnum(QUEST_STATUSES, row['status'], 'quest.status'),
    });
  }
  for (const value of database
    .prepare('SELECT id FROM world_facts WHERE campaign_id=? ORDER BY id')
    .all(campaign)) {
    entities.push({
      kind: 'WORLD_FACT',
      id: requireString(requireRecord(value, 'World fact')['id'], 'fact.id'),
    });
  }
  for (const value of database
    .prepare('SELECT id,current_status FROM npcs WHERE campaign_id=? ORDER BY id')
    .all(campaign)) {
    const row = requireRecord(value, 'Quest graph NPC source');
    entities.push({
      kind: 'NPC',
      id: requireString(row['id'], 'npc.id'),
      status: requireString(row['current_status'], 'npc.current_status'),
    });
  }
  for (const value of database
    .prepare(
      `SELECT id,materialization,json_extract(profile_json,'$.playerRelation') AS player_relation
       FROM active_factions WHERE campaign_id=? ORDER BY id`,
    )
    .all(campaign)) {
    const row = requireRecord(value, 'Quest graph Faction source');
    const materialization = requireString(row['materialization'], 'faction.materialization');
    const playerRelation = requireString(row['player_relation'], 'faction.player_relation');
    if (!['OUTLINE', 'ACTIVE'].includes(materialization)) {
      throw new PersistenceDataError('Faction materialization is invalid');
    }
    if (!['HOSTILE', 'WARY', 'NEUTRAL', 'FRIENDLY', 'ALLIED', 'UNKNOWN'].includes(playerRelation)) {
      throw new PersistenceDataError('Faction player relation is invalid');
    }
    entities.push({
      kind: 'FACTION',
      id: requireString(row['id'], 'faction.id'),
      materialization: materialization as 'OUTLINE' | 'ACTIVE',
      playerRelation: playerRelation as
        'HOSTILE' | 'WARY' | 'NEUTRAL' | 'FRIENDLY' | 'ALLIED' | 'UNKNOWN',
    });
  }
  for (const value of database
    .prepare('SELECT id,materialization FROM dynamic_locations WHERE campaign_id=? ORDER BY id')
    .all(campaign)) {
    const row = requireRecord(value, 'Quest graph Location source');
    const materialization = requireString(row['materialization'], 'location.materialization');
    if (!['OUTLINE', 'DETAILED'].includes(materialization)) {
      throw new PersistenceDataError('Location materialization is invalid');
    }
    entities.push({
      kind: 'LOCATION',
      id: requireString(row['id'], 'location.id'),
      materialization: materialization as 'OUTLINE' | 'DETAILED',
    });
  }
  return Object.freeze(entities);
}

function mapEdge(value: unknown): QuestGraphEdge {
  const row = requireRecord(value, 'Quest graph edge row');
  const unsatisfied = requireNullableString(row['unsatisfied_status'], 'unsatisfied_status');
  return Object.freeze({
    id: requireString(row['id'], 'id'),
    campaignId: campaignId(requireString(row['campaign_id'], 'campaign_id')),
    kind: requireEnum(QUEST_GRAPH_EDGE_KINDS, row['edge_kind'], 'edge_kind'),
    sourceKind: requireEnum(QUEST_GRAPH_SOURCE_KINDS, row['source_kind'], 'source_kind'),
    sourceId: requireString(row['source_id'], 'source_id'),
    predicate: requireEnum(QUEST_GRAPH_PREDICATES, row['predicate'], 'predicate'),
    expectedValue: requireString(row['expected_value'], 'expected_value'),
    targetQuestId: questId(requireString(row['target_quest_id'], 'target_quest_id')),
    satisfiedStatus: requireEnum(QUEST_STATUSES, row['satisfied_status'], 'satisfied_status'),
    unsatisfiedStatus:
      unsatisfied === null ? null : requireEnum(QUEST_STATUSES, unsatisfied, 'unsatisfied_status'),
    priority: nonNegativeInteger(row['priority'], 'priority'),
    createdAt: isoTimestamp(requireString(row['created_at'], 'created_at')),
  });
}

function mapEvaluation(value: unknown): QuestGraphEvaluation {
  const row = requireRecord(value, 'Quest graph evaluation row');
  return Object.freeze({
    operationId: requireString(row['operation_id'], 'operation_id'),
    campaignId: campaignId(requireString(row['campaign_id'], 'campaign_id')),
    graphRevision: positiveInteger(row['graph_revision'], 'graph_revision'),
    triggerKind: requireEnum(QUEST_GRAPH_TRIGGER_KINDS, row['trigger_kind'], 'trigger_kind'),
    triggerId: requireString(row['trigger_id'], 'trigger_id'),
    evaluatedEdgeIds: Object.freeze(
      requireStringArray(
        parseJson(row['evaluated_edge_ids_json'], 'evaluated_edge_ids_json'),
        'evaluated_edge_ids_json',
      ),
    ),
    changes: Object.freeze(
      requireArray(parseJson(row['changes_json'], 'changes_json'), 'changes_json').map(mapChange),
    ),
    occurredAt: isoTimestamp(requireString(row['occurred_at'], 'occurred_at')),
  });
}

function mapChange(value: unknown): QuestGraphStatusChange {
  const row = requireRecord(value, 'Quest graph change');
  return Object.freeze({
    questId: questId(requireString(row['questId'], 'change.questId')),
    fromStatus: requireEnum(QUEST_STATUSES, row['fromStatus'], 'change.fromStatus'),
    toStatus: requireEnum(QUEST_STATUSES, row['toStatus'], 'change.toStatus'),
    edgeIds: Object.freeze(requireStringArray(row['edgeIds'], 'change.edgeIds')),
  });
}

function validateOperation(operationId: string, occurredAt: IsoTimestamp): void {
  canonicalText(operationId, 'Quest graph operation ID', 180);
  isoTimestamp(occurredAt);
}

function canonicalText(value: string, label: string, max: number): void {
  if (value.length === 0 || value.length > max || value.trim() !== value) {
    throw new PersistenceDataError(`${label} is invalid`);
  }
}

function positiveInteger(value: unknown, label: string): number {
  const parsed = requireNumber(value, label);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new PersistenceDataError(`${label} must be a positive integer`);
  }
  return parsed;
}

function nonNegativeInteger(value: unknown, label: string): number {
  const parsed = requireNumber(value, label);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new PersistenceDataError(`${label} must be a non-negative integer`);
  }
  return parsed;
}

function one(result: { readonly changes: number | bigint }, message: string): void {
  if (result.changes !== 1 && result.changes !== 1n) throw new PersistenceDataError(message);
}

import {
  QUEST_STATUSES,
  type QuestGraphEdge,
  type QuestGraphEntityState,
  type QuestGraphStatusChange,
  type QuestStatus,
} from '@ember-tavern/contracts';

import { assertQuestPoolTransition, QUEST_TERMINAL_STATUSES } from './quest-pool.js';

const TERMINAL_STATUSES = new Set<QuestStatus>(QUEST_TERMINAL_STATUSES);

export class QuestGraphRuleError extends Error {
  public readonly code: 'EDGE_INVALID' | 'REFERENCE_INVALID' | 'CYCLE_DETECTED' | 'POLICY_CONFLICT';
  public readonly path: string;

  public constructor(code: QuestGraphRuleError['code'], path: string, options?: ErrorOptions) {
    super('Quest graph validation or evaluation failed', options);
    this.name = 'QuestGraphRuleError';
    this.code = code;
    this.path = path;
  }
}

interface Candidate {
  readonly status: QuestStatus;
  readonly priority: number;
  readonly edgeIds: readonly string[];
}

export function validateQuestGraph(
  edges: readonly QuestGraphEdge[],
  entities: readonly QuestGraphEntityState[],
): void {
  const states = entityMap(entities);
  const edgeIds = new Set<string>();
  const semantics = new Set<string>();
  for (const [index, edge] of edges.entries()) {
    validateEdge(edge, index);
    if (!edgeIds.add(edge.id)) conflict(`edges[${index}].id`);
    const semantic = [
      edge.kind,
      edge.sourceKind,
      edge.sourceId,
      edge.predicate,
      edge.expectedValue,
      edge.targetQuestId,
    ].join('\u0000');
    if (!semantics.add(semantic)) conflict(`edges[${index}]`);
    if (!states.has(sourceKey(edge.sourceKind, edge.sourceId))) {
      reference(`edges[${index}].sourceId`);
    }
    const target = states.get(sourceKey('QUEST', edge.targetQuestId));
    if (target?.kind !== 'QUEST') reference(`edges[${index}].targetQuestId`);
  }
  validatePrerequisitePolicies(edges);
  topologicalQuestOrder(edges, entities);
}

export function evaluateQuestGraph(
  edges: readonly QuestGraphEdge[],
  entities: readonly QuestGraphEntityState[],
): readonly QuestGraphStatusChange[] {
  validateQuestGraph(edges, entities);
  const states = entityMap(entities);
  const byTarget = new Map<string, QuestGraphEdge[]>();
  for (const edge of edges) {
    const current = byTarget.get(edge.targetQuestId) ?? [];
    current.push(edge);
    byTarget.set(edge.targetQuestId, current);
  }
  const changes: QuestGraphStatusChange[] = [];
  for (const targetId of topologicalQuestOrder(edges, entities)) {
    const targetEdges = byTarget.get(targetId);
    if (targetEdges === undefined) continue;
    const target = states.get(sourceKey('QUEST', targetId));
    if (target?.kind !== 'QUEST') reference(`target:${targetId}`);
    const candidate = selectCandidate(targetEdges, states);
    if (
      candidate === null ||
      candidate.status === target.status ||
      TERMINAL_STATUSES.has(target.status)
    ) {
      continue;
    }
    try {
      assertQuestPoolTransition(target.status, candidate.status, 'LOCAL_RULE');
    } catch (error) {
      throw new QuestGraphRuleError('POLICY_CONFLICT', `target:${targetId}`, { cause: error });
    }
    const change = Object.freeze({
      questId: target.id as QuestGraphStatusChange['questId'],
      fromStatus: target.status,
      toStatus: candidate.status,
      edgeIds: Object.freeze([...candidate.edgeIds].sort()),
    });
    changes.push(change);
    states.set(
      sourceKey('QUEST', targetId),
      Object.freeze({ ...target, status: candidate.status }),
    );
  }
  return Object.freeze(changes);
}

function selectCandidate(
  edges: readonly QuestGraphEdge[],
  states: ReadonlyMap<string, QuestGraphEntityState>,
): Candidate | null {
  const candidates: Candidate[] = [];
  const prerequisites = edges.filter(({ kind }) => kind === 'PREREQUISITE');
  if (prerequisites.length > 0) {
    const allSatisfied = prerequisites.every((edge) => predicateMatches(edge, states));
    const status = allSatisfied
      ? prerequisites[0]?.satisfiedStatus
      : prerequisites[0]?.unsatisfiedStatus;
    if (status !== undefined && status !== null) {
      candidates.push({
        status,
        priority: Math.max(...prerequisites.map(({ priority }) => priority)),
        edgeIds: prerequisites.map(({ id }) => id),
      });
    }
  }
  for (const edge of edges) {
    if (edge.kind === 'CONSEQUENCE' && predicateMatches(edge, states)) {
      candidates.push({
        status: edge.satisfiedStatus,
        priority: edge.priority,
        edgeIds: [edge.id],
      });
    }
  }
  if (candidates.length === 0) return null;
  const highest = Math.max(...candidates.map(({ priority }) => priority));
  const winners = candidates.filter(({ priority }) => priority === highest);
  const statuses = new Set(winners.map(({ status }) => status));
  if (statuses.size !== 1) conflict('evaluation.priority');
  const winner = winners[0];
  if (winner === undefined) conflict('evaluation.priority');
  return {
    status: winner.status,
    priority: highest,
    edgeIds: winners.flatMap(({ edgeIds }) => edgeIds),
  };
}

function predicateMatches(
  edge: QuestGraphEdge,
  states: ReadonlyMap<string, QuestGraphEntityState>,
): boolean {
  const source = states.get(sourceKey(edge.sourceKind, edge.sourceId));
  if (source === undefined) reference(`source:${edge.sourceKind}:${edge.sourceId}`);
  switch (source.kind) {
    case 'QUEST':
    case 'NPC':
      return source.status === edge.expectedValue;
    case 'WORLD_FACT':
      return edge.expectedValue === 'TRUE';
    case 'FACTION':
      return edge.predicate === 'MATERIALIZATION_EQUALS'
        ? source.materialization === edge.expectedValue
        : source.playerRelation === edge.expectedValue;
    case 'LOCATION':
      return source.materialization === edge.expectedValue;
  }
}

function validateEdge(edge: QuestGraphEdge, index: number): void {
  const path = `edges[${index}]`;
  canonical(edge.id, `${path}.id`, 200);
  canonical(edge.sourceId, `${path}.sourceId`, 200);
  canonical(edge.targetQuestId, `${path}.targetQuestId`, 200);
  canonical(edge.expectedValue, `${path}.expectedValue`, 120);
  if (!Number.isSafeInteger(edge.priority) || edge.priority < 0 || edge.priority > 1_000) {
    invalid(`${path}.priority`);
  }
  if (edge.kind === 'CONSEQUENCE' && edge.unsatisfiedStatus !== null) {
    invalid(`${path}.unsatisfiedStatus`);
  }
  switch (edge.sourceKind) {
    case 'QUEST':
      if (edge.predicate !== 'STATUS_EQUALS' || !isQuestStatus(edge.expectedValue)) {
        invalid(`${path}.predicate`);
      }
      break;
    case 'WORLD_FACT':
      if (edge.predicate !== 'EXISTS' || edge.expectedValue !== 'TRUE') {
        invalid(`${path}.predicate`);
      }
      break;
    case 'NPC':
      if (edge.predicate !== 'STATUS_EQUALS') invalid(`${path}.predicate`);
      break;
    case 'FACTION':
      if (
        (edge.predicate === 'MATERIALIZATION_EQUALS' &&
          !['OUTLINE', 'ACTIVE'].includes(edge.expectedValue)) ||
        (edge.predicate === 'PLAYER_RELATION_EQUALS' &&
          !['HOSTILE', 'WARY', 'NEUTRAL', 'FRIENDLY', 'ALLIED', 'UNKNOWN'].includes(
            edge.expectedValue,
          )) ||
        !['MATERIALIZATION_EQUALS', 'PLAYER_RELATION_EQUALS'].includes(edge.predicate)
      ) {
        invalid(`${path}.predicate`);
      }
      break;
    case 'LOCATION':
      if (
        edge.predicate !== 'MATERIALIZATION_EQUALS' ||
        !['OUTLINE', 'DETAILED'].includes(edge.expectedValue)
      ) {
        invalid(`${path}.predicate`);
      }
      break;
  }
}

function validatePrerequisitePolicies(edges: readonly QuestGraphEdge[]): void {
  const byTarget = new Map<string, QuestGraphEdge[]>();
  for (const edge of edges.filter(({ kind }) => kind === 'PREREQUISITE')) {
    const current = byTarget.get(edge.targetQuestId) ?? [];
    current.push(edge);
    byTarget.set(edge.targetQuestId, current);
  }
  for (const [target, prerequisites] of byTarget) {
    if (
      new Set(prerequisites.map(({ satisfiedStatus }) => satisfiedStatus)).size !== 1 ||
      new Set(prerequisites.map(({ unsatisfiedStatus }) => unsatisfiedStatus)).size !== 1
    ) {
      conflict(`prerequisite:${target}`);
    }
  }
}

function topologicalQuestOrder(
  edges: readonly QuestGraphEdge[],
  entities: readonly QuestGraphEntityState[],
): readonly string[] {
  const quests = entities.filter(({ kind }) => kind === 'QUEST').map(({ id }) => id);
  const adjacency = new Map(quests.map((id) => [id, new Set<string>()]));
  const indegree = new Map(quests.map((id) => [id, 0]));
  for (const edge of edges) {
    if (edge.sourceKind !== 'QUEST') continue;
    const targets = adjacency.get(edge.sourceId);
    if (targets === undefined || !indegree.has(edge.targetQuestId)) {
      reference(`edge:${edge.id}`);
    }
    if (!targets.has(edge.targetQuestId)) {
      targets.add(edge.targetQuestId);
      indegree.set(edge.targetQuestId, (indegree.get(edge.targetQuestId) ?? 0) + 1);
    }
  }
  const ready = quests.filter((id) => indegree.get(id) === 0).sort();
  const order: string[] = [];
  while (ready.length > 0) {
    const source = ready.shift();
    if (source === undefined) conflict('evaluation.order');
    order.push(source);
    for (const target of [...(adjacency.get(source) ?? [])].sort()) {
      const next = (indegree.get(target) ?? 0) - 1;
      indegree.set(target, next);
      if (next === 0) {
        ready.push(target);
        ready.sort();
      }
    }
  }
  if (order.length !== quests.length) throw new QuestGraphRuleError('CYCLE_DETECTED', 'edges');
  return Object.freeze(order);
}

function entityMap(entities: readonly QuestGraphEntityState[]): Map<string, QuestGraphEntityState> {
  const states = new Map<string, QuestGraphEntityState>();
  for (const [index, entity] of entities.entries()) {
    canonical(entity.id, `entities[${index}].id`, 200);
    const key = sourceKey(entity.kind, entity.id);
    if (states.has(key)) conflict(`entities[${index}]`);
    states.set(key, entity);
  }
  return states;
}

function sourceKey(kind: QuestGraphEntityState['kind'], id: string): string {
  return `${kind}\u0000${id}`;
}

function isQuestStatus(value: string): value is QuestStatus {
  return (QUEST_STATUSES as readonly string[]).includes(value);
}

function canonical(value: string, path: string, max: number): void {
  if (value.length === 0 || value.length > max || value.trim() !== value) invalid(path);
}

function invalid(path: string): never {
  throw new QuestGraphRuleError('EDGE_INVALID', path);
}

function reference(path: string): never {
  throw new QuestGraphRuleError('REFERENCE_INVALID', path);
}

function conflict(path: string): never {
  throw new QuestGraphRuleError('POLICY_CONFLICT', path);
}

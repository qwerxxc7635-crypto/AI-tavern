import {
  campaignId,
  isoTimestamp,
  questId,
  type QuestGraphEdge,
  type QuestGraphEntityState,
  type QuestStatus,
} from '@ember-tavern/contracts';
import { describe, expect, it } from 'vitest';

import { QuestGraphRuleError, evaluateQuestGraph, validateQuestGraph } from './quest-graph.js';

const campaign = campaignId('campaign-graph');
const at = isoTimestamp('2026-08-24T12:00:00.000Z');

describe('Quest Graph domain rules', () => {
  it('propagates a Quest branch and then a dependent chain in topological order', () => {
    const entities = questStates({ a: 'COMPLETED', b: 'BLOCKED', c: 'BLOCKED', d: 'BLOCKED' });
    const edges = [
      edge('a-b', 'QUEST', 'a', 'STATUS_EQUALS', 'COMPLETED', 'b', 'AVAILABLE', 20),
      edge('a-c', 'QUEST', 'a', 'STATUS_EQUALS', 'COMPLETED', 'c', 'AVAILABLE', 20),
      edge('b-d', 'QUEST', 'b', 'STATUS_EQUALS', 'AVAILABLE', 'd', 'AVAILABLE', 10),
    ];

    expect(evaluateQuestGraph(edges, entities)).toEqual([
      { questId: questId('b'), fromStatus: 'BLOCKED', toStatus: 'AVAILABLE', edgeIds: ['a-b'] },
      { questId: questId('c'), fromStatus: 'BLOCKED', toStatus: 'AVAILABLE', edgeIds: ['a-c'] },
      { questId: questId('d'), fromStatus: 'BLOCKED', toStatus: 'AVAILABLE', edgeIds: ['b-d'] },
    ]);
  });

  it('ANDs prerequisites and evaluates fact, NPC, Faction and Location authority', () => {
    const entities: QuestGraphEntityState[] = [
      ...questStates({
        factQuest: 'BLOCKED',
        npcQuest: 'ACTIVE',
        factionQuest: 'BLOCKED',
        locationQuest: 'BLOCKED',
      }),
      { kind: 'WORLD_FACT', id: 'fact-beacon' },
      { kind: 'NPC', id: 'npc-warden', status: 'DECEASED' },
      {
        kind: 'FACTION',
        id: 'faction-guild',
        materialization: 'ACTIVE',
        playerRelation: 'HOSTILE',
      },
      { kind: 'LOCATION', id: 'location-ruin', materialization: 'DETAILED' },
    ];
    const edges = [
      edge(
        'fact-ready',
        'WORLD_FACT',
        'fact-beacon',
        'EXISTS',
        'TRUE',
        'factQuest',
        'AVAILABLE',
        10,
        'PREREQUISITE',
        'BLOCKED',
      ),
      edge(
        'npc-failed',
        'NPC',
        'npc-warden',
        'STATUS_EQUALS',
        'DECEASED',
        'npcQuest',
        'FAILED',
        30,
      ),
      edge(
        'faction-ready',
        'FACTION',
        'faction-guild',
        'MATERIALIZATION_EQUALS',
        'ACTIVE',
        'factionQuest',
        'AVAILABLE',
        10,
      ),
      edge(
        'location-ready',
        'LOCATION',
        'location-ruin',
        'MATERIALIZATION_EQUALS',
        'DETAILED',
        'locationQuest',
        'AVAILABLE',
        10,
      ),
    ];

    expect(evaluateQuestGraph(edges, entities)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ questId: questId('factQuest'), toStatus: 'AVAILABLE' }),
        expect.objectContaining({ questId: questId('npcQuest'), toStatus: 'FAILED' }),
        expect.objectContaining({ questId: questId('factionQuest'), toStatus: 'AVAILABLE' }),
        expect.objectContaining({ questId: questId('locationQuest'), toStatus: 'AVAILABLE' }),
      ]),
    );
  });

  it('rejects cycles, dangling references and conflicting prerequisite policy', () => {
    const entities = questStates({ a: 'BLOCKED', b: 'BLOCKED' });
    expect(() =>
      validateQuestGraph(
        [
          edge('a-b', 'QUEST', 'a', 'STATUS_EQUALS', 'AVAILABLE', 'b', 'AVAILABLE', 10),
          edge('b-a', 'QUEST', 'b', 'STATUS_EQUALS', 'AVAILABLE', 'a', 'AVAILABLE', 10),
        ],
        entities,
      ),
    ).toThrow(expect.objectContaining({ code: 'CYCLE_DETECTED' }));
    expect(() =>
      validateQuestGraph(
        [edge('missing', 'WORLD_FACT', 'missing', 'EXISTS', 'TRUE', 'a', 'AVAILABLE', 10)],
        entities,
      ),
    ).toThrow(expect.objectContaining({ code: 'REFERENCE_INVALID' }));
    expect(() =>
      validateQuestGraph(
        [
          edge(
            'one',
            'QUEST',
            'a',
            'STATUS_EQUALS',
            'AVAILABLE',
            'b',
            'AVAILABLE',
            10,
            'PREREQUISITE',
            'BLOCKED',
          ),
          edge(
            'two',
            'QUEST',
            'a',
            'STATUS_EQUALS',
            'ACTIVE',
            'b',
            'ACTIVE',
            10,
            'PREREQUISITE',
            'BLOCKED',
          ),
        ],
        entities,
      ),
    ).toThrow(QuestGraphRuleError);
  });
});

function questStates(values: Readonly<Record<string, QuestStatus>>): QuestGraphEntityState[] {
  return Object.entries(values).map(([id, status]) => ({ kind: 'QUEST', id, status }));
}

function edge(
  id: string,
  sourceKind: QuestGraphEdge['sourceKind'],
  sourceId: string,
  predicate: QuestGraphEdge['predicate'],
  expectedValue: string,
  target: string,
  satisfiedStatus: QuestStatus,
  priority: number,
  kind: QuestGraphEdge['kind'] = 'CONSEQUENCE',
  unsatisfiedStatus: QuestStatus | null = null,
): QuestGraphEdge {
  return {
    id,
    campaignId: campaign,
    kind,
    sourceKind,
    sourceId,
    predicate,
    expectedValue,
    targetQuestId: questId(target),
    satisfiedStatus,
    unsatisfiedStatus,
    priority,
    createdAt: at,
  };
}

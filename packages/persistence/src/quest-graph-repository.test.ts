import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';

import {
  campaignId,
  isoTimestamp,
  questId,
  type QuestGraphEdge,
  type QuestStatus,
} from '@ember-tavern/contracts';
import { afterEach, describe, expect, it } from 'vitest';

import {
  QuestGraphRepository,
  QuestPoolRepository,
  type SqliteStatement,
  type SqliteValue,
  type TransactionalSqliteDatabase,
} from './index.js';
import { applyMigrations } from './migrations.mjs';

const directories: string[] = [];
const campaign = campaignId('campaign-quest-graph');
const at = isoTimestamp('2026-08-24T12:00:00.000Z');
const later = isoTimestamp('2026-08-24T12:01:00.000Z');
const latest = isoTimestamp('2026-08-24T12:02:00.000Z');

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('QuestGraphRepository', () => {
  it('re-evaluates fact/entity branches and Quest chains atomically across reopen', async () => {
    const { database, path } = await createDatabase();
    seed(database);
    const sqlite = adaptDatabase(database);
    const graph = new QuestGraphRepository(sqlite);
    const configured = graph.replace({
      operationId: 'graph-configure',
      campaignId: campaign,
      expectedRevision: 1,
      edges: graphEdges(),
      occurredAt: at,
    });
    expect(configured).toMatchObject({ revision: 2 });
    expect(new QuestPoolRepository(sqlite).get(questId('d'))?.status).toBe('AVAILABLE');
    expect(new QuestPoolRepository(sqlite).get(questId('e'))?.status).toBe('AVAILABLE');
    expect(new QuestPoolRepository(sqlite).get(questId('f'))?.status).toBe('AVAILABLE');

    new QuestPoolRepository(sqlite).transition({
      operationId: 'complete-a',
      campaignId: campaign,
      questId: questId('a'),
      expectedRevision: 1,
      toStatus: 'COMPLETED',
      source: 'SYSTEM',
      reason: 'The source Quest completed.',
      occurredAt: later,
    });
    expect(new QuestPoolRepository(sqlite).get(questId('b'))?.status).toBe('AVAILABLE');
    expect(new QuestPoolRepository(sqlite).get(questId('c'))?.status).toBe('AVAILABLE');

    database.prepare("UPDATE npcs SET current_status='DECEASED' WHERE id='npc-graph'").run();
    const evaluated = graph.evaluate({
      operationId: 'npc-died',
      campaignId: campaign,
      triggerKind: 'NPC_CHANGE',
      triggerId: 'npc-graph',
      occurredAt: latest,
    });
    expect(new QuestPoolRepository(sqlite).get(questId('b'))?.status).toBe('FAILED');
    expect(evaluated.evaluations[0]).toMatchObject({
      operationId: 'npc-died',
      triggerKind: 'NPC_CHANGE',
      changes: [expect.objectContaining({ questId: questId('b'), toStatus: 'FAILED' })],
    });

    database.close();
    const reopened = new DatabaseSync(path);
    try {
      await applyMigrations(reopened);
      const restored = new QuestGraphRepository(adaptDatabase(reopened)).get(campaign);
      expect(restored).toMatchObject({ revision: 2 });
      expect(restored.edges).toHaveLength(6);
      expect(restored.evaluations).toHaveLength(3);
      expect(new QuestPoolRepository(adaptDatabase(reopened)).get(questId('b'))?.status).toBe(
        'FAILED',
      );
    } finally {
      reopened.close();
    }
  });

  it('rejects cycles, dangling references and illegal evaluation without partial writes', async () => {
    const { database } = await createDatabase();
    try {
      seed(database);
      const repository = new QuestGraphRepository(adaptDatabase(database));
      expect(() =>
        repository.replace({
          operationId: 'graph-cycle',
          campaignId: campaign,
          expectedRevision: 1,
          edges: [
            edge('a-b', 'QUEST', 'a', 'STATUS_EQUALS', 'ACTIVE', 'b', 'AVAILABLE', 10),
            edge('b-a', 'QUEST', 'b', 'STATUS_EQUALS', 'AVAILABLE', 'a', 'FAILED', 10),
          ],
          occurredAt: at,
        }),
      ).toThrow(expect.objectContaining({ code: 'CYCLE_DETECTED' }));
      expect(() =>
        repository.replace({
          operationId: 'graph-dangling',
          campaignId: campaign,
          expectedRevision: 1,
          edges: [edge('missing', 'WORLD_FACT', 'missing', 'EXISTS', 'TRUE', 'b', 'AVAILABLE', 10)],
          occurredAt: at,
        }),
      ).toThrow(expect.objectContaining({ code: 'REFERENCE_INVALID' }));
      expect(repository.get(campaign)).toMatchObject({ revision: 1, edges: [] });
      expect(
        database.prepare('SELECT COUNT(*) AS count FROM quest_graph_evaluations').get(),
      ).toEqual({ count: 0 });
      expect(() =>
        database
          .prepare(
            `INSERT INTO quest_graph_edges (
               id,campaign_id,edge_kind,source_kind,source_id,predicate,expected_value,
               target_quest_id,satisfied_status,unsatisfied_status,priority,created_at
             ) VALUES ('self',?,'CONSEQUENCE','QUEST','a','STATUS_EQUALS','ACTIVE',
               'a','FAILED',NULL,1,?)`,
          )
          .run(campaign, at),
      ).toThrow();
    } finally {
      database.close();
    }
  });
});

function graphEdges(): readonly QuestGraphEdge[] {
  return [
    edge('a-b', 'QUEST', 'a', 'STATUS_EQUALS', 'COMPLETED', 'b', 'AVAILABLE', 20),
    edge('a-c', 'QUEST', 'a', 'STATUS_EQUALS', 'COMPLETED', 'c', 'AVAILABLE', 20),
    edge('npc-b', 'NPC', 'npc-graph', 'STATUS_EQUALS', 'DECEASED', 'b', 'FAILED', 30),
    edge(
      'faction-d',
      'FACTION',
      'faction-graph',
      'MATERIALIZATION_EQUALS',
      'OUTLINE',
      'd',
      'AVAILABLE',
      10,
    ),
    edge(
      'location-e',
      'LOCATION',
      'location-graph',
      'MATERIALIZATION_EQUALS',
      'OUTLINE',
      'e',
      'AVAILABLE',
      10,
    ),
    edge('fact-f', 'WORLD_FACT', 'fact-graph', 'EXISTS', 'TRUE', 'f', 'AVAILABLE', 10),
  ];
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
): QuestGraphEdge {
  return {
    id,
    campaignId: campaign,
    kind: 'CONSEQUENCE',
    sourceKind,
    sourceId,
    predicate,
    expectedValue,
    targetQuestId: questId(target),
    satisfiedStatus,
    unsatisfiedStatus: null,
    priority,
    createdAt: at,
  };
}

async function createDatabase() {
  const directory = await mkdtemp(join(tmpdir(), 'ember-quest-graph-'));
  directories.push(directory);
  const path = join(directory, 'quest.sqlite');
  const database = new DatabaseSync(path);
  await applyMigrations(database);
  return { database, path };
}

function seed(database: DatabaseSync): void {
  database.exec(`
    INSERT INTO campaigns(id,schema_version,state,created_at,updated_at)
    VALUES('${campaign}',1,'TAVERN','${at}','${at}');
    INSERT INTO world_constitutions(
      campaign_id,schema_version,revision,status,world_type,era,technology,magic,peoples_json,
      society,politics,economy,combat_scale,death_rules,career_rules,equipment_rules,npc_rules,
      trait_rules,taboos_json,created_at,updated_at,locked_at
    ) VALUES('${campaign}',1,1,'LOCKED','Fantasy','Old','Iron','Rare','[]','Guilds','Council',
      'Trade','Local','Mortal','Open','Grounded','Persistent','Balanced','[]','${at}','${at}','${at}');
    INSERT INTO taverns(
      id,campaign_id,location_id,name,position,environment,special_rules_json,
      long_term_problem,changes_json,created_at,updated_at
    ) VALUES('tavern-graph','${campaign}','location-graph','Ember','Road','Warm','[]','Storm','[]','${at}','${at}');
    INSERT INTO npcs(
      id,campaign_id,tavern_id,residency,name,identity,appearance,personality,goal,secret,
      speech_style,current_mood,current_status,memories_json,created_at,updated_at
    ) VALUES('npc-graph','${campaign}','tavern-graph','OWNER','Keeper','Keeper','Coat','Steady',
      'Protect','Hidden','Brief','Calm','ACTIVE','[]','${at}','${at}');
    INSERT INTO world_facts(
      id,campaign_id,kind,statement,location_id,faction_ids_json,detail_json,
      supersedes_fact_id,created_at
    ) VALUES('fact-graph','${campaign}','DEVELOPING_FACT','The beacon is lit.',NULL,'[]','{}',NULL,'${at}');
    INSERT INTO dynamic_locations(
      id,campaign_id,schema_version,constitution_revision,location_kind,materialization,name,
      parent_location_id,profile_json,generation_record_id,revision,created_at,updated_at
    ) VALUES('location-graph','${campaign}',1,1,'CITY','OUTLINE','Harbor',NULL,
      '{"kind":"DYNAMIC_LOCATION","schemaVersion":1,"id":"location-graph","campaignId":"${campaign}","constitutionRevision":1,"locationKind":"CITY","materialization":"OUTLINE","name":"Harbor","description":"Harbor","parentLocationId":null,"atmosphere":null,"features":[],"factionIds":[],"currentSituation":null,"constitutionEvidence":{"technology":"Iron","magic":"Rare","society":"Guilds","politics":"Council"},"generationRecordId":null,"revision":1,"createdAt":"${at}","updatedAt":"${at}"}',
      NULL,1,'${at}','${at}');
    INSERT INTO active_factions(
      id,campaign_id,schema_version,constitution_revision,materialization,name,profile_json,
      generation_record_id,revision,created_at,updated_at
    ) VALUES('faction-graph','${campaign}',1,1,'OUTLINE','Guild',
      '{"kind":"ACTIVE_FACTION","schemaVersion":1,"id":"faction-graph","campaignId":"${campaign}","constitutionRevision":1,"materialization":"OUTLINE","name":"Guild","description":"Guild","goal":"Trade","resources":[],"leadership":[],"enemyFactionIds":[],"allyFactionIds":[],"territoryLocationIds":[],"currentAction":null,"playerRelation":"UNKNOWN","constitutionEvidence":{"technology":"Iron","society":"Guilds","politics":"Council","economy":"Trade"},"generationRecordId":null,"revision":1,"createdAt":"${at}","updatedAt":"${at}"}',
      NULL,1,'${at}','${at}');
    INSERT INTO quests(
      id,campaign_id,publisher_npc_id,content_json,status,risk,recommended_attributes_json,
      expected_turns_min,expected_turns_max,reward_tier,related_npc_ids_json,
      related_fact_ids_json,created_at,updated_at
    ) VALUES
      ('a','${campaign}','npc-graph','{"title":"A","summary":"A","objective":"A","failureCost":"A"}','ACTIVE','LOW','["knowledge"]',8,12,'BASIC','[]','[]','${at}','${at}'),
      ('b','${campaign}','npc-graph','{"title":"B","summary":"B","objective":"B","failureCost":"B"}','AVAILABLE','LOW','["knowledge"]',8,12,'BASIC','[]','[]','${at}','${at}'),
      ('c','${campaign}','npc-graph','{"title":"C","summary":"C","objective":"C","failureCost":"C"}','AVAILABLE','LOW','["knowledge"]',8,12,'BASIC','[]','[]','${at}','${at}'),
      ('d','${campaign}','npc-graph','{"title":"D","summary":"D","objective":"D","failureCost":"D"}','AVAILABLE','LOW','["knowledge"]',8,12,'BASIC','[]','[]','${at}','${at}'),
      ('e','${campaign}','npc-graph','{"title":"E","summary":"E","objective":"E","failureCost":"E"}','AVAILABLE','LOW','["knowledge"]',8,12,'BASIC','[]','[]','${at}','${at}'),
      ('f','${campaign}','npc-graph','{"title":"F","summary":"F","objective":"F","failureCost":"F"}','AVAILABLE','LOW','["knowledge"]',8,12,'BASIC','[]','[]','${at}','${at}');
    UPDATE quest_pool_states SET status='BLOCKED',revision=revision+1,last_source='SYSTEM',
      last_reason='Seed graph target',last_operation_id='seed:' || quest_id,updated_at='${at}'
    WHERE quest_id IN ('b','c','d','e','f');
  `);
}

function adaptDatabase(database: DatabaseSync): TransactionalSqliteDatabase {
  return {
    exec(sql) {
      database.exec(sql);
    },
    prepare(sql) {
      return adaptStatement(database.prepare(sql));
    },
  };
}

function adaptStatement(statement: StatementSync): SqliteStatement {
  return {
    run(...values: SqliteValue[]) {
      return statement.run(...values);
    },
    get(...values: SqliteValue[]) {
      return statement.get(...values);
    },
    all(...values: SqliteValue[]) {
      return statement.all(...values);
    },
  };
}

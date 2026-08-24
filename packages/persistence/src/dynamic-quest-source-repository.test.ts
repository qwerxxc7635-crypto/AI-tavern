import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';

import {
  campaignId,
  generationRecordId,
  isoTimestamp,
  npcId,
  questId,
  worldFactId,
  type DynamicQuestSourceKind,
  type Quest,
} from '@ember-tavern/contracts';
import { afterEach, describe, expect, it } from 'vitest';

import { DynamicQuestSourceRepository } from './dynamic-quest-source-repository.js';
import { applyMigrations } from './migrations.mjs';
import type { SqliteStatement, SqliteValue, TransactionalSqliteDatabase } from './sqlite-port.js';

const directories: string[] = [];
const campaign = campaignId('campaign-dynamic-quest');
const at = isoTimestamp('2026-08-24T13:00:00.000Z');

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('DynamicQuestSourceRepository', () => {
  it('adapts every durable source without exposing private NPC knowledge', async () => {
    const database = await createDatabase();
    try {
      seed(database);
      const repository = new DynamicQuestSourceRepository(adapt(database));
      const sources: readonly [DynamicQuestSourceKind, string, string][] = [
        ['NPC', 'timeline-source', 'AVAILABLE'],
        ['FACTION', 'faction-event-source', 'AVAILABLE'],
        ['WORLD_EVENT', 'event-world', 'AVAILABLE'],
        ['DISCOVERY', 'event-discovery', 'DISCOVERED'],
        ['PLAYER_ACTION', 'event-action', 'ACTIVE'],
        ['CONSEQUENCE', 'graph-consequence', 'HIDDEN'],
      ];
      for (const [kind, occurrence, expectedStatus] of sources) {
        const prepared = repository.prepare(campaign, kind, occurrence);
        expect(prepared).toMatchObject({
          initialStatus: expectedStatus,
          existingQuestId: null,
          budget: { policyVersion: 1, openQuestLimit: 12, remainingSlots: 12 },
          constitution: { revision: 1, magic: 'Rare' },
        });
        expect(JSON.stringify(prepared.input)).not.toContain('private route beneath the keep');
      }
      expect(repository.prepare(campaign, 'DISCOVERY', 'event-discovery').relevantFacts).toEqual([
        { id: worldFactId('fact-source'), statement: 'The beacon road is broken.' },
      ]);
    } finally {
      database.close();
    }
  });

  it('commits a player-created Active Quest once and rejects exhausted budget atomically', async () => {
    const database = await createDatabase();
    try {
      seed(database);
      const sqlite = adapt(database);
      const repository = new DynamicQuestSourceRepository(sqlite);
      const prepared = repository.prepare(campaign, 'PLAYER_ACTION', 'event-action');
      seedGeneration(database, 'generation-dynamic');
      const quest = dynamicQuest('quest-player-action', prepared.initialStatus);
      const committed = repository.commit({
        campaignId: campaign,
        sourceKind: 'PLAYER_ACTION',
        occurrenceId: 'event-action',
        expectedContextDigest: prepared.contextDigest,
        generationRecordId: generationRecordId('generation-dynamic'),
        quest,
        occurredAt: at,
      });
      expect(committed).toMatchObject({
        questId: quest.id,
        source: { kind: 'PLAYER_ACTION', playerIntervened: true },
      });
      expect(
        database.prepare('SELECT status FROM quest_pool_states WHERE quest_id=?').get(quest.id),
      ).toEqual({ status: 'ACTIVE' });
      expect(
        repository.commit({
          campaignId: campaign,
          sourceKind: 'PLAYER_ACTION',
          occurrenceId: 'event-action',
          expectedContextDigest: prepared.contextDigest,
          generationRecordId: generationRecordId('generation-dynamic'),
          quest,
          occurredAt: at,
        }),
      ).toEqual(committed);

      seedOpenQuests(database, 11);
      expect(() => repository.prepare(campaign, 'WORLD_EVENT', 'event-world')).toThrow(
        expect.objectContaining({ code: 'BUDGET_EXCEEDED' }),
      );
      expect(database.prepare('SELECT COUNT(*) AS count FROM dynamic_quest_sources').get()).toEqual(
        {
          count: 1,
        },
      );
      expect(
        database.prepare('SELECT COUNT(*) AS count FROM quest_pool_creation_intents').get(),
      ).toEqual({ count: 0 });
    } finally {
      database.close();
    }
  });
});

async function createDatabase(): Promise<DatabaseSync> {
  const directory = await mkdtemp(join(tmpdir(), 'ember-dynamic-quest-'));
  directories.push(directory);
  const database = new DatabaseSync(join(directory, 'dynamic.sqlite'));
  await applyMigrations(database);
  return database;
}

function seed(database: DatabaseSync): void {
  database.exec(`
    INSERT INTO campaigns(id,schema_version,state,created_at,updated_at)
    VALUES('${campaign}',1,'TAVERN','${at}','${at}');
    INSERT INTO world_constitutions(campaign_id,schema_version,revision,status,world_type,era,
      technology,magic,peoples_json,society,politics,economy,combat_scale,death_rules,
      career_rules,equipment_rules,npc_rules,trait_rules,taboos_json,created_at,updated_at,locked_at)
    VALUES('${campaign}',1,1,'LOCKED','Fantasy','Old','Iron','Rare','[]','Guilds','Council','Trade',
      'Local','Mortal','Open','Grounded','Persistent','Balanced','["No resurrection"]','${at}','${at}','${at}');
    INSERT INTO world_bibles(campaign_id,schema_version,name,current_region,summary,core_conflict,
      technology_level,power_rules_json,factions_json,locations_json,narrative_style,
      forbidden_elements_json,tavern_reason,story_hooks_json,locked_fields_json,created_at,updated_at)
    VALUES('${campaign}',1,'Ember Coast','Ash Harbor','A storm coast.','The beacon is fading.',
      'Iron','["Magic is rare."]','[]','[]','Grounded','[]','Travelers gather.','[]','[]','${at}','${at}');
    INSERT INTO player_characters(id,campaign_id,name,concept,story_preferences_json,
      content_boundaries_json,class_archetype,class_display_name,attributes_json,traits_json,
      personal_goal,background_json,initial_equipment_ids_json,created_at,updated_at)
    VALUES('player','${campaign}','Mara','Scout','[]','{}','ROGUE','Scout',
      '{"physique":2,"agility":4,"knowledge":3,"charisma":1}','[]','Explore','{}','[]','${at}','${at}');
    INSERT INTO taverns(id,campaign_id,location_id,name,position,environment,special_rules_json,
      long_term_problem,changes_json,created_at,updated_at)
    VALUES('tavern','${campaign}','harbor','Ember Rest','Road','Warm','[]','Storm','[]','${at}','${at}');
    INSERT INTO npcs(id,campaign_id,tavern_id,residency,name,identity,appearance,personality,goal,
      secret,speech_style,current_mood,current_status,memories_json,created_at,updated_at)
    VALUES('npc-source','${campaign}','tavern','OWNER','Ilyra','Keeper','Coat','Steady','Protect',
      'Hidden','Brief','Calm','ACTIVE','[]','${at}','${at}');
    UPDATE taverns SET owner_npc_id='npc-source' WHERE id='tavern';
    INSERT INTO conversations(id,campaign_id,kind,npc_id,adventure_id,created_at,updated_at)
    VALUES('conversation','${campaign}','NPC','npc-source',NULL,'${at}','${at}');
    INSERT INTO messages(id,conversation_id,sequence_number,role,speaker_npc_id,content,generation_record_id,created_at)
    VALUES('message-player','conversation',1,'PLAYER',NULL,'Can I help?',NULL,'${at}'),
      ('message-npc','conversation',2,'NPC','npc-source','Repair the beacon road.',NULL,'${at}');
    INSERT INTO npc_timeline_operations(id,operation_id,campaign_id,scope_kind,scope_id,player_intent,
      addressed_npc_id,hard_result_key,status,committed_ref_id,created_at,updated_at)
    VALUES('timeline-source','timeline-op','${campaign}','NPC_DIALOGUE','npc-source','Can I help?',
      'npc-source',NULL,'PENDING',NULL,'${at}','${at}');
    UPDATE npc_timeline_operations
      SET status='COMMITTED',committed_ref_id='message-npc',updated_at='${at}'
      WHERE id='timeline-source';
    INSERT INTO world_facts(id,campaign_id,kind,statement,location_id,faction_ids_json,detail_json,
      supersedes_fact_id,created_at)
    VALUES('fact-source','${campaign}','DEVELOPING_FACT','The beacon road is broken.',NULL,'[]','{}',NULL,'${at}');
    INSERT INTO world_truths(id,campaign_id,subject,predicate,object_json,authority,visibility,
      source_event_id,revision,created_at,updated_at)
    VALUES('truth-private','${campaign}','keep','route','"private route beneath the keep"',
      'LOCAL_RULE','SECRET',NULL,1,'${at}','${at}');
    INSERT INTO actor_knowledge(id,campaign_id,actor_type,actor_id,target_kind,truth_id,claim_id,
      knowledge_state,visibility,provenance_kind,provenance_source_id,provenance_event_id,
      learned_at,confidence,revision,updated_at)
    VALUES('knowledge-private','${campaign}','NPC','npc-source','TRUTH','truth-private',NULL,'KNOWN',
      'ACTOR_PRIVATE','LOCAL_RULE','seed',NULL,'${at}',1.0,1,'${at}');
    INSERT INTO dynamic_locations(id,campaign_id,schema_version,constitution_revision,location_kind,
      materialization,name,parent_location_id,profile_json,generation_record_id,revision,created_at,updated_at)
    VALUES('harbor','${campaign}',1,1,'CITY','OUTLINE','Harbor',NULL,
      '{"kind":"DYNAMIC_LOCATION","schemaVersion":1,"id":"harbor","campaignId":"${campaign}","constitutionRevision":1,"locationKind":"CITY","materialization":"OUTLINE","name":"Harbor","description":"Harbor","parentLocationId":null,"atmosphere":null,"features":[],"factionIds":[],"currentSituation":null,"constitutionEvidence":{"technology":"Iron","magic":"Rare","society":"Guilds","politics":"Council"},"generationRecordId":null,"revision":1,"createdAt":"${at}","updatedAt":"${at}"}',
      NULL,1,'${at}','${at}');
    INSERT INTO active_factions(id,campaign_id,schema_version,constitution_revision,materialization,
      name,profile_json,generation_record_id,revision,created_at,updated_at)
    VALUES('faction','${campaign}',1,1,'OUTLINE','Wardens',
      '{"kind":"ACTIVE_FACTION","schemaVersion":1,"id":"faction","campaignId":"${campaign}","constitutionRevision":1,"materialization":"OUTLINE","name":"Wardens","description":"Road wardens","goal":"Keep roads open","resources":[],"leadership":[],"enemyFactionIds":[],"allyFactionIds":[],"territoryLocationIds":["harbor"],"currentAction":null,"playerRelation":"FRIENDLY","constitutionEvidence":{"technology":"Iron","society":"Guilds","politics":"Council","economy":"Trade"},"generationRecordId":null,"revision":1,"createdAt":"${at}","updatedAt":"${at}"}',NULL,1,'${at}','${at}');
    INSERT INTO faction_action_events(id,campaign_id,faction_id,operation_id,source,action_kind,summary,
      cost,budget_decision_id,budget_json,proposal_json,affected_before_json,affected_after_json,
      before_revision,after_revision,quest_id,quest_before_status,quest_after_status,world_fact_id,occurred_at)
    VALUES('faction-event-source','${campaign}','faction','faction-action','PLAYER','MOBILIZE',
      'The Wardens seek help on the broken road.',1,'budget-faction','{}','{}','[]','[]',1,2,
      NULL,NULL,NULL,'fact-source','${at}');
    INSERT INTO game_events(id,campaign_id,schema_version,type,payload_json,occurred_at) VALUES
      ('event-world','${campaign}',1,'WORLD_CLOCK_ADVANCED','{"worldClockId":"clock","previous":1,"current":2,"triggeredStageThresholds":[]}','${at}'),
      ('event-discovery','${campaign}',1,'FACT_DISCOVERED','{"worldFactId":"fact-source","playerCharacterId":"player"}','${at}'),
      ('event-action','${campaign}',1,'PLAYER_ACTION_SUBMITTED','{"adventureId":"adventure","turnId":"turn","action":{"mode":"ACTION","text":"Protect the road"}}','${at}');
    INSERT INTO quest_graph_evaluations(operation_id,campaign_id,graph_revision,trigger_kind,trigger_id,
      evaluated_edge_ids_json,changes_json,occurred_at)
    VALUES('graph-consequence','${campaign}',1,'MANUAL_REEVALUATION','fact-source','[]',
      '[{"questId":"old","fromStatus":"ACTIVE","toStatus":"FAILED","edgeIds":["edge"]}]','${at}');
  `);
}

function seedGeneration(database: DatabaseSync, generation: string): void {
  const request = `request-${generation}`;
  database
    .prepare(
      `INSERT INTO pending_ai_requests
       (id,campaign_id,turn_id,idempotency_key,task,status,model_profile_id,input_json,
        context_json,attempt_count,last_error_json,created_at,updated_at)
       VALUES (?,?,NULL,?,'GENERATE_QUEST','COMMITTED',NULL,'{}','{}',1,NULL,?,?)`,
    )
    .run(request, campaign, `dynamic-quest:${generation}`, at, at);
  database
    .prepare(
      `INSERT INTO generation_records
       (id,campaign_id,request_id,task,model_profile_id,prompt_version,request_json,
        raw_response_text,validated_output_json,validation_error_json,started_at,completed_at)
       VALUES (?,?,?,'GENERATE_QUEST',NULL,3,'{}','{}','{}',NULL,?,?)`,
    )
    .run(generation, campaign, request, at, at);
}

function dynamicQuest(id: string, status: Quest['status']): Quest {
  return Object.freeze({
    id: questId(id),
    campaignId: campaign,
    publisherNpcId: npcId('npc-source'),
    content: Object.freeze({
      title: 'Guard the Beacon Road',
      summary: 'Keep the road open while the beacon is repaired.',
      objective: 'Escort the Wardens to the beacon.',
      failureCost: 'The harbor loses its warning light.',
    }),
    status,
    risk: 'MODERATE',
    recommendedAttributes: Object.freeze(['agility', 'knowledge'] as const),
    expectedTurns: Object.freeze({ min: 8, max: 10 }),
    rewardTier: 'NOTABLE',
    relatedNpcIds: Object.freeze([npcId('npc-source')]),
    relatedFactIds: Object.freeze([]),
    createdAt: at,
    updatedAt: at,
  });
}

function seedOpenQuests(database: DatabaseSync, count: number): void {
  const statement = database.prepare(
    `INSERT INTO quests
     (id,campaign_id,publisher_npc_id,content_json,status,risk,recommended_attributes_json,
      expected_turns_min,expected_turns_max,reward_tier,related_npc_ids_json,
      related_fact_ids_json,created_at,updated_at)
     VALUES (?,?,?,'{"title":"Open","summary":"Open","objective":"Wait","failureCost":"None"}',
      'AVAILABLE','LOW','["agility"]',8,8,'BASIC','[]','[]',?,?)`,
  );
  for (let index = 0; index < count; index += 1) {
    statement.run(`quest-open-${index}`, campaign, 'npc-source', at, at);
  }
}

function adapt(value: DatabaseSync): TransactionalSqliteDatabase {
  return {
    exec(sql) {
      value.exec(sql);
    },
    prepare(sql) {
      return adaptStatement(value.prepare(sql));
    },
  };
}

function adaptStatement(value: StatementSync): SqliteStatement {
  return {
    run(...parameters: readonly SqliteValue[]) {
      const result = value.run(...parameters);
      return { changes: Number(result.changes), lastInsertRowid: Number(result.lastInsertRowid) };
    },
    get(...parameters: readonly SqliteValue[]) {
      return value.get(...parameters) as Record<string, SqliteValue> | undefined;
    },
    all(...parameters: readonly SqliteValue[]) {
      return value.all(...parameters) as Record<string, SqliteValue>[];
    },
  };
}

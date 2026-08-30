import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';

import { campaignId, createActiveFactionProfile } from '@ember-tavern/contracts';
import { afterEach, describe, expect, it } from 'vitest';

import {
  TavernPopulationRepository,
  type SqliteStatement,
  type SqliteValue,
  type TransactionalSqliteDatabase,
} from './index.js';
import { applyMigrations } from './migrations.mjs';

const directories: string[] = [];
const at = '2026-08-24T08:00:00.000Z';
const later = '2026-08-24T09:00:00.000Z';

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe('TavernPopulationRepository', () => {
  it('projects context factors once, responds to clock and event changes, focuses, and reloads', async () => {
    const campaign = campaignId('campaign-population');
    const { database, path } = await createDatabase();
    let open: DatabaseSync | null = database;
    try {
      seedWorld(database, campaign, true);
      const ids = ['npc-location', 'npc-clock', 'npc-faction', 'npc-event-1', 'npc-event-2'];
      const repository = new TavernPopulationRepository(adaptDatabase(database), () => {
        const id = ids.shift();
        if (id === undefined) throw new Error('Unexpected population identity allocation');
        return id;
      });
      const first = repository.project({
        campaignId: campaign,
        trigger: 'ENTERED',
        operationId: 'population-operation-1',
        cycleId: 'population-cycle-1',
        at,
      });
      expect(first.state).toMatchObject({ revision: 1, emptyState: false });
      expect(
        first.members
          .filter(({ presence }) => presence === 'PRESENT')
          .map(({ sourceKind }) => sourceKind),
      ).toEqual(['CLOCK', 'EVENT', 'FACTION', 'LOCATION', 'OWNER']);
      expect(first.state?.opportunities.map(({ kind }) => kind).sort()).toEqual([
        'CLOCK',
        'EVENT',
        'FACTION',
        'QUEST',
        'RUMOR',
      ]);
      expect(first.state?.opportunities.some(({ id }) => id.includes('outsider'))).toBe(false);
      const stableIds = new Map(
        first.members.map(({ sourceKind, sourceId, npcId }) => [
          `${sourceKind}:${sourceId}`,
          npcId,
        ]),
      );
      expect(
        repository.project({
          campaignId: campaign,
          trigger: 'MANUAL_REFRESH',
          operationId: 'population-operation-noop',
          cycleId: 'population-cycle-noop',
          at,
        }),
      ).toEqual(first);

      database
        .prepare("UPDATE world_clocks SET current=2,updated_at=? WHERE id='clock-storm'")
        .run(later);
      database
        .prepare(
          `INSERT INTO game_events
          (id,campaign_id,schema_version,type,payload_json,occurred_at)
          VALUES ('event-second',?,1,'WORLD_CLOCK_ADVANCED','{"clockId":"clock-storm"}',?)`,
        )
        .run(campaign, later);
      const second = repository.project({
        campaignId: campaign,
        trigger: 'TIME_ADVANCED',
        operationId: 'population-operation-2',
        cycleId: 'population-cycle-2',
        at: later,
      });
      expect(second.state).toMatchObject({ revision: 2, trigger: 'TIME_ADVANCED' });
      expect(second.cycles).toHaveLength(2);
      for (const member of second.members.filter(({ sourceKind }) => sourceKind !== 'EVENT')) {
        expect(stableIds.get(`${member.sourceKind}:${member.sourceId}`)).toBe(member.npcId);
      }
      expect(second.members.find(({ sourceId }) => sourceId === 'event-first')?.presence).toBe(
        'ABSENT',
      );
      expect(second.members.find(({ sourceId }) => sourceId === 'event-second')?.presence).toBe(
        'PRESENT',
      );

      const owner = second.members.find(({ sourceKind }) => sourceKind === 'OWNER');
      if (owner === undefined || second.state === null) throw new Error('Owner projection missing');
      const focused = repository.focus({
        campaignId: campaign,
        npcId: owner.npcId,
        expectedRevision: second.state.revision,
        operationId: 'population-focus-operation',
        eventId: 'population-focus-event',
        at: later,
      });
      expect(focused.state?.revision).toBe(3);
      expect(focused.members.find(({ npcId }) => npcId === owner.npcId)).toMatchObject({
        isImportant: true,
        encounterCount: 3,
      });
      expect(focused.focusHistory).toHaveLength(1);
      expect(
        repository.focus({
          campaignId: campaign,
          npcId: owner.npcId,
          expectedRevision: 2,
          operationId: 'population-focus-operation',
          eventId: 'population-focus-event',
          at: later,
        }),
      ).toEqual(focused);

      database.close();
      open = null;
      const reopened = new DatabaseSync(path);
      open = reopened;
      await applyMigrations(reopened);
      expect(new TavernPopulationRepository(adaptDatabase(reopened)).snapshot(campaign)).toEqual(
        focused,
      );
    } finally {
      open?.close();
    }
  });

  it('persists an explicit empty state when only the established owner is present', async () => {
    const campaign = campaignId('campaign-population-empty');
    const { database } = await createDatabase();
    try {
      seedWorld(database, campaign, false);
      const snapshot = new TavernPopulationRepository(
        adaptDatabase(database),
        () => 'unused',
      ).project({
        campaignId: campaign,
        trigger: 'ENTERED',
        operationId: 'population-empty-operation',
        cycleId: 'population-empty-cycle',
        at,
      });
      expect(snapshot.state).toMatchObject({ emptyState: true, revision: 1 });
      expect(snapshot.members).toHaveLength(1);
      expect(snapshot.members[0]).toMatchObject({ sourceKind: 'OWNER', presence: 'PRESENT' });
    } finally {
      database.close();
    }
  });
});

async function createDatabase(): Promise<{ database: DatabaseSync; path: string }> {
  const directory = await mkdtemp(join(tmpdir(), 'ember-tavern-population-'));
  directories.push(directory);
  const path = join(directory, 'test.sqlite');
  const database = new DatabaseSync(path);
  await applyMigrations(database);
  return { database, path };
}

function seedWorld(database: DatabaseSync, campaign: string, withFactors: boolean): void {
  database
    .prepare(
      `INSERT INTO campaigns (id,schema_version,state,created_at,updated_at)
       VALUES (?,1,'TAVERN',?,?)`,
    )
    .run(campaign, at, at);
  database
    .prepare(
      `INSERT INTO world_bibles
      (campaign_id,schema_version,name,current_region,summary,core_conflict,technology_level,
       power_rules_json,factions_json,locations_json,narrative_style,forbidden_elements_json,
       tavern_reason,story_hooks_json,locked_fields_json,created_at,updated_at)
      VALUES (?,1,'Ember Coast','Ash Harbor','A coast.','Old roads.','Late medieval','[]','[]',?,
       'Grounded','[]','Crossroads','[]','[]',?,?)`,
    )
    .run(
      campaign,
      JSON.stringify([
        {
          id: 'location-region',
          name: 'Ember Coast',
          description: 'A storm coast.',
          parentLocationId: null,
          factionIds: [],
        },
        {
          id: 'location-city',
          name: 'Ash Harbor',
          description: 'A harbor city.',
          parentLocationId: 'location-region',
          factionIds: [],
        },
      ]),
      at,
      at,
    );
  database
    .prepare(
      `INSERT INTO world_constitutions
      (campaign_id,schema_version,revision,status,world_type,era,technology,magic,peoples_json,
       society,politics,economy,combat_scale,death_rules,career_rules,equipment_rules,npc_rules,
       trait_rules,taboos_json,created_at,updated_at,locked_at)
      VALUES (?,1,1,'DRAFT','Low fantasy','Late medieval','Late medieval','Rare','["Harbor folk"]',
       'Guild towns','Harbor councils','Coin and barter','Small-scale','Permanent','Social roles',
       'Local craft','Bounded knowledge','Tradeoffs','[]',?,?,NULL)`,
    )
    .run(campaign, at, at);
  database
    .prepare("UPDATE world_constitutions SET status='LOCKED',locked_at=? WHERE campaign_id=?")
    .run(at, campaign);
  const location = database
    .prepare('SELECT current_location_id FROM campaign_location_states WHERE campaign_id=?')
    .get(campaign) as { current_location_id: string };
  if (withFactors) {
    database
      .prepare('UPDATE campaign_location_states SET revision=2,updated_at=? WHERE campaign_id=?')
      .run(at, campaign);
  }
  database.exec('BEGIN IMMEDIATE');
  database
    .prepare(
      `INSERT INTO taverns
      (id,campaign_id,location_id,name,position,environment,special_rules_json,long_term_problem,
       owner_npc_id,changes_json,created_at,updated_at)
      VALUES ('tavern-ember',?,?,'Ember Tavern','Crossroads','Warm common room','[]','Old debt',NULL,'[]',?,?)`,
    )
    .run(campaign, location.current_location_id, at, at);
  database
    .prepare(
      `INSERT INTO npcs
      (id,campaign_id,tavern_id,residency,name,identity,appearance,personality,goal,secret,
       speech_style,current_mood,current_status,visit_json,memories_json,created_at,updated_at)
      VALUES ('npc-owner',?,'tavern-ember','OWNER','Mara','Tavern keeper','Scarred','Watchful',
       'Keep the tavern safe','Owes the wardens','Quiet','Alert','ACTIVE',NULL,'[]',?,?)`,
    )
    .run(campaign, at, at);
  database.prepare("UPDATE taverns SET owner_npc_id='npc-owner' WHERE id='tavern-ember'").run();
  database.exec('COMMIT');
  if (!withFactors) return;

  database
    .prepare(
      `INSERT INTO taverns
      (id,campaign_id,location_id,name,position,environment,special_rules_json,long_term_problem,
       owner_npc_id,changes_json,created_at,updated_at)
      VALUES ('tavern-outside',?,?,'Outer Inn','North road','Cold room','[]','No supplies',NULL,'[]',?,?)`,
    )
    .run(campaign, location.current_location_id, at, at);
  database
    .prepare(
      `INSERT INTO npcs
      (id,campaign_id,tavern_id,residency,name,identity,appearance,personality,goal,secret,
       speech_style,current_mood,current_status,visit_json,memories_json,created_at,updated_at)
      VALUES ('npc-outsider',?,'tavern-outside','OWNER','Iven','Other innkeeper','Tall','Distant',
       'Keep travelers north','None','Brief','Calm','ACTIVE',NULL,'[]',?,?)`,
    )
    .run(campaign, at, at);
  database
    .prepare("UPDATE taverns SET owner_npc_id='npc-outsider' WHERE id='tavern-outside'")
    .run();

  database
    .prepare(
      `INSERT INTO pending_ai_requests
      (id,campaign_id,turn_id,idempotency_key,task,status,model_profile_id,input_json,context_json,
       attempt_count,last_error_json,created_at,updated_at)
      VALUES ('request-faction',?,NULL,?,'GENERATE_FACTIONS','COMMITTED',NULL,'{}','{}',1,NULL,?,?)`,
    )
    .run(campaign, `${campaign}:faction`, at, at);
  database
    .prepare(
      `INSERT INTO generation_records
      (id,campaign_id,request_id,task,model_profile_id,prompt_version,request_json,raw_response_text,
       validated_output_json,validation_error_json,started_at,completed_at)
      VALUES ('generation-faction',?,'request-faction','GENERATE_FACTIONS',NULL,1,'{}','{}','{}',NULL,?,?)`,
    )
    .run(campaign, at, at);
  const faction = createActiveFactionProfile({
    schemaVersion: 1,
    id: 'faction-wardens',
    campaignId: campaign,
    constitutionRevision: 1,
    materialization: 'ACTIVE',
    name: 'Road Wardens',
    description: 'They patrol the roads.',
    goal: 'Keep the harbor road open.',
    resources: ['Road permits'],
    leadership: ['Captain Mara'],
    enemyFactionIds: [],
    allyFactionIds: [],
    territoryLocationIds: [location.current_location_id],
    currentAction: 'Questioning travelers at the gate.',
    playerRelation: 'NEUTRAL',
    constitutionEvidence: {
      technology: 'Late medieval',
      society: 'Guild towns',
      politics: 'Harbor councils',
      economy: 'Coin and barter',
    },
    generationRecordId: 'generation-faction',
    revision: 1,
    createdAt: at,
    updatedAt: at,
  });
  database
    .prepare(
      `INSERT INTO active_factions
      (id,campaign_id,schema_version,constitution_revision,materialization,name,profile_json,
       generation_record_id,revision,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      faction.id,
      faction.campaignId,
      faction.schemaVersion,
      faction.constitutionRevision,
      faction.materialization,
      faction.name,
      JSON.stringify(faction),
      faction.generationRecordId,
      faction.revision,
      faction.createdAt,
      faction.updatedAt,
    );
  database
    .prepare(
      `INSERT INTO world_clocks (id,campaign_id,name,current,max,stages_json,created_at,updated_at)
       VALUES ('clock-storm',?,'The harbor storm',1,4,'[]',?,?)`,
    )
    .run(campaign, at, at);
  database
    .prepare(
      `INSERT INTO game_events
      (id,campaign_id,schema_version,type,payload_json,occurred_at)
      VALUES ('event-first',?,1,'NPC_CREATED','{"npcId":"npc-owner"}',?)`,
    )
    .run(campaign, at);
  database
    .prepare(
      `INSERT INTO world_facts
      (id,campaign_id,kind,statement,location_id,faction_ids_json,detail_json,
       supersedes_fact_id,created_at)
      VALUES ('rumor-outsider',?,'RUMOR','The north inn has closed.',NULL,'[]',
       '{"sourceNpcId":"npc-outsider"}',NULL,?)`,
    )
    .run(campaign, at);
  database
    .prepare(
      `INSERT INTO world_facts
      (id,campaign_id,kind,statement,location_id,faction_ids_json,detail_json,
       supersedes_fact_id,created_at)
      VALUES ('rumor-bell',?,'RUMOR','A bell rings below the cellar.',NULL,'[]',
       '{"sourceNpcId":"npc-owner"}',NULL,?)`,
    )
    .run(campaign, at);
  database
    .prepare(
      `INSERT INTO quests
      (id,campaign_id,publisher_npc_id,content_json,status,risk,recommended_attributes_json,
       expected_turns_min,expected_turns_max,reward_tier,related_npc_ids_json,related_fact_ids_json,
       created_at,updated_at)
      VALUES ('quest-road',?,'npc-owner',?,'AVAILABLE','LOW','[]',2,4,'BASIC','[]','[]',?,?)`,
    )
    .run(
      campaign,
      JSON.stringify({
        title: 'Open the old road',
        summary: 'Find why caravans stopped.',
        objective: 'Reach the old milestone.',
        failureCost: 'The tavern loses supplies.',
      }),
      at,
      at,
    );
  database
    .prepare(
      `INSERT INTO quests
      (id,campaign_id,publisher_npc_id,content_json,status,risk,recommended_attributes_json,
       expected_turns_min,expected_turns_max,reward_tier,related_npc_ids_json,related_fact_ids_json,
       created_at,updated_at)
      VALUES ('quest-outsider',?,'npc-outsider',?,'AVAILABLE','LOW','[]',2,4,'BASIC','[]','[]',?,?)`,
    )
    .run(
      campaign,
      JSON.stringify({
        title: 'Help the outer inn',
        summary: 'This does not belong on the Ember Tavern board.',
        objective: 'Travel north.',
        failureCost: 'The outer inn closes.',
      }),
      at,
      at,
    );
}

function adaptDatabase(value: DatabaseSync): TransactionalSqliteDatabase {
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

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';

import { campaignId, factionActionProposal, factionId } from '@ember-tavern/contracts';
import { afterEach, describe, expect, it } from 'vitest';

import {
  ActiveFactionRepository,
  type SqliteStatement,
  type SqliteValue,
  type TransactionalSqliteDatabase,
} from './index.js';
import { applyMigrations } from './migrations.mjs';

const directories: string[] = [];
const campaign = campaignId('campaign-active-factions');
const at = '2026-08-20T10:00:00.000Z';
const later = '2026-08-20T11:00:00.000Z';

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe('ActiveFactionRepository', () => {
  it('activates WorldBible factions, applies reciprocal consequences, replays, and reloads', async () => {
    const { database, path } = await createDatabase();
    let open: DatabaseSync | null = database;
    try {
      seedWorld(database);
      seedGeneration(database);
      const repository = new ActiveFactionRepository(adaptDatabase(database));
      const outline = repository.snapshot(campaign);
      expect(outline.factions).toHaveLength(2);
      expect(outline.factions.every(({ materialization }) => materialization === 'OUTLINE')).toBe(
        true,
      );
      const candidates = outline.factions.map((profile) => ({
        id: profile.id,
        name: profile.name,
        goal: profile.goal,
        resources: profile.id === 'faction-wardens' ? ['Road permits'] : ['River boats'],
        leadership: profile.id === 'faction-wardens' ? ['Captain Mara'] : ['Speaker Iven'],
        enemyFactionIds: [],
        allyFactionIds: [],
        territoryLocationIds: profile.territoryLocationIds,
        currentAction: 'Securing the old road.',
        playerRelation: profile.playerRelation,
        constitutionEvidence: profile.constitutionEvidence,
      }));
      const activated = repository.activate({
        campaignId: campaign,
        requestedFactionIds: candidates.map(({ id }) => id),
        candidates,
        generationRecordId: 'generation-factions',
        at: later,
      });
      expect(activated.factions.every(({ materialization }) => materialization === 'ACTIVE')).toBe(
        true,
      );
      expect(
        repository.activate({
          campaignId: campaign,
          requestedFactionIds: candidates.map(({ id }) => id),
          candidates,
          generationRecordId: 'generation-factions',
          at: later,
        }),
      ).toEqual(activated);

      const proposal = factionActionProposal({
        id: 'proposal-alliance',
        factionId: 'faction-wardens',
        kind: 'DIPLOMACY',
        source: 'PLAYER',
        summary: 'The wardens recognize the ferrymen as allies.',
        requiredResources: ['Road permits'],
        targetFactionId: 'faction-ferrymen',
        targetLocationId: null,
        targetQuestId: null,
        consequences: [
          { kind: 'RELATION_SET', factionId: factionId('faction-ferrymen'), relation: 'ALLY' },
          { kind: 'PLAYER_RELATION_SET', relation: 'FRIENDLY' },
        ],
      });
      const command = {
        eventId: 'faction-event-alliance',
        operationId: 'faction-operation-alliance',
        campaignId: campaign,
        expectedRevision: 2,
        proposal,
        budget: { decisionId: 'budget-alliance', actionPoints: 3, questChanges: 0, worldFacts: 0 },
        worldFactId: null,
        at: later,
      } as const;
      const acted = repository.applyAction(command);
      expect(acted.actionHistory).toHaveLength(1);
      expect(acted.factions.find(({ id }) => id === 'faction-wardens')).toMatchObject({
        allyFactionIds: ['faction-ferrymen'],
        playerRelation: 'FRIENDLY',
        revision: 3,
      });
      expect(acted.factions.find(({ id }) => id === 'faction-ferrymen')?.allyFactionIds).toEqual([
        'faction-wardens',
      ]);
      expect(repository.applyAction(command)).toEqual(acted);

      database.close();
      open = null;
      const reopened = new DatabaseSync(path);
      open = reopened;
      await applyMigrations(reopened);
      expect(new ActiveFactionRepository(adaptDatabase(reopened)).snapshot(campaign)).toEqual(
        acted,
      );
    } finally {
      open?.close();
    }
  });
});

async function createDatabase(): Promise<{ database: DatabaseSync; path: string }> {
  const directory = await mkdtemp(join(tmpdir(), 'ember-active-factions-'));
  directories.push(directory);
  const path = join(directory, 'test.sqlite');
  const database = new DatabaseSync(path);
  await applyMigrations(database);
  return { database, path };
}

function seedWorld(database: DatabaseSync): void {
  database
    .prepare(
      `INSERT INTO campaigns (id,schema_version,state,created_at,updated_at)
    VALUES (?,1,'REVIEWING_WORLD',?,?)`,
    )
    .run(campaign, at, at);
  database
    .prepare(
      `INSERT INTO world_bibles
    (campaign_id,schema_version,name,current_region,summary,core_conflict,technology_level,
     power_rules_json,factions_json,locations_json,narrative_style,forbidden_elements_json,
     tavern_reason,story_hooks_json,locked_fields_json,created_at,updated_at)
    VALUES (?,1,'Ember Coast','Ash Harbor','A coast.','Old roads.','Late medieval','[]',?,?,'Grounded','[]','Crossroads','[]','[]',?,?)`,
    )
    .run(
      campaign,
      JSON.stringify([
        {
          id: 'faction-wardens',
          name: 'Road Wardens',
          description: 'Keep the roads.',
          goals: ['Reopen the king road.'],
          relations: [],
        },
        {
          id: 'faction-ferrymen',
          name: 'Ash Ferrymen',
          description: 'Keep the crossings.',
          goals: ['Protect the river route.'],
          relations: [],
        },
      ]),
      JSON.stringify([
        {
          id: 'location-region',
          name: 'Ember Coast',
          description: 'A storm coast.',
          parentLocationId: null,
          factionIds: ['faction-ferrymen'],
        },
        {
          id: 'location-city',
          name: 'Ash Harbor',
          description: 'The preset city.',
          parentLocationId: 'location-region',
          factionIds: ['faction-wardens'],
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
    .prepare(`UPDATE world_constitutions SET status='LOCKED',locked_at=? WHERE campaign_id=?`)
    .run(at, campaign);
}

function seedGeneration(database: DatabaseSync): void {
  database
    .prepare(
      `INSERT INTO pending_ai_requests
    (id,campaign_id,turn_id,idempotency_key,task,status,model_profile_id,input_json,context_json,
     attempt_count,last_error_json,created_at,updated_at)
    VALUES ('request-factions',?,NULL,'factions:activate','GENERATE_FACTIONS','COMMITTED',NULL,'{}','{}',1,NULL,?,?)`,
    )
    .run(campaign, later, later);
  database
    .prepare(
      `INSERT INTO generation_records
    (id,campaign_id,request_id,task,model_profile_id,prompt_version,request_json,raw_response_text,
     validated_output_json,validation_error_json,started_at,completed_at)
    VALUES ('generation-factions',?,'request-factions','GENERATE_FACTIONS',NULL,1,'{}','{}','{}',NULL,?,?)`,
    )
    .run(campaign, later, later);
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

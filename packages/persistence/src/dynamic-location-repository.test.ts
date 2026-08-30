import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';

import { campaignId, schemaVersion, type WorldConstitution } from '@ember-tavern/contracts';
import { materializeDynamicLocations } from '@ember-tavern/domain';
import { afterEach, describe, expect, it } from 'vitest';

import {
  DynamicLocationRepository,
  PersistenceDataError,
  type SqliteStatement,
  type SqliteValue,
  type TransactionalSqliteDatabase,
} from './index.js';
import { applyMigrations } from './migrations.mjs';

const directories: string[] = [];
const campaign = campaignId('campaign-dynamic-location-persistence');
const at = '2026-08-20T10:00:00.000Z';
const later = '2026-08-20T11:00:00.000Z';

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('DynamicLocationRepository', () => {
  it('projects locked WorldBible locations, materializes one connection, travels, and reloads', async () => {
    const { database, path } = await createDatabase();
    let active: DatabaseSync | null = database;
    try {
      seedWorld(database);
      const sqlite = adaptDatabase(database);
      const repository = new DynamicLocationRepository(sqlite);
      const initial = repository.snapshot(campaign);
      expect(initial.locations).toHaveLength(2);
      expect(initial.locations.every(({ materialization }) => materialization === 'OUTLINE')).toBe(
        true,
      );
      seedGeneration(database, 'generation-location-connected');
      const origin = initial.locations.find(({ id }) => id === 'location-city');
      if (origin === undefined) throw new Error('origin missing');
      const batch = materializeDynamicLocations({
        campaignId: campaign,
        constitution: constitution(),
        origin,
        expansionMode: 'CONNECTED',
        candidates: [candidate(origin.parentLocationId)],
        existing: initial.locations,
        allowedFactionIds: ['faction-harbor'],
        generationRecordId: 'generation-location-connected',
        at: later,
      });
      const expanded = repository.commitMaterialization({
        campaignId: campaign,
        ...batch,
        generationRecordId: 'generation-location-connected',
        at: later,
      });
      expect(expanded.locations).toHaveLength(3);
      const moved = repository.travel({
        campaignId: campaign,
        targetLocationId: 'location-road-village',
        expectedRevision: 1,
        mode: 'ROAD',
        eventId: 'travel-location-connected',
        operationId: 'travel-location:connected',
        at: later,
      });
      expect(moved.state).toMatchObject({
        currentLocationId: 'location-road-village',
        revision: 2,
      });
      expect(moved.travelHistory).toHaveLength(1);

      database.close();
      active = null;
      const reopened = new DatabaseSync(path);
      active = reopened;
      await applyMigrations(reopened);
      expect(new DynamicLocationRepository(adaptDatabase(reopened)).snapshot(campaign)).toEqual(
        moved,
      );
    } finally {
      active?.close();
    }
  });

  it('replays the same travel operation and rejects stale or non-adjacent travel', async () => {
    const { database } = await createDatabase();
    try {
      seedWorld(database);
      const repository = new DynamicLocationRepository(adaptDatabase(database));
      const command = {
        campaignId: campaign,
        targetLocationId: 'location-region',
        expectedRevision: 1,
        mode: 'FOOT' as const,
        eventId: 'travel-to-region',
        operationId: 'travel-op:region',
        at: later,
      };
      const first = repository.travel(command);
      expect(repository.travel(command)).toEqual(first);
      expect(() =>
        repository.travel({
          ...command,
          eventId: 'travel-stale',
          operationId: 'travel-op:stale',
        }),
      ).toThrow(PersistenceDataError);
    } finally {
      database.close();
    }
  });
});

function candidate(parentLocationId: string | null) {
  return {
    id: 'location-road-village',
    name: 'Roadside Ember',
    kind: 'VILLAGE' as const,
    parentLocationId,
    description: 'A settlement beyond the preset city.',
    atmosphere: 'Wind-worn and inhabited.',
    features: ['A marked shelter'],
    factionIds: ['faction-harbor'],
    connections: ['location-city'],
    currentSituation: 'Travelers are reopening the old route.',
    constitutionEvidence: evidence(),
  };
}

function constitution(): WorldConstitution {
  return {
    campaignId: campaign,
    schemaVersion: schemaVersion(1),
    revision: 1,
    status: 'LOCKED',
    worldType: 'Low fantasy',
    era: 'Late medieval',
    technology: evidence().technology,
    magic: evidence().magic,
    peoples: ['Harbor folk'],
    society: evidence().society,
    politics: evidence().politics,
    economy: 'Coin and barter',
    combatScale: 'Small-scale',
    deathRules: 'Death is permanent.',
    careerRules: 'Careers are social roles.',
    equipmentRules: 'Local craft.',
    npcRules: 'Bounded knowledge.',
    traitRules: 'Tradeoffs.',
    taboos: [],
    createdAt: at as WorldConstitution['createdAt'],
    updatedAt: at as WorldConstitution['updatedAt'],
    lockedAt: at as WorldConstitution['lockedAt'],
  };
}

function evidence() {
  return {
    technology: 'Late medieval',
    magic: 'Magic leaves a warm trace.',
    society: 'Guild towns',
    politics: 'Harbor councils',
  };
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
       VALUES (?,1,'Ember Coast','Ash Harbor','A coast.','Old roads.','Late medieval','[]',?,?,
        'Grounded','[]','Crossroads','[]','[]',?,?)`,
    )
    .run(
      campaign,
      JSON.stringify([
        {
          id: 'faction-harbor',
          name: 'Harbor Wardens',
          description: 'Road keepers',
          goals: [],
          relations: [],
        },
      ]),
      JSON.stringify([
        {
          id: 'location-region',
          name: 'Ember Coast',
          description: 'A storm coast.',
          parentLocationId: null,
          factionIds: ['faction-harbor'],
        },
        {
          id: 'location-city',
          name: 'Ash Harbor',
          description: 'The preset city.',
          parentLocationId: 'location-region',
          factionIds: ['faction-harbor'],
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
       VALUES (?,1,1,'DRAFT','Low fantasy','Late medieval',?,?,'["Harbor folk"]',?,?,
        'Coin and barter','Small-scale','Death is permanent.','Careers are social roles.',
        'Local craft.','Bounded knowledge.','Tradeoffs.','[]',?,?,NULL)`,
    )
    .run(
      campaign,
      evidence().technology,
      evidence().magic,
      evidence().society,
      evidence().politics,
      at,
      at,
    );
  database
    .prepare(`UPDATE world_constitutions SET status='LOCKED',locked_at=? WHERE campaign_id=?`)
    .run(at, campaign);
}

function seedGeneration(database: DatabaseSync, generation: string): void {
  const request = 'request-location-connected';
  database
    .prepare(
      `INSERT INTO pending_ai_requests
       (id,campaign_id,turn_id,idempotency_key,task,status,model_profile_id,input_json,
        context_json,attempt_count,last_error_json,created_at,updated_at)
       VALUES (?,?,NULL,'location:connected','GENERATE_LOCATIONS','COMMITTED',NULL,'{}','{}',1,NULL,?,?)`,
    )
    .run(request, campaign, later, later);
  database
    .prepare(
      `INSERT INTO generation_records
       (id,campaign_id,request_id,task,model_profile_id,prompt_version,request_json,
        raw_response_text,validated_output_json,validation_error_json,started_at,completed_at)
       VALUES (?,?,?,'GENERATE_LOCATIONS',NULL,1,'{}','{}','{}',NULL,?,?)`,
    )
    .run(generation, campaign, request, later, later);
}

async function createDatabase(): Promise<{ database: DatabaseSync; path: string }> {
  const directory = await mkdtemp(join(tmpdir(), 'ember-dynamic-locations-'));
  directories.push(directory);
  const path = join(directory, 'test.sqlite');
  const database = new DatabaseSync(path);
  await applyMigrations(database);
  return { database, path };
}

function adaptDatabase(value: DatabaseSync): TransactionalSqliteDatabase {
  return {
    exec(sql) {
      value.exec(sql);
    },
    prepare(sql): SqliteStatement {
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

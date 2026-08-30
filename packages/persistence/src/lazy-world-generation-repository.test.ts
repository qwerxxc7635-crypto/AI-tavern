import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import {
  campaignId,
  createCampaign,
  factionId,
  isoTimestamp,
  lazyWorldIntentKey,
  locationId,
  schemaVersion,
  snapshotId,
  type WorldBible,
  type WorldConstitutionContent,
} from '@ember-tavern/contracts';
import { describe, expect, it } from 'vitest';

import { CampaignRepository } from './campaign-repository.js';
import { LazyWorldGenerationRepository } from './lazy-world-generation-repository.js';
import { applyMigrations } from './migrations.mjs';
import { SnapshotRepository } from './snapshot-repository.js';
import { WorldConstitutionRepository } from './world-constitution-repository.js';
import { WorldRepository } from './world-repository.js';
import { WorldSeedRepository } from './world-seed-repository.js';

const campaign = campaignId('campaign-lazy-world');
const at = isoTimestamp('2026-08-24T12:00:00.000Z');
const later = isoTimestamp('2026-08-24T12:05:00.000Z');
const latest = isoTimestamp('2026-08-24T12:10:00.000Z');

describe('LazyWorldGenerationRepository', () => {
  it('creates a cold-start plan without generating a complete world', async () => {
    const database = await createDatabase(':memory:');
    const repository = new LazyWorldGenerationRepository(database);
    const plans = repository.seedCoreWorldPlan(coreInput(database));

    expect(plans.map(({ kind }) => kind)).toEqual([
      'INITIAL_CAREER_POOL',
      'TAVERN',
      'TAVERN_ROSTER',
      'FACTION_DETAILS',
      'LOCATION_DETAILS',
      'LOCATION_DETAILS',
    ]);
    expect(
      plans.every(({ state, attemptCount }) => state === 'PLANNED' && attemptCount === 0),
    ).toBe(true);
    expect(repository.listTransitions(campaign)).toHaveLength(plans.length);
    expect(repository.seedCoreWorldPlan(coreInput(database))).toEqual(plans);
    expect(repository.listTransitions(campaign)).toHaveLength(plans.length);
    for (const table of ['career_pools', 'taverns', 'npcs', 'quests', 'items']) {
      expect(database.prepare(`SELECT count(*) AS count FROM ${table}`).get()?.['count']).toBe(0);
    }
    expect(
      database
        .prepare("SELECT count(*) AS count FROM dynamic_locations WHERE materialization='OUTLINE'")
        .get()?.['count'],
    ).toBe(2);
    expect(
      database
        .prepare("SELECT count(*) AS count FROM active_factions WHERE materialization='OUTLINE'")
        .get()?.['count'],
    ).toBe(1);
    database.close();
  });

  it('deduplicates claims, isolates partial failure and rejects fake completion', async () => {
    const database = await createDatabase(':memory:');
    const repository = new LazyWorldGenerationRepository(database);
    repository.seedCoreWorldPlan(coreInput(database));
    const tavernIntent = lazyWorldIntentKey(campaign, 'TAVERN', campaign);
    const rosterIntent = lazyWorldIntentKey(campaign, 'TAVERN_ROSTER', campaign);
    const locationIntent = lazyWorldIntentKey(campaign, 'LOCATION_DETAILS', 'location-harbor');

    const running = repository.claim({
      campaignId: campaign,
      intentKey: tavernIntent,
      runId: 'run-tavern',
      occurredAt: later,
    });
    expect(running).toMatchObject({ state: 'RUNNING', attemptCount: 1, revision: 2 });
    expect(
      repository.claim({
        campaignId: campaign,
        intentKey: tavernIntent,
        runId: 'run-tavern',
        occurredAt: later,
      }),
    ).toEqual(running);
    expect(() =>
      repository.claim({
        campaignId: campaign,
        intentKey: tavernIntent,
        runId: 'run-conflict',
        occurredAt: later,
      }),
    ).toThrow('already running');
    expect(() =>
      repository.complete({
        campaignId: campaign,
        intentKey: tavernIntent,
        runId: 'run-tavern',
        artifactRef: 'tavern-lazy',
        occurredAt: latest,
      }),
    ).toThrow('requires a committed tavern');
    expect(repository.require(campaign, tavernIntent).state).toBe('RUNNING');

    insertTavern(database);
    expect(
      repository.complete({
        campaignId: campaign,
        intentKey: tavernIntent,
        runId: 'run-tavern',
        artifactRef: 'tavern-lazy',
        occurredAt: latest,
      }),
    ).toMatchObject({ state: 'SUCCEEDED', artifactRef: 'tavern-lazy' });
    repository.claim({
      campaignId: campaign,
      intentKey: rosterIntent,
      runId: 'run-roster',
      occurredAt: latest,
    });
    expect(
      repository.fail({
        campaignId: campaign,
        intentKey: rosterIntent,
        runId: 'run-roster',
        errorCode: 'NETWORK_ERROR',
        retryable: true,
        occurredAt: latest,
      }),
    ).toMatchObject({ state: 'FAILED', retryable: true, lastErrorCode: 'NETWORK_ERROR' });
    expect(repository.require(campaign, tavernIntent).state).toBe('SUCCEEDED');
    repository.claim({
      campaignId: campaign,
      intentKey: locationIntent,
      runId: 'run-location',
      occurredAt: latest,
    });
    insertDetailedLocationExpansion(database);
    expect(
      repository.complete({
        campaignId: campaign,
        intentKey: locationIntent,
        runId: 'run-location',
        artifactRef: 'location-cove',
        occurredAt: latest,
      }),
    ).toMatchObject({ state: 'SUCCEEDED', artifactRef: 'location-cove' });
    database.close();
  });

  it('recovers response loss, interruption and cancellation across reopen', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'ember-lazy-world-'));
    const path = join(directory, 'campaign.sqlite');
    try {
      let database = await createDatabase(path);
      let repository = new LazyWorldGenerationRepository(database);
      repository.seedCoreWorldPlan(coreInput(database));
      const tavernIntent = lazyWorldIntentKey(campaign, 'TAVERN', campaign);
      const factionIntent = lazyWorldIntentKey(campaign, 'FACTION_DETAILS', 'faction-guild');
      const locationIntent = lazyWorldIntentKey(campaign, 'LOCATION_DETAILS', 'location-beacon');
      repository.claim({
        campaignId: campaign,
        intentKey: tavernIntent,
        runId: 'run-response-loss',
        occurredAt: later,
      });
      insertTavern(database);
      repository.claim({
        campaignId: campaign,
        intentKey: factionIntent,
        runId: 'run-interrupted',
        occurredAt: later,
      });
      repository.cancel({
        campaignId: campaign,
        intentKey: locationIntent,
        runId: null,
        cancelledAt: later,
      });
      database.close();

      database = new DatabaseSync(path);
      await applyMigrations(database);
      repository = new LazyWorldGenerationRepository(database);
      const recovered = repository.recoverInterrupted(campaign, latest);
      expect(recovered.find(({ intentKey }) => intentKey === tavernIntent)).toMatchObject({
        state: 'SUCCEEDED',
        artifactRef: 'tavern-lazy',
      });
      expect(recovered.find(({ intentKey }) => intentKey === factionIntent)).toMatchObject({
        state: 'FAILED',
        retryable: true,
        lastErrorCode: 'INTERRUPTED',
      });
      expect(recovered.find(({ intentKey }) => intentKey === locationIntent)?.state).toBe(
        'CANCELLED',
      );
      expect(
        repository.claim({
          campaignId: campaign,
          intentKey: factionIntent,
          runId: 'run-retry',
          occurredAt: latest,
        }),
      ).toMatchObject({ state: 'RUNNING', attemptCount: 2 });
      database.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('round-trips plan state and append-only history through snapshots', async () => {
    const database = await createDatabase(':memory:');
    const repository = new LazyWorldGenerationRepository(database);
    repository.seedCoreWorldPlan(coreInput(database));
    const intentKey = lazyWorldIntentKey(campaign, 'FACTION_DETAILS', 'faction-guild');
    repository.claim({
      campaignId: campaign,
      intentKey,
      runId: 'run-before-snapshot',
      occurredAt: later,
    });
    repository.fail({
      campaignId: campaign,
      intentKey,
      runId: 'run-before-snapshot',
      errorCode: 'NETWORK_ERROR',
      retryable: true,
      occurredAt: latest,
    });
    const expectedPlan = repository.require(campaign, intentKey);
    const expectedTransitions = repository.listTransitions(campaign);
    const snapshots = new SnapshotRepository(database);
    const saved = snapshots.create({
      id: snapshotId('snapshot-lazy-world'),
      campaignId: campaign,
      kind: 'MANUAL',
      reason: 'M10-T01 lazy generation round-trip',
      schemaVersion: schemaVersion(30),
      createdAt: latest,
    });
    repository.claim({
      campaignId: campaign,
      intentKey,
      runId: 'run-after-snapshot',
      occurredAt: latest,
    });

    snapshots.restore(saved.id);
    expect(repository.require(campaign, intentKey)).toEqual(expectedPlan);
    expect(repository.listTransitions(campaign)).toEqual(expectedTransitions);
    database.close();
  });
});

async function createDatabase(path: string): Promise<DatabaseSync> {
  const database = new DatabaseSync(path);
  await applyMigrations(database);
  const campaigns = new CampaignRepository(database);
  campaigns.create(createCampaign({ id: campaign, schemaVersion: schemaVersion(1), now: at }));
  new WorldSeedRepository(database).create({
    campaignId: campaign,
    schemaVersion: schemaVersion(1),
    algorithm: 'EMBER_STREAM_V1',
    seed: '0123456789abcdef0123456789abcdef',
    createdAt: at,
  });
  const constitutions = new WorldConstitutionRepository(database);
  constitutions.saveDraft(campaign, constitutionContent(), at);
  new WorldRepository(database).saveBible(world());
  constitutions.lock(campaign, 1, at);
  return database;
}

function coreInput(database: DatabaseSync) {
  const worldValue = new WorldRepository(database).getBible(campaign);
  const constitution = new WorldConstitutionRepository(database).get(campaign);
  if (worldValue === null || constitution === null) throw new Error('core world setup failed');
  return { world: worldValue, constitution, hasWorldSeed: true, plannedAt: at } as const;
}

function world(): WorldBible {
  return {
    campaignId: campaign,
    schemaVersion: schemaVersion(1),
    name: 'Ash Coast',
    currentRegion: 'Harbor',
    summary: 'A storm coast.',
    coreConflict: 'The beacon dims.',
    technologyLevel: 'Iron age',
    powerRules: ['Oaths bind flame.'],
    factions: [
      {
        id: factionId('faction-guild'),
        name: 'Guild',
        description: 'Harbor guild.',
        goals: ['Keep trade moving.'],
        relations: [],
      },
    ],
    locations: [
      {
        id: locationId('location-harbor'),
        name: 'Harbor',
        description: 'A storm harbor.',
        parentLocationId: null,
        factionIds: [factionId('faction-guild')],
      },
      {
        id: locationId('location-beacon'),
        name: 'Beacon',
        description: 'An old beacon.',
        parentLocationId: locationId('location-harbor'),
        factionIds: [],
      },
    ],
    narrativeStyle: 'Grounded mystery.',
    forbiddenElements: [],
    tavernReason: 'Shelter from the storm.',
    storyHooks: ['Relight the beacon.'],
    lockedFields: [],
    createdAt: at,
    updatedAt: at,
  };
}

function constitutionContent(): WorldConstitutionContent {
  return {
    worldType: 'Dark fantasy',
    era: 'Age of storms',
    technology: 'Iron age',
    magic: 'Oath flame',
    peoples: ['Coastfolk'],
    society: 'Guild towns',
    politics: 'Council',
    economy: 'Sea trade',
    combatScale: 'Personal',
    deathRules: 'Mortal',
    careerRules: 'World grounded',
    equipmentRules: 'Semantic',
    npcRules: 'Persistent',
    traitRules: 'Narrative',
    taboos: [],
  };
}

function insertTavern(database: DatabaseSync): void {
  database
    .prepare(
      `INSERT INTO taverns (
         id,campaign_id,location_id,name,position,environment,special_rules_json,
         long_term_problem,owner_npc_id,changes_json,created_at,updated_at
       ) VALUES ('tavern-lazy',?,'location-harbor','Ember Rest','Harbor','Warm','[]',
         'Storm tide',NULL,'[]',?,?)`,
    )
    .run(campaign, later, later);
}

function insertDetailedLocationExpansion(database: DatabaseSync): void {
  database
    .prepare(
      `INSERT INTO dynamic_locations (
         id,campaign_id,schema_version,constitution_revision,location_kind,materialization,
         name,parent_location_id,profile_json,generation_record_id,revision,created_at,updated_at
       )
       SELECT 'location-cove',campaign_id,1,constitution_revision,'VILLAGE','DETAILED',
         'Cove',id,
         json_set(profile_json,
           '$.id','location-cove','$.locationKind','VILLAGE','$.materialization','DETAILED',
           '$.name','Cove','$.parentLocationId',id,'$.atmosphere','Salt fog',
           '$.currentSituation','Fishing boats are missing','$.revision',1,
           '$.createdAt',?,'$.updatedAt',?),
         NULL,1,?,?
       FROM dynamic_locations WHERE id='location-harbor' AND campaign_id=?`,
    )
    .run(latest, latest, latest, latest, campaign);
}

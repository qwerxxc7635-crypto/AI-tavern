import { DatabaseSync } from 'node:sqlite';

import {
  campaignId,
  createCampaign,
  factionId,
  isoTimestamp,
  locationId,
  schemaVersion,
  snapshotId,
  type PrefetchCandidateSeed,
  type WorldBible,
  type WorldConstitutionContent,
} from '@ember-tavern/contracts';
import { describe, expect, it } from 'vitest';

import { CampaignRepository } from './campaign-repository.js';
import { LazyWorldGenerationRepository } from './lazy-world-generation-repository.js';
import { applyMigrations } from './migrations.mjs';
import { PrefetchRepository } from './prefetch-repository.js';
import { SnapshotRepository } from './snapshot-repository.js';
import { WorldConstitutionRepository } from './world-constitution-repository.js';
import { WorldRepository } from './world-repository.js';
import { WorldSeedRepository } from './world-seed-repository.js';

const campaign = campaignId('campaign-prefetch-repository');
const at = isoTimestamp('2026-08-24T13:00:00.000Z');
const later = isoTimestamp('2026-08-24T13:01:00.000Z');
const readyAt = isoTimestamp('2026-08-24T13:02:00.000Z');
const resolvedAt = isoTimestamp('2026-08-24T13:03:00.000Z');

describe('PrefetchRepository', () => {
  it('records prediction, ready, hit and miss metrics without cached content', async () => {
    const database = await setup();
    const repository = new PrefetchRepository(database);
    const [candidate] = repository.savePredictions([seed('candidate-hit', 'P1')]);
    if (candidate === undefined) throw new Error('Expected a persisted prefetch candidate');
    expect(candidate).toMatchObject({ state: 'PREDICTED', priority: 'P1' });
    repository.start({
      id: candidate.id,
      executionId: 'execution-hit',
      processId: 'process-one',
      occurredAt: later,
      queueWaitMs: 12,
    });
    repository.ready({
      id: candidate.id,
      executionId: 'execution-hit',
      processId: 'process-one',
      occurredAt: readyAt,
      generationMs: 80,
    });
    expect(repository.hit(candidate.id, 'a'.repeat(64), resolvedAt).state).toBe('HIT');
    repository.recordUnpredictedMiss(campaign, 'LOCATION_DETAILS', 'location-other', resolvedAt);

    expect(repository.metrics(campaign)).toEqual({
      campaignId: campaign,
      predicted: 1,
      ready: 1,
      hits: 1,
      misses: 1,
      invalidated: 0,
      cancelled: 0,
      failed: 0,
      hitRatio: 0.5,
      averageQueueWaitMs: 12,
      averageGenerationMs: 80,
    });
    expect(
      database
        .prepare(
          "SELECT group_concat(name,',') AS names FROM pragma_table_info('prefetch_candidates')",
        )
        .get()?.['names'],
    ).not.toMatch(/payload|content|output|knowledge/iu);
    database.close();
  });

  it('invalidates stale process candidates and persists explicit cancellation', async () => {
    const database = await setup();
    const repository = new PrefetchRepository(database);
    repository.savePredictions([
      seed('candidate-running', 'P2', 'LOCATION_DETAILS', 'location-harbor'),
      seed('candidate-cancel', 'P2', 'LOCATION_DETAILS', 'location-beacon'),
      seed('candidate-rejected', 'P2', 'FACTION_DETAILS', 'faction-guild'),
    ]);
    repository.start({
      id: 'candidate-running',
      executionId: 'execution-running',
      processId: 'old-process',
      occurredAt: later,
      queueWaitMs: 4,
    });
    expect(repository.cancel('candidate-cancel', readyAt).state).toBe('CANCELLED');
    expect(
      repository.reject('candidate-rejected', 'PREFETCH_QUEUE_REJECTED', readyAt),
    ).toMatchObject({ state: 'FAILED', errorCode: 'PREFETCH_QUEUE_REJECTED' });
    repository.invalidateOpen(campaign, 'PROCESS_RESTART', resolvedAt);

    expect(repository.require('candidate-running')).toMatchObject({
      state: 'INVALIDATED',
      resolvedAt,
    });
    expect(repository.metrics(campaign)).toMatchObject({ invalidated: 1, cancelled: 1, failed: 1 });
    database.close();
  });

  it('rejects P1 prediction without approved budget and rolls back the batch', async () => {
    const database = await setup('DEFERRED');
    const repository = new PrefetchRepository(database);
    expect(() => repository.savePredictions([seed('candidate-rejected', 'P1')])).toThrow(
      'P1 prefetch requires an approved Director action',
    );
    expect(repository.list(campaign)).toEqual([]);
    expect(repository.events(campaign)).toEqual([]);
    database.close();
  });

  it('rejects an approved P1 action rebound to an unrelated eligible target', async () => {
    const database = await setup();
    const repository = new PrefetchRepository(database);

    expect(() =>
      repository.savePredictions([
        seed('candidate-rebound', 'P1', 'LOCATION_DETAILS', 'location-harbor'),
      ]),
    ).toThrow('P1 prefetch requires an approved Director action');
    expect(repository.list(campaign)).toEqual([]);
    database.close();
  });

  it('round-trips a ready provisional candidate and metrics without world writes', async () => {
    const database = await setup();
    const repository = new PrefetchRepository(database);
    repository.savePredictions([seed('candidate-snapshot', 'P1')]);
    repository.start({
      id: 'candidate-snapshot',
      executionId: 'execution-snapshot',
      processId: 'process-snapshot',
      occurredAt: later,
      queueWaitMs: 3,
    });
    repository.ready({
      id: 'candidate-snapshot',
      executionId: 'execution-snapshot',
      processId: 'process-snapshot',
      occurredAt: readyAt,
      generationMs: 20,
    });
    const expected = repository.require('candidate-snapshot');
    const expectedEvents = repository.events(campaign);
    const snapshot = new SnapshotRepository(database).create({
      id: snapshotId('snapshot-prefetch'),
      campaignId: campaign,
      kind: 'MANUAL',
      reason: 'M10-T02 prefetch audit round-trip',
      schemaVersion: schemaVersion(31),
      createdAt: resolvedAt,
    });
    repository.hit('candidate-snapshot', 'a'.repeat(64), resolvedAt);

    new SnapshotRepository(database).restore(snapshot.id);
    expect(repository.require('candidate-snapshot')).toEqual(expected);
    expect(repository.events(campaign)).toEqual(expectedEvents);
    database.close();
  });

  it('retains direct audit deletes but permits whole-campaign cascade deletion', async () => {
    const database = await setup();
    const repository = new PrefetchRepository(database);
    repository.savePredictions([seed('candidate-delete', 'P1')]);

    expect(() =>
      database.prepare('DELETE FROM prefetch_candidates WHERE id=?').run('candidate-delete'),
    ).toThrow('prefetch candidates are retained for metrics');
    database.prepare('DELETE FROM campaigns WHERE id=?').run(campaign);

    expect(
      database.prepare('SELECT count(*) AS count FROM prefetch_candidates').get()?.['count'],
    ).toBe(0);
    expect(database.prepare('SELECT count(*) AS count FROM prefetch_events').get()?.['count']).toBe(
      0,
    );
    database.close();
  });
});

function seed(
  id: string,
  priority: 'P1' | 'P2',
  kind: 'LOCATION_DETAILS' | 'FACTION_DETAILS' = 'FACTION_DETAILS',
  targetId = 'faction-guild',
): PrefetchCandidateSeed {
  return {
    id,
    campaignId: campaign,
    directorRunId: 'director-run-prefetch',
    lazyIntentKey: `lazy:${campaign}:${kind.toLowerCase()}:${targetId}`,
    kind,
    targetId,
    priority,
    sourceActionId: priority === 'P1' ? 'director-action-1' : null,
    predictionReason: priority === 'P1' ? 'DIRECTOR_APPROVED' : 'BACKGROUND_CAPACITY',
    contextDigest: 'a'.repeat(64),
    predictedAt: at,
  };
}

async function setup(budgetStatus: 'APPROVED' | 'DEFERRED' = 'APPROVED') {
  const database = new DatabaseSync(':memory:');
  await applyMigrations(database);
  new CampaignRepository(database).create(
    createCampaign({ id: campaign, schemaVersion: schemaVersion(1), now: at }),
  );
  new WorldSeedRepository(database).create({
    campaignId: campaign,
    schemaVersion: schemaVersion(1),
    algorithm: 'EMBER_STREAM_V1',
    seed: '0123456789abcdef0123456789abcdef',
    createdAt: at,
  });
  const constitutions = new WorldConstitutionRepository(database);
  constitutions.saveDraft(campaign, constitution(), at);
  new WorldRepository(database).saveBible(world());
  constitutions.lock(campaign, 1, at);
  const lazy = new LazyWorldGenerationRepository(database);
  const constitutionValue = constitutions.get(campaign);
  const worldValue = new WorldRepository(database).getBible(campaign);
  if (constitutionValue === null || worldValue === null) throw new Error('setup failed');
  lazy.seedCoreWorldPlan({
    world: worldValue,
    constitution: constitutionValue,
    hasWorldSeed: true,
    plannedAt: at,
  });
  database.prepare("UPDATE campaigns SET state='TAVERN' WHERE id=?").run(campaign);
  database
    .prepare(
      `INSERT INTO world_director_runs (
         id,campaign_id,trigger_kind,trigger_id,context_digest,pace,pressure_score,
         signals_json,suppressed_json,source_snapshot_json,created_at
       ) VALUES ('director-run-prefetch',?,'MANUAL','manual-prefetch',?,'BALANCED',4,
         '{}','[]',?,?)`,
    )
    .run(
      campaign,
      'a'.repeat(64),
      JSON.stringify({ campaignId: campaign, currentLocationId: 'location-harbor' }),
      at,
    );
  database
    .prepare(
      `INSERT INTO world_director_proposals (
         run_id,campaign_id,ordinal,action_id,kind,actor_entity_id,target_entity_ids_json,
         rationale,proposed_effects_json,urgency,cooldown_key,route
       ) VALUES ('director-run-prefetch',?,1,'director-action-1','FACTION_ACTION',
         'faction-guild','[]','Faction is active.','["Prepare candidate."]','MEDIUM',
         'director:faction:faction-guild','FACTION_RULES')`,
    )
    .run(campaign);
  database
    .prepare(
      `INSERT INTO director_budget_states (
         campaign_id,schema_version,game_day,game_time_minutes,daily_events_used,
         urgent_events_used,npc_proactive_used,background_changes_used,revision,updated_at
       ) VALUES (?,1,0,60,0,0,0,0,1,?)`,
    )
    .run(campaign, at);
  database
    .prepare(
      `INSERT INTO director_budget_admissions(run_id,campaign_id,admitted_at)
       VALUES ('director-run-prefetch',?,?)`,
    )
    .run(campaign, at);
  database
    .prepare(
      `INSERT INTO director_budget_entries (
         run_id,campaign_id,ordinal,category,status,requested_game_time,eligible_game_time,
         approved_game_time,reason,created_at,updated_at
       ) VALUES ('director-run-prefetch',?,1,'BACKGROUND_CHANGE',?,60,60,?,?,?,?)`,
    )
    .run(
      campaign,
      budgetStatus,
      budgetStatus === 'APPROVED' ? 60 : null,
      budgetStatus === 'APPROVED' ? 'AVAILABLE' : 'BACKGROUND_LIMIT',
      at,
      at,
    );
  return database;
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
        description: 'A harbor.',
        parentLocationId: null,
        factionIds: [factionId('faction-guild')],
      },
      {
        id: locationId('location-beacon'),
        name: 'Beacon',
        description: 'An old beacon.',
        parentLocationId: null,
        factionIds: [],
      },
    ],
    narrativeStyle: 'Grounded mystery.',
    forbiddenElements: [],
    tavernReason: 'Shelter.',
    storyHooks: ['Relight the beacon.'],
    lockedFields: [],
    createdAt: at,
    updatedAt: at,
  };
}

function constitution(): WorldConstitutionContent {
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

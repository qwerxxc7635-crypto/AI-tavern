import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';

import { FakeAIProvider, type ProviderConfig } from '@ember-tavern/ai-core';
import {
  aiRequestId,
  campaignId,
  factionId,
  generationRecordId,
  idempotencyKey,
  isoTimestamp,
  locationId,
} from '@ember-tavern/contracts';
import {
  CampaignRepository,
  GenerationRecordRepository,
  PendingAiRequestRepository,
  WorldRepository,
  type SqliteStatement,
  type SqliteValue,
  type TransactionalSqliteDatabase,
} from '@ember-tavern/persistence';
import { afterEach, describe, expect, it } from 'vitest';

import { applyMigrations } from '../../persistence/src/migrations.mjs';
import { AIOrchestrationError, WorldCreationUseCases } from './index.js';

const directories: string[] = [];
const campaignKey = campaignId('campaign-world-use-case');
const at = isoTimestamp('2026-07-31T01:10:00.000Z');
const config: ProviderConfig = {
  id: 'fake-provider',
  providerType: 'LOCAL_OPENAI_COMPATIBLE',
  presetKey: 'custom',
  displayName: 'Fake',
  baseUrl: null,
  credentialRef: null,
  options: {},
  enabled: true,
};

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('WorldCreationUseCases', () => {
  it('creates, generates, refines and confirms a Fake Provider world in SQLite', async () => {
    const database = await createDatabase();
    try {
      const sqlite = adaptDatabase(database);
      const useCases = createUseCases(sqlite);
      expect(useCases.createCampaign(campaignKey).state).toBe('CREATING_WORLD');

      const generated = await useCases.generateWorld({
        ...request('generate'),
        campaignId: campaignKey,
        concept: 'A storm-bound fantasy coast',
        storyPreferences: ['Mystery', 'Exploration'],
        contentBoundaries: {
          allowHorror: true,
          allowPermanentDeath: false,
          allowRomance: true,
          allowBetrayal: true,
          excludedContent: [],
        },
      });
      expect(generated).toMatchObject({
        name: 'Ember Coast',
        currentRegion: 'Ash Harbor',
        factions: [{ id: factionId('faction-0') }],
        locations: [{ id: locationId('location-0') }],
      });
      expect(new CampaignRepository(sqlite).get(campaignKey)?.state).toBe('REVIEWING_WORLD');
      expect(
        new PendingAiRequestRepository(sqlite).get(aiRequestId('request-generate'))?.status,
      ).toBe('COMMITTED');
      expect(
        new GenerationRecordRepository(sqlite).get(generationRecordId('generation-generate')),
      ).toMatchObject({
        rawResponseText: expect.stringContaining('"Ember Coast"'),
        validationError: null,
      });

      const locked = { ...generated, lockedFields: ['powerRules'] as const };
      new WorldRepository(sqlite).saveBible(locked);
      const refined = await useCases.refineWorld({
        ...request('refine'),
        campaignId: campaignKey,
        revisionInstructions: ['Clarify the Lantern Guild role.'],
      });
      expect(refined.powerRules).toEqual(generated.powerRules);
      expect(refined.lockedFields).toEqual(['powerRules']);
      expect(refined.createdAt).toBe(generated.createdAt);
      expect(refined.factions[0]?.id).toBe(generated.factions[0]?.id);

      expect(useCases.confirmWorld(campaignKey).state).toBe('CREATING_CHARACTER');
      expect(new WorldRepository(sqlite).getBible(campaignKey)).toEqual(refined);
    } finally {
      database.close();
    }
  });

  it('refuses confirmation when no generated world exists', async () => {
    const database = await createDatabase();
    try {
      const sqlite = adaptDatabase(database);
      const useCases = createUseCases(sqlite);
      useCases.createCampaign(campaignKey);
      expect(() => useCases.confirmWorld(campaignKey)).toThrow(AIOrchestrationError);
      expect(new CampaignRepository(sqlite).get(campaignKey)?.state).toBe('CREATING_WORLD');
    } finally {
      database.close();
    }
  });
});

function request(suffix: string) {
  return {
    requestId: aiRequestId(`request-${suffix}`),
    generationRecordId: generationRecordId(`generation-${suffix}`),
    idempotencyKey: idempotencyKey(`campaign-world:${suffix}`),
    modelProfileId: null,
    modelName: 'ember-fake-v1',
    generationOptions: { temperature: 0, maxOutputTokens: 4_000, timeoutMs: 1_000 },
  };
}

function createUseCases(database: TransactionalSqliteDatabase) {
  return new WorldCreationUseCases(
    database,
    new FakeAIProvider(() => at),
    config,
    {
      faction: (_name, index) => factionId(`faction-${index}`),
      location: (_name, index) => locationId(`location-${index}`),
    },
    () => at,
  );
}

async function createDatabase(): Promise<DatabaseSync> {
  const directory = await mkdtemp(join(tmpdir(), 'ember-tavern-world-use-case-'));
  directories.push(directory);
  const database = new DatabaseSync(join(directory, 'world.sqlite'));
  await applyMigrations(database);
  return database;
}

function adaptDatabase(database: DatabaseSync): TransactionalSqliteDatabase {
  return {
    exec(sql) {
      database.exec(sql);
    },
    prepare(sql): SqliteStatement {
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

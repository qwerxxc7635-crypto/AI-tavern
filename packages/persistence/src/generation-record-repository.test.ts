import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';

import { FAKE_TASK_OUTPUTS, validateAIOutput } from '@ember-tavern/ai-core';
import {
  aiRequestId,
  campaignId,
  createCampaign,
  generationRecordId,
  isoTimestamp,
  promptVersion,
  schemaVersion,
} from '@ember-tavern/contracts';
import { afterEach, describe, expect, it } from 'vitest';

import {
  CampaignRepository,
  GenerationRecordRepository,
  PersistenceDataError,
  type SqliteDatabase,
  type SqliteStatement,
  type SqliteValue,
} from './index.js';
import { applyMigrations } from './migrations.mjs';

const directories: string[] = [];
const campaign = campaignId('campaign-generation');
const startedAt = isoTimestamp('2026-07-31T00:45:00.000Z');
const completedAt = isoTimestamp('2026-07-31T00:45:01.000Z');

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('GenerationRecordRepository', () => {
  it('retains an exact raw response and a separately validated output across reconnect', async () => {
    const { path, database } = await createDatabase();
    const id = generationRecordId('generation-success');
    const raw = `\n${JSON.stringify(FAKE_TASK_OUTPUTS.GENERATE_WORLD)}\n`;
    try {
      seedCampaign(database);
      const repository = new GenerationRecordRepository(adaptDatabase(database));
      repository.create(createRecord(id, 'request-success'));
      const validation = validateAIOutput('GENERATE_WORLD', raw);
      expect(validation.ok).toBe(true);
      if (!validation.ok) throw new Error('Expected valid fake world output');
      repository.complete(id, {
        rawResponseText: validation.rawResponseText,
        validatedOutput: validation.validatedOutput,
        validationError: null,
        completedAt,
      });
    } finally {
      database.close();
    }

    const reopened = new DatabaseSync(path);
    try {
      const restored = new GenerationRecordRepository(adaptDatabase(reopened)).get(id);
      expect(restored).toMatchObject({
        id,
        rawResponseText: raw,
        validationError: null,
        completedAt,
      });
      expect(restored?.validatedOutput).toEqual(FAKE_TASK_OUTPUTS.GENERATE_WORLD);
    } finally {
      reopened.close();
    }
  });

  it('persists located structure errors without treating raw text as validated output', async () => {
    const { database } = await createDatabase();
    try {
      seedCampaign(database);
      const repository = new GenerationRecordRepository(adaptDatabase(database));
      const id = generationRecordId('generation-failure');
      repository.create(createRecord(id, 'request-failure'));
      const raw = JSON.stringify({ risk: 'IMPOSSIBLE' });
      const validation = validateAIOutput('GENERATE_QUEST', raw);
      expect(validation.ok).toBe(false);
      if (validation.ok) throw new Error('Expected invalid quest output');
      repository.complete(id, {
        rawResponseText: validation.rawResponseText,
        validatedOutput: null,
        validationError: validation.error,
        completedAt,
      });

      expect(repository.get(id)).toMatchObject({
        rawResponseText: raw,
        validatedOutput: null,
        validationError: {
          code: 'SCHEMA_VALIDATION_FAILED',
          issues: expect.arrayContaining([expect.objectContaining({ path: ['content'] })]),
        },
      });
    } finally {
      database.close();
    }
  });

  it('rejects ambiguous completion, repeated completion and credential-bearing requests', async () => {
    const { database } = await createDatabase();
    try {
      seedCampaign(database);
      const repository = new GenerationRecordRepository(adaptDatabase(database));
      const id = generationRecordId('generation-guards');
      repository.create(createRecord(id, 'request-guards'));

      expect(() =>
        repository.complete(id, {
          rawResponseText: '{}',
          validatedOutput: {},
          validationError: { code: 'INVALID', issues: [{ path: [], code: 'x', message: 'x' }] },
          completedAt,
        }),
      ).toThrow('exactly one');

      repository.complete(id, {
        rawResponseText: '{"consistent":true,"issues":[]}',
        validatedOutput: { consistent: true, issues: [] },
        validationError: null,
        completedAt,
      });
      expect(() =>
        repository.complete(id, {
          rawResponseText: '{}',
          validatedOutput: {},
          validationError: null,
          completedAt,
        }),
      ).toThrow('already completed');

      expect(() =>
        repository.create({
          ...createRecord(generationRecordId('generation-secret'), 'request-secret'),
          request: { authorization: 'Bearer must-not-persist' },
        }),
      ).toThrow(PersistenceDataError);
    } finally {
      database.close();
    }
  });
});

function createRecord(id: ReturnType<typeof generationRecordId>, request: string) {
  return {
    id,
    campaignId: campaign,
    requestId: aiRequestId(request),
    task: 'GENERATE_WORLD',
    modelProfileId: null,
    promptVersion: promptVersion(1),
    request: {
      task: 'GENERATE_WORLD',
      context: { concept: 'Coastal fantasy' },
    },
    startedAt,
  };
}

function seedCampaign(database: DatabaseSync): void {
  new CampaignRepository(adaptDatabase(database)).create(
    createCampaign({ id: campaign, schemaVersion: schemaVersion(1), now: startedAt }),
  );
}

async function createDatabase(): Promise<{
  readonly path: string;
  readonly database: DatabaseSync;
}> {
  const directory = await mkdtemp(join(tmpdir(), 'ember-tavern-generation-'));
  directories.push(directory);
  const path = join(directory, 'generation.sqlite');
  const database = new DatabaseSync(path);
  await applyMigrations(database);
  return { path, database };
}

function adaptDatabase(database: DatabaseSync): SqliteDatabase {
  return {
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

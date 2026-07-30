import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';

import {
  campaignId,
  createCampaign,
  isoTimestamp,
  schemaVersion,
  transitionCampaign,
} from '@ember-tavern/contracts';
import { afterEach, describe, expect, it } from 'vitest';

import {
  CampaignNotFoundError,
  CampaignRepository,
  PersistenceDataError,
  type SqliteDatabase,
  type SqliteStatement,
  type SqliteValue,
} from './index.js';
import { applyMigrations } from './migrations.mjs';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function createDatabase(): Promise<{
  readonly path: string;
  readonly database: DatabaseSync;
}> {
  const directory = await mkdtemp(join(tmpdir(), 'ember-tavern-campaign-'));
  directories.push(directory);
  const path = join(directory, 'campaign.sqlite');
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

function campaign(id: string, at = '2026-07-30T15:00:00.000Z') {
  return createCampaign({
    id: campaignId(id),
    schemaVersion: schemaVersion(1),
    now: isoTimestamp(at),
  });
}

describe('CampaignRepository', () => {
  it('creates, reads, updates, archives, and lists campaigns', async () => {
    const { database } = await createDatabase();
    try {
      const repository = new CampaignRepository(adaptDatabase(database));
      const first = campaign('campaign-1');
      const second = campaign('campaign-2', '2026-07-30T15:01:00.000Z');
      repository.create(first);
      repository.create(second);
      expect(repository.get(first.id)).toEqual(first);

      const reviewed = transitionCampaign(
        first,
        'REVIEWING_WORLD',
        isoTimestamp('2026-07-30T15:02:00.000Z'),
      );
      repository.update(reviewed);
      expect(repository.get(first.id)).toEqual(reviewed);
      expect(repository.list().map(({ id }) => id)).toEqual([first.id, second.id]);

      const archived = repository.archive(first.id, isoTimestamp('2026-07-30T15:03:00.000Z'));
      expect(archived.state).toBe('ARCHIVED');
      expect(repository.list().map(({ id }) => id)).toEqual([second.id]);
      expect(repository.list(true).map(({ id }) => id)).toEqual([first.id, second.id]);
    } finally {
      database.close();
    }
  });

  it('persists a campaign after closing and reopening the database', async () => {
    const { path, database } = await createDatabase();
    const expected = campaign('campaign-restart');
    new CampaignRepository(adaptDatabase(database)).create(expected);
    database.close();

    const reopened = new DatabaseSync(path);
    try {
      await applyMigrations(reopened);
      expect(new CampaignRepository(adaptDatabase(reopened)).get(expected.id)).toEqual(expected);
    } finally {
      reopened.close();
    }
  });

  it('rejects duplicate creation and missing update or archive targets', async () => {
    const { database } = await createDatabase();
    try {
      const repository = new CampaignRepository(adaptDatabase(database));
      const existing = campaign('campaign-1');
      repository.create(existing);
      expect(() => repository.create(existing)).toThrow();
      expect(() => repository.update(campaign('missing'))).toThrow(CampaignNotFoundError);
      expect(() =>
        repository.archive(campaignId('missing'), isoTimestamp('2026-07-30T15:02:00.000Z')),
      ).toThrow(CampaignNotFoundError);
      expect(repository.get(campaignId('missing'))).toBeNull();
    } finally {
      database.close();
    }
  });

  it('rejects invalid persisted data instead of returning a partial Campaign', async () => {
    const { database } = await createDatabase();
    try {
      database
        .prepare(
          `INSERT INTO campaigns (
             id, schema_version, state, task_model_overrides_json,
             model_switch_policy, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          'corrupt-campaign',
          1,
          'CREATING_WORLD',
          '{}',
          'ASK',
          'not-a-timestamp',
          '2026-07-30T15:00:00.000Z',
        );
      expect(() =>
        new CampaignRepository(adaptDatabase(database)).get(campaignId('corrupt-campaign')),
      ).toThrow(PersistenceDataError);
    } finally {
      database.close();
    }
  });
});

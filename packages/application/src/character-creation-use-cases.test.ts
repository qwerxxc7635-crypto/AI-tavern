import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';

import { FakeAIProvider, type ProviderConfig } from '@ember-tavern/ai-core';
import {
  AttributeAllocationError,
  aiRequestId,
  campaignId,
  characterTraitId,
  createCampaign,
  generationRecordId,
  idempotencyKey,
  isoTimestamp,
  itemId,
  playerCharacterId,
  schemaVersion,
  transitionCampaign,
} from '@ember-tavern/contracts';
import {
  CampaignRepository,
  GenerationRecordRepository,
  ItemRepository,
  PendingAiRequestRepository,
  PlayerCharacterRepository,
  type SqliteStatement,
  type SqliteValue,
  type TransactionalSqliteDatabase,
} from '@ember-tavern/persistence';
import { afterEach, describe, expect, it } from 'vitest';

import { applyMigrations } from '../../persistence/src/migrations.mjs';
import { CharacterCreationUseCases } from './index.js';

const directories: string[] = [];
const campaignKey = campaignId('campaign-character-use-case');
const characterKey = playerCharacterId('character-mira');
const at = isoTimestamp('2026-07-31T02:00:00.000Z');
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

describe('CharacterCreationUseCases', () => {
  it('generates six traits and atomically saves the completed character and local equipment', async () => {
    const database = await createDatabase();
    try {
      const sqlite = adaptDatabase(database);
      seedCharacterCampaign(sqlite);
      const useCases = createUseCases(sqlite);
      const draft = useCases.createCharacter(characterCommand());

      const traits = await useCases.generateCharacterTraits({
        ...request('traits'),
        campaignId: campaignKey,
        character: draft,
      });
      expect(traits).toHaveLength(6);
      expect(
        new PendingAiRequestRepository(sqlite).get(aiRequestId('request-traits'))?.status,
      ).toBe('COMMITTED');
      expect(
        new GenerationRecordRepository(sqlite).get(generationRecordId('generation-traits')),
      ).toMatchObject({ promptVersion: 2, validationError: null });

      const firstTrait = traits[0];
      const secondTrait = traits[1];
      if (firstTrait === undefined || secondTrait === undefined) {
        throw new Error('Fake Provider did not return enough traits');
      }
      const character = await useCases.completeCharacterBackground({
        ...request('background'),
        campaignId: campaignKey,
        character: draft,
        selectedTraits: [firstTrait, secondTrait],
      });
      expect(character).toMatchObject({
        id: characterKey,
        attributes: { physique: 2, agility: 4, knowledge: 3, charisma: 1 },
        background: { birthplace: 'The North Road' },
        initialEquipment: [{ itemId: itemId('item-0') }, { itemId: itemId('item-1') }],
      });
      expect(new PlayerCharacterRepository(sqlite).get(characterKey)).toEqual(character);
      expect(new ItemRepository(sqlite).listOwned(characterKey)).toMatchObject([
        {
          id: itemId('item-0'),
          rewardTier: 'BASIC',
          effect: { kind: 'CHECK_MODIFIER', attribute: 'agility', modifier: 1 },
        },
        { id: itemId('item-1'), rewardTier: 'BASIC', effect: { kind: 'NONE' } },
      ]);
      expect(new CampaignRepository(sqlite).get(campaignKey)?.state).toBe('GENERATING_TAVERN');
      expect(
        new PendingAiRequestRepository(sqlite).get(aiRequestId('request-background'))?.status,
      ).toBe('COMMITTED');
    } finally {
      database.close();
    }
  });

  it('rejects an illegal attribute allocation before creating any character fact', async () => {
    const database = await createDatabase();
    try {
      const sqlite = adaptDatabase(database);
      seedCharacterCampaign(sqlite);
      const useCases = createUseCases(sqlite);
      expect(() =>
        useCases.createCharacter({
          ...characterCommand(),
          attributes: { physique: 5, agility: 5, knowledge: 1, charisma: 1 },
        }),
      ).toThrow(AttributeAllocationError);
      expect(new PlayerCharacterRepository(sqlite).get(characterKey)).toBeNull();
      expect(new CampaignRepository(sqlite).get(campaignKey)?.state).toBe('CREATING_CHARACTER');
    } finally {
      database.close();
    }
  });
});

function characterCommand() {
  return {
    id: characterKey,
    campaignId: campaignKey,
    name: 'Mira',
    gender: null,
    age: 27,
    concept: 'Curious scout',
    storyPreferences: ['Exploration'],
    contentBoundaries: {
      allowHorror: true,
      allowPermanentDeath: false,
      allowRomance: true,
      allowBetrayal: true,
      excludedContent: [],
    },
    classArchetype: 'ROGUE' as const,
    classDisplayName: 'Wayfinder',
    attributes: { physique: 2, agility: 4, knowledge: 3, charisma: 1 },
    personalGoal: 'Find a lost sibling.',
  };
}

function request(suffix: string) {
  return {
    requestId: aiRequestId(`request-${suffix}`),
    generationRecordId: generationRecordId(`generation-${suffix}`),
    idempotencyKey: idempotencyKey(`campaign-character:${suffix}`),
    modelProfileId: null,
    modelName: 'ember-fake-v1',
    generationOptions: { temperature: 0, maxOutputTokens: 4_000, timeoutMs: 1_000 },
  };
}

function createUseCases(database: TransactionalSqliteDatabase) {
  return new CharacterCreationUseCases(
    database,
    new FakeAIProvider(() => at),
    config,
    {
      trait: (_name, index) => characterTraitId(`trait-${index}`),
      item: (_name, index) => itemId(`item-${index}`),
    },
    () => at,
  );
}

function seedCharacterCampaign(database: TransactionalSqliteDatabase): void {
  const campaigns = new CampaignRepository(database);
  const created = createCampaign({ id: campaignKey, schemaVersion: schemaVersion(1), now: at });
  campaigns.create(created);
  const reviewing = transitionCampaign(created, 'REVIEWING_WORLD', at);
  campaigns.update(reviewing);
  campaigns.update(transitionCampaign(reviewing, 'CREATING_CHARACTER', at));
}

async function createDatabase(): Promise<DatabaseSync> {
  const directory = await mkdtemp(join(tmpdir(), 'ember-tavern-character-use-case-'));
  directories.push(directory);
  const database = new DatabaseSync(join(directory, 'character.sqlite'));
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

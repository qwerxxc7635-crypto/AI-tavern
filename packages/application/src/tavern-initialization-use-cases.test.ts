import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';

import { FakeAIProvider, type ProviderConfig } from '@ember-tavern/ai-core';
import {
  aiRequestId,
  campaignId,
  characterTraitId,
  createCampaign,
  factionId,
  generationRecordId,
  idempotencyKey,
  isoTimestamp,
  itemId,
  locationId,
  npcId,
  playerCharacterId,
  schemaVersion,
  tavernId,
  transitionCampaign,
  worldFactId,
  type PlayerCharacter,
  type WorldBible,
} from '@ember-tavern/contracts';
import {
  CampaignRepository,
  NpcRepository,
  PendingAiRequestRepository,
  PlayerCharacterRepository,
  WorldRepository,
  type SqliteStatement,
  type SqliteValue,
  type TransactionalSqliteDatabase,
} from '@ember-tavern/persistence';
import { afterEach, describe, expect, it } from 'vitest';

import { applyMigrations } from '../../persistence/src/migrations.mjs';
import { TavernInitializationUseCases } from './index.js';

const directories: string[] = [];
const campaignKey = campaignId('campaign-tavern-use-case');
const characterKey = playerCharacterId('character-mira');
const locationKey = locationId('location-harbor');
const at = isoTimestamp('2026-07-31T03:00:00.000Z');
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

describe('TavernInitializationUseCases', () => {
  it('atomically creates the owner, two residents, one visitor and three rumors', async () => {
    const database = await createDatabase();
    try {
      const sqlite = adaptDatabase(database);
      seedCampaign(sqlite);
      const useCases = createUseCases(sqlite);

      const tavern = await useCases.generateTavern({
        ...request('tavern'),
        campaignId: campaignKey,
        playerCharacterId: characterKey,
        locationId: locationKey,
        desiredPosition: null,
      });
      expect(tavern).toMatchObject({
        id: tavernId('tavern-ember-rest'),
        name: 'Ember Rest',
        ownerNpcId: npcId('npc-0'),
        residentNpcIds: [npcId('npc-0')],
      });

      const initialized = await useCases.generateNpcs({
        ...request('npcs'),
        campaignId: campaignKey,
        playerCharacterId: characterKey,
        tavernId: tavern.id,
      });
      expect(initialized.tavern.residentNpcIds).toHaveLength(3);
      expect(initialized.tavern.visitorNpcIds).toEqual([npcId('npc-3')]);
      expect(initialized.npcs.map(({ residency }) => residency)).toEqual([
        'OWNER',
        'RESIDENT',
        'RESIDENT',
        'TEMPORARY_VISITOR',
      ]);
      expect(initialized.rumors).toHaveLength(3);
      expect(initialized.rumors.every(({ kind }) => kind === 'RUMOR')).toBe(true);
      expect(initialized.questPublisherNpcIds).toEqual([
        npcId('npc-0'),
        npcId('npc-1'),
        npcId('npc-2'),
      ]);
      const npcs = new NpcRepository(sqlite);
      expect(npcs.getVisitor(npcId('npc-3'))?.visitReason).toBe(
        'Waiting for the causeway to reopen.',
      );
      expect(npcs.getKnowledge(npcId('npc-1'))?.knownFactIds).toContain(worldFactId('rumor-0'));
      expect(npcs.getRelationship(npcId('npc-2'))).toMatchObject({
        playerCharacterId: characterKey,
        trust: 0,
        closeness: 0,
      });
      expect(new CampaignRepository(sqlite).get(campaignKey)?.state).toBe('TAVERN');
      expect(new PendingAiRequestRepository(sqlite).get(aiRequestId('request-npcs'))?.status).toBe(
        'COMMITTED',
      );
    } finally {
      database.close();
    }
  });
});

function request(suffix: string) {
  return {
    requestId: aiRequestId(`request-${suffix}`),
    generationRecordId: generationRecordId(`generation-${suffix}`),
    idempotencyKey: idempotencyKey(`campaign-tavern:${suffix}`),
    modelProfileId: null,
    modelName: 'ember-fake-v1',
    generationOptions: { temperature: 0, maxOutputTokens: 6_000, timeoutMs: 1_000 },
  };
}

function createUseCases(database: TransactionalSqliteDatabase) {
  return new TavernInitializationUseCases(
    database,
    new FakeAIProvider(() => at),
    config,
    {
      tavern: () => tavernId('tavern-ember-rest'),
      npc: (_name, index) => npcId(`npc-${index}`),
      fact: (_statement, index) => worldFactId(`rumor-${index}`),
    },
    () => at,
  );
}

function seedCampaign(database: TransactionalSqliteDatabase): void {
  const campaigns = new CampaignRepository(database);
  const created = createCampaign({ id: campaignKey, schemaVersion: schemaVersion(1), now: at });
  campaigns.create(created);
  const reviewing = transitionCampaign(created, 'REVIEWING_WORLD', at);
  campaigns.update(reviewing);
  const characterCreation = transitionCampaign(reviewing, 'CREATING_CHARACTER', at);
  campaigns.update(characterCreation);
  campaigns.update(transitionCampaign(characterCreation, 'GENERATING_TAVERN', at));
  new WorldRepository(database).saveBible(world());
  new PlayerCharacterRepository(database).create(character());
}

function world(): WorldBible {
  return {
    campaignId: campaignKey,
    schemaVersion: schemaVersion(1),
    name: 'Ember Coast',
    currentRegion: 'Ash Harbor',
    summary: 'A storm-bound coast of old trade roads.',
    coreConflict: 'The lighthouse fire is fading.',
    technologyLevel: 'Late medieval',
    powerRules: ['Magic leaves a warm trace.'],
    factions: [
      {
        id: factionId('faction-lantern'),
        name: 'Lantern Guild',
        description: 'Harbor keepers.',
        goals: ['Restore the lighthouse.'],
        relations: [],
      },
    ],
    locations: [
      {
        id: locationKey,
        name: 'Ash Harbor',
        description: 'A sheltered port.',
        parentLocationId: null,
        factionIds: [factionId('faction-lantern')],
      },
    ],
    narrativeStyle: 'Grounded fantasy.',
    forbiddenElements: [],
    tavernReason: 'Travelers wait for safe tides.',
    storyHooks: ['The beacon dims.'],
    lockedFields: [],
    createdAt: at,
    updatedAt: at,
  };
}

function character(): PlayerCharacter {
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
    classArchetype: 'ROGUE',
    classDisplayName: 'Wayfinder',
    attributes: { physique: 2, agility: 4, knowledge: 3, charisma: 1 },
    traits: [
      {
        id: characterTraitId('trait-1'),
        name: 'Keen Listener',
        description: 'Notices quiet changes.',
      },
      {
        id: characterTraitId('trait-2'),
        name: 'Roadwise',
        description: 'Reads old routes.',
      },
    ],
    personalGoal: 'Find a lost sibling.',
    background: {
      birthplace: 'North Road',
      formativeExperience: 'Survived a winter crossing.',
      adventureMotivation: 'Protect travelers.',
      secret: 'Followed a false beacon.',
      importantPerson: 'A missing sibling.',
      tavernArrivalReason: 'Seeking a caravan.',
    },
    initialEquipment: [{ itemId: itemId('item-compass') }],
    createdAt: at,
    updatedAt: at,
  };
}

async function createDatabase(): Promise<DatabaseSync> {
  const directory = await mkdtemp(join(tmpdir(), 'ember-tavern-tavern-use-case-'));
  directories.push(directory);
  const database = new DatabaseSync(join(directory, 'tavern.sqlite'));
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

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';

import { FakeAIProvider, type ProviderConfig } from '@ember-tavern/ai-core';
import {
  campaignId,
  characterTraitId,
  createCampaign,
  generationRecordId,
  idempotencyKey,
  isoTimestamp,
  locationId,
  npcId,
  playerCharacterId,
  questId,
  schemaVersion,
  tavernId,
  transitionCampaign,
  aiRequestId,
  type NpcProfile,
  type PlayerCharacter,
  type Tavern,
  type WorldBible,
} from '@ember-tavern/contracts';
import {
  CampaignRepository,
  NpcRepository,
  PlayerCharacterRepository,
  QuestRepository,
  TavernRepository,
  WorldRepository,
  type SqliteStatement,
  type SqliteValue,
  type TransactionalSqliteDatabase,
} from '@ember-tavern/persistence';
import { afterEach, describe, expect, it } from 'vitest';

import { applyMigrations } from '../../persistence/src/migrations.mjs';
import { AIOrchestrationError, QuestUseCases } from './index.js';

const directories: string[] = [];
const campaignKey = campaignId('campaign-quests');
const characterKey = playerCharacterId('character-quests');
const locationKey = locationId('location-harbor');
const tavernKey = tavernId('tavern-ember');
const ownerKey = npcId('npc-owner');
const cartographerKey = npcId('npc-cartographer');
const at = isoTimestamp('2026-07-31T05:00:00.000Z');
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

describe('QuestUseCases', () => {
  it('generates two available quests and permits only one accepted main quest', async () => {
    const database = await createDatabase();
    try {
      const sqlite = adaptDatabase(database);
      seedCampaign(sqlite);
      const useCases = new QuestUseCases(sqlite, new FakeAIProvider(() => at), config, () => at);
      const first = await useCases.generateQuest({
        ...request('one'),
        campaignId: campaignKey,
        questId: questId('quest-one'),
        tavernId: tavernKey,
        publisherNpcId: ownerKey,
        playerCharacterId: characterKey,
      });
      const second = await useCases.generateQuest({
        ...request('two'),
        campaignId: campaignKey,
        questId: questId('quest-two'),
        tavernId: tavernKey,
        publisherNpcId: cartographerKey,
        playerCharacterId: characterKey,
      });
      expect([first.status, second.status]).toEqual(['AVAILABLE', 'AVAILABLE']);
      expect(new QuestRepository(sqlite).listByCampaign(campaignKey)).toHaveLength(2);

      expect(useCases.acceptQuest(campaignKey, first.id).status).toBe('ACCEPTED');
      expect(() => useCases.acceptQuest(campaignKey, second.id)).toThrow(AIOrchestrationError);
      expect(new QuestRepository(sqlite).get(second.id)?.status).toBe('AVAILABLE');
      expect(
        new QuestRepository(sqlite)
          .listByCampaign(campaignKey)
          .filter(({ status }) => status === 'ACCEPTED' || status === 'ACTIVE'),
      ).toHaveLength(1);
    } finally {
      database.close();
    }
  });
});

function request(suffix: string) {
  return {
    requestId: aiRequestId(`request-quest-${suffix}`),
    generationRecordId: generationRecordId(`generation-quest-${suffix}`),
    idempotencyKey: idempotencyKey(`quest:${suffix}`),
    modelProfileId: null,
    modelName: 'ember-fake-v1',
    generationOptions: { temperature: 0, maxOutputTokens: 4_000, timeoutMs: 1_000 },
  };
}

function seedCampaign(database: TransactionalSqliteDatabase): void {
  const campaigns = new CampaignRepository(database);
  const created = createCampaign({ id: campaignKey, schemaVersion: schemaVersion(1), now: at });
  campaigns.create(created);
  const reviewing = transitionCampaign(created, 'REVIEWING_WORLD', at);
  campaigns.update(reviewing);
  const characterCreation = transitionCampaign(reviewing, 'CREATING_CHARACTER', at);
  campaigns.update(characterCreation);
  const tavernGeneration = transitionCampaign(characterCreation, 'GENERATING_TAVERN', at);
  campaigns.update(tavernGeneration);
  campaigns.update(transitionCampaign(tavernGeneration, 'TAVERN', at));
  new WorldRepository(database).saveBible(world());
  new PlayerCharacterRepository(database).create(character());

  const taverns = new TavernRepository(database);
  taverns.create(tavern());
  const npcs = new NpcRepository(database);
  npcs.create(npc(ownerKey, 'Ilyra Venn', 'OWNER'));
  npcs.create(npc(cartographerKey, 'Tomas Reed', 'RESIDENT'));
  taverns.assignOwner(tavernKey, ownerKey);
}

function world(): WorldBible {
  return {
    campaignId: campaignKey,
    schemaVersion: schemaVersion(1),
    name: 'Ember Coast',
    currentRegion: 'Ash Harbor',
    summary: 'A storm-bound coast.',
    coreConflict: 'The lighthouse fire is fading.',
    technologyLevel: 'Late medieval',
    powerRules: ['Magic leaves a warm trace.'],
    factions: [],
    locations: [
      {
        id: locationKey,
        name: 'Ash Harbor',
        description: 'A sheltered port.',
        parentLocationId: null,
        factionIds: [],
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
    age: null,
    concept: 'Curious scout',
    storyPreferences: [],
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
        id: characterTraitId('trait-one'),
        name: 'Listener',
        description: 'Notices quiet changes.',
      },
      {
        id: characterTraitId('trait-two'),
        name: 'Roadwise',
        description: 'Reads old routes.',
      },
    ],
    personalGoal: 'Find a lost sibling.',
    background: {
      birthplace: 'North Road',
      formativeExperience: 'Survived winter.',
      adventureMotivation: 'Protect travelers.',
      secret: 'Followed a false beacon.',
      importantPerson: 'A sibling.',
      tavernArrivalReason: 'Seeking a caravan.',
    },
    initialEquipment: [],
    createdAt: at,
    updatedAt: at,
  };
}

function tavern(): Tavern {
  return {
    id: tavernKey,
    campaignId: campaignKey,
    locationId: locationKey,
    name: 'Ember Rest',
    position: 'Harbor crossroads',
    environment: 'A warm stone hall.',
    specialRules: [],
    longTermProblem: 'A cellar light.',
    ownerNpcId: ownerKey,
    residentNpcIds: [ownerKey, cartographerKey],
    visitorNpcIds: [],
    createdAt: at,
    updatedAt: at,
  };
}

function npc(id: NpcProfile['id'], name: string, residency: NpcProfile['residency']): NpcProfile {
  return {
    id,
    campaignId: campaignKey,
    tavernId: tavernKey,
    residency,
    name,
    identity: residency === 'OWNER' ? 'Innkeeper' : 'Cartographer',
    appearance: 'A weathered traveler.',
    personality: 'Practical and observant.',
    goal: 'Keep the harbor road open.',
    secret: 'Knows the old tunnels.',
    speechStyle: 'Measured and direct.',
    currentMood: 'Concerned',
    currentStatus: 'ACTIVE',
    createdAt: at,
    updatedAt: at,
  };
}

async function createDatabase(): Promise<DatabaseSync> {
  const directory = await mkdtemp(join(tmpdir(), 'ember-tavern-quest-use-case-'));
  directories.push(directory);
  const database = new DatabaseSync(join(directory, 'quest.sqlite'));
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

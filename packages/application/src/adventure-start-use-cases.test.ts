import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';

import { FakeAIProvider, type ProviderConfig } from '@ember-tavern/ai-core';
import {
  adventureId,
  aiRequestId,
  campaignId,
  characterTraitId,
  clueId,
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
  type NpcProfile,
  type PlayerCharacter,
  type Quest,
  type Tavern,
  type WorldBible,
} from '@ember-tavern/contracts';
import {
  AdventureRepository,
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
import { AdventureStartUseCases } from './index.js';

const directories: string[] = [];
const campaignKey = campaignId('campaign-adventure-start');
const characterKey = playerCharacterId('character-adventure-start');
const questKey = questId('quest-beacon');
const adventureKey = adventureId('adventure-beacon');
const locationKey = locationId('location-harbor');
const tavernKey = tavernId('tavern-ember');
const ownerKey = npcId('npc-owner');
const at = isoTimestamp('2026-07-31T06:00:00.000Z');
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

describe('AdventureStartUseCases', () => {
  it('stores the hidden plan and clues but returns only public start state', async () => {
    const database = await createDatabase();
    try {
      const sqlite = adaptDatabase(database);
      seedCampaign(sqlite);
      const useCases = new AdventureStartUseCases(
        sqlite,
        new FakeAIProvider(() => at),
        config,
        { clue: (_title, index) => clueId(`clue-${index}`) },
        () => at,
      );
      const prepared = await useCases.generateAdventurePlan({
        campaignId: campaignKey,
        adventureId: adventureKey,
        questId: questKey,
        playerCharacterId: characterKey,
        requestId: aiRequestId('request-plan'),
        generationRecordId: generationRecordId('generation-plan'),
        idempotencyKey: idempotencyKey('adventure:plan'),
        modelProfileId: null,
        modelName: 'ember-fake-v1',
        generationOptions: { temperature: 0, maxOutputTokens: 6_000, timeoutMs: 1_000 },
      });
      expect(prepared).toEqual({
        adventureId: adventureKey,
        questId: questKey,
        state: 'PREPARING',
        currentTurnNumber: 0,
      });
      expect(prepared).not.toHaveProperty('plan');
      const stored = new AdventureRepository(sqlite).get(adventureKey);
      expect(stored?.plan.coreScenes).toHaveLength(3);
      expect(new AdventureRepository(sqlite).getClues(adventureKey)).toHaveLength(3);

      expect(useCases.startAdventure(campaignKey, adventureKey)).toEqual({
        adventureId: adventureKey,
        questId: questKey,
        state: 'SCENE',
        currentTurnNumber: 0,
      });
      expect(new QuestRepository(sqlite).get(questKey)?.status).toBe('ACTIVE');
      expect(new CampaignRepository(sqlite).get(campaignKey)?.state).toBe('ADVENTURE');
    } finally {
      database.close();
    }
  });
});

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
  new NpcRepository(database).create(owner());
  taverns.assignOwner(tavernKey, ownerKey);
  new QuestRepository(database).create(quest());
}

function quest(): Quest {
  return {
    id: questKey,
    campaignId: campaignKey,
    publisherNpcId: ownerKey,
    content: {
      title: 'The Fading Beacon',
      summary: 'Investigate the lighthouse.',
      objective: 'Restore the beacon flame.',
      failureCost: 'Ships remain trapped outside the harbor.',
    },
    status: 'ACCEPTED',
    risk: 'MODERATE',
    recommendedAttributes: ['knowledge', 'agility'],
    expectedTurns: { min: 8, max: 12 },
    rewardTier: 'NOTABLE',
    relatedNpcIds: [ownerKey],
    relatedFactIds: [],
    createdAt: at,
    updatedAt: at,
  };
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
    residentNpcIds: [ownerKey],
    visitorNpcIds: [],
    createdAt: at,
    updatedAt: at,
  };
}

function owner(): NpcProfile {
  return {
    id: ownerKey,
    campaignId: campaignKey,
    tavernId: tavernKey,
    residency: 'OWNER',
    name: 'Ilyra Venn',
    identity: 'Innkeeper',
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
  const directory = await mkdtemp(join(tmpdir(), 'ember-tavern-adventure-start-'));
  directories.push(directory);
  const database = new DatabaseSync(join(directory, 'adventure.sqlite'));
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

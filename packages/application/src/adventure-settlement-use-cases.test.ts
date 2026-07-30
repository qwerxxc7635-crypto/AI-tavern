import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';

import { FakeAIProvider, type AIProvider, type ProviderConfig } from '@ember-tavern/ai-core';
import {
  adventureId,
  aiRequestId,
  campaignId,
  characterTraitId,
  clueId,
  createCampaign,
  createNpcRelationship,
  gameEventId,
  generationRecordId,
  idempotencyKey,
  isoTimestamp,
  itemId,
  locationId,
  npcId,
  playerCharacterId,
  questId,
  schemaVersion,
  tavernChangeId,
  tavernId,
  transitionCampaign,
  turnId,
  worldClockId,
  worldFactId,
  type Adventure,
  type AdventureTurn,
  type Clue,
  type NpcProfile,
  type PlayerCharacter,
  type Quest,
  type Tavern,
  type WorldBible,
} from '@ember-tavern/contracts';
import {
  AdventureRepository,
  CampaignRepository,
  GameEventRepository,
  NpcRepository,
  PendingAiRequestRepository,
  PlayerCharacterRepository,
  QuestRepository,
  TavernRepository,
  WorldClockRepository,
  WorldRepository,
  type SqliteStatement,
  type SqliteValue,
  type TransactionalSqliteDatabase,
} from '@ember-tavern/persistence';
import { afterEach, describe, expect, it } from 'vitest';

import { applyMigrations } from '../../persistence/src/migrations.mjs';
import { AdventureSettlementUseCases } from './index.js';

const directories: string[] = [];
const campaignKey = campaignId('campaign-settlement');
const characterKey = playerCharacterId('character-settlement');
const questKey = questId('quest-beacon');
const adventureKey = adventureId('adventure-settlement');
const tavernKey = tavernId('tavern-settlement');
const ownerKey = npcId('npc-owner');
const at = isoTimestamp('2026-07-31T08:00:00.000Z');
const summaryGenerationKey = generationRecordId('generation-summary');
const worldGenerationKey = generationRecordId('generation-world-event');
const summaryIdempotency = idempotencyKey('settlement:summary');
const worldIdempotency = idempotencyKey('settlement:world');
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
const generationOptions = {
  temperature: 0,
  maxOutputTokens: 6_000,
  timeoutMs: 1_000,
} as const;

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('AdventureSettlementUseCases', () => {
  it('atomically updates NPC, tavern, world, archive and returns the campaign to tavern', async () => {
    const database = await createDatabase();
    try {
      const sqlite = adaptDatabase(database);
      seed(sqlite);
      const useCases = settlementUseCases(sqlite, new FakeAIProvider(() => at));
      const summary = await useCases.summarizeAdventure({
        ...generation('summary', summaryGenerationKey, summaryIdempotency),
        outcome: 'SUCCESS',
      });
      expect(summary.npcUpdates).toHaveLength(1);
      expect(new CampaignRepository(sqlite).get(campaignKey)?.state).toBe('ADVENTURE');
      expect(new QuestRepository(sqlite).get(questKey)?.status).toBe('ACTIVE');

      const worldEvent = await useCases.advanceWorldClocks({
        ...generation('world', worldGenerationKey, worldIdempotency),
        summaryGenerationRecordId: summaryGenerationKey,
      });
      expect(worldEvent.clockAdvances).toEqual([
        {
          clockId: 'clock-storm',
          amount: 1,
          reason: 'Another storm tide has arrived.',
        },
      ]);
      expect(new WorldClockRepository(sqlite).get(worldClockId('clock-storm'))?.current).toBe(0);

      const finish = {
        campaignId: campaignKey,
        adventureId: adventureKey,
        playerCharacterId: characterKey,
        outcome: 'SUCCESS' as const,
        summaryGenerationRecordId: summaryGenerationKey,
        worldEventGenerationRecordId: worldGenerationKey,
        summaryIdempotencyKey: summaryIdempotency,
        worldEventIdempotencyKey: worldIdempotency,
      };
      const archive = useCases.finishAdventure(finish);

      expect(new CampaignRepository(sqlite).get(campaignKey)?.state).toBe('TAVERN');
      expect(new QuestRepository(sqlite).get(questKey)?.status).toBe('COMPLETED');
      expect(new AdventureRepository(sqlite).get(adventureKey)?.state).toBe('SETTLED');
      expect(new NpcRepository(sqlite).get(ownerKey)?.currentMood).toBe('Relieved');
      expect(new NpcRepository(sqlite).getRelationship(ownerKey)?.trust).toBe(1);
      expect(new TavernRepository(sqlite).listChanges(tavernKey)).toEqual([archive.tavernChange]);
      expect(new WorldClockRepository(sqlite).get(worldClockId('clock-storm'))?.current).toBe(1);
      expect(archive).toMatchObject({
        title: 'The Fading Beacon',
        ending: { outcome: 'SUCCESS', unresolvedClueIds: [clueId('clue-ledger')] },
      });
      expect(archive.acquiredItems).toMatchObject([
        {
          content: { name: 'Stormglass Compass' },
          effect: { kind: 'CHECK_MODIFIER', attribute: 'knowledge', modifier: 1 },
        },
      ]);
      expect(archive.worldFacts.map(({ statement }) => statement)).toEqual([
        'The outer harbor road is flooded.',
      ]);
      expect(archive.generationUses).toMatchObject([
        { task: 'SUMMARIZE_ADVENTURE', modelName: 'ember-fake-v1', promptVersion: 2 },
        { task: 'GENERATE_WORLD_EVENT', modelName: 'ember-fake-v1', promptVersion: 2 },
      ]);
      expect(
        new GameEventRepository(sqlite)
          .list(campaignKey)
          .map(({ type }) => type)
          .sort(),
      ).toEqual(
        [
          'RELATIONSHIP_CHANGED',
          'ITEM_ACQUIRED',
          'WORLD_CLOCK_ADVANCED',
          'ADVENTURE_COMPLETED',
        ].sort(),
      );
      expect(
        new PendingAiRequestRepository(sqlite).getByIdempotencyKey(summaryIdempotency)?.status,
      ).toBe('COMMITTED');
      expect(
        new PendingAiRequestRepository(sqlite).getByIdempotencyKey(worldIdempotency)?.status,
      ).toBe('COMMITTED');
      expect(useCases.finishAdventure(finish)).toEqual(archive);
    } finally {
      database.close();
    }
  });

  it('settles a failed adventure without creating an unauthorized reward', async () => {
    const database = await createDatabase();
    try {
      const sqlite = adaptDatabase(database);
      seed(sqlite);
      const useCases = settlementUseCases(sqlite, failureProvider());
      await useCases.summarizeAdventure({
        ...generation('summary', summaryGenerationKey, summaryIdempotency),
        outcome: 'FAILURE',
      });
      await useCases.advanceWorldClocks({
        ...generation('world', worldGenerationKey, worldIdempotency),
        summaryGenerationRecordId: summaryGenerationKey,
      });
      const archive = useCases.finishAdventure({
        campaignId: campaignKey,
        adventureId: adventureKey,
        playerCharacterId: characterKey,
        outcome: 'FAILURE',
        summaryGenerationRecordId: summaryGenerationKey,
        worldEventGenerationRecordId: worldGenerationKey,
        summaryIdempotencyKey: summaryIdempotency,
        worldEventIdempotencyKey: worldIdempotency,
      });

      expect(archive.ending.outcome).toBe('FAILURE');
      expect(archive.acquiredItems).toEqual([]);
      expect(new QuestRepository(sqlite).get(questKey)?.status).toBe('FAILED');
      expect(new CampaignRepository(sqlite).get(campaignKey)?.state).toBe('TAVERN');
      expect(
        new GameEventRepository(sqlite)
          .list(campaignKey)
          .map(({ type }) => type)
          .sort(),
      ).toEqual(['RELATIONSHIP_CHANGED', 'WORLD_CLOCK_ADVANCED', 'ADVENTURE_COMPLETED'].sort());
    } finally {
      database.close();
    }
  });
});

function settlementUseCases(
  database: TransactionalSqliteDatabase,
  provider: AIProvider,
): AdventureSettlementUseCases {
  return new AdventureSettlementUseCases(
    database,
    provider,
    config,
    {
      item: (adventure) => itemId(`reward:${adventure}`),
      fact: (adventure, index) => worldFactId(`settlement-fact:${adventure}:${index}`),
      tavernChange: (adventure) => tavernChangeId(`tavern-change:${adventure}`),
      event: (adventure, kind, index) =>
        gameEventId(`settlement-event:${adventure}:${kind}:${index}`),
    },
    {
      rewardEffect: () => ({
        kind: 'CHECK_MODIFIER',
        attribute: 'knowledge',
        modifier: 1,
      }),
    },
    () => at,
  );
}

function failureProvider(): AIProvider {
  const fake = new FakeAIProvider(() => at);
  return {
    id: 'failure-settlement',
    listModels: () => fake.listModels(),
    testConnection: (providerConfig) => fake.testConnection(providerConfig),
    async generate(request, providerConfig) {
      const response = await fake.generate(request, providerConfig);
      if (request.task !== 'SUMMARIZE_ADVENTURE') return response;
      return Object.freeze({
        ...response,
        content: JSON.stringify({
          summary: 'The beacon failed, but the harbor evacuated before the storm.',
          keyDecisions: ['Warned the harbor instead of risking another repair.'],
          unresolvedThreads: ['The beacon remains dark.'],
          nextDirections: ['Find another safe route along the coast.'],
          npcUpdates: [
            {
              npcId: 'npc-owner',
              currentMood: 'Somber',
              relationshipPatch: { trust: 1 },
            },
          ],
          tavernChange: {
            kind: 'DAMAGE',
            description: 'Storm shutters cover the windows while the beacon remains dark.',
          },
          statePatchProposals: [
            {
              kind: 'QUEST',
              targetId: 'quest-beacon',
              rationale: 'The beacon objective failed.',
              payload: { status: 'FAILED' },
            },
            {
              kind: 'RELATIONSHIP',
              targetId: 'npc-owner',
              rationale: 'Ilyra respects the warning that saved the harbor.',
              payload: { trust: 1 },
            },
          ],
        }),
      });
    },
  };
}

function generation(
  phase: string,
  generationRecord: ReturnType<typeof generationRecordId>,
  key: ReturnType<typeof idempotencyKey>,
) {
  return {
    campaignId: campaignKey,
    adventureId: adventureKey,
    requestId: aiRequestId(`request:${phase}`),
    generationRecordId: generationRecord,
    idempotencyKey: key,
    modelProfileId: null,
    modelName: 'ember-fake-v1',
    generationOptions,
  };
}

function seed(database: TransactionalSqliteDatabase): void {
  const campaigns = new CampaignRepository(database);
  const created = createCampaign({ id: campaignKey, schemaVersion: schemaVersion(1), now: at });
  campaigns.create(created);
  const reviewing = transitionCampaign(created, 'REVIEWING_WORLD', at);
  campaigns.update(reviewing);
  const creatingCharacter = transitionCampaign(reviewing, 'CREATING_CHARACTER', at);
  campaigns.update(creatingCharacter);
  const generatingTavern = transitionCampaign(creatingCharacter, 'GENERATING_TAVERN', at);
  campaigns.update(generatingTavern);
  const tavernState = transitionCampaign(generatingTavern, 'TAVERN', at);
  campaigns.update(tavernState);
  campaigns.update(transitionCampaign(tavernState, 'ADVENTURE', at));

  new WorldRepository(database).saveBible(world());
  new PlayerCharacterRepository(database).create(character());
  const taverns = new TavernRepository(database);
  taverns.create(tavern());
  const npcs = new NpcRepository(database);
  npcs.create(owner());
  taverns.assignOwner(tavernKey, ownerKey);
  npcs.saveRelationship(
    createNpcRelationship({
      npcId: ownerKey,
      playerCharacterId: characterKey,
      trust: 0,
      closeness: 0,
      awe: 0,
      obligation: 0,
    }),
    at,
  );
  new QuestRepository(database).create(quest());
  const adventures = new AdventureRepository(database);
  adventures.create(adventure(), clues());
  adventures.addTurn(turn());
  new WorldClockRepository(database).create(
    {
      id: worldClockId('clock-storm'),
      campaignId: campaignKey,
      name: 'Storm Front',
      current: 0,
      max: 6,
      stages: [{ at: 1, title: 'The outer road floods.' }],
    },
    at,
  );
}

function adventure(): Adventure {
  return {
    id: adventureKey,
    campaignId: campaignKey,
    questId: questKey,
    state: 'ENDING',
    plan: {
      adventureId: adventureKey,
      objective: 'Restore the beacon.',
      risk: 'MODERATE',
      expectedTurns: { min: 8, max: 12 },
      coreScenes: ['Reach the beacon.'],
      necessaryClueIds: [clueId('clue-lens'), clueId('clue-ledger')],
      majorObstacles: ['The storm.'],
      possibleEndings: ['Restore the beacon.', 'Evacuate the harbor.'],
      failureCost: 'Ships remain trapped.',
    },
    currentTurnNumber: 1,
    createdAt: at,
    updatedAt: at,
  };
}

function clues(): readonly Clue[] {
  return [
    {
      id: clueId('clue-lens'),
      adventureId: adventureKey,
      title: 'Scorched Lens',
      description: 'The lens burned from inside.',
      isCore: true,
      discoveredInTurnId: turnId('turn-ending'),
    },
    {
      id: clueId('clue-ledger'),
      adventureId: adventureKey,
      title: 'Tide Ledger',
      description: 'The flood follows a schedule.',
      isCore: true,
      discoveredInTurnId: null,
    },
  ];
}

function turn(): AdventureTurn {
  return {
    id: turnId('turn-ending'),
    adventureId: adventureKey,
    turnNumber: 1,
    sceneText: 'The beacon catches and pushes the storm back from the harbor.',
    speakerNpcIds: [ownerKey],
    suggestedActions: [],
    playerAction: { kind: 'FREEFORM', text: 'Relight the beacon.' },
    checkRequest: null,
    diceResult: null,
    createdAt: at,
    resolvedAt: at,
  };
}

function quest(): Quest {
  return {
    id: questKey,
    campaignId: campaignKey,
    publisherNpcId: ownerKey,
    content: {
      title: 'The Fading Beacon',
      summary: 'Restore the lighthouse.',
      objective: 'Restore the beacon.',
      failureCost: 'Ships remain trapped.',
    },
    status: 'ACTIVE',
    risk: 'MODERATE',
    recommendedAttributes: ['knowledge'],
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
        id: locationId('location-harbor'),
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
      { id: characterTraitId('trait-one'), name: 'Listener', description: 'Notices changes.' },
      { id: characterTraitId('trait-two'), name: 'Roadwise', description: 'Reads routes.' },
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
    locationId: locationId('location-harbor'),
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
  const directory = await mkdtemp(join(tmpdir(), 'ember-tavern-settlement-'));
  directories.push(directory);
  const database = new DatabaseSync(join(directory, 'settlement.sqlite'));
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

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';

import {
  buildAdventureTurnContext,
  FakeAIProvider,
  GenerateAdventureTurnOutputSchema,
  type AIProvider,
  type ProviderConfig,
} from '@ember-tavern/ai-core';
import {
  actionOptionId,
  adventureId,
  aiRequestId,
  campaignId,
  characterTraitId,
  checkRequestId,
  createCampaign,
  factionId,
  gameEventId,
  generationRecordId,
  idempotencyKey,
  isoTimestamp,
  locationId,
  npcId,
  playerCharacterId,
  questId,
  schemaVersion,
  tavernId,
  turnId,
  worldFactId,
  type Adventure,
  type AdventureTurn,
  type GameEvent,
  type NpcProfile,
  type PlayerCharacter,
  type Quest,
  type Tavern,
  type WorldBible,
} from '@ember-tavern/contracts';
import { validateDomainStatePatches } from '@ember-tavern/domain';
import {
  AdventureRepository,
  CampaignRepository,
  GameEventRepository,
  GenerationRecordRepository,
  NpcRepository,
  PendingAiRequestRepository,
  PlayerCharacterRepository,
  QuestRepository,
  TavernRepository,
  WorldRepository,
  type SqliteStatement,
  type SqliteValue,
  type TransactionalSqliteDatabase,
  type TurnCommit,
} from '@ember-tavern/persistence';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { applyMigrations } from '../../persistence/src/migrations.mjs';
import { AITurnOrchestrator } from './index.js';

const directories: string[] = [];
const campaignKey = campaignId('campaign-orchestrator');
const adventureKey = adventureId('adventure-orchestrator');
const questKey = questId('quest-orchestrator');
const npcKey = npcId('npc-orchestrator');
const playerKey = playerCharacterId('player-orchestrator');
const tavernKey = tavernId('tavern-orchestrator');
const turnKey = turnId('turn-orchestrator');
const at = isoTimestamp('2026-07-31T01:00:00.000Z');
const providerConfig: ProviderConfig = {
  id: 'fake-provider',
  providerType: 'LOCAL_OPENAI_COMPATIBLE',
  presetKey: 'custom',
  displayName: 'Fake Provider',
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

describe('AITurnOrchestrator', () => {
  it('takes a Fake Provider request through context, validation and an idempotent SQLite commit', async () => {
    const { database } = await createDatabase();
    try {
      const sqlite = adaptDatabase(database);
      seed(sqlite);
      const buildContext = vi.fn(() => contextFromSqlite(sqlite));
      const orchestrator = new AITurnOrchestrator(
        sqlite,
        new FakeAIProvider(() => at),
        providerConfig,
        () => at,
      );
      const command = executeCommand(sqlite, buildContext);

      await expect(orchestrator.execute(command)).resolves.toBe('COMMITTED');
      await expect(orchestrator.execute(command)).resolves.toBe('ALREADY_COMMITTED');

      expect(buildContext).toHaveBeenCalledTimes(1);
      expect(new PendingAiRequestRepository(sqlite).get(command.requestId)).toMatchObject({
        status: 'COMMITTED',
        attemptCount: 1,
      });
      expect(new GenerationRecordRepository(sqlite).get(command.generationRecordId)).toMatchObject({
        task: 'GENERATE_ADVENTURE_TURN',
        rawResponseText: expect.stringContaining('"sceneText"'),
        validatedOutput: expect.objectContaining({
          adventureState: 'CHECK_REQUIRED',
        }),
        validationError: null,
      });
      expect(new AdventureRepository(sqlite).getTurn(turnKey)).toMatchObject({
        sceneText: 'Warm light leaks through the old cellar lock as the storm shakes the shutters.',
        resolvedAt: at,
      });
      expect(new WorldRepository(sqlite).getFact(worldFactId('fact-orchestrated'))).toMatchObject({
        kind: 'DEVELOPING_FACT',
        statement: 'The old beacon chamber is open.',
      });
      expect(new GameEventRepository(sqlite).list(campaignKey)).toHaveLength(1);
    } finally {
      database.close();
    }
  });

  it('records provider failure without committing a partial turn or raw response', async () => {
    const { database } = await createDatabase();
    try {
      const sqlite = adaptDatabase(database);
      seed(sqlite);
      const fake = new FakeAIProvider(() => at);
      const failingProvider: AIProvider = {
        id: 'failing-provider',
        listModels: () => fake.listModels(),
        testConnection: (config) => fake.testConnection(config),
        async generate() {
          throw new Error('Simulated transport failure');
        },
      };
      const orchestrator = new AITurnOrchestrator(
        sqlite,
        failingProvider,
        providerConfig,
        () => at,
      );
      const command = executeCommand(sqlite, () => contextFromSqlite(sqlite));

      await expect(orchestrator.execute(command)).rejects.toMatchObject({
        code: 'PROVIDER_FAILURE',
      });
      expect(new PendingAiRequestRepository(sqlite).get(command.requestId)).toMatchObject({
        status: 'FAILED',
        lastError: { code: 'PROVIDER_FAILURE', retryable: true },
      });
      expect(new GenerationRecordRepository(sqlite).get(command.generationRecordId)).toMatchObject({
        rawResponseText: null,
        validatedOutput: null,
        validationError: { code: 'PROVIDER_FAILURE' },
        completedAt: at,
      });
      expect(new AdventureRepository(sqlite).getTurn(turnKey)).toMatchObject({
        sceneText: 'The cellar door is sealed.',
        resolvedAt: null,
      });
      expect(new GameEventRepository(sqlite).list(campaignKey)).toEqual([]);
    } finally {
      database.close();
    }
  });
});

function executeCommand(database: TransactionalSqliteDatabase, buildContext: () => unknown) {
  return {
    requestId: aiRequestId('request-orchestrator'),
    generationRecordId: generationRecordId('generation-orchestrator'),
    campaignId: campaignKey,
    turnId: turnKey,
    idempotencyKey: idempotencyKey('campaign-orchestrator:turn-1'),
    task: 'GENERATE_ADVENTURE_TURN' as const,
    modelProfileId: null,
    modelName: 'ember-fake-v1',
    input: { playerAction: 'Study the lock.' },
    generationOptions: {
      temperature: 0,
      maxOutputTokens: 2_048,
      timeoutMs: 1_000,
    },
    buildContext,
    validateDomainAndBuildCommit: (output: unknown) => commitFromOutput(database, output),
  };
}

function contextFromSqlite(database: TransactionalSqliteDatabase) {
  const world = requireEntity(new WorldRepository(database).getBible(campaignKey), 'WorldBible');
  const player = requireEntity(
    new PlayerCharacterRepository(database).get(playerKey),
    'PlayerCharacter',
  );
  const quest = requireEntity(new QuestRepository(database).get(questKey), 'Quest');
  const adventures = new AdventureRepository(database);
  const adventure = requireEntity(adventures.get(adventureKey), 'Adventure');
  const npc = requireEntity(new NpcRepository(database).get(npcKey), 'NPC');
  return buildAdventureTurnContext({
    world,
    playerCharacter: player,
    quest,
    adventure,
    currentScene: 'The cellar door is sealed.',
    turns: adventures.listTurns(adventureKey),
    clues: adventures.getClues(adventureKey),
    relatedNpcs: [npc],
    playerAction: 'Study the lock.',
    longTermSummary: null,
  });
}

function commitFromOutput(database: TransactionalSqliteDatabase, value: unknown): TurnCommit {
  const output = GenerateAdventureTurnOutputSchema.parse(value);
  const quest = requireEntity(new QuestRepository(database).get(questKey), 'Quest');
  const world = requireEntity(new WorldRepository(database).getBible(campaignKey), 'WorldBible');
  const validated = validateDomainStatePatches(output.statePatchProposals, {
    campaignId: campaignKey,
    world,
    quests: [quest],
    relationships: [],
    clocks: [],
    rewardAuthorizations: [],
  });
  const fact = validated.find((patch) => patch.kind === 'FACT');
  if (fact?.kind !== 'FACT') throw new Error('Expected a validated fact patch');
  const adventures = new AdventureRepository(database);
  const currentAdventure = requireEntity(adventures.get(adventureKey), 'Adventure');
  const currentTurn = requireEntity(adventures.getTurn(turnKey), 'AdventureTurn');
  const playerAction = requireEntity(currentTurn.playerAction, 'PlayerAction');
  const event: GameEvent = {
    id: gameEventId('event-orchestrated-action'),
    campaignId: campaignKey,
    schemaVersion: schemaVersion(1),
    type: 'PLAYER_ACTION_SUBMITTED',
    payload: {
      adventureId: adventureKey,
      turnId: turnKey,
      action: playerAction,
    },
    occurredAt: at,
  };

  return {
    campaignId: campaignKey,
    adventure: {
      ...currentAdventure,
      state: output.adventureState,
      currentTurnNumber: currentTurn.turnNumber,
      updatedAt: at,
    },
    turn: {
      ...currentTurn,
      sceneText: output.sceneText,
      speakerNpcIds: output.speakerNpcIds.map(npcId),
      suggestedActions: output.suggestedActions.map(({ text }, index) => ({
        kind: 'SUGGESTED',
        optionId: actionOptionId(`option-orchestrated-${index + 1}`),
        text,
      })),
      checkRequest:
        output.checkRequest === null
          ? null
          : {
              id: checkRequestId('check-orchestrated'),
              turnId: turnKey,
              ...output.checkRequest,
            },
      resolvedAt: at,
    },
    statePatches: [
      {
        kind: 'WORLD_FACT',
        fact: {
          id: worldFactId('fact-orchestrated'),
          campaignId: campaignKey,
          kind: fact.factKind,
          statement: fact.statement,
          locationId: null,
          factionIds: [],
          supersedesFactId: null,
          createdAt: at,
        },
      },
    ],
    events: [event],
  };
}

function seed(database: TransactionalSqliteDatabase): void {
  new CampaignRepository(database).create(
    createCampaign({ id: campaignKey, schemaVersion: schemaVersion(1), now: at }),
  );
  new WorldRepository(database).saveBible(world());
  new PlayerCharacterRepository(database).create(player());
  const taverns = new TavernRepository(database);
  taverns.create(tavern());
  new NpcRepository(database).create(npc());
  taverns.assignOwner(tavernKey, npcKey);
  new QuestRepository(database).create(quest());
  const adventures = new AdventureRepository(database);
  adventures.create(adventure());
  adventures.addTurn(pendingTurn());
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
    powerRules: ['Magic always leaves a warm trace.'],
    factions: [
      {
        id: factionId('faction-lantern'),
        name: 'Lantern Guild',
        description: 'Beacon keepers.',
        goals: ['Restore the lighthouse.'],
        relations: [],
      },
    ],
    locations: [
      {
        id: locationId('location-harbor'),
        name: 'Ash Harbor',
        description: 'A sheltered port.',
        parentLocationId: null,
        factionIds: [factionId('faction-lantern')],
      },
    ],
    narrativeStyle: 'Grounded heroic fantasy.',
    forbiddenElements: [],
    tavernReason: 'Travelers wait for safe tides.',
    storyHooks: ['The beacon dims at moonrise.'],
    lockedFields: ['powerRules'],
    createdAt: at,
    updatedAt: at,
  };
}

function player(): PlayerCharacter {
  return {
    id: playerKey,
    campaignId: campaignKey,
    name: 'Mira',
    gender: null,
    age: null,
    concept: 'Curious scout',
    storyPreferences: ['Mystery'],
    contentBoundaries: {
      allowHorror: true,
      allowPermanentDeath: false,
      allowRomance: true,
      allowBetrayal: true,
      excludedContent: [],
    },
    classArchetype: 'ROGUE',
    classDisplayName: 'Wayfinder',
    attributes: { physique: 2, agility: 3, knowledge: 3, charisma: 2 },
    traits: [
      {
        id: characterTraitId('trait-listener'),
        name: 'Keen Listener',
        description: 'Notices quiet changes.',
      },
      {
        id: characterTraitId('trait-roadwise'),
        name: 'Roadwise',
        description: 'Reads signs left by travelers.',
      },
    ],
    personalGoal: 'Find a lost sibling.',
    background: {
      birthplace: 'North Road',
      formativeExperience: 'Survived a winter crossing.',
      adventureMotivation: 'Protect travelers.',
      secret: 'Once followed a false beacon.',
      importantPerson: 'A missing sibling.',
      tavernArrivalReason: 'Following the last caravan.',
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
    specialRules: ['Weapons remain sheathed.'],
    longTermProblem: 'A strange cellar light.',
    ownerNpcId: npcKey,
    residentNpcIds: [npcKey],
    visitorNpcIds: [],
    createdAt: at,
    updatedAt: at,
  };
}

function npc(): NpcProfile {
  return {
    id: npcKey,
    campaignId: campaignKey,
    tavernId: tavernKey,
    residency: 'OWNER',
    name: 'Ilyra',
    identity: 'Innkeeper',
    appearance: 'Tall, with a red wool coat.',
    personality: 'Practical and observant.',
    goal: 'Keep the road open.',
    secret: 'Knows an old tunnel.',
    speechStyle: 'Measured questions.',
    currentMood: 'Concerned',
    currentStatus: 'ACTIVE',
    createdAt: at,
    updatedAt: at,
  };
}

function quest(): Quest {
  return {
    id: questKey,
    campaignId: campaignKey,
    publisherNpcId: npcKey,
    content: {
      title: 'The Fading Beacon',
      summary: 'Investigate the lighthouse.',
      objective: 'Restore the beacon.',
      failureCost: 'Ships remain trapped.',
    },
    status: 'ACTIVE',
    risk: 'MODERATE',
    recommendedAttributes: ['knowledge'],
    expectedTurns: { min: 8, max: 12 },
    rewardTier: 'NOTABLE',
    relatedNpcIds: [npcKey],
    relatedFactIds: [],
    createdAt: at,
    updatedAt: at,
  };
}

function adventure(): Adventure {
  return {
    id: adventureKey,
    campaignId: campaignKey,
    questId: questKey,
    state: 'SCENE',
    plan: {
      adventureId: adventureKey,
      objective: 'Restore the beacon.',
      risk: 'MODERATE',
      expectedTurns: { min: 8, max: 12 },
      coreScenes: ['Reach the lighthouse.'],
      necessaryClueIds: [],
      majorObstacles: ['A flooded causeway.'],
      possibleEndings: ['The beacon is restored.'],
      failureCost: 'Ships remain trapped.',
    },
    currentTurnNumber: 0,
    createdAt: at,
    updatedAt: at,
  };
}

function pendingTurn(): AdventureTurn {
  return {
    id: turnKey,
    adventureId: adventureKey,
    turnNumber: 1,
    sceneText: 'The cellar door is sealed.',
    speakerNpcIds: [],
    suggestedActions: [],
    playerAction: { kind: 'FREEFORM', text: 'Study the lock.' },
    checkRequest: null,
    diceResult: null,
    createdAt: at,
    resolvedAt: null,
  };
}

function requireEntity<Value>(value: Value | null, label: string): Value {
  if (value === null) throw new Error(`${label} fixture is missing`);
  return value;
}

async function createDatabase(): Promise<{
  readonly path: string;
  readonly database: DatabaseSync;
}> {
  const directory = await mkdtemp(join(tmpdir(), 'ember-tavern-orchestrator-'));
  directories.push(directory);
  const path = join(directory, 'orchestrator.sqlite');
  const database = new DatabaseSync(path);
  await applyMigrations(database);
  return { path, database };
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

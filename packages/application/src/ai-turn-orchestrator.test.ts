import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';

import {
  buildAdventureTurnContext,
  FakeAIProvider,
  GenerateAdventureTurnOutputSchema,
  StandardAIError,
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
  modelProfileId,
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
import { AIRequestRecoveryUseCases, AITurnOrchestrator } from './index.js';

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
      const fake = new FakeAIProvider(() => at);
      const generate = vi.fn((request, config) => fake.generate(request, config));
      const orchestrator = new AITurnOrchestrator(
        sqlite,
        {
          id: fake.id,
          listModels: () => fake.listModels(),
          testConnection: (config) => fake.testConnection(config),
          generate,
        },
        providerConfig,
        () => at,
      );
      const command = executeCommand(sqlite, buildContext);

      await expect(orchestrator.execute(command)).resolves.toBe('COMMITTED');
      await expect(orchestrator.execute(command)).resolves.toBe('ALREADY_COMMITTED');

      expect(buildContext).toHaveBeenCalledTimes(1);
      expect(generate).toHaveBeenCalledWith(
        expect.objectContaining({
          modelName: 'ember-fake-v1',
          responseFormat: { kind: 'TEXT' },
        }),
        providerConfig,
      );
      expect(new PendingAiRequestRepository(sqlite).get(command.requestId)).toMatchObject({
        status: 'COMMITTED',
        attemptCount: 1,
      });
      expect(new GenerationRecordRepository(sqlite).get(command.generationRecordId)).toMatchObject({
        task: 'GENERATE_ADVENTURE_TURN',
        modelProfileId: modelProfileId('profile-fake'),
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
          throw Object.freeze({ code: 'NETWORK' });
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
        code: 'NETWORK_FAILED',
      });
      expect(new PendingAiRequestRepository(sqlite).get(command.requestId)).toMatchObject({
        status: 'FAILED',
        lastError: { code: 'NETWORK_FAILED', retryable: true },
      });
      expect(new GenerationRecordRepository(sqlite).get(command.generationRecordId)).toMatchObject({
        rawResponseText: null,
        validatedOutput: null,
        validationError: { code: 'NETWORK_FAILED' },
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

  it('switches providers after quota exhaustion and commits the same persisted turn context once', async () => {
    const { database } = await createDatabase();
    try {
      const sqlite = adaptDatabase(database);
      seed(sqlite);
      const fake = new FakeAIProvider(() => at);
      const failingProvider: AIProvider = {
        id: 'quota-provider',
        listModels: () => fake.listModels(),
        testConnection: (config) => fake.testConnection(config),
        async generate() {
          throw new StandardAIError('QUOTA_EXCEEDED');
        },
      };
      const sourceOrchestrator = new AITurnOrchestrator(
        sqlite,
        failingProvider,
        providerConfig,
        () => at,
      );
      const sourceCommand = executeCommand(sqlite, () => contextFromSqlite(sqlite));

      await expect(sourceOrchestrator.execute(sourceCommand)).rejects.toMatchObject({
        code: 'QUOTA_EXCEEDED',
      });
      expect(new AdventureRepository(sqlite).getTurn(turnKey)).toMatchObject({
        sceneText: 'The cellar door is sealed.',
        resolvedAt: null,
      });

      const targetProviderConfig: ProviderConfig = {
        ...providerConfig,
        id: 'fallback-provider',
        providerType: 'OPENAI_COMPATIBLE',
        presetKey: 'deepseek',
        displayName: 'Fallback Provider',
      };
      seedFallbackProfile(sqlite, targetProviderConfig);
      const targetGenerate = vi.fn((request, config) => fake.generate(request, config));
      const targetOrchestrator = new AITurnOrchestrator(
        sqlite,
        {
          id: 'fallback-provider-adapter',
          listModels: () => fake.listModels(),
          testConnection: (config) => fake.testConnection(config),
          generate: targetGenerate,
        },
        targetProviderConfig,
        () => at,
      );
      const recovery = new AIRequestRecoveryUseCases(
        sqlite,
        targetOrchestrator,
        targetProviderConfig,
        () => at,
      );
      const recoveryCommand = {
        sourceRequestId: sourceCommand.requestId,
        requestId: aiRequestId('request-orchestrator-fallback'),
        generationRecordId: generationRecordId('generation-orchestrator-fallback'),
        idempotencyKey: idempotencyKey('campaign-orchestrator:turn-1:fallback'),
        task: sourceCommand.task,
        targetModelProfileId: modelProfileId('profile-fallback'),
        targetModelName: 'ember-fake-v1',
        selection: 'CONFIGURED_FALLBACK' as const,
        crossProviderDisclosureAccepted: false,
        modelSwitchedEventId: gameEventId('event-model-switched'),
        generationOptions: sourceCommand.generationOptions,
        validateDomainAndBuildCommit: (output: unknown) => commitFromOutput(sqlite, output),
      };

      await expect(recovery.recoverTurn(recoveryCommand)).rejects.toMatchObject({
        code: 'CROSS_PROVIDER_DISCLOSURE_REQUIRED',
      });
      expect(new PendingAiRequestRepository(sqlite).get(recoveryCommand.requestId)).toBeNull();

      const approved = { ...recoveryCommand, crossProviderDisclosureAccepted: true };
      await expect(recovery.recoverTurn(approved)).resolves.toBe('COMMITTED');
      await expect(recovery.recoverTurn(approved)).resolves.toBe('ALREADY_COMMITTED');

      expect(targetGenerate).toHaveBeenCalledTimes(1);
      const requests = new PendingAiRequestRepository(sqlite);
      const source = requests.get(sourceCommand.requestId);
      const recovered = requests.get(recoveryCommand.requestId);
      expect(source).toMatchObject({
        status: 'FAILED',
        lastError: { code: 'QUOTA_EXCEEDED' },
      });
      expect(recovered).toMatchObject({
        status: 'COMMITTED',
        input: source?.input,
        context: source?.context,
        attemptCount: 1,
      });
      expect(
        new GenerationRecordRepository(sqlite).get(recoveryCommand.generationRecordId),
      ).toMatchObject({
        modelProfileId: modelProfileId('profile-fallback'),
        request: { context: source?.context },
      });
      expect(new AdventureRepository(sqlite).getTurn(turnKey)).toMatchObject({
        sceneText: 'Warm light leaks through the old cellar lock as the storm shakes the shutters.',
        resolvedAt: at,
      });
      expect(new WorldRepository(sqlite).getFact(worldFactId('fact-orchestrated'))).not.toBeNull();
      const events = new GameEventRepository(sqlite).list(campaignKey);
      expect(events.map(({ type }) => type).sort()).toEqual([
        'MODEL_SWITCHED',
        'PLAYER_ACTION_SUBMITTED',
      ]);
      expect(events.find(({ type }) => type === 'MODEL_SWITCHED')).toMatchObject({
        payload: {
          previous: { providerKey: 'custom', modelName: 'ember-fake-v1' },
          current: { providerKey: 'deepseek', modelName: 'ember-fake-v1' },
        },
      });
    } finally {
      database.close();
    }
  });

  it('fails before the provider call when no registered model satisfies native structured output', async () => {
    const { database } = await createDatabase();
    try {
      const sqlite = adaptDatabase(database);
      seed(sqlite);
      const fake = new FakeAIProvider(() => at);
      const generate = vi.fn((request, config) => fake.generate(request, config));
      const orchestrator = new AITurnOrchestrator(
        sqlite,
        {
          id: fake.id,
          listModels: () => fake.listModels(),
          testConnection: (config) => fake.testConnection(config),
          generate,
        },
        providerConfig,
        () => at,
      );
      const command = executeCommand(sqlite, () => contextFromSqlite(sqlite));

      await expect(
        orchestrator.execute({
          ...command,
          generationOptions: { ...command.generationOptions, allowTextFallback: false },
        }),
      ).rejects.toMatchObject({ code: 'NO_MODEL_CANDIDATE' });
      expect(generate).not.toHaveBeenCalled();
      expect(new PendingAiRequestRepository(sqlite).get(command.requestId)).toMatchObject({
        status: 'FAILED',
        lastError: { code: 'NO_MODEL_CANDIDATE', retryable: false },
      });
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
  database
    .prepare(
      `INSERT INTO provider_configs (
         id, provider_type, preset_key, display_name, base_url, credential_ref,
         options_json, enabled, created_at, updated_at
       ) VALUES (?, 'LOCAL_OPENAI_COMPATIBLE', 'custom', 'Fake Provider', NULL, NULL,
                 '{}', 1, ?, ?)`,
    )
    .run(providerConfig.id, at, at);
  database
    .prepare(
      `INSERT INTO model_profiles (
         id, provider_config_id, model_name, display_name, capabilities_json,
         task_options_json, enabled, capabilities_checked_at, created_at, updated_at
       ) VALUES (?, ?, 'ember-fake-v1', 'Ember Fake v1', ?, '{}', 1, ?, ?, ?)`,
    )
    .run(
      'profile-fake',
      providerConfig.id,
      JSON.stringify({
        text: true,
        streaming: false,
        systemMessages: true,
        jsonMode: false,
        jsonSchema: false,
        toolCalling: false,
        reasoning: false,
        contextWindowTokens: 32768,
        costStatus: 'FREE',
        checkedAt: at,
      }),
      at,
      at,
      at,
    );
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

function seedFallbackProfile(database: TransactionalSqliteDatabase, config: ProviderConfig): void {
  database
    .prepare(
      `INSERT INTO provider_configs (
         id, provider_type, preset_key, display_name, base_url, credential_ref,
         options_json, enabled, created_at, updated_at
       ) VALUES (?, ?, ?, ?, NULL, NULL, '{}', 1, ?, ?)`,
    )
    .run(config.id, config.providerType, config.presetKey, config.displayName, at, at);
  database
    .prepare(
      `INSERT INTO model_profiles (
         id, provider_config_id, model_name, display_name, capabilities_json,
         task_options_json, enabled, capabilities_checked_at, created_at, updated_at
       ) VALUES ('profile-fallback', ?, 'ember-fake-v1', 'Ember Fake Fallback', ?, '{}', 1, ?, ?, ?)`,
    )
    .run(
      config.id,
      JSON.stringify({
        text: true,
        streaming: false,
        systemMessages: true,
        jsonMode: false,
        jsonSchema: false,
        toolCalling: false,
        reasoning: false,
        contextWindowTokens: 32768,
        costStatus: 'FREE',
        checkedAt: at,
      }),
      at,
      at,
      at,
    );
  database
    .prepare(
      `INSERT INTO app_settings (key, value_json, updated_at)
       VALUES ('fallback_model_profile_id', ?, ?)`,
    )
    .run(JSON.stringify('profile-fallback'), at);
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

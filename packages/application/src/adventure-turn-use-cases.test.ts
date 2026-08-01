import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';

import { FakeAIProvider, type AIProvider, type ProviderConfig } from '@ember-tavern/ai-core';
import {
  actionOptionId,
  adventureId,
  aiRequestId,
  campaignId,
  characterTraitId,
  checkRequestId,
  clueId,
  createCampaign,
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
  snapshotId,
  tavernId,
  transitionCampaign,
  turnId,
  worldFactId,
  type Adventure,
  type Clue,
  type Item,
  type NpcProfile,
  type PlayerCharacter,
  type Quest,
  type Tavern,
  type TurnId,
  type WorldBible,
} from '@ember-tavern/contracts';
import {
  AdventureRepository,
  CampaignRepository,
  GameEventRepository,
  ItemRepository,
  NpcRepository,
  PlayerCharacterRepository,
  QuestRepository,
  SnapshotRepository,
  TavernRepository,
  WorldRepository,
  type SqliteStatement,
  type SqliteValue,
  type TransactionalSqliteDatabase,
} from '@ember-tavern/persistence';
import { afterEach, describe, expect, it } from 'vitest';

import { applyMigrations } from '../../persistence/src/migrations.mjs';
import { AdventureTurnUseCases, type AdventureTurnIdentityFactory } from './index.js';
import { RegenerationUseCases } from './regeneration-use-cases.js';

const directories: string[] = [];
const campaignKey = campaignId('campaign-adventure-turn');
const characterKey = playerCharacterId('character-adventure-turn');
const questKey = questId('quest-adventure-turn');
const adventureKey = adventureId('adventure-turn');
const locationKey = locationId('location-adventure-turn');
const tavernKey = tavernId('tavern-adventure-turn');
const ownerKey = npcId('npc-adventure-turn-owner');
const at = isoTimestamp('2026-07-31T07:00:00.000Z');
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
const identities: AdventureTurnIdentityFactory = {
  check: (turn) => checkRequestId(`check:${turn}`),
  option: (turn, index) => actionOptionId(`option:${turn}:${index}`),
  event: (turn, kind) => gameEventId(`event:${turn}:${kind}`),
  fact: (turn, phase, index) => worldFactId(`fact:${turn}:${phase}:${index}`),
  snapshot: (turn) => snapshotId(`snapshot:${turn}`),
  completedSnapshot: (request) => snapshotId(`snapshot:completed:${request}`),
};

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('AdventureTurnUseCases', () => {
  it('resolves check-required and no-check turns through SQLite', async () => {
    const database = await createDatabase();
    try {
      const sqlite = adaptDatabase(database);
      seedCampaign(sqlite);
      seedModelProfile(sqlite, config, 'profile-fake');
      const checked = useCases(sqlite, new FakeAIProvider(() => at), 7);
      const firstTurnId = turnId('turn-check');

      expect(
        checked.submitPlayerAction({
          campaignId: campaignKey,
          adventureId: adventureKey,
          turnId: firstTurnId,
          currentScene: 'The cellar lock glows in the storm.',
          action: { kind: 'FREEFORM', text: 'Study the lock.' },
        }),
      ).toMatchObject({ turnNumber: 1, resolvedAt: null });
      expect(() =>
        checked.submitPlayerAction({
          campaignId: campaignKey,
          adventureId: adventureKey,
          turnId: turnId('turn-duplicate'),
          currentScene: 'A duplicate action must not create another pending turn.',
          action: { kind: 'FREEFORM', text: 'Submit twice.' },
        }),
      ).toThrow('Player action could not be saved');

      const awaitingRoll = await checked.resolveAdventureTurn(
        resolveCommand(firstTurnId, 'check-action'),
      );
      expect(awaitingRoll.checkRequest).toMatchObject({
        attribute: 'knowledge',
        difficulty: 11,
      });
      expect(awaitingRoll.resolvedAt).toBeNull();
      expect(new AdventureRepository(sqlite).get(adventureKey)?.state).toBe('CHECK_REQUIRED');
      expect(
        new AdventureRepository(sqlite)
          .getClues(adventureKey)
          .find((clue) => clue.title === 'Scorched Lens')?.discoveredInTurnId,
      ).toBe(firstTurnId);

      const rolled = checked.rollCheck({
        campaignId: campaignKey,
        adventureId: adventureKey,
        turnId: firstTurnId,
        playerCharacterId: characterKey,
        statusModifier: 0,
      });
      expect(rolled.diceResult).toEqual({
        checkRequestId: checkRequestId(`check:${firstTurnId}`),
        d20: 7,
        attributeModifier: 3,
        equipmentModifier: 1,
        statusModifier: 0,
        total: 11,
        difficulty: 11,
        success: true,
      });
      expect(new AdventureRepository(sqlite).get(adventureKey)?.state).toBe('RESOLVING');

      const narrated = await checked.resolveAdventureTurn(
        resolveCommand(firstTurnId, 'check-dice'),
      );
      expect(narrated.diceResult).toEqual(rolled.diceResult);
      expect(narrated.sceneText).toContain('The hidden catch yields');
      expect(new AdventureRepository(sqlite).get(adventureKey)?.state).toBe('SCENE');

      const secondTurnId = turnId('turn-no-check');
      const noCheck = useCases(sqlite, noCheckProvider(), 20);
      noCheck.submitPlayerAction({
        campaignId: campaignKey,
        adventureId: adventureKey,
        turnId: secondTurnId,
        currentScene: narrated.sceneText,
        action: { kind: 'FREEFORM', text: 'Enter the open passage.' },
      });
      const resolved = await noCheck.resolveAdventureTurn(resolveCommand(secondTurnId, 'no-check'));

      expect(resolved).toMatchObject({
        turnNumber: 2,
        checkRequest: null,
        diceResult: null,
        resolvedAt: at,
      });
      expect(resolved.sceneText).toContain('The passage opens');
      expect(new AdventureRepository(sqlite).get(adventureKey)).toMatchObject({
        state: 'SCENE',
        currentTurnNumber: 2,
      });
      expect(new GameEventRepository(sqlite).list(campaignKey).map(({ type }) => type)).toEqual([
        'PLAYER_ACTION_SUBMITTED',
        'DICE_ROLLED',
        'PLAYER_ACTION_SUBMITTED',
      ]);

      const incompleteTurnId = turnId('turn-after-latest-complete');
      noCheck.submitPlayerAction({
        campaignId: campaignKey,
        adventureId: adventureKey,
        turnId: incompleteTurnId,
        currentScene: resolved.sceneText,
        action: { kind: 'FREEFORM', text: 'Step into the next chamber.' },
      });
      expect(new AdventureRepository(sqlite).getTurn(incompleteTurnId)).not.toBeNull();

      const restored = noCheck.restoreLatestCompleteTurn(campaignKey, adventureKey);
      expect(restored.id).toBe(secondTurnId);
      expect(restored.resolvedAt).toBe(at);
      expect(new AdventureRepository(sqlite).getTurn(incompleteTurnId)).toBeNull();
      expect(new AdventureRepository(sqlite).get(adventureKey)?.currentTurnNumber).toBe(2);

      const snapshots = new SnapshotRepository(sqlite);
      for (let index = 1; index <= 12; index += 1) {
        snapshots.create({
          id: snapshotId(`snapshot:rotation:${index}`),
          campaignId: campaignKey,
          kind: 'AUTO',
          reason: `ROTATION_TEST:${index}`,
          schemaVersion: schemaVersion(1),
          createdAt: at,
        });
      }
      const rotated = snapshots.list(campaignKey, 'AUTO');
      expect(rotated).toHaveLength(10);
      expect(rotated[0]?.id).toBe(snapshotId('snapshot:rotation:12'));
      expect(rotated.at(-1)?.id).toBe(snapshotId('snapshot:rotation:3'));
      expect(
        snapshots.create({
          id: snapshotId('snapshot:rotation:12'),
          campaignId: campaignKey,
          kind: 'AUTO',
          reason: 'ROTATION_TEST:12',
          schemaVersion: schemaVersion(1),
          createdAt: at,
        }),
      ).toEqual(rotated[0]);
      expect(snapshots.list(campaignKey, 'AUTO')).toHaveLength(10);
    } finally {
      database.close();
    }
  });

  it('regenerates from the input snapshot and can roll back without combining AI results', async () => {
    const database = await createDatabase();
    try {
      const sqlite = adaptDatabase(database);
      seedCampaign(sqlite);
      seedModelProfile(sqlite, config, 'profile-fake');
      const turn = turnId('turn-regenerate');
      const originalTurns = useCases(
        sqlite,
        factProvider('Old result.', 'The old path opens.'),
        10,
      );
      originalTurns.submitPlayerAction({
        campaignId: campaignKey,
        adventureId: adventureKey,
        turnId: turn,
        currentScene: 'Two sealed paths wait below the tavern.',
        action: { kind: 'FREEFORM', text: 'Open one path.' },
      });
      await originalTurns.resolveAdventureTurn(resolveCommand(turn, 'original'));
      expect(
        new WorldRepository(sqlite).listFacts(campaignKey).map(({ statement }) => statement),
      ).toEqual(['Old result.']);

      const targetConfig: ProviderConfig = {
        ...config,
        id: 'other-provider',
        providerType: 'OPENAI_COMPATIBLE',
        presetKey: 'openrouter',
        displayName: 'Other Fake',
      };
      seedModelProfile(sqlite, targetConfig, 'profile-other');
      const targetTurns = new AdventureTurnUseCases(
        sqlite,
        factProvider('New result.', 'The new path opens.'),
        targetConfig,
        identities,
        { nextD20: () => 10 },
        () => at,
      );
      const regeneration = new RegenerationUseCases(sqlite, targetTurns, targetConfig, () => at);
      await expect(
        regeneration.regenerateCurrentReply({
          ...resolveCommand(turn, 'rejected-switch'),
          previous: {
            providerConfigId: config.id,
            providerType: config.providerType,
            providerKey: config.presetKey,
            modelName: 'ember-fake-v1',
          },
          switchApproved: true,
          crossProviderDisclosureAccepted: false,
          policy: { mode: 'FREE_STORY' },
          safetySnapshotId: snapshotId('snapshot:rejected'),
          modelSwitchedEventId: gameEventId('event:rejected-switch'),
        }),
      ).rejects.toThrow('data-transfer disclosure');
      expect(new AdventureRepository(sqlite).getTurn(turn)?.sceneText).toBe('The old path opens.');

      const failingTurns = new AdventureTurnUseCases(
        sqlite,
        failingProvider(),
        config,
        identities,
        { nextD20: () => 10 },
        () => at,
      );
      const failingRegeneration = new RegenerationUseCases(sqlite, failingTurns, config, () => at);
      await expect(
        failingRegeneration.regenerateCurrentReply({
          ...resolveCommand(turn, 'failed-regeneration'),
          previous: {
            providerConfigId: config.id,
            providerType: config.providerType,
            providerKey: config.presetKey,
            modelName: 'ember-fake-v1',
          },
          switchApproved: false,
          crossProviderDisclosureAccepted: false,
          policy: { mode: 'FREE_STORY' },
          safetySnapshotId: snapshotId('snapshot:y-failed-regeneration'),
          modelSwitchedEventId: gameEventId('event:unused-switch'),
        }),
      ).rejects.toThrow('Provider request failed');
      expect(new AdventureRepository(sqlite).getTurn(turn)?.sceneText).toBe('The old path opens.');
      expect(
        new WorldRepository(sqlite).listFacts(campaignKey).map(({ statement }) => statement),
      ).toEqual(['Old result.']);

      const regenerated = await regeneration.regenerateCurrentReply({
        ...resolveCommand(turn, 'regenerated'),
        previous: {
          providerConfigId: config.id,
          providerType: config.providerType,
          providerKey: config.presetKey,
          modelName: 'ember-fake-v1',
        },
        switchApproved: true,
        crossProviderDisclosureAccepted: true,
        policy: { mode: 'FREE_STORY' },
        safetySnapshotId: snapshotId('snapshot:a-safety'),
        modelSwitchedEventId: gameEventId('event:model-switched'),
      });

      expect(regenerated.playerAction).toEqual({ kind: 'FREEFORM', text: 'Open one path.' });
      expect(regenerated.sceneText).toBe('The new path opens.');
      expect(
        new WorldRepository(sqlite).listFacts(campaignKey).map(({ statement }) => statement),
      ).toEqual(['New result.']);
      expect(new GameEventRepository(sqlite).list(campaignKey).map(({ type }) => type)).toEqual([
        'MODEL_SWITCHED',
        'PLAYER_ACTION_SUBMITTED',
      ]);

      await expect(
        regeneration.regenerateCurrentReply({
          ...resolveCommand(turn, 'rules-limit'),
          previous: {
            providerConfigId: targetConfig.id,
            providerType: targetConfig.providerType,
            providerKey: targetConfig.presetKey,
            modelName: 'ember-fake-v1',
          },
          switchApproved: false,
          crossProviderDisclosureAccepted: false,
          policy: { mode: 'RULES', maxRegenerations: 1 },
          safetySnapshotId: snapshotId('snapshot:rules-limit'),
          modelSwitchedEventId: gameEventId('event:rules-limit'),
        }),
      ).rejects.toThrow('regeneration limit');
      expect(
        new WorldRepository(sqlite).listFacts(campaignKey).map(({ statement }) => statement),
      ).toEqual(['New result.']);

      regeneration.rollbackLatestSnapshot(campaignKey);
      expect(new AdventureRepository(sqlite).getTurn(turn)?.sceneText).toBe('The old path opens.');
      expect(
        new WorldRepository(sqlite).listFacts(campaignKey).map(({ statement }) => statement),
      ).toEqual(['Old result.']);
    } finally {
      database.close();
    }
  });

  it('rolls back the complete turn when its automatic snapshot cannot commit', async () => {
    const database = await createDatabase();
    try {
      const sqlite = adaptDatabase(database);
      seedCampaign(sqlite);
      seedModelProfile(sqlite, config, 'profile-fake');
      const turns = useCases(sqlite, noCheckProvider(), 10);
      const turn = turnId('turn-snapshot-conflict');
      const command = resolveCommand(turn, 'snapshot-conflict');
      turns.submitPlayerAction({
        campaignId: campaignKey,
        adventureId: adventureKey,
        turnId: turn,
        currentScene: 'The complete turn must remain atomic with its snapshot.',
        action: { kind: 'FREEFORM', text: 'Open the marked door.' },
      });
      new SnapshotRepository(sqlite).create({
        id: identities.completedSnapshot(command.requestId),
        campaignId: campaignKey,
        kind: 'AUTO',
        reason: 'CONFLICTING_SNAPSHOT',
        schemaVersion: schemaVersion(1),
        createdAt: at,
      });

      await expect(turns.resolveAdventureTurn(command)).rejects.toMatchObject({
        code: 'COMMIT_FAILED',
      });
      expect(new AdventureRepository(sqlite).getTurn(turn)).toMatchObject({
        sceneText: 'The complete turn must remain atomic with its snapshot.',
        resolvedAt: null,
      });
      expect(new AdventureRepository(sqlite).get(adventureKey)).toMatchObject({
        state: 'WAITING_FOR_PLAYER',
        currentTurnNumber: 0,
      });
      expect(new GameEventRepository(sqlite).list(campaignKey)).toEqual([]);
    } finally {
      database.close();
    }
  });
});

function useCases(
  database: TransactionalSqliteDatabase,
  provider: AIProvider,
  roll: number,
): AdventureTurnUseCases {
  return new AdventureTurnUseCases(
    database,
    provider,
    config,
    identities,
    { nextD20: () => roll },
    () => at,
  );
}

function noCheckProvider(): AIProvider {
  const fake = new FakeAIProvider(() => at);
  return {
    id: 'no-check',
    listModels: () => fake.listModels(),
    testConnection: (providerConfig) => fake.testConnection(providerConfig),
    async generate(request, providerConfig) {
      const response = await fake.generate(request, providerConfig);
      if (request.task !== 'GENERATE_ADVENTURE_TURN') return response;
      return Object.freeze({
        ...response,
        content: JSON.stringify({
          sceneText: 'The passage opens onto a quiet stone stair.',
          speakerNpcIds: [],
          suggestedActions: [{ text: 'Descend the stair.' }],
          checkRequest: null,
          discoveredClues: [],
          statePatchProposals: [],
          adventureState: 'WAITING_FOR_PLAYER',
        }),
      });
    },
  };
}

function factProvider(statement: string, sceneText: string): AIProvider {
  const fake = new FakeAIProvider(() => at);
  return {
    id: `fact:${statement}`,
    listModels: () => fake.listModels(),
    testConnection: (providerConfig) => fake.testConnection(providerConfig),
    async generate(request, providerConfig) {
      const response = await fake.generate(request, providerConfig);
      if (request.task !== 'GENERATE_ADVENTURE_TURN') return response;
      return Object.freeze({
        ...response,
        content: JSON.stringify({
          sceneText,
          speakerNpcIds: [],
          suggestedActions: [{ text: 'Continue.' }],
          checkRequest: null,
          discoveredClues: [],
          statePatchProposals: [
            {
              kind: 'FACT',
              targetId: null,
              rationale: 'The selected path becomes persistent.',
              payload: { statement },
            },
          ],
          adventureState: 'WAITING_FOR_PLAYER',
        }),
      });
    },
  };
}

function failingProvider(): AIProvider {
  const fake = new FakeAIProvider(() => at);
  return {
    id: 'failing-provider',
    listModels: () => fake.listModels(),
    testConnection: (providerConfig) => fake.testConnection(providerConfig),
    generate: () => {
      throw new Error('simulated provider failure');
    },
  };
}

function resolveCommand(turn: TurnId, phase: string) {
  return {
    campaignId: campaignKey,
    adventureId: adventureKey,
    turnId: turn,
    playerCharacterId: characterKey,
    requestId: aiRequestId(`request:${phase}`),
    generationRecordId: generationRecordId(`generation:${phase}`),
    idempotencyKey: idempotencyKey(`adventure-turn:${phase}`),
    modelProfileId: null,
    modelName: 'ember-fake-v1',
    generationOptions,
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
  const tavernState = transitionCampaign(tavernGeneration, 'TAVERN', at);
  campaigns.update(tavernState);
  campaigns.update(transitionCampaign(tavernState, 'ADVENTURE', at));

  new WorldRepository(database).saveBible(world());
  new PlayerCharacterRepository(database).create(character());
  const taverns = new TavernRepository(database);
  taverns.create(tavern());
  new NpcRepository(database).create(owner());
  taverns.assignOwner(tavernKey, ownerKey);
  new QuestRepository(database).create(quest());
  new AdventureRepository(database).create(adventure(), clues());
  new ItemRepository(database).create(item(), characterKey);
}

function seedModelProfile(
  database: TransactionalSqliteDatabase,
  provider: ProviderConfig,
  profileId: string,
): void {
  database
    .prepare(
      `INSERT INTO provider_configs (
         id, provider_type, preset_key, display_name, base_url, credential_ref,
         options_json, enabled, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, NULL, '{}', 1, ?, ?)`,
    )
    .run(
      provider.id,
      provider.providerType,
      provider.presetKey,
      provider.displayName,
      provider.baseUrl,
      at,
      at,
    );
  database
    .prepare(
      `INSERT INTO model_profiles (
         id, provider_config_id, model_name, display_name, capabilities_json,
         task_options_json, enabled, capabilities_checked_at, created_at, updated_at
       ) VALUES (?, ?, 'ember-fake-v1', 'Ember Fake v1', ?, '{}', 1, ?, ?, ?)`,
    )
    .run(
      profileId,
      provider.id,
      JSON.stringify({
        text: true,
        streaming: false,
        systemMessages: true,
        jsonMode: true,
        jsonSchema: true,
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
}

function adventure(): Adventure {
  return {
    id: adventureKey,
    campaignId: campaignKey,
    questId: questKey,
    state: 'SCENE',
    plan: {
      adventureId: adventureKey,
      objective: 'Restore the beacon flame.',
      risk: 'MODERATE',
      expectedTurns: { min: 8, max: 12 },
      coreScenes: ['Open the cellar.', 'Cross the tunnel.', 'Reach the beacon.'],
      necessaryClueIds: [clueId('clue-lens'), clueId('clue-ledger'), clueId('clue-signet')],
      majorObstacles: ['A rusted lock.'],
      possibleEndings: ['The beacon is restored.'],
      failureCost: 'Ships remain trapped.',
    },
    currentTurnNumber: 0,
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
      discoveredInTurnId: null,
    },
    {
      id: clueId('clue-ledger'),
      adventureId: adventureKey,
      title: 'Tide Ledger',
      description: 'The flood follows a schedule.',
      isCore: true,
      discoveredInTurnId: null,
    },
    {
      id: clueId('clue-signet'),
      adventureId: adventureKey,
      title: 'Keeper Signet',
      description: 'The keeper sealed the chamber.',
      isCore: true,
      discoveredInTurnId: null,
    },
  ];
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
      failureCost: 'Ships remain trapped.',
    },
    status: 'ACTIVE',
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

function item(): Item {
  return {
    id: itemId('item-lens-tool'),
    campaignId: campaignKey,
    content: { name: 'Lens Tool', description: 'A precise brass inspection tool.' },
    rewardTier: 'BASIC',
    effect: { kind: 'CHECK_MODIFIER', attribute: 'knowledge', modifier: 1 },
    createdAt: at,
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
      { id: characterTraitId('trait-listener'), name: 'Listener', description: 'Notices changes.' },
      { id: characterTraitId('trait-roadwise'), name: 'Roadwise', description: 'Reads routes.' },
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
  const directory = await mkdtemp(join(tmpdir(), 'ember-tavern-adventure-turn-'));
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

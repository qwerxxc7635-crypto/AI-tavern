import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';

import { FakeAIProvider, type ProviderConfig } from '@ember-tavern/ai-core';
import {
  aiRequestId,
  campaignId,
  characterTraitId,
  conversationId,
  createCampaign,
  createNpcKnowledge,
  createNpcRelationship,
  generationRecordId,
  idempotencyKey,
  isoTimestamp,
  locationId,
  messageId,
  npcId,
  npcMemoryId,
  playerCharacterId,
  schemaVersion,
  tavernId,
  transitionCampaign,
  turnId,
  worldFactId,
  type NpcProfile,
  type PlayerCharacter,
  type Tavern,
  type WorldBible,
} from '@ember-tavern/contracts';
import {
  CampaignRepository,
  GenerationRecordRepository,
  NpcRepository,
  PlayerCharacterRepository,
  TavernRepository,
  WorldRepository,
  type SqliteStatement,
  type SqliteValue,
  type TransactionalSqliteDatabase,
} from '@ember-tavern/persistence';
import { afterEach, describe, expect, it } from 'vitest';

import { applyMigrations } from '../../persistence/src/migrations.mjs';
import { NpcDialogueUseCases } from './index.js';

const directories: string[] = [];
const campaignKey = campaignId('campaign-dialogue');
const characterKey = playerCharacterId('character-dialogue');
const npcKey = npcId('npc-ilyra');
const conversationKey = conversationId('conversation-ilyra');
const locationKey = locationId('location-harbor');
const at = isoTimestamp('2026-07-31T04:00:00.000Z');
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

describe('NpcDialogueUseCases', () => {
  it('continues a limited-knowledge conversation after reopen and persists extracted memory', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ember-tavern-dialogue-use-case-'));
    directories.push(directory);
    const path = join(directory, 'dialogue.sqlite');
    let database = new DatabaseSync(path);
    await applyMigrations(database);
    seedCampaign(adaptDatabase(database));

    const first = await createUseCases(adaptDatabase(database)).talkToNpc({
      ...request('reply-1'),
      campaignId: campaignKey,
      conversationId: conversationKey,
      playerMessageId: messageId('message-player-1'),
      npcMessageId: messageId('message-npc-1'),
      npcId: npcKey,
      playerMessage: 'Show me the cellar door.',
    });
    expect(first.messages).toHaveLength(2);
    expect(first.relationship.trust).toBe(1);
    database.close();

    database = new DatabaseSync(path);
    const sqlite = adaptDatabase(database);
    try {
      const useCases = createUseCases(sqlite);
      const second = await useCases.talkToNpc({
        ...request('reply-2'),
        campaignId: campaignKey,
        conversationId: conversationKey,
        playerMessageId: messageId('message-player-2'),
        npcMessageId: messageId('message-npc-2'),
        npcId: npcKey,
        playerMessage: 'What did you see below?',
      });
      expect(second.messages.map(({ sequenceNumber }) => sequenceNumber)).toEqual([1, 2, 3, 4]);
      expect(second.messages[1]?.content).toContain('cellar door');
      expect(second.relationship.trust).toBe(2);

      const generation = new GenerationRecordRepository(sqlite).get(
        generationRecordId('generation-reply-2'),
      );
      expect(JSON.stringify(generation?.request)).toContain('The cellar has an old door.');
      expect(JSON.stringify(generation?.request)).toContain('Show me the cellar door.');
      expect(JSON.stringify(generation?.request)).not.toContain(
        'The owner hid a royal seal beneath the floor.',
      );

      const memories = await useCases.extractMemories({
        ...request('memories'),
        campaignId: campaignKey,
        conversationId: conversationKey,
        npcId: npcKey,
        sourceTurnIds: [turnId('turn-1')],
      });
      expect(memories).toEqual([
        {
          id: npcMemoryId('memory-0'),
          npcId: npcKey,
          summary: 'The player promised Ilyra to investigate the lighthouse passage.',
          sourceTurnIds: [turnId('turn-1')],
          createdAt: at,
        },
      ]);
      expect(new NpcRepository(sqlite).listMemories(npcKey)).toEqual(memories);
    } finally {
      database.close();
    }
  });
});

function request(suffix: string) {
  return {
    requestId: aiRequestId(`request-${suffix}`),
    generationRecordId: generationRecordId(`generation-${suffix}`),
    idempotencyKey: idempotencyKey(`dialogue:${suffix}`),
    modelProfileId: null,
    modelName: 'ember-fake-v1',
    generationOptions: { temperature: 0, maxOutputTokens: 4_000, timeoutMs: 1_000 },
  };
}

function createUseCases(database: TransactionalSqliteDatabase) {
  return new NpcDialogueUseCases(
    database,
    new FakeAIProvider(() => at),
    config,
    { memory: (_summary, index) => npcMemoryId(`memory-${index}`) },
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
  const tavernGeneration = transitionCampaign(characterCreation, 'GENERATING_TAVERN', at);
  campaigns.update(tavernGeneration);
  campaigns.update(transitionCampaign(tavernGeneration, 'TAVERN', at));

  const worlds = new WorldRepository(database);
  worlds.saveBible(world());
  worlds.addFact({
    id: worldFactId('fact-known'),
    campaignId: campaignKey,
    kind: 'DEVELOPING_FACT',
    statement: 'The cellar has an old door.',
    locationId: locationKey,
    factionIds: [],
    supersedesFactId: null,
    createdAt: at,
  });
  worlds.addFact({
    id: worldFactId('fact-excluded'),
    campaignId: campaignKey,
    kind: 'DEVELOPING_FACT',
    statement: 'The owner hid a royal seal beneath the floor.',
    locationId: locationKey,
    factionIds: [],
    supersedesFactId: null,
    createdAt: at,
  });
  new PlayerCharacterRepository(database).create(character());

  const taverns = new TavernRepository(database);
  taverns.create(tavern());
  const npcs = new NpcRepository(database);
  npcs.create(npc());
  taverns.assignOwner(tavernId('tavern-ember'), npcKey);
  npcs.saveKnowledge(
    createNpcKnowledge({
      npcId: npcKey,
      knownFactIds: [worldFactId('fact-known')],
      suspectedFactIds: [],
      falseBeliefFactIds: [],
      excludedSecretFactIds: [worldFactId('fact-excluded')],
    }),
    at,
  );
  npcs.saveRelationship(
    createNpcRelationship({
      npcId: npcKey,
      playerCharacterId: characterKey,
      trust: 0,
      closeness: 0,
      awe: 0,
      obligation: 0,
    }),
    at,
  );
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
    id: tavernId('tavern-ember'),
    campaignId: campaignKey,
    locationId: locationKey,
    name: 'Ember Rest',
    position: 'Harbor crossroads',
    environment: 'A warm stone hall.',
    specialRules: [],
    longTermProblem: 'A cellar light.',
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
    tavernId: tavernId('tavern-ember'),
    residency: 'OWNER',
    name: 'Ilyra Venn',
    identity: 'Innkeeper',
    appearance: 'A weathered red coat.',
    personality: 'Practical and observant.',
    goal: 'Keep the harbor road open.',
    secret: 'Knows the cellar tunnel.',
    speechStyle: 'Measured and direct.',
    currentMood: 'Concerned',
    currentStatus: 'ACTIVE',
    createdAt: at,
    updatedAt: at,
  };
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

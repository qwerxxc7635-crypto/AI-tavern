import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';

import {
  actionOptionId,
  adventureId,
  campaignId,
  characterTraitId,
  checkRequestId,
  clueId,
  conversationId,
  createCampaign,
  createPlayerAttributes,
  generationRecordId,
  isoTimestamp,
  itemId,
  locationId,
  messageId,
  npcId,
  playerCharacterId,
  questId,
  schemaVersion,
  tavernChangeId,
  tavernId,
  turnId,
  worldClockId,
  type Adventure,
  type AdventureTurn,
  type Conversation,
  type Item,
  type Message,
  type NpcProfile,
  type PlayerCharacter,
  type Quest,
  type Tavern,
} from '@ember-tavern/contracts';
import type { WorldClock } from '@ember-tavern/domain';
import { afterEach, describe, expect, it } from 'vitest';

import {
  AdventureRepository,
  CampaignRepository,
  ConversationRepository,
  ItemRepository,
  NpcRepository,
  PlayerCharacterRepository,
  QuestRepository,
  TavernRepository,
  WorldClockRepository,
  type SqliteDatabase,
  type SqliteStatement,
  type SqliteValue,
} from './index.js';
import { applyMigrations } from './migrations.mjs';

const directories: string[] = [];
const now = isoTimestamp('2026-07-30T18:00:00.000Z');
const campaignKey = campaignId('campaign-1');
const characterKey = playerCharacterId('character-1');
const tavernKey = tavernId('tavern-1');
const npcKey = npcId('npc-owner');
const questKey = questId('quest-1');
const adventureKey = adventureId('adventure-1');
const turnKey = turnId('turn-1');

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('quest, adventure, conversation, item, and clock persistence', () => {
  it('restores a complete adventure turn after closing and reopening SQLite', async () => {
    const { path, database } = await createDatabase();
    const sqlite = adaptDatabase(database);
    seedPrerequisites(sqlite);
    const quests = new QuestRepository(sqlite);
    const adventures = new AdventureRepository(sqlite);
    const conversations = new ConversationRepository(sqlite);
    const items = new ItemRepository(sqlite);
    const clocks = new WorldClockRepository(sqlite);

    const storedQuest = quest();
    const storedAdventure = adventure();
    const clue = {
      id: clueId('clue-1'),
      adventureId: adventureKey,
      title: 'Scorched lens',
      description: 'The lens was damaged from inside.',
      isCore: true,
      discoveredInTurnId: turnKey,
    } as const;
    const storedTurn = adventureTurn();
    const conversation = adventureConversation();
    const messages = adventureMessages();
    const item = rewardItem();
    const clock = worldClock();

    quests.create(storedQuest);
    adventures.create(storedAdventure, [clue]);
    adventures.addTurn(storedTurn);
    conversations.create(conversation);
    for (const message of messages) conversations.addMessage(message);
    items.create(item);
    items.assign(item.id, characterKey, adventureKey);
    clocks.create(clock, now);
    database.close();

    const reopened = new DatabaseSync(path);
    try {
      await applyMigrations(reopened);
      const restored = adaptDatabase(reopened);
      expect(new QuestRepository(restored).get(questKey)).toEqual(storedQuest);
      expect(new AdventureRepository(restored).get(adventureKey)).toEqual(storedAdventure);
      expect(new AdventureRepository(restored).getClues(adventureKey)).toEqual([clue]);
      expect(new AdventureRepository(restored).getTurn(turnKey)).toEqual(storedTurn);
      expect(new AdventureRepository(restored).listTurns(adventureKey)).toEqual([storedTurn]);
      expect(new ConversationRepository(restored).get(conversation.id)).toEqual(conversation);
      expect(new ConversationRepository(restored).listMessages(conversation.id)).toEqual(messages);
      expect(new ItemRepository(restored).get(item.id)).toEqual(item);
      expect(new ItemRepository(restored).listOwned(characterKey)).toEqual([item]);
      expect(new WorldClockRepository(restored).get(clock.id)).toEqual(clock);
    } finally {
      reopened.close();
    }
  });

  it('updates quest, adventure ending, clues, and world clock without changing identity', async () => {
    const { database } = await createDatabase();
    try {
      const sqlite = adaptDatabase(database);
      seedPrerequisites(sqlite);
      const quests = new QuestRepository(sqlite);
      const adventures = new AdventureRepository(sqlite);
      const clocks = new WorldClockRepository(sqlite);
      const storedQuest = quest();
      const storedAdventure = adventure();
      quests.create(storedQuest);
      adventures.create(storedAdventure);
      clocks.create(worldClock(), now);

      const accepted: Quest = {
        ...storedQuest,
        status: 'ACCEPTED',
        updatedAt: isoTimestamp('2026-07-30T18:01:00.000Z'),
      };
      quests.update(accepted);
      expect(quests.get(questKey)).toEqual(accepted);

      const ending = {
        adventureId: adventureKey,
        outcome: 'PARTIAL_SUCCESS',
        summary: 'The beacon relights, but the engine remains unstable.',
        keyDecisions: ['Protected the beacon mechanism.'],
        unresolvedThreads: ['The keeper remains missing.'],
        nextDirections: ['Search the north road.'],
        unresolvedClueIds: [clueId('clue-unresolved')],
        participantNpcIds: [npcKey],
        acquiredItemIds: [],
        worldFactIds: [],
        tavernChangeId: tavernChangeId('change-ending'),
        summaryGenerationRecordId: generationRecordId('generation-summary'),
        worldEventGenerationRecordId: generationRecordId('generation-world-event'),
        completedAt: isoTimestamp('2026-07-30T18:10:00.000Z'),
      } as const;
      adventures.saveEnding(ending);
      expect(adventures.getEnding(adventureKey)).toEqual(ending);
      expect(adventures.get(adventureKey)?.state).toBe('SETTLED');

      const advanced: WorldClock = { ...worldClock(), current: 2 };
      clocks.update(advanced, isoTimestamp('2026-07-30T18:02:00.000Z'));
      expect(clocks.list(campaignKey)).toEqual([advanced]);
    } finally {
      database.close();
    }
  });

  it('rejects duplicate turn and message sequence numbers', async () => {
    const { database } = await createDatabase();
    try {
      const sqlite = adaptDatabase(database);
      seedPrerequisites(sqlite);
      new QuestRepository(sqlite).create(quest());
      const adventures = new AdventureRepository(sqlite);
      adventures.create(adventure());
      adventures.addTurn(adventureTurn());
      expect(() =>
        adventures.addTurn({ ...adventureTurn(), id: turnId('turn-duplicate') }),
      ).toThrow();

      const conversations = new ConversationRepository(sqlite);
      const conversation = adventureConversation();
      conversations.create(conversation);
      const first = adventureMessages()[0];
      if (first === undefined) throw new Error('Message fixture is missing');
      conversations.addMessage(first);
      expect(() =>
        conversations.addMessage({ ...first, id: messageId('message-duplicate') }),
      ).toThrow();
    } finally {
      database.close();
    }
  });
});

async function createDatabase() {
  const directory = await mkdtemp(join(tmpdir(), 'ember-tavern-adventure-persistence-'));
  directories.push(directory);
  const path = join(directory, 'test.sqlite');
  const database = new DatabaseSync(path);
  await applyMigrations(database);
  return { path, database };
}

function seedPrerequisites(sqlite: SqliteDatabase): void {
  new CampaignRepository(sqlite).create(
    createCampaign({ id: campaignKey, schemaVersion: schemaVersion(1), now }),
  );
  new PlayerCharacterRepository(sqlite).create(character());
  const taverns = new TavernRepository(sqlite);
  taverns.create(tavern());
  new NpcRepository(sqlite).create(npc());
  taverns.assignOwner(tavernKey, npcKey);
}

function quest(): Quest {
  return {
    id: questKey,
    campaignId: campaignKey,
    publisherNpcId: npcKey,
    content: {
      title: 'Relight the Beacon',
      summary: 'Restore the western navigation light.',
      objective: 'Reach and repair the beacon.',
      failureCost: 'Trade routes remain closed.',
    },
    status: 'AVAILABLE',
    risk: 'MODERATE',
    recommendedAttributes: ['knowledge', 'agility'],
    expectedTurns: { min: 8, max: 12 },
    rewardTier: 'NOTABLE',
    relatedNpcIds: [npcKey],
    relatedFactIds: [],
    createdAt: now,
    updatedAt: now,
  };
}

function adventure(): Adventure {
  return {
    id: adventureKey,
    campaignId: campaignKey,
    questId: questKey,
    state: 'WAITING_FOR_PLAYER',
    plan: {
      adventureId: adventureKey,
      objective: 'Repair the western beacon.',
      risk: 'MODERATE',
      expectedTurns: { min: 8, max: 12 },
      coreScenes: ['Cross the storm bridge', 'Enter the lens chamber'],
      necessaryClueIds: [clueId('clue-1')],
      majorObstacles: ['Broken bridge'],
      possibleEndings: ['Beacon restored', 'Beacon lost'],
      failureCost: 'The harbor closes.',
    },
    currentTurnNumber: 1,
    createdAt: now,
    updatedAt: now,
  };
}

function adventureTurn(): AdventureTurn {
  const checkId = checkRequestId('check-1');
  return {
    id: turnKey,
    adventureId: adventureKey,
    turnNumber: 1,
    sceneText: 'A broken bridge sways over the clouds.',
    speakerNpcIds: [npcKey],
    suggestedActions: [
      {
        kind: 'SUGGESTED',
        optionId: actionOptionId('option-1'),
        text: 'Secure a rope and cross.',
      },
    ],
    playerAction: { kind: 'FREEFORM', text: 'Test the nearest support first.' },
    checkRequest: {
      id: checkId,
      turnId: turnKey,
      attribute: 'knowledge',
      difficulty: 14,
      reason: 'Assess the damaged support.',
    },
    diceResult: {
      checkRequestId: checkId,
      d20: 12,
      attributeModifier: 2,
      equipmentModifier: 0,
      statusModifier: 0,
      total: 14,
      difficulty: 14,
      success: true,
    },
    createdAt: now,
    resolvedAt: isoTimestamp('2026-07-30T18:00:30.000Z'),
  };
}

function adventureConversation(): Conversation {
  return {
    id: conversationId('conversation-adventure'),
    campaignId: campaignKey,
    kind: 'ADVENTURE',
    npcId: null,
    adventureId: adventureKey,
    createdAt: now,
    updatedAt: now,
  };
}

function adventureMessages(): readonly Message[] {
  const conversation = conversationId('conversation-adventure');
  return [
    {
      id: messageId('message-1'),
      conversationId: conversation,
      sequenceNumber: 1,
      role: 'NARRATOR',
      speakerNpcId: null,
      content: 'The bridge groans in the wind.',
      generationRecordId: null,
      createdAt: now,
    },
    {
      id: messageId('message-2'),
      conversationId: conversation,
      sequenceNumber: 2,
      role: 'PLAYER',
      speakerNpcId: null,
      content: 'I inspect the support.',
      generationRecordId: null,
      createdAt: now,
    },
  ];
}

function rewardItem(): Item {
  return {
    id: itemId('item-stormglass'),
    campaignId: campaignKey,
    content: { name: 'Stormglass', description: 'A lens that reads pressure shifts.' },
    rewardTier: 'NOTABLE',
    effect: { kind: 'CHECK_MODIFIER', attribute: 'knowledge', modifier: 1 },
    createdAt: now,
  };
}

function worldClock(): WorldClock {
  return {
    id: worldClockId('clock-storm'),
    campaignId: campaignKey,
    name: 'Storm front',
    current: 1,
    max: 6,
    stages: [
      { at: 2, title: 'Trade routes become dangerous' },
      { at: 6, title: 'The storm reaches the tavern' },
    ],
  };
}

function character(): PlayerCharacter {
  return {
    id: characterKey,
    campaignId: campaignKey,
    name: 'Mira',
    gender: null,
    age: 27,
    concept: 'Weather scholar',
    storyPreferences: [],
    contentBoundaries: {
      allowHorror: true,
      allowPermanentDeath: false,
      allowRomance: true,
      allowBetrayal: true,
      excludedContent: [],
    },
    classArchetype: 'SCHOLAR',
    classDisplayName: 'Storm Archivist',
    attributes: createPlayerAttributes({ physique: 1, agility: 2, knowledge: 5, charisma: 2 }),
    traits: [
      { id: characterTraitId('trait-1'), name: 'Reader', description: 'Reads storms.' },
      { id: characterTraitId('trait-2'), name: 'Patient', description: 'Waits.' },
    ],
    personalGoal: 'Repair the beacon.',
    background: {
      birthplace: 'Harbor',
      formativeExperience: 'Skyquake',
      adventureMotivation: 'Protect home',
      secret: 'Forbidden chart',
      importantPerson: 'Aven',
      tavernArrivalReason: 'Followed chart',
    },
    initialEquipment: [],
    createdAt: now,
    updatedAt: now,
  };
}

function tavern(): Tavern {
  return {
    id: tavernKey,
    campaignId: campaignKey,
    locationId: locationId('location-harbor'),
    name: 'Ember Cup',
    position: 'Docks',
    environment: 'Warm',
    specialRules: [],
    longTermProblem: 'Sinking foundation',
    ownerNpcId: npcKey,
    residentNpcIds: [npcKey],
    visitorNpcIds: [],
    createdAt: now,
    updatedAt: now,
  };
}

function npc(): NpcProfile {
  return {
    id: npcKey,
    campaignId: campaignKey,
    tavernId: tavernKey,
    residency: 'OWNER',
    name: 'Ilyra',
    identity: 'Owner',
    appearance: 'Red coat',
    personality: 'Practical',
    goal: 'Protect tavern',
    secret: 'Old route',
    speechStyle: 'Direct',
    currentMood: 'Alert',
    currentStatus: 'ACTIVE',
    createdAt: now,
    updatedAt: now,
  };
}

function adaptDatabase(value: DatabaseSync): SqliteDatabase {
  return {
    prepare(sql): SqliteStatement {
      return adaptStatement(value.prepare(sql));
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

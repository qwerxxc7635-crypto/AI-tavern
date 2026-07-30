import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';

import {
  adventureId,
  campaignId,
  createNpcRelationship,
  gameEventId,
  isoTimestamp,
  npcId,
  playerCharacterId,
  questId,
  schemaVersion,
  turnId,
  worldFactId,
  type Adventure,
  type AdventureTurn,
  type GameEvent,
  type Quest,
} from '@ember-tavern/contracts';
import { afterEach, describe, expect, it } from 'vitest';

import {
  AdventureRepository,
  GameEventRepository,
  NpcRepository,
  QuestRepository,
  TurnTransaction,
  type TransactionalSqliteDatabase,
  type SqliteStatement,
  type SqliteValue,
} from './index.js';
import { applyMigrations } from './migrations.mjs';

const directories: string[] = [];
const databases: DatabaseSync[] = [];
const campaignKey = campaignId('campaign-transaction');
const adventureKey = adventureId('adventure-transaction');
const questKey = questId('quest-transaction');
const npcKey = npcId('npc-transaction');
const characterKey = playerCharacterId('character-transaction');
const at = isoTimestamp('2026-07-30T20:00:00.000Z');

afterEach(async () => {
  for (const database of databases.splice(0)) database.close();
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('transactional turn commit', () => {
  it('commits player input, AI output, state patches, and events together', async () => {
    const database = await createDatabase();
    seed(database);
    const transaction = new TurnTransaction(database);
    const relationship = createNpcRelationship({
      npcId: npcKey,
      playerCharacterId: characterKey,
      trust: 1,
      closeness: 0,
      awe: 0,
      obligation: 0,
    });
    const actionEvent = playerActionEvent('event-action-1', 'turn-1');

    transaction.commit({
      campaignId: campaignKey,
      adventure: adventure(1),
      turn: completeTurn('turn-1', 1),
      statePatches: [
        { kind: 'QUEST', quest: activeQuest() },
        { kind: 'NPC_RELATIONSHIP', relationship, updatedAt: at },
        {
          kind: 'WORLD_FACT',
          fact: {
            id: worldFactId('fact-transaction'),
            campaignId: campaignKey,
            kind: 'DEVELOPING_FACT',
            statement: 'The cellar door was opened.',
            locationId: null,
            factionIds: [],
            supersedesFactId: null,
            createdAt: at,
          },
        },
      ],
      events: [actionEvent],
    });

    expect(new AdventureRepository(database).getTurn(turnId('turn-1'))).toMatchObject({
      sceneText: 'The cellar opens into a glowing tunnel.',
      playerAction: { kind: 'FREEFORM', text: 'Open the cellar door' },
    });
    expect(new AdventureRepository(database).get(adventureKey)?.currentTurnNumber).toBe(1);
    expect(new QuestRepository(database).get(questKey)?.status).toBe('ACTIVE');
    expect(new NpcRepository(database).getRelationship(npcKey)?.trust).toBe(1);
    expect(new GameEventRepository(database).list(campaignKey)).toEqual([actionEvent]);
  });

  it('rolls back every write when a later event insert fails', async () => {
    const database = await createDatabase();
    seed(database);
    const transaction = new TurnTransaction(database);
    const firstEvent = playerActionEvent('event-duplicate', 'turn-1');
    transaction.commit({
      campaignId: campaignKey,
      adventure: adventure(1),
      turn: completeTurn('turn-1', 1),
      statePatches: [],
      events: [firstEvent],
    });
    const changedRelationship = createNpcRelationship({
      npcId: npcKey,
      playerCharacterId: characterKey,
      trust: 2,
      closeness: 0,
      awe: 0,
      obligation: 0,
    });

    expect(() =>
      transaction.commit({
        campaignId: campaignKey,
        adventure: adventure(2),
        turn: completeTurn('turn-2', 2),
        statePatches: [
          { kind: 'QUEST', quest: activeQuest() },
          {
            kind: 'NPC_RELATIONSHIP',
            relationship: changedRelationship,
            updatedAt: at,
          },
        ],
        events: [playerActionEvent('event-duplicate', 'turn-2')],
      }),
    ).toThrow();

    expect(new AdventureRepository(database).getTurn(turnId('turn-2'))).toBeNull();
    expect(new AdventureRepository(database).get(adventureKey)?.currentTurnNumber).toBe(1);
    expect(new QuestRepository(database).get(questKey)?.status).toBe('ACCEPTED');
    expect(new NpcRepository(database).getRelationship(npcKey)).toBeNull();
    expect(new GameEventRepository(database).list(campaignKey)).toEqual([firstEvent]);
  });
});

async function createDatabase(): Promise<TransactionalSqliteDatabase> {
  const directory = await mkdtemp(join(tmpdir(), 'ember-turn-transaction-'));
  directories.push(directory);
  const native = new DatabaseSync(join(directory, 'game.sqlite'));
  databases.push(native);
  native.exec('PRAGMA foreign_keys = ON');
  await applyMigrations(native);
  return {
    exec(sql) {
      native.exec(sql);
    },
    prepare(sql) {
      const statement = native.prepare(sql);
      return adaptStatement(statement);
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

function seed(database: TransactionalSqliteDatabase): void {
  database
    .prepare(
      `INSERT INTO campaigns (
         id, schema_version, state, resume_state, created_at, updated_at
       ) VALUES (?, 1, 'ADVENTURE', NULL, ?, ?)`,
    )
    .run(campaignKey, at, at);
  database
    .prepare(
      `INSERT INTO player_characters (
         id, campaign_id, name, gender, age, concept, story_preferences_json,
         content_boundaries_json, class_archetype, class_display_name, attributes_json,
         traits_json, personal_goal, background_json, initial_equipment_ids_json,
         created_at, updated_at
       ) VALUES (?, ?, 'Mira', NULL, NULL, 'Curious scout', '[]', '{}',
         'ROGUE', 'Scout', ?, '[]', 'Open the cellar', '{}', '[]', ?, ?)`,
    )
    .run(
      characterKey,
      campaignKey,
      JSON.stringify({ strength: 0, agility: 1, intellect: 1, will: 0, presence: 0 }),
      at,
      at,
    );
  database
    .prepare(
      `INSERT INTO taverns (
         id, campaign_id, location_id, name, position, environment,
         special_rules_json, long_term_problem, owner_npc_id, changes_json,
         created_at, updated_at
       ) VALUES ('tavern-transaction', ?, 'location-1', 'Ember Rest', 'Crossroads',
         'Warm', '[]', 'Old debts', NULL, '[]', ?, ?)`,
    )
    .run(campaignKey, at, at);
  database
    .prepare(
      `INSERT INTO npcs (
         id, campaign_id, tavern_id, residency, name, identity, appearance,
         personality, goal, secret, speech_style, current_mood, current_status,
         visit_json, memories_json, created_at, updated_at
       ) VALUES (?, ?, 'tavern-transaction', 'OWNER', 'Ilya', 'Innkeeper', 'Tall',
         'Careful', 'Protect the inn', 'None', 'Measured', 'Concerned', 'ACTIVE',
         NULL, '[]', ?, ?)`,
    )
    .run(npcKey, campaignKey, at, at);
  database
    .prepare(`UPDATE taverns SET owner_npc_id = ? WHERE id = 'tavern-transaction'`)
    .run(npcKey);
  const storedQuest = acceptedQuest();
  new QuestRepository(database).create(storedQuest);
  new AdventureRepository(database).create(adventure(0));
}

function acceptedQuest(): Quest {
  return {
    id: questKey,
    campaignId: campaignKey,
    publisherNpcId: npcKey,
    content: {
      title: 'The sealed cellar',
      summary: 'Find the source of the light.',
      objective: 'Open the cellar.',
      failureCost: 'The inn remains unsafe.',
    },
    status: 'ACCEPTED',
    risk: 'LOW',
    recommendedAttributes: ['knowledge'],
    expectedTurns: { min: 1, max: 3 },
    rewardTier: 'BASIC',
    relatedNpcIds: [npcKey],
    relatedFactIds: [],
    createdAt: at,
    updatedAt: at,
  };
}

function activeQuest(): Quest {
  return { ...acceptedQuest(), status: 'ACTIVE', updatedAt: at };
}

function adventure(currentTurnNumber: number): Adventure {
  return {
    id: adventureKey,
    campaignId: campaignKey,
    questId: questKey,
    state: currentTurnNumber === 0 ? 'PREPARING' : 'SCENE',
    plan: {
      adventureId: adventureKey,
      objective: 'Open the cellar.',
      risk: 'LOW',
      expectedTurns: { min: 1, max: 3 },
      coreScenes: ['Cellar door'],
      necessaryClueIds: [],
      majorObstacles: ['Rusty lock'],
      possibleEndings: ['Door opened'],
      failureCost: 'The inn remains unsafe.',
    },
    currentTurnNumber,
    createdAt: at,
    updatedAt: at,
  };
}

function completeTurn(id: string, turnNumber: number): AdventureTurn {
  return {
    id: turnId(id),
    adventureId: adventureKey,
    turnNumber,
    sceneText: 'The cellar opens into a glowing tunnel.',
    speakerNpcIds: [],
    suggestedActions: [],
    playerAction: { kind: 'FREEFORM', text: 'Open the cellar door' },
    checkRequest: null,
    diceResult: null,
    createdAt: at,
    resolvedAt: at,
  };
}

function playerActionEvent(id: string, turn: string): GameEvent {
  return {
    id: gameEventId(id),
    campaignId: campaignKey,
    schemaVersion: schemaVersion(1),
    type: 'PLAYER_ACTION_SUBMITTED',
    payload: {
      adventureId: adventureKey,
      turnId: turnId(turn),
      action: { kind: 'FREEFORM', text: 'Open the cellar door' },
    },
    occurredAt: at,
  };
}

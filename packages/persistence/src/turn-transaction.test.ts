import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';

import {
  adventureId,
  aiRequestId,
  campaignId,
  createNpcRelationship,
  gameEventId,
  isoTimestamp,
  idempotencyKey,
  itemId,
  npcId,
  playerCharacterId,
  questId,
  schemaVersion,
  turnId,
  worldFactId,
  type Adventure,
  type AdventureTurn,
  type GameEvent,
  type Item,
  type Quest,
} from '@ember-tavern/contracts';
import { afterEach, describe, expect, it } from 'vitest';

import {
  AdventureRepository,
  GameEventRepository,
  IdempotencyConflictError,
  ItemRepository,
  NpcRepository,
  PendingAiRequestRepository,
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

describe('pending AI request lifecycle and idempotency', () => {
  it('tracks error codes and retry attempts without duplicating a request key', async () => {
    const database = await createDatabase();
    seed(database);
    new AdventureRepository(database).addTurn({
      ...completeTurn('turn-lifecycle', 1),
      sceneText: 'The cellar door remains sealed.',
      resolvedAt: null,
    });
    const requests = new PendingAiRequestRepository(database);
    const input = pendingRequestInput(
      'request-lifecycle',
      'request-key-lifecycle',
      turnId('turn-lifecycle'),
    );
    const created = requests.createOrGet(input);

    expect(requests.createOrGet(input)).toEqual(created);
    expect(() =>
      requests.createOrGet({
        ...input,
        id: aiRequestId('request-conflict'),
      }),
    ).toThrow(IdempotencyConflictError);
    expect(() =>
      requests.createOrGet({
        ...pendingRequestInput('request-secret', 'request-key-secret', turnId('turn-lifecycle')),
        input: { apiKey: 'must-not-be-stored' },
      }),
    ).toThrow(/forbidden credential field/);

    requests.setContext(created.id, { recentTurns: [] }, at);
    expect(requests.startAttempt(created.id, at).attemptCount).toBe(1);
    const failed = requests.fail(
      created.id,
      { code: 'TIMEOUT', message: 'Provider timed out', retryable: true },
      at,
    );
    expect(failed).toMatchObject({
      status: 'FAILED',
      attemptCount: 1,
      lastError: { code: 'TIMEOUT', retryable: true },
    });

    requests.retryWithContext(created.id, { recentTurns: ['turn-0'] }, at);
    expect(requests.startAttempt(created.id, at).attemptCount).toBe(2);
    requests.markReceived(created.id, at);
    expect(requests.markValidating(created.id, at).status).toBe('VALIDATING');
    expect(requests.listUnfinished(campaignKey)).toHaveLength(1);
  });

  it('does not submit an item reward twice for a repeated idempotency key', async () => {
    const database = await createDatabase();
    seed(database);
    const adventures = new AdventureRepository(database);
    adventures.addTurn({
      ...completeTurn('turn-reward', 1),
      sceneText: 'A sealed cellar door waits beneath the inn.',
      resolvedAt: null,
    });
    const requests = new PendingAiRequestRepository(database);
    const request = requests.createOrGet(
      pendingRequestInput('request-reward', 'request-key-reward', turnId('turn-reward')),
    );
    requests.setContext(request.id, { objective: 'Open the cellar' }, at);
    requests.startAttempt(request.id, at);
    requests.markReceived(request.id, at);
    requests.markValidating(request.id, at);
    const item = rewardItem();
    const itemEvent: GameEvent = {
      id: gameEventId('event-item-reward'),
      campaignId: campaignKey,
      schemaVersion: schemaVersion(1),
      type: 'ITEM_ACQUIRED',
      payload: {
        itemId: item.id,
        playerCharacterId: characterKey,
        sourceAdventureId: adventureKey,
      },
      occurredAt: at,
    };
    const command = {
      campaignId: campaignKey,
      adventure: adventure(1),
      turn: completeTurn('turn-reward', 1),
      statePatches: [
        {
          kind: 'ITEM_REWARD',
          item,
          ownerCharacterId: characterKey,
          sourceAdventureId: adventureKey,
        },
      ],
      events: [playerActionEvent('event-action-reward', 'turn-reward'), itemEvent],
    } as const;

    expect(requests.commitTurnOnce(request.idempotencyKey, command, at)).toBe('COMMITTED');
    expect(requests.commitTurnOnce(request.idempotencyKey, command, at)).toBe('ALREADY_COMMITTED');

    expect(new ItemRepository(database).listOwned(characterKey)).toEqual([item]);
    expect(new GameEventRepository(database).list(campaignKey)).toHaveLength(2);
    expect(requests.get(request.id)?.status).toBe('COMMITTED');
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

function pendingRequestInput(
  id: string,
  key: string,
  requestTurnId: ReturnType<typeof turnId> | null,
) {
  return {
    id: aiRequestId(id),
    campaignId: campaignKey,
    turnId: requestTurnId,
    idempotencyKey: idempotencyKey(key),
    task: 'ADVENTURE_TURN',
    modelProfileId: null,
    input: { action: 'Open the cellar door' },
    createdAt: at,
  } as const;
}

function rewardItem(): Item {
  return {
    id: itemId('item-reward'),
    campaignId: campaignKey,
    content: {
      name: 'Ember Lens',
      description: 'Reveals warm traces in darkness.',
    },
    rewardTier: 'BASIC',
    effect: { kind: 'CHECK_MODIFIER', attribute: 'knowledge', modifier: 1 },
    createdAt: at,
  };
}

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';

import {
  campaignId,
  characterTraitId,
  createCampaign,
  createPlayerAttributes,
  idempotencyKey,
  isoTimestamp,
  itemId,
  npcId,
  playerCharacterId,
  questId,
  rulesEventId,
  schemaVersion,
  type Item,
  type PlayerCharacter,
  type RulesCommand,
} from '@ember-tavern/contracts';
import { afterEach, describe, expect, it } from 'vitest';

import {
  CampaignRepository,
  ItemRepository,
  PlayerCharacterRepository,
  RulesEngineRepository,
  RulesIdempotencyConflictError,
  type SqliteStatement,
  type SqliteValue,
  type TransactionalSqliteDatabase,
} from './index.js';
import { applyMigrations } from './migrations.mjs';

const directories: string[] = [];
const campaign = campaignId('campaign-rules-persistence');
const character = playerCharacterId('character-rules-persistence');
const now = isoTimestamp('2026-08-14T04:00:00.000Z');
const later = isoTimestamp('2026-08-14T04:01:00.000Z');

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('RulesEngineRepository', () => {
  it('initializes with the character, commits once, reopens and exposes append-only audit', async () => {
    const { database, path } = await createDatabase();
    const sqlite = adaptDatabase(database);
    createFixture(sqlite);
    const repository = new RulesEngineRepository(sqlite);
    expect(repository.getState(character)).toMatchObject({
      baseAttributes: { physique: 3, agility: 2, knowledge: 3, charisma: 2 },
      hitPoints: { current: 10, max: 10 },
      revision: 1,
    });

    const command = localCommand({ kind: 'CHANGE_MONEY', delta: 25 });
    const input = {
      eventId: rulesEventId('rules-event-money'),
      idempotencyKey: idempotencyKey('rules-key-money'),
      command,
      expectedRevision: 1,
      occurredAt: later,
    } as const;
    const committed = repository.commitOnce(input);
    expect(committed).toMatchObject({
      status: 'COMMITTED',
      event: { beforeRevision: 1, afterRevision: 2 },
    });
    expect(repository.commitOnce({ ...input, expectedRevision: 999 }).status).toBe(
      'ALREADY_COMMITTED',
    );
    expect(repository.getState(character)).toMatchObject({ money: 25, revision: 2 });
    expect(repository.listEvents(character)).toHaveLength(1);
    expect(() => database.prepare("UPDATE rules_events SET source = 'SYSTEM'").run()).toThrow(
      /append-only/u,
    );
    database.close();

    const reopened = new DatabaseSync(path);
    try {
      await applyMigrations(reopened);
      const restored = new RulesEngineRepository(adaptDatabase(reopened));
      expect(restored.getState(character)).toMatchObject({ money: 25, revision: 2 });
      expect(restored.listEvents(character)[0]).toMatchObject({
        idempotencyKey: 'rules-key-money',
        command: { kind: 'CHANGE_MONEY', delta: 25 },
      });
    } finally {
      reopened.close();
    }
  });

  it('checks equipment ownership and rolls back state when audit insertion fails', async () => {
    const { database } = await createDatabase();
    try {
      const sqlite = adaptDatabase(database);
      createFixture(sqlite);
      const owned: Item = {
        id: itemId('item-rules-owned'),
        campaignId: campaign,
        content: { name: 'Lantern', description: 'A local item.' },
        rewardTier: 'BASIC',
        effect: { kind: 'NONE' },
        createdAt: now,
      };
      new ItemRepository(sqlite).create(owned, character);
      const repository = new RulesEngineRepository(sqlite);
      expect(
        repository.commitOnce({
          eventId: rulesEventId('rules-event-equip'),
          idempotencyKey: idempotencyKey('rules-key-equip'),
          command: localCommand({ kind: 'EQUIP_ITEM', itemId: owned.id }),
          expectedRevision: 1,
          occurredAt: later,
        }).event.stateAfter.equippedItemIds,
      ).toEqual([owned.id]);

      expect(() =>
        repository.commitOnce({
          eventId: rulesEventId('rules-event-equip'),
          idempotencyKey: idempotencyKey('rules-key-collision'),
          command: localCommand({ kind: 'CHANGE_MONEY', delta: 10 }),
          expectedRevision: 2,
          occurredAt: later,
        }),
      ).toThrow();
      expect(repository.getState(character)).toMatchObject({ money: 0, revision: 2 });
      expect(repository.listEvents(character)).toHaveLength(1);
    } finally {
      database.close();
    }
  });

  it('commits Quest and state revisions atomically and rejects idempotency drift', async () => {
    const { database } = await createDatabase();
    try {
      const sqlite = adaptDatabase(database);
      createFixture(sqlite);
      createQuestFixture(database);
      const repository = new RulesEngineRepository(sqlite);
      const command = localCommand({
        kind: 'TRANSITION_QUEST',
        questId: questId('quest-rules-persistence'),
        status: 'ACCEPTED',
      });
      const result = repository.commitOnce({
        eventId: rulesEventId('rules-event-quest'),
        idempotencyKey: idempotencyKey('rules-key-quest'),
        command,
        expectedRevision: 1,
        occurredAt: later,
      });
      expect(result.event).toMatchObject({
        questBeforeStatus: 'AVAILABLE',
        questAfterStatus: 'ACCEPTED',
        beforeRevision: 1,
        afterRevision: 2,
      });
      expect(
        database
          .prepare(
            "SELECT status FROM quest_pool_states WHERE quest_id = 'quest-rules-persistence'",
          )
          .get(),
      ).toEqual({ status: 'ACCEPTED' });

      expect(() =>
        repository.commitOnce({
          eventId: rulesEventId('rules-event-conflict'),
          idempotencyKey: idempotencyKey('rules-key-quest'),
          command: localCommand({ kind: 'CHANGE_MONEY', delta: 1 }),
          expectedRevision: 2,
          occurredAt: later,
        }),
      ).toThrow(RulesIdempotencyConflictError);
      expect(repository.getState(character)?.revision).toBe(2);
    } finally {
      database.close();
    }
  });

  it('rejects direct base attribute mutation at the SQLite boundary', async () => {
    const { database } = await createDatabase();
    try {
      const sqlite = adaptDatabase(database);
      createFixture(sqlite);
      expect(() =>
        database
          .prepare(
            'UPDATE character_rule_states SET base_attributes_json = ? WHERE player_character_id = ?',
          )
          .run('{"physique":5,"agility":1,"knowledge":2,"charisma":2}', character),
      ).toThrow(/base character attributes are immutable/u);
    } finally {
      database.close();
    }
  });

  it('blocks direct audit deletion but permits campaign cascade deletion', async () => {
    const { database } = await createDatabase();
    try {
      const sqlite = adaptDatabase(database);
      createFixture(sqlite);
      new RulesEngineRepository(sqlite).commitOnce({
        eventId: rulesEventId('rules-event-delete'),
        idempotencyKey: idempotencyKey('rules-key-delete'),
        command: localCommand({ kind: 'CHANGE_MONEY', delta: 1 }),
        expectedRevision: 1,
        occurredAt: later,
      });
      expect(() => database.prepare('DELETE FROM rules_events').run()).toThrow(/append-only/u);
      expect(database.prepare('DELETE FROM campaigns WHERE id = ?').run(campaign).changes).toBe(1);
      expect(database.prepare('SELECT COUNT(*) AS count FROM rules_events').get()).toEqual({
        count: 0,
      });
    } finally {
      database.close();
    }
  });
});

async function createDatabase(): Promise<{ database: DatabaseSync; path: string }> {
  const directory = await mkdtemp(join(tmpdir(), 'ember-rules-engine-'));
  directories.push(directory);
  const path = join(directory, 'test.sqlite');
  const database = new DatabaseSync(path);
  await applyMigrations(database);
  return { database, path };
}

function createFixture(sqlite: TransactionalSqliteDatabase): void {
  new CampaignRepository(sqlite).create(
    createCampaign({ id: campaign, schemaVersion: schemaVersion(1), now }),
  );
  const player: PlayerCharacter = {
    id: character,
    campaignId: campaign,
    name: 'Rules Hero',
    gender: null,
    age: null,
    concept: 'A local adjudication fixture.',
    storyPreferences: [],
    contentBoundaries: {
      allowHorror: true,
      allowPermanentDeath: false,
      allowRomance: false,
      allowBetrayal: true,
      excludedContent: [],
    },
    classArchetype: 'SCHOLAR',
    classDisplayName: 'Rules Scholar',
    attributes: createPlayerAttributes({ physique: 3, agility: 2, knowledge: 3, charisma: 2 }),
    traits: [
      { id: characterTraitId('trait-rules-one'), name: 'Steady', description: 'Keeps calm.' },
      { id: characterTraitId('trait-rules-two'), name: 'Curious', description: 'Asks why.' },
    ],
    personalGoal: 'Verify the rules.',
    background: {
      birthplace: 'Test Harbor',
      formativeExperience: 'A deterministic test.',
      adventureMotivation: 'Protect state.',
      secret: 'None.',
      importantPerson: 'The verifier.',
      tavernArrivalReason: 'Run a transaction.',
    },
    initialEquipment: [],
    createdAt: now,
    updatedAt: now,
  };
  new PlayerCharacterRepository(sqlite).create(player);
}

function createQuestFixture(database: DatabaseSync): void {
  database.exec(`
    INSERT INTO taverns (
      id, campaign_id, location_id, name, position, environment, special_rules_json,
      long_term_problem, changes_json, created_at, updated_at
    ) VALUES (
      'tavern-rules-persistence', '${campaign}', 'location-rules', 'Rules Tavern', 'Square',
      'Quiet', '[]', 'None', '[]', '${now}', '${now}'
    );
    INSERT INTO npcs (
      id, campaign_id, tavern_id, residency, name, identity, appearance, personality,
      goal, secret, speech_style, current_mood, current_status, memories_json, created_at, updated_at
    ) VALUES (
      '${npcId('npc-rules-persistence')}', '${campaign}', 'tavern-rules-persistence', 'OWNER',
      'Keeper', 'Publisher', 'Plain', 'Precise', 'Test', 'None', 'Brief', 'Calm', 'ACTIVE',
      '[]', '${now}', '${now}'
    );
    INSERT INTO quests (
      id, campaign_id, publisher_npc_id, content_json, status, risk,
      recommended_attributes_json, expected_turns_min, expected_turns_max,
      reward_tier, related_npc_ids_json, related_fact_ids_json, created_at, updated_at
    ) VALUES (
      'quest-rules-persistence', '${campaign}', 'npc-rules-persistence',
      '{"title":"Rules Quest","summary":"Test","objective":"Commit","failureCost":"Fail"}',
      'AVAILABLE', 'LOW', '["knowledge"]', 1, 2, 'BASIC', '[]', '[]', '${now}', '${now}'
    );
  `);
}

type CommandBody = RulesCommand extends infer Command
  ? Command extends RulesCommand
    ? Omit<Command, 'campaignId' | 'playerCharacterId' | 'authority'>
    : never
  : never;

function localCommand(body: CommandBody): RulesCommand {
  return {
    ...body,
    campaignId: campaign,
    playerCharacterId: character,
    authority: 'LOCAL_RULE',
  } as RulesCommand;
}

function adaptDatabase(value: DatabaseSync): TransactionalSqliteDatabase {
  return {
    exec(sql) {
      value.exec(sql);
    },
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

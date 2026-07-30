import {
  adventureId,
  campaignId,
  conversationId,
  generationRecordId,
  isoTimestamp,
  itemId,
  messageId,
  npcId,
  worldClockId,
  type Conversation,
  type Item,
  type ItemEffect,
  type Message,
  type playerCharacterId,
} from '@ember-tavern/contracts';
import type { WorldClock } from '@ember-tavern/domain';

import { PersistenceDataError } from './campaign-repository.js';
import {
  parseJson,
  requireArray,
  requireEnum,
  requireNullableString,
  requireNumber,
  requireRecord,
  requireString,
} from './persistence-validation.js';
import type { SqliteDatabase, SqliteRunResult } from './sqlite-port.js';

const CONVERSATION_KINDS = ['NPC', 'ADVENTURE', 'SYSTEM'] as const;
const MESSAGE_ROLES = ['PLAYER', 'NPC', 'NARRATOR', 'SYSTEM'] as const;
const REWARD_TIERS = ['BASIC', 'NOTABLE', 'RARE', 'LEGENDARY'] as const;
const ATTRIBUTES = ['physique', 'agility', 'knowledge', 'charisma'] as const;

export class ConversationRepository {
  public constructor(private readonly database: SqliteDatabase) {}

  public create(conversation: Conversation): void {
    validateConversationScope(conversation);
    this.database
      .prepare(
        `INSERT INTO conversations (
           id, campaign_id, kind, npc_id, adventure_id, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        conversation.id,
        conversation.campaignId,
        conversation.kind,
        conversation.npcId,
        conversation.adventureId,
        conversation.createdAt,
        conversation.updatedAt,
      );
  }

  public get(id: Conversation['id']): Conversation | null {
    const row = this.database.prepare('SELECT * FROM conversations WHERE id = ?').get(id);
    return row === undefined ? null : mapConversation(row);
  }

  public addMessage(message: Message): void {
    validateMessageSpeaker(message);
    this.database
      .prepare(
        `INSERT INTO messages (
           id, conversation_id, sequence_number, role, speaker_npc_id,
           content, generation_record_id, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        message.id,
        message.conversationId,
        message.sequenceNumber,
        message.role,
        message.speakerNpcId,
        message.content,
        message.generationRecordId,
        message.createdAt,
      );
  }

  public listMessages(id: Conversation['id']): readonly Message[] {
    return Object.freeze(
      this.database
        .prepare(
          `SELECT * FROM messages
           WHERE conversation_id = ?
           ORDER BY sequence_number`,
        )
        .all(id)
        .map(mapMessage),
    );
  }
}

export class ItemRepository {
  public constructor(private readonly database: SqliteDatabase) {}

  public create(item: Item, ownerId: ReturnType<typeof playerCharacterId> | null = null): void {
    this.database
      .prepare(
        `INSERT INTO items (
           id, campaign_id, owner_character_id, source_adventure_id,
           content_json, reward_tier, effect_json, created_at
         ) VALUES (?, ?, ?, NULL, ?, ?, ?, ?)`,
      )
      .run(
        item.id,
        item.campaignId,
        ownerId,
        JSON.stringify(item.content),
        item.rewardTier,
        JSON.stringify(item.effect),
        item.createdAt,
      );
  }

  public get(id: Item['id']): Item | null {
    const row = this.database.prepare('SELECT * FROM items WHERE id = ?').get(id);
    return row === undefined ? null : mapItem(row);
  }

  public assign(
    id: Item['id'],
    ownerId: ReturnType<typeof playerCharacterId>,
    sourceId: ReturnType<typeof adventureId> | null,
  ): void {
    one(
      this.database
        .prepare(
          `UPDATE items
           SET owner_character_id = ?, source_adventure_id = ?
           WHERE id = ?`,
        )
        .run(ownerId, sourceId, id),
      `Item not found: ${id}`,
    );
  }

  public listOwned(ownerId: ReturnType<typeof playerCharacterId>): readonly Item[] {
    return Object.freeze(
      this.database
        .prepare(
          `SELECT * FROM items
           WHERE owner_character_id = ?
           ORDER BY created_at, id`,
        )
        .all(ownerId)
        .map(mapItem),
    );
  }
}

export class WorldClockRepository {
  public constructor(private readonly database: SqliteDatabase) {}

  public create(clock: WorldClock, at: ReturnType<typeof isoTimestamp>): void {
    this.database
      .prepare(
        `INSERT INTO world_clocks (
           id, campaign_id, name, current, max, stages_json, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        clock.id,
        clock.campaignId,
        clock.name,
        clock.current,
        clock.max,
        JSON.stringify(clock.stages),
        at,
        at,
      );
  }

  public get(id: WorldClock['id']): WorldClock | null {
    const row = this.database.prepare('SELECT * FROM world_clocks WHERE id = ?').get(id);
    return row === undefined ? null : mapClock(row);
  }

  public update(clock: WorldClock, at: ReturnType<typeof isoTimestamp>): void {
    one(
      this.database
        .prepare(
          `UPDATE world_clocks SET
             name = ?, current = ?, max = ?, stages_json = ?, updated_at = ?
           WHERE id = ? AND campaign_id = ?`,
        )
        .run(
          clock.name,
          clock.current,
          clock.max,
          JSON.stringify(clock.stages),
          at,
          clock.id,
          clock.campaignId,
        ),
      `WorldClock identity changed or record not found: ${clock.id}`,
    );
  }

  public list(id: ReturnType<typeof campaignId>): readonly WorldClock[] {
    return Object.freeze(
      this.database
        .prepare(
          `SELECT * FROM world_clocks
           WHERE campaign_id = ?
           ORDER BY created_at, id`,
        )
        .all(id)
        .map(mapClock),
    );
  }
}

function mapConversation(value: unknown): Conversation {
  const row = requireRecord(value, 'Conversation row');
  const npc = requireNullableString(row['npc_id'], 'npc_id');
  const adventure = requireNullableString(row['adventure_id'], 'adventure_id');
  const result = Object.freeze({
    id: conversationId(requireString(row['id'], 'id')),
    campaignId: campaignId(requireString(row['campaign_id'], 'campaign_id')),
    kind: requireEnum(CONVERSATION_KINDS, row['kind'], 'kind'),
    npcId: npc === null ? null : npcId(npc),
    adventureId: adventure === null ? null : adventureId(adventure),
    createdAt: isoTimestamp(requireString(row['created_at'], 'created_at')),
    updatedAt: isoTimestamp(requireString(row['updated_at'], 'updated_at')),
  });
  validateConversationScope(result);
  return result;
}

function mapMessage(value: unknown): Message {
  const row = requireRecord(value, 'Message row');
  const speaker = requireNullableString(row['speaker_npc_id'], 'speaker_npc_id');
  const generation = requireNullableString(row['generation_record_id'], 'generation_record_id');
  const message = Object.freeze({
    id: messageId(requireString(row['id'], 'id')),
    conversationId: conversationId(requireString(row['conversation_id'], 'conversation_id')),
    sequenceNumber: requireNumber(row['sequence_number'], 'sequence_number'),
    role: requireEnum(MESSAGE_ROLES, row['role'], 'role'),
    speakerNpcId: speaker === null ? null : npcId(speaker),
    content: requireString(row['content'], 'content'),
    generationRecordId: generation === null ? null : generationRecordId(generation),
    createdAt: isoTimestamp(requireString(row['created_at'], 'created_at')),
  });
  validateMessageSpeaker(message);
  return message;
}

function mapItem(value: unknown): Item {
  const row = requireRecord(value, 'Item row');
  const content = requireRecord(parseJson(row['content_json'], 'content_json'), 'Item.content');
  return Object.freeze({
    id: itemId(requireString(row['id'], 'id')),
    campaignId: campaignId(requireString(row['campaign_id'], 'campaign_id')),
    content: Object.freeze({
      name: requireString(content['name'], 'Item.content.name'),
      description: requireString(content['description'], 'Item.content.description'),
    }),
    rewardTier: requireEnum(REWARD_TIERS, row['reward_tier'], 'reward_tier'),
    effect: parseEffect(parseJson(row['effect_json'], 'effect_json')),
    createdAt: isoTimestamp(requireString(row['created_at'], 'created_at')),
  });
}

function parseEffect(value: unknown): ItemEffect {
  const row = requireRecord(value, 'ItemEffect');
  const kind = requireEnum(
    ['NONE', 'CHECK_MODIFIER', 'REROLL', 'CONSUMABLE_RECOVERY'] as const,
    row['kind'],
    'ItemEffect.kind',
  );
  switch (kind) {
    case 'NONE':
      return Object.freeze({ kind });
    case 'CHECK_MODIFIER':
      return Object.freeze({
        kind,
        attribute: requireEnum(ATTRIBUTES, row['attribute'], 'ItemEffect.attribute'),
        modifier: requireNumber(row['modifier'], 'ItemEffect.modifier'),
      });
    case 'REROLL':
      return Object.freeze({ kind, uses: requireNumber(row['uses'], 'ItemEffect.uses') });
    case 'CONSUMABLE_RECOVERY':
      return Object.freeze({
        kind,
        resource: requireEnum(
          ['INJURY', 'STRESS'] as const,
          row['resource'],
          'ItemEffect.resource',
        ),
        amount: requireNumber(row['amount'], 'ItemEffect.amount'),
        uses: requireNumber(row['uses'], 'ItemEffect.uses'),
      });
  }
}

function mapClock(value: unknown): WorldClock {
  const row = requireRecord(value, 'WorldClock row');
  const max = requireNumber(row['max'], 'max');
  const current = requireNumber(row['current'], 'current');
  if (
    !Number.isSafeInteger(max) ||
    max < 1 ||
    !Number.isSafeInteger(current) ||
    current < 0 ||
    current > max
  ) {
    throw new PersistenceDataError('WorldClock range is invalid');
  }
  const thresholds = new Set<number>();
  const stages = Object.freeze(
    requireArray(parseJson(row['stages_json'], 'stages_json'), 'stages').map((entry, index) => {
      const stage = requireRecord(entry, `stages[${index}]`);
      const at = requireNumber(stage['at'], `stages[${index}].at`);
      if (!Number.isSafeInteger(at) || at < 1 || at > max || thresholds.has(at)) {
        throw new PersistenceDataError(`stages[${index}].at is invalid or duplicated`);
      }
      thresholds.add(at);
      return Object.freeze({
        at,
        title: requireString(stage['title'], `stages[${index}].title`),
      });
    }),
  );
  return Object.freeze({
    id: worldClockId(requireString(row['id'], 'id')),
    campaignId: campaignId(requireString(row['campaign_id'], 'campaign_id')),
    name: requireString(row['name'], 'name'),
    current,
    max,
    stages,
  });
}

function validateConversationScope(conversation: Conversation): void {
  const valid =
    (conversation.kind === 'NPC' &&
      conversation.npcId !== null &&
      conversation.adventureId === null) ||
    (conversation.kind === 'ADVENTURE' &&
      conversation.npcId === null &&
      conversation.adventureId !== null) ||
    (conversation.kind === 'SYSTEM' &&
      conversation.npcId === null &&
      conversation.adventureId === null);
  if (!valid) throw new PersistenceDataError('Conversation scope does not match its kind');
}

function validateMessageSpeaker(message: Message): void {
  if ((message.role === 'NPC') !== (message.speakerNpcId !== null)) {
    throw new PersistenceDataError('NPC message role must match speakerNpcId');
  }
  if (!Number.isSafeInteger(message.sequenceNumber) || message.sequenceNumber < 1) {
    throw new PersistenceDataError('Message sequenceNumber must be a positive safe integer');
  }
}

function one(result: SqliteRunResult, message: string): void {
  if (result.changes !== 1 && result.changes !== 1n) throw new PersistenceDataError(message);
}

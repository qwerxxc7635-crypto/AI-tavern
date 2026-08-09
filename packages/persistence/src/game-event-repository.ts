import {
  GAME_EVENT_TYPES,
  actionOptionId,
  adventureId,
  campaignId,
  clueId,
  createNpcRelationship,
  gameEventId,
  generationRecordId,
  isoTimestamp,
  itemId,
  npcId,
  playerCharacterId,
  questId,
  schemaVersion,
  tavernId,
  tavernChangeId,
  turnId,
  worldClockId,
  worldFactId,
  type GameEvent,
  type GameEventType,
} from '@ember-tavern/contracts';

import { PersistenceDataError } from './campaign-repository.js';
import { parseStoredDiceResult } from './dice-result-validation.js';
import {
  parseJson,
  requireArray,
  requireEnum,
  requireNullableString,
  requireNumber,
  requireRecord,
  requireString,
  requireStringArray,
} from './persistence-validation.js';
import type { SqliteDatabase } from './sqlite-port.js';

const ACTION_KINDS = ['SUGGESTED', 'FREEFORM', 'USE_ITEM', 'EXIT_ADVENTURE'] as const;
const OUTCOMES = ['SUCCESS', 'PARTIAL_SUCCESS', 'FAILURE'] as const;

export class GameEventRepository {
  public constructor(private readonly database: SqliteDatabase) {}

  public append(input: GameEvent): void {
    const event = parseGameEvent(input);
    this.database
      .prepare(
        `INSERT INTO game_events (
           id, campaign_id, schema_version, type, payload_json, occurred_at
         ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        event.id,
        event.campaignId,
        event.schemaVersion,
        event.type,
        JSON.stringify(event.payload),
        event.occurredAt,
      );
  }

  public get(id: GameEvent['id']): GameEvent | null {
    const row = this.database.prepare('SELECT * FROM game_events WHERE id = ?').get(id);
    return row === undefined ? null : mapEventRow(row);
  }

  public list(campaign: GameEvent['campaignId']): readonly GameEvent[] {
    return Object.freeze(
      this.database
        .prepare(
          `SELECT * FROM game_events
           WHERE campaign_id = ?
           ORDER BY occurred_at, id`,
        )
        .all(campaign)
        .map(mapEventRow),
    );
  }
}

function mapEventRow(value: unknown): GameEvent {
  const row = requireRecord(value, 'GameEvent row');
  return parseGameEvent({
    id: row['id'],
    campaignId: row['campaign_id'],
    schemaVersion: row['schema_version'],
    type: row['type'],
    payload: parseJson(row['payload_json'], 'payload_json'),
    occurredAt: row['occurred_at'],
  });
}

function parseGameEvent(value: unknown): GameEvent {
  try {
    const event = requireRecord(value, 'GameEvent');
    const type = requireEnum(GAME_EVENT_TYPES, event['type'], 'GameEvent.type');
    const common = {
      id: gameEventId(requireString(event['id'], 'GameEvent.id')),
      campaignId: campaignId(requireString(event['campaignId'], 'GameEvent.campaignId')),
      schemaVersion: schemaVersion(
        requireNumber(event['schemaVersion'], 'GameEvent.schemaVersion'),
      ),
      occurredAt: isoTimestamp(requireString(event['occurredAt'], 'GameEvent.occurredAt')),
    };
    const payload = requireRecord(event['payload'], 'GameEvent.payload');
    return eventForType(common, type, payload);
  } catch (error) {
    if (error instanceof PersistenceDataError) throw error;
    throw new PersistenceDataError('GameEvent is invalid', { cause: error });
  }
}

function eventForType(
  common: Pick<GameEvent, 'id' | 'campaignId' | 'schemaVersion' | 'occurredAt'>,
  type: GameEventType,
  payload: Record<string, unknown>,
): GameEvent {
  switch (type) {
    case 'WORLD_CREATED':
      return Object.freeze({
        ...common,
        type,
        payload: Object.freeze({ worldName: requireString(payload['worldName'], 'worldName') }),
      });
    case 'CHARACTER_CREATED':
      return Object.freeze({
        ...common,
        type,
        payload: Object.freeze({
          playerCharacterId: playerCharacterId(
            requireString(payload['playerCharacterId'], 'playerCharacterId'),
          ),
        }),
      });
    case 'NPC_CREATED':
      return Object.freeze({
        ...common,
        type,
        payload: Object.freeze({
          npcId: npcId(requireString(payload['npcId'], 'npcId')),
          tavernId: tavernId(requireString(payload['tavernId'], 'tavernId')),
        }),
      });
    case 'QUEST_ACCEPTED':
      return Object.freeze({
        ...common,
        type,
        payload: Object.freeze({ questId: questId(requireString(payload['questId'], 'questId')) }),
      });
    case 'PLAYER_ACTION_SUBMITTED':
      return Object.freeze({
        ...common,
        type,
        payload: Object.freeze({
          adventureId: adventureId(requireString(payload['adventureId'], 'adventureId')),
          turnId: turnId(requireString(payload['turnId'], 'turnId')),
          action: parseAction(payload['action']),
        }),
      });
    case 'DICE_ROLLED':
      return Object.freeze({
        ...common,
        type,
        payload: Object.freeze({
          adventureId: adventureId(requireString(payload['adventureId'], 'adventureId')),
          turnId: turnId(requireString(payload['turnId'], 'turnId')),
          result: parseDiceResult(payload['result']),
        }),
      });
    case 'FACT_DISCOVERED':
      return Object.freeze({
        ...common,
        type,
        payload: Object.freeze({
          worldFactId: worldFactId(requireString(payload['worldFactId'], 'worldFactId')),
          playerCharacterId: playerCharacterId(
            requireString(payload['playerCharacterId'], 'playerCharacterId'),
          ),
        }),
      });
    case 'ITEM_ACQUIRED': {
      const source = requireNullableString(payload['sourceAdventureId'], 'sourceAdventureId');
      return Object.freeze({
        ...common,
        type,
        payload: Object.freeze({
          itemId: itemId(requireString(payload['itemId'], 'itemId')),
          playerCharacterId: playerCharacterId(
            requireString(payload['playerCharacterId'], 'playerCharacterId'),
          ),
          sourceAdventureId: source === null ? null : adventureId(source),
        }),
      });
    }
    case 'RELATIONSHIP_CHANGED':
      return Object.freeze({
        ...common,
        type,
        payload: Object.freeze({
          before: parseRelationship(payload['before']),
          after: parseRelationship(payload['after']),
        }),
      });
    case 'WORLD_CLOCK_ADVANCED':
      return Object.freeze({
        ...common,
        type,
        payload: Object.freeze({
          worldClockId: worldClockId(requireString(payload['worldClockId'], 'worldClockId')),
          previous: requireNumber(payload['previous'], 'previous'),
          current: requireNumber(payload['current'], 'current'),
          triggeredStageThresholds: Object.freeze(
            requireArray(payload['triggeredStageThresholds'], 'triggeredStageThresholds').map(
              (entry, index) => requireNumber(entry, `triggeredStageThresholds[${index}]`),
            ),
          ),
        }),
      });
    case 'ADVENTURE_COMPLETED': {
      const ending = requireRecord(payload['ending'], 'ending');
      return Object.freeze({
        ...common,
        type,
        payload: Object.freeze({
          adventureId: adventureId(requireString(payload['adventureId'], 'adventureId')),
          questId: questId(requireString(payload['questId'], 'questId')),
          ending: Object.freeze({
            adventureId: adventureId(requireString(ending['adventureId'], 'ending.adventureId')),
            outcome: requireEnum(OUTCOMES, ending['outcome'], 'ending.outcome'),
            summary: requireString(ending['summary'], 'ending.summary'),
            keyDecisions: requireStringArray(ending['keyDecisions'], 'ending.keyDecisions'),
            unresolvedThreads: requireStringArray(
              ending['unresolvedThreads'],
              'ending.unresolvedThreads',
            ),
            nextDirections: requireStringArray(ending['nextDirections'], 'ending.nextDirections'),
            unresolvedClueIds: Object.freeze(
              requireArray(ending['unresolvedClueIds'], 'ending.unresolvedClueIds').map(
                (entry, index) =>
                  clueId(requireString(entry, `ending.unresolvedClueIds[${index}]`)),
              ),
            ),
            participantNpcIds: Object.freeze(
              requireArray(ending['participantNpcIds'], 'ending.participantNpcIds').map(
                (entry, index) => npcId(requireString(entry, `ending.participantNpcIds[${index}]`)),
              ),
            ),
            acquiredItemIds: Object.freeze(
              requireArray(ending['acquiredItemIds'], 'ending.acquiredItemIds').map(
                (entry, index) => itemId(requireString(entry, `ending.acquiredItemIds[${index}]`)),
              ),
            ),
            worldFactIds: Object.freeze(
              requireArray(ending['worldFactIds'], 'ending.worldFactIds').map((entry, index) =>
                worldFactId(requireString(entry, `ending.worldFactIds[${index}]`)),
              ),
            ),
            tavernChangeId: tavernChangeId(
              requireString(ending['tavernChangeId'], 'ending.tavernChangeId'),
            ),
            summaryGenerationRecordId: generationRecordId(
              requireString(
                ending['summaryGenerationRecordId'],
                'ending.summaryGenerationRecordId',
              ),
            ),
            worldEventGenerationRecordId: generationRecordId(
              requireString(
                ending['worldEventGenerationRecordId'],
                'ending.worldEventGenerationRecordId',
              ),
            ),
            completedAt: isoTimestamp(requireString(ending['completedAt'], 'ending.completedAt')),
          }),
        }),
      });
    }
    case 'MODEL_SWITCHED':
      return Object.freeze({
        ...common,
        type,
        payload: Object.freeze({
          previous: parseNullableModel(payload['previous']),
          current: parseModel(payload['current']),
        }),
      });
  }
}

function parseAction(value: unknown) {
  const action = requireRecord(value, 'action');
  const kind = requireEnum(ACTION_KINDS, action['kind'], 'action.kind');
  const mode =
    action['mode'] === undefined
      ? Object.freeze({})
      : Object.freeze({
          mode: requireEnum(
            ['ACTION', 'DIALOGUE', 'OBSERVE'] as const,
            action['mode'],
            'action.mode',
          ),
        });
  switch (kind) {
    case 'SUGGESTED':
      return Object.freeze({
        kind,
        ...mode,
        optionId: actionOptionId(requireString(action['optionId'], 'action.optionId')),
        text: requireString(action['text'], 'action.text'),
      });
    case 'FREEFORM':
      return Object.freeze({ kind, ...mode, text: requireString(action['text'], 'action.text') });
    case 'USE_ITEM':
      return Object.freeze({
        kind,
        ...mode,
        itemId: itemId(requireString(action['itemId'], 'action.itemId')),
        intent: requireString(action['intent'], 'action.intent'),
      });
    case 'EXIT_ADVENTURE':
      return Object.freeze({
        kind,
        ...mode,
        reason: requireString(action['reason'], 'action.reason'),
      });
  }
}

function parseDiceResult(value: unknown) {
  return parseStoredDiceResult(value, 'result');
}

function parseRelationship(value: unknown) {
  const relationship = requireRecord(value, 'relationship');
  return createNpcRelationship({
    npcId: npcId(requireString(relationship['npcId'], 'relationship.npcId')),
    playerCharacterId: playerCharacterId(
      requireString(relationship['playerCharacterId'], 'relationship.playerCharacterId'),
    ),
    trust: requireNumber(relationship['trust'], 'relationship.trust'),
    closeness: requireNumber(relationship['closeness'], 'relationship.closeness'),
    awe: requireNumber(relationship['awe'], 'relationship.awe'),
    obligation: requireNumber(relationship['obligation'], 'relationship.obligation'),
  });
}

function parseModel(value: unknown) {
  const model = requireRecord(value, 'model');
  return Object.freeze({
    providerKey: requireString(model['providerKey'], 'model.providerKey'),
    modelName: requireString(model['modelName'], 'model.modelName'),
  });
}

function parseNullableModel(value: unknown) {
  return value === null ? null : parseModel(value);
}

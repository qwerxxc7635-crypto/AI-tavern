import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  GAME_EVENT_TYPES,
  adventureId,
  campaignId,
  checkRequestId,
  gameEventId,
  isoTimestamp,
  itemId,
  npcId,
  playerCharacterId,
  questId,
  schemaVersion,
  tavernId,
  turnId,
  worldClockId,
  worldFactId,
  type GameEvent,
  type GameEventOf,
} from './index.js';

const common = {
  id: gameEventId('event-1'),
  campaignId: campaignId('campaign-1'),
  schemaVersion: schemaVersion(1),
  occurredAt: isoTimestamp('2026-07-30T15:00:00.000Z'),
};
const character = playerCharacterId('character-1');
const adventure = adventureId('adventure-1');
const quest = questId('quest-1');
const turn = turnId('turn-1');
const npc = npcId('npc-1');

const events: readonly GameEvent[] = [
  { ...common, type: 'WORLD_CREATED', payload: { worldName: 'The Ember Coast' } },
  { ...common, type: 'CHARACTER_CREATED', payload: { playerCharacterId: character } },
  {
    ...common,
    type: 'NPC_CREATED',
    payload: { npcId: npc, tavernId: tavernId('tavern-1') },
  },
  { ...common, type: 'QUEST_ACCEPTED', payload: { questId: quest } },
  {
    ...common,
    type: 'PLAYER_ACTION_SUBMITTED',
    payload: {
      adventureId: adventure,
      turnId: turn,
      action: { kind: 'FREEFORM', text: 'Inspect the locked door' },
    },
  },
  {
    ...common,
    type: 'DICE_ROLLED',
    payload: {
      adventureId: adventure,
      turnId: turn,
      result: {
        checkRequestId: checkRequestId('check-1'),
        d20: 12,
        attributeModifier: 2,
        equipmentModifier: 0,
        statusModifier: 0,
        total: 14,
        difficulty: 14,
        success: true,
      },
    },
  },
  {
    ...common,
    type: 'FACT_DISCOVERED',
    payload: { worldFactId: worldFactId('fact-1'), playerCharacterId: character },
  },
  {
    ...common,
    type: 'ITEM_ACQUIRED',
    payload: {
      itemId: itemId('item-1'),
      playerCharacterId: character,
      sourceAdventureId: adventure,
    },
  },
  {
    ...common,
    type: 'RELATIONSHIP_CHANGED',
    payload: {
      before: {
        npcId: npc,
        playerCharacterId: character,
        trust: 0,
        closeness: 0,
        awe: 0,
        obligation: 0,
      },
      after: {
        npcId: npc,
        playerCharacterId: character,
        trust: 1,
        closeness: 0,
        awe: 0,
        obligation: 0,
      },
    },
  },
  {
    ...common,
    type: 'WORLD_CLOCK_ADVANCED',
    payload: {
      worldClockId: worldClockId('clock-1'),
      previous: 1,
      current: 2,
      triggeredStageThresholds: [2],
    },
  },
  {
    ...common,
    type: 'ADVENTURE_COMPLETED',
    payload: {
      adventureId: adventure,
      questId: quest,
      ending: {
        adventureId: adventure,
        outcome: 'SUCCESS',
        summary: 'The trade route is safe again.',
        unresolvedClueIds: [],
        completedAt: common.occurredAt,
      },
    },
  },
  {
    ...common,
    type: 'MODEL_SWITCHED',
    payload: {
      previous: { providerKey: 'local', modelName: 'model-a' },
      current: { providerKey: 'cloud', modelName: 'model-b' },
    },
  },
];

describe('GameEvent protocol', () => {
  it('defines every event listed by the event-log specification', () => {
    expect(events.map((event) => event.type)).toEqual(GAME_EVENT_TYPES);
  });

  it('keeps each discriminant paired with its exact payload', () => {
    const event: GameEvent | undefined = events[5];
    if (event === undefined || event.type !== 'DICE_ROLLED') {
      throw new Error('Expected a dice event fixture');
    }
    expect(event.payload.result.total).toBe(14);
    expectTypeOf(event).toEqualTypeOf<GameEventOf<'DICE_ROLLED'>>();
  });

  it('preserves common audit metadata on every event', () => {
    for (const event of events) {
      expect(event).toMatchObject(common);
    }
  });
});

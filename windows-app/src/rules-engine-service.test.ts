import {
  campaignId,
  idempotencyKey,
  isoTimestamp,
  playerCharacterId,
  rulesEventId,
  schemaVersion,
  type CharacterRuleState,
} from '@ember-tavern/contracts';
import { describe, expect, it, vi } from 'vitest';

import type { RulesEngineGateway } from './rules-engine-service.js';

const campaign = campaignId('campaign-native-rules');
const character = playerCharacterId('character-native-rules');
const at = isoTimestamp('2026-08-14T06:00:00.000Z');

describe('Windows Rules gateway contract', () => {
  it('keeps local command and revision data explicit at the native boundary', async () => {
    const state: CharacterRuleState = Object.freeze({
      schemaVersion: schemaVersion(1),
      campaignId: campaign,
      playerCharacterId: character,
      baseAttributes: { physique: 3, agility: 2, knowledge: 3, charisma: 2 },
      skills: [],
      hitPoints: { current: 10, max: 10 },
      statuses: [],
      equippedItemIds: [],
      money: 0,
      gameTimeMinutes: 0,
      traitModifiers: [],
      resources: [],
      revision: 1,
      updatedAt: at,
    });
    const after: CharacterRuleState = Object.freeze({
      ...state,
      money: 5,
      revision: 2,
    });
    const apply = vi.fn(async () => ({
      status: 'COMMITTED' as const,
      eventId: 'rules-event-native',
      idempotencyKey: 'rules-key-native',
      beforeRevision: 1,
      afterRevision: 2,
      state: after,
      questBeforeStatus: null,
      questAfterStatus: null,
      occurredAt: at,
    }));
    const gateway: RulesEngineGateway = { load: vi.fn(async () => state), apply };
    await expect(gateway.load(character)).resolves.toEqual(state);
    await expect(
      gateway.apply({
        eventId: rulesEventId('rules-event-native'),
        idempotencyKey: idempotencyKey('rules-key-native'),
        expectedRevision: 1,
        occurredAt: at,
        command: {
          kind: 'CHANGE_MONEY',
          campaignId: campaign,
          playerCharacterId: character,
          authority: 'PLAYER_ACTION',
          delta: 5,
        },
      }),
    ).resolves.toMatchObject({ status: 'COMMITTED', afterRevision: 2 });
    expect(apply).toHaveBeenCalledOnce();
  });
});

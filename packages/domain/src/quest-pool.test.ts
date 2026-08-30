import { describe, expect, it } from 'vitest';

import { QUEST_STATUSES } from '@ember-tavern/contracts';
import {
  QUEST_TERMINAL_STATUSES,
  RULE_QUEST_TRANSITIONS,
  assertQuestPoolTransition,
} from './index.js';

describe('quest pool state machine', () => {
  it('covers every status and accepts every declared system transition', () => {
    expect(Object.keys(RULE_QUEST_TRANSITIONS)).toEqual(QUEST_STATUSES);
    for (const before of QUEST_STATUSES) {
      for (const after of RULE_QUEST_TRANSITIONS[before]) {
        expect(() => assertQuestPoolTransition(before, after, 'SYSTEM')).not.toThrow();
      }
    }
  });

  it('lets player intervention activate a visible opportunity without acceptance', () => {
    for (const before of ['DISCOVERED', 'AVAILABLE', 'ACCEPTED', 'UPDATED'] as const) {
      expect(() =>
        assertQuestPoolTransition(before, 'ACTIVE', 'PLAYER_INTERVENTION'),
      ).not.toThrow();
    }
    expect(() => assertQuestPoolTransition('HIDDEN', 'ACTIVE', 'PLAYER_INTERVENTION')).toThrowError(
      expect.objectContaining({ code: 'SOURCE_FORBIDDEN' }),
    );
  });

  it('keeps every terminal status immutable', () => {
    for (const status of QUEST_TERMINAL_STATUSES) {
      for (const target of QUEST_STATUSES.filter((candidate) => candidate !== status)) {
        expect(() => assertQuestPoolTransition(status, target, 'SYSTEM')).toThrowError(
          expect.objectContaining({ code: 'TERMINAL_IMMUTABLE' }),
        );
      }
    }
  });

  it('rejects all undeclared transition pairs', () => {
    for (const before of QUEST_STATUSES) {
      for (const after of QUEST_STATUSES) {
        if (before === after || RULE_QUEST_TRANSITIONS[before].includes(after)) continue;
        expect(() => assertQuestPoolTransition(before, after, 'SYSTEM')).toThrow();
      }
    }
  });
});

import { describe, expect, it } from 'vitest';

import {
  DIRECTOR_BUDGET_LIMITS,
  capacityReason,
  compareDirectorBudgetEntries,
  directorBudgetCategory,
  directorCooldownMinutes,
  directorGameDay,
} from './director-budget.js';

describe('Director Budget policy', () => {
  it('classifies every proposal into an explicit bounded or maintenance category', () => {
    expect(directorBudgetCategory('QUEST_EXPIRE')).toBe('MAINTENANCE');
    expect(directorBudgetCategory('OPPORTUNITY')).toBe('DAILY_EVENT');
    expect(directorBudgetCategory('PRESSURE')).toBe('URGENT_EVENT');
    expect(directorBudgetCategory('NPC_ACTION')).toBe('NPC_PROACTIVE');
    expect(directorBudgetCategory('FACTION_ACTION')).toBe('BACKGROUND_CHANGE');
    expect(directorCooldownMinutes('QUEST_UPDATE')).toBe(0);
    expect(directorCooldownMinutes('OPPORTUNITY')).toBe(720);
  });

  it('uses the committed Rules clock for day rollover and bounded capacity', () => {
    expect(directorGameDay(1_439)).toBe(0);
    expect(directorGameDay(1_440)).toBe(1);
    expect(
      capacityReason('URGENT_EVENT', {
        dailyEvents: DIRECTOR_BUDGET_LIMITS.dailyEvents,
        urgentEvents: 0,
        npcProactive: 0,
        backgroundChanges: 0,
      }),
    ).toBe('DAILY_LIMIT');
  });

  it('ages deferred low priority work until it outranks fresh high priority work', () => {
    const oldLow = { urgency: 'LOW', requestedGameTime: 0, runId: 'old', ordinal: 1 } as const;
    const freshHigh = {
      urgency: 'HIGH',
      requestedGameTime: 4_320,
      runId: 'fresh',
      ordinal: 1,
    } as const;
    expect(compareDirectorBudgetEntries(oldLow, freshHigh, 4_320)).toBeLessThan(0);
  });
});

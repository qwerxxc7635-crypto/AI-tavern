import { describe, expect, it } from 'vitest';

import { evaluateWorldDirector, type EvaluateWorldDirectorInput } from './world-director.js';

const at = '2026-08-24T00:00:00.000Z';

describe('evaluateWorldDirector', () => {
  it('schedules one local opportunity when the world is quiet and has no open Quest', () => {
    const result = evaluateWorldDirector(input());
    expect(result).toMatchObject({
      pace: 'QUIET',
      pressureScore: 0,
      signals: { openQuestCount: 0 },
      proposals: [
        {
          rank: 1,
          kind: 'OPPORTUNITY',
          targetEntityIds: ['location-current'],
          route: 'GENERATOR',
        },
      ],
    });
  });

  it('foreshadows a two-step clock and proposes pressure at one step', () => {
    const result = evaluateWorldDirector(
      input({
        clocks: [
          { id: 'clock-two', current: 2, max: 4 },
          { id: 'clock-one', current: 3, max: 4 },
        ],
      }),
    );
    expect(result.pace).toBe('BALANCED');
    expect(result.proposals.map(({ kind, targetEntityIds }) => [kind, targetEntityIds[0]])).toEqual(
      [
        ['PRESSURE', 'clock-one'],
        ['FORESHADOW', 'clock-two'],
      ],
    );
  });

  it('routes stale Quest expiry through Rules without changing the Quest', () => {
    const result = evaluateWorldDirector(
      input({
        quests: [quest('quest-stale', 'AVAILABLE', 3)],
      }),
    );
    expect(result.signals.staleQuestIds).toEqual(['quest-stale']);
    expect(result.proposals[0]).toMatchObject({
      kind: 'QUEST_EXPIRE',
      targetEntityIds: ['quest-stale'],
      route: 'RULES',
    });
  });

  it('suppresses new content under overload while retaining convergent expiry proposals', () => {
    const result = evaluateWorldDirector(
      input({
        quests: [
          quest('quest-active-1', 'ACTIVE'),
          quest('quest-active-2', 'ACTIVE'),
          quest('quest-blocked-1', 'BLOCKED'),
          quest('quest-blocked-2', 'BLOCKED'),
          quest('quest-stale', 'AVAILABLE', 3),
        ],
        clocks: [{ id: 'clock-urgent', current: 4, max: 4 }],
        factions: [
          {
            id: 'faction-hostile',
            materialization: 'ACTIVE',
            playerRelation: 'HOSTILE',
            currentAction: 'Close the harbor road.',
          },
        ],
      }),
    );
    expect(result.pace).toBe('OVERLOADED');
    expect(result.proposals.map(({ kind }) => kind)).toEqual(['QUEST_EXPIRE']);
    expect(result.suppressed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'PRESSURE', reason: 'OVERLOAD_GUARD' }),
        expect.objectContaining({ kind: 'FACTION_ACTION', reason: 'OVERLOAD_GUARD' }),
      ]),
    );
  });

  it('uses stable ordering independent of input row order', () => {
    const first = evaluateWorldDirector(
      input({
        clocks: [
          { id: 'clock-b', current: 3, max: 4 },
          { id: 'clock-a', current: 3, max: 4 },
        ],
      }),
    );
    const quiet = evaluateWorldDirector(input());
    const reversed = evaluateWorldDirector(
      input({
        clocks: [
          { id: 'clock-a', current: 3, max: 4 },
          { id: 'clock-b', current: 3, max: 4 },
        ],
      }),
    );
    expect(first).toEqual(reversed);
    expect(quiet.proposals[0]?.kind).toBe('OPPORTUNITY');
  });
});

function input(overrides: Partial<EvaluateWorldDirectorInput> = {}): EvaluateWorldDirectorInput {
  return {
    campaignId: 'campaign-director',
    campaignState: 'TAVERN',
    currentLocationId: 'location-current',
    quests: [],
    clocks: [],
    factions: [],
    recentTransitions: [],
    recentEvents: [],
    ...overrides,
  };
}

function quest(id: string, status: string, worldClockAdvancesSinceCreation = 0) {
  return {
    id,
    status,
    createdAt: '2026-08-20T00:00:00.000Z',
    updatedAt: at,
    worldClockAdvancesSinceCreation,
  };
}

import {
  adventureId,
  campaignId,
  factionId,
  isoTimestamp,
  locationId,
  npcId,
  playerCharacterId,
  questId,
  schemaVersion,
  worldClockId,
  worldFactId,
  type NpcRelationship,
  type Quest,
  type WorldBible,
} from '@ember-tavern/contracts';
import { describe, expect, it } from 'vitest';

import {
  DomainPatchValidationError,
  validateDomainStatePatches,
  type DomainPatchValidationContext,
  type WorldClock,
} from './index.js';

const campaign = campaignId('campaign-patches');
const now = isoTimestamp('2026-07-31T00:55:00.000Z');
const questIdentifier = questId('quest-patches');
const npcIdentifier = npcId('npc-patches');
const playerIdentifier = playerCharacterId('player-patches');
const clockIdentifier = worldClockId('clock-patches');

describe('AI domain state patch validation', () => {
  it('validates quest, relationship, authorized reward, append-only fact and clock in order', () => {
    const patches = validateDomainStatePatches(
      [
        proposal('QUEST', questIdentifier, { status: 'COMPLETED' }),
        proposal('RELATIONSHIP', npcIdentifier, { trust: 1 }),
        proposal('ITEM_REWARD', null, {
          questId: questIdentifier,
          name: 'Beacon Compass',
          description: 'A brass compass warmed by the restored flame.',
          rewardTier: 'NOTABLE',
        }),
        proposal('FACT', null, { statement: 'The Ash Harbor beacon burns again.' }),
        proposal('CLOCK', clockIdentifier, { amount: 1 }),
      ],
      context(),
    );

    expect(patches.map(({ kind }) => kind)).toEqual([
      'QUEST',
      'RELATIONSHIP',
      'ITEM_REWARD',
      'FACT',
      'CLOCK',
    ]);
    expect(patches[0]).toMatchObject({ quest: { status: 'COMPLETED' } });
    expect(patches[1]).toMatchObject({ relationship: { trust: 1 } });
    expect(patches[2]).toMatchObject({
      rewardTier: 'NOTABLE',
      authorization: { effect: { kind: 'CHECK_MODIFIER', modifier: 1 } },
    });
    expect(patches[3]).toMatchObject({ factKind: 'DEVELOPING_FACT' });
    expect(patches[4]).toMatchObject({ result: { clock: { current: 2 } } });
  });

  it('rejects direct player attribute changes and attribute fields hidden in rewards', () => {
    expectValidationError(
      () =>
        validateDomainStatePatches(
          [proposal('PLAYER_ATTRIBUTE', playerIdentifier, { knowledge: 5 })],
          context(),
        ),
      'ATTRIBUTE_CHANGE_FORBIDDEN',
    );
    expectValidationError(
      () =>
        validateDomainStatePatches(
          [
            proposal('ITEM_REWARD', null, {
              questId: questIdentifier,
              name: 'Forbidden Tome',
              description: 'Must not set attributes.',
              rewardTier: 'NOTABLE',
              attributeModifier: 5,
            }),
          ],
          context({ questStatus: 'COMPLETED' }),
        ),
      'ATTRIBUTE_CHANGE_FORBIDDEN',
    );
  });

  it('rejects modifying or creating locked rules', () => {
    expectValidationError(
      () =>
        validateDomainStatePatches(
          [
            proposal('FACT', worldFactId('fact-locked-rule'), {
              statement: 'Magic no longer leaves a trace.',
            }),
          ],
          context(),
        ),
      'LOCKED_RULE',
    );
    expectValidationError(
      () =>
        validateDomainStatePatches(
          [
            proposal('FACT', null, {
              kind: 'LOCKED_RULE',
              statement: 'Magic no longer leaves a trace.',
            }),
          ],
          context(),
        ),
      'LOCKED_RULE',
    );
  });

  it('rejects a high-tier item without matching quest authorization', () => {
    expectValidationError(
      () =>
        validateDomainStatePatches(
          [
            proposal('ITEM_REWARD', null, {
              questId: questIdentifier,
              name: 'Legendary Crown',
              description: 'An unjustified high-tier reward.',
              rewardTier: 'LEGENDARY',
            }),
          ],
          context({ questStatus: 'COMPLETED' }),
        ),
      'REWARD_TIER_EXCEEDED',
    );
  });

  it('rejects skipped quest states, multi-step relationships and clock jumps', () => {
    expectValidationError(
      () =>
        validateDomainStatePatches(
          [proposal('QUEST', questIdentifier, { status: 'COMPLETED' })],
          context({ questStatus: 'AVAILABLE' }),
        ),
      'ILLEGAL_QUEST_TRANSITION',
    );
    expectValidationError(
      () =>
        validateDomainStatePatches(
          [proposal('RELATIONSHIP', npcIdentifier, { trust: 2 })],
          context(),
        ),
      'RELATIONSHIP_LIMIT',
    );
    expectValidationError(
      () =>
        validateDomainStatePatches([proposal('CLOCK', clockIdentifier, { amount: 2 })], context()),
      'CLOCK_LIMIT',
    );
  });
});

function context(
  options: Readonly<{ questStatus?: Quest['status'] }> = {},
): DomainPatchValidationContext {
  return {
    campaignId: campaign,
    world: world(),
    quests: [quest(options.questStatus ?? 'ACTIVE')],
    relationships: [relationship()],
    clocks: [clock()],
    rewardAuthorizations: [
      {
        questId: questIdentifier,
        adventureId: adventureId('adventure-patches'),
        ownerCharacterId: playerIdentifier,
        effect: { kind: 'CHECK_MODIFIER', attribute: 'knowledge', modifier: 1 },
      },
    ],
  };
}

function quest(status: Quest['status']): Quest {
  return {
    id: questIdentifier,
    campaignId: campaign,
    publisherNpcId: npcIdentifier,
    content: {
      title: 'The Fading Beacon',
      summary: 'Restore the lighthouse.',
      objective: 'Relight the beacon.',
      failureCost: 'Ships remain trapped.',
    },
    status,
    risk: 'MODERATE',
    recommendedAttributes: ['knowledge'],
    expectedTurns: { min: 8, max: 12 },
    rewardTier: 'NOTABLE',
    relatedNpcIds: [npcIdentifier],
    relatedFactIds: [],
    createdAt: now,
    updatedAt: now,
  };
}

function relationship(): NpcRelationship {
  return {
    npcId: npcIdentifier,
    playerCharacterId: playerIdentifier,
    trust: 0,
    closeness: 0,
    awe: 0,
    obligation: 0,
  };
}

function clock(): WorldClock {
  return {
    id: clockIdentifier,
    campaignId: campaign,
    name: 'Storm',
    current: 1,
    max: 6,
    stages: [{ at: 2, title: 'Outer road floods' }],
  };
}

function world(): WorldBible {
  return {
    campaignId: campaign,
    schemaVersion: schemaVersion(1),
    name: 'Ember Coast',
    currentRegion: 'Ash Harbor',
    summary: 'A storm-bound coast.',
    coreConflict: 'The lighthouse fire is fading.',
    technologyLevel: 'Late medieval',
    powerRules: ['Magic always leaves a warm trace.'],
    factions: [
      {
        id: factionId('faction-lantern'),
        name: 'Lantern Guild',
        description: 'Beacon keepers.',
        goals: ['Restore the lighthouse.'],
        relations: [],
      },
    ],
    locations: [
      {
        id: locationId('location-harbor'),
        name: 'Ash Harbor',
        description: 'A sheltered port.',
        parentLocationId: null,
        factionIds: [factionId('faction-lantern')],
      },
    ],
    narrativeStyle: 'Grounded heroic fantasy.',
    forbiddenElements: [],
    tavernReason: 'Travelers wait for safe tides.',
    storyHooks: ['The beacon dims at moonrise.'],
    lockedFields: ['powerRules'],
    createdAt: now,
    updatedAt: now,
  };
}

function proposal(
  kind: string,
  targetId: string | null,
  payload: Readonly<Record<string, unknown>>,
) {
  return {
    kind,
    targetId,
    rationale: 'Validated test proposal.',
    payload,
  };
}

function expectValidationError(run: () => unknown, code: string): void {
  try {
    run();
    throw new Error(`Expected ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(DomainPatchValidationError);
    expect(error).toMatchObject({ code });
  }
}

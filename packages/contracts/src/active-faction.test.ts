import { describe, expect, it } from 'vitest';

import {
  ActiveFactionContractError,
  createActiveFactionProfile,
  parseActiveFactionProfile,
} from './index.js';

const evidence = {
  technology: 'Late medieval',
  society: 'Guild towns',
  politics: 'Harbor councils',
  economy: 'Coin and barter',
};

describe('active faction contract', () => {
  it('round-trips all eight active fields with world and generation authority', () => {
    const profile = active();
    expect(parseActiveFactionProfile(JSON.parse(JSON.stringify(profile)))).toEqual(profile);
    expect(profile).toMatchObject({
      goal: 'Restore the beacon.',
      resources: ['Harbor patrols'],
      leadership: ['The Lantern Council'],
      enemyFactionIds: ['faction-reef'],
      allyFactionIds: [],
      territoryLocationIds: ['location-harbor'],
      currentAction: 'Reopen the northern road.',
      playerRelation: 'NEUTRAL',
    });
  });

  it('allows a provenance-free outline projection but not an incomplete active faction', () => {
    const outline = createActiveFactionProfile({
      ...active(),
      materialization: 'OUTLINE',
      resources: [],
      leadership: [],
      currentAction: null,
      generationRecordId: null,
      revision: 1,
    });
    expect(outline.materialization).toBe('OUTLINE');
    expect(() => createActiveFactionProfile({ ...outline, materialization: 'ACTIVE' })).toThrow(
      ActiveFactionContractError,
    );
  });

  it('rejects self, overlapping, duplicate and unknown profile fields', () => {
    expect(() =>
      createActiveFactionProfile({ ...active(), allyFactionIds: ['faction-lantern'] }),
    ).toThrow(ActiveFactionContractError);
    expect(() =>
      createActiveFactionProfile({
        ...active(),
        allyFactionIds: ['faction-reef'],
        enemyFactionIds: ['faction-reef'],
      }),
    ).toThrow(ActiveFactionContractError);
    expect(() =>
      createActiveFactionProfile({ ...active(), resources: ['Coin', ' coin '] }),
    ).toThrow(ActiveFactionContractError);
    expect(() => parseActiveFactionProfile({ ...active(), hiddenBudget: 99 })).toThrow(
      ActiveFactionContractError,
    );
  });
});

function active() {
  return createActiveFactionProfile({
    schemaVersion: 1,
    id: 'faction-lantern',
    campaignId: 'campaign-active-faction',
    constitutionRevision: 1,
    materialization: 'ACTIVE',
    name: 'Lantern Guild',
    description: 'Beacon keepers.',
    goal: 'Restore the beacon.',
    resources: ['Harbor patrols'],
    leadership: ['The Lantern Council'],
    enemyFactionIds: ['faction-reef'],
    allyFactionIds: [],
    territoryLocationIds: ['location-harbor'],
    currentAction: 'Reopen the northern road.',
    playerRelation: 'NEUTRAL',
    constitutionEvidence: evidence,
    generationRecordId: 'generation-faction-active',
    revision: 2,
    createdAt: '2026-08-20T10:00:00.000Z',
    updatedAt: '2026-08-20T11:00:00.000Z',
  });
}

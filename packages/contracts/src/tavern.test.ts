import { describe, expect, it } from 'vitest';

import {
  campaignId,
  createNpcKnowledge,
  createNpcRelationship,
  isoTimestamp,
  locationId,
  npcId,
  npcMemoryId,
  playerCharacterId,
  tavernChangeId,
  tavernId,
  worldFactId,
  RelationshipValueError,
  type NpcProfile,
  type Tavern,
  type TavernChange,
  type TemporaryVisitor,
} from './index.js';

const npc = npcId('npc-owner');
const player = playerCharacterId('character-1');

describe('NPC relationship values', () => {
  it.each([-5, 0, 5])('accepts boundary value %s in every dimension', (value) => {
    expect(
      createNpcRelationship({
        npcId: npc,
        playerCharacterId: player,
        trust: value,
        closeness: value,
        awe: value,
        obligation: value,
      }),
    ).toMatchObject({ trust: value, closeness: value, awe: value, obligation: value });
  });

  it.each([-6, 6, 1.5])('rejects invalid relationship value %s', (value) => {
    expect(() =>
      createNpcRelationship({
        npcId: npc,
        playerCharacterId: player,
        trust: value,
        closeness: 0,
        awe: 0,
        obligation: 0,
      }),
    ).toThrow(RelationshipValueError);
  });
});

describe('NPC knowledge isolation', () => {
  it('copies and freezes each NPC knowledge scope independently', () => {
    const sharedSource = [worldFactId('fact-public')];
    const first = createNpcKnowledge({
      npcId: npcId('npc-1'),
      knownFactIds: sharedSource,
      suspectedFactIds: [],
      falseBeliefFactIds: [],
      excludedSecretFactIds: [worldFactId('fact-secret-1')],
    });
    const second = createNpcKnowledge({
      npcId: npcId('npc-2'),
      knownFactIds: sharedSource,
      suspectedFactIds: [worldFactId('fact-suspected')],
      falseBeliefFactIds: [worldFactId('fact-false')],
      excludedSecretFactIds: [worldFactId('fact-secret-2')],
    });

    sharedSource.push(worldFactId('fact-added-later'));

    expect(first.knownFactIds).toEqual([worldFactId('fact-public')]);
    expect(second.knownFactIds).toEqual([worldFactId('fact-public')]);
    expect(first.suspectedFactIds).toEqual([]);
    expect(second.suspectedFactIds).toEqual([worldFactId('fact-suspected')]);
    expect(first.excludedSecretFactIds).not.toEqual(second.excludedSecretFactIds);
    expect(Object.isFrozen(first.knownFactIds)).toBe(true);
  });
});

describe('tavern and NPC protocols', () => {
  it('expresses a tavern, owner, visitor and lasting change without duplicating profiles', () => {
    const now = isoTimestamp('2026-07-30T10:00:00.000Z');
    const tavernKey = tavernId('tavern-ember');
    const owner: NpcProfile = {
      id: npc,
      campaignId: campaignId('campaign-1'),
      tavernId: tavernKey,
      residency: 'OWNER',
      name: 'Sera Flint',
      identity: 'Tavern keeper and retired navigator',
      appearance: 'Silver braids and a weathered coat',
      personality: 'Warm but observant',
      goal: 'Keep the harbor neutral',
      secret: 'She knows why the beacon failed',
      speechStyle: 'Short nautical metaphors',
      currentMood: 'Cautiously hopeful',
      currentStatus: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
    };
    const visitorId = npcId('npc-visitor');
    const tavern: Tavern = {
      id: tavernKey,
      campaignId: owner.campaignId,
      locationId: locationId('location-harbor'),
      name: 'The Ember Wake',
      position: 'Beneath the eastern mooring tower',
      environment: 'Warm lamps and windows full of clouds',
      specialRules: ['Weapons remain sealed at the door'],
      longTermProblem: 'The foundation chains are weakening',
      ownerNpcId: owner.id,
      residentNpcIds: [owner.id, npcId('npc-resident-1'), npcId('npc-resident-2')],
      visitorNpcIds: [visitorId],
      createdAt: now,
      updatedAt: now,
    };
    const visitor: TemporaryVisitor = {
      npcId: visitorId,
      tavernId: tavern.id,
      visitReason: 'Seeking a crew for the western beacon',
      arrivedAt: now,
      plannedDepartureAt: null,
    };
    const change: TavernChange = {
      id: tavernChangeId('change-trophy'),
      tavernId: tavern.id,
      kind: 'TROPHY',
      description: 'A cracked beacon lens hangs above the hearth.',
      sourceAdventureId: null,
      occurredAt: now,
    };

    expect(tavern.residentNpcIds).toHaveLength(3);
    expect(visitor.npcId).toBe(visitorId);
    expect(change.kind).toBe('TROPHY');
    expect(npcMemoryId('memory-1')).toBe('memory-1');
  });
});

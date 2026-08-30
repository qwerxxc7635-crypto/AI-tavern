import { describe, expect, it } from 'vitest';

import {
  NpcLodContractError,
  createNpcLodProfile,
  gameEventId,
  itemId,
  npcId,
  npcMemoryId,
  parseNpcLodProfile,
  questId,
  worldFactId,
  type NpcLodLevel,
} from './index.js';

const at = '2026-08-20T10:00:00.000Z';

function profile(lod: NpcLodLevel) {
  return createNpcLodProfile({
    schemaVersion: 1,
    id: 'npc-lod-contract',
    campaignId: 'campaign-lod-contract',
    constitutionRevision: 1,
    lod,
    revision: lod + 1,
    identityAnchor: 'anchor-lod-contract',
    populationRole: 'Harbor passerby',
    name: lod >= 1 ? 'Nera Fen' : null,
    appearance: lod >= 1 ? 'A rain-dark cloak.' : null,
    currentBehavior: lod >= 1 ? 'Studies the tide marks.' : null,
    career: lod >= 2 ? 'Tide runner' : null,
    personality: lod >= 2 ? 'Watchful and patient.' : null,
    goals: lod >= 2 ? ['Protect the harbor road'] : [],
    knowledgeFactIds: lod >= 2 ? [worldFactId('fact-tide-mark')] : [],
    relationshipNpcIds: lod >= 2 ? [npcId('npc-harbor-master')] : [],
    memoryIds: lod >= 3 ? [npcMemoryId('memory-old-storm')] : [],
    secretFactIds: lod >= 3 ? [worldFactId('fact-hidden-channel')] : [],
    questIds: lod >= 3 ? [questId('quest-harbor-road')] : [],
    itemIds: lod >= 3 ? [itemId('item-tide-chart')] : [],
    experienceEventIds: lod >= 3 ? [gameEventId('event-old-storm')] : [],
    constitutionEvidence: {
      npcRules: 'NPC knowledge is bounded.',
      society: 'Guild towns',
      technology: 'Late medieval',
    },
    generationRecordId: lod === 0 ? null : `generation-lod-${lod}`,
    createdAt: at,
    updatedAt: at,
  });
}

describe('NPC LOD contracts', () => {
  it.each([0, 1, 2, 3] as const)('round-trips the exact LOD%s shape', (lod) => {
    const value = profile(lod);
    expect(parseNpcLodProfile(JSON.parse(JSON.stringify(value)))).toEqual(value);
    expect(Object.isFrozen(value)).toBe(true);
  });

  it('rejects details before their level is unlocked', () => {
    expect(() => createNpcLodProfile({ ...profile(0), name: 'Too early' })).toThrow(
      expect.objectContaining({ code: 'NPC_LOD_STRUCTURE_INVALID', path: 'lod0' }),
    );
    expect(() => createNpcLodProfile({ ...profile(1), career: 'Too early' })).toThrow(
      expect.objectContaining({ code: 'NPC_LOD_STRUCTURE_INVALID', path: 'lod2' }),
    );
    expect(() =>
      createNpcLodProfile({ ...profile(2), memoryIds: [npcMemoryId('memory-too-early')] }),
    ).toThrow(expect.objectContaining({ code: 'NPC_LOD_STRUCTURE_INVALID', path: 'lod3' }));
  });

  it('rejects duplicate references and unknown persisted fields', () => {
    expect(() =>
      createNpcLodProfile({
        ...profile(2),
        knowledgeFactIds: [worldFactId('fact-tide-mark'), worldFactId('fact-tide-mark')],
      }),
    ).toThrow(expect.objectContaining({ code: 'NPC_LOD_DUPLICATE' }));
    expect(() => parseNpcLodProfile({ ...profile(0), hiddenFact: true })).toThrow(
      NpcLodContractError,
    );
  });
});

import {
  campaignId,
  isoTimestamp,
  schemaVersion,
  type NpcLodCandidate,
  type NpcLodProfile,
  type WorldConstitution,
} from '@ember-tavern/contracts';
import { describe, expect, it } from 'vitest';

import {
  NpcLodRuleError,
  createNpcLodSeed,
  requiredNpcLodTrigger,
  upgradeNpcLod,
} from './index.js';

const constitution: WorldConstitution = {
  campaignId: campaignId('campaign-npc-lod'),
  schemaVersion: schemaVersion(1),
  revision: 1,
  status: 'LOCKED',
  worldType: 'Low fantasy',
  era: 'Late medieval',
  technology: 'Late medieval',
  magic: 'Magic leaves a warm trace.',
  peoples: ['Harbor folk'],
  society: 'Guild towns',
  politics: 'Harbor councils',
  economy: 'Coin and barter',
  combatScale: 'Small-scale',
  deathRules: 'Death is permanent.',
  careerRules: 'Careers are social roles.',
  equipmentRules: 'Equipment follows local craft.',
  npcRules: 'NPC knowledge is bounded.',
  traitRules: 'Traits require tradeoffs.',
  taboos: [],
  createdAt: isoTimestamp('2026-08-20T09:00:00.000Z'),
  updatedAt: isoTimestamp('2026-08-20T09:00:00.000Z'),
  lockedAt: isoTimestamp('2026-08-20T09:00:00.000Z'),
};

const references = {
  knowledgeFactIds: ['fact-tide-mark'],
  relationshipNpcIds: ['npc-harbor-master'],
  memoryIds: ['memory-old-storm'],
  secretFactIds: ['fact-hidden-channel'],
  questIds: ['quest-harbor-road'],
  itemIds: ['item-tide-chart'],
  experienceEventIds: ['event-old-storm'],
};

function seed(): NpcLodProfile {
  return createNpcLodSeed({
    id: 'npc-background-1',
    campaignId: constitution.campaignId,
    constitution,
    identityAnchor: 'anchor-background-1',
    populationRole: 'Harbor passerby',
    at: '2026-08-20T10:00:00.000Z',
  });
}

function candidate(current: NpcLodProfile): NpcLodCandidate {
  const lod = (current.lod + 1) as 1 | 2 | 3;
  return {
    npcId: current.id,
    lod,
    identityAnchor: current.identityAnchor,
    populationRole: current.populationRole,
    name: lod === 1 ? 'Nera Fen' : current.name,
    appearance: lod === 1 ? 'A rain-dark cloak.' : current.appearance,
    currentBehavior: lod === 1 ? 'Studies the tide marks.' : current.currentBehavior,
    career: lod === 2 ? 'Tide runner' : current.career,
    personality: lod === 2 ? 'Watchful and patient.' : current.personality,
    goals: lod === 2 ? ['Protect the harbor road'] : current.goals,
    knowledgeFactIds: lod === 2 ? references.knowledgeFactIds : current.knowledgeFactIds,
    relationshipNpcIds: lod === 2 ? references.relationshipNpcIds : current.relationshipNpcIds,
    memoryIds: lod === 3 ? references.memoryIds : current.memoryIds,
    secretFactIds: lod === 3 ? references.secretFactIds : current.secretFactIds,
    questIds: lod === 3 ? references.questIds : current.questIds,
    itemIds: lod === 3 ? references.itemIds : current.itemIds,
    experienceEventIds: lod === 3 ? references.experienceEventIds : current.experienceEventIds,
    constitutionEvidence: current.constitutionEvidence,
  };
}

function upgrade(current: NpcLodProfile): NpcLodProfile {
  if (current.lod === 3) throw new Error('Test helper cannot upgrade LOD3');
  return upgradeNpcLod({
    current,
    constitution,
    candidate: candidate(current),
    trigger: requiredNpcLodTrigger(current.lod),
    references,
    generationRecordId: `generation-lod-${current.lod + 1}`,
    at: `2026-08-20T1${current.lod + 1}:00:00.000Z`,
  });
}

describe('NPC LOD upgrade rules', () => {
  it('promotes LOD0 through LOD3 while preserving identity and prior facts', () => {
    const zero = seed();
    const one = upgrade(zero);
    const two = upgrade(one);
    const three = upgrade(two);

    expect([zero.lod, one.lod, two.lod, three.lod]).toEqual([0, 1, 2, 3]);
    expect([zero.revision, one.revision, two.revision, three.revision]).toEqual([1, 2, 3, 4]);
    expect(three).toMatchObject({
      identityAnchor: zero.identityAnchor,
      name: one.name,
      career: two.career,
      knowledgeFactIds: two.knowledgeFactIds,
      memoryIds: references.memoryIds,
    });
  });

  it('rejects skips, downgrades, wrong triggers, and identity rewrites', () => {
    const zero = seed();
    expect(() =>
      upgradeNpcLod({
        current: zero,
        constitution,
        candidate: { ...candidate(zero), lod: 2 },
        trigger: 'OBSERVED',
        references,
        generationRecordId: 'generation-skip',
        at: '2026-08-20T11:00:00.000Z',
      }),
    ).toThrow(expect.objectContaining({ code: 'NPC_LOD_TRANSITION_INVALID' }));
    expect(() =>
      upgradeNpcLod({
        current: zero,
        constitution,
        candidate: candidate(zero),
        trigger: 'INTERACTED',
        references,
        generationRecordId: 'generation-trigger',
        at: '2026-08-20T11:00:00.000Z',
      }),
    ).toThrow(expect.objectContaining({ code: 'NPC_LOD_TRANSITION_INVALID' }));
    expect(() =>
      upgradeNpcLod({
        current: zero,
        constitution,
        candidate: { ...candidate(zero), identityAnchor: 'replacement' },
        trigger: 'OBSERVED',
        references,
        generationRecordId: 'generation-rewrite',
        at: '2026-08-20T11:00:00.000Z',
      }),
    ).toThrow(NpcLodRuleError);
  });

  it('rejects knowledge and other references outside the actor authority boundary', () => {
    const one = upgrade(seed());
    expect(() =>
      upgradeNpcLod({
        current: one,
        constitution,
        candidate: { ...candidate(one), knowledgeFactIds: ['fact-not-known'] },
        trigger: 'INTERACTED',
        references,
        generationRecordId: 'generation-leak',
        at: '2026-08-20T12:00:00.000Z',
      }),
    ).toThrow(expect.objectContaining({ code: 'NPC_LOD_REFERENCE_UNAUTHORIZED' }));
  });
});

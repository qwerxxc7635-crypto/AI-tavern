import {
  campaignId,
  createNpcLodProfile,
  isoTimestamp,
  schemaVersion,
  type NpcLodCandidate,
  type NpcLodProfile,
} from '@ember-tavern/contracts';
import { NpcLodInputSchema } from '@ember-tavern/ai-core';
import { upgradeNpcLod } from '@ember-tavern/domain';
import { describe, expect, it, vi } from 'vitest';

import { NpcLodService, type NpcLodGateway, type NpcLodServiceError } from './npc-lod-service.js';

const evidence = {
  npcRules: 'NPC knowledge is bounded.',
  society: 'Guild towns',
  technology: 'Late medieval',
};

describe('NpcLodService', () => {
  it('uses the structured Generator and coalesces concurrent promotion intent', async () => {
    let profile = seed();
    const gateway: NpcLodGateway = {
      seed: vi.fn(),
      load: vi.fn(async () => snapshot(profile)),
      commit: vi.fn(async ({ generation }) => {
        const output = generation.validatedOutput as { npc: NpcLodCandidate };
        profile = upgradeNpcLod({
          current: profile,
          constitution: constitution(),
          candidate: output.npc,
          trigger: 'OBSERVED',
          references: emptyReferences(),
          generationRecordId: generation.generationRecordId,
          at: '2026-08-20T11:00:00.000Z',
        });
        return snapshot(profile);
      }),
    };
    const service = new NpcLodService(gateway, undefined, identity);

    const [first, second] = await Promise.all([
      service.upgrade(profile.campaignId, profile.id),
      service.upgrade(profile.campaignId, profile.id),
    ]);
    expect(first.profile).toEqual(second.profile);
    expect(first.profile).toMatchObject({
      lod: 1,
      revision: 2,
      identityAnchor: profile.identityAnchor,
    });
    expect(gateway.load).toHaveBeenCalledTimes(1);
    expect(gateway.commit).toHaveBeenCalledTimes(1);
  });

  it('does not regenerate a complete LOD3 identity', async () => {
    const complete = createNpcLodProfile({
      ...seed(),
      lod: 3,
      revision: 4,
      name: 'Nera Fen',
      appearance: 'A rain-dark cloak.',
      currentBehavior: 'Studies the tide marks.',
      career: 'Tide runner',
      personality: 'Watchful and patient.',
      goals: ['Protect the harbor road'],
      generationRecordId: 'generation-complete',
    });
    const gateway: NpcLodGateway = {
      seed: vi.fn(),
      load: vi.fn(async () => Object.freeze({ profile: complete, input: null })),
      commit: vi.fn(),
    };
    await expect(
      new NpcLodService(gateway).upgrade(complete.campaignId, complete.id),
    ).rejects.toThrow(
      expect.objectContaining({
        code: 'LOD_ALREADY_COMPLETE',
      } satisfies Partial<NpcLodServiceError>),
    );
    expect(gateway.commit).not.toHaveBeenCalled();
  });
});

function seed(): NpcLodProfile {
  return createNpcLodProfile({
    schemaVersion: 1,
    id: 'npc-service-lod',
    campaignId: 'campaign-service-lod',
    constitutionRevision: 1,
    lod: 0,
    revision: 1,
    identityAnchor: 'anchor-service-lod',
    populationRole: 'Harbor passerby',
    name: null,
    appearance: null,
    currentBehavior: null,
    career: null,
    personality: null,
    goals: [],
    ...emptyReferences(),
    constitutionEvidence: evidence,
    generationRecordId: null,
    createdAt: '2026-08-20T10:00:00.000Z',
    updatedAt: '2026-08-20T10:00:00.000Z',
  });
}

function snapshot(profile: NpcLodProfile) {
  if (profile.lod === 3) return Object.freeze({ profile, input: null });
  return Object.freeze({
    profile,
    input: NpcLodInputSchema.parse({
      schemaVersion: 1 as const,
      context: {
        worldId: profile.campaignId,
        constitutionRevision: profile.constitutionRevision,
        contextSummary: 'Promote one noticed harbor passerby.',
      },
      currentProfile: {
        npcId: profile.id,
        lod: profile.lod,
        identityAnchor: profile.identityAnchor,
        populationRole: profile.populationRole,
        name: profile.name,
        appearance: profile.appearance,
        currentBehavior: profile.currentBehavior,
        career: profile.career,
        personality: profile.personality,
        goals: profile.goals,
        knowledgeFactIds: profile.knowledgeFactIds,
        relationshipNpcIds: profile.relationshipNpcIds,
        memoryIds: profile.memoryIds,
        secretFactIds: profile.secretFactIds,
        questIds: profile.questIds,
        itemIds: profile.itemIds,
        experienceEventIds: profile.experienceEventIds,
        constitutionEvidence: evidence,
      },
      targetLod: (profile.lod + 1) as 1 | 2 | 3,
      trigger: (['OBSERVED', 'INTERACTED', 'RECURRING'] as const)[profile.lod],
      allowedReferences: emptyReferences(),
      constitutionEvidence: evidence,
    }),
  });
}

function emptyReferences() {
  return {
    knowledgeFactIds: [],
    relationshipNpcIds: [],
    memoryIds: [],
    secretFactIds: [],
    questIds: [],
    itemIds: [],
    experienceEventIds: [],
  };
}

function constitution() {
  return {
    campaignId: campaignId('campaign-service-lod'),
    schemaVersion: schemaVersion(1),
    revision: 1,
    status: 'LOCKED' as const,
    worldType: 'Low fantasy',
    era: 'Late medieval',
    technology: evidence.technology,
    magic: 'Magic leaves a warm trace.',
    peoples: ['Harbor folk'],
    society: evidence.society,
    politics: 'Harbor councils',
    economy: 'Coin and barter',
    combatScale: 'Small-scale',
    deathRules: 'Death is permanent.',
    careerRules: 'Careers are social roles.',
    equipmentRules: 'Equipment follows local craft.',
    npcRules: evidence.npcRules,
    traitRules: 'Traits require tradeoffs.',
    taboos: [],
    createdAt: isoTimestamp('2026-08-20T09:00:00.000Z'),
    updatedAt: isoTimestamp('2026-08-20T09:00:00.000Z'),
    lockedAt: isoTimestamp('2026-08-20T09:00:00.000Z'),
  };
}

function identity() {
  return {
    requestId: 'request-service-lod',
    generationRecordId: 'generation-service-lod',
    idempotencyKey: 'service-lod',
  };
}

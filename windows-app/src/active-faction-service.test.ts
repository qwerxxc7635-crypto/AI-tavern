import { FactionInputSchema } from '@ember-tavern/ai-core';
import {
  campaignId,
  createActiveFactionProfile,
  factionActionProposal,
  isoTimestamp,
  type ActiveFactionCandidate,
} from '@ember-tavern/contracts';
import { activateFactions } from '@ember-tavern/domain';
import { describe, expect, it, vi } from 'vitest';

import {
  ActiveFactionService,
  type ActiveFactionGateway,
  type ActiveFactionSnapshot,
} from './active-faction-service.js';

const campaign = campaignId('campaign-faction-service');
const now = isoTimestamp('2026-08-20T10:00:00.000Z');
const evidence = {
  technology: 'Late medieval',
  society: 'Guild towns',
  politics: 'Harbor councils',
  economy: 'Coin and barter',
};

describe('ActiveFactionService', () => {
  it('uses structured generation once for the same activation intent', async () => {
    let snapshot = initialSnapshot();
    const gateway: ActiveFactionGateway = {
      load: vi.fn(async () => snapshot),
      generation: vi.fn(async () => generationSnapshot(snapshot)),
      commit: vi.fn(async ({ generation }) => {
        const candidates = (generation.validatedOutput as { factions: ActiveFactionCandidate[] })
          .factions;
        snapshot = Object.freeze({
          factions: activateFactions({
            campaignId: campaign,
            constitution: constitution(),
            existing: snapshot.factions,
            requestedFactionIds: ['faction-wardens'],
            candidates,
            allowedLocationIds: ['location-city'],
            generationRecordId: generation.generationRecordId as string,
            at: now,
          }),
          actionHistory: Object.freeze([]),
        });
        return snapshot;
      }),
      apply: vi.fn(),
    };
    const service = new ActiveFactionService(
      gateway,
      undefined,
      generationIdentity,
      actionIdentity,
    );
    const [first, second] = await Promise.all([
      service.activate(campaign, ['faction-wardens']),
      service.activate(campaign, ['faction-wardens']),
    ]);
    expect(first).toEqual(second);
    expect(first.factions[0]).toMatchObject({ materialization: 'ACTIVE', revision: 2 });
    expect(gateway.generation).toHaveBeenCalledTimes(1);
    expect(gateway.commit).toHaveBeenCalledTimes(1);
  });

  it('submits a rule proposal locally without invoking AI generation', async () => {
    const snapshot = initialSnapshot();
    const gateway: ActiveFactionGateway = {
      load: vi.fn(),
      generation: vi.fn(),
      commit: vi.fn(),
      apply: vi.fn(async () => snapshot),
    };
    const service = new ActiveFactionService(
      gateway,
      undefined,
      generationIdentity,
      actionIdentity,
    );
    const proposal = factionActionProposal({
      id: 'proposal-recover',
      factionId: 'faction-wardens',
      kind: 'RECOVER',
      source: 'PLAYER',
      summary: 'The wardens recover a cache.',
      requiredResources: [],
      targetFactionId: null,
      targetLocationId: null,
      targetQuestId: null,
      consequences: [{ kind: 'RESOURCE_ADD', resource: 'Recovered stores' }],
    });
    await service.applyAction({
      campaignId: campaign,
      expectedRevision: 1,
      proposal,
      budget: { decisionId: 'budget-recover', actionPoints: 1, questChanges: 0, worldFacts: 0 },
      worldFactId: null,
    });
    expect(gateway.apply).toHaveBeenCalledWith(
      expect.objectContaining({
        proposal,
        eventId: 'event-faction-service',
        operationId: 'operation-faction-service',
      }),
    );
    expect(gateway.generation).not.toHaveBeenCalled();
  });
});

function initialSnapshot(): ActiveFactionSnapshot {
  return Object.freeze({
    factions: Object.freeze([
      createActiveFactionProfile({
        schemaVersion: 1,
        id: 'faction-wardens',
        campaignId: campaign,
        constitutionRevision: 1,
        materialization: 'OUTLINE',
        name: 'Road Wardens',
        description: 'They keep the roads.',
        goal: 'Reopen the old road.',
        resources: [],
        leadership: [],
        enemyFactionIds: [],
        allyFactionIds: [],
        territoryLocationIds: ['location-city'],
        currentAction: null,
        playerRelation: 'UNKNOWN',
        constitutionEvidence: evidence,
        generationRecordId: null,
        revision: 1,
        createdAt: now,
        updatedAt: now,
      }),
    ]),
    actionHistory: Object.freeze([]),
  });
}

function generationSnapshot(snapshot: ActiveFactionSnapshot) {
  const profile = snapshot.factions[0];
  if (profile === undefined) throw new Error('faction missing');
  return Object.freeze({
    factions: snapshot,
    input: FactionInputSchema.parse({
      schemaVersion: 1,
      context: {
        worldId: campaign,
        constitutionRevision: 1,
        contextSummary: 'Activate only the requested established factions.',
      },
      requestedFactionIds: [profile.id],
      existingFactions: [
        {
          id: profile.id,
          name: profile.name,
          description: profile.description,
          goal: profile.goal,
          enemyFactionIds: profile.enemyFactionIds,
          allyFactionIds: profile.allyFactionIds,
          territoryLocationIds: profile.territoryLocationIds,
          playerRelation: profile.playerRelation,
        },
      ],
      allowedFactionIds: [profile.id],
      allowedLocationIds: ['location-city'],
      constitutionEvidence: evidence,
    }),
  });
}

function constitution() {
  return {
    campaignId: campaign,
    schemaVersion: 1 as never,
    revision: 1,
    status: 'LOCKED' as const,
    worldType: 'Low fantasy',
    era: 'Late medieval',
    technology: evidence.technology,
    magic: 'Rare',
    peoples: ['Harbor folk'],
    society: evidence.society,
    politics: evidence.politics,
    economy: evidence.economy,
    combatScale: 'Small-scale',
    deathRules: 'Permanent.',
    careerRules: 'Social roles.',
    equipmentRules: 'Local craft.',
    npcRules: 'Bounded knowledge.',
    traitRules: 'Tradeoffs.',
    taboos: [],
    createdAt: now,
    updatedAt: now,
    lockedAt: now,
  };
}

function generationIdentity() {
  return {
    requestId: 'request-faction-service',
    generationRecordId: 'generation-faction-service',
    idempotencyKey: 'faction:service',
  };
}

function actionIdentity() {
  return { eventId: 'event-faction-service', operationId: 'operation-faction-service' };
}

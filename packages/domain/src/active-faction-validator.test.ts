import {
  campaignId,
  createActiveFactionProfile,
  factionActionProposal,
  isoTimestamp,
  locationId,
  questId,
  schemaVersion,
  type ActiveFactionCandidate,
  type ActiveFactionProfile,
  type Quest,
  type WorldConstitution,
} from '@ember-tavern/contracts';
import { describe, expect, it } from 'vitest';

import { ActiveFactionRuleError, activateFactions, applyFactionAction } from './index.js';

const campaign = campaignId('campaign-active-faction-domain');
const now = isoTimestamp('2026-08-20T10:00:00.000Z');
const later = isoTimestamp('2026-08-20T11:00:00.000Z');
const evidence = {
  technology: 'Late medieval',
  society: 'Guild towns',
  politics: 'Harbor councils',
  economy: 'Coin and barter',
};

describe('active faction rules', () => {
  it('activates a reciprocal ally/enemy network while preserving identity and territory', () => {
    const lantern = outline('faction-lantern', 'Lantern Guild', ['location-harbor']);
    const reef = outline('faction-reef', 'Reef Compact', ['location-reef']);
    const activated = activateFactions({
      campaignId: campaign,
      constitution: constitution(),
      existing: [lantern, reef],
      requestedFactionIds: [lantern.id, reef.id],
      candidates: [
        candidate(lantern, { enemies: [reef.id] }),
        candidate(reef, { enemies: [lantern.id] }),
      ],
      allowedLocationIds: ['location-harbor', 'location-reef'],
      generationRecordId: 'generation-factions-domain',
      at: later,
    });
    expect(activated).toHaveLength(2);
    expect(activated[0]).toMatchObject({
      id: lantern.id,
      materialization: 'ACTIVE',
      enemyFactionIds: [reef.id],
      territoryLocationIds: [locationId('location-harbor')],
      revision: 2,
    });
  });

  it('atomically applies resources, territory, reciprocal diplomacy and player relation', () => {
    const [lantern, reef] = activePair();
    const proposal = factionActionProposal({
      id: 'faction-action-diplomacy',
      factionId: lantern.id,
      kind: 'DIPLOMACY',
      source: 'WORLD_EVENT',
      summary: 'The guild signs a harbor truce.',
      requiredResources: ['Harbor patrols'],
      targetFactionId: reef.id,
      targetLocationId: null,
      targetQuestId: null,
      consequences: [
        { kind: 'RELATION_SET', factionId: reef.id, relation: 'ALLY' },
        { kind: 'PLAYER_RELATION_SET', relation: 'FRIENDLY' },
        { kind: 'RESOURCE_REMOVE', resource: 'Harbor patrols' },
      ],
    });
    const plan = applyFactionAction({
      campaignId: campaign,
      constitution: constitution(),
      factions: [lantern, reef],
      locationIds: ['location-harbor', 'location-reef'],
      quests: [quest('ACTIVE')],
      proposal,
      budget: { decisionId: 'budget-truce', actionPoints: 4, questChanges: 0, worldFacts: 0 },
      at: later,
    });
    expect(plan.cost).toBe(4);
    expect(plan.factions[0]).toMatchObject({
      allyFactionIds: [reef.id],
      enemyFactionIds: [],
      playerRelation: 'FRIENDLY',
      resources: ['Beacon stores'],
      currentAction: proposal.summary,
      revision: 3,
    });
    expect(plan.factions[1]).toMatchObject({
      allyFactionIds: [lantern.id],
      enemyFactionIds: [],
      revision: 3,
    });
  });

  it('allows a budgeted faction consequence to complete a legal active Quest', () => {
    const [lantern, reef] = activePair();
    const activeQuest = quest('ACTIVE');
    const plan = applyFactionAction({
      campaignId: campaign,
      constitution: constitution(),
      factions: [lantern, reef],
      locationIds: ['location-harbor', 'location-reef'],
      quests: [activeQuest],
      proposal: factionActionProposal({
        id: 'faction-action-support',
        factionId: lantern.id,
        kind: 'SUPPORT_QUEST',
        source: 'PLAYER',
        summary: 'The guild commits its patrols to the beacon.',
        requiredResources: ['Harbor patrols'],
        targetFactionId: null,
        targetLocationId: null,
        targetQuestId: activeQuest.id,
        consequences: [{ kind: 'QUEST_STATUS_SET', questId: activeQuest.id, status: 'COMPLETED' }],
      }),
      budget: { decisionId: 'budget-support', actionPoints: 3, questChanges: 1, worldFacts: 0 },
      at: later,
    });
    expect(plan.quests[0]).toMatchObject({ id: activeQuest.id, status: 'COMPLETED' });
  });

  it('rejects asymmetric activation, missing resources, illegal targets and budget overflow', () => {
    const lantern = outline('faction-lantern', 'Lantern Guild', ['location-harbor']);
    const reef = outline('faction-reef', 'Reef Compact', ['location-reef']);
    expect(() =>
      activateFactions({
        campaignId: campaign,
        constitution: constitution(),
        existing: [lantern, reef],
        requestedFactionIds: [lantern.id, reef.id],
        candidates: [
          candidate(lantern, { allies: [reef.id] }),
          candidate(reef, { enemies: [lantern.id] }),
        ],
        allowedLocationIds: ['location-harbor', 'location-reef'],
        generationRecordId: 'generation-asymmetric',
        at: later,
      }),
    ).toThrow(expect.objectContaining({ code: 'FACTION_RELATION_INVALID' }));

    const [activeLantern, activeReef] = activePair();
    expect(() =>
      applyFactionAction({
        campaignId: campaign,
        constitution: constitution(),
        factions: [activeLantern, activeReef],
        locationIds: ['location-harbor', 'location-reef'],
        quests: [quest('ACTIVE')],
        proposal: factionActionProposal({
          id: 'faction-action-over-budget',
          factionId: activeLantern.id,
          kind: 'EXPAND_TERRITORY',
          source: 'DIRECTOR',
          summary: 'The guild attempts too many changes.',
          requiredResources: ['Unknown fleet'],
          targetFactionId: null,
          targetLocationId: locationId('location-reef'),
          targetQuestId: null,
          consequences: [
            { kind: 'TERRITORY_ADD', locationId: locationId('location-reef') },
            {
              kind: 'WORLD_FACT',
              statement: 'The road is occupied.',
              locationId: locationId('location-reef'),
            },
            { kind: 'PLAYER_RELATION_SET', relation: 'WARY' },
          ],
        }),
        budget: { decisionId: 'budget-too-small', actionPoints: 2, questChanges: 0, worldFacts: 0 },
        at: later,
      }),
    ).toThrow(ActiveFactionRuleError);
  });
});

function outline(id: string, name: string, territories: readonly string[]): ActiveFactionProfile {
  return createActiveFactionProfile({
    schemaVersion: 1,
    id,
    campaignId: campaign,
    constitutionRevision: 1,
    materialization: 'OUTLINE',
    name,
    description: `${name} is established in the WorldBible.`,
    goal: `Advance the interests of ${name}.`,
    resources: [],
    leadership: [],
    enemyFactionIds: [],
    allyFactionIds: [],
    territoryLocationIds: territories,
    currentAction: null,
    playerRelation: 'UNKNOWN',
    constitutionEvidence: evidence,
    generationRecordId: null,
    revision: 1,
    createdAt: now,
    updatedAt: now,
  });
}

function candidate(
  current: ActiveFactionProfile,
  options: Readonly<{ allies?: readonly string[]; enemies?: readonly string[] }> = {},
): ActiveFactionCandidate {
  return {
    id: current.id,
    name: current.name,
    goal: current.goal,
    resources: ['Harbor patrols', 'Beacon stores'],
    leadership: [`${current.name} council`],
    enemyFactionIds: options.enemies ?? [],
    allyFactionIds: options.allies ?? [],
    territoryLocationIds: current.territoryLocationIds,
    currentAction: 'Secure the storm roads.',
    playerRelation: current.playerRelation,
    constitutionEvidence: evidence,
  };
}

function activePair(): readonly [ActiveFactionProfile, ActiveFactionProfile] {
  const lantern = outline('faction-lantern', 'Lantern Guild', ['location-harbor']);
  const reef = outline('faction-reef', 'Reef Compact', ['location-reef']);
  const active = activateFactions({
    campaignId: campaign,
    constitution: constitution(),
    existing: [lantern, reef],
    requestedFactionIds: [lantern.id, reef.id],
    candidates: [
      candidate(lantern, { enemies: [reef.id] }),
      candidate(reef, { enemies: [lantern.id] }),
    ],
    allowedLocationIds: ['location-harbor', 'location-reef'],
    generationRecordId: 'generation-active-pair',
    at: later,
  });
  const first = active[0];
  const second = active[1];
  if (first === undefined || second === undefined) throw new Error('active pair missing');
  return [first, second];
}

function quest(status: Quest['status']): Quest {
  return {
    id: questId('quest-faction-beacon'),
    campaignId: campaign,
    publisherNpcId: 'npc-faction-publisher' as Quest['publisherNpcId'],
    content: {
      title: 'Restore the Beacon',
      summary: 'Restore the coast light.',
      objective: 'Relight the beacon.',
      failureCost: 'The harbor remains isolated.',
    },
    status,
    risk: 'MODERATE',
    recommendedAttributes: ['knowledge'],
    expectedTurns: { min: 3, max: 6 },
    rewardTier: 'NOTABLE',
    relatedNpcIds: [],
    relatedFactIds: [],
    createdAt: now,
    updatedAt: now,
  };
}

function constitution(): WorldConstitution {
  return {
    campaignId: campaign,
    schemaVersion: schemaVersion(1),
    revision: 1,
    status: 'LOCKED',
    worldType: 'Low fantasy coast',
    era: 'Late medieval',
    ...evidence,
    magic: 'Magic leaves a warm trace.',
    peoples: ['Harbor folk'],
    combatScale: 'Small-scale',
    deathRules: 'Death is permanent.',
    careerRules: 'Careers are social roles.',
    equipmentRules: 'Equipment follows local craft.',
    npcRules: 'NPC knowledge is bounded.',
    traitRules: 'Traits require tradeoffs.',
    taboos: [],
    createdAt: now,
    updatedAt: now,
    lockedAt: now,
  };
}

import { describe, expect, it } from 'vitest';

import {
  campaignId,
  claimId,
  isoTimestamp,
  itemId,
  npcId,
  questId,
  rumorId,
  tavernId,
  worldFactId,
  type Item,
  type Quest,
  type Rumor,
} from './index.js';

const now = isoTimestamp('2026-07-30T10:00:00.000Z');
const campaign = campaignId('campaign-1');

describe('rumor, quest and item contracts', () => {
  it('keeps player-facing rumor content separate from hidden veracity', () => {
    const rumor: Rumor = {
      id: rumorId('rumor-beacon'),
      claimId: claimId('claim-rumor-beacon'),
      campaignId: campaign,
      tavernId: tavernId('tavern-ember'),
      content: {
        headline: 'The guild destroyed the western beacon.',
        details: 'A courier claims to have seen guild colors near the wreck.',
      },
      sourceNpcId: npcId('npc-courier'),
      sourceBasis: 'HEARSAY',
      confidence: 0.5,
      claimRevision: 1,
      relatedFactIds: [worldFactId('fact-beacon')],
      veracity: 'UNKNOWN',
      createdAt: now,
      expiresAt: null,
    };

    expect(rumor.content.headline).not.toContain(rumor.veracity);
    expect(rumor.veracity).toBe('UNKNOWN');
  });

  it('expresses every program-controlled quest field from the specification', () => {
    const quest: Quest = {
      id: questId('quest-beacon'),
      campaignId: campaign,
      publisherNpcId: npcId('npc-courier'),
      content: {
        title: 'The Silent Beacon',
        summary: 'Reach the western island and inspect the failed beacon.',
        objective: 'Determine the cause and restore a safe signal.',
        failureCost: 'Trade routes remain closed and the world clock advances.',
      },
      status: 'AVAILABLE',
      risk: 'HIGH',
      recommendedAttributes: ['knowledge', 'agility'],
      expectedTurns: { min: 8, max: 12 },
      rewardTier: 'NOTABLE',
      relatedNpcIds: [npcId('npc-courier')],
      relatedFactIds: [worldFactId('fact-beacon')],
      createdAt: now,
      updatedAt: now,
    };

    expect(quest).toMatchObject({
      status: 'AVAILABLE',
      risk: 'HIGH',
      expectedTurns: { min: 8, max: 12 },
      rewardTier: 'NOTABLE',
    });
  });

  it('does not infer item rules from AI-generated name or description', () => {
    const content = {
      name: 'Compass of Impossible Winds',
      description: 'A brass compass that hums before a storm.',
    } as const;
    const narrativeOnly: Item = {
      id: itemId('item-compass-story'),
      campaignId: campaign,
      content,
      rewardTier: 'BASIC',
      effect: { kind: 'NONE' },
      createdAt: now,
    };
    const mechanical: Item = {
      id: itemId('item-compass-check'),
      campaignId: campaign,
      content,
      rewardTier: 'NOTABLE',
      effect: { kind: 'CHECK_MODIFIER', attribute: 'knowledge', modifier: 1 },
      createdAt: now,
    };

    expect(narrativeOnly.content).toEqual(mechanical.content);
    expect(narrativeOnly.effect).toEqual({ kind: 'NONE' });
    expect(mechanical.effect).toEqual({
      kind: 'CHECK_MODIFIER',
      attribute: 'knowledge',
      modifier: 1,
    });
  });
});

import {
  campaignId,
  claimId,
  createClaim,
  createKnowledge,
  createMemory,
  createWorldTruth,
  gameEventId,
  isoTimestamp,
  knowledgeId,
  memoryId,
  worldTruthId,
} from '@ember-tavern/contracts';
import { describe, expect, it } from 'vitest';

import { knowledgeForPrompt, projectActorKnowledge } from './knowledge-boundary.js';

const campaign = campaignId('campaign-boundary');
const at = isoTimestamp('2026-08-14T12:00:00.000Z');
const observed = gameEventId('event-observed');
const secretTruth = createWorldTruth({
  id: worldTruthId('truth-secret-route'),
  campaignId: campaign,
  subject: 'route:sealed',
  predicate: 'opens_at',
  object: 'moonrise',
  authority: 'DOMAIN_TRANSACTION',
  visibility: 'SECRET',
  sourceEventId: observed,
  revision: 1,
  createdAt: at,
});
const publicTruth = createWorldTruth({
  ...secretTruth,
  id: worldTruthId('truth-public-bell'),
  subject: 'bell',
  object: 'rings at dusk',
  visibility: 'PUBLIC',
});
const rumor = createClaim({
  id: claimId('claim-route-cursed'),
  campaignId: campaign,
  subject: 'route:sealed',
  predicate: 'is_cursed',
  object: true,
  source: { kind: 'ACTOR', actorType: 'NPC', actorId: 'npc-rumormonger' },
  confidence: 0.45,
  revision: 1,
  createdAt: at,
});

describe('Knowledge Boundary projection', () => {
  it('projects only the exact actor grants, including explicitly learned secrets', () => {
    const npcOne = knowledge('npc-one-secret', 'NPC', 'npc-one', {
      kind: 'TRUTH',
      truthId: secretTruth.id,
    });
    const npcTwo = knowledge('npc-two-public', 'NPC', 'npc-two', {
      kind: 'TRUTH',
      truthId: publicTruth.id,
    });
    const player = knowledge('player-rumor', 'PLAYER_CHARACTER', 'player-one', {
      kind: 'CLAIM',
      claimId: rumor.id,
    });

    const projection = projectActorKnowledge({
      campaignId: campaign,
      actor: { type: 'NPC', id: 'npc-one' },
      knowledge: [npcTwo, player, npcOne],
      truths: [publicTruth, secretTruth],
      claims: [rumor],
      memories: [],
    });

    expect(projection.entries).toHaveLength(1);
    expect(projection.entries[0]).toMatchObject({
      knowledgeId: knowledgeId('npc-one-secret'),
      targetKind: 'TRUTH',
      truthVisibility: 'SECRET',
      object: 'moonrise',
    });
    expect(JSON.stringify(projection)).not.toContain('rings at dusk');
    expect(JSON.stringify(projection)).not.toContain('is_cursed');
  });

  it('keeps known claims and subjective memories distinct from World Truth', () => {
    const claimKnowledge = knowledge(
      'player-rumor',
      'PLAYER_CHARACTER',
      'player-one',
      { kind: 'CLAIM', claimId: rumor.id },
      'KNOWN',
    );
    const memory = createMemory({
      id: memoryId('memory-player-rumor'),
      campaignId: campaign,
      actor: { type: 'PLAYER_CHARACTER', id: 'player-one' },
      summary: 'The player remembers hearing the route was cursed.',
      sourceKnowledgeIds: [claimKnowledge.id],
      sourceEventIds: [],
      revision: 1,
      createdAt: at,
    });
    const projection = projectActorKnowledge({
      campaignId: campaign,
      actor: claimKnowledge.actor,
      knowledge: [claimKnowledge],
      truths: [secretTruth],
      claims: [rumor],
      memories: [memory],
    });

    expect(knowledgeForPrompt(projection)).toEqual([
      {
        targetKind: 'CLAIM',
        state: 'KNOWN',
        subject: 'route:sealed',
        predicate: 'is_cursed',
        object: true,
        confidence: 0.45,
      },
    ]);
    expect(projection.memories[0]?.kind).toBe('MEMORY');
    expect(projection.entries).not.toContainEqual(expect.objectContaining({ targetKind: 'TRUTH' }));
  });

  it('fails closed on missing targets, duplicate grants, and cross-actor memory sources', () => {
    const own = knowledge('npc-one-secret', 'NPC', 'npc-one', {
      kind: 'TRUTH',
      truthId: secretTruth.id,
    });
    const duplicate = { ...own, id: knowledgeId('npc-one-secret-duplicate') };
    expect(() =>
      projectActorKnowledge({
        campaignId: campaign,
        actor: own.actor,
        knowledge: [own, duplicate],
        truths: [secretTruth],
        claims: [],
        memories: [],
      }),
    ).toThrow('duplicate');
    expect(() =>
      projectActorKnowledge({
        campaignId: campaign,
        actor: own.actor,
        knowledge: [own],
        truths: [],
        claims: [],
        memories: [],
      }),
    ).toThrow('unavailable');
    const other = knowledge('npc-two-secret', 'NPC', 'npc-two', {
      kind: 'TRUTH',
      truthId: secretTruth.id,
    });
    expect(() =>
      projectActorKnowledge({
        campaignId: campaign,
        actor: own.actor,
        knowledge: [own, other],
        truths: [secretTruth],
        claims: [],
        memories: [
          createMemory({
            id: memoryId('memory-cross-actor'),
            campaignId: campaign,
            actor: own.actor,
            summary: 'Invalid borrowed memory.',
            sourceKnowledgeIds: [other.id],
            sourceEventIds: [],
            revision: 1,
            createdAt: at,
          }),
        ],
      }),
    ).toThrow('another actor');
  });
});

function knowledge(
  id: string,
  actorType: 'NPC' | 'PLAYER_CHARACTER',
  actorId: string,
  target:
    | { readonly kind: 'TRUTH'; readonly truthId: ReturnType<typeof worldTruthId> }
    | { readonly kind: 'CLAIM'; readonly claimId: ReturnType<typeof claimId> },
  state: 'KNOWN' | 'SUSPECTED' | 'BELIEVED' = 'KNOWN',
) {
  return createKnowledge({
    id: knowledgeId(id),
    campaignId: campaign,
    actor: { type: actorType, id: actorId },
    target,
    state,
    visibility: 'ACTOR_PRIVATE',
    provenance: {
      kind: 'OBSERVATION',
      sourceId: observed,
      eventId: observed,
      learnedAt: at,
      confidence: 0.8,
    },
    revision: 1,
  });
}

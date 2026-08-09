import { describe, expect, it } from 'vitest';

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
} from './index.js';

const campaign = campaignId('campaign-knowledge');
const at = isoTimestamp('2026-08-09T00:00:00.000Z');
const event = gameEventId('event-observed');

describe('WorldTruth / Claim / Knowledge / Memory', () => {
  it('keeps objective truth separate from a sourced uncertain claim', () => {
    const truth = createWorldTruth({
      id: worldTruthId('truth-beacon'),
      campaignId: campaign,
      subject: 'beacon',
      predicate: 'is_lit',
      object: true,
      authority: 'DOMAIN_TRANSACTION',
      visibility: 'GAME_PRIVATE',
      sourceEventId: event,
      revision: 1,
      createdAt: at,
    });
    const claim = createClaim({
      id: claimId('claim-beacon'),
      campaignId: campaign,
      subject: 'beacon',
      predicate: 'is_cursed',
      object: true,
      source: { kind: 'ACTOR', actorType: 'NPC', actorId: 'npc-keeper' },
      confidence: 0.4,
      revision: 1,
      createdAt: at,
    });

    expect(truth.kind).toBe('WORLD_TRUTH');
    expect(claim.kind).toBe('CLAIM');
    expect(claim.source).toEqual({ kind: 'ACTOR', actorType: 'NPC', actorId: 'npc-keeper' });
  });

  it('grants actor-scoped knowledge only about a truth or claim with provenance', () => {
    const knowledge = createKnowledge({
      id: knowledgeId('knowledge-keeper-claim'),
      campaignId: campaign,
      actor: { type: 'NPC', id: 'npc-keeper' },
      target: { kind: 'CLAIM', claimId: claimId('claim-beacon') },
      state: 'SUSPECTED',
      visibility: 'ACTOR_PRIVATE',
      provenance: {
        kind: 'COMMUNICATION',
        sourceId: 'conversation-one',
        eventId: event,
        learnedAt: at,
        confidence: 0.7,
      },
      revision: 1,
    });

    expect(knowledge.kind).toBe('KNOWLEDGE');
    expect(knowledge.target.kind).toBe('CLAIM');
    expect(knowledge.provenance.kind).toBe('COMMUNICATION');
  });

  it('creates memory only from knowledge or event evidence and never as truth', () => {
    const memory = createMemory({
      id: memoryId('memory-keeper-beacon'),
      campaignId: campaign,
      actor: { type: 'NPC', id: 'npc-keeper' },
      summary: 'The keeper remembers hearing that the beacon is cursed.',
      sourceKnowledgeIds: [knowledgeId('knowledge-keeper-claim')],
      sourceEventIds: [event],
      revision: 1,
      createdAt: at,
    });

    expect(memory.kind).toBe('MEMORY');
    expect(memory).not.toHaveProperty('authority');
    expect(() =>
      createMemory({
        ...memory,
        sourceKnowledgeIds: [],
        sourceEventIds: [],
      }),
    ).toThrow('Memory requires a Knowledge or Event source');
  });

  it('rejects invalid confidence, revisions, actors and duplicate memory sources', () => {
    expect(() =>
      createClaim({
        id: claimId('claim-invalid'),
        campaignId: campaign,
        subject: 'beacon',
        predicate: 'is_cursed',
        object: true,
        source: { kind: 'EVENT', eventId: event },
        confidence: 1.1,
        revision: 1,
        createdAt: at,
      }),
    ).toThrow('confidence');
    expect(() =>
      createKnowledge({
        id: knowledgeId('knowledge-invalid'),
        campaignId: campaign,
        actor: { type: 'NPC', id: 'npc-keeper' },
        target: { kind: 'TRUTH', truthId: worldTruthId('truth-beacon') },
        state: 'KNOWN',
        visibility: 'ACTOR_PRIVATE',
        provenance: {
          kind: 'OBSERVATION',
          sourceId: 'event-observed',
          eventId: event,
          learnedAt: at,
          confidence: 1,
        },
        revision: 0,
      }),
    ).toThrow('Revision');
    expect(() =>
      createMemory({
        id: memoryId('memory-invalid'),
        campaignId: campaign,
        actor: { type: 'NPC', id: 'npc-keeper' },
        summary: 'A repeated source is not valid.',
        sourceKnowledgeIds: [knowledgeId('knowledge-one'), knowledgeId('knowledge-one')],
        sourceEventIds: [],
        revision: 1,
        createdAt: at,
      }),
    ).toThrow('duplicates');
  });
});

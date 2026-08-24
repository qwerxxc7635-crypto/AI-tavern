import { describe, expect, it } from 'vitest';

import {
  isoTimestamp,
  type TavernSceneActorProposal,
  type TavernSceneParticipant,
} from '@ember-tavern/contracts';
import { TavernSceneRuleError, arbitrateTavernScene } from './tavern-scene-arbiter.js';

const participants: readonly TavernSceneParticipant[] = [
  {
    npcId: 'npc-a',
    name: 'A',
    populationRole: 'owner',
    status: 'ACTIVE',
    joinedAt: isoTimestamp('2026-01-01T00:00:00.000Z'),
    leftAt: null,
  },
  {
    npcId: 'npc-b',
    name: 'B',
    populationRole: 'visitor',
    status: 'LISTENING',
    joinedAt: isoTimestamp('2026-01-01T00:00:00.000Z'),
    leftAt: null,
  },
];
const proposal = (
  value: Partial<TavernSceneActorProposal> & Pick<TavernSceneActorProposal, 'actorId' | 'action'>,
): TavernSceneActorProposal => ({
  targetNpcId: null,
  utterance:
    value.action === 'SPEAK' || value.action === 'INTERRUPT' || value.action === 'INTERVENE'
      ? 'A line.'
      : null,
  citedKnowledgeIds: [],
  urgency: 0,
  rationale: 'actor motive',
  ...value,
});

describe('arbitrateTavernScene', () => {
  it('selects an addressed actor by goals and knowledge instead of participant order', () => {
    const result = arbitrateTavernScene({
      participants,
      proposals: [
        proposal({ actorId: 'npc-a', action: 'SPEAK', urgency: 3 }),
        proposal({ actorId: 'npc-b', action: 'INTERVENE', citedKnowledgeIds: ['knowledge-b'] }),
      ],
      authorizedKnowledgeIds: { 'npc-a': [], 'npc-b': ['knowledge-b'] },
      addressedNpcId: 'npc-b',
      previousSpeakerNpcId: 'npc-a',
    });
    expect(result.find(({ actorId }) => actorId === 'npc-b')?.selected).toBe(true);
    expect(result.find(({ actorId }) => actorId === 'npc-a')?.selected).toBe(false);
  });

  it('retains silence and leave while selecting at most one vocal action', () => {
    const result = arbitrateTavernScene({
      participants,
      proposals: [
        proposal({ actorId: 'npc-a', action: 'LEAVE' }),
        proposal({ actorId: 'npc-b', action: 'EAVESDROP' }),
      ],
      authorizedKnowledgeIds: {},
      addressedNpcId: null,
      previousSpeakerNpcId: null,
    });
    expect(result.every(({ selected }) => selected)).toBe(true);
  });

  it('rejects another actor knowledge citation', () => {
    expect(() =>
      arbitrateTavernScene({
        participants,
        proposals: [
          proposal({ actorId: 'npc-a', action: 'SPEAK', citedKnowledgeIds: ['knowledge-b'] }),
          proposal({ actorId: 'npc-b', action: 'SILENCE' }),
        ],
        authorizedKnowledgeIds: { 'npc-a': [], 'npc-b': ['knowledge-b'] },
        addressedNpcId: null,
        previousSpeakerNpcId: null,
      }),
    ).toThrow(TavernSceneRuleError);
  });
});

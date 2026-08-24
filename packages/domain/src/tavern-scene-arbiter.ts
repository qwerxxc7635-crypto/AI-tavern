import {
  TAVERN_SCENE_ACTIONS,
  type TavernSceneActorProposal,
  type TavernSceneParticipant,
  type TavernSceneResolvedAction,
} from '@ember-tavern/contracts';

const VOCAL_ACTIONS = new Set(['SPEAK', 'INTERRUPT', 'INTERVENE']);

export interface ArbitrateTavernSceneInput {
  readonly participants: readonly TavernSceneParticipant[];
  readonly proposals: readonly TavernSceneActorProposal[];
  readonly authorizedKnowledgeIds: Readonly<Record<string, readonly string[]>>;
  readonly addressedNpcId: string | null;
  readonly previousSpeakerNpcId: string | null;
}

export class TavernSceneRuleError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'TavernSceneRuleError';
  }
}

export function arbitrateTavernScene(
  input: ArbitrateTavernSceneInput,
): readonly TavernSceneResolvedAction[] {
  const participants = new Map(
    input.participants.map((participant) => [participant.npcId, participant]),
  );
  const seen = new Set<string>();
  const validated = input.proposals.map((proposal) => {
    const participant = participants.get(proposal.actorId);
    if (participant === undefined || participant.status === 'LEFT' || seen.has(proposal.actorId)) {
      throw new TavernSceneRuleError('Every eligible actor may submit exactly one proposal');
    }
    seen.add(proposal.actorId);
    if (!TAVERN_SCENE_ACTIONS.includes(proposal.action)) {
      throw new TavernSceneRuleError('Proposal action is invalid');
    }
    if (proposal.targetNpcId !== null && !participants.has(proposal.targetNpcId)) {
      throw new TavernSceneRuleError('Proposal target is outside the scene');
    }
    if (proposal.action === 'INTERVENE' && participant.status !== 'LISTENING') {
      throw new TavernSceneRuleError('Only a listening actor may intervene');
    }
    if (proposal.action === 'INTERRUPT' && input.previousSpeakerNpcId === null) {
      throw new TavernSceneRuleError('An interruption requires a previous speaker');
    }
    const vocal = VOCAL_ACTIONS.has(proposal.action);
    if (vocal !== (proposal.utterance !== null && proposal.utterance.trim().length > 0)) {
      throw new TavernSceneRuleError('Utterance presence does not match the action');
    }
    const authorized = new Set(input.authorizedKnowledgeIds[proposal.actorId] ?? []);
    if (
      new Set(proposal.citedKnowledgeIds).size !== proposal.citedKnowledgeIds.length ||
      proposal.citedKnowledgeIds.some((id) => !authorized.has(id))
    ) {
      throw new TavernSceneRuleError('Proposal cites knowledge outside the actor scope');
    }
    return proposal;
  });
  const missing = input.participants.filter(
    ({ status, npcId }) => status !== 'LEFT' && !seen.has(npcId),
  );
  if (missing.length > 0)
    throw new TavernSceneRuleError('Every eligible actor must submit a proposal');

  const vocal = validated.filter((proposal) => VOCAL_ACTIONS.has(proposal.action));
  const winner = [...vocal].sort((left, right) => {
    const score = (proposal: TavernSceneActorProposal): number =>
      proposal.urgency * 10 +
      proposal.citedKnowledgeIds.length * 4 +
      (proposal.actorId === input.addressedNpcId ? 30 : 0) +
      (proposal.action === 'INTERRUPT' ? 3 : proposal.action === 'INTERVENE' ? 2 : 1);
    return score(right) - score(left) || left.actorId.localeCompare(right.actorId);
  })[0];
  return Object.freeze(
    validated.map((proposal) =>
      Object.freeze({
        ...proposal,
        selected: !VOCAL_ACTIONS.has(proposal.action) || proposal === winner,
      }),
    ),
  );
}

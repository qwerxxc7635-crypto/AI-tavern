import type {
  CampaignId,
  Claim,
  JsonValue,
  Knowledge,
  KnowledgeActor,
  KnowledgeId,
  KnowledgeState,
  Memory,
  TruthVisibility,
  WorldTruth,
} from '@ember-tavern/contracts';

export interface ActorKnowledgeEntry {
  readonly knowledgeId: KnowledgeId;
  readonly targetKind: 'TRUTH' | 'CLAIM';
  readonly state: KnowledgeState;
  readonly subject: string;
  readonly predicate: string;
  readonly object: JsonValue;
  readonly confidence: number;
  readonly truthVisibility: TruthVisibility | null;
  readonly revision: number;
}

export interface ActorKnowledgeProjection {
  readonly campaignId: CampaignId;
  readonly actor: KnowledgeActor;
  readonly entries: readonly ActorKnowledgeEntry[];
  readonly memories: readonly Memory[];
}

export interface PromptKnowledgeEntry {
  readonly targetKind: 'TRUTH' | 'CLAIM';
  readonly state: KnowledgeState;
  readonly subject: string;
  readonly predicate: string;
  readonly object: JsonValue;
  readonly confidence: number;
}

export class KnowledgeBoundaryError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'KnowledgeBoundaryError';
  }
}

export function projectActorKnowledge(input: {
  readonly campaignId: CampaignId;
  readonly actor: KnowledgeActor;
  readonly knowledge: readonly Knowledge[];
  readonly truths: readonly WorldTruth[];
  readonly claims: readonly Claim[];
  readonly memories: readonly Memory[];
}): ActorKnowledgeProjection {
  const truths = uniqueById(
    input.truths.filter(({ campaignId }) => campaignId === input.campaignId),
    'World Truth',
  );
  const claims = uniqueById(
    input.claims.filter(({ campaignId }) => campaignId === input.campaignId),
    'Claim',
  );
  const actorKnowledge = input.knowledge
    .filter(
      ({ campaignId, actor }) => campaignId === input.campaignId && sameActor(actor, input.actor),
    )
    .sort((left, right) => left.id.localeCompare(right.id));
  const seenTargets = new Set<string>();
  const entries = actorKnowledge.map((knowledge): ActorKnowledgeEntry => {
    const targetKey =
      knowledge.target.kind === 'TRUTH'
        ? `TRUTH:${knowledge.target.truthId}`
        : `CLAIM:${knowledge.target.claimId}`;
    if (seenTargets.has(targetKey)) {
      throw new KnowledgeBoundaryError('An actor cannot hold duplicate knowledge for one target');
    }
    seenTargets.add(targetKey);
    if (knowledge.target.kind === 'TRUTH') {
      const truth = truths.get(knowledge.target.truthId);
      if (truth === undefined) {
        throw new KnowledgeBoundaryError('Actor Knowledge references an unavailable World Truth');
      }
      return Object.freeze({
        knowledgeId: knowledge.id,
        targetKind: 'TRUTH',
        state: knowledge.state,
        subject: truth.subject,
        predicate: truth.predicate,
        object: truth.object,
        confidence: knowledge.provenance.confidence,
        truthVisibility: truth.visibility,
        revision: knowledge.revision,
      });
    }
    const claim = claims.get(knowledge.target.claimId);
    if (claim === undefined) {
      throw new KnowledgeBoundaryError('Actor Knowledge references an unavailable Claim');
    }
    return Object.freeze({
      knowledgeId: knowledge.id,
      targetKind: 'CLAIM',
      state: knowledge.state,
      subject: claim.subject,
      predicate: claim.predicate,
      object: claim.object,
      confidence: Math.min(claim.confidence, knowledge.provenance.confidence),
      truthVisibility: null,
      revision: knowledge.revision,
    });
  });
  const memories = input.memories
    .filter(
      ({ campaignId, actor }) => campaignId === input.campaignId && sameActor(actor, input.actor),
    )
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((memory) => {
      for (const id of memory.sourceKnowledgeIds) {
        const matching = input.knowledge.find((entry) => entry.id === id);
        if (matching !== undefined && !sameActor(matching.actor, input.actor)) {
          throw new KnowledgeBoundaryError('Memory references Knowledge owned by another actor');
        }
      }
      return memory;
    });
  return Object.freeze({
    campaignId: input.campaignId,
    actor: Object.freeze({ ...input.actor }),
    entries: Object.freeze(entries),
    memories: Object.freeze(memories),
  });
}

export function knowledgeForPrompt(
  projection: ActorKnowledgeProjection,
): readonly PromptKnowledgeEntry[] {
  return Object.freeze(
    projection.entries.map((entry) =>
      Object.freeze({
        targetKind: entry.targetKind,
        state: entry.state,
        subject: entry.subject,
        predicate: entry.predicate,
        object: entry.object,
        confidence: entry.confidence,
      }),
    ),
  );
}

function sameActor(left: KnowledgeActor, right: KnowledgeActor): boolean {
  return left.type === right.type && left.id === right.id;
}

function uniqueById<const Value extends { readonly id: string }>(
  values: readonly Value[],
  label: string,
): ReadonlyMap<string, Value> {
  const result = new Map<string, Value>();
  for (const value of values) {
    if (result.has(value.id)) throw new KnowledgeBoundaryError(`${label} IDs must be unique`);
    result.set(value.id, value);
  }
  return result;
}

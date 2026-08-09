import type {
  CampaignId,
  ClaimId,
  GameEventId,
  IsoTimestamp,
  KnowledgeId,
  MemoryId,
  WorldTruthId,
} from './foundation.js';
import type { JsonValue } from './pending-ai-request.js';

export const TRUTH_AUTHORITIES = [
  'LOCAL_RULE',
  'USER_ACCEPTANCE',
  'DOMAIN_TRANSACTION',
  'IMPORT',
] as const;
export type TruthAuthority = (typeof TRUTH_AUTHORITIES)[number];

export const TRUTH_VISIBILITIES = ['PUBLIC', 'GAME_PRIVATE', 'SECRET'] as const;
export type TruthVisibility = (typeof TRUTH_VISIBILITIES)[number];

export interface WorldTruth {
  readonly kind: 'WORLD_TRUTH';
  readonly id: WorldTruthId;
  readonly campaignId: CampaignId;
  readonly subject: string;
  readonly predicate: string;
  readonly object: JsonValue;
  readonly authority: TruthAuthority;
  readonly visibility: TruthVisibility;
  readonly sourceEventId: GameEventId | null;
  readonly revision: number;
  readonly createdAt: IsoTimestamp;
}

export type ClaimSource =
  | { readonly kind: 'TRUTH'; readonly truthId: WorldTruthId }
  | { readonly kind: 'EVENT'; readonly eventId: GameEventId }
  | {
      readonly kind: 'ACTOR';
      readonly actorType: KnowledgeActorType;
      readonly actorId: string;
    };

export interface Claim {
  readonly kind: 'CLAIM';
  readonly id: ClaimId;
  readonly campaignId: CampaignId;
  readonly subject: string;
  readonly predicate: string;
  readonly object: JsonValue;
  readonly source: ClaimSource;
  readonly confidence: number;
  readonly revision: number;
  readonly createdAt: IsoTimestamp;
}

export const KNOWLEDGE_ACTOR_TYPES = ['NPC', 'PLAYER_CHARACTER'] as const;
export type KnowledgeActorType = (typeof KNOWLEDGE_ACTOR_TYPES)[number];

export interface KnowledgeActor {
  readonly type: KnowledgeActorType;
  readonly id: string;
}

export type KnowledgeTarget =
  | { readonly kind: 'TRUTH'; readonly truthId: WorldTruthId }
  | { readonly kind: 'CLAIM'; readonly claimId: ClaimId };

export const KNOWLEDGE_STATES = ['KNOWN', 'SUSPECTED', 'BELIEVED'] as const;
export type KnowledgeState = (typeof KNOWLEDGE_STATES)[number];

export const KNOWLEDGE_VISIBILITIES = ['ACTOR_PRIVATE', 'SHARED'] as const;
export type KnowledgeVisibility = (typeof KNOWLEDGE_VISIBILITIES)[number];

export const KNOWLEDGE_PROVENANCE_KINDS = [
  'OBSERVATION',
  'COMMUNICATION',
  'INFERENCE',
  'IMPORT',
] as const;
export type KnowledgeProvenanceKind = (typeof KNOWLEDGE_PROVENANCE_KINDS)[number];

export interface KnowledgeProvenance {
  readonly kind: KnowledgeProvenanceKind;
  readonly sourceId: string;
}

export interface Knowledge {
  readonly kind: 'KNOWLEDGE';
  readonly id: KnowledgeId;
  readonly campaignId: CampaignId;
  readonly actor: KnowledgeActor;
  readonly target: KnowledgeTarget;
  readonly state: KnowledgeState;
  readonly visibility: KnowledgeVisibility;
  readonly provenance: KnowledgeProvenance;
  readonly revision: number;
}

export interface Memory {
  readonly kind: 'MEMORY';
  readonly id: MemoryId;
  readonly campaignId: CampaignId;
  readonly actor: KnowledgeActor;
  readonly summary: string;
  readonly sourceKnowledgeIds: readonly KnowledgeId[];
  readonly sourceEventIds: readonly GameEventId[];
  readonly revision: number;
  readonly createdAt: IsoTimestamp;
}

export class KnowledgeModelError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'KnowledgeModelError';
  }
}

export function createWorldTruth(input: Omit<WorldTruth, 'kind'>): WorldTruth {
  requireEnum(TRUTH_AUTHORITIES, input.authority, 'WorldTruth authority');
  requireEnum(TRUTH_VISIBILITIES, input.visibility, 'WorldTruth visibility');
  return Object.freeze({
    ...input,
    kind: 'WORLD_TRUTH',
    subject: requireText(input.subject, 'WorldTruth subject'),
    predicate: requireText(input.predicate, 'WorldTruth predicate'),
    object: freezeJson(input.object, 'WorldTruth object'),
    revision: requireRevision(input.revision),
  });
}

export function createClaim(input: Omit<Claim, 'kind'>): Claim {
  validateClaimSource(input.source);
  return Object.freeze({
    ...input,
    kind: 'CLAIM',
    subject: requireText(input.subject, 'Claim subject'),
    predicate: requireText(input.predicate, 'Claim predicate'),
    object: freezeJson(input.object, 'Claim object'),
    source: Object.freeze({ ...input.source }),
    confidence: requireConfidence(input.confidence),
    revision: requireRevision(input.revision),
  });
}

export function createKnowledge(input: Omit<Knowledge, 'kind'>): Knowledge {
  validateActor(input.actor);
  validateKnowledgeTarget(input.target);
  requireEnum(KNOWLEDGE_STATES, input.state, 'Knowledge state');
  requireEnum(KNOWLEDGE_VISIBILITIES, input.visibility, 'Knowledge visibility');
  requireEnum(KNOWLEDGE_PROVENANCE_KINDS, input.provenance.kind, 'Knowledge provenance kind');
  return Object.freeze({
    ...input,
    kind: 'KNOWLEDGE',
    actor: Object.freeze({ ...input.actor }),
    target: Object.freeze({ ...input.target }),
    provenance: Object.freeze({
      ...input.provenance,
      sourceId: requireText(input.provenance.sourceId, 'Knowledge provenance sourceId'),
    }),
    revision: requireRevision(input.revision),
  });
}

export function createMemory(input: Omit<Memory, 'kind'>): Memory {
  validateActor(input.actor);
  if (input.sourceKnowledgeIds.length === 0 && input.sourceEventIds.length === 0) {
    throw new KnowledgeModelError('Memory requires a Knowledge or Event source');
  }
  requireUnique(input.sourceKnowledgeIds, 'Memory sourceKnowledgeIds');
  requireUnique(input.sourceEventIds, 'Memory sourceEventIds');
  return Object.freeze({
    ...input,
    kind: 'MEMORY',
    actor: Object.freeze({ ...input.actor }),
    summary: requireText(input.summary, 'Memory summary'),
    sourceKnowledgeIds: Object.freeze([...input.sourceKnowledgeIds]),
    sourceEventIds: Object.freeze([...input.sourceEventIds]),
    revision: requireRevision(input.revision),
  });
}

function validateActor(actor: KnowledgeActor): void {
  requireEnum(KNOWLEDGE_ACTOR_TYPES, actor.type, 'Knowledge actor type');
  requireText(actor.id, 'Knowledge actor id');
}

function validateClaimSource(source: ClaimSource): void {
  if (source.kind === 'TRUTH' || source.kind === 'EVENT') return;
  if (source.kind === 'ACTOR') {
    validateActor({ type: source.actorType, id: source.actorId });
    return;
  }
  throw new KnowledgeModelError('Claim source must be a Truth, Event, or Actor');
}

function validateKnowledgeTarget(target: KnowledgeTarget): void {
  if (target.kind !== 'TRUTH' && target.kind !== 'CLAIM') {
    throw new KnowledgeModelError('Knowledge target must be a Truth or Claim');
  }
}

function requireText(value: string, label: string): string {
  if (value.length === 0 || value.trim() !== value) {
    throw new KnowledgeModelError(`${label} must be non-empty without surrounding whitespace`);
  }
  return value;
}

function requireRevision(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new KnowledgeModelError('Revision must be a positive safe integer');
  }
  return value;
}

function requireConfidence(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new KnowledgeModelError('Claim confidence must be between 0 and 1');
  }
  return value;
}

function requireUnique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) {
    throw new KnowledgeModelError(`${label} must not contain duplicates`);
  }
}

function requireEnum<const Values extends readonly string[]>(
  values: Values,
  value: Values[number],
  label: string,
): void {
  if (!(values as readonly unknown[]).includes(value)) {
    throw new KnowledgeModelError(`${label} is invalid`);
  }
}

function freezeJson(value: JsonValue, label: string, seen = new WeakSet<object>()): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value))
      throw new KnowledgeModelError(`${label} must contain finite numbers`);
    return value;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new KnowledgeModelError(`${label} must not contain cycles`);
    seen.add(value);
    const result = Object.freeze(value.map((entry) => freezeJson(entry, label, seen)));
    seen.delete(value);
    return result;
  }
  if (typeof value !== 'object') throw new KnowledgeModelError(`${label} must be valid JSON`);
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    throw new KnowledgeModelError(`${label} must contain plain JSON objects`);
  }
  if (seen.has(value)) throw new KnowledgeModelError(`${label} must not contain cycles`);
  seen.add(value);
  const result: Record<string, JsonValue> = {};
  for (const [key, entry] of Object.entries(value)) {
    result[key] = freezeJson(entry, label, seen);
  }
  seen.delete(value);
  return Object.freeze(result);
}

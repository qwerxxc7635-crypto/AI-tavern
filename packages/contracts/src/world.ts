import type {
  CampaignId,
  ClaimId,
  FactionId,
  IsoTimestamp,
  LocationId,
  NpcId,
  SchemaVersion,
  WorldFactId,
} from './foundation.js';

export type FactionDisposition = 'ALLY' | 'FRIENDLY' | 'NEUTRAL' | 'HOSTILE' | 'WAR';

export interface FactionRelation {
  readonly factionId: FactionId;
  readonly disposition: FactionDisposition;
  readonly summary: string;
}

export interface Faction {
  readonly id: FactionId;
  readonly name: string;
  readonly description: string;
  readonly goals: readonly string[];
  readonly relations: readonly FactionRelation[];
}

export interface Location {
  readonly id: LocationId;
  readonly name: string;
  readonly description: string;
  readonly parentLocationId: LocationId | null;
  readonly factionIds: readonly FactionId[];
}

export const WORLD_BIBLE_LOCKABLE_FIELDS = [
  'name',
  'currentRegion',
  'summary',
  'coreConflict',
  'technologyLevel',
  'powerRules',
  'narrativeStyle',
  'forbiddenElements',
  'tavernReason',
] as const;

export type WorldBibleLockableField = (typeof WORLD_BIBLE_LOCKABLE_FIELDS)[number];

export interface WorldBible {
  readonly campaignId: CampaignId;
  readonly schemaVersion: SchemaVersion;
  readonly name: string;
  readonly currentRegion: string;
  readonly summary: string;
  readonly coreConflict: string;
  readonly technologyLevel: string;
  readonly powerRules: readonly string[];
  readonly factions: readonly Faction[];
  readonly locations: readonly Location[];
  readonly narrativeStyle: string;
  readonly forbiddenElements: readonly string[];
  readonly tavernReason: string;
  readonly storyHooks: readonly string[];
  readonly lockedFields: readonly WorldBibleLockableField[];
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
}

interface WorldFactBase {
  readonly id: WorldFactId;
  readonly campaignId: CampaignId;
  readonly statement: string;
  readonly locationId: LocationId | null;
  readonly factionIds: readonly FactionId[];
  readonly createdAt: IsoTimestamp;
}

export interface LockedRuleFact extends WorldFactBase {
  readonly kind: 'LOCKED_RULE';
  readonly field: WorldBibleLockableField;
}

export interface DevelopingFact extends WorldFactBase {
  readonly kind: 'DEVELOPING_FACT';
  readonly supersedesFactId: WorldFactId | null;
}

export interface TemporaryNarrativeFact extends WorldFactBase {
  readonly kind: 'TEMPORARY_NARRATIVE';
  readonly expiresAt: IsoTimestamp | null;
}

export type RumorVeracity = 'UNKNOWN' | 'TRUE' | 'PARTIAL' | 'FALSE';
export const RUMOR_SOURCE_BASES = [
  'WITNESS',
  'HEARSAY',
  'PERSONAL_BELIEF',
  'FACTION_MESSAGE',
] as const;
export type RumorSourceBasis = (typeof RUMOR_SOURCE_BASES)[number];

export interface RumorFact extends WorldFactBase {
  readonly kind: 'RUMOR';
  readonly claimId: ClaimId;
  readonly sourceNpcId: NpcId;
  readonly sourceBasis: RumorSourceBasis;
  readonly confidence: number;
  readonly claimRevision: number;
  readonly veracity: RumorVeracity;
}

export interface FalseBeliefFact extends WorldFactBase {
  readonly kind: 'FALSE_BELIEF';
  readonly believedByNpcIds: readonly NpcId[];
}

export type WorldFact =
  LockedRuleFact | DevelopingFact | TemporaryNarrativeFact | RumorFact | FalseBeliefFact;

export function isLockedWorldFact(fact: WorldFact): fact is LockedRuleFact {
  return fact.kind === 'LOCKED_RULE';
}

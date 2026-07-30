import type { CampaignId, NpcRelationship, WorldClockId } from '@ember-tavern/contracts';

const RELATIONSHIP_DIMENSIONS = ['trust', 'closeness', 'awe', 'obligation'] as const;
type RelationshipDimension = (typeof RELATIONSHIP_DIMENSIONS)[number];

export type RelationshipPatch = Partial<Record<RelationshipDimension, number>>;

export class DomainPatchError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'DomainPatchError';
  }
}

export function applyRelationshipPatch(
  relationship: NpcRelationship,
  patch: RelationshipPatch,
): NpcRelationship {
  const result = { ...relationship };
  let changed = false;

  for (const dimension of RELATIONSHIP_DIMENSIONS) {
    const delta = patch[dimension];
    if (delta === undefined) continue;
    changed = true;
    if (!Number.isInteger(delta) || Math.abs(delta) > 1) {
      throw new DomainPatchError(`${dimension} may change by at most 1 per turn`);
    }
    const next = relationship[dimension] + delta;
    if (next < -5 || next > 5) {
      throw new DomainPatchError(`${dimension} result must remain from -5 to 5`);
    }
    result[dimension] = next;
  }

  if (!changed)
    throw new DomainPatchError('Relationship patch must include at least one dimension');
  return Object.freeze(result);
}

export interface WorldClockStage {
  readonly at: number;
  readonly title: string;
}

export interface WorldClock {
  readonly id: WorldClockId;
  readonly campaignId: CampaignId;
  readonly name: string;
  readonly current: number;
  readonly max: number;
  readonly stages: readonly WorldClockStage[];
}

export interface WorldClockAdvanceResult {
  readonly clock: WorldClock;
  readonly triggeredStages: readonly WorldClockStage[];
}

export function advanceWorldClock(clock: WorldClock, amount: number): WorldClockAdvanceResult {
  validateClock(clock);
  if (amount !== 1) throw new DomainPatchError('World clock advances exactly 1 per accepted patch');
  if (clock.current === clock.max) throw new DomainPatchError('World clock is already complete');

  const next = clock.current + amount;
  const triggeredStages = clock.stages.filter(
    (stage) => stage.at > clock.current && stage.at <= next,
  );
  return Object.freeze({
    clock: Object.freeze({ ...clock, current: next, stages: Object.freeze([...clock.stages]) }),
    triggeredStages: Object.freeze([...triggeredStages]),
  });
}

function validateClock(clock: WorldClock): void {
  if (!Number.isSafeInteger(clock.max) || clock.max < 1) {
    throw new DomainPatchError('World clock max must be a positive safe integer');
  }
  if (!Number.isSafeInteger(clock.current) || clock.current < 0 || clock.current > clock.max) {
    throw new DomainPatchError('World clock current value must be from 0 to max');
  }
  const thresholds = new Set<number>();
  for (const stage of clock.stages) {
    if (!Number.isSafeInteger(stage.at) || stage.at < 1 || stage.at > clock.max) {
      throw new DomainPatchError('World clock stage threshold must be from 1 to max');
    }
    if (thresholds.has(stage.at))
      throw new DomainPatchError('World clock stage thresholds must be unique');
    thresholds.add(stage.at);
  }
}

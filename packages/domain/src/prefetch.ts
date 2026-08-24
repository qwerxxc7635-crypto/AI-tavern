import {
  PrefetchContractError,
  type DirectorBudgetSnapshot,
  type LazyWorldGenerationPlan,
  type PrefetchCandidateSeed,
  type WorldDirectorProposal,
  type WorldDirectorRun,
} from '@ember-tavern/contracts';

const MAX_PREFETCH_CANDIDATES = 4;

export interface PredictPrefetchInput {
  readonly run: WorldDirectorRun;
  readonly budget: DirectorBudgetSnapshot;
  readonly plans: readonly LazyWorldGenerationPlan[];
  readonly predictedAt: PrefetchCandidateSeed['predictedAt'];
  readonly createCandidateId: (ordinal: number) => string;
}

export function predictPrefetch(input: PredictPrefetchInput): readonly PrefetchCandidateSeed[] {
  validate(input);
  const eligible = input.plans
    .filter(
      (plan) =>
        plan.executionMode === 'BACKGROUND_ELIGIBLE' &&
        (plan.kind === 'LOCATION_DETAILS' || plan.kind === 'FACTION_DETAILS') &&
        (plan.state === 'PLANNED' || (plan.state === 'FAILED' && plan.retryable)),
    )
    .sort(comparePlan);
  const byTarget = new Map(eligible.map((plan) => [`${plan.kind}:${plan.targetId}`, plan]));
  const admittedEntries = input.budget.entries.filter(({ runId }) => runId === input.run.id);
  const approved = new Set(
    admittedEntries.filter(({ status }) => status === 'APPROVED').map(({ actionId }) => actionId),
  );
  const predicted: Omit<PrefetchCandidateSeed, 'id'>[] = [];
  const selected = new Set<string>();
  for (const proposal of input.run.proposals) {
    if (!approved.has(proposal.id)) continue;
    const plan = planForProposal(proposal, byTarget);
    if (plan === null || selected.has(plan.intentKey)) continue;
    selected.add(plan.intentKey);
    predicted.push({
      campaignId: input.run.campaignId,
      directorRunId: input.run.id,
      lazyIntentKey: plan.intentKey,
      kind: plan.kind as PrefetchCandidateSeed['kind'],
      targetId: plan.targetId,
      priority: 'P1',
      sourceActionId: proposal.id,
      predictionReason: 'DIRECTOR_APPROVED',
      contextDigest: input.run.contextDigest,
      predictedAt: input.predictedAt,
    });
    if (predicted.length === MAX_PREFETCH_CANDIDATES) break;
  }
  const backgroundCapacity = Math.max(
    0,
    input.budget.limits.backgroundChanges - input.budget.usage.backgroundChanges,
  );
  let backgroundAdded = 0;
  for (const plan of eligible) {
    if (
      predicted.length === MAX_PREFETCH_CANDIDATES ||
      backgroundAdded >= backgroundCapacity ||
      selected.has(plan.intentKey)
    ) {
      continue;
    }
    selected.add(plan.intentKey);
    backgroundAdded += 1;
    predicted.push({
      campaignId: input.run.campaignId,
      directorRunId: input.run.id,
      lazyIntentKey: plan.intentKey,
      kind: plan.kind as PrefetchCandidateSeed['kind'],
      targetId: plan.targetId,
      priority: 'P2',
      sourceActionId: null,
      predictionReason: 'BACKGROUND_CAPACITY',
      contextDigest: input.run.contextDigest,
      predictedAt: input.predictedAt,
    });
  }
  return Object.freeze(
    predicted.map((candidate, index) =>
      Object.freeze({ ...candidate, id: identity(input.createCandidateId(index + 1)) }),
    ),
  );
}

function planForProposal(
  proposal: WorldDirectorProposal,
  plans: ReadonlyMap<string, LazyWorldGenerationPlan>,
): LazyWorldGenerationPlan | null {
  if (proposal.kind === 'FACTION_ACTION' && proposal.actorEntityId !== null) {
    return plans.get(`FACTION_DETAILS:${proposal.actorEntityId}`) ?? null;
  }
  for (const target of proposal.targetEntityIds) {
    const location = plans.get(`LOCATION_DETAILS:${target}`);
    if (location !== undefined) return location;
    const faction = plans.get(`FACTION_DETAILS:${target}`);
    if (faction !== undefined) return faction;
  }
  return null;
}

function validate(input: PredictPrefetchInput): void {
  if (
    input.run.campaignId !== input.budget.campaignId ||
    input.plans.some(({ campaignId }) => campaignId !== input.run.campaignId)
  ) {
    throw new PrefetchContractError('Prefetch sources belong to different campaigns');
  }
  if (input.budget.updatedAt < input.run.createdAt) {
    throw new PrefetchContractError('Prefetch requires Director Budget admission');
  }
}

function comparePlan(left: LazyWorldGenerationPlan, right: LazyWorldGenerationPlan): number {
  return (
    (left.kind === 'LOCATION_DETAILS' ? 0 : 1) - (right.kind === 'LOCATION_DETAILS' ? 0 : 1) ||
    compareText(left.targetId, right.targetId)
  );
}

function compareText(left: string, right: string): number {
  const a = [...left];
  const b = [...right];
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    const difference = (a[index]?.codePointAt(0) ?? 0) - (b[index]?.codePointAt(0) ?? 0);
    if (difference !== 0) return difference;
  }
  return a.length - b.length;
}

function identity(value: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,255}$/u.test(value)) {
    throw new PrefetchContractError('Prefetch candidate ID is invalid');
  }
  return value;
}

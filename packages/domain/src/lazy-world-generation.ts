import {
  createLazyWorldGenerationPlanSeed,
  lazyWorldIntentKey,
  type CoreWorldGenerationPlanInput,
  type LazyWorldGenerationKind,
  type LazyWorldGenerationPlanSeed,
} from '@ember-tavern/contracts';

export class LazyWorldGenerationPlanningError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'LazyWorldGenerationPlanningError';
  }
}

export function buildCoreWorldGenerationPlan(
  input: CoreWorldGenerationPlanInput,
): readonly LazyWorldGenerationPlanSeed[] {
  const { world, constitution, plannedAt } = input;
  if (
    world.campaignId !== constitution.campaignId ||
    constitution.status !== 'LOCKED' ||
    constitution.lockedAt === null ||
    !input.hasWorldSeed
  ) {
    throw new LazyWorldGenerationPlanningError(
      'Lazy world generation requires one locked, seeded core world',
    );
  }
  const seenTargets = new Set<string>();
  const seeds: LazyWorldGenerationPlanSeed[] = [];
  const add = (
    kind: LazyWorldGenerationKind,
    targetId: string,
    executionMode: LazyWorldGenerationPlanSeed['executionMode'],
    priority: LazyWorldGenerationPlanSeed['priority'],
    dependency: string | null = null,
  ) => {
    const identity = `${kind}:${targetId}`;
    if (seenTargets.has(identity)) {
      throw new LazyWorldGenerationPlanningError('Lazy world targets must be unique');
    }
    seenTargets.add(identity);
    seeds.push(
      createLazyWorldGenerationPlanSeed({
        intentKey: lazyWorldIntentKey(world.campaignId, kind, targetId),
        campaignId: world.campaignId,
        kind,
        targetId,
        executionMode,
        priority,
        dependsOnIntentKey: dependency,
        createdAt: plannedAt,
      }),
    );
  };

  add('INITIAL_CAREER_POOL', world.campaignId, 'ON_DEMAND', 'P0');
  const tavernIntent = lazyWorldIntentKey(world.campaignId, 'TAVERN', world.campaignId);
  add('TAVERN', world.campaignId, 'ON_DEMAND', 'P0');
  add('TAVERN_ROSTER', world.campaignId, 'ON_DEMAND', 'P0', tavernIntent);
  for (const location of world.locations) {
    add('LOCATION_DETAILS', location.id, 'BACKGROUND_ELIGIBLE', 'P2');
  }
  for (const faction of world.factions) {
    add('FACTION_DETAILS', faction.id, 'BACKGROUND_ELIGIBLE', 'P2');
  }
  return Object.freeze(seeds);
}

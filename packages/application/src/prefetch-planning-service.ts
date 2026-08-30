import {
  type CampaignId,
  type DirectorBudgetSnapshot,
  type IsoTimestamp,
  type LazyWorldGenerationPlan,
  type PrefetchCandidate,
  type PrefetchCandidateSeed,
  type WorldDirectorRun,
} from '@ember-tavern/contracts';
import { predictPrefetch } from '@ember-tavern/domain';

export interface PrefetchPlanSource {
  list(campaign: CampaignId): readonly LazyWorldGenerationPlan[];
}

export interface PrefetchScheduler {
  schedule(seeds: readonly PrefetchCandidateSeed[]): readonly PrefetchCandidate[];
  invalidate(
    campaign: CampaignId,
    reason: 'SUPERSEDED' | 'PROCESS_RESTART' | 'P0_PREEMPTED',
    exceptRunId?: string | null,
  ): void;
  prioritizeP0(campaign: CampaignId): void;
}

export interface PlanPrefetchCommand {
  readonly run: WorldDirectorRun;
  readonly budget: DirectorBudgetSnapshot;
  readonly predictedAt: IsoTimestamp;
}

export interface PrefetchCandidateIdentityFactory {
  create(run: WorldDirectorRun, ordinal: number): string;
}

/**
 * Admits bounded Director predictions only after every core P0 intent is complete.
 * Candidate preparation is delegated to PrefetchScheduler and never commits a
 * generated world artifact by itself.
 */
export class PrefetchPlanningService {
  public constructor(
    private readonly plans: PrefetchPlanSource,
    private readonly scheduler: PrefetchScheduler,
    private readonly identities: PrefetchCandidateIdentityFactory,
  ) {}

  public plan(command: PlanPrefetchCommand): readonly PrefetchCandidate[] {
    const plans = this.plans.list(command.run.campaignId);
    if (plans.some((plan) => plan.priority === 'P0' && plan.state !== 'SUCCEEDED')) {
      this.scheduler.prioritizeP0(command.run.campaignId);
      return Object.freeze([]);
    }

    this.scheduler.invalidate(command.run.campaignId, 'SUPERSEDED', command.run.id);
    const seeds = predictPrefetch({
      run: command.run,
      budget: command.budget,
      plans,
      predictedAt: command.predictedAt,
      createCandidateId: (ordinal) => this.identities.create(command.run, ordinal),
    });
    return seeds.length === 0 ? Object.freeze([]) : this.scheduler.schedule(seeds);
  }

  public recoverAfterProcessRestart(campaign: CampaignId): void {
    this.scheduler.invalidate(campaign, 'PROCESS_RESTART');
  }
}

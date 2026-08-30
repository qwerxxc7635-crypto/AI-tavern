import type { AITask, GenerationQueue, GenerationQueueHandle } from '@ember-tavern/ai-core';
import {
  isoTimestamp,
  type CampaignId,
  type IsoTimestamp,
  type PrefetchCandidate,
  type PrefetchCandidateSeed,
} from '@ember-tavern/contracts';

export interface PrefetchStore {
  savePredictions(seeds: readonly PrefetchCandidateSeed[]): readonly PrefetchCandidate[];
  get(id: string): PrefetchCandidate | null;
  list(campaign: CampaignId): readonly PrefetchCandidate[];
  start(command: {
    readonly id: string;
    readonly executionId: string;
    readonly processId: string;
    readonly occurredAt: IsoTimestamp;
    readonly queueWaitMs: number;
  }): PrefetchCandidate;
  ready(command: {
    readonly id: string;
    readonly executionId: string;
    readonly processId: string;
    readonly occurredAt: IsoTimestamp;
    readonly generationMs: number;
  }): PrefetchCandidate;
  hit(id: string, contextDigest: string, at: IsoTimestamp): PrefetchCandidate;
  miss(id: string, reason: 'NOT_READY' | 'CONTEXT_CHANGED', at: IsoTimestamp): PrefetchCandidate;
  recordUnpredictedMiss(
    campaign: CampaignId,
    kind: PrefetchCandidateSeed['kind'],
    targetId: string,
    at: IsoTimestamp,
  ): void;
  invalidateOpen(
    campaign: CampaignId,
    reason: 'SUPERSEDED' | 'PROCESS_RESTART' | 'P0_PREEMPTED',
    at: IsoTimestamp,
    exceptRunId?: string | null,
  ): readonly PrefetchCandidate[];
  reject(id: string, errorCode: string, at: IsoTimestamp): PrefetchCandidate;
  fail(id: string, executionId: string, errorCode: string, at: IsoTimestamp): PrefetchCandidate;
}

export interface PrefetchExecutor {
  prepare(candidate: PrefetchCandidate, signal: AbortSignal): Promise<unknown>;
}

export interface PrefetchClock {
  now(): number;
  timestamp(): IsoTimestamp;
}

interface CachedCandidate {
  readonly candidate: PrefetchCandidate;
  readonly value: unknown;
}

export class PrefetchCoordinator {
  private readonly active = new Map<string, GenerationQueueHandle<unknown>>();
  private readonly cache = new Map<string, CachedCandidate>();

  public constructor(
    private readonly repository: PrefetchStore,
    private readonly executor: PrefetchExecutor,
    private readonly queue: GenerationQueue,
    private readonly processId: string,
    private readonly clock: PrefetchClock = systemClock,
  ) {}

  public schedule(seeds: readonly PrefetchCandidateSeed[]): readonly PrefetchCandidate[] {
    const candidates = this.repository.savePredictions(seeds);
    for (const candidate of candidates) {
      if (candidate.state !== 'PREDICTED' || this.active.has(candidate.id)) continue;
      const queuedAt = this.clock.now();
      const executionId = `prefetch-execution:${candidate.id}:${candidate.revision}`;
      let handle: GenerationQueueHandle<unknown>;
      try {
        handle = this.queue.submit({
          id: executionId,
          intentKey: `prefetch:${candidate.id}`,
          task: taskFor(candidate.kind),
          priority: candidate.priority,
          timeoutMs: 12_000,
          maxRetries: 0,
          allowFallback: false,
          execute: async ({ signal }) => {
            const started = this.clock.now();
            const running = this.repository.start({
              id: candidate.id,
              executionId,
              processId: this.processId,
              occurredAt: this.clock.timestamp(),
              queueWaitMs: boundedDuration(started - queuedAt),
            });
            const value = await this.executor.prepare(running, signal);
            const ready = this.repository.ready({
              id: candidate.id,
              executionId,
              processId: this.processId,
              occurredAt: this.clock.timestamp(),
              generationMs: boundedDuration(this.clock.now() - started),
            });
            this.cache.set(candidate.id, Object.freeze({ candidate: ready, value }));
            return value;
          },
        });
      } catch {
        this.repository.reject(candidate.id, 'PREFETCH_QUEUE_REJECTED', this.clock.timestamp());
        continue;
      }
      this.active.set(candidate.id, handle);
      void handle.promise
        .catch((error: unknown) => {
          const current = this.repository.get(candidate.id);
          if (current?.state !== 'RUNNING') return;
          const code =
            signalCode(error) === 'CANCELLED' ? 'PREFETCH_CANCELLED' : 'PREFETCH_EXECUTION_FAILED';
          this.repository.fail(candidate.id, executionId, code, this.clock.timestamp());
        })
        .finally(() => {
          if (this.active.get(candidate.id) === handle) this.active.delete(candidate.id);
        });
    }
    return Object.freeze(
      candidates.map((candidate) => this.repository.get(candidate.id) ?? candidate),
    );
  }

  public adopt(
    campaign: CampaignId,
    kind: PrefetchCandidateSeed['kind'],
    targetId: string,
    contextDigest: string,
  ): unknown | null {
    const cached = [...this.cache.values()].find(
      ({ candidate }) =>
        candidate.campaignId === campaign &&
        candidate.kind === kind &&
        candidate.targetId === targetId,
    );
    if (cached === undefined) {
      const predicted = this.repository
        .list(campaign)
        .find(
          (candidate) =>
            candidate.kind === kind &&
            candidate.targetId === targetId &&
            ['PREDICTED', 'RUNNING', 'READY'].includes(candidate.state),
        );
      if (predicted === undefined)
        this.repository.recordUnpredictedMiss(campaign, kind, targetId, this.clock.timestamp());
      else this.repository.miss(predicted.id, 'NOT_READY', this.clock.timestamp());
      return null;
    }
    this.cache.delete(cached.candidate.id);
    const resolved = this.repository.hit(
      cached.candidate.id,
      contextDigest,
      this.clock.timestamp(),
    );
    return resolved.state === 'HIT' ? cached.value : null;
  }

  public invalidate(
    campaign: CampaignId,
    reason: 'SUPERSEDED' | 'PROCESS_RESTART' | 'P0_PREEMPTED',
    exceptRunId: string | null = null,
  ): void {
    for (const [id, handle] of this.active) {
      const candidate = this.repository.get(id);
      if (
        candidate?.campaignId === campaign &&
        (exceptRunId === null || candidate.directorRunId !== exceptRunId)
      ) {
        handle.cancel();
        this.active.delete(id);
      }
    }
    for (const [id, cached] of this.cache) {
      if (
        cached.candidate.campaignId === campaign &&
        (exceptRunId === null || cached.candidate.directorRunId !== exceptRunId)
      ) {
        this.cache.delete(id);
      }
    }
    this.repository.invalidateOpen(campaign, reason, this.clock.timestamp(), exceptRunId);
  }

  public prioritizeP0(campaign: CampaignId): void {
    this.invalidate(campaign, 'P0_PREEMPTED');
  }
}

export class PrefetchCoordinatorError extends Error {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'PrefetchCoordinatorError';
  }
}

function taskFor(kind: PrefetchCandidateSeed['kind']): AITask {
  return kind === 'LOCATION_DETAILS' ? 'GENERATE_LOCATIONS' : 'GENERATE_FACTIONS';
}

function boundedDuration(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(86_400_000, Math.max(0, Math.round(value)));
}

function signalCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null || !('code' in error)) return null;
  return typeof error.code === 'string' ? error.code : null;
}

const systemClock: PrefetchClock = Object.freeze({
  now: () => performance.now(),
  timestamp: () => isoTimestamp(new Date().toISOString()),
});

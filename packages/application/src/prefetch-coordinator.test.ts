import { GenerationQueue } from '@ember-tavern/ai-core';
import {
  campaignId,
  isoTimestamp,
  type CampaignId,
  type IsoTimestamp,
  type PrefetchCandidate,
  type PrefetchCandidateSeed,
} from '@ember-tavern/contracts';
import { describe, expect, it, vi } from 'vitest';

import {
  PrefetchCoordinator,
  type PrefetchClock,
  type PrefetchExecutor,
  type PrefetchStore,
} from './prefetch-coordinator.js';

const campaign = campaignId('campaign-prefetch-coordinator');
const at = isoTimestamp('2026-08-24T14:00:00.000Z');

describe('PrefetchCoordinator', () => {
  it('runs P0 before P1/P2 and adopts a provisional hit without committing facts', async () => {
    const order: string[] = [];
    const store = new FakeStore();
    const queue = new GenerationQueue({ concurrency: 2, maxPending: 8 });
    const executor: PrefetchExecutor = {
      async prepare(candidate) {
        order.push(candidate.priority);
        return Object.freeze({ provisional: candidate.targetId });
      },
    };
    const coordinator = new PrefetchCoordinator(
      store,
      executor,
      queue,
      'process-priority',
      clock(),
    );
    coordinator.schedule([
      seed('candidate-p1', 'P1', 'FACTION_DETAILS', 'faction-one'),
      seed('candidate-p2', 'P2', 'LOCATION_DETAILS', 'location-one'),
    ]);
    const p0 = queue.submit({
      id: 'foreground-job',
      intentKey: 'foreground-intent',
      task: 'GENERATE_TAVERN',
      priority: 'P0',
      timeoutMs: 1_000,
      maxRetries: 0,
      allowFallback: false,
      async execute() {
        order.push('P0');
        return 'foreground';
      },
    });

    await p0.promise;
    await vi.waitFor(() =>
      expect(store.list(campaign).every(({ state }) => state === 'READY')).toBe(true),
    );
    expect(order[0]).toBe('P0');
    expect(order[1]).toBe('P1');
    expect(coordinator.adopt(campaign, 'FACTION_DETAILS', 'faction-one', 'a'.repeat(64))).toEqual({
      provisional: 'faction-one',
    });
    expect(store.get('candidate-p1')?.state).toBe('HIT');
    expect(store.worldCommits).toBe(0);
  });

  it('records not-ready and unpredicted misses without treating candidates as facts', async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const store = new FakeStore();
    const coordinator = new PrefetchCoordinator(
      store,
      {
        async prepare() {
          await blocked;
          return { provisional: true };
        },
      },
      new GenerationQueue({ concurrency: 1, maxPending: 4 }),
      'process-miss',
      clock(),
    );
    coordinator.schedule([seed('candidate-waiting', 'P2', 'LOCATION_DETAILS', 'location-one')]);
    await vi.waitFor(() => expect(store.get('candidate-waiting')?.state).toBe('RUNNING'));

    expect(
      coordinator.adopt(campaign, 'LOCATION_DETAILS', 'location-one', 'a'.repeat(64)),
    ).toBeNull();
    expect(store.get('candidate-waiting')?.state).toBe('MISSED');
    expect(
      coordinator.adopt(campaign, 'FACTION_DETAILS', 'faction-other', 'a'.repeat(64)),
    ).toBeNull();
    expect(store.unpredictedMisses).toBe(1);
    expect(store.worldCommits).toBe(0);
    release();
  });

  it('cannot adopt a persisted ready row after its process-memory body is gone', () => {
    const store = new FakeStore();
    store.savePredictions([seed('candidate-restarted', 'P2', 'LOCATION_DETAILS', 'location-one')]);
    store.start({
      id: 'candidate-restarted',
      executionId: 'execution-old',
      processId: 'process-old',
      occurredAt: at,
    });
    store.ready({ id: 'candidate-restarted', occurredAt: at });
    const coordinator = new PrefetchCoordinator(
      store,
      { async prepare() {} },
      new GenerationQueue({ concurrency: 1, maxPending: 2 }),
      'process-new',
      clock(),
    );

    expect(
      coordinator.adopt(campaign, 'LOCATION_DETAILS', 'location-one', 'a'.repeat(64)),
    ).toBeNull();
    expect(store.get('candidate-restarted')?.state).toBe('MISSED');
  });

  it('cancels queued and running prefetch when P0 work needs the lane', async () => {
    const store = new FakeStore();
    const coordinator = new PrefetchCoordinator(
      store,
      {
        prepare(_candidate, signal) {
          return new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
          });
        },
      },
      new GenerationQueue({ concurrency: 1, maxPending: 4 }),
      'process-cancel',
      clock(),
    );
    coordinator.schedule([
      seed('candidate-running', 'P1', 'FACTION_DETAILS', 'faction-one'),
      seed('candidate-queued', 'P2', 'LOCATION_DETAILS', 'location-one'),
    ]);
    await vi.waitFor(() => expect(store.get('candidate-running')?.state).toBe('RUNNING'));

    coordinator.prioritizeP0(campaign);
    expect(store.get('candidate-running')?.state).toBe('INVALIDATED');
    expect(store.get('candidate-queued')?.state).toBe('INVALIDATED');
  });

  it('records queue saturation without blocking foreground work', async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queue = new GenerationQueue({ concurrency: 1, maxPending: 2 });
    const running = queue.submit({
      id: 'foreground-running',
      intentKey: 'foreground-running',
      task: 'GENERATE_TAVERN',
      priority: 'P0',
      timeoutMs: 1_000,
      maxRetries: 0,
      allowFallback: false,
      async execute() {
        await blocked;
      },
    });
    const queued = queue.submit({
      id: 'foreground-queued',
      intentKey: 'foreground-queued',
      task: 'GENERATE_NPCS',
      priority: 'P0',
      timeoutMs: 1_000,
      maxRetries: 0,
      allowFallback: false,
      async execute() {},
    });
    const store = new FakeStore();
    const coordinator = new PrefetchCoordinator(
      store,
      { async prepare() {} },
      queue,
      'process-saturated',
      clock(),
    );

    expect(
      coordinator.schedule([
        seed('candidate-rejected', 'P2', 'LOCATION_DETAILS', 'location-one'),
      ])[0],
    ).toMatchObject({ state: 'FAILED', errorCode: 'PREFETCH_QUEUE_REJECTED' });
    expect(store.get('candidate-rejected')).toMatchObject({ state: 'FAILED' });

    release();
    await expect(running.promise).resolves.toBeUndefined();
    await expect(queued.promise).resolves.toBeUndefined();
  });
});

class FakeStore implements PrefetchStore {
  private readonly candidates = new Map<string, PrefetchCandidate>();
  public unpredictedMisses = 0;
  public worldCommits = 0;

  public savePredictions(seeds: readonly PrefetchCandidateSeed[]): readonly PrefetchCandidate[] {
    return seeds.map((seedValue) => {
      const candidate: PrefetchCandidate = Object.freeze({
        ...seedValue,
        state: 'PREDICTED',
        activeExecutionId: null,
        processId: null,
        errorCode: null,
        revision: 1,
        startedAt: null,
        readyAt: null,
        resolvedAt: null,
        updatedAt: seedValue.predictedAt,
      });
      this.candidates.set(candidate.id, candidate);
      return candidate;
    });
  }

  public get(id: string): PrefetchCandidate | null {
    return this.candidates.get(id) ?? null;
  }

  public list(campaignValue: CampaignId): readonly PrefetchCandidate[] {
    return [...this.candidates.values()].filter(({ campaignId: owner }) => owner === campaignValue);
  }

  public start(command: {
    id: string;
    executionId: string;
    processId: string;
    occurredAt: IsoTimestamp;
  }): PrefetchCandidate {
    return this.change(command.id, {
      state: 'RUNNING',
      activeExecutionId: command.executionId,
      processId: command.processId,
      startedAt: command.occurredAt,
      updatedAt: command.occurredAt,
    });
  }

  public ready(command: { id: string; occurredAt: IsoTimestamp }): PrefetchCandidate {
    return this.change(command.id, {
      state: 'READY',
      activeExecutionId: null,
      readyAt: command.occurredAt,
      updatedAt: command.occurredAt,
    });
  }

  public hit(id: string, contextDigest: string, occurredAt: IsoTimestamp): PrefetchCandidate {
    const current = this.required(id);
    return this.change(id, {
      state: current.contextDigest === contextDigest ? 'HIT' : 'INVALIDATED',
      resolvedAt: occurredAt,
      updatedAt: occurredAt,
    });
  }

  public miss(id: string, reason: 'NOT_READY' | 'CONTEXT_CHANGED', occurredAt: IsoTimestamp) {
    return this.change(id, {
      state: reason === 'NOT_READY' ? 'MISSED' : 'INVALIDATED',
      activeExecutionId: null,
      resolvedAt: occurredAt,
      updatedAt: occurredAt,
    });
  }

  public recordUnpredictedMiss(): void {
    this.unpredictedMisses += 1;
  }

  public invalidateOpen(
    campaignValue: CampaignId,
    _reason: 'SUPERSEDED' | 'PROCESS_RESTART' | 'P0_PREEMPTED',
    occurredAt: IsoTimestamp,
    exceptRunId: string | null = null,
  ): readonly PrefetchCandidate[] {
    for (const candidate of this.list(campaignValue)) {
      if (
        ['PREDICTED', 'RUNNING', 'READY'].includes(candidate.state) &&
        (exceptRunId === null || candidate.directorRunId !== exceptRunId)
      ) {
        this.change(candidate.id, {
          state: 'INVALIDATED',
          activeExecutionId: null,
          resolvedAt: occurredAt,
          updatedAt: occurredAt,
        });
      }
    }
    return this.list(campaignValue);
  }

  public fail(id: string, _executionId: string, errorCode: string, occurredAt: IsoTimestamp) {
    return this.change(id, {
      state: 'FAILED',
      activeExecutionId: null,
      errorCode,
      resolvedAt: occurredAt,
      updatedAt: occurredAt,
    });
  }

  public reject(id: string, errorCode: string, occurredAt: IsoTimestamp) {
    return this.change(id, {
      state: 'FAILED',
      errorCode,
      resolvedAt: occurredAt,
      updatedAt: occurredAt,
    });
  }

  private change(id: string, values: Partial<PrefetchCandidate>): PrefetchCandidate {
    const current = this.required(id);
    const next = Object.freeze({ ...current, ...values, revision: current.revision + 1 });
    this.candidates.set(id, next);
    return next;
  }

  private required(id: string): PrefetchCandidate {
    const value = this.get(id);
    if (value === null) throw new Error('missing fake candidate');
    return value;
  }
}

function seed(
  id: string,
  priority: 'P1' | 'P2',
  kind: 'LOCATION_DETAILS' | 'FACTION_DETAILS',
  targetId: string,
): PrefetchCandidateSeed {
  return {
    id,
    campaignId: campaign,
    directorRunId: 'director-run-prefetch',
    lazyIntentKey: `lazy:${campaign}:${kind.toLowerCase()}:${targetId}`,
    kind,
    targetId,
    priority,
    sourceActionId: priority === 'P1' ? 'director-action-1' : null,
    predictionReason: priority === 'P1' ? 'DIRECTOR_APPROVED' : 'BACKGROUND_CAPACITY',
    contextDigest: 'a'.repeat(64),
    predictedAt: at,
  };
}

function clock(): PrefetchClock {
  let value = 0;
  return {
    now() {
      value += 1;
      return value;
    },
    timestamp() {
      return at;
    },
  };
}

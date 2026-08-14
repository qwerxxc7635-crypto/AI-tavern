import { classifyApplicationError } from './application-error.js';
import type { AITask } from './protocol.js';

export const GENERATION_PRIORITIES = ['P0', 'P1', 'P2'] as const;
export type GenerationPriority = (typeof GENERATION_PRIORITIES)[number];
export type GenerationRoute = 'PRIMARY' | 'RETRY' | 'FALLBACK';
export type GenerationQueueStatus = 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'TIMED_OUT';

export interface GenerationQueueExecution {
  readonly attempt: number;
  readonly route: GenerationRoute;
  readonly signal: AbortSignal;
  readonly hardResultKey: string | null;
}

export interface GenerationQueueJob<T> {
  readonly id: string;
  readonly intentKey: string;
  readonly task: AITask;
  readonly priority: GenerationPriority;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly allowFallback: boolean;
  readonly hardResultKey?: string;
  readonly execute: (execution: GenerationQueueExecution) => Promise<T>;
}

export interface GenerationQueueMetric {
  readonly task: AITask;
  readonly priority: GenerationPriority;
  readonly status: GenerationQueueStatus;
  readonly finalRoute: GenerationRoute;
  readonly attempts: number;
  readonly queueWaitMs: number;
  readonly durationMs: number;
  readonly errorCode: string | null;
}

export interface GenerationQueueHandle<T> {
  readonly jobId: string;
  readonly promise: Promise<T>;
  readonly cancel: () => void;
}

export interface GenerationQueueOptions {
  readonly concurrency: number;
  readonly maxPending: number;
  readonly now?: () => number;
  readonly onMetric?: (metric: GenerationQueueMetric) => void;
}

interface QueueEntry<T> {
  readonly job: GenerationQueueJob<T>;
  readonly queuedAt: number;
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (error: unknown) => void;
  readonly controller: AbortController;
  readonly handle: GenerationQueueHandle<T>;
  state: 'QUEUED' | 'RUNNING' | 'SETTLED';
  startedAt: number | null;
  attempts: number;
  finalRoute: GenerationRoute;
}

export class GenerationQueue {
  private readonly queues: Record<GenerationPriority, QueueEntry<unknown>[]> = {
    P0: [],
    P1: [],
    P2: [],
  };
  private readonly intents = new Map<string, QueueEntry<unknown>>();
  private readonly now: () => number;
  private running = 0;
  private runningBackground = 0;
  private foregroundBurst = 0;
  private lowerTurn: 'P1' | 'P2' = 'P1';
  private drainScheduled = false;

  public constructor(private readonly options: GenerationQueueOptions) {
    if (
      !Number.isSafeInteger(options.concurrency) ||
      options.concurrency < 1 ||
      options.concurrency > 8 ||
      !Number.isSafeInteger(options.maxPending) ||
      options.maxPending < options.concurrency ||
      options.maxPending > 256
    ) {
      throw new GenerationQueueError('QUEUE_CONFIGURATION_INVALID');
    }
    this.now = options.now ?? (() => performance.now());
  }

  public submit<T>(job: GenerationQueueJob<T>): GenerationQueueHandle<T> {
    validateJob(job);
    const duplicate = this.intents.get(job.intentKey);
    if (duplicate !== undefined) return duplicate.handle as GenerationQueueHandle<T>;
    if (this.intents.size >= this.options.maxPending) {
      throw new GenerationQueueError('QUEUE_CAPACITY_EXCEEDED');
    }

    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((done, fail) => {
      resolve = done;
      reject = fail;
    });
    const controller = new AbortController();
    let cancelTarget: QueueEntry<T> | null = null;
    const handle: GenerationQueueHandle<T> = Object.freeze({
      jobId: job.id,
      promise,
      cancel: () => {
        if (cancelTarget !== null) this.cancel(cancelTarget);
      },
    });
    const entry: QueueEntry<T> = {
      job: Object.freeze({ ...job }),
      queuedAt: this.now(),
      promise,
      resolve,
      reject,
      controller,
      handle,
      state: 'QUEUED',
      startedAt: null,
      attempts: 0,
      finalRoute: 'PRIMARY',
    };
    cancelTarget = entry;
    this.intents.set(job.intentKey, entry as QueueEntry<unknown>);
    this.queues[job.priority].push(entry as QueueEntry<unknown>);
    this.scheduleDrain();
    return handle;
  }

  public snapshot() {
    return Object.freeze({
      running: this.running,
      queued: Object.freeze({
        P0: this.countQueued('P0'),
        P1: this.countQueued('P1'),
        P2: this.countQueued('P2'),
      }),
      intents: this.intents.size,
    });
  }

  private cancel<T>(entry: QueueEntry<T>) {
    if (entry.state === 'SETTLED') return;
    entry.controller.abort();
    if (entry.state === 'QUEUED') {
      this.finish(entry, undefined, new GenerationQueueError('CANCELLED'));
    }
  }

  private scheduleDrain() {
    if (this.drainScheduled) return;
    this.drainScheduled = true;
    queueMicrotask(() => {
      this.drainScheduled = false;
      this.drain();
    });
  }

  private drain() {
    while (this.running < this.options.concurrency) {
      const entry = this.nextEntry();
      if (entry === null) return;
      entry.state = 'RUNNING';
      entry.startedAt = this.now();
      this.running += 1;
      if (entry.job.priority === 'P2') this.runningBackground += 1;
      void this.run(entry);
    }
  }

  private nextEntry(): QueueEntry<unknown> | null {
    const backgroundAllowed =
      this.options.concurrency === 1 || this.runningBackground < this.options.concurrency - 1;
    if (this.foregroundBurst >= 4) {
      const lower = this.takeLower(backgroundAllowed);
      if (lower !== null) {
        this.foregroundBurst = 0;
        return lower;
      }
    }
    const p0 = this.shiftQueued('P0');
    if (p0 !== null) {
      this.foregroundBurst += 1;
      return p0;
    }
    const lower = this.takeLower(backgroundAllowed);
    if (lower !== null) {
      this.foregroundBurst = 0;
      return lower;
    }
    return null;
  }

  private takeLower(backgroundAllowed: boolean): QueueEntry<unknown> | null {
    const first = this.lowerTurn;
    const second = first === 'P1' ? 'P2' : 'P1';
    for (const priority of [first, second] as const) {
      if (priority === 'P2' && !backgroundAllowed) continue;
      const entry = this.shiftQueued(priority);
      if (entry !== null) {
        this.lowerTurn = priority === 'P1' ? 'P2' : 'P1';
        return entry;
      }
    }
    return null;
  }

  private shiftQueued(priority: GenerationPriority): QueueEntry<unknown> | null {
    const queue = this.queues[priority];
    while (queue.length > 0) {
      const entry = queue.shift();
      if (entry !== undefined && entry.state === 'QUEUED') return entry;
    }
    return null;
  }

  private countQueued(priority: GenerationPriority) {
    return this.queues[priority].filter(({ state }) => state === 'QUEUED').length;
  }

  private async run(entry: QueueEntry<unknown>) {
    let route: GenerationRoute = 'PRIMARY';
    let retries = 0;
    let fallbackUsed = false;
    const deadline = Date.now() + entry.job.timeoutMs;
    try {
      while (true) {
        if (Date.now() >= deadline) throw new GenerationQueueError('TIMEOUT');
        entry.attempts += 1;
        entry.finalRoute = route;
        try {
          const value = await executeAttempt(entry, route, Math.max(1, deadline - Date.now()));
          this.finish(entry, value, null);
          return;
        } catch (error) {
          const contract = classifyApplicationError(error);
          if (contract.code === 'CANCELLED' || entry.controller.signal.aborted) throw contract;
          if (contract.code === 'TIMEOUT') throw contract;
          if (contract.retryable && retries < entry.job.maxRetries) {
            retries += 1;
            route = 'RETRY';
            continue;
          }
          if (contract.fallbackEligible && entry.job.allowFallback && !fallbackUsed) {
            fallbackUsed = true;
            route = 'FALLBACK';
            continue;
          }
          throw contract;
        }
      }
    } catch (error) {
      this.finish(entry, undefined, error);
    }
  }

  private finish<T>(entry: QueueEntry<T>, value: T | undefined, error: unknown | null) {
    if (entry.state === 'SETTLED') return;
    const wasRunning = entry.state === 'RUNNING';
    entry.state = 'SETTLED';
    if (wasRunning) {
      this.running -= 1;
      if (entry.job.priority === 'P2') this.runningBackground -= 1;
    }
    this.intents.delete(entry.job.intentKey);
    const endedAt = this.now();
    const contract = error === null ? null : classifyApplicationError(error);
    const status: GenerationQueueStatus =
      contract === null
        ? 'SUCCEEDED'
        : contract.code === 'CANCELLED'
          ? 'CANCELLED'
          : contract.code === 'TIMEOUT'
            ? 'TIMED_OUT'
            : 'FAILED';
    this.options.onMetric?.(
      Object.freeze({
        task: entry.job.task,
        priority: entry.job.priority,
        status,
        finalRoute: entry.finalRoute,
        attempts: entry.attempts,
        queueWaitMs: boundedDuration((entry.startedAt ?? endedAt) - entry.queuedAt),
        durationMs: boundedDuration(endedAt - entry.queuedAt),
        errorCode: contract?.code ?? null,
      }),
    );
    if (error === null) entry.resolve(value as T);
    else entry.reject(contract);
    this.scheduleDrain();
  }
}

export class GenerationQueueError extends Error {
  public constructor(public readonly code: string) {
    super(`Generation queue failed: ${code}`);
    this.name = 'GenerationQueueError';
  }
}

async function executeAttempt<T>(
  entry: QueueEntry<T>,
  route: GenerationRoute,
  remainingMs: number,
): Promise<T> {
  const attemptController = new AbortController();
  const hardResultKey = entry.job.hardResultKey ?? null;
  return new Promise<T>((resolve, reject) => {
    let finished = false;
    const settle = (operation: () => void) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      entry.controller.signal.removeEventListener('abort', cancelled);
      operation();
    };
    const cancelled = () => {
      attemptController.abort();
      settle(() => reject(new GenerationQueueError('CANCELLED')));
    };
    const timeout = setTimeout(() => {
      attemptController.abort();
      settle(() => reject(new GenerationQueueError('TIMEOUT')));
    }, remainingMs);
    entry.controller.signal.addEventListener('abort', cancelled, { once: true });
    if (entry.controller.signal.aborted) {
      cancelled();
      return;
    }
    Promise.resolve(
      entry.job.execute({
        attempt: entry.attempts,
        route,
        signal: attemptController.signal,
        hardResultKey,
      }),
    ).then(
      (value) => settle(() => resolve(value)),
      (error: unknown) => settle(() => reject(error)),
    );
  });
}

function validateJob(job: GenerationQueueJob<unknown>) {
  if (
    !validId(job.id) ||
    !validId(job.intentKey) ||
    !GENERATION_PRIORITIES.includes(job.priority) ||
    !Number.isSafeInteger(job.timeoutMs) ||
    job.timeoutMs < 50 ||
    job.timeoutMs > 300_000 ||
    !Number.isSafeInteger(job.maxRetries) ||
    job.maxRetries < 0 ||
    job.maxRetries > 3 ||
    (job.hardResultKey !== undefined && !validId(job.hardResultKey))
  ) {
    throw new GenerationQueueError('QUEUE_JOB_INVALID');
  }
}

function validId(value: string) {
  return /^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,255}$/.test(value);
}

function boundedDuration(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.min(Math.round(value), 86_400_000)) : 0;
}

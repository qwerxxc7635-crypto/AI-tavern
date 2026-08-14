import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  GenerationQueue,
  type GenerationQueueExecution,
  type GenerationQueueJob,
  type GenerationQueueMetric,
} from './generation-queue.js';

afterEach(() => vi.useRealTimers());

describe('GenerationQueue', () => {
  it('runs P0 before queued background work and gives lower priorities bounded turns', async () => {
    const order: string[] = [];
    const queue = createQueue({ concurrency: 1 });
    const handles = [
      queue.submit(job('p2', 'P2', async () => record(order, 'p2'))),
      queue.submit(job('p1', 'P1', async () => record(order, 'p1'))),
      ...Array.from({ length: 8 }, (_, index) =>
        queue.submit(job(`p0-${index}`, 'P0', async () => record(order, `p0-${index}`))),
      ),
    ];
    await Promise.all(handles.map(({ promise }) => promise));
    expect(order.slice(0, 4)).toEqual(['p0-0', 'p0-1', 'p0-2', 'p0-3']);
    expect(order[4]).toBe('p1');
    expect(order.at(-1)).toBe('p2');
  });

  it('reserves foreground capacity from P2 and obeys global concurrency', async () => {
    const started: string[] = [];
    const first = deferred<string>();
    const second = deferred<string>();
    const foreground = deferred<string>();
    const queue = createQueue({ concurrency: 2 });
    const p2a = queue.submit(
      job('background-a', 'P2', () => {
        started.push('background-a');
        return first.promise;
      }),
    );
    const p2b = queue.submit(
      job('background-b', 'P2', () => {
        started.push('background-b');
        return second.promise;
      }),
    );
    await flush();
    expect(started).toEqual(['background-a']);
    const p0 = queue.submit(
      job('foreground', 'P0', () => {
        started.push('foreground');
        return foreground.promise;
      }),
    );
    await flush();
    expect(started).toEqual(['background-a', 'foreground']);
    expect(queue.snapshot().running).toBe(2);
    foreground.resolve('foreground');
    await p0.promise;
    await flush();
    expect(started).toEqual(['background-a', 'foreground']);
    first.resolve('background-a');
    await p2a.promise;
    await flush();
    expect(started).toEqual(['background-a', 'foreground', 'background-b']);
    second.resolve('background-b');
    await Promise.all([p2a.promise, p2b.promise]);
  });

  it('deduplicates the same intent into one execution and one handle', async () => {
    const execute = vi.fn(async () => 'one result');
    const queue = createQueue();
    const first = queue.submit(job('one', 'P0', execute, { intentKey: 'same-intent' }));
    const duplicate = queue.submit(job('two', 'P0', execute, { intentKey: 'same-intent' }));
    expect(duplicate).toBe(first);
    await expect(first.promise).resolves.toBe('one result');
    expect(execute).toHaveBeenCalledOnce();
  });

  it('cancels queued and running work and ignores a late success race', async () => {
    const metrics: GenerationQueueMetric[] = [];
    const active = deferred<string>();
    const queue = createQueue({ concurrency: 1, onMetric: (metric) => metrics.push(metric) });
    const running = queue.submit(job('running', 'P0', () => active.promise));
    const queuedExecute = vi.fn(async () => 'must not run');
    const queued = queue.submit(job('queued', 'P0', queuedExecute));
    await flush();
    running.cancel();
    queued.cancel();
    await expect(running.promise).rejects.toMatchObject({ code: 'CANCELLED' });
    await expect(queued.promise).rejects.toMatchObject({ code: 'CANCELLED' });
    active.resolve('late success');
    await flush();
    expect(queuedExecute).not.toHaveBeenCalled();
    expect(metrics.map(({ status }) => status).sort()).toEqual(['CANCELLED', 'CANCELLED']);
  });

  it('times out the whole attempt, aborts its signal and ignores late output', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const late = deferred<string>();
    const metrics: GenerationQueueMetric[] = [];
    const queue = createQueue({ onMetric: (metric) => metrics.push(metric) });
    const handle = queue.submit(
      job(
        'timeout',
        'P0',
        (execution) => {
          signal = execution.signal;
          return late.promise;
        },
        { timeoutMs: 50, maxRetries: 0, allowFallback: false },
      ),
    );
    const rejected = expect(handle.promise).rejects.toMatchObject({ code: 'TIMEOUT' });
    await vi.advanceTimersByTimeAsync(50);
    await rejected;
    expect(signal?.aborted).toBe(true);
    late.resolve('too late');
    await vi.runAllTimersAsync();
    expect(metrics).toContainEqual(expect.objectContaining({ status: 'TIMED_OUT', attempts: 1 }));
  });

  it('uses fallback only for eligible failures and preserves the hard result identity', async () => {
    const executions: { route: string; hardResultKey: string | null }[] = [];
    const queue = createQueue();
    const handle = queue.submit(
      job(
        'fallback',
        'P0',
        async ({ route, hardResultKey }) => {
          executions.push({ route, hardResultKey });
          if (route === 'PRIMARY') throw Object.freeze({ code: 'NETWORK_FAILED' });
          return 'fallback result';
        },
        { allowFallback: true, hardResultKey: 'd20:locked:15' },
      ),
    );
    await expect(handle.promise).resolves.toBe('fallback result');
    expect(executions).toEqual([
      { route: 'PRIMARY', hardResultKey: 'd20:locked:15' },
      { route: 'FALLBACK', hardResultKey: 'd20:locked:15' },
    ]);
  });

  it('keeps the hard result identity unchanged across technical retry', async () => {
    const seen: { attempt: number; route: string; hardResultKey: string | null }[] = [];
    const queue = createQueue();
    const handle = queue.submit(
      job(
        'hard-retry',
        'P0',
        async ({ attempt, route, hardResultKey }) => {
          seen.push({ attempt, route, hardResultKey });
          if (attempt === 1) throw Object.freeze({ code: 'INVALID_OUTPUT' });
          return 'narration for fixed roll';
        },
        { maxRetries: 1, hardResultKey: 'd20:turn-7:raw-12:total-15' },
      ),
    );
    await expect(handle.promise).resolves.toBe('narration for fixed roll');
    expect(seen).toEqual([
      { attempt: 1, route: 'PRIMARY', hardResultKey: 'd20:turn-7:raw-12:total-15' },
      { attempt: 2, route: 'RETRY', hardResultKey: 'd20:turn-7:raw-12:total-15' },
    ]);
  });

  it('retries eligible validation failures but never retries auth or rule failures', async () => {
    const queue = createQueue({ concurrency: 3 });
    const retryRoutes: string[] = [];
    const retry = queue.submit(
      job(
        'retry',
        'P0',
        async ({ route }) => {
          retryRoutes.push(route);
          if (route === 'PRIMARY') throw Object.freeze({ code: 'INVALID_OUTPUT' });
          return 'repaired externally';
        },
        { maxRetries: 1 },
      ),
    );
    const auth = vi.fn(async () => {
      throw Object.freeze({ code: 'AUTHENTICATION_FAILED' });
    });
    const rule = vi.fn(async () => {
      throw Object.freeze({ code: 'DOMAIN_RULE_REJECTED' });
    });
    const authHandle = queue.submit(
      job('auth', 'P0', auth, { maxRetries: 3, allowFallback: true }),
    );
    const ruleHandle = queue.submit(
      job('rule', 'P0', rule, { maxRetries: 3, allowFallback: true }),
    );
    await expect(retry.promise).resolves.toBe('repaired externally');
    await expect(authHandle.promise).rejects.toMatchObject({ code: 'AUTHENTICATION_FAILED' });
    await expect(ruleHandle.promise).rejects.toMatchObject({ code: 'DOMAIN_RULE_REJECTED' });
    expect(retryRoutes).toEqual(['PRIMARY', 'RETRY']);
    expect(auth).toHaveBeenCalledOnce();
    expect(rule).toHaveBeenCalledOnce();
  });

  it('emits bounded content-free metrics with queue wait, attempts and final route', async () => {
    let time = 10;
    const metrics: GenerationQueueMetric[] = [];
    const queue = createQueue({
      now: () => time,
      onMetric: (metric) => metrics.push(metric),
    });
    const handle = queue.submit(
      job('metric', 'P1', async () => {
        time = 30;
        return 'result';
      }),
    );
    time = 20;
    await handle.promise;
    expect(metrics).toEqual([
      {
        task: 'NPC_REPLY',
        priority: 'P1',
        status: 'SUCCEEDED',
        finalRoute: 'PRIMARY',
        attempts: 1,
        queueWaitMs: 10,
        durationMs: 20,
        errorCode: null,
      },
    ]);
    expect(JSON.stringify(metrics)).not.toContain('metric');
  });

  it('rejects unsafe configuration, malformed jobs and capacity overflow', async () => {
    expect(() => new GenerationQueue({ concurrency: 0, maxPending: 1 })).toThrowError(
      expect.objectContaining({ code: 'QUEUE_CONFIGURATION_INVALID' }),
    );
    const queue = new GenerationQueue({ concurrency: 1, maxPending: 2 });
    expect(() => queue.submit(job('../unsafe', 'P0', async () => 'invalid'))).toThrowError(
      expect.objectContaining({ code: 'QUEUE_JOB_INVALID' }),
    );
    const one = deferred<string>();
    const two = deferred<string>();
    const first = queue.submit(job('capacity-one', 'P0', () => one.promise));
    const second = queue.submit(job('capacity-two', 'P0', () => two.promise));
    expect(() => queue.submit(job('capacity-three', 'P0', async () => 'overflow'))).toThrowError(
      expect.objectContaining({ code: 'QUEUE_CAPACITY_EXCEEDED' }),
    );
    one.resolve('one');
    await first.promise;
    two.resolve('two');
    await second.promise;
  });
});

function createQueue(options: Partial<ConstructorParameters<typeof GenerationQueue>[0]> = {}) {
  return new GenerationQueue({ concurrency: 1, maxPending: 32, ...options });
}

function job<T>(
  id: string,
  priority: 'P0' | 'P1' | 'P2',
  execute: (execution: GenerationQueueExecution) => Promise<T>,
  options: Partial<Omit<GenerationQueueJob<T>, 'id' | 'priority' | 'execute'>> = {},
): GenerationQueueJob<T> {
  return {
    id,
    intentKey: `intent:${id}`,
    task: 'NPC_REPLY',
    priority,
    timeoutMs: 1_000,
    maxRetries: 0,
    allowFallback: false,
    execute,
    ...options,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

function record(values: string[], value: string) {
  values.push(value);
  return value;
}

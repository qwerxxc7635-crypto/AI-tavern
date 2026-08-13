import { describe, expect, it, vi } from 'vitest';

import {
  GeneratorRunner,
  type Generator,
  type GeneratorExecution,
  type GeneratorTransactionPort,
} from './generator.js';

interface Store {
  values: Map<string, number>;
  events: string[];
}

const execution: GeneratorExecution = {
  executionId: 'generation:test-1',
  idempotencyKey: 'generation:test-1',
};

describe('GeneratorRunner', () => {
  it('runs every boundary in order and records skipped repair', async () => {
    const calls: string[] = [];
    const store = emptyStore();
    const result = await runner(store).run(generator(store, calls), '4', execution);
    expect(calls).toEqual([
      'buildContext',
      'buildPrompt',
      'generate',
      'parse',
      'validate',
      'rulesCheck',
      'persist',
      'emitEvents',
    ]);
    expect(result).toMatchObject({
      value: 8,
      persistenceStatus: 'COMMITTED',
      events: ['created:8'],
    });
    expect(
      result.audit
        .filter(({ status }) => status === 'SUCCEEDED' || status === 'SKIPPED')
        .map(({ stage, status }) => `${stage}:${status}`),
    ).toEqual([
      'BUILD_CONTEXT:SUCCEEDED',
      'BUILD_PROMPT:SUCCEEDED',
      'GENERATE:SUCCEEDED',
      'PARSE:SUCCEEDED',
      'VALIDATE:SUCCEEDED',
      'REPAIR:SKIPPED',
      'RULES_CHECK:SUCCEEDED',
      'EMIT_EVENTS:SUCCEEDED',
      'PERSIST:SUCCEEDED',
    ]);
  });

  it('short-circuits all later stages after a failure and audits its safe code', async () => {
    const calls: string[] = [];
    const store = emptyStore();
    const value = generator(store, calls);
    value.buildPrompt = () => {
      calls.push('buildPrompt');
      throw Object.freeze({ code: 'PROMPT_REJECTED' });
    };
    const observed: string[] = [];
    await expect(
      new GeneratorRunner({
        transaction: transaction(store),
        observe: ({ stage, status }) => observed.push(`${stage}:${status}`),
      }).run(value, '4', execution),
    ).rejects.toMatchObject({ stage: 'BUILD_PROMPT', code: 'PROMPT_REJECTED' });
    expect(calls).toEqual(['buildContext', 'buildPrompt']);
    expect(observed.at(-1)).toBe('BUILD_PROMPT:FAILED');
    expect(store.values.size).toBe(0);
  });

  it('repairs a parse/validation failure once and revalidates before rules', async () => {
    const calls: string[] = [];
    const store = emptyStore();
    const value = generator(store, calls);
    let validationCount = 0;
    value.validate = (parsed) => {
      calls.push('validate');
      if (++validationCount === 1) throw Object.freeze({ code: 'SCHEMA_INVALID' });
      return parsed;
    };
    value.repair = ({ failedStage, raw }) => {
      calls.push(`repair:${failedStage}`);
      return `${raw}`;
    };
    const result = await runner(store).run(value, '4', execution);
    expect(result.value).toBe(8);
    expect(calls).toContain('repair:VALIDATE');
    expect(calls.filter((call) => call === 'parse')).toHaveLength(2);
    expect(calls.filter((call) => call === 'validate')).toHaveLength(2);
  });

  it('does not persist or emit when rules reject a structurally valid output', async () => {
    const calls: string[] = [];
    const store = emptyStore();
    const value = generator(store, calls);
    value.rulesCheck = () => {
      calls.push('rulesCheck');
      throw Object.freeze({ code: 'RULE_REJECTED' });
    };
    await expect(runner(store).run(value, '4', execution)).rejects.toMatchObject({
      stage: 'RULES_CHECK',
      code: 'RULE_REJECTED',
    });
    expect(calls).not.toContain('persist');
    expect(calls).not.toContain('emitEvents');
    expect(store.values.size).toBe(0);
  });

  it('rolls back persistence when event emission fails', async () => {
    const calls: string[] = [];
    const store = emptyStore();
    const value = generator(store, calls);
    value.emitEvents = () => {
      calls.push('emitEvents');
      store.events.push('partial-event');
      throw Object.freeze({ code: 'EVENT_WRITE_FAILED' });
    };
    await expect(runner(store).run(value, '4', execution)).rejects.toMatchObject({
      stage: 'PERSIST',
      code: 'EVENT_WRITE_FAILED',
    });
    expect(store.values.size).toBe(0);
    expect(store.events).toEqual([]);
  });

  it('returns the committed value without duplicating its event on idempotent replay', async () => {
    const store = emptyStore();
    const first = await runner(store).run(generator(store, []), '4', execution);
    const replay = await runner(store).run(generator(store, []), '4', execution);
    expect(first.persistenceStatus).toBe('COMMITTED');
    expect(replay.persistenceStatus).toBe('ALREADY_COMMITTED');
    expect(replay.events).toEqual([]);
    expect(store.events).toEqual(['created:8']);
    expect(replay.audit).toContainEqual(
      expect.objectContaining({ stage: 'EMIT_EVENTS', status: 'SKIPPED' }),
    );
  });

  it('rejects unsafe execution identities before invoking a stage', async () => {
    const store = emptyStore();
    const build = vi.fn();
    const value = generator(store, []);
    value.buildContext = build;
    await expect(
      runner(store).run(value, '4', { executionId: '../escape', idempotencyKey: 'safe' }),
    ).rejects.toMatchObject({ code: 'GENERATOR_EXECUTION_INVALID' });
    expect(build).not.toHaveBeenCalled();
  });
});

function generator(
  store: Store,
  calls: string[],
): Generator<string, number, string, string, number, number, number, number, string> {
  return {
    buildContext(input) {
      calls.push('buildContext');
      return Number(input);
    },
    buildPrompt(context) {
      calls.push('buildPrompt');
      return `double:${context}`;
    },
    generate(prompt) {
      calls.push('generate');
      return prompt.split(':')[1] ?? '';
    },
    parse(raw) {
      calls.push('parse');
      return Number(raw);
    },
    validate(parsed) {
      calls.push('validate');
      if (!Number.isFinite(parsed)) throw Object.freeze({ code: 'SCHEMA_INVALID' });
      return parsed;
    },
    rulesCheck(validated) {
      calls.push('rulesCheck');
      return validated * 2;
    },
    persist(checked, active) {
      calls.push('persist');
      const existing = store.values.get(active.idempotencyKey);
      if (existing !== undefined) return { status: 'ALREADY_COMMITTED', value: existing };
      store.values.set(active.idempotencyKey, checked);
      return { status: 'COMMITTED', value: checked };
    },
    emitEvents(persisted) {
      calls.push('emitEvents');
      const event = `created:${persisted}`;
      store.events.push(event);
      return [event];
    },
  };
}

function emptyStore(): Store {
  return { values: new Map(), events: [] };
}

function runner(store: Store) {
  return new GeneratorRunner({ transaction: transaction(store) });
}

function transaction(store: Store): GeneratorTransactionPort {
  return {
    run(operation) {
      const values = new Map(store.values);
      const events = [...store.events];
      try {
        return operation();
      } catch (error) {
        store.values = values;
        store.events = events;
        throw error;
      }
    },
  };
}

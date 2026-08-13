export const GENERATOR_STAGES = [
  'BUILD_CONTEXT',
  'BUILD_PROMPT',
  'GENERATE',
  'PARSE',
  'VALIDATE',
  'REPAIR',
  'RULES_CHECK',
  'PERSIST',
  'EMIT_EVENTS',
] as const;

export type GeneratorStage = (typeof GENERATOR_STAGES)[number];
export type GeneratorStageStatus = 'STARTED' | 'SUCCEEDED' | 'SKIPPED' | 'FAILED';

export interface GeneratorAuditEntry {
  readonly sequence: number;
  readonly stage: GeneratorStage;
  readonly status: GeneratorStageStatus;
  readonly code: string | null;
}

export interface GeneratorExecution {
  readonly executionId: string;
  readonly idempotencyKey: string;
}

export interface GeneratorPersistence<T> {
  readonly status: 'COMMITTED' | 'ALREADY_COMMITTED';
  readonly value: T;
}

export interface GeneratorTransactionPort {
  run<T>(operation: () => T): T;
}

export interface GeneratorRepairRequest<TRaw> {
  readonly failedStage: Extract<GeneratorStage, 'PARSE' | 'VALIDATE'>;
  readonly raw: TRaw;
  readonly error: unknown;
}

export interface Generator<
  TInput,
  TContext,
  TPrompt,
  TRaw,
  TParsed,
  TValidated,
  TChecked,
  TPersisted,
  TEvent,
> {
  buildContext(input: TInput, execution: GeneratorExecution): TContext | Promise<TContext>;
  buildPrompt(context: TContext, execution: GeneratorExecution): TPrompt | Promise<TPrompt>;
  generate(prompt: TPrompt, execution: GeneratorExecution): TRaw | Promise<TRaw>;
  parse(raw: TRaw, execution: GeneratorExecution): TParsed | Promise<TParsed>;
  validate(parsed: TParsed, execution: GeneratorExecution): TValidated | Promise<TValidated>;
  repair?(
    request: GeneratorRepairRequest<TRaw>,
    execution: GeneratorExecution,
  ): TRaw | null | Promise<TRaw | null>;
  rulesCheck(validated: TValidated, execution: GeneratorExecution): TChecked | Promise<TChecked>;
  persist(checked: TChecked, execution: GeneratorExecution): GeneratorPersistence<TPersisted>;
  emitEvents(persisted: TPersisted, execution: GeneratorExecution): readonly TEvent[];
}

export interface GeneratorResult<TPersisted, TEvent> {
  readonly value: TPersisted;
  readonly persistenceStatus: GeneratorPersistence<TPersisted>['status'];
  readonly events: readonly TEvent[];
  readonly audit: readonly GeneratorAuditEntry[];
}

export interface GeneratorRunnerOptions {
  readonly transaction: GeneratorTransactionPort;
  readonly observe?: (entry: GeneratorAuditEntry) => void;
}

export class GeneratorRunner {
  public constructor(private readonly options: GeneratorRunnerOptions) {}

  public async run<
    TInput,
    TContext,
    TPrompt,
    TRaw,
    TParsed,
    TValidated,
    TChecked,
    TPersisted,
    TEvent,
  >(
    generator: Generator<
      TInput,
      TContext,
      TPrompt,
      TRaw,
      TParsed,
      TValidated,
      TChecked,
      TPersisted,
      TEvent
    >,
    input: TInput,
    execution: GeneratorExecution,
  ): Promise<GeneratorResult<TPersisted, TEvent>> {
    validateExecution(execution);
    const audit: GeneratorAuditEntry[] = [];
    const record = (
      stageName: GeneratorStage,
      status: GeneratorStageStatus,
      code: string | null,
    ) => {
      const entry = Object.freeze({ sequence: audit.length + 1, stage: stageName, status, code });
      audit.push(entry);
      this.options.observe?.(entry);
    };
    const stage = async <T>(name: GeneratorStage, operation: () => T | Promise<T>): Promise<T> => {
      record(name, 'STARTED', null);
      try {
        const value = await operation();
        record(name, 'SUCCEEDED', null);
        return value;
      } catch (error) {
        record(name, 'FAILED', errorCode(error));
        throw new GeneratorLifecycleError(name, errorCode(error), error);
      }
    };

    const context = await stage('BUILD_CONTEXT', () => generator.buildContext(input, execution));
    const prompt = await stage('BUILD_PROMPT', () => generator.buildPrompt(context, execution));
    let raw = await stage('GENERATE', () => generator.generate(prompt, execution));
    let parsed: TParsed;
    let validated: TValidated;
    try {
      parsed = await stage('PARSE', () => generator.parse(raw, execution));
      validated = await stage('VALIDATE', () => generator.validate(parsed, execution));
      record('REPAIR', 'SKIPPED', null);
    } catch (error) {
      const lifecycle = asLifecycleError(error);
      if (
        generator.repair === undefined ||
        (lifecycle.stage !== 'PARSE' && lifecycle.stage !== 'VALIDATE')
      ) {
        record('REPAIR', 'SKIPPED', null);
        throw error;
      }
      const repaired = await stage('REPAIR', () =>
        generator.repair?.(
          { failedStage: lifecycle.stage as 'PARSE' | 'VALIDATE', raw, error: lifecycle.cause },
          execution,
        ),
      );
      if (repaired === null || repaired === undefined) throw error;
      raw = repaired;
      parsed = await stage('PARSE', () => generator.parse(raw, execution));
      validated = await stage('VALIDATE', () => generator.validate(parsed, execution));
    }
    const checked = await stage('RULES_CHECK', () => generator.rulesCheck(validated, execution));

    record('PERSIST', 'STARTED', null);
    try {
      let persistence!: GeneratorPersistence<TPersisted>;
      let events: readonly TEvent[] = Object.freeze([]);
      this.options.transaction.run(() => {
        persistence = generator.persist(checked, execution);
        if (persistence.status === 'COMMITTED') {
          record('EMIT_EVENTS', 'STARTED', null);
          try {
            events = Object.freeze([...generator.emitEvents(persistence.value, execution)]);
            record('EMIT_EVENTS', 'SUCCEEDED', null);
          } catch (error) {
            record('EMIT_EVENTS', 'FAILED', errorCode(error));
            throw error;
          }
        } else {
          record('EMIT_EVENTS', 'SKIPPED', null);
        }
      });
      record('PERSIST', 'SUCCEEDED', null);
      return Object.freeze({
        value: persistence.value,
        persistenceStatus: persistence.status,
        events,
        audit: Object.freeze([...audit]),
      });
    } catch (error) {
      record('PERSIST', 'FAILED', errorCode(error));
      throw new GeneratorLifecycleError('PERSIST', errorCode(error), error);
    }
  }
}

export class GeneratorLifecycleError extends Error {
  public constructor(
    public readonly stage: GeneratorStage,
    public readonly code: string,
    public override readonly cause: unknown,
  ) {
    super(`Generator failed at ${stage}: ${code}`, { cause });
    this.name = 'GeneratorLifecycleError';
  }
}

export const NOOP_GENERATOR_TRANSACTION: GeneratorTransactionPort = Object.freeze({
  run<T>(operation: () => T): T {
    return operation();
  },
});

function validateExecution(execution: GeneratorExecution) {
  for (const value of [execution.executionId, execution.idempotencyKey]) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,255}$/.test(value)) {
      throw new GeneratorLifecycleError(
        'BUILD_CONTEXT',
        'GENERATOR_EXECUTION_INVALID',
        new TypeError('Generator execution identity is invalid'),
      );
    }
  }
}

function asLifecycleError(error: unknown): GeneratorLifecycleError {
  if (error instanceof GeneratorLifecycleError) return error;
  throw error;
}

function errorCode(error: unknown) {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string' &&
    /^[A-Z0-9_]{2,64}$/.test(error.code)
  ) {
    return error.code;
  }
  return 'GENERATOR_STAGE_FAILED';
}

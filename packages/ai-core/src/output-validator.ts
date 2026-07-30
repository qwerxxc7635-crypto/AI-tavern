import type { JsonValue } from '@ember-tavern/contracts';

import { AI_TASK_SCHEMAS } from './task-schema-registry.js';
import type { AITask } from './protocol.js';

export type OutputValidationErrorCode = 'INVALID_JSON' | 'SCHEMA_VALIDATION_FAILED';

export interface OutputValidationIssue {
  readonly path: readonly (string | number)[];
  readonly code: string;
  readonly message: string;
}

export interface OutputValidationFailure {
  readonly ok: false;
  readonly task: AITask;
  readonly schemaVersion: number;
  readonly rawResponseText: string;
  readonly error: Readonly<{
    code: OutputValidationErrorCode;
    issues: readonly OutputValidationIssue[];
  }>;
}

export interface OutputValidationSuccess {
  readonly ok: true;
  readonly task: AITask;
  readonly schemaVersion: number;
  readonly rawResponseText: string;
  readonly validatedOutput: JsonValue;
}

export type OutputValidationResult = OutputValidationSuccess | OutputValidationFailure;

export function validateAIOutput(task: AITask, rawResponseText: string): OutputValidationResult {
  const definition = AI_TASK_SCHEMAS[task];
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawResponseText);
  } catch {
    return Object.freeze({
      ok: false,
      task,
      schemaVersion: definition.schemaVersion,
      rawResponseText,
      error: Object.freeze({
        code: 'INVALID_JSON',
        issues: Object.freeze([
          Object.freeze({
            path: Object.freeze([]),
            code: 'invalid_json',
            message: 'Response is not valid JSON',
          }),
        ]),
      }),
    });
  }

  const result = definition.output.safeParse(parsed);
  if (!result.success) {
    return Object.freeze({
      ok: false,
      task,
      schemaVersion: definition.schemaVersion,
      rawResponseText,
      error: Object.freeze({
        code: 'SCHEMA_VALIDATION_FAILED',
        issues: Object.freeze(
          result.error.issues.map((issue) =>
            Object.freeze({
              path: Object.freeze(
                issue.path.map((segment) =>
                  typeof segment === 'symbol' ? segment.toString() : segment,
                ),
              ),
              code: issue.code,
              message: issue.message,
            }),
          ),
        ),
      }),
    });
  }

  return Object.freeze({
    ok: true,
    task,
    schemaVersion: definition.schemaVersion,
    rawResponseText,
    validatedOutput: requireJsonValue(result.data),
  });
}

function requireJsonValue(value: unknown): JsonValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return value;
  }
  if (Array.isArray(value)) return Object.freeze(value.map(requireJsonValue));
  if (typeof value === 'object') {
    const result: Record<string, JsonValue> = {};
    for (const [key, item] of Object.entries(value)) result[key] = requireJsonValue(item);
    return Object.freeze(result);
  }
  throw new TypeError('Validated AI output must be finite JSON');
}

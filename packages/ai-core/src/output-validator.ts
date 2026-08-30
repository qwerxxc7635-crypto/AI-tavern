import type { JsonValue } from '@ember-tavern/contracts';

import { AI_TASK_SCHEMAS } from './task-schema-registry.js';
import type { AITask } from './protocol.js';

export type OutputValidationErrorCode =
  'INVALID_JSON' | 'AMBIGUOUS_JSON' | 'RESPONSE_TRUNCATED' | 'SCHEMA_VALIDATION_FAILED';

export type OutputNormalization = 'EXACT_JSON' | 'MARKDOWN_FENCE' | 'UNIQUE_JSON_OBJECT';

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
  readonly normalization: OutputNormalization;
  readonly validatedOutput: JsonValue;
}

export type OutputValidationResult = OutputValidationSuccess | OutputValidationFailure;

export function validateAIOutput(task: AITask, rawResponseText: string): OutputValidationResult {
  const definition = AI_TASK_SCHEMAS[task];
  const normalized = normalizeJsonResponse(rawResponseText);
  if (!normalized.ok) {
    return Object.freeze({
      ok: false,
      task,
      schemaVersion: definition.schemaVersion,
      rawResponseText,
      error: Object.freeze({
        code: normalized.code,
        issues: Object.freeze([
          Object.freeze({
            path: Object.freeze([]),
            code: normalized.code.toLowerCase(),
            message:
              normalized.code === 'AMBIGUOUS_JSON'
                ? 'Response contains multiple JSON object candidates'
                : 'Response is not valid JSON',
          }),
        ]),
      }),
    });
  }

  const result = definition.output.safeParse(normalized.parsed);
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
    normalization: normalized.normalization,
    validatedOutput: requireJsonValue(result.data),
  });
}

type JsonNormalizationResult =
  | Readonly<{
      ok: true;
      parsed: unknown;
      normalization: OutputNormalization;
    }>
  | Readonly<{
      ok: false;
      code: Extract<OutputValidationErrorCode, 'INVALID_JSON' | 'AMBIGUOUS_JSON'>;
    }>;

function normalizeJsonResponse(raw: string): JsonNormalizationResult {
  const exact = parseJson(raw);
  if (exact.ok) {
    return Object.freeze({ ok: true, parsed: exact.value, normalization: 'EXACT_JSON' });
  }

  const fenced = /^\s*```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```\s*$/i.exec(raw);
  if (fenced !== null) {
    const parsed = parseJson(fenced[1] ?? '');
    if (parsed.ok) {
      return Object.freeze({ ok: true, parsed: parsed.value, normalization: 'MARKDOWN_FENCE' });
    }
    return Object.freeze({ ok: false, code: 'INVALID_JSON' });
  }

  const candidates = topLevelObjectCandidates(raw);
  if (candidates.length > 1) return Object.freeze({ ok: false, code: 'AMBIGUOUS_JSON' });
  const candidate = candidates[0];
  if (candidate === undefined) return Object.freeze({ ok: false, code: 'INVALID_JSON' });
  const prefix = raw.slice(0, candidate.start).trim();
  const suffix = raw.slice(candidate.end).trim();
  if (
    prefix.length > 512 ||
    suffix.length > 512 ||
    prefix.includes('```') ||
    suffix.includes('```')
  ) {
    return Object.freeze({ ok: false, code: 'INVALID_JSON' });
  }
  const parsed = parseJson(raw.slice(candidate.start, candidate.end));
  return parsed.ok && isRecord(parsed.value)
    ? Object.freeze({
        ok: true,
        parsed: parsed.value,
        normalization: 'UNIQUE_JSON_OBJECT',
      })
    : Object.freeze({ ok: false, code: 'INVALID_JSON' });
}

function parseJson(
  value: string,
): Readonly<{ ok: true; value: unknown }> | Readonly<{ ok: false }> {
  try {
    return Object.freeze({ ok: true, value: JSON.parse(value) as unknown });
  } catch {
    return Object.freeze({ ok: false });
  }
}

function topLevelObjectCandidates(
  raw: string,
): readonly Readonly<{ start: number; end: number }>[] {
  const candidates: Array<Readonly<{ start: number; end: number }>> = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"' && depth > 0) {
      inString = true;
    } else if (character === '{') {
      if (depth === 0) start = index;
      depth += 1;
    } else if (character === '}') {
      if (depth === 0) return Object.freeze([]);
      depth -= 1;
      if (depth === 0 && start >= 0) {
        candidates.push(Object.freeze({ start, end: index + 1 }));
        start = -1;
      }
    }
  }
  return depth === 0 && !inString ? Object.freeze(candidates) : Object.freeze([]);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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

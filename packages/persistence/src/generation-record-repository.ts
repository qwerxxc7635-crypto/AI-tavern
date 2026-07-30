import {
  aiRequestId,
  campaignId,
  generationRecordId,
  isoTimestamp,
  modelProfileId,
  promptVersion,
  type GenerationRecord,
  type GenerationValidationError,
  type GenerationValidationIssue,
  type IsoTimestamp,
  type JsonValue,
} from '@ember-tavern/contracts';

import { PersistenceDataError } from './campaign-repository.js';
import {
  parseJson,
  requireArray,
  requireNullableString,
  requireNumber,
  requireRecord,
  requireString,
} from './persistence-validation.js';
import type { SqliteDatabase, SqliteRunResult } from './sqlite-port.js';

const SECRET_FIELD = /api.?key|authorization|bearer|access.?token|secret.?key/i;

export type CreateGenerationRecord = Pick<
  GenerationRecord,
  | 'id'
  | 'campaignId'
  | 'requestId'
  | 'task'
  | 'modelProfileId'
  | 'promptVersion'
  | 'request'
  | 'startedAt'
>;

export interface CompleteGenerationRecord {
  readonly rawResponseText: string | null;
  readonly validatedOutput: JsonValue | null;
  readonly validationError: GenerationValidationError | null;
  readonly completedAt: IsoTimestamp;
}

export class GenerationRecordRepository {
  public constructor(private readonly database: SqliteDatabase) {}

  public create(record: CreateGenerationRecord): void {
    if (record.task.trim().length === 0) {
      throw new PersistenceDataError('GenerationRecord.task must not be empty');
    }
    validateJsonForStorage(record.request, 'GenerationRecord.request');
    this.database
      .prepare(
        `INSERT INTO generation_records (
           id, campaign_id, request_id, task, model_profile_id, prompt_version,
           request_json, raw_response_text, validated_output_json,
           validation_error_json, started_at, completed_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, NULL)`,
      )
      .run(
        record.id,
        record.campaignId,
        record.requestId,
        record.task,
        record.modelProfileId,
        record.promptVersion,
        JSON.stringify(record.request),
        record.startedAt,
      );
  }

  public complete(id: GenerationRecord['id'], completion: CompleteGenerationRecord): void {
    const hasOutput = completion.validatedOutput !== null;
    const hasError = completion.validationError !== null;
    if (hasOutput === hasError) {
      throw new PersistenceDataError(
        'GenerationRecord completion must contain exactly one validated output or validation error',
      );
    }
    if (hasOutput && completion.rawResponseText === null) {
      throw new PersistenceDataError('Validated GenerationRecord output requires a raw response');
    }
    if (completion.validatedOutput !== null) {
      validateJsonForStorage(completion.validatedOutput, 'GenerationRecord.validatedOutput');
    }
    if (completion.validationError !== null) {
      validateValidationError(completion.validationError);
    }
    requireOneChange(
      this.database
        .prepare(
          `UPDATE generation_records
           SET raw_response_text = ?, validated_output_json = ?,
               validation_error_json = ?, completed_at = ?
           WHERE id = ? AND completed_at IS NULL`,
        )
        .run(
          completion.rawResponseText,
          completion.validatedOutput === null ? null : JSON.stringify(completion.validatedOutput),
          completion.validationError === null ? null : JSON.stringify(completion.validationError),
          completion.completedAt,
          id,
        ),
      `GenerationRecord not found or already completed: ${id}`,
    );
  }

  public get(id: GenerationRecord['id']): GenerationRecord | null {
    const row = this.database.prepare('SELECT * FROM generation_records WHERE id = ?').get(id);
    return row === undefined ? null : mapRecord(row);
  }
}

function mapRecord(value: unknown): GenerationRecord {
  try {
    const row = requireRecord(value, 'GenerationRecord row');
    const model = requireNullableString(row['model_profile_id'], 'model_profile_id');
    const raw = requireNullableString(row['raw_response_text'], 'raw_response_text');
    const outputText = requireNullableString(row['validated_output_json'], 'validated_output_json');
    const errorText = requireNullableString(row['validation_error_json'], 'validation_error_json');
    const completed = requireNullableString(row['completed_at'], 'completed_at');
    if ((outputText === null) === (errorText === null) && completed !== null) {
      throw new PersistenceDataError(
        'Completed GenerationRecord must contain exactly one output or error',
      );
    }
    if (completed === null && (raw !== null || outputText !== null || errorText !== null)) {
      throw new PersistenceDataError('Incomplete GenerationRecord contains completion data');
    }
    const request = parseStoredJson(parseJson(row['request_json'], 'request_json'), 'request_json');
    const validatedOutput =
      outputText === null
        ? null
        : parseStoredJson(JSON.parse(outputText) as unknown, 'validated_output_json');
    const validationError =
      errorText === null ? null : parseValidationError(JSON.parse(errorText) as unknown);
    return Object.freeze({
      id: generationRecordId(requireString(row['id'], 'id')),
      campaignId: campaignId(requireString(row['campaign_id'], 'campaign_id')),
      requestId: aiRequestId(requireString(row['request_id'], 'request_id')),
      task: requireString(row['task'], 'task'),
      modelProfileId: model === null ? null : modelProfileId(model),
      promptVersion: promptVersion(requireNumber(row['prompt_version'], 'prompt_version')),
      request,
      rawResponseText: raw,
      validatedOutput,
      validationError,
      startedAt: isoTimestamp(requireString(row['started_at'], 'started_at')),
      completedAt: completed === null ? null : isoTimestamp(completed),
    });
  } catch (error) {
    if (error instanceof PersistenceDataError) throw error;
    throw new PersistenceDataError('Persisted GenerationRecord row is invalid', {
      cause: error,
    });
  }
}

function parseValidationError(value: unknown): GenerationValidationError {
  const record = requireRecord(value, 'validation_error');
  const issues = Object.freeze(
    requireArray(record['issues'], 'validation_error.issues').map((issue, index) => {
      const item = requireRecord(issue, `validation_error.issues[${index}]`);
      return Object.freeze({
        path: Object.freeze(
          requireArray(item['path'], `validation_error.issues[${index}].path`).map(
            (segment, segmentIndex) => {
              if (typeof segment === 'string' || typeof segment === 'number') return segment;
              throw new PersistenceDataError(
                `validation_error.issues[${index}].path[${segmentIndex}] must be text or number`,
              );
            },
          ),
        ),
        code: requireString(item['code'], `validation_error.issues[${index}].code`),
        message: requireString(item['message'], `validation_error.issues[${index}].message`),
      }) satisfies GenerationValidationIssue;
    }),
  );
  const result = Object.freeze({
    code: requireString(record['code'], 'validation_error.code'),
    issues,
  });
  validateValidationError(result);
  return result;
}

function validateValidationError(error: GenerationValidationError): void {
  if (error.code.trim().length === 0 || error.issues.length === 0) {
    throw new PersistenceDataError(
      'GenerationRecord.validationError requires a code and at least one issue',
    );
  }
  for (const issue of error.issues) {
    if (issue.code.trim().length === 0 || issue.message.trim().length === 0) {
      throw new PersistenceDataError('GenerationRecord validation issues must not be empty');
    }
    if (
      issue.path.some(
        (segment) =>
          (typeof segment !== 'string' && typeof segment !== 'number') ||
          (typeof segment === 'number' && !Number.isSafeInteger(segment)),
      )
    ) {
      throw new PersistenceDataError(
        'GenerationRecord validation issue paths must contain text or safe integers',
      );
    }
  }
}

function parseStoredJson(value: unknown, label: string): JsonValue {
  validateJsonForStorage(value, label);
  return freezeJson(value);
}

function validateJsonForStorage(value: unknown, label: string): asserts value is JsonValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => validateJsonForStorage(entry, `${label}[${index}]`));
    return;
  }
  if (typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new PersistenceDataError(`${label} must be a plain JSON object`);
    }
    for (const [key, entry] of Object.entries(value)) {
      if (SECRET_FIELD.test(key)) {
        throw new PersistenceDataError(`${label} contains forbidden credential field: ${key}`);
      }
      validateJsonForStorage(entry, `${label}.${key}`);
    }
    return;
  }
  throw new PersistenceDataError(`${label} must contain only JSON values`);
}

function freezeJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return Object.freeze(value.map(freezeJson));
  if (value !== null && typeof value === 'object') {
    return Object.freeze(
      Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, freezeJson(entry)])),
    );
  }
  return value;
}

function requireOneChange(result: SqliteRunResult, message: string): void {
  if (Number(result.changes) !== 1) throw new PersistenceDataError(message);
}

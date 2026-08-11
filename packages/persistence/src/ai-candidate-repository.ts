import {
  aiCandidateId,
  aiOperationId,
  aiRequestId,
  campaignId,
  generationRecordId,
  isoTimestamp,
  type AICandidate,
  type AICandidateProvenance,
  type AICandidateStatus,
  type AICandidateValidationEvidence,
  type AiCandidateId,
  type JsonValue,
} from '@ember-tavern/contracts';

import { PersistenceDataError } from './campaign-repository.js';
import {
  parseJson,
  requireArray,
  requireBoolean,
  requireNullableString,
  requireNumber,
  requireRecord,
  requireString,
} from './persistence-validation.js';
import { findSecretInJson } from './save-secret-scanner.js';
import type { SqliteDatabase } from './sqlite-port.js';

export type CreateAICandidate = Pick<
  AICandidate,
  | 'id'
  | 'campaignId'
  | 'operationId'
  | 'task'
  | 'generationRecordId'
  | 'payload'
  | 'validation'
  | 'provenance'
  | 'expectedRevision'
  | 'supersedesCandidateId'
  | 'createdAt'
>;

export class AICandidateTransitionError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'AICandidateTransitionError';
  }
}

export class AICandidateRepository {
  public constructor(private readonly database: SqliteDatabase) {}

  public create(input: CreateAICandidate): AICandidate {
    validateCreate(input);
    this.database
      .prepare(
        `INSERT INTO ai_candidates (
           id, campaign_id, operation_id, task, generation_record_id,
           payload_json, validation_json, provenance_json, expected_revision,
           status, supersedes_candidate_id, superseded_by_candidate_id,
           created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PROPOSED', ?, NULL, ?, ?)`,
      )
      .run(
        input.id,
        input.campaignId,
        input.operationId,
        input.task,
        input.generationRecordId,
        JSON.stringify(input.payload),
        JSON.stringify(input.validation),
        JSON.stringify(input.provenance),
        input.expectedRevision,
        input.supersedesCandidateId,
        input.createdAt,
        input.createdAt,
      );
    return this.require(input.id);
  }

  public get(id: AiCandidateId): AICandidate | null {
    const row = this.database.prepare('SELECT * FROM ai_candidates WHERE id = ?').get(id);
    return row === undefined ? null : mapCandidate(row);
  }

  public require(id: AiCandidateId): AICandidate {
    const candidate = this.get(id);
    if (candidate === null) throw new AICandidateTransitionError(`AI candidate not found: ${id}`);
    return candidate;
  }

  public listCampaign(campaign: AICandidate['campaignId']): readonly AICandidate[] {
    return Object.freeze(
      this.database
        .prepare(
          `SELECT * FROM ai_candidates
           WHERE campaign_id = ?
           ORDER BY created_at, id`,
        )
        .all(campaign)
        .map(mapCandidate),
    );
  }

  public transition(
    id: AiCandidateId,
    status: Extract<AICandidateStatus, 'ACCEPTED' | 'REJECTED'>,
    updatedAt: AICandidate['updatedAt'],
  ): AICandidate {
    const result = this.database
      .prepare(
        `UPDATE ai_candidates
         SET status = ?, updated_at = ?
         WHERE id = ? AND status = 'PROPOSED' AND superseded_by_candidate_id IS NULL`,
      )
      .run(status, updatedAt, id);
    if (Number(result.changes) !== 1) {
      throw new AICandidateTransitionError('Only a proposed AI candidate can be finalized');
    }
    return this.require(id);
  }

  public markSuperseded(
    id: AiCandidateId,
    replacementId: AiCandidateId,
    updatedAt: AICandidate['updatedAt'],
  ): AICandidate {
    if (id === replacementId)
      throw new AICandidateTransitionError('Candidate cannot replace itself');
    const result = this.database
      .prepare(
        `UPDATE ai_candidates
         SET status = 'SUPERSEDED', superseded_by_candidate_id = ?, updated_at = ?
         WHERE id = ? AND status = 'PROPOSED' AND superseded_by_candidate_id IS NULL`,
      )
      .run(replacementId, updatedAt, id);
    if (Number(result.changes) !== 1) {
      throw new AICandidateTransitionError('Only a proposed AI candidate can be superseded');
    }
    return this.require(id);
  }
}

function validateCreate(input: CreateAICandidate): void {
  if (input.task.length === 0 || input.task.trim() !== input.task) {
    throw new PersistenceDataError('AI candidate task must be canonical text');
  }
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) {
    throw new PersistenceDataError('AI candidate expected revision is invalid');
  }
  if (!input.validation.schemaValid || !input.validation.domainValid) {
    throw new PersistenceDataError('AI candidate requires successful schema and domain validation');
  }
  if (!['INITIAL', 'EDIT', 'REGENERATE'].includes(input.provenance.revisionKind)) {
    throw new PersistenceDataError('AI candidate revision kind is invalid');
  }
  for (const [label, value] of [
    ['requestId', input.provenance.requestId],
    ['providerId', input.provenance.providerId],
    ['modelName', input.provenance.modelName],
  ] as const) {
    if (value.length === 0 || value.trim() !== value) {
      throw new PersistenceDataError(`AI candidate ${label} must be canonical text`);
    }
  }
  if (
    input.validation.checks.length === 0 ||
    input.validation.checks.some((check) => check.length === 0 || check.trim() !== check)
  ) {
    throw new PersistenceDataError('AI candidate validation checks must be canonical text');
  }
  for (const fingerprint of [
    input.provenance.resolvedModelFingerprint,
    input.provenance.contextManifestHash,
  ]) {
    if (!/^[0-9a-f]{64}$/u.test(fingerprint)) {
      throw new PersistenceDataError('AI candidate provenance fingerprint is invalid');
    }
  }
  if (findSecretInJson(input.payload, '$candidate.payload') !== null) {
    throw new PersistenceDataError('AI candidate payload contains credential-like data');
  }
  if (findSecretInJson(input.provenance, '$candidate.provenance') !== null) {
    throw new PersistenceDataError('AI candidate provenance contains credential-like data');
  }
}

function mapCandidate(value: unknown): AICandidate {
  const row = requireRecord(value, 'AI candidate row');
  const status = requireString(row['status'], 'status');
  if (!['PROPOSED', 'ACCEPTED', 'REJECTED', 'SUPERSEDED'].includes(status)) {
    throw new PersistenceDataError('AI candidate status is invalid');
  }
  const generation = requireNullableString(row['generation_record_id'], 'generation_record_id');
  const supersedes = requireNullableString(
    row['supersedes_candidate_id'],
    'supersedes_candidate_id',
  );
  const supersededBy = requireNullableString(
    row['superseded_by_candidate_id'],
    'superseded_by_candidate_id',
  );
  return Object.freeze({
    id: aiCandidateId(requireString(row['id'], 'id')),
    campaignId: campaignId(requireString(row['campaign_id'], 'campaign_id')),
    operationId: aiOperationId(requireString(row['operation_id'], 'operation_id')),
    task: requireString(row['task'], 'task'),
    generationRecordId: generation === null ? null : generationRecordId(generation),
    payload: freezeJson(parseJson(row['payload_json'], 'payload_json')),
    validation: parseValidation(parseJson(row['validation_json'], 'validation_json')),
    provenance: parseProvenance(parseJson(row['provenance_json'], 'provenance_json')),
    expectedRevision: requireSafeRevision(row['expected_revision']),
    status: status as AICandidateStatus,
    supersedesCandidateId: supersedes === null ? null : aiCandidateId(supersedes),
    supersededByCandidateId: supersededBy === null ? null : aiCandidateId(supersededBy),
    createdAt: isoTimestamp(requireString(row['created_at'], 'created_at')),
    updatedAt: isoTimestamp(requireString(row['updated_at'], 'updated_at')),
  });
}

function parseValidation(value: unknown): AICandidateValidationEvidence {
  const record = requireRecord(value, 'validation');
  if (!requireBoolean(record['schemaValid'], 'schemaValid')) {
    throw new PersistenceDataError('Candidate schema validation must be true');
  }
  if (!requireBoolean(record['domainValid'], 'domainValid')) {
    throw new PersistenceDataError('Candidate domain validation must be true');
  }
  return Object.freeze({
    schemaValid: true,
    domainValid: true,
    validatedAt: isoTimestamp(requireString(record['validatedAt'], 'validatedAt')),
    checks: Object.freeze(
      requireArray(record['checks'], 'checks').map((check) => requireString(check, 'check')),
    ),
  });
}

function parseProvenance(value: unknown): AICandidateProvenance {
  const record = requireRecord(value, 'provenance');
  return Object.freeze({
    revisionKind: parseRevisionKind(record['revisionKind']),
    requestId: aiRequestId(requireString(record['requestId'], 'requestId')),
    providerId: requireString(record['providerId'], 'providerId'),
    modelName: requireString(record['modelName'], 'modelName'),
    resolvedModelFingerprint: requireString(
      record['resolvedModelFingerprint'],
      'resolvedModelFingerprint',
    ),
    contextManifestHash: requireString(record['contextManifestHash'], 'contextManifestHash'),
  });
}

function parseRevisionKind(value: unknown): AICandidateProvenance['revisionKind'] {
  const kind = requireString(value, 'revisionKind');
  if (kind !== 'INITIAL' && kind !== 'EDIT' && kind !== 'REGENERATE') {
    throw new PersistenceDataError('Candidate revision kind is invalid');
  }
  return kind;
}

function requireSafeRevision(value: unknown): number {
  const revision = requireNumber(value, 'expected_revision');
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new PersistenceDataError('Candidate expected revision is invalid');
  }
  return revision;
}

function freezeJson(value: unknown): JsonValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return value;
  }
  if (Array.isArray(value)) return Object.freeze(value.map(freezeJson));
  if (typeof value === 'object') {
    return Object.freeze(
      Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, freezeJson(entry)])),
    );
  }
  throw new PersistenceDataError('AI candidate JSON contains unsupported values');
}

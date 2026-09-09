import { DatabaseSync } from 'node:sqlite';

import {
  aiCandidateId,
  aiOperationId,
  aiRequestId,
  campaignId,
  isoTimestamp,
  type JsonValue,
} from '@ember-tavern/contracts';
import type { TransactionalSqliteDatabase } from '@ember-tavern/persistence';
import { describe, expect, it, vi } from 'vitest';

import { applyMigrations } from '../../persistence/src/migrations.mjs';
import {
  COMBAT_CANDIDATE_REQUIRED_CHECKS,
  CombatCandidatePolicyError,
  CombatContentCandidatePolicy,
  type CombatCandidateValidator,
  type GeneratedCombatCandidate,
} from './combat-content-candidate-policy.js';

const campaign = campaignId('campaign-combat-candidate');
const at = isoTimestamp('2026-09-09T00:00:00.000Z');

describe('CombatContentCandidatePolicy', () => {
  it('runs user-requested generate, validate, preview, edit/regenerate, confirm and commit', async () => {
    const database = await createDatabase();
    try {
      const validator = canonicalValidator();
      const policy = new CombatContentCandidatePolicy(database, validator, () => at);
      const initial = policy.acceptGenerated(generated('initial', 'USER_REQUESTED'));
      expect(initial.status).toBe('PROPOSED');
      expect(policy.previewUserCandidate(initial.id).payload).toMatchObject({
        schemaVersion: 1,
        submissionPolicy: 'USER_REQUESTED',
        approvedDefinition: { abilityId: 'ability.initial', canonical: true },
      });
      expect(readCommitted(database)).toEqual([]);

      const edited = policy.reviseUserCandidate({
        sourceCandidateId: initial.id,
        id: aiCandidateId('candidate-edited'),
        operationId: aiOperationId('operation-edited'),
        generationRecordId: null,
        payload: { abilityId: 'ability.edited' },
        provenance: provenance('edited'),
        kind: 'EDIT',
      });
      const regenerated = policy.reviseUserCandidate({
        sourceCandidateId: edited.id,
        id: aiCandidateId('candidate-regenerated'),
        operationId: aiOperationId('operation-regenerated'),
        generationRecordId: null,
        payload: { abilityId: 'ability.regenerated' },
        provenance: provenance('regenerated'),
        kind: 'REGENERATE',
      });
      expect(policy.previewUserCandidate(initial.id).status).toBe('SUPERSEDED');
      expect(policy.previewUserCandidate(edited.id).status).toBe('SUPERSEDED');
      expect(readCommitted(database)).toEqual([]);

      const commit = vi.fn((payload: JsonValue) => commitPayload(database, payload));
      expect(policy.confirmUserCandidate(regenerated.id, campaign, 7, commit)).toBe('COMMITTED');
      expect(policy.confirmUserCandidate(regenerated.id, campaign, 7, commit)).toBe(
        'ALREADY_COMMITTED',
      );
      expect(commit).toHaveBeenCalledTimes(1);
      expect(readCommitted(database)).toEqual([
        JSON.stringify({ abilityId: 'ability.regenerated', canonical: true }),
      ]);
      expect(validator.validate).toHaveBeenCalledTimes(4);
    } finally {
      database.close();
    }
  });

  it('auto-accepts valid background content with its domain write in one idempotent transaction', async () => {
    const database = await createDatabase();
    try {
      let clock = 0;
      const policy = new CombatContentCandidatePolicy(database, canonicalValidator(), () =>
        isoTimestamp(`2026-09-09T00:00:0${clock++}.000Z`),
      );
      const input = generated('background', 'BACKGROUND_WORLD_CONTENT');
      const commit = vi.fn((payload: JsonValue) => commitPayload(database, payload));
      expect(policy.acceptGenerated(input, commit).status).toBe('ACCEPTED');
      expect(policy.acceptGenerated(input, commit).status).toBe('ACCEPTED');
      expect(() =>
        policy.acceptGenerated(
          { ...input, payload: { abilityId: 'ability.changed-replay' } },
          commit,
        ),
      ).toThrow(/replay identity/u);
      expect(commit).toHaveBeenCalledTimes(1);
      expect(readCommitted(database)).toHaveLength(1);
      expect(candidateCount(database)).toBe(1);
    } finally {
      database.close();
    }
  });

  it('rejects invalid or incomplete Gate E candidates before persistence', async () => {
    const database = await createDatabase();
    try {
      const invalid: CombatCandidateValidator = {
        validate: vi.fn(() => ({
          canonicalPayload: { abilityId: 'ability.invalid' },
          checks: COMBAT_CANDIDATE_REQUIRED_CHECKS.slice(0, -1),
        })),
      };
      const policy = new CombatContentCandidatePolicy(database, invalid, () => at);
      expect(() => policy.acceptGenerated(generated('invalid', 'USER_REQUESTED'))).toThrow(
        CombatCandidatePolicyError,
      );
      expect(candidateCount(database)).toBe(0);
      expect(readCommitted(database)).toEqual([]);
    } finally {
      database.close();
    }
  });

  it('rolls back background candidate and domain state together when commit fails', async () => {
    const database = await createDatabase();
    try {
      const policy = new CombatContentCandidatePolicy(database, canonicalValidator(), () => at);
      expect(() =>
        policy.acceptGenerated(generated('rollback', 'BACKGROUND_WORLD_CONTENT'), (payload) => {
          commitPayload(database, payload);
          throw new Error('domain failure');
        }),
      ).toThrow('domain failure');
      expect(candidateCount(database)).toBe(0);
      expect(readCommitted(database)).toEqual([]);
    } finally {
      database.close();
    }
  });

  it('enforces policy-specific actions and revalidates stored payload before commit', async () => {
    const database = await createDatabase();
    try {
      const validator = canonicalValidator();
      const policy = new CombatContentCandidatePolicy(database, validator, () => at);
      expect(() =>
        policy.acceptGenerated(generated('user-direct', 'USER_REQUESTED'), () => {}),
      ).toThrow(/explicit confirmation/u);
      expect(() =>
        policy.acceptGenerated(generated('background-no-commit', 'BACKGROUND_WORLD_CONTENT')),
      ).toThrow(/requires an automatic domain commit/u);

      const candidate = policy.acceptGenerated(generated('revalidate', 'USER_REQUESTED'));
      database.prepare('UPDATE ai_candidates SET payload_json = ? WHERE id = ?').run(
        JSON.stringify({
          schemaVersion: 1,
          submissionPolicy: 'BACKGROUND_WORLD_CONTENT',
          approvedDefinition: { abilityId: 'ability.tampered' },
        }),
        candidate.id,
      );
      expect(() => policy.confirmUserCandidate(candidate.id, campaign, 7, () => {})).toThrow(
        CombatCandidatePolicyError,
      );
      expect(readStatus(database, candidate.id)).toBe('PROPOSED');
      expect(candidateCount(database)).toBe(1);
    } finally {
      database.close();
    }
  });
});

function canonicalValidator() {
  return {
    validate: vi.fn((payload: unknown) => {
      if (
        payload === null ||
        typeof payload !== 'object' ||
        Array.isArray(payload) ||
        typeof (payload as { abilityId?: unknown }).abilityId !== 'string'
      ) {
        throw new CombatCandidatePolicyError('invalid approved definition');
      }
      return {
        canonicalPayload: {
          abilityId: (payload as { abilityId: string }).abilityId,
          canonical: true,
        },
        checks: COMBAT_CANDIDATE_REQUIRED_CHECKS,
      };
    }),
  } satisfies CombatCandidateValidator;
}

function generated(
  suffix: string,
  submissionPolicy: GeneratedCombatCandidate['submissionPolicy'],
): GeneratedCombatCandidate {
  return {
    id: aiCandidateId(`candidate-${suffix}`),
    campaignId: campaign,
    operationId: aiOperationId(`operation-${suffix}`),
    generationRecordId: null,
    submissionPolicy,
    payload: { abilityId: `ability.${suffix}` },
    provenance: provenance(suffix),
    expectedRevision: 7,
  };
}

function provenance(suffix: string) {
  return {
    requestId: aiRequestId(`request-${suffix}`),
    providerId: 'provider-combat',
    modelName: 'model-combat',
    resolvedModelFingerprint: 'a'.repeat(64),
    contextManifestHash: 'b'.repeat(64),
  };
}

function commitPayload(database: DatabaseSync, payload: JsonValue): void {
  database
    .prepare('INSERT INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?)')
    .run(`combat-${readCommitted(database).length}`, JSON.stringify(payload), at);
}

function readCommitted(database: DatabaseSync): string[] {
  return database
    .prepare("SELECT value_json FROM app_settings WHERE key LIKE 'combat-%' ORDER BY key")
    .all()
    .map((row) => (row as { value_json: string }).value_json);
}

function candidateCount(database: DatabaseSync): number {
  return (
    database.prepare('SELECT COUNT(*) AS count FROM ai_candidates').get() as { count: number }
  ).count;
}

function readStatus(database: DatabaseSync, id: string): string {
  return (
    database.prepare('SELECT status FROM ai_candidates WHERE id = ?').get(id) as { status: string }
  ).status;
}

async function createDatabase(): Promise<DatabaseSync & TransactionalSqliteDatabase> {
  const database = new DatabaseSync(':memory:') as DatabaseSync & TransactionalSqliteDatabase;
  await applyMigrations(database);
  database
    .prepare(
      `INSERT INTO campaigns (
         id, schema_version, state, task_model_overrides_json, model_switch_policy,
         created_at, updated_at
       ) VALUES (?, 1, 'CREATING_WORLD', '{}', 'ASK', ?, ?)`,
    )
    .run(campaign, at, at);
  return database;
}

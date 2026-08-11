import { DatabaseSync } from 'node:sqlite';

import {
  aiCandidateId,
  aiOperationId,
  aiRequestId,
  campaignId,
  eventLedgerId,
  isoTimestamp,
  type JsonValue,
} from '@ember-tavern/contracts';
import {
  AICandidateTransitionError,
  EventLedgerRepository,
  type TransactionalSqliteDatabase,
} from '@ember-tavern/persistence';
import { describe, expect, it, vi } from 'vitest';

import { applyMigrations } from '../../persistence/src/migrations.mjs';
import { AICandidateUseCases } from './ai-candidate-use-cases.js';

const campaign = campaignId('campaign-candidate');
const at = isoTimestamp('2026-08-08T00:00:00.000Z');

describe('AICandidateUseCases', () => {
  it('supports generate, validate, preview, edit and supersede without mutating domain state', async () => {
    const database = await createDatabase();
    try {
      const useCases = new AICandidateUseCases(database, () => at);
      const proposed = useCases.propose(proposal('candidate-initial', 'operation-initial'));
      expect(useCases.preview(proposed.id)).toMatchObject({
        status: 'PROPOSED',
        payload: { title: 'Initial quest' },
        validation: { schemaValid: true, domainValid: true },
      });

      const edited = useCases.revise({
        sourceCandidateId: proposed.id,
        id: aiCandidateId('candidate-edited'),
        operationId: aiOperationId('operation-edited'),
        generationRecordId: null,
        payload: { title: 'Edited quest' },
        validation: evidence(),
        provenance: provenance(),
        kind: 'EDIT',
      });
      expect(edited).toMatchObject({
        status: 'PROPOSED',
        supersedesCandidateId: proposed.id,
        provenance: { revisionKind: 'EDIT' },
      });
      expect(useCases.preview(proposed.id)).toMatchObject({
        status: 'SUPERSEDED',
        supersededByCandidateId: edited.id,
      });
      expect(database.prepare('SELECT COUNT(*) AS count FROM quests').get()).toEqual({ count: 0 });
      database.prepare('DELETE FROM campaigns WHERE id = ?').run(campaign);
      expect(database.prepare('SELECT COUNT(*) AS count FROM ai_candidates').get()).toEqual({
        count: 0,
      });
    } finally {
      database.close();
    }
  });

  it('confirms with a revision guard and commits candidate state atomically exactly once', async () => {
    const database = await createDatabase();
    try {
      const useCases = new AICandidateUseCases(database, () => at);
      const candidate = useCases.propose(proposal('candidate-confirm', 'operation-confirm'));
      const ledger = new EventLedgerRepository(database);
      const commit = vi.fn((payload: JsonValue) => {
        database
          .prepare('INSERT INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?)')
          .run('candidate-result', JSON.stringify(payload), at);
        ledger.append({
          id: eventLedgerId('ledger-candidate-confirm'),
          campaignId: campaign,
          eventType: 'QUEST_COMMITTED',
          operationId: candidate.operationId,
          aggregateType: 'QUEST',
          aggregateId: 'quest-candidate',
          revision: 1,
          payload: { candidateId: candidate.id },
          payloadVersion: 1,
          source: 'USER_ACCEPTANCE',
        });
      });

      expect(() =>
        useCases.confirm({ id: candidate.id, campaignId: campaign, expectedRevision: 8, commit }),
      ).toThrow(AICandidateTransitionError);
      expect(commit).not.toHaveBeenCalled();
      expect(
        useCases.confirm({ id: candidate.id, campaignId: campaign, expectedRevision: 7, commit }),
      ).toBe('COMMITTED');
      expect(
        useCases.confirm({ id: candidate.id, campaignId: campaign, expectedRevision: 7, commit }),
      ).toBe('ALREADY_COMMITTED');
      expect(commit).toHaveBeenCalledTimes(1);
      expect(useCases.preview(candidate.id).status).toBe('ACCEPTED');
      expect(ledger.listAggregate('QUEST', 'quest-candidate')).toHaveLength(1);
    } finally {
      database.close();
    }
  });

  it('rolls back both domain writes and acceptance when commit fails', async () => {
    const database = await createDatabase();
    try {
      const useCases = new AICandidateUseCases(database, () => at);
      const candidate = useCases.propose(proposal('candidate-rollback', 'operation-rollback'));
      const ledger = new EventLedgerRepository(database);
      expect(() =>
        useCases.confirm({
          id: candidate.id,
          campaignId: campaign,
          expectedRevision: 7,
          commit() {
            database
              .prepare('INSERT INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?)')
              .run('must-rollback', '{}', at);
            ledger.append({
              id: eventLedgerId('ledger-must-rollback'),
              campaignId: campaign,
              eventType: 'QUEST_COMMITTED',
              operationId: candidate.operationId,
              aggregateType: 'QUEST',
              aggregateId: 'quest-rollback',
              revision: 1,
              payload: {},
              payloadVersion: 1,
              source: 'USER_ACCEPTANCE',
            });
            throw new Error('domain commit failed');
          },
        }),
      ).toThrow('domain commit failed');
      expect(useCases.preview(candidate.id).status).toBe('PROPOSED');
      expect(database.prepare("SELECT * FROM app_settings WHERE key = 'must-rollback'").get()).toBe(
        undefined,
      );
      expect(ledger.listAggregate('QUEST', 'quest-rollback')).toEqual([]);
    } finally {
      database.close();
    }
  });

  it('rejects candidates and credential-like payloads fail closed', async () => {
    const database = await createDatabase();
    try {
      const useCases = new AICandidateUseCases(database, () => at);
      const candidate = useCases.propose(proposal('candidate-reject', 'operation-reject'));
      expect(useCases.reject(candidate.id).status).toBe('REJECTED');
      expect(() =>
        useCases.confirm({
          id: candidate.id,
          campaignId: campaign,
          expectedRevision: 7,
          commit() {},
        }),
      ).toThrow(AICandidateTransitionError);
      expect(() =>
        useCases.propose({
          ...proposal('candidate-secret', 'operation-secret'),
          payload: { apiKey: 'sk-secret12345678' },
        }),
      ).toThrow(/credential-like/u);
    } finally {
      database.close();
    }
  });
});

function proposal(id: string, operation: string) {
  return {
    id: aiCandidateId(id),
    campaignId: campaign,
    operationId: aiOperationId(operation),
    task: 'GENERATE_QUEST',
    generationRecordId: null,
    payload: { title: 'Initial quest' },
    validation: evidence(),
    provenance: { ...provenance(), revisionKind: 'INITIAL' as const },
    expectedRevision: 7,
  };
}

function evidence() {
  return {
    schemaValid: true as const,
    domainValid: true as const,
    validatedAt: at,
    checks: ['schema:GenerateQuestOutput', 'domain:quest-policy'],
  };
}

function provenance() {
  return {
    requestId: aiRequestId('request-candidate'),
    providerId: 'provider-candidate',
    modelName: 'model-candidate',
    resolvedModelFingerprint: 'a'.repeat(64),
    contextManifestHash: 'b'.repeat(64),
  };
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

import { DatabaseSync } from 'node:sqlite';

import {
  LEDGER_AGGREGATE_TYPES,
  LEDGER_EVENT_TYPES,
  aiOperationId,
  campaignId,
  eventLedgerId,
} from '@ember-tavern/contracts';
import { describe, expect, it } from 'vitest';

import { applyMigrations } from './migrations.mjs';
import { EventLedgerRepository } from './event-ledger-repository.js';

const campaign = campaignId('campaign-ledger');

describe('EventLedgerRepository', () => {
  it('covers the eight initial aggregate families with database timestamps', async () => {
    const database = await createDatabase();
    try {
      const ledger = new EventLedgerRepository(database);
      LEDGER_EVENT_TYPES.forEach((eventType, index) => {
        const aggregateType = LEDGER_AGGREGATE_TYPES[index];
        if (aggregateType === undefined) throw new Error('Ledger registry length mismatch');
        ledger.append({
          id: eventLedgerId(`ledger-${index + 1}`),
          campaignId: campaign,
          eventType,
          operationId: aiOperationId(`operation-${index + 1}`),
          aggregateType,
          aggregateId: `aggregate-${index + 1}`,
          revision: 1,
          payload: { eventType },
          payloadVersion: 1,
          source: index % 2 === 0 ? 'LOCAL_RULE' : 'USER_ACCEPTANCE',
        });
      });
      const entries = ledger.listCampaign(campaign);
      expect(entries).toHaveLength(8);
      expect(entries.map(({ eventType }) => eventType).sort()).toEqual(
        [...LEDGER_EVENT_TYPES].sort(),
      );
      expect(entries.every(({ occurredAt }) => occurredAt.endsWith('Z'))).toBe(true);
    } finally {
      database.close();
    }
  });

  it('enforces contiguous revisions and idempotent operation tuples', async () => {
    const database = await createDatabase();
    try {
      const ledger = new EventLedgerRepository(database);
      ledger.append(entry('ledger-first', 'operation-first', 1));
      expect(() => ledger.append(entry('ledger-gap', 'operation-gap', 3))).toThrow(
        /revision must be contiguous/u,
      );
      ledger.append(entry('ledger-second', 'operation-second', 2));
      expect(ledger.listAggregate('TURN', 'turn-a').map(({ revision }) => revision)).toEqual([
        1, 2,
      ]);
      expect(() =>
        ledger.append(entry('ledger-duplicate-operation', 'operation-first', 3)),
      ).toThrow();
    } finally {
      database.close();
    }
  });

  it('rejects credential-like audit payloads before SQLite writes', async () => {
    const database = await createDatabase();
    try {
      const ledger = new EventLedgerRepository(database);
      expect(() =>
        ledger.append({
          ...entry('ledger-secret', 'operation-secret', 1),
          payload: { token: 'x' },
        }),
      ).toThrow(/credential-like/u);
      expect(ledger.listCampaign(campaign)).toEqual([]);
    } finally {
      database.close();
    }
  });
});

function entry(id: string, operation: string, revision: number) {
  return {
    id: eventLedgerId(id),
    campaignId: campaign,
    eventType: 'TURN_COMMITTED' as const,
    operationId: aiOperationId(operation),
    aggregateType: 'TURN' as const,
    aggregateId: 'turn-a',
    revision,
    payload: { scene: 'Ash Harbor' },
    payloadVersion: 1,
    source: 'LOCAL_RULE' as const,
  };
}

async function createDatabase(): Promise<DatabaseSync> {
  const database = new DatabaseSync(':memory:');
  await applyMigrations(database);
  database
    .prepare(
      `INSERT INTO campaigns (
         id, schema_version, state, task_model_overrides_json, model_switch_policy,
         created_at, updated_at
       ) VALUES (?, 1, 'CREATING_WORLD', '{}', 'ASK', ?, ?)`,
    )
    .run(campaign, '2026-08-08T00:00:00.000Z', '2026-08-08T00:00:00.000Z');
  return database;
}

import {
  LEDGER_AGGREGATE_TYPES,
  LEDGER_EVENT_TYPES,
  LEDGER_SOURCES,
  aiOperationId,
  campaignId,
  eventLedgerId,
  isoTimestamp,
  type EventLedgerEntry,
  type JsonValue,
} from '@ember-tavern/contracts';

import { PersistenceDataError } from './campaign-repository.js';
import {
  parseJson,
  requireEnum,
  requireNumber,
  requireRecord,
  requireString,
} from './persistence-validation.js';
import { findSecretInJson } from './save-secret-scanner.js';
import type { SqliteDatabase } from './sqlite-port.js';

export type AppendEventLedgerEntry = Omit<EventLedgerEntry, 'occurredAt'>;

export class EventLedgerRepository {
  public constructor(private readonly database: SqliteDatabase) {}

  public append(input: AppendEventLedgerEntry): EventLedgerEntry {
    validateAppend(input);
    this.database
      .prepare(
        `INSERT INTO event_ledger (
           id, campaign_id, event_type, operation_id, aggregate_type, aggregate_id,
           revision, payload_json, payload_version, source
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.campaignId,
        input.eventType,
        input.operationId,
        input.aggregateType,
        input.aggregateId,
        input.revision,
        JSON.stringify(input.payload),
        input.payloadVersion,
        input.source,
      );
    return this.require(input.id);
  }

  public get(id: EventLedgerEntry['id']): EventLedgerEntry | null {
    const row = this.database.prepare('SELECT * FROM event_ledger WHERE id = ?').get(id);
    return row === undefined ? null : mapEntry(row);
  }

  public require(id: EventLedgerEntry['id']): EventLedgerEntry {
    const entry = this.get(id);
    if (entry === null) throw new PersistenceDataError(`Event Ledger entry not found: ${id}`);
    return entry;
  }

  public listCampaign(campaign: EventLedgerEntry['campaignId']): readonly EventLedgerEntry[] {
    return Object.freeze(
      this.database
        .prepare(
          `SELECT * FROM event_ledger
           WHERE campaign_id = ?
           ORDER BY occurred_at, id`,
        )
        .all(campaign)
        .map(mapEntry),
    );
  }

  public listAggregate(
    aggregateType: EventLedgerEntry['aggregateType'],
    aggregateId: string,
  ): readonly EventLedgerEntry[] {
    return Object.freeze(
      this.database
        .prepare(
          `SELECT * FROM event_ledger
           WHERE aggregate_type = ? AND aggregate_id = ?
           ORDER BY revision`,
        )
        .all(aggregateType, aggregateId)
        .map(mapEntry),
    );
  }
}

function validateAppend(input: AppendEventLedgerEntry): void {
  if (input.aggregateId.length === 0 || input.aggregateId.trim() !== input.aggregateId) {
    throw new PersistenceDataError('Event Ledger aggregate ID must be canonical text');
  }
  for (const [label, value] of [
    ['revision', input.revision],
    ['payloadVersion', input.payloadVersion],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new PersistenceDataError(`Event Ledger ${label} must be a positive safe integer`);
    }
  }
  if (findSecretInJson(input.payload, '$ledger.payload') !== null) {
    throw new PersistenceDataError('Event Ledger payload contains credential-like data');
  }
}

function mapEntry(value: unknown): EventLedgerEntry {
  const row = requireRecord(value, 'Event Ledger row');
  const revision = positiveInteger(row['revision'], 'revision');
  const payloadVersion = positiveInteger(row['payload_version'], 'payload_version');
  return Object.freeze({
    id: eventLedgerId(requireString(row['id'], 'id')),
    campaignId: campaignId(requireString(row['campaign_id'], 'campaign_id')),
    eventType: requireEnum(LEDGER_EVENT_TYPES, row['event_type'], 'event_type'),
    operationId: aiOperationId(requireString(row['operation_id'], 'operation_id')),
    aggregateType: requireEnum(LEDGER_AGGREGATE_TYPES, row['aggregate_type'], 'aggregate_type'),
    aggregateId: requireString(row['aggregate_id'], 'aggregate_id'),
    revision,
    payload: freezeJson(parseJson(row['payload_json'], 'payload_json')),
    payloadVersion,
    source: requireEnum(LEDGER_SOURCES, row['source'], 'source'),
    occurredAt: isoTimestamp(requireString(row['occurred_at'], 'occurred_at')),
  });
}

function positiveInteger(value: unknown, label: string): number {
  const parsed = requireNumber(value, label);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new PersistenceDataError(`Event Ledger ${label} is invalid`);
  }
  return parsed;
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
  throw new PersistenceDataError('Event Ledger payload contains unsupported values');
}

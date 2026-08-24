import { describe, expect, it } from 'vitest';

import {
  campaignId,
  createHistoricalSummary,
  createWorldLoreEntry,
  historicalSummaryId,
  isoTimestamp,
  worldLoreEntryId,
} from './index.js';

const at = isoTimestamp('2026-08-24T08:00:00.000Z');
const later = isoTimestamp('2026-08-24T09:00:00.000Z');
const hash = 'a'.repeat(64);
const source = Object.freeze({
  kind: 'GAME_EVENT' as const,
  id: 'event-memory-source',
  revision: 1,
  contentHash: hash,
  occurredAt: at,
});

describe('Memory Layer contracts', () => {
  it('keeps summaries and World Lore source-backed without a Truth authority', () => {
    const summary = createHistoricalSummary({
      id: historicalSummaryId('summary-adventure'),
      campaignId: campaignId('campaign-memory'),
      scopeKind: 'ADVENTURE',
      scopeId: 'adventure-one',
      actor: null,
      text: 'The party restored the harbor beacon.',
      sources: [source],
      sourceDigest: 'b'.repeat(64),
      coveredFrom: at,
      coveredTo: later,
      generationRecordId: null,
      revision: 1,
      createdAt: later,
      updatedAt: later,
    });
    const lore = createWorldLoreEntry({
      id: worldLoreEntryId('lore-beacon'),
      campaignId: summary.campaignId,
      title: 'The Harbor Beacon',
      text: 'Harbor pilots use the beacon as a seasonal landmark.',
      sources: [source],
      sourceDigest: 'c'.repeat(64),
      generationRecordId: null,
      revision: 1,
      createdAt: later,
      updatedAt: later,
    });

    expect(summary.kind).toBe('SUMMARY');
    expect(lore.kind).toBe('WORLD_LORE');
    expect(summary).not.toHaveProperty('authority');
    expect(lore).not.toHaveProperty('authority');
    expect(summary.sources[0]).toEqual(source);
  });

  it('requires exact Actor scope and bounded unique provenance', () => {
    const base = {
      id: historicalSummaryId('summary-actor'),
      campaignId: campaignId('campaign-memory'),
      scopeKind: 'ACTOR' as const,
      scopeId: 'npc-one',
      actor: { type: 'NPC' as const, id: 'npc-one' },
      text: 'The keeper remembers the repaired beacon.',
      sources: [source],
      sourceDigest: 'd'.repeat(64),
      coveredFrom: at,
      coveredTo: later,
      generationRecordId: null,
      revision: 1,
      createdAt: later,
      updatedAt: later,
    };
    expect(createHistoricalSummary(base).actor).toEqual({ type: 'NPC', id: 'npc-one' });
    expect(() => createHistoricalSummary({ ...base, actor: null })).toThrow('ACTOR');
    expect(() => createHistoricalSummary({ ...base, sources: [source, source] })).toThrow('unique');
    expect(() => createHistoricalSummary({ ...base, coveredFrom: later, coveredTo: at })).toThrow(
      'chronological',
    );
  });
});

import {
  campaignId,
  createWorldLoreEntry,
  createWorldLoreRetrievalRule,
  isoTimestamp,
  worldLoreEntryId,
  type WorldInfoCandidateSource,
  type WorldInfoRetrievalCorpus,
} from '@ember-tavern/contracts';
import { describe, expect, it } from 'vitest';

import { WorldInfoRetrievalService } from './world-info-retrieval-service.js';

const campaign = campaignId('campaign-retrieval-cache');
const at = isoTimestamp('2026-08-24T10:00:00.000Z');

describe('WorldInfoRetrievalService', () => {
  it('uses a bounded exact corpus cache and invalidates on Lore or rule revision', async () => {
    const source = new MutableSource(corpus(1, 1));
    const service = new WorldInfoRetrievalService(source, 2);
    const query = {
      campaignId: campaign,
      text: 'Tell me about the beacon.',
      entityRefs: [],
      locationIds: [],
      questIds: [],
      minimumScore: 0.2,
      maxTokens: 1_000,
    } as const;

    const first = await service.retrieve(query);
    const second = await service.retrieve(query);
    expect(first.cache).toBe('MISS');
    expect(second.cache).toBe('HIT');
    expect(first.queryDigest).toMatch(/^[a-f0-9]{64}$/u);
    expect(first.corpusDigest).toMatch(/^[a-f0-9]{64}$/u);
    expect(first).not.toHaveProperty('queryText');

    source.value = corpus(1, 2);
    const ruleChanged = await service.retrieve(query);
    expect(ruleChanged.cache).toBe('MISS');
    expect(ruleChanged.corpusDigest).not.toBe(first.corpusDigest);

    source.value = corpus(2, 2);
    const loreChanged = await service.retrieve(query);
    expect(loreChanged.cache).toBe('MISS');
    expect(loreChanged.corpusDigest).not.toBe(ruleChanged.corpusDigest);
    service.clearCampaign(campaign);
    expect((await service.retrieve(query)).cache).toBe('MISS');
  });
});

class MutableSource implements WorldInfoCandidateSource {
  public constructor(public value: WorldInfoRetrievalCorpus) {}

  public loadWorldInfoCorpus(): WorldInfoRetrievalCorpus {
    return this.value;
  }
}

function corpus(loreRevision: number, ruleRevision: number): WorldInfoRetrievalCorpus {
  const loreEntryId = worldLoreEntryId('lore-cache');
  return Object.freeze({
    campaignId: campaign,
    candidates: Object.freeze([
      Object.freeze({
        lore: createWorldLoreEntry({
          id: loreEntryId,
          campaignId: campaign,
          title: 'Beacon Rite',
          text: `Beacon lore revision ${loreRevision}.`,
          sources: [
            {
              kind: 'WORLD_FACT',
              id: 'fact-beacon',
              revision: loreRevision,
              contentHash: 'a'.repeat(64),
              occurredAt: at,
            },
          ],
          sourceDigest: 'b'.repeat(64),
          generationRecordId: null,
          revision: loreRevision,
          createdAt: at,
          updatedAt: at,
        }),
        rule: createWorldLoreRetrievalRule({
          loreEntryId,
          campaignId: campaign,
          keywords: ['beacon'],
          entityRefs: [],
          locationIds: [],
          questIds: [],
          alwaysActive: false,
          matchMode: 'ANY',
          priority: 100,
          tokenBudget: 500,
          enabled: true,
          revision: ruleRevision,
          updatedAt: at,
        }),
        current: true,
      }),
    ]),
  });
}

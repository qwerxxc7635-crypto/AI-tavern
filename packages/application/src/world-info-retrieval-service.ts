import { sha256CanonicalJson } from '@ember-tavern/ai-core';
import {
  createWorldInfoRetrievalQuery,
  type CampaignId,
  type JsonValue,
  type WorldInfoCandidateSource,
  type WorldInfoRetrievalQuery,
  type WorldInfoRetrievalResult,
} from '@ember-tavern/contracts';
import { retrieveWorldInfo } from '@ember-tavern/domain';

const DEFAULT_CACHE_SIZE = 128;

export interface CachedWorldInfoRetrieval {
  readonly queryDigest: string;
  readonly corpusDigest: string;
  readonly cache: 'HIT' | 'MISS';
  readonly result: WorldInfoRetrievalResult;
}

interface CacheEntry {
  readonly campaignId: CampaignId;
  readonly result: WorldInfoRetrievalResult;
}

export class WorldInfoRetrievalService {
  private readonly cache = new Map<string, CacheEntry>();

  public constructor(
    private readonly source: WorldInfoCandidateSource,
    private readonly maxCacheEntries = DEFAULT_CACHE_SIZE,
  ) {
    if (!Number.isSafeInteger(maxCacheEntries) || maxCacheEntries < 1 || maxCacheEntries > 1_024) {
      throw new RangeError('World Info retrieval cache size is invalid');
    }
  }

  public async retrieve(queryInput: WorldInfoRetrievalQuery): Promise<CachedWorldInfoRetrieval> {
    const query = createWorldInfoRetrievalQuery(queryInput);
    const corpus = await this.source.loadWorldInfoCorpus(query);
    const [queryDigest, corpusDigest] = await Promise.all([
      sha256CanonicalJson(toJson(query)),
      sha256CanonicalJson(toJson(corpus)),
    ]);
    const key = `${queryDigest}:${corpusDigest}`;
    const cached = this.cache.get(key);
    if (cached !== undefined) {
      this.cache.delete(key);
      this.cache.set(key, cached);
      return Object.freeze({
        queryDigest,
        corpusDigest,
        cache: 'HIT',
        result: cached.result,
      });
    }
    const result = retrieveWorldInfo(query, corpus);
    this.cache.set(key, Object.freeze({ campaignId: query.campaignId, result }));
    while (this.cache.size > this.maxCacheEntries) {
      const oldest = this.cache.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
    return Object.freeze({ queryDigest, corpusDigest, cache: 'MISS', result });
  }

  public clearCampaign(campaign: CampaignId): void {
    for (const [key, entry] of this.cache) {
      if (entry.campaignId === campaign) this.cache.delete(key);
    }
  }
}

function toJson(value: unknown): JsonValue {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new TypeError('World Info retrieval value is not JSON');
  return JSON.parse(serialized) as JsonValue;
}

import { describe, expect, it } from 'vitest';

import { MAX_SESSION_CACHE_PREFIXES, SessionCachePrefixTracker } from './cache-observation.js';

describe('session cache prefix tracker', () => {
  it('separates prefix reuse observation from Provider cache evidence', () => {
    const tracker = new SessionCachePrefixTracker();
    const hash = 'a'.repeat(64);
    expect(tracker.observe(hash)).toBe('PREFIX_FIRST_SEEN');
    expect(tracker.observe(hash)).toBe('PREFIX_REUSED');
  });

  it('uses an LRU cap and retains no prompt content', () => {
    const tracker = new SessionCachePrefixTracker();
    for (let index = 0; index <= MAX_SESSION_CACHE_PREFIXES; index += 1) {
      tracker.observe(index.toString(16).padStart(64, '0'));
    }
    expect(tracker.size()).toBe(MAX_SESSION_CACHE_PREFIXES);
    expect(tracker.observe('0'.repeat(64))).toBe('PREFIX_FIRST_SEEN');
  });
});

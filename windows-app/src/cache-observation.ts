export const MAX_SESSION_CACHE_PREFIXES = 200;

export type SessionCacheObservation = 'PREFIX_FIRST_SEEN' | 'PREFIX_REUSED';

/**
 * Bounded, process-local evidence that a stable prefix was seen before.
 * This is not Provider cache or billing evidence.
 */
export class SessionCachePrefixTracker {
  private readonly observed = new Map<string, true>();

  public observe(prefixHash: string): SessionCacheObservation {
    if (!/^[0-9a-f]{64}$/u.test(prefixHash)) return 'PREFIX_FIRST_SEEN';
    const reused = this.observed.delete(prefixHash);
    this.observed.set(prefixHash, true);
    if (this.observed.size > MAX_SESSION_CACHE_PREFIXES) {
      const oldest = this.observed.keys().next().value;
      if (oldest !== undefined) this.observed.delete(oldest);
    }
    return reused ? 'PREFIX_REUSED' : 'PREFIX_FIRST_SEEN';
  }

  public reset(): void {
    this.observed.clear();
  }

  public size(): number {
    return this.observed.size;
  }
}

import { describe, expect, it } from 'vitest';

import { npcTimelineFailure } from './npc-timeline-policy.js';

describe('npcTimelineFailure', () => {
  it.each([
    ['NETWORK', 'TIMEOUT'],
    ['NETWORK', 'NETWORK_FAILED'],
    ['VALIDATION', 'SCHEMA_VALIDATION_FAILED'],
    ['RULE', 'FACT_CONFLICT'],
    ['GENERATION', 'APP_INTERRUPTED'],
    ['GENERATION', 'CANCELLED'],
  ] as const)('allows the technical retry %s/%s', (kind, code) => {
    expect(npcTimelineFailure(kind, code).retryable).toBe(true);
  });

  it.each([
    ['PROVIDER', 'AUTHENTICATION_FAILED'],
    ['PROVIDER', 'QUOTA_EXCEEDED'],
    ['RULE', 'CAMPAIGN_STATE_INVALID'],
    ['PERSISTENCE', 'LOCAL_STORAGE_UNAVAILABLE'],
    ['GENERATION', 'UNKNOWN'],
  ] as const)('locks the final failure %s/%s', (kind, code) => {
    expect(npcTimelineFailure(kind, code).retryable).toBe(false);
  });
});

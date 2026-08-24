import { describe, expect, it } from 'vitest';

import { campaignId, isoTimestamp } from './foundation.js';
import {
  LazyWorldGenerationContractError,
  createLazyWorldGenerationPlanSeed,
  lazyWorldIntentKey,
} from './lazy-world-generation.js';

const campaign = campaignId('campaign-lazy-contract');
const at = isoTimestamp('2026-08-24T12:00:00.000Z');

describe('lazy world generation contracts', () => {
  it('builds canonical durable intent identities', () => {
    const key = lazyWorldIntentKey(campaign, 'LOCATION_DETAILS', 'location-harbor');
    expect(key).toBe('lazy:campaign-lazy-contract:location_details:location-harbor');
    expect(
      Object.isFrozen(
        createLazyWorldGenerationPlanSeed({
          intentKey: key,
          campaignId: campaign,
          kind: 'LOCATION_DETAILS',
          targetId: 'location-harbor',
          executionMode: 'BACKGROUND_ELIGIBLE',
          priority: 'P2',
          dependsOnIntentKey: null,
          createdAt: at,
        }),
      ),
    ).toBe(true);
  });

  it('rejects invalid and self-dependent plan seeds', () => {
    expect(() =>
      createLazyWorldGenerationPlanSeed({
        intentKey: 'lazy:self',
        campaignId: campaign,
        kind: 'TAVERN',
        targetId: campaign,
        executionMode: 'ON_DEMAND',
        priority: 'P0',
        dependsOnIntentKey: 'lazy:self',
        createdAt: at,
      }),
    ).toThrow(LazyWorldGenerationContractError);
    expect(() => lazyWorldIntentKey(campaign, 'TAVERN', 'bad target')).toThrow(
      LazyWorldGenerationContractError,
    );
  });
});

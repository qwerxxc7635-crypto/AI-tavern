import { describe, expect, it } from 'vitest';

import type { CampaignSummary } from './campaign-gateway.js';
import {
  APP_PATHS,
  buildRoute,
  campaignParentRoute,
  campaignRoute,
  destinationForCampaign,
  optionalCampaignRoute,
  readRouteContext,
} from './navigation.js';

describe('unified navigation contract', () => {
  it('builds canonical encoded routes without leaking unrelated entity context', () => {
    expect(
      buildRoute(APP_PATHS.npc, {
        campaignId: 'campaign/a',
        npcId: 'npc & one',
      }),
    ).toBe('/npc?campaignId=campaign%2Fa&npcId=npc+%26+one');
    expect(campaignRoute(APP_PATHS.quests, 'campaign/a')).toBe('/quests?campaignId=campaign%2Fa');
  });

  it('rejects missing, duplicate and non-canonical route context', () => {
    expect(readRouteContext(new URLSearchParams(), ['campaignId'])).toEqual({
      ok: false,
      reason: 'MISSING',
      key: 'campaignId',
    });
    expect(
      readRouteContext(new URLSearchParams('campaignId=a&campaignId=b'), ['campaignId']),
    ).toEqual({ ok: false, reason: 'DUPLICATE', key: 'campaignId' });
    expect(readRouteContext(new URLSearchParams('campaignId=%20bad'), ['campaignId'])).toEqual({
      ok: false,
      reason: 'INVALID',
      key: 'campaignId',
    });
  });

  it('preserves campaign context for parent and device routes with safe fallbacks', () => {
    const campaignSearch = new URLSearchParams('campaignId=campaign-navigation&npcId=npc-one');
    expect(campaignParentRoute(campaignSearch, APP_PATHS.tavern)).toBe(
      '/tavern?campaignId=campaign-navigation',
    );
    expect(optionalCampaignRoute(campaignSearch, APP_PATHS.settings)).toBe(
      '/settings?campaignId=campaign-navigation',
    );
    expect(campaignParentRoute(new URLSearchParams(), APP_PATHS.tavern)).toBe(APP_PATHS.saves);
    expect(optionalCampaignRoute(new URLSearchParams(), APP_PATHS.settings)).toBe(
      APP_PATHS.settings,
    );
  });

  it.each([
    ['CREATING_WORLD', '/world'],
    ['REVIEWING_WORLD', '/world'],
    ['CREATING_CHARACTER', '/character/create'],
    ['GENERATION_FAILED', '/recovery'],
    ['WAITING_FOR_MODEL', '/recovery'],
    ['RECOVERY_REQUIRED', '/recovery'],
    ['GENERATING_TAVERN', '/tavern'],
    ['TAVERN', '/tavern'],
    ['ADVENTURE', '/adventure'],
    ['SETTLEMENT', '/adventure'],
  ] satisfies readonly (readonly [CampaignSummary['state'], string])[])(
    'restores %s to its authoritative route',
    (state, path) => {
      expect(destinationForCampaign(campaign(state))).toBe(
        `${path}?campaignId=campaign-navigation`,
      );
    },
  );
});

function campaign(state: CampaignSummary['state']): CampaignSummary {
  return {
    id: 'campaign-navigation',
    state,
    createdAt: '2026-08-13T00:00:00.000Z',
    updatedAt: '2026-08-13T00:00:00.000Z',
  };
}

import { describe, expect, it } from 'vitest';

import {
  campaignId,
  createWorldInfoRetrievalQuery,
  createWorldLoreRetrievalRule,
  isoTimestamp,
  locationId,
  questId,
  worldLoreEntryId,
} from './index.js';

const at = isoTimestamp('2026-08-24T10:00:00.000Z');

describe('World Info retrieval contracts', () => {
  it('freezes a bounded structured rule and query without a vector dependency', () => {
    const rule = createWorldLoreRetrievalRule({
      loreEntryId: worldLoreEntryId('lore-beacon'),
      campaignId: campaignId('campaign-retrieval'),
      keywords: ['beacon'],
      entityRefs: [{ kind: 'NPC', id: 'npc-keeper' }],
      locationIds: [locationId('location-harbor')],
      questIds: [questId('quest-beacon')],
      alwaysActive: false,
      matchMode: 'ANY',
      priority: 500,
      tokenBudget: 800,
      enabled: true,
      revision: 1,
      updatedAt: at,
    });
    const query = createWorldInfoRetrievalQuery({
      campaignId: rule.campaignId,
      text: 'Who tends the beacon?',
      entityRefs: rule.entityRefs,
      locationIds: rule.locationIds,
      questIds: rule.questIds,
      minimumScore: 0.2,
      maxTokens: 1_200,
    });

    expect(rule).toMatchObject({ matchMode: 'ANY', priority: 500, revision: 1 });
    expect(query.locationIds).toEqual([locationId('location-harbor')]);
    expect(Object.isFrozen(rule.entityRefs)).toBe(true);
  });

  it('rejects triggerless, duplicate, malformed and unbounded configuration', () => {
    const base = {
      loreEntryId: worldLoreEntryId('lore-invalid'),
      campaignId: campaignId('campaign-retrieval'),
      keywords: [] as string[],
      entityRefs: [],
      locationIds: [],
      questIds: [],
      alwaysActive: false,
      matchMode: 'ANY' as const,
      priority: 1,
      tokenBudget: 100,
      enabled: true,
      revision: 1,
      updatedAt: at,
    };
    expect(() => createWorldLoreRetrievalRule(base)).toThrow('requires a trigger');
    expect(() => createWorldLoreRetrievalRule({ ...base, keywords: ['Beacon', 'beacon'] })).toThrow(
      'unique',
    );
    expect(() =>
      createWorldLoreRetrievalRule({ ...base, alwaysActive: true, priority: 1_001 }),
    ).toThrow('priority');
    expect(() =>
      createWorldInfoRetrievalQuery({
        campaignId: base.campaignId,
        text: '',
        entityRefs: [
          { kind: 'NPC', id: 'npc-1' },
          { kind: 'NPC', id: 'npc-1' },
        ],
        locationIds: [],
        questIds: [],
        minimumScore: 0,
        maxTokens: 100,
      }),
    ).toThrow('unique');
  });
});

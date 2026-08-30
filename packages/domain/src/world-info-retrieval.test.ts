import {
  campaignId,
  createWorldLoreEntry,
  createWorldLoreRetrievalRule,
  isoTimestamp,
  locationId,
  questId,
  worldLoreEntryId,
  type WorldInfoRetrievalCandidate,
} from '@ember-tavern/contracts';
import { describe, expect, it } from 'vitest';

import { retrieveWorldInfo } from './world-info-retrieval.js';

const campaign = campaignId('campaign-world-info');
const at = isoTimestamp('2026-08-24T10:00:00.000Z');

describe('retrieveWorldInfo', () => {
  it('explains keyword, entity, location and Quest triggers without substring false matches', () => {
    const keyword = candidate('lore-keyword', ['port'], [], [], [], 100);
    const entity = candidate('lore-entity', [], [{ kind: 'NPC', id: 'npc-keeper' }], [], [], 400);
    const location = candidate('lore-location', [], [], [locationId('location-harbor')], [], 300);
    const quest = candidate('lore-quest', [], [], [], [questId('quest-beacon')], 200);
    const falseMatch = retrieveWorldInfo(query('The portal is sealed.'), {
      campaignId: campaign,
      candidates: [keyword],
    });
    expect(falseMatch.selections).toEqual([]);
    expect(falseMatch.manifest[0]?.reason).toBe('NO_TRIGGER_MATCH');

    const result = retrieveWorldInfo(
      {
        ...query('Ask about the port.'),
        entityRefs: [{ kind: 'NPC', id: 'npc-keeper' }],
        locationIds: [locationId('location-harbor')],
        questIds: [questId('quest-beacon')],
      },
      { campaignId: campaign, candidates: [keyword, entity, location, quest] },
    );
    expect(result.selections.map(({ loreEntryId }) => loreEntryId)).toEqual([
      worldLoreEntryId('lore-entity'),
      worldLoreEntryId('lore-location'),
      worldLoreEntryId('lore-quest'),
      worldLoreEntryId('lore-keyword'),
    ]);
    expect(result.selections.map(({ matches }) => matches[0]?.kind)).toEqual([
      'ENTITY',
      'LOCATION',
      'QUEST',
      'KEYWORD',
    ]);
  });

  it('applies match mode, priority, entry budget and total budget deterministically', () => {
    const all = candidate(
      'lore-all',
      ['beacon'],
      [{ kind: 'NPC', id: 'npc-keeper' }],
      [],
      [],
      900,
      { matchMode: 'ALL' },
    );
    const tooLarge = candidate('lore-large', ['beacon'], [], [], [], 800, {
      tokenBudget: 1,
      text: 'A long entry that cannot fit its own declared budget.',
    });
    const selected = candidate('lore-selected', ['beacon'], [], [], [], 700);
    const deferred = candidate('lore-deferred', ['beacon'], [], [], [], 600);
    const first = retrieveWorldInfo(query('The beacon is lit.'), {
      campaignId: campaign,
      candidates: [deferred, tooLarge, all, selected],
    });
    expect(reason(first, 'lore-all')).toBe('NO_TRIGGER_MATCH');
    expect(reason(first, 'lore-large')).toBe('ENTRY_BUDGET');
    const selectedTokens = entry(first, 'lore-selected').estimatedTokens;
    const bounded = retrieveWorldInfo(
      { ...query('The beacon is lit.'), maxTokens: selectedTokens },
      { campaignId: campaign, candidates: [deferred, selected] },
    );
    expect(reason(bounded, 'lore-selected')).toBe('SELECTED');
    expect(reason(bounded, 'lore-deferred')).toBe('TOTAL_BUDGET');
  });

  it('fails closed for stale, disabled and unconfigured Lore', () => {
    const stale = { ...candidate('lore-stale', ['beacon'], [], [], [], 3), current: false };
    const disabled = candidate('lore-disabled', ['beacon'], [], [], [], 2, { enabled: false });
    const unconfigured = { ...candidate('lore-none', ['beacon'], [], [], [], 1), rule: null };
    const result = retrieveWorldInfo(query('beacon'), {
      campaignId: campaign,
      candidates: [stale, disabled, unconfigured],
    });
    expect(result.manifest.map(({ reason }) => reason)).toEqual([
      'STALE_SOURCE',
      'DISABLED',
      'NOT_CONFIGURED',
    ]);
  });
});

function query(text: string) {
  return {
    campaignId: campaign,
    text,
    entityRefs: [],
    locationIds: [],
    questIds: [],
    minimumScore: 0.2,
    maxTokens: 4_000,
  } as const;
}

function candidate(
  id: string,
  keywords: readonly string[],
  entityRefs: readonly { readonly kind: 'NPC'; readonly id: string }[],
  locationIds: readonly ReturnType<typeof locationId>[],
  questIds: readonly ReturnType<typeof questId>[],
  priority: number,
  overrides: Partial<{
    matchMode: 'ANY' | 'ALL';
    tokenBudget: number;
    enabled: boolean;
    text: string;
  }> = {},
): WorldInfoRetrievalCandidate {
  const loreId = worldLoreEntryId(id);
  return Object.freeze({
    lore: createWorldLoreEntry({
      id: loreId,
      campaignId: campaign,
      title: id,
      text: overrides.text ?? `Lore text for ${id}.`,
      sources: [
        {
          kind: 'WORLD_FACT',
          id: 'fact-source',
          revision: 1,
          contentHash: 'a'.repeat(64),
          occurredAt: at,
        },
      ],
      sourceDigest: 'b'.repeat(64),
      generationRecordId: null,
      revision: 1,
      createdAt: at,
      updatedAt: at,
    }),
    rule: createWorldLoreRetrievalRule({
      loreEntryId: loreId,
      campaignId: campaign,
      keywords,
      entityRefs,
      locationIds,
      questIds,
      alwaysActive: false,
      matchMode: overrides.matchMode ?? 'ANY',
      priority,
      tokenBudget: overrides.tokenBudget ?? 4_000,
      enabled: overrides.enabled ?? true,
      revision: 1,
      updatedAt: at,
    }),
    current: true,
  });
}

function entry(result: ReturnType<typeof retrieveWorldInfo>, id: string) {
  const found = result.manifest.find(({ loreEntryId }) => loreEntryId === id);
  if (found === undefined) throw new Error(`Missing manifest entry: ${id}`);
  return found;
}

function reason(result: ReturnType<typeof retrieveWorldInfo>, id: string) {
  return entry(result, id).reason;
}

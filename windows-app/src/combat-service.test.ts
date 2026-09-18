import { describe, expect, it } from 'vitest';

import { CURRENT_COMBAT_VERSION_SET } from '@ember-tavern/contracts';

import { parseCombatSessionSnapshot, parseCombatWorld } from './combat-service.js';

describe('combat service boundary', () => {
  it('accepts only the four explicit world identifiers', () => {
    expect(['CULTIVATION', 'FANTASY', 'SCI_FI', 'URBAN'].map(parseCombatWorld)).toEqual([
      'CULTIVATION',
      'FANTASY',
      'SCI_FI',
      'URBAN',
    ]);
    expect(parseCombatWorld('fantasy')).toBeNull();
    expect(parseCombatWorld(null)).toBeNull();
  });

  it('rejects mismatched or structurally incomplete native snapshots', () => {
    const valid = {
      campaignId: 'campaign-a',
      world: 'FANTASY',
      persistenceRevision: 1,
      viewModel: {
        combatInstanceId: 'combat-a',
        versions: CURRENT_COMBAT_VERSION_SET,
        stateRevision: 1,
        phaseLabelZhCn: '行动',
        roundLabelZhCn: '第 1 轮',
        activeCombatantId: null,
        timeline: [],
        combatants: [],
        enemyIntents: [],
        actions: [],
        reactionModes: [],
        pendingReaction: null,
        tacticalSettings: [],
        combatLog: [],
        result: null,
      },
    };
    expect(parseCombatSessionSnapshot(valid, 'campaign-a', 'FANTASY')).toEqual(valid);
    expect(() => parseCombatSessionSnapshot(valid, 'campaign-b', 'FANTASY')).toThrow(TypeError);
    expect(() =>
      parseCombatSessionSnapshot(
        { ...valid, viewModel: { stateRevision: 1 } },
        'campaign-a',
        'FANTASY',
      ),
    ).toThrow(TypeError);
  });
});

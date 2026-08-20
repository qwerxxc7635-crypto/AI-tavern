import { describe, expect, it } from 'vitest';

import {
  createSemanticEquipment,
  parseSemanticEquipment,
  projectSemanticEquipmentItem,
  semanticEquipmentStorageContent,
  type EquipmentCategory,
  type SemanticEquipmentDefinition,
} from './index.js';

describe('SemanticEquipment contract', () => {
  it.each(['WEAPON', 'ARMOR', 'TOOL', 'CONSUMABLE', 'CLUE', 'TREASURE', 'OTHER'] as const)(
    'round-trips the %s semantic and mechanical layers without conflating them',
    (category) => {
      const equipment = fixture(category);
      expect(parseSemanticEquipment(JSON.parse(JSON.stringify(equipment)))).toEqual(equipment);
      expect(projectSemanticEquipmentItem(equipment)).toMatchObject({
        content: { name: 'Stormglass Compass', description: 'Points toward broken beacons.' },
        rewardTier: 'NOTABLE',
        effect: { kind: 'CHECK_MODIFIER', modifier: 1 },
      });
      expect(semanticEquipmentStorageContent(equipment).semanticEquipment).toEqual(equipment);
    },
  );

  it('rejects malformed numbers, bindings, evidence and resource overflow', () => {
    expect(() => createSemanticEquipment({ ...fixture('TOOL'), mechanics: mechanics(99) })).toThrow(
      expect.objectContaining({ code: 'EQUIPMENT_STRUCTURE_INVALID', path: 'mechanics.damage' }),
    );
    expect(() =>
      createSemanticEquipment({
        ...fixture('TOOL'),
        bindings: [
          binding('QUEST', 'quest-beacon', 'QUEST_CONTEXT'),
          binding('QUEST', 'quest-beacon', 'QUEST_CONTEXT'),
        ],
      }),
    ).toThrow(expect.objectContaining({ code: 'EQUIPMENT_DUPLICATE' }));
    expect(() =>
      createSemanticEquipment({
        ...fixture('TOOL'),
        constitutionEvidence: { ...fixture('TOOL').constitutionEvidence, equipmentRules: '' },
      }),
    ).toThrow(expect.objectContaining({ path: 'constitutionEvidence.equipmentRules' }));
    expect(() =>
      createSemanticEquipment({
        ...fixture('TOOL'),
        content: {
          ...fixture('TOOL').content,
          semanticEffects: Array.from({ length: 17 }, (_, index) => `Effect ${index}`),
        },
      }),
    ).toThrow(expect.objectContaining({ path: 'content.semanticEffects' }));
  });
});

function fixture(category: EquipmentCategory): SemanticEquipmentDefinition {
  return createSemanticEquipment({
    schemaVersion: 1,
    id: 'item-stormglass-compass',
    campaignId: 'campaign-beacon',
    constitutionRevision: 1,
    content: {
      name: 'Stormglass Compass',
      description: 'Points toward broken beacons.',
      category,
      appearance: 'A brass compass with a stormglass needle.',
      history: 'Recovered after the lighthouse rescue.',
      origin: 'Made by the Lantern Guild.',
      narrativeAbilities: ['Recognizes old beacon marks'],
      semanticEffects: ['Draws attention from guild navigators'],
    },
    mechanics: mechanics(0),
    bindings: [
      binding('QUEST', 'quest-beacon', 'QUEST_CONTEXT'),
      binding('NPC', 'npc-ilyra', 'NPC_RECOGNITION'),
      binding('WORLD_FACT', 'fact-beacon', 'FACT_EVIDENCE'),
    ],
    constitutionEvidence: {
      equipmentRules: 'Equipment follows local craft.',
      technology: 'Late medieval',
      economy: 'Guild coin and barter',
    },
    source: { kind: 'QUEST_REWARD', questId: 'quest-beacon', adventureId: 'adventure-beacon' },
    generationRecordId: 'generation-equipment-beacon',
    createdAt: '2026-08-20T10:00:00.000Z',
  });
}

function mechanics(damage: number) {
  return {
    rarity: 'NOTABLE' as const,
    price: 200,
    damage,
    defense: 0,
    numericEffect: {
      kind: 'CHECK_MODIFIER' as const,
      attribute: 'knowledge' as const,
      modifier: 1,
    },
    balance: { policyVersion: 1 as const, budget: 4, cost: 2, rationale: ['Local policy'] },
  };
}

function binding(
  kind: 'QUEST' | 'NPC' | 'WORLD_FACT',
  targetId: string,
  trigger: 'QUEST_CONTEXT' | 'NPC_RECOGNITION' | 'FACT_EVIDENCE',
) {
  return { kind, targetId, trigger, summary: 'The item carries a persistent story hook.' } as const;
}

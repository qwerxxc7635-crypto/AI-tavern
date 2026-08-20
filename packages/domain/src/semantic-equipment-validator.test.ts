import {
  campaignId,
  isoTimestamp,
  npcId,
  questId,
  schemaVersion,
  type EquipmentCategory,
  type Quest,
  type QuestRisk,
  type RewardTier,
  type SemanticEquipmentCandidate,
  type WorldConstitution,
} from '@ember-tavern/contracts';
import { describe, expect, it } from 'vitest';

import {
  createEquipmentMechanics,
  createQuestRewardEquipment,
  resolveEquipmentTriggers,
  validateEquipmentMechanics,
} from './semantic-equipment-validator.js';

const campaign = campaignId('campaign-semantic-equipment');
const at = isoTimestamp('2026-08-20T10:00:00.000Z');

describe('Semantic equipment rules', () => {
  it.each([
    ['fantasy', 'WEAPON'],
    ['investigation', 'CLUE'],
    ['cyberpunk', 'TOOL'],
  ] as const)(
    'creates a Constitution-bound %s %s without reading numbers from prose',
    (world, category) => {
      const constitution = worldConstitution(world);
      const item = createQuestRewardEquipment({
        constitution,
        quest: quest('HIGH', 'RARE'),
        adventureId: 'adventure-equipment',
        candidate: candidate(constitution, category),
        generatedFactIds: ['fact-equipment'],
        existingEquipment: [],
        generationRecordId: 'generation-equipment',
        at,
      });
      expect(item.content.category).toBe(category);
      expect(item.constitutionEvidence.equipmentRules).toBe(constitution.equipmentRules);
      expect(item.mechanics.rarity).toBe('RARE');
      expect(item.mechanics.price).toBeGreaterThanOrEqual(0);
      expect(item.content.description).toContain('+99 damage');
      expect(item.mechanics.damage).toBe(category === 'WEAPON' ? 3 : 0);
    },
  );

  it.each([
    ['BASIC', 'LOW'],
    ['NOTABLE', 'MODERATE'],
    ['RARE', 'HIGH'],
    ['LEGENDARY', 'EXTREME'],
  ] as const)('keeps %s mechanics within the %s source ceiling', (rarity, risk) => {
    const constitution = worldConstitution('fantasy');
    const item = createQuestRewardEquipment({
      constitution,
      quest: quest(risk, rarity),
      adventureId: 'adventure-equipment',
      candidate: candidate(constitution, 'TOOL'),
      generatedFactIds: ['fact-equipment'],
      existingEquipment: [],
      generationRecordId: `generation-${rarity.toLowerCase()}`,
      at,
    });
    expect(validateEquipmentMechanics(item.mechanics)).toBe(item.mechanics);
    expect(item.mechanics.balance.cost).toBeLessThanOrEqual(item.mechanics.balance.budget);
  });

  it('rejects high-tier inflation, forged Constitution evidence and normalized duplicates', () => {
    const constitution = worldConstitution('fantasy');
    const input = {
      constitution,
      adventureId: 'adventure-equipment',
      candidate: candidate(constitution, 'TOOL'),
      generatedFactIds: ['fact-equipment'],
      existingEquipment: [],
      generationRecordId: 'generation-equipment',
      at,
    } as const;
    expect(() =>
      createQuestRewardEquipment({ ...input, quest: quest('LOW', 'LEGENDARY') }),
    ).toThrow(expect.objectContaining({ code: 'REWARD_INFLATION' }));
    expect(() =>
      createQuestRewardEquipment({
        ...input,
        quest: quest('HIGH', 'RARE'),
        candidate: {
          ...input.candidate,
          constitutionEvidence: { ...input.candidate.constitutionEvidence, technology: 'Orbital' },
        },
      }),
    ).toThrow(expect.objectContaining({ code: 'CONSTITUTION_MISMATCH' }));
    const existing = createQuestRewardEquipment({ ...input, quest: quest('HIGH', 'RARE') });
    expect(() =>
      createQuestRewardEquipment({
        ...input,
        quest: quest('HIGH', 'RARE'),
        candidate: { ...input.candidate, id: 'item-copy', name: 'Ｓｔｏｒｍ　Ｔｏｏｌ' },
        existingEquipment: [existing],
      }),
    ).toThrow(expect.objectContaining({ code: 'EQUIPMENT_DUPLICATE' }));
  });

  it('rejects unknown bindings and resolves Quest, NPC, Fact and relationship triggers explicitly', () => {
    const constitution = worldConstitution('investigation');
    const equipment = createQuestRewardEquipment({
      constitution,
      quest: quest('MODERATE', 'NOTABLE'),
      adventureId: 'adventure-equipment',
      candidate: candidate(constitution, 'CLUE'),
      generatedFactIds: ['fact-equipment'],
      existingEquipment: [],
      generationRecordId: 'generation-equipment',
      at,
    });
    expect(
      resolveEquipmentTriggers(equipment, { kind: 'QUEST_CONTEXT', targetId: 'quest-equipment' }),
    ).toHaveLength(1);
    expect(
      resolveEquipmentTriggers(equipment, { kind: 'NPC_RECOGNITION', targetId: 'npc-publisher' }),
    ).toHaveLength(1);
    expect(
      resolveEquipmentTriggers(equipment, { kind: 'FACT_EVIDENCE', targetId: 'fact-equipment' }),
    ).toHaveLength(1);
    expect(
      resolveEquipmentTriggers(equipment, { kind: 'RELATIONSHIP_HOOK', targetId: 'npc-related' }),
    ).toHaveLength(1);
    expect(() =>
      createQuestRewardEquipment({
        constitution,
        quest: quest('MODERATE', 'NOTABLE'),
        adventureId: 'adventure-equipment',
        candidate: {
          ...candidate(constitution, 'CLUE'),
          bindings: [
            binding('QUEST', 'quest-equipment', 'QUEST_CONTEXT'),
            binding('NPC', 'npc-stranger', 'NPC_RECOGNITION'),
          ],
        },
        generatedFactIds: ['fact-equipment'],
        existingEquipment: [],
        generationRecordId: 'generation-invalid-binding',
        at,
      }),
    ).toThrow(expect.objectContaining({ code: 'BINDING_INVALID' }));
  });

  it.each(['WEAPON', 'ARMOR', 'TOOL', 'CONSUMABLE', 'CLUE', 'TREASURE', 'OTHER'] as const)(
    'uses transparent local mechanics for %s',
    (category) => {
      const mechanics = createEquipmentMechanics(category, 'LEGENDARY', 'knowledge', ['grounded']);
      expect(mechanics.balance.cost).toBeLessThanOrEqual(10);
      expect(mechanics.damage).toBe(category === 'WEAPON' ? 4 : 0);
      expect(mechanics.defense).toBe(category === 'ARMOR' ? 4 : 0);
    },
  );
});

function worldConstitution(key: 'fantasy' | 'investigation' | 'cyberpunk'): WorldConstitution {
  const settings = {
    fantasy: ['Late medieval', 'Guild coin', 'Forged steel and bounded runes'],
    investigation: ['1920s industry', 'Wages and credit', 'Period tools and fragile evidence'],
    cyberpunk: ['Corporate cybernetics', 'Credits', 'Licensed implants and traceable power cells'],
  } as const;
  const [technology, economy, equipmentRules] = settings[key];
  return {
    campaignId: campaign,
    schemaVersion: schemaVersion(1),
    revision: 1,
    status: 'LOCKED',
    worldType: key,
    era: technology,
    technology,
    magic: 'Bounded',
    peoples: ['People'],
    society: 'Local institutions',
    politics: 'Competing councils',
    economy,
    combatScale: 'Personal',
    deathRules: 'Permanent',
    careerRules: 'Careers follow institutions',
    equipmentRules,
    npcRules: 'Knowledge is bounded',
    traitRules: 'Benefits require drawbacks',
    taboos: [],
    createdAt: at,
    updatedAt: at,
    lockedAt: at,
  };
}

function quest(risk: QuestRisk, rewardTier: RewardTier): Quest {
  return {
    id: questId('quest-equipment'),
    campaignId: campaign,
    publisherNpcId: npcId('npc-publisher'),
    content: {
      title: 'Recover the instrument',
      summary: 'Find a lost instrument.',
      objective: 'Return with proof.',
      failureCost: 'The route remains unsafe.',
    },
    status: 'COMPLETED',
    risk,
    recommendedAttributes: ['knowledge'],
    expectedTurns: { min: 8, max: 10 },
    rewardTier,
    relatedNpcIds: [npcId('npc-related')],
    relatedFactIds: [],
    createdAt: at,
    updatedAt: at,
  };
}

function candidate(
  constitution: WorldConstitution,
  category: EquipmentCategory,
): SemanticEquipmentCandidate {
  return {
    id: 'item-storm-tool',
    name: 'Storm Tool',
    description: 'A grounded object whose prose claims +99 damage but grants no such rule.',
    category,
    appearance: 'Built from materials appropriate to the world.',
    history: 'Recovered after a completed quest.',
    origin: 'Made by a named local institution.',
    narrativeAbilities: ['Can reveal its maker to an expert'],
    semanticEffects: ['May be recognized by the publisher'],
    balanceTags: ['grounded-source'],
    bindings: [
      binding('QUEST', 'quest-equipment', 'QUEST_CONTEXT'),
      binding('NPC', 'npc-publisher', 'NPC_RECOGNITION'),
      binding('NPC', 'npc-related', 'RELATIONSHIP_HOOK'),
      binding('WORLD_FACT', 'fact-equipment', 'FACT_EVIDENCE'),
    ],
    constitutionEvidence: {
      equipmentRules: constitution.equipmentRules,
      technology: constitution.technology,
      economy: constitution.economy,
    },
  };
}

function binding(
  kind: 'QUEST' | 'NPC' | 'WORLD_FACT',
  targetId: string,
  trigger: 'QUEST_CONTEXT' | 'NPC_RECOGNITION' | 'FACT_EVIDENCE' | 'RELATIONSHIP_HOOK',
) {
  return { kind, targetId, trigger, summary: 'Persistent semantic trigger.' } as const;
}

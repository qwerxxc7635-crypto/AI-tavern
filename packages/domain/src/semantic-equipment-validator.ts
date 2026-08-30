import {
  createSemanticEquipment,
  normalizeEquipmentName,
  type CharacterAttributeName,
  type EquipmentBinding,
  type EquipmentCategory,
  type EquipmentMechanics,
  type ItemEffect,
  type Quest,
  type QuestRisk,
  type RewardTier,
  type SemanticEquipmentCandidate,
  type SemanticEquipmentDefinition,
  type WorldConstitution,
} from '@ember-tavern/contracts';

const REWARD_RANK: Readonly<Record<RewardTier, number>> = {
  BASIC: 1,
  NOTABLE: 2,
  RARE: 3,
  LEGENDARY: 4,
};

const RISK_CEILING: Readonly<Record<QuestRisk, RewardTier>> = {
  LOW: 'BASIC',
  MODERATE: 'NOTABLE',
  HIGH: 'RARE',
  EXTREME: 'LEGENDARY',
};

const BALANCE_BUDGET: Readonly<Record<RewardTier, number>> = {
  BASIC: 2,
  NOTABLE: 4,
  RARE: 7,
  LEGENDARY: 10,
};

const BASE_PRICE: Readonly<Record<RewardTier, number>> = {
  BASIC: 25,
  NOTABLE: 100,
  RARE: 500,
  LEGENDARY: 2_500,
};

const CATEGORY_PRICE_FACTOR: Readonly<Record<EquipmentCategory, number>> = {
  WEAPON: 3,
  ARMOR: 4,
  TOOL: 2,
  CONSUMABLE: 1,
  CLUE: 0,
  TREASURE: 5,
  OTHER: 1,
};

export interface QuestRewardEquipmentInput {
  readonly constitution: WorldConstitution;
  readonly quest: Quest;
  readonly adventureId: string;
  readonly candidate: SemanticEquipmentCandidate;
  readonly generatedFactIds: readonly string[];
  readonly existingEquipment: readonly SemanticEquipmentDefinition[];
  readonly generationRecordId: string;
  readonly at: string;
}

export type EquipmentTriggerEvent =
  | Readonly<{ kind: 'QUEST_CONTEXT'; targetId: string }>
  | Readonly<{ kind: 'NPC_RECOGNITION'; targetId: string }>
  | Readonly<{ kind: 'FACT_EVIDENCE'; targetId: string }>
  | Readonly<{ kind: 'RELATIONSHIP_HOOK'; targetId: string }>;

export class SemanticEquipmentRuleError extends Error {
  public constructor(
    public readonly code:
      | 'CONSTITUTION_MISMATCH'
      | 'REWARD_INFLATION'
      | 'BINDING_INVALID'
      | 'EQUIPMENT_DUPLICATE'
      | 'BALANCE_INVALID',
    public readonly paths: readonly string[],
    options?: ErrorOptions,
  ) {
    super('Semantic equipment rule validation failed', options);
    this.name = 'SemanticEquipmentRuleError';
  }
}

export function createQuestRewardEquipment(
  input: QuestRewardEquipmentInput,
): SemanticEquipmentDefinition {
  if (
    input.constitution.status !== 'LOCKED' ||
    input.constitution.campaignId !== input.quest.campaignId
  ) {
    fail('CONSTITUTION_MISMATCH', ['campaignId']);
  }
  const maximum = RISK_CEILING[input.quest.risk];
  if (REWARD_RANK[input.quest.rewardTier] > REWARD_RANK[maximum]) {
    fail('REWARD_INFLATION', ['quest.rewardTier', 'quest.risk']);
  }
  const evidence = {
    equipmentRules: input.constitution.equipmentRules,
    technology: input.constitution.technology,
    economy: input.constitution.economy,
  };
  for (const key of ['equipmentRules', 'technology', 'economy'] as const) {
    if (input.candidate.constitutionEvidence[key] !== evidence[key]) {
      fail('CONSTITUTION_MISMATCH', [`candidate.constitutionEvidence.${key}`]);
    }
  }
  requireUniqueCandidate(input.candidate, input.existingEquipment);
  validateBindings(input.candidate.bindings, input.quest, input.generatedFactIds);
  const mechanics = createEquipmentMechanics(
    input.candidate.category,
    input.quest.rewardTier,
    input.quest.recommendedAttributes[0] ?? 'knowledge',
    input.candidate.balanceTags,
  );
  return createSemanticEquipment({
    schemaVersion: 1,
    id: input.candidate.id,
    campaignId: input.quest.campaignId,
    constitutionRevision: input.constitution.revision,
    content: {
      name: input.candidate.name,
      description: input.candidate.description,
      category: input.candidate.category,
      appearance: input.candidate.appearance,
      history: input.candidate.history,
      origin: input.candidate.origin,
      narrativeAbilities: input.candidate.narrativeAbilities,
      semanticEffects: input.candidate.semanticEffects,
    },
    mechanics,
    bindings: input.candidate.bindings,
    constitutionEvidence: evidence,
    source: {
      kind: 'QUEST_REWARD',
      questId: input.quest.id,
      adventureId: input.adventureId,
    },
    generationRecordId: input.generationRecordId,
    createdAt: input.at,
  });
}

export function createEquipmentMechanics(
  category: EquipmentCategory,
  rarity: RewardTier,
  primaryAttribute: CharacterAttributeName,
  balanceTags: readonly string[],
): EquipmentMechanics {
  if (balanceTags.length === 0 || new Set(balanceTags).size !== balanceTags.length) {
    fail('BALANCE_INVALID', ['balanceTags']);
  }
  const rank = REWARD_RANK[rarity];
  let damage = 0;
  let defense = 0;
  let numericEffect: ItemEffect = { kind: 'NONE' };
  let cost = 0;
  switch (category) {
    case 'WEAPON':
      damage = rank;
      cost = rank;
      break;
    case 'ARMOR':
      defense = rank;
      cost = rank;
      break;
    case 'TOOL': {
      const modifier = Math.min(2, Math.ceil(rank / 2));
      numericEffect = { kind: 'CHECK_MODIFIER', attribute: primaryAttribute, modifier };
      cost = modifier * 2;
      break;
    }
    case 'CONSUMABLE':
      numericEffect = {
        kind: 'CONSUMABLE_RECOVERY',
        resource: 'STRESS',
        amount: rank * 4,
        uses: 1,
      };
      cost = rank;
      break;
    case 'CLUE':
    case 'TREASURE':
    case 'OTHER':
      break;
  }
  const budget = BALANCE_BUDGET[rarity];
  if (cost > budget) fail('BALANCE_INVALID', ['mechanics.balance.cost']);
  return Object.freeze({
    rarity,
    price: BASE_PRICE[rarity] * CATEGORY_PRICE_FACTOR[category],
    damage,
    defense,
    numericEffect: Object.freeze(numericEffect),
    balance: Object.freeze({
      policyVersion: 1,
      budget,
      cost,
      rationale: Object.freeze([
        `rarity:${rarity}`,
        `category:${category}`,
        ...balanceTags.map((tag) => `semantic:${tag}`),
      ]),
    }),
  });
}

export function validateEquipmentMechanics(mechanics: EquipmentMechanics): EquipmentMechanics {
  const expectedBudget = BALANCE_BUDGET[mechanics.rarity];
  if (
    mechanics.balance.policyVersion !== 1 ||
    mechanics.balance.budget !== expectedBudget ||
    mechanics.balance.cost > expectedBudget ||
    mechanics.damage > REWARD_RANK[mechanics.rarity] ||
    mechanics.defense > REWARD_RANK[mechanics.rarity] ||
    mechanics.price < 0 ||
    !Number.isSafeInteger(mechanics.price)
  ) {
    fail('BALANCE_INVALID', ['mechanics']);
  }
  return mechanics;
}

export function resolveEquipmentTriggers(
  equipment: SemanticEquipmentDefinition,
  event: EquipmentTriggerEvent,
): readonly EquipmentBinding[] {
  return Object.freeze(
    equipment.bindings.filter(
      (binding) => binding.trigger === event.kind && binding.targetId === event.targetId,
    ),
  );
}

function validateBindings(
  bindings: readonly EquipmentBinding[],
  quest: Quest,
  factIds: readonly string[],
): void {
  const npcIds = new Set([quest.publisherNpcId, ...quest.relatedNpcIds]);
  const facts = new Set(factIds);
  let questBound = false;
  let npcBound = false;
  for (const [index, binding] of bindings.entries()) {
    const valid =
      (binding.kind === 'QUEST' &&
        binding.targetId === quest.id &&
        binding.trigger === 'QUEST_CONTEXT') ||
      (binding.kind === 'NPC' &&
        npcIds.has(binding.targetId as typeof quest.publisherNpcId) &&
        ['NPC_RECOGNITION', 'RELATIONSHIP_HOOK'].includes(binding.trigger)) ||
      (binding.kind === 'WORLD_FACT' &&
        facts.has(binding.targetId) &&
        binding.trigger === 'FACT_EVIDENCE');
    if (!valid) fail('BINDING_INVALID', [`candidate.bindings[${index}]`]);
    if (binding.kind === 'QUEST') questBound = true;
    if (binding.kind === 'NPC') npcBound = true;
  }
  if (!questBound || !npcBound) fail('BINDING_INVALID', ['candidate.bindings']);
}

function requireUniqueCandidate(
  candidate: SemanticEquipmentCandidate,
  existing: readonly SemanticEquipmentDefinition[],
): void {
  const name = normalizeEquipmentName(candidate.name);
  if (
    existing.some(
      (equipment) =>
        equipment.id === candidate.id || normalizeEquipmentName(equipment.content.name) === name,
    )
  ) {
    fail('EQUIPMENT_DUPLICATE', ['candidate.id', 'candidate.name']);
  }
}

function fail(code: SemanticEquipmentRuleError['code'], paths: readonly string[]): never {
  throw new SemanticEquipmentRuleError(code, Object.freeze([...paths]));
}

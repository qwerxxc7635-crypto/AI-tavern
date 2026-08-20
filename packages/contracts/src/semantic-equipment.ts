import type { CharacterAttributeName } from './character.js';
import {
  campaignId,
  generationRecordId,
  isoTimestamp,
  itemId,
  type CampaignId,
  type GenerationRecordId,
  type IsoTimestamp,
  type ItemId,
} from './foundation.js';
import type { Item, ItemEffect, RewardTier } from './quest.js';

export const EQUIPMENT_CATEGORIES = [
  'WEAPON',
  'ARMOR',
  'TOOL',
  'CONSUMABLE',
  'CLUE',
  'TREASURE',
  'OTHER',
] as const;
export type EquipmentCategory = (typeof EQUIPMENT_CATEGORIES)[number];

export const EQUIPMENT_BINDING_KINDS = ['QUEST', 'NPC', 'WORLD_FACT'] as const;
export type EquipmentBindingKind = (typeof EQUIPMENT_BINDING_KINDS)[number];

export const EQUIPMENT_TRIGGERS = [
  'QUEST_CONTEXT',
  'NPC_RECOGNITION',
  'FACT_EVIDENCE',
  'RELATIONSHIP_HOOK',
] as const;
export type EquipmentTrigger = (typeof EQUIPMENT_TRIGGERS)[number];

export interface EquipmentConstitutionEvidence {
  readonly equipmentRules: string;
  readonly technology: string;
  readonly economy: string;
}

export interface EquipmentBinding {
  readonly kind: EquipmentBindingKind;
  readonly targetId: string;
  readonly trigger: EquipmentTrigger;
  readonly summary: string;
}

export interface SemanticEquipmentContent {
  readonly name: string;
  readonly description: string;
  readonly category: EquipmentCategory;
  readonly appearance: string;
  readonly history: string;
  readonly origin: string;
  readonly narrativeAbilities: readonly string[];
  readonly semanticEffects: readonly string[];
}

export interface EquipmentBalanceRecord {
  readonly policyVersion: 1;
  readonly budget: number;
  readonly cost: number;
  readonly rationale: readonly string[];
}

export interface EquipmentMechanics {
  readonly rarity: RewardTier;
  readonly price: number;
  readonly damage: number;
  readonly defense: number;
  readonly numericEffect: ItemEffect;
  readonly balance: EquipmentBalanceRecord;
}

export interface SemanticEquipmentDefinition {
  readonly kind: 'SEMANTIC_EQUIPMENT';
  readonly schemaVersion: 1;
  readonly id: ItemId;
  readonly campaignId: CampaignId;
  readonly constitutionRevision: number;
  readonly content: SemanticEquipmentContent;
  readonly mechanics: EquipmentMechanics;
  readonly bindings: readonly EquipmentBinding[];
  readonly constitutionEvidence: EquipmentConstitutionEvidence;
  readonly source: {
    readonly kind: 'QUEST_REWARD';
    readonly questId: string;
    readonly adventureId: string;
  };
  readonly generationRecordId: GenerationRecordId;
  readonly createdAt: IsoTimestamp;
}

export interface SemanticEquipmentCandidate {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly category: EquipmentCategory;
  readonly appearance: string;
  readonly history: string;
  readonly origin: string;
  readonly narrativeAbilities: readonly string[];
  readonly semanticEffects: readonly string[];
  readonly balanceTags: readonly string[];
  readonly bindings: readonly EquipmentBinding[];
  readonly constitutionEvidence: EquipmentConstitutionEvidence;
}

export class SemanticEquipmentContractError extends Error {
  public constructor(
    public readonly code: 'EQUIPMENT_STRUCTURE_INVALID' | 'EQUIPMENT_DUPLICATE',
    public readonly path: string,
    options?: ErrorOptions,
  ) {
    super('Semantic equipment contract validation failed', options);
    this.name = 'SemanticEquipmentContractError';
  }
}

export function createSemanticEquipment(
  input: Omit<
    SemanticEquipmentDefinition,
    'kind' | 'id' | 'campaignId' | 'generationRecordId' | 'createdAt'
  > & {
    readonly id: string;
    readonly campaignId: string;
    readonly generationRecordId: string;
    readonly createdAt: string;
  },
): SemanticEquipmentDefinition {
  if (input.schemaVersion !== 1) invalid('schemaVersion');
  if (!Number.isSafeInteger(input.constitutionRevision) || input.constitutionRevision < 1) {
    invalid('constitutionRevision');
  }
  const content = freezeContent(input.content);
  const mechanics = freezeMechanics(input.mechanics);
  const bindings = freezeBindings(input.bindings);
  if (bindings.length === 0) invalid('bindings');
  if (input.source.kind !== 'QUEST_REWARD') invalid('source.kind');
  requireText(input.source.questId, 'source.questId', 200);
  requireText(input.source.adventureId, 'source.adventureId', 200);
  return Object.freeze({
    ...input,
    kind: 'SEMANTIC_EQUIPMENT',
    id: itemId(input.id),
    campaignId: campaignId(input.campaignId),
    content,
    mechanics,
    bindings,
    constitutionEvidence: freezeEvidence(input.constitutionEvidence),
    source: Object.freeze({ ...input.source }),
    generationRecordId: generationRecordId(input.generationRecordId),
    createdAt: isoTimestamp(input.createdAt),
  });
}

export function parseSemanticEquipment(value: unknown): SemanticEquipmentDefinition {
  try {
    if (!isRecord(value)) invalid('equipment');
    const row = value as Record<string, unknown>;
    requireExactKeys(
      row,
      [
        'kind',
        'schemaVersion',
        'id',
        'campaignId',
        'constitutionRevision',
        'content',
        'mechanics',
        'bindings',
        'constitutionEvidence',
        'source',
        'generationRecordId',
        'createdAt',
      ],
      'equipment',
    );
    if (row['kind'] !== 'SEMANTIC_EQUIPMENT') invalid('kind');
    return createSemanticEquipment({
      schemaVersion: row['schemaVersion'] as 1,
      id: row['id'] as string,
      campaignId: row['campaignId'] as string,
      constitutionRevision: row['constitutionRevision'] as number,
      content: row['content'] as SemanticEquipmentContent,
      mechanics: row['mechanics'] as EquipmentMechanics,
      bindings: row['bindings'] as readonly EquipmentBinding[],
      constitutionEvidence: row['constitutionEvidence'] as EquipmentConstitutionEvidence,
      source: row['source'] as SemanticEquipmentDefinition['source'],
      generationRecordId: row['generationRecordId'] as string,
      createdAt: row['createdAt'] as string,
    });
  } catch (error) {
    if (error instanceof SemanticEquipmentContractError) throw error;
    throw new SemanticEquipmentContractError('EQUIPMENT_STRUCTURE_INVALID', 'equipment', {
      cause: error,
    });
  }
}

export function projectSemanticEquipmentItem(equipment: SemanticEquipmentDefinition): Item {
  const canonical = createSemanticEquipment(equipment);
  return Object.freeze({
    id: canonical.id,
    campaignId: canonical.campaignId,
    content: Object.freeze({
      name: canonical.content.name,
      description: canonical.content.description,
    }),
    rewardTier: canonical.mechanics.rarity,
    effect: canonical.mechanics.numericEffect,
    createdAt: canonical.createdAt,
  });
}

export function semanticEquipmentStorageContent(
  equipment: SemanticEquipmentDefinition,
): Readonly<{ name: string; description: string; semanticEquipment: SemanticEquipmentDefinition }> {
  const canonical = createSemanticEquipment(equipment);
  return Object.freeze({
    name: canonical.content.name,
    description: canonical.content.description,
    semanticEquipment: canonical,
  });
}

export function normalizeEquipmentName(value: string): string {
  return [...value]
    .map((character) => {
      const codePoint = character.codePointAt(0);
      if (codePoint === 0x3000) return ' ';
      if (codePoint !== undefined && codePoint >= 0xff01 && codePoint <= 0xff5e) {
        return String.fromCodePoint(codePoint - 0xfee0);
      }
      return character;
    })
    .join('')
    .trim()
    .replace(/\s+/gu, ' ')
    .toLowerCase();
}

function freezeContent(value: SemanticEquipmentContent): SemanticEquipmentContent {
  if (!isRecord(value) || !EQUIPMENT_CATEGORIES.includes(value.category)) invalid('content');
  return Object.freeze({
    name: requireText(value.name, 'content.name', 120),
    description: requireText(value.description, 'content.description', 4_000),
    category: value.category,
    appearance: requireText(value.appearance, 'content.appearance', 4_000),
    history: requireText(value.history, 'content.history', 4_000),
    origin: requireText(value.origin, 'content.origin', 4_000),
    narrativeAbilities: freezeList(value.narrativeAbilities, 'content.narrativeAbilities', 16),
    semanticEffects: freezeList(value.semanticEffects, 'content.semanticEffects', 16),
  });
}

function freezeMechanics(value: EquipmentMechanics): EquipmentMechanics {
  if (!isRecord(value) || !['BASIC', 'NOTABLE', 'RARE', 'LEGENDARY'].includes(value.rarity)) {
    invalid('mechanics');
  }
  for (const [path, amount, maximum] of [
    ['price', value.price, 1_000_000],
    ['damage', value.damage, 10],
    ['defense', value.defense, 10],
  ] as const) {
    if (!Number.isSafeInteger(amount) || amount < 0 || amount > maximum) {
      invalid(`mechanics.${path}`);
    }
  }
  const balance = value.balance;
  if (
    !isRecord(balance) ||
    balance.policyVersion !== 1 ||
    !Number.isSafeInteger(balance.budget) ||
    !Number.isSafeInteger(balance.cost) ||
    balance.budget < 0 ||
    balance.cost < 0 ||
    balance.cost > balance.budget
  ) {
    invalid('mechanics.balance');
  }
  return Object.freeze({
    ...value,
    numericEffect: freezeNumericEffect(value.numericEffect),
    balance: Object.freeze({
      ...balance,
      rationale: freezeList(balance.rationale, 'mechanics.balance.rationale', 16),
    }),
  });
}

function freezeNumericEffect(effect: ItemEffect): ItemEffect {
  switch (effect.kind) {
    case 'NONE':
      return Object.freeze({ kind: 'NONE' });
    case 'CHECK_MODIFIER':
      if (
        !(
          ['physique', 'agility', 'knowledge', 'charisma'] as readonly CharacterAttributeName[]
        ).includes(effect.attribute) ||
        !Number.isSafeInteger(effect.modifier) ||
        effect.modifier === 0 ||
        effect.modifier < -5 ||
        effect.modifier > 5
      ) {
        invalid('mechanics.numericEffect');
      }
      return Object.freeze({ ...effect });
    case 'REROLL':
      if (!Number.isSafeInteger(effect.uses) || effect.uses < 1 || effect.uses > 3) {
        invalid('mechanics.numericEffect');
      }
      return Object.freeze({ ...effect });
    case 'CONSUMABLE_RECOVERY':
      if (
        !['INJURY', 'STRESS'].includes(effect.resource) ||
        !Number.isSafeInteger(effect.amount) ||
        effect.amount < 1 ||
        effect.amount > 20 ||
        !Number.isSafeInteger(effect.uses) ||
        effect.uses < 1 ||
        effect.uses > 10
      ) {
        invalid('mechanics.numericEffect');
      }
      return Object.freeze({ ...effect });
  }
}

function freezeBindings(values: readonly EquipmentBinding[]): readonly EquipmentBinding[] {
  if (!Array.isArray(values) || values.length > 16) invalid('bindings');
  const keys = new Set<string>();
  return Object.freeze(
    values.map((binding, index) => {
      const record: unknown = binding;
      if (
        !isRecord(record) ||
        typeof record['kind'] !== 'string' ||
        !EQUIPMENT_BINDING_KINDS.includes(record['kind'] as EquipmentBindingKind) ||
        typeof record['trigger'] !== 'string' ||
        !EQUIPMENT_TRIGGERS.includes(record['trigger'] as EquipmentTrigger)
      ) {
        invalid(`bindings[${index}]`);
      }
      const kind = record['kind'] as EquipmentBindingKind;
      const trigger = record['trigger'] as EquipmentTrigger;
      const targetId = requireText(
        record['targetId'] as string,
        `bindings[${index}].targetId`,
        200,
      );
      const key = `${kind}:${targetId}:${trigger}`;
      if (keys.has(key)) duplicate(`bindings[${index}]`);
      keys.add(key);
      return Object.freeze({
        kind,
        targetId,
        trigger,
        summary: requireText(record['summary'] as string, `bindings[${index}].summary`, 500),
      });
    }),
  );
}

function freezeEvidence(value: EquipmentConstitutionEvidence): EquipmentConstitutionEvidence {
  if (!isRecord(value)) invalid('constitutionEvidence');
  return Object.freeze({
    equipmentRules: requireText(value.equipmentRules, 'constitutionEvidence.equipmentRules', 4_000),
    technology: requireText(value.technology, 'constitutionEvidence.technology', 4_000),
    economy: requireText(value.economy, 'constitutionEvidence.economy', 4_000),
  });
}

function freezeList(values: readonly string[], path: string, maximum: number): readonly string[] {
  if (!Array.isArray(values) || values.length === 0 || values.length > maximum) invalid(path);
  const result = values.map((value, index) => requireText(value, `${path}[${index}]`, 500));
  if (new Set(result.map(normalizeEquipmentName)).size !== result.length) duplicate(path);
  return Object.freeze(result);
}

function requireText(value: string, path: string, maximum: number): string {
  if (
    typeof value !== 'string' ||
    value.trim() !== value ||
    value.length === 0 ||
    [...value].length > maximum
  ) {
    invalid(path);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  path: string,
): void {
  const actual = Object.keys(value).sort();
  const canonical = [...expected].sort();
  if (actual.length !== canonical.length || actual.some((key, index) => key !== canonical[index])) {
    invalid(path);
  }
}

function invalid(path: string): never {
  throw new SemanticEquipmentContractError('EQUIPMENT_STRUCTURE_INVALID', path);
}

function duplicate(path: string): never {
  throw new SemanticEquipmentContractError('EQUIPMENT_DUPLICATE', path);
}

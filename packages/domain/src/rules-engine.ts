import {
  CHARACTER_ATTRIBUTE_NAMES,
  QUEST_STATUSES,
  RULE_COMMAND_AUTHORITIES,
  RULE_STATUS_KINDS,
  createPlayerAttributes,
  schemaVersion,
  type CharacterAttributeName,
  type CharacterRuleState,
  type CheckDifficulty,
  type CheckRequestId,
  type IsoTimestamp,
  type Item,
  type ItemId,
  type PlayerAttributes,
  type Quest,
  type QuestStatus,
  type RuleResource,
  type RuleSkill,
  type RuleStatus,
  type RulesCommand,
  type TraitModifierTarget,
  type TraitRuleModifier,
} from '@ember-tavern/contracts';
import { resolveD20Check, type D20RandomSource } from './d20.js';

const MAX_SKILLS = 64;
const MAX_STATUSES = 32;
const MAX_EQUIPPED_ITEMS = 16;
const MAX_TRAIT_MODIFIERS = 32;
const MAX_RESOURCES = 32;
const MAX_HIT_POINTS = 999;
const MAX_MONEY = 1_000_000_000;
const MAX_GAME_MINUTES = 9_007_199_254_740_000;
const MAX_RULE_VALUE = 999_999;
const KEY_PATTERN = /^[a-z][a-z0-9_.-]{0,63}$/;

export const RULE_QUEST_TRANSITIONS: Readonly<Record<QuestStatus, readonly QuestStatus[]>> = {
  HIDDEN: ['DISCOVERED', 'AVAILABLE', 'ACTIVE', 'FAILED', 'EXPIRED'],
  DISCOVERED: ['AVAILABLE', 'ACTIVE', 'BLOCKED', 'UPDATED', 'FAILED', 'EXPIRED', 'ABANDONED'],
  AVAILABLE: ['ACCEPTED', 'ACTIVE', 'BLOCKED', 'UPDATED', 'FAILED', 'EXPIRED', 'ABANDONED'],
  ACCEPTED: ['ACTIVE', 'BLOCKED', 'UPDATED', 'FAILED', 'EXPIRED', 'ABANDONED'],
  ACTIVE: ['BLOCKED', 'UPDATED', 'COMPLETED', 'FAILED', 'EXPIRED', 'ABANDONED'],
  BLOCKED: ['AVAILABLE', 'ACTIVE', 'UPDATED', 'FAILED', 'EXPIRED', 'ABANDONED'],
  UPDATED: [
    'DISCOVERED',
    'AVAILABLE',
    'ACCEPTED',
    'ACTIVE',
    'BLOCKED',
    'COMPLETED',
    'FAILED',
    'EXPIRED',
    'ABANDONED',
  ],
  COMPLETED: [],
  FAILED: [],
  EXPIRED: [],
  ABANDONED: [],
};

export type RulesErrorCode =
  | 'INVALID_STATE'
  | 'INVALID_COMMAND'
  | 'AUTHORITY_FORBIDDEN'
  | 'CAMPAIGN_MISMATCH'
  | 'UNKNOWN_TARGET'
  | 'LIMIT_EXCEEDED'
  | 'ILLEGAL_QUEST_TRANSITION'
  | 'ITEM_NOT_OWNED'
  | 'NO_STATE_CHANGE';

export class RulesEngineError extends Error {
  public constructor(
    public readonly code: RulesErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'RulesEngineError';
  }
}

export interface CreateCharacterRuleStateInput {
  readonly campaignId: CharacterRuleState['campaignId'];
  readonly playerCharacterId: CharacterRuleState['playerCharacterId'];
  readonly baseAttributes: PlayerAttributes;
  readonly hitPointMax?: number;
  readonly skills?: readonly RuleSkill[];
  readonly money?: number;
  readonly resources?: readonly RuleResource[];
  readonly updatedAt: IsoTimestamp;
}

export interface RulesEvaluationContext {
  readonly ownedItemIds: readonly ItemId[];
  readonly quests: readonly Quest[];
}

export interface RulesCommandResult {
  readonly state: CharacterRuleState;
  readonly questBefore: Quest | null;
  readonly questAfter: Quest | null;
}

export interface CheckModifierBreakdown {
  readonly attributeValue: number;
  readonly traitModifier: number;
  readonly statusModifier: number;
}

export interface CharacterD20CheckInput {
  readonly state: CharacterRuleState;
  readonly checkRequestId: CheckRequestId;
  readonly attribute: CharacterAttributeName;
  readonly difficulty: CheckDifficulty;
  readonly items: readonly Item[];
}

export function createCharacterRuleState(input: CreateCharacterRuleStateInput): CharacterRuleState {
  const max = input.hitPointMax ?? 10;
  integerInRange(max, 1, MAX_HIT_POINTS, 'hitPointMax', 'INVALID_STATE');
  const state: CharacterRuleState = {
    schemaVersion: schemaVersion(1),
    campaignId: input.campaignId,
    playerCharacterId: input.playerCharacterId,
    baseAttributes: createPlayerAttributes(input.baseAttributes),
    skills: input.skills ?? [],
    hitPoints: { current: max, max },
    statuses: [],
    equippedItemIds: [],
    money: input.money ?? 0,
    gameTimeMinutes: 0,
    traitModifiers: [],
    resources: input.resources ?? [],
    revision: 1,
    updatedAt: input.updatedAt,
  };
  return validateCharacterRuleState(state);
}

export function validateCharacterRuleState(state: CharacterRuleState): CharacterRuleState {
  if (state.schemaVersion !== 1)
    invalidState('Only CharacterRuleState schema version 1 is supported');
  let baseAttributes: PlayerAttributes;
  try {
    baseAttributes = createPlayerAttributes(state.baseAttributes);
  } catch (error) {
    throw new RulesEngineError('INVALID_STATE', 'Base character attributes are invalid', {
      cause: error,
    });
  }
  positiveInteger(state.revision, 'revision', 'INVALID_STATE');
  integerInRange(state.hitPoints.max, 1, MAX_HIT_POINTS, 'hitPoints.max', 'INVALID_STATE');
  integerInRange(
    state.hitPoints.current,
    0,
    state.hitPoints.max,
    'hitPoints.current',
    'INVALID_STATE',
  );
  integerInRange(state.money, 0, MAX_MONEY, 'money', 'INVALID_STATE');
  integerInRange(state.gameTimeMinutes, 0, MAX_GAME_MINUTES, 'gameTimeMinutes', 'INVALID_STATE');

  const skills = validateUnique(
    state.skills,
    MAX_SKILLS,
    'skills',
    ({ key }) => key,
    (skill) => {
      exactKeys(skill, ['key', 'value'], 'skill', 'INVALID_STATE');
      ruleKey(skill.key, 'skill key', 'INVALID_STATE');
      integerInRange(skill.value, 0, 20, `skill ${skill.key}`, 'INVALID_STATE');
      return Object.freeze({ ...skill });
    },
  );
  const statuses = validateUnique(
    state.statuses,
    MAX_STATUSES,
    'statuses',
    ({ id }) => id,
    validateStatus,
  );
  const equippedItemIds = validateUnique(
    state.equippedItemIds,
    MAX_EQUIPPED_ITEMS,
    'equipped items',
    (id) => id,
    (id) => id,
  );
  const traitModifiers = validateUnique(
    state.traitModifiers,
    MAX_TRAIT_MODIFIERS,
    'trait modifiers',
    (modifier) => `${modifier.traitId}:${targetKey(modifier.target)}`,
    validateTraitModifier,
  );
  const resources = validateUnique(
    state.resources,
    MAX_RESOURCES,
    'resources',
    ({ key }) => key,
    validateResource,
  );

  for (const resource of resources) {
    const effectiveMax = effectiveResourceMax(resource, traitModifiers);
    if (resource.current > effectiveMax) {
      invalidState(`resource ${resource.key} exceeds its trait-adjusted maximum`);
    }
  }
  for (const modifier of traitModifiers) {
    if (modifier.target.kind === 'SKILL') {
      const skill = skills.find(({ key }) => key === modifier.target.key);
      if (skill === undefined) invalidState(`Trait targets unknown skill: ${modifier.target.key}`);
    }
    if (
      modifier.target.kind === 'RESOURCE' &&
      !resources.some(({ key }) => key === modifier.target.key)
    ) {
      invalidState(`Trait targets unknown resource: ${modifier.target.key}`);
    }
  }
  for (const skill of skills) {
    integerInRange(
      skill.value + traitModifierTotal(traitModifiers, 'SKILL', skill.key),
      0,
      20,
      `trait-adjusted skill ${skill.key}`,
      'INVALID_STATE',
    );
  }

  return Object.freeze({
    ...state,
    baseAttributes,
    skills,
    hitPoints: Object.freeze({ ...state.hitPoints }),
    statuses,
    equippedItemIds,
    traitModifiers,
    resources,
  });
}

export function applyRulesCommand(
  current: CharacterRuleState,
  command: RulesCommand,
  context: RulesEvaluationContext,
  occurredAt: IsoTimestamp,
): RulesCommandResult {
  const state = validateCharacterRuleState(current);
  validateCommandEnvelope(state, command);
  let patch: Partial<CharacterRuleState> = {};
  let questBefore: Quest | null = null;
  let questAfter: Quest | null = null;

  switch (command.kind) {
    case 'TAKE_DAMAGE': {
      positiveInteger(command.amount, 'damage amount');
      const next = Math.max(0, state.hitPoints.current - command.amount);
      if (next === state.hitPoints.current) noChange('Damage did not change hit points');
      patch = { hitPoints: Object.freeze({ ...state.hitPoints, current: next }) };
      break;
    }
    case 'RECOVER_HP': {
      positiveInteger(command.amount, 'recovery amount');
      const next = Math.min(state.hitPoints.max, state.hitPoints.current + command.amount);
      if (next === state.hitPoints.current) noChange('Recovery did not change hit points');
      patch = { hitPoints: Object.freeze({ ...state.hitPoints, current: next }) };
      break;
    }
    case 'DEFINE_SKILL': {
      requireSystemAuthority(command.authority, command.kind);
      ruleKey(command.skill.key, 'skill key');
      integerInRange(command.skill.value, 0, 20, `skill ${command.skill.key}`);
      if (state.skills.some(({ key }) => key === command.skill.key)) {
        throw new RulesEngineError('INVALID_COMMAND', `Skill already exists: ${command.skill.key}`);
      }
      if (state.skills.length >= MAX_SKILLS) limit('Too many skills');
      patch = { skills: Object.freeze([...state.skills, Object.freeze({ ...command.skill })]) };
      break;
    }
    case 'CHANGE_SKILL': {
      ruleKey(command.skillKey, 'skill key');
      unitDelta(command.delta, 'skill delta');
      const skill = state.skills.find(({ key }) => key === command.skillKey);
      if (skill === undefined) unknown(`Unknown skill: ${command.skillKey}`);
      const index = state.skills.indexOf(skill);
      const value = skill.value + command.delta;
      integerInRange(value, 0, 20, `skill ${command.skillKey}`);
      patch = {
        skills: replaceAt(state.skills, index, Object.freeze({ ...skill, value })),
      };
      break;
    }
    case 'ADD_STATUS': {
      const status = validateStatus(command.status);
      if (
        status.expiresAtGameMinute !== null &&
        status.expiresAtGameMinute <= state.gameTimeMinutes
      ) {
        throw new RulesEngineError('INVALID_COMMAND', 'Cannot add an already expired status');
      }
      if (state.statuses.some(({ id }) => id === status.id)) {
        throw new RulesEngineError('INVALID_COMMAND', `Status already exists: ${status.id}`);
      }
      if (state.statuses.length >= MAX_STATUSES) limit('Too many active statuses');
      patch = { statuses: Object.freeze([...state.statuses, status]) };
      break;
    }
    case 'REMOVE_STATUS': {
      canonicalText(command.statusId, 'statusId');
      const statuses = state.statuses.filter(({ id }) => id !== command.statusId);
      if (statuses.length === state.statuses.length) unknown(`Unknown status: ${command.statusId}`);
      patch = { statuses: Object.freeze(statuses) };
      break;
    }
    case 'EQUIP_ITEM': {
      if (!context.ownedItemIds.includes(command.itemId)) {
        throw new RulesEngineError('ITEM_NOT_OWNED', `Item is not owned: ${command.itemId}`);
      }
      if (state.equippedItemIds.includes(command.itemId)) noChange('Item is already equipped');
      if (state.equippedItemIds.length >= MAX_EQUIPPED_ITEMS) limit('Too many equipped items');
      patch = { equippedItemIds: Object.freeze([...state.equippedItemIds, command.itemId]) };
      break;
    }
    case 'UNEQUIP_ITEM': {
      const equippedItemIds = state.equippedItemIds.filter((id) => id !== command.itemId);
      if (equippedItemIds.length === state.equippedItemIds.length) {
        unknown(`Item is not equipped: ${command.itemId}`);
      }
      patch = { equippedItemIds: Object.freeze(equippedItemIds) };
      break;
    }
    case 'CHANGE_MONEY': {
      boundedDelta(command.delta, 'money delta');
      const money = state.money + command.delta;
      integerInRange(money, 0, MAX_MONEY, 'money');
      patch = { money };
      break;
    }
    case 'ADVANCE_TIME': {
      integerInRange(command.minutes, 1, 10_080, 'time advance');
      const gameTimeMinutes = state.gameTimeMinutes + command.minutes;
      integerInRange(gameTimeMinutes, 0, MAX_GAME_MINUTES, 'game time');
      patch = {
        gameTimeMinutes,
        statuses: Object.freeze(
          state.statuses.filter(
            ({ expiresAtGameMinute }) =>
              expiresAtGameMinute === null || expiresAtGameMinute > gameTimeMinutes,
          ),
        ),
      };
      break;
    }
    case 'DEFINE_RESOURCE': {
      requireSystemAuthority(command.authority, command.kind);
      const resource = validateResource(command.resource);
      if (state.resources.some(({ key }) => key === resource.key)) {
        throw new RulesEngineError('INVALID_COMMAND', `Resource already exists: ${resource.key}`);
      }
      if (state.resources.length >= MAX_RESOURCES) limit('Too many resources');
      patch = { resources: Object.freeze([...state.resources, resource]) };
      break;
    }
    case 'CHANGE_RESOURCE': {
      ruleKey(command.resourceKey, 'resource key');
      boundedDelta(command.delta, 'resource delta');
      const resource = state.resources.find(({ key }) => key === command.resourceKey);
      if (resource === undefined) unknown(`Unknown resource: ${command.resourceKey}`);
      const index = state.resources.indexOf(resource);
      const currentValue = resource.current + command.delta;
      integerInRange(
        currentValue,
        0,
        effectiveResourceMax(resource, state.traitModifiers),
        `resource ${command.resourceKey}`,
      );
      patch = {
        resources: replaceAt(
          state.resources,
          index,
          Object.freeze({ ...resource, current: currentValue }),
        ),
      };
      break;
    }
    case 'SET_TRAIT_MODIFIER': {
      requireSystemAuthority(command.authority, command.kind);
      const modifier = validateTraitModifier({
        traitId: command.traitId,
        target: command.target,
        modifier: command.modifier,
      });
      const key = `${modifier.traitId}:${targetKey(modifier.target)}`;
      const index = state.traitModifiers.findIndex(
        (value) => `${value.traitId}:${targetKey(value.target)}` === key,
      );
      const traitModifiers =
        index < 0
          ? Object.freeze([...state.traitModifiers, modifier])
          : replaceAt(state.traitModifiers, index, modifier);
      if (index < 0 && traitModifiers.length > MAX_TRAIT_MODIFIERS)
        limit('Too many trait modifiers');
      patch = { traitModifiers };
      break;
    }
    case 'REMOVE_TRAIT_MODIFIER': {
      requireSystemAuthority(command.authority, command.kind);
      const traitModifiers = state.traitModifiers.filter(
        ({ traitId }) => traitId !== command.traitId,
      );
      if (traitModifiers.length === state.traitModifiers.length) {
        unknown(`Trait has no numeric modifier: ${command.traitId}`);
      }
      patch = { traitModifiers: Object.freeze(traitModifiers) };
      break;
    }
    case 'TRANSITION_QUEST': {
      const quest = context.quests.find(({ id }) => id === command.questId);
      if (quest === undefined || quest.campaignId !== state.campaignId) {
        unknown(`Unknown quest: ${command.questId}`);
      }
      if (!RULE_QUEST_TRANSITIONS[quest.status].includes(command.status)) {
        throw new RulesEngineError(
          'ILLEGAL_QUEST_TRANSITION',
          `Illegal quest transition: ${quest.status} -> ${command.status}`,
        );
      }
      questBefore = quest;
      questAfter = Object.freeze({ ...quest, status: command.status, updatedAt: occurredAt });
      break;
    }
  }

  const next = validateCharacterRuleState({
    ...state,
    ...patch,
    revision: state.revision + 1,
    updatedAt: occurredAt,
  });
  return Object.freeze({ state: next, questBefore, questAfter });
}

export function checkModifierBreakdown(
  state: CharacterRuleState,
  attribute: CharacterAttributeName,
): CheckModifierBreakdown {
  const validated = validateCharacterRuleState(state);
  if (!CHARACTER_ATTRIBUTE_NAMES.includes(attribute)) {
    throw new RulesEngineError('INVALID_COMMAND', `Unknown attribute: ${attribute}`);
  }
  return Object.freeze({
    attributeValue: validated.baseAttributes[attribute],
    traitModifier: validated.traitModifiers
      .filter(({ target }) => target.kind === 'ATTRIBUTE' && target.key === attribute)
      .reduce((sum, { modifier }) => sum + modifier, 0),
    statusModifier: validated.statuses.reduce(
      (sum, { attributeModifiers }) => sum + (attributeModifiers[attribute] ?? 0),
      0,
    ),
  });
}

export function effectiveSkillValue(state: CharacterRuleState, skillKey: string): number {
  const validated = validateCharacterRuleState(state);
  ruleKey(skillKey, 'skill key');
  const skill = validated.skills.find(({ key }) => key === skillKey);
  if (skill === undefined) unknown(`Unknown skill: ${skillKey}`);
  return skill.value + traitModifierTotal(validated.traitModifiers, 'SKILL', skillKey);
}

export function resolveCharacterD20Check(input: CharacterD20CheckInput, random: D20RandomSource) {
  const state = validateCharacterRuleState(input.state);
  const breakdown = checkModifierBreakdown(state, input.attribute);
  let equipmentModifier = 0;
  for (const equippedId of state.equippedItemIds) {
    const item = input.items.find(({ id }) => id === equippedId);
    if (item === undefined || item.campaignId !== state.campaignId) {
      throw new RulesEngineError('UNKNOWN_TARGET', `Equipped item is unavailable: ${equippedId}`);
    }
    if (item.effect.kind === 'CHECK_MODIFIER' && item.effect.attribute === input.attribute) {
      integerInRange(item.effect.modifier, -5, 5, 'equipment modifier', 'INVALID_STATE');
      equipmentModifier += item.effect.modifier;
    }
  }
  return resolveD20Check(
    {
      checkRequestId: input.checkRequestId,
      attributeValue: breakdown.attributeValue,
      equipmentModifier,
      statusModifier: breakdown.statusModifier + breakdown.traitModifier,
      difficulty: input.difficulty,
    },
    random,
  );
}

export function validateItemNumericEffect(effect: Item['effect']): Item['effect'] {
  switch (effect.kind) {
    case 'NONE':
      exactKeys(effect, ['kind'], 'item effect', 'INVALID_STATE');
      return Object.freeze({ kind: effect.kind });
    case 'CHECK_MODIFIER':
      exactKeys(effect, ['kind', 'attribute', 'modifier'], 'item effect', 'INVALID_STATE');
      if (!CHARACTER_ATTRIBUTE_NAMES.includes(effect.attribute)) {
        invalidState(`Unknown item effect attribute: ${effect.attribute}`);
      }
      integerInRange(effect.modifier, -5, 5, 'item check modifier', 'INVALID_STATE');
      if (effect.modifier === 0) invalidState('Item check modifier cannot be zero');
      return Object.freeze({ ...effect });
    case 'REROLL':
      exactKeys(effect, ['kind', 'uses'], 'item effect', 'INVALID_STATE');
      integerInRange(effect.uses, 1, 3, 'item reroll uses', 'INVALID_STATE');
      return Object.freeze({ ...effect });
    case 'CONSUMABLE_RECOVERY':
      exactKeys(effect, ['kind', 'resource', 'amount', 'uses'], 'item effect', 'INVALID_STATE');
      if (!['INJURY', 'STRESS'].includes(effect.resource)) {
        invalidState(`Unknown recovery resource: ${effect.resource}`);
      }
      integerInRange(effect.amount, 1, 20, 'item recovery amount', 'INVALID_STATE');
      integerInRange(effect.uses, 1, 10, 'item recovery uses', 'INVALID_STATE');
      return Object.freeze({ ...effect });
  }
}

function validateCommandEnvelope(state: CharacterRuleState, command: RulesCommand): void {
  if (!RULE_COMMAND_AUTHORITIES.includes(command.authority)) {
    throw new RulesEngineError('AUTHORITY_FORBIDDEN', 'AI proposals are not a Rules authority');
  }
  if (
    command.campaignId !== state.campaignId ||
    command.playerCharacterId !== state.playerCharacterId
  ) {
    throw new RulesEngineError('CAMPAIGN_MISMATCH', 'Rules command targets another aggregate');
  }
  const common = ['kind', 'campaignId', 'playerCharacterId', 'authority'] as const;
  const specific: Readonly<Record<RulesCommand['kind'], readonly string[]>> = {
    TAKE_DAMAGE: ['amount'],
    RECOVER_HP: ['amount'],
    DEFINE_SKILL: ['skill'],
    CHANGE_SKILL: ['skillKey', 'delta'],
    ADD_STATUS: ['status'],
    REMOVE_STATUS: ['statusId'],
    EQUIP_ITEM: ['itemId'],
    UNEQUIP_ITEM: ['itemId'],
    CHANGE_MONEY: ['delta'],
    ADVANCE_TIME: ['minutes'],
    DEFINE_RESOURCE: ['resource'],
    CHANGE_RESOURCE: ['resourceKey', 'delta'],
    SET_TRAIT_MODIFIER: ['traitId', 'target', 'modifier'],
    REMOVE_TRAIT_MODIFIER: ['traitId'],
    TRANSITION_QUEST: ['questId', 'status'],
  };
  const allowed = specific[command.kind];
  if (allowed === undefined) {
    throw new RulesEngineError('INVALID_COMMAND', `Unknown Rules command: ${String(command.kind)}`);
  }
  exactKeys(command, [...common, ...allowed], 'Rules command');
}

function validateStatus(value: RuleStatus): RuleStatus {
  exactKeys(
    value,
    ['id', 'kind', 'label', 'attributeModifiers', 'expiresAtGameMinute'],
    'status',
    'INVALID_STATE',
  );
  canonicalText(value.id, 'status.id', 'INVALID_STATE');
  canonicalText(value.label, 'status.label', 'INVALID_STATE');
  if (!RULE_STATUS_KINDS.includes(value.kind)) invalidState(`Unknown status kind: ${value.kind}`);
  if (value.expiresAtGameMinute !== null) {
    integerInRange(
      value.expiresAtGameMinute,
      1,
      MAX_GAME_MINUTES,
      'status expiry',
      'INVALID_STATE',
    );
  }
  const modifiers: Partial<Record<CharacterAttributeName, number>> = {};
  for (const [key, modifier] of Object.entries(value.attributeModifiers)) {
    if (!CHARACTER_ATTRIBUTE_NAMES.includes(key as CharacterAttributeName)) {
      invalidState(`Unknown status attribute: ${key}`);
    }
    integerInRange(modifier, -5, 5, `status modifier ${key}`, 'INVALID_STATE');
    if (modifier !== 0) modifiers[key as CharacterAttributeName] = modifier;
  }
  return Object.freeze({ ...value, attributeModifiers: Object.freeze(modifiers) });
}

function validateTraitModifier(value: TraitRuleModifier): TraitRuleModifier {
  exactKeys(value, ['traitId', 'target', 'modifier'], 'trait modifier', 'INVALID_STATE');
  validateTarget(value.target);
  integerInRange(value.modifier, -5, 5, 'trait modifier', 'INVALID_STATE');
  if (value.modifier === 0) invalidState('Trait modifier cannot be zero');
  return Object.freeze({ ...value, target: Object.freeze({ ...value.target }) });
}

function validateTarget(target: TraitModifierTarget): void {
  exactKeys(target, ['kind', 'key'], 'trait target', 'INVALID_STATE');
  switch (target.kind) {
    case 'ATTRIBUTE':
      if (!CHARACTER_ATTRIBUTE_NAMES.includes(target.key)) {
        invalidState(`Unknown trait attribute: ${target.key}`);
      }
      break;
    case 'SKILL':
    case 'RESOURCE':
      ruleKey(target.key, `${target.kind.toLowerCase()} key`, 'INVALID_STATE');
      break;
    default:
      invalidState('Unknown trait modifier target');
  }
}

function validateResource(value: RuleResource): RuleResource {
  exactKeys(value, ['key', 'current', 'max'], 'resource', 'INVALID_STATE');
  ruleKey(value.key, 'resource key', 'INVALID_STATE');
  integerInRange(value.max, 1, MAX_RULE_VALUE, `resource ${value.key}.max`, 'INVALID_STATE');
  integerInRange(value.current, 0, value.max, `resource ${value.key}.current`, 'INVALID_STATE');
  return Object.freeze({ ...value });
}

function effectiveResourceMax(
  resource: RuleResource,
  modifiers: readonly TraitRuleModifier[],
): number {
  return Math.max(
    0,
    resource.max +
      modifiers
        .filter(({ target }) => target.kind === 'RESOURCE' && target.key === resource.key)
        .reduce((sum, { modifier }) => sum + modifier, 0),
  );
}

function traitModifierTotal(
  modifiers: readonly TraitRuleModifier[],
  kind: TraitModifierTarget['kind'],
  key: string,
): number {
  return modifiers
    .filter(({ target }) => target.kind === kind && target.key === key)
    .reduce((sum, { modifier }) => sum + modifier, 0);
}

function targetKey(target: TraitModifierTarget): string {
  return `${target.kind}:${target.key}`;
}

function validateUnique<T, U>(
  values: readonly T[],
  max: number,
  label: string,
  key: (value: T) => string,
  validate: (value: T) => U,
): readonly U[] {
  if (!Array.isArray(values) || values.length > max) invalidState(`${label} exceed limit ${max}`);
  const keys = new Set<string>();
  return Object.freeze(
    values.map((value) => {
      const id = key(value);
      if (keys.has(id)) invalidState(`${label} contain duplicate ${id}`);
      keys.add(id);
      return validate(value);
    }),
  );
}

function replaceAt<T>(values: readonly T[], index: number, value: T): readonly T[] {
  const result = [...values];
  result[index] = value;
  return Object.freeze(result);
}

function requireSystemAuthority(authority: string, kind: string): void {
  if (authority === 'PLAYER_ACTION') {
    throw new RulesEngineError(
      'AUTHORITY_FORBIDDEN',
      `${kind} requires LOCAL_RULE or SYSTEM authority`,
    );
  }
}

function ruleKey(value: string, label: string, code: RulesErrorCode = 'INVALID_COMMAND'): void {
  if (!KEY_PATTERN.test(value)) throw new RulesEngineError(code, `${label} is not canonical`);
}

function canonicalText(
  value: string,
  label: string,
  code: RulesErrorCode = 'INVALID_COMMAND',
): void {
  if (value.length === 0 || value.trim() !== value || value.length > 128) {
    throw new RulesEngineError(code, `${label} must be canonical text up to 128 characters`);
  }
}

function exactKeys(
  value: object,
  allowed: readonly string[],
  label: string,
  code: RulesErrorCode = 'INVALID_COMMAND',
): void {
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new RulesEngineError(code, `${label} must be a plain object`);
  }
  const keys = Object.keys(value);
  const extra = keys.find((key) => !allowed.includes(key));
  const missing = allowed.find((key) => !Object.hasOwn(value, key));
  if (extra !== undefined || missing !== undefined) {
    throw new RulesEngineError(
      code,
      `${label} has invalid fields${extra === undefined ? '' : `: ${extra}`}`,
    );
  }
}

function positiveInteger(
  value: number,
  label: string,
  code: RulesErrorCode = 'INVALID_COMMAND',
): void {
  integerInRange(value, 1, MAX_RULE_VALUE, label, code);
}

function unitDelta(value: number, label: string): void {
  if (value !== -1 && value !== 1) {
    throw new RulesEngineError('LIMIT_EXCEEDED', `${label} must be -1 or 1`);
  }
}

function boundedDelta(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value === 0 || Math.abs(value) > MAX_RULE_VALUE) {
    throw new RulesEngineError(
      'LIMIT_EXCEEDED',
      `${label} must be a non-zero safe integer within rule limits`,
    );
  }
}

function integerInRange(
  value: number,
  min: number,
  max: number,
  label: string,
  code: RulesErrorCode = 'LIMIT_EXCEEDED',
): void {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new RulesEngineError(code, `${label} must be a safe integer from ${min} to ${max}`);
  }
}

function invalidState(message: string): never {
  throw new RulesEngineError('INVALID_STATE', message);
}

function unknown(message: string): never {
  throw new RulesEngineError('UNKNOWN_TARGET', message);
}

function limit(message: string): never {
  throw new RulesEngineError('LIMIT_EXCEEDED', message);
}

function noChange(message: string): never {
  throw new RulesEngineError('NO_STATE_CHANGE', message);
}

if (QUEST_STATUSES.some((status) => !Object.hasOwn(RULE_QUEST_TRANSITIONS, status))) {
  throw new Error('RULE_QUEST_TRANSITIONS must cover every QuestStatus');
}

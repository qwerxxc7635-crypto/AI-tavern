import type { CheckDifficulty, CheckRequestId, DiceResult } from '@ember-tavern/contracts';

export interface D20RandomSource {
  nextD20(): number;
}

export interface D20CheckInput {
  readonly checkRequestId: CheckRequestId;
  readonly attributeValue: number;
  readonly equipmentModifier: number;
  readonly statusModifier: number;
  readonly difficulty: CheckDifficulty;
}

export class D20RuleError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'D20RuleError';
  }
}

const DIFFICULTIES: readonly CheckDifficulty[] = [8, 11, 14, 17];

export function resolveD20Check(input: D20CheckInput, random: D20RandomSource): DiceResult {
  assertIntegerInRange(input.attributeValue, 1, 5, 'attributeValue');
  assertSafeInteger(input.equipmentModifier, 'equipmentModifier');
  assertSafeInteger(input.statusModifier, 'statusModifier');
  if (!DIFFICULTIES.includes(input.difficulty)) {
    throw new D20RuleError('difficulty must be one of 8, 11, 14 or 17');
  }

  const d20 = random.nextD20();
  assertIntegerInRange(d20, 1, 20, 'd20');

  const modifier = input.attributeValue + input.equipmentModifier + input.statusModifier;
  if (!Number.isSafeInteger(modifier)) {
    throw new D20RuleError('check modifier must be a safe integer');
  }
  const total = d20 + modifier;
  if (!Number.isSafeInteger(total)) {
    throw new D20RuleError('check total must be a safe integer');
  }

  return Object.freeze({
    checkRequestId: input.checkRequestId,
    raw: d20,
    modifier,
    dc: input.difficulty,
    result: total >= input.difficulty ? 'SUCCESS' : 'FAILURE',
    d20,
    attributeModifier: input.attributeValue,
    equipmentModifier: input.equipmentModifier,
    statusModifier: input.statusModifier,
    total,
    difficulty: input.difficulty,
    success: total >= input.difficulty,
  });
}

function assertIntegerInRange(value: number, min: number, max: number, label: string): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new D20RuleError(`${label} must be an integer from ${min} to ${max}`);
  }
}

function assertSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new D20RuleError(`${label} must be a safe integer`);
  }
}

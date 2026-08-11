import { checkRequestId, type CheckDifficulty, type DiceResult } from '@ember-tavern/contracts';

import { PersistenceDataError } from './campaign-repository.js';
import {
  requireBoolean,
  requireNumber,
  requireRecord,
  requireString,
} from './persistence-validation.js';

const DIFFICULTIES = [8, 11, 14, 17] as const;

export function parseStoredDiceResult(value: unknown, label = 'DiceResult'): DiceResult {
  const row = requireRecord(value, label);
  const legacyRaw = optionalNumber(row['d20'], `${label}.d20`);
  const raw = optionalNumber(row['raw'], `${label}.raw`) ?? legacyRaw;
  if (raw === undefined || (legacyRaw !== undefined && legacyRaw !== raw)) {
    throw new PersistenceDataError(`${label} raw roll is missing or inconsistent`);
  }
  const attributeModifier = requireNumber(row['attributeModifier'], `${label}.attributeModifier`);
  const equipmentModifier = requireNumber(row['equipmentModifier'], `${label}.equipmentModifier`);
  const statusModifier = requireNumber(row['statusModifier'], `${label}.statusModifier`);
  const computedModifier = attributeModifier + equipmentModifier + statusModifier;
  const modifier = optionalNumber(row['modifier'], `${label}.modifier`) ?? computedModifier;
  const total = requireNumber(row['total'], `${label}.total`);
  const legacyDifficulty = optionalDifficulty(row['difficulty'], `${label}.difficulty`);
  const dc = optionalDifficulty(row['dc'], `${label}.dc`) ?? legacyDifficulty;
  if (dc === undefined || (legacyDifficulty !== undefined && legacyDifficulty !== dc)) {
    throw new PersistenceDataError(`${label} DC is missing or inconsistent`);
  }
  const legacySuccess = optionalBoolean(row['success'], `${label}.success`);
  const result =
    optionalResult(row['result'], `${label}.result`) ??
    (legacySuccess === undefined ? undefined : legacySuccess ? 'SUCCESS' : 'FAILURE');
  if (
    result === undefined ||
    (legacySuccess !== undefined && legacySuccess !== (result === 'SUCCESS'))
  ) {
    throw new PersistenceDataError(`${label} result is missing or inconsistent`);
  }
  if (
    !Number.isInteger(raw) ||
    raw < 1 ||
    raw > 20 ||
    !Number.isInteger(attributeModifier) ||
    attributeModifier < 1 ||
    attributeModifier > 5 ||
    !Number.isSafeInteger(equipmentModifier) ||
    !Number.isSafeInteger(statusModifier) ||
    !Number.isSafeInteger(modifier) ||
    modifier !== computedModifier ||
    !Number.isSafeInteger(total) ||
    total !== raw + modifier ||
    (result === 'SUCCESS') !== total >= dc
  ) {
    throw new PersistenceDataError(`${label} violates the D20 hard-logic invariant`);
  }
  return Object.freeze({
    checkRequestId: checkRequestId(requireString(row['checkRequestId'], `${label}.checkRequestId`)),
    raw,
    modifier,
    total,
    dc,
    result,
    d20: raw,
    attributeModifier,
    equipmentModifier,
    statusModifier,
    difficulty: dc,
    success: result === 'SUCCESS',
  });
}

function optionalNumber(value: unknown, label: string): number | undefined {
  return value === undefined ? undefined : requireNumber(value, label);
}

function optionalBoolean(value: unknown, label: string): boolean | undefined {
  return value === undefined ? undefined : requireBoolean(value, label);
}

function optionalDifficulty(value: unknown, label: string): CheckDifficulty | undefined {
  if (value === undefined) return undefined;
  const difficulty = requireNumber(value, label);
  if (!DIFFICULTIES.includes(difficulty as CheckDifficulty)) {
    throw new PersistenceDataError(`${label} must be 8, 11, 14 or 17`);
  }
  return difficulty as CheckDifficulty;
}

function optionalResult(value: unknown, label: string): 'SUCCESS' | 'FAILURE' | undefined {
  if (value === undefined) return undefined;
  if (value === 'SUCCESS' || value === 'FAILURE') return value;
  throw new PersistenceDataError(`${label} must be SUCCESS or FAILURE`);
}

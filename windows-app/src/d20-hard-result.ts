export interface D20HardResultView {
  readonly raw: number;
  readonly modifier: number;
  readonly total: number;
  readonly dc: 8 | 11 | 14 | 17;
  readonly result: 'SUCCESS' | 'FAILURE';
  readonly attributeModifier: number;
  readonly equipmentModifier: number;
  readonly statusModifier: number;
}

const DIFFICULTIES = [8, 11, 14, 17] as const;

export function parseD20HardResult(value: unknown): D20HardResultView {
  const row = record(value);
  const raw = consistentInteger(row, ['raw', 'naturalRoll', 'd20']);
  const attributeModifier = consistentInteger(row, ['attributeModifier', 'attributeValue']);
  const equipmentModifier = integer(row['equipmentModifier']);
  const statusModifier = integer(row['statusModifier']);
  const computedModifier = attributeModifier + equipmentModifier + statusModifier;
  const modifier = row['modifier'] === undefined ? computedModifier : integer(row['modifier']);
  const total = integer(row['total']);
  const dcValue = consistentInteger(row, ['dc', 'difficulty']);
  if (!DIFFICULTIES.includes(dcValue as (typeof DIFFICULTIES)[number])) {
    throw new TypeError('D20 DC is outside the closed ruleset');
  }
  const dc = dcValue as D20HardResultView['dc'];
  const legacySuccess = row['success'] === undefined ? undefined : boolean(row['success']);
  const result =
    row['result'] === undefined
      ? legacySuccess === undefined
        ? undefined
        : legacySuccess
          ? 'SUCCESS'
          : 'FAILURE'
      : resultValue(row['result']);
  if (
    result === undefined ||
    (legacySuccess !== undefined && legacySuccess !== (result === 'SUCCESS')) ||
    raw < 1 ||
    raw > 20 ||
    attributeModifier < 1 ||
    attributeModifier > 5 ||
    !Number.isSafeInteger(computedModifier) ||
    modifier !== computedModifier ||
    !Number.isSafeInteger(total) ||
    total !== raw + modifier ||
    (result === 'SUCCESS') !== total >= dc
  ) {
    throw new TypeError('D20 hard-logic invariant failed');
  }
  return Object.freeze({
    raw,
    modifier,
    total,
    dc,
    result,
    attributeModifier,
    equipmentModifier,
    statusModifier,
  });
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('D20 result must be an object');
  }
  return value as Record<string, unknown>;
}

function integer(value: unknown): number {
  if (!Number.isSafeInteger(value)) throw new TypeError('D20 field must be a safe integer');
  return value as number;
}

function boolean(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new TypeError('D20 result flag must be boolean');
  return value;
}

function resultValue(value: unknown): 'SUCCESS' | 'FAILURE' {
  if (value === 'SUCCESS' || value === 'FAILURE') return value;
  throw new TypeError('D20 result must be SUCCESS or FAILURE');
}

function consistentInteger(row: Record<string, unknown>, fields: readonly string[]): number {
  const values = fields
    .filter((field) => row[field] !== undefined)
    .map((field) => integer(row[field]));
  const first = values[0];
  if (first === undefined || values.some((value) => value !== first)) {
    throw new TypeError('D20 aliases are missing or inconsistent');
  }
  return first;
}

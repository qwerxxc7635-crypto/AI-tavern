export const COMBAT_VERSION_FIELDS = [
  'combatSchemaVersion',
  'rulesetVersion',
  'balanceVersion',
  'engineVersion',
  'worldProfileVersion',
  'attributeMappingVersion',
  'rngContractVersion',
] as const;

export type CombatVersionField = (typeof COMBAT_VERSION_FIELDS)[number];

export interface CombatVersionSet {
  readonly combatSchemaVersion: number;
  readonly rulesetVersion: number;
  readonly balanceVersion: number;
  readonly engineVersion: number;
  readonly worldProfileVersion: number;
  readonly attributeMappingVersion: number;
  readonly rngContractVersion: number;
}

export const CURRENT_COMBAT_VERSION_SET: CombatVersionSet = Object.freeze({
  combatSchemaVersion: 1,
  rulesetVersion: 1,
  balanceVersion: 1,
  engineVersion: 1,
  worldProfileVersion: 1,
  attributeMappingVersion: 1,
  rngContractVersion: 1,
});

export type CombatVersionContractErrorCode =
  'COMBAT_VERSION_STRUCTURE_INVALID' | 'COMBAT_VERSION_UNSUPPORTED';

export class CombatVersionContractError extends Error {
  public constructor(
    public readonly code: CombatVersionContractErrorCode,
    public readonly path: string,
  ) {
    super(code);
    this.name = 'CombatVersionContractError';
  }
}

/** Parses a persisted/wire shape without silently substituting current versions. */
export function parseCombatVersionSet(value: unknown): CombatVersionSet {
  if (!isRecord(value)) invalid('versions');
  requireExactKeys(value, COMBAT_VERSION_FIELDS);
  const result = Object.fromEntries(
    COMBAT_VERSION_FIELDS.map((field) => [field, requireVersion(value[field], field)]),
  ) as unknown as CombatVersionSet;
  return Object.freeze(result);
}

/** Applies the current runtime compatibility gate after structural parsing. */
export function assertSupportedCombatVersionSet(versions: CombatVersionSet): void {
  for (const field of COMBAT_VERSION_FIELDS) {
    if (versions[field] !== CURRENT_COMBAT_VERSION_SET[field]) {
      throw new CombatVersionContractError('COMBAT_VERSION_UNSUPPORTED', field);
    }
  }
}

export function combatVersionIdentity(versions: CombatVersionSet): string {
  return COMBAT_VERSION_FIELDS.map((field) => `${field}=${versions[field]}`).join('|');
}

export const COMBAT_RNG_CHANNELS = ['initiative', 'resolution', 'utilityTieBreak'] as const;
export type CombatRngChannel = (typeof COMBAT_RNG_CHANNELS)[number];

export interface CombatRngStreamSnapshot {
  readonly channelId: CombatRngChannel;
  readonly stateHex: string;
  readonly cursor: number;
}

export interface CombatRngSnapshot {
  readonly rngContractVersion: number;
  readonly streams: readonly CombatRngStreamSnapshot[];
}

export class CombatRngContractError extends Error {
  public constructor(public readonly path: string) {
    super('COMBAT_RNG_STRUCTURE_INVALID');
    this.name = 'CombatRngContractError';
  }
}

/** Validates the Rust-owned RNG checkpoint wire shape without executing RNG. */
export function parseCombatRngSnapshot(value: unknown): CombatRngSnapshot {
  if (!isRecord(value)) invalidRng('rng');
  requireExactKeysFor(value, ['rngContractVersion', 'streams'], 'rng');
  if (!Array.isArray(value['streams']) || value['streams'].length !== COMBAT_RNG_CHANNELS.length) {
    invalidRng('streams');
  }
  const streams = value['streams'].map((stream, index) => {
    const path = `streams[${index}]`;
    if (!isRecord(stream)) invalidRng(path);
    requireExactKeysFor(stream, ['channelId', 'stateHex', 'cursor'], path);
    const expectedChannel = COMBAT_RNG_CHANNELS[index];
    if (expectedChannel === undefined || stream['channelId'] !== expectedChannel) {
      invalidRng(`${path}.channelId`);
    }
    if (typeof stream['stateHex'] !== 'string' || !/^[0-9a-f]{16}$/u.test(stream['stateHex'])) {
      invalidRng(`${path}.stateHex`);
    }
    if (!Number.isSafeInteger(stream['cursor']) || (stream['cursor'] as number) < 0) {
      invalidRng(`${path}.cursor`);
    }
    return Object.freeze({
      channelId: expectedChannel,
      stateHex: stream['stateHex'],
      cursor: stream['cursor'] as number,
    });
  });
  return Object.freeze({
    rngContractVersion: requireVersion(value['rngContractVersion'], 'rngContractVersion'),
    streams: Object.freeze(streams),
  });
}

function requireVersion(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) invalid(path);
  return value as number;
}

function requireExactKeys(value: Record<string, unknown>, expected: readonly string[]): void {
  const actual = Object.keys(value).sort();
  const canonical = [...expected].sort();
  if (actual.length !== canonical.length || actual.some((key, index) => key !== canonical[index])) {
    invalid('versions');
  }
}

function requireExactKeysFor(
  value: Record<string, unknown>,
  expected: readonly string[],
  path: string,
): void {
  const actual = Object.keys(value).sort();
  const canonical = [...expected].sort();
  if (actual.length !== canonical.length || actual.some((key, index) => key !== canonical[index])) {
    invalidRng(path);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function invalid(path: string): never {
  throw new CombatVersionContractError('COMBAT_VERSION_STRUCTURE_INVALID', path);
}

function invalidRng(path: string): never {
  throw new CombatRngContractError(path);
}

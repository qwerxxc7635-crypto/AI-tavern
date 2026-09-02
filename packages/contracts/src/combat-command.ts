import {
  assertSupportedCombatVersionSet,
  parseCombatVersionSet,
  type CombatVersionSet,
} from './combat.js';

export type AcceptedCombatCommandSource =
  | { readonly kind: 'PLAYER'; readonly controllerId: string }
  | { readonly kind: 'UTILITY_AI' }
  | { readonly kind: 'TEST'; readonly testCaseId: string };

export type CombatCommandSource =
  | AcceptedCombatCommandSource
  | { readonly kind: 'REPLAY'; readonly originalSource: AcceptedCombatCommandSource }
  | { readonly kind: 'INTERNAL_DETERMINISTIC'; readonly ruleId: string };

export type TacticalPreferenceValue =
  | { readonly valueType: 'BOOLEAN'; readonly value: boolean }
  | { readonly valueType: 'INTEGER'; readonly value: number }
  | { readonly valueType: 'STABLE_ID'; readonly value: string };

export type CombatCommandPayload =
  | { readonly kind: 'USE_ABILITY'; readonly abilityId: string; readonly targetId: string | null }
  | { readonly kind: 'END_TURN' }
  | { readonly kind: 'ATTEMPT_ESCAPE' }
  | {
      readonly kind: 'SET_TACTICAL_STRATEGY';
      readonly companionId: string;
      readonly strategyId: string;
    }
  | {
      readonly kind: 'SET_TACTICAL_PREFERENCE';
      readonly companionId: string;
      readonly preferenceKey: string;
      readonly structuredValue: TacticalPreferenceValue;
    }
  | {
      readonly kind: 'RESOLVE_REACTION';
      readonly reactionWindowId: string;
      readonly choice: 'TRIGGER' | 'SKIP';
      readonly selectedReactionId: string | null;
    }
  | {
      readonly kind: 'INTERNAL_RULE_ACTION';
      readonly ruleId: string;
      readonly targetIds: readonly string[];
    };

export interface CombatCommandEnvelope {
  readonly commandId: string;
  readonly source: CombatCommandSource;
  readonly actorId: string;
  readonly versions: CombatVersionSet;
  readonly payload: CombatCommandPayload;
}

export interface AcceptedCombatCommand {
  readonly acceptedSequence: number;
  readonly commandId: string;
  readonly source: AcceptedCombatCommandSource;
  readonly actorId: string;
  readonly versions: CombatVersionSet;
  readonly payload: Exclude<CombatCommandPayload, { readonly kind: 'INTERNAL_RULE_ACTION' }>;
}

export class CombatCommandContractError extends Error {
  public constructor(public readonly path: string) {
    super('COMBAT_COMMAND_STRUCTURE_INVALID');
    this.name = 'CombatCommandContractError';
  }
}

export function parseCombatCommandEnvelope(value: unknown): CombatCommandEnvelope {
  const record = requireRecord(value, 'command');
  requireExactKeys(record, ['commandId', 'source', 'actorId', 'versions', 'payload'], 'command');
  const versions = parseCombatVersionSet(record['versions']);
  assertSupportedCombatVersionSet(versions);
  return deepFreeze({
    commandId: requireStableId(record['commandId'], 'commandId'),
    source: parseSource(record['source'], 'source', true),
    actorId: requireStableId(record['actorId'], 'actorId'),
    versions,
    payload: parsePayload(record['payload']),
  });
}

export function parseAcceptedCombatCommand(value: unknown): AcceptedCombatCommand {
  const record = requireRecord(value, 'acceptedCommand');
  requireExactKeys(
    record,
    ['acceptedSequence', 'commandId', 'source', 'actorId', 'versions', 'payload'],
    'acceptedCommand',
  );
  if (
    !Number.isSafeInteger(record['acceptedSequence']) ||
    (record['acceptedSequence'] as number) < 1
  ) {
    invalid('acceptedSequence');
  }
  const source = parseSource(record['source'], 'source', false);
  const payload = parsePayload(record['payload']);
  if (payload.kind === 'INTERNAL_RULE_ACTION') invalid('payload.kind');
  validateExternalOwnership(source, payload);
  const versions = parseCombatVersionSet(record['versions']);
  assertSupportedCombatVersionSet(versions);
  return deepFreeze({
    acceptedSequence: record['acceptedSequence'] as number,
    commandId: requireStableId(record['commandId'], 'commandId'),
    source,
    actorId: requireStableId(record['actorId'], 'actorId'),
    versions,
    payload,
  });
}

function parseSource(value: unknown, path: string, allowRuntime: true): CombatCommandSource;
function parseSource(
  value: unknown,
  path: string,
  allowRuntime: false,
): AcceptedCombatCommandSource;
function parseSource(
  value: unknown,
  path: string,
  allowRuntime: boolean,
): CombatCommandSource | AcceptedCombatCommandSource {
  const record = requireRecord(value, path);
  switch (record['kind']) {
    case 'PLAYER':
      requireExactKeys(record, ['kind', 'controllerId'], path);
      return {
        kind: 'PLAYER',
        controllerId: requireStableId(record['controllerId'], `${path}.controllerId`),
      };
    case 'UTILITY_AI':
      requireExactKeys(record, ['kind'], path);
      return { kind: 'UTILITY_AI' };
    case 'TEST':
      requireExactKeys(record, ['kind', 'testCaseId'], path);
      return {
        kind: 'TEST',
        testCaseId: requireStableId(record['testCaseId'], `${path}.testCaseId`),
      };
    case 'REPLAY':
      if (!allowRuntime) invalid(`${path}.kind`);
      requireExactKeys(record, ['kind', 'originalSource'], path);
      return {
        kind: 'REPLAY',
        originalSource: parseSource(record['originalSource'], `${path}.originalSource`, false),
      };
    case 'INTERNAL_DETERMINISTIC':
      if (!allowRuntime) invalid(`${path}.kind`);
      requireExactKeys(record, ['kind', 'ruleId'], path);
      return {
        kind: 'INTERNAL_DETERMINISTIC',
        ruleId: requireStableId(record['ruleId'], `${path}.ruleId`),
      };
    default:
      invalid(`${path}.kind`);
  }
}

function parsePayload(value: unknown): CombatCommandPayload {
  const record = requireRecord(value, 'payload');
  switch (record['kind']) {
    case 'USE_ABILITY':
      requireExactKeys(record, ['kind', 'abilityId', 'targetId'], 'payload');
      return {
        kind: 'USE_ABILITY',
        abilityId: requireStableId(record['abilityId'], 'payload.abilityId'),
        targetId: requireNullableStableId(record['targetId'], 'payload.targetId'),
      };
    case 'END_TURN':
      requireExactKeys(record, ['kind'], 'payload');
      return { kind: 'END_TURN' };
    case 'ATTEMPT_ESCAPE':
      requireExactKeys(record, ['kind'], 'payload');
      return { kind: 'ATTEMPT_ESCAPE' };
    case 'SET_TACTICAL_STRATEGY':
      requireExactKeys(record, ['kind', 'companionId', 'strategyId'], 'payload');
      return {
        kind: 'SET_TACTICAL_STRATEGY',
        companionId: requireStableId(record['companionId'], 'payload.companionId'),
        strategyId: requireStableId(record['strategyId'], 'payload.strategyId'),
      };
    case 'SET_TACTICAL_PREFERENCE':
      requireExactKeys(
        record,
        ['kind', 'companionId', 'preferenceKey', 'structuredValue'],
        'payload',
      );
      return {
        kind: 'SET_TACTICAL_PREFERENCE',
        companionId: requireStableId(record['companionId'], 'payload.companionId'),
        preferenceKey: requireStableId(record['preferenceKey'], 'payload.preferenceKey'),
        structuredValue: parsePreferenceValue(record['structuredValue']),
      };
    case 'RESOLVE_REACTION': {
      requireExactKeys(
        record,
        ['kind', 'reactionWindowId', 'choice', 'selectedReactionId'],
        'payload',
      );
      const choice = record['choice'];
      if (choice !== 'TRIGGER' && choice !== 'SKIP') invalid('payload.choice');
      const selectedReactionId = requireNullableStableId(
        record['selectedReactionId'],
        'payload.selectedReactionId',
      );
      if ((choice === 'TRIGGER') !== (selectedReactionId !== null))
        invalid('payload.selectedReactionId');
      return {
        kind: 'RESOLVE_REACTION',
        reactionWindowId: requireStableId(record['reactionWindowId'], 'payload.reactionWindowId'),
        choice,
        selectedReactionId,
      };
    }
    case 'INTERNAL_RULE_ACTION': {
      requireExactKeys(record, ['kind', 'ruleId', 'targetIds'], 'payload');
      if (!Array.isArray(record['targetIds']) || record['targetIds'].length > 256)
        invalid('payload.targetIds');
      const targetIds = record['targetIds'].map((targetId, index) =>
        requireStableId(targetId, `payload.targetIds[${index}]`),
      );
      if (
        targetIds.some((targetId, index) => {
          const previous = targetIds[index - 1];
          return previous !== undefined && previous >= targetId;
        })
      ) {
        invalid('payload.targetIds');
      }
      return {
        kind: 'INTERNAL_RULE_ACTION',
        ruleId: requireStableId(record['ruleId'], 'payload.ruleId'),
        targetIds,
      };
    }
    default:
      invalid('payload.kind');
  }
}

function parsePreferenceValue(value: unknown): TacticalPreferenceValue {
  const record = requireRecord(value, 'payload.structuredValue');
  requireExactKeys(record, ['valueType', 'value'], 'payload.structuredValue');
  switch (record['valueType']) {
    case 'BOOLEAN':
      if (typeof record['value'] !== 'boolean') invalid('payload.structuredValue.value');
      return { valueType: 'BOOLEAN', value: record['value'] };
    case 'INTEGER':
      if (!Number.isSafeInteger(record['value'])) invalid('payload.structuredValue.value');
      return { valueType: 'INTEGER', value: record['value'] as number };
    case 'STABLE_ID':
      return {
        valueType: 'STABLE_ID',
        value: requireStableId(record['value'], 'payload.structuredValue.value'),
      };
    default:
      invalid('payload.structuredValue.valueType');
  }
}

function validateExternalOwnership(
  source: AcceptedCombatCommandSource,
  payload: Exclude<CombatCommandPayload, { readonly kind: 'INTERNAL_RULE_ACTION' }>,
): void {
  if (
    source.kind === 'UTILITY_AI' &&
    ['SET_TACTICAL_STRATEGY', 'SET_TACTICAL_PREFERENCE', 'RESOLVE_REACTION'].includes(payload.kind)
  ) {
    invalid('source.kind');
  }
}

function requireNullableStableId(value: unknown, path: string): string | null {
  return value === null ? null : requireStableId(value, path);
}

function requireStableId(value: unknown, path: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/u.test(value)) invalid(path);
  return value;
}

function requireRecord(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) invalid(path);
  return value as Record<string, unknown>;
}

function requireExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  path: string,
): void {
  const actual = Object.keys(value).sort();
  const canonical = [...expected].sort();
  if (actual.length !== canonical.length || actual.some((key, index) => key !== canonical[index]))
    invalid(path);
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function invalid(path: string): never {
  throw new CombatCommandContractError(path);
}

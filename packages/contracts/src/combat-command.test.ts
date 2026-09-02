import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  CURRENT_COMBAT_VERSION_SET,
  CombatCommandContractError,
  parseAcceptedCombatCommand,
  parseCombatCommandEnvelope,
} from './index.js';

const fixture = JSON.parse(
  readFileSync(new URL('./combat-command-contract.fixture.json', import.meta.url), 'utf8'),
) as unknown;

const baseEnvelope = {
  commandId: 'command-001',
  source: { kind: 'PLAYER', controllerId: 'player-main' },
  actorId: 'combatant-player',
  versions: CURRENT_COMBAT_VERSION_SET,
};

describe('Combat command boundary wire contract', () => {
  it('parses and deeply freezes the shared Rust accepted-command fixture', () => {
    const command = parseAcceptedCombatCommand(fixture);
    expect(command.acceptedSequence).toBe(1);
    expect(command.payload.kind).toBe('SET_TACTICAL_STRATEGY');
    expect(Object.isFrozen(command)).toBe(true);
    expect(Object.isFrozen(command.source)).toBe(true);
    expect(Object.isFrozen(command.payload)).toBe(true);
  });

  it.each([
    { kind: 'USE_ABILITY', abilityId: 'ability-strike', targetId: 'enemy-1' },
    { kind: 'END_TURN' },
    { kind: 'ATTEMPT_ESCAPE' },
    { kind: 'SET_TACTICAL_STRATEGY', companionId: 'companion-1', strategyId: 'BALANCED' },
    {
      kind: 'SET_TACTICAL_PREFERENCE',
      companionId: 'companion-1',
      preferenceKey: 'target.priority',
      structuredValue: { valueType: 'INTEGER', value: 2 },
    },
    {
      kind: 'RESOLVE_REACTION',
      reactionWindowId: 'reaction-window-1',
      choice: 'TRIGGER',
      selectedReactionId: 'reaction-parry',
    },
  ])('accepts external payload $kind through one envelope shape', (payload) => {
    expect(parseCombatCommandEnvelope({ ...baseEnvelope, payload }).payload).toEqual(payload);
  });

  it('keeps replay and deterministic internal work explicit in the unified envelope', () => {
    const replay = parseCombatCommandEnvelope({
      ...baseEnvelope,
      source: { kind: 'REPLAY', originalSource: { kind: 'UTILITY_AI' } },
      payload: { kind: 'END_TURN' },
    });
    expect(replay.source.kind).toBe('REPLAY');

    const internal = parseCombatCommandEnvelope({
      ...baseEnvelope,
      source: { kind: 'INTERNAL_DETERMINISTIC', ruleId: 'rule-dot' },
      payload: {
        kind: 'INTERNAL_RULE_ACTION',
        ruleId: 'rule-dot',
        targetIds: ['combatant-a', 'combatant-b'],
      },
    });
    expect(internal.payload.kind).toBe('INTERNAL_RULE_ACTION');
  });

  it.each([
    ['unknown command field', () => ({ ...(fixture as object), wallClockTime: 1 })],
    [
      'unsafe sequence',
      () => ({ ...(fixture as object), acceptedSequence: Number.MAX_SAFE_INTEGER + 1 }),
    ],
    ['malformed stable id', () => ({ ...(fixture as object), commandId: 'bad id' })],
    [
      'replay in accepted history',
      () => ({
        ...(fixture as object),
        source: { kind: 'REPLAY', originalSource: { kind: 'UTILITY_AI' } },
      }),
    ],
    [
      'internal payload in accepted history',
      () => ({
        ...(fixture as object),
        payload: { kind: 'INTERNAL_RULE_ACTION', ruleId: 'rule-dot', targetIds: [] },
      }),
    ],
    [
      'UtilityAI resolving player reaction',
      () => ({
        ...(fixture as object),
        source: { kind: 'UTILITY_AI' },
        payload: {
          kind: 'RESOLVE_REACTION',
          reactionWindowId: 'window-1',
          choice: 'SKIP',
          selectedReactionId: null,
        },
      }),
    ],
    [
      'incoherent reaction selection',
      () => ({
        ...(fixture as object),
        payload: {
          kind: 'RESOLVE_REACTION',
          reactionWindowId: 'window-1',
          choice: 'TRIGGER',
          selectedReactionId: null,
        },
      }),
    ],
  ])('rejects %s', (_label, build) => {
    expect(() => parseAcceptedCombatCommand(build())).toThrow(CombatCommandContractError);
  });
});

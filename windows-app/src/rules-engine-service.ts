import { invoke } from '@tauri-apps/api/core';

import type {
  CharacterRuleState,
  IdempotencyKey,
  IsoTimestamp,
  RulesCommand,
  RulesEventId,
} from '@ember-tavern/contracts';

export interface NativeRulesApplyCommand {
  readonly eventId: RulesEventId;
  readonly idempotencyKey: IdempotencyKey;
  readonly expectedRevision: number;
  readonly occurredAt: IsoTimestamp;
  readonly command: RulesCommand;
}

export interface NativeRulesCommitReceipt {
  readonly status: 'COMMITTED' | 'ALREADY_COMMITTED';
  readonly eventId: string;
  readonly idempotencyKey: string;
  readonly beforeRevision: number;
  readonly afterRevision: number;
  readonly state: CharacterRuleState;
  readonly questBeforeStatus: string | null;
  readonly questAfterStatus: string | null;
  readonly occurredAt: string;
}

export interface RulesEngineGateway {
  load(playerCharacterId: string): Promise<CharacterRuleState>;
  apply(command: NativeRulesApplyCommand): Promise<NativeRulesCommitReceipt>;
}

export const tauriRulesEngineGateway: RulesEngineGateway = {
  async load(playerCharacterId) {
    return parseState(
      await invoke<unknown>('rules_state_get', { playerCharacterId }),
      playerCharacterId,
    );
  },
  async apply(command) {
    return parseReceipt(await invoke<unknown>('rules_apply', { command }), command);
  },
};

function parseState(value: unknown, expectedCharacterId: string): CharacterRuleState {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('Native Rules state must be an object');
  }
  const state = value as Partial<CharacterRuleState>;
  const attributes = state.baseAttributes as
    Partial<CharacterRuleState['baseAttributes']> | undefined;
  const hitPoints = state.hitPoints as Partial<CharacterRuleState['hitPoints']> | undefined;
  const attributeValues =
    attributes === undefined
      ? []
      : [attributes.physique, attributes.agility, attributes.knowledge, attributes.charisma];
  const validAttributes =
    attributeValues.length === 4 &&
    attributeValues.every(
      (entry): entry is number =>
        typeof entry === 'number' && Number.isInteger(entry) && entry >= 1 && entry <= 5,
    ) &&
    attributeValues.reduce<number>((sum, entry) => sum + (entry ?? 0), 0) === 10;
  const hpCurrent = hitPoints?.current;
  const hpMax = hitPoints?.max;
  const validHitPoints =
    typeof hpCurrent === 'number' &&
    Number.isSafeInteger(hpCurrent) &&
    typeof hpMax === 'number' &&
    Number.isSafeInteger(hpMax) &&
    hpMax >= 1 &&
    hpCurrent >= 0 &&
    hpCurrent <= hpMax;
  if (
    state.schemaVersion !== 1 ||
    state.playerCharacterId !== expectedCharacterId ||
    typeof state.campaignId !== 'string' ||
    state.campaignId.length === 0 ||
    !validAttributes ||
    !Array.isArray(state.skills) ||
    !validHitPoints ||
    !Array.isArray(state.statuses) ||
    !Array.isArray(state.equippedItemIds) ||
    !Number.isSafeInteger(state.money) ||
    !Number.isSafeInteger(state.gameTimeMinutes) ||
    !Array.isArray(state.traitModifiers) ||
    !Array.isArray(state.resources) ||
    !Number.isSafeInteger(state.revision) ||
    typeof state.updatedAt !== 'string'
  ) {
    throw new TypeError('Native Rules state is invalid or targets another character');
  }
  return Object.freeze(state as CharacterRuleState);
}

function parseReceipt(value: unknown, expected: NativeRulesApplyCommand): NativeRulesCommitReceipt {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('Native Rules receipt must be an object');
  }
  const receipt = value as Partial<NativeRulesCommitReceipt>;
  const isCommitted = receipt.status === 'COMMITTED';
  const beforeRevision = receipt.beforeRevision;
  const afterRevision = receipt.afterRevision;
  const validRevisions =
    typeof beforeRevision === 'number' &&
    Number.isSafeInteger(beforeRevision) &&
    typeof afterRevision === 'number' &&
    Number.isSafeInteger(afterRevision) &&
    afterRevision === beforeRevision + 1;
  if (
    !['COMMITTED', 'ALREADY_COMMITTED'].includes(receipt.status ?? '') ||
    typeof receipt.eventId !== 'string' ||
    receipt.eventId.length === 0 ||
    (isCommitted && receipt.eventId !== expected.eventId) ||
    receipt.idempotencyKey !== expected.idempotencyKey ||
    !validRevisions ||
    typeof receipt.occurredAt !== 'string' ||
    (isCommitted && receipt.occurredAt !== expected.occurredAt)
  ) {
    throw new TypeError('Native Rules receipt does not match the submitted command');
  }
  const state = parseState(receipt.state, expected.command.playerCharacterId);
  if (
    state.campaignId !== expected.command.campaignId ||
    state.revision !== receipt.afterRevision
  ) {
    throw new TypeError('Native Rules receipt state is inconsistent');
  }
  return Object.freeze({
    ...(receipt as NativeRulesCommitReceipt),
    state,
  });
}

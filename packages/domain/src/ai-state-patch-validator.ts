import { npcId, questId, worldClockId } from '@ember-tavern/contracts';
import type {
  AdventureId,
  CampaignId,
  ItemContent,
  ItemEffect,
  NpcRelationship,
  PlayerCharacterId,
  Quest,
  QuestId,
  QuestStatus,
  RewardTier,
  WorldBible,
} from '@ember-tavern/contracts';

import {
  advanceWorldClock,
  applyRelationshipPatch,
  DomainPatchError,
  type RelationshipPatch,
  type WorldClock,
  type WorldClockAdvanceResult,
} from './relationship-clock.js';

const QUEST_TRANSITIONS: Readonly<Record<QuestStatus, readonly QuestStatus[]>> = {
  AVAILABLE: ['ACCEPTED'],
  ACCEPTED: ['ACTIVE', 'ABANDONED'],
  ACTIVE: ['COMPLETED', 'FAILED', 'ABANDONED'],
  COMPLETED: [],
  FAILED: [],
  ABANDONED: [],
};
const REWARD_RANK: Readonly<Record<RewardTier, number>> = {
  BASIC: 0,
  NOTABLE: 1,
  RARE: 2,
  LEGENDARY: 3,
};
const RELATIONSHIP_FIELDS = ['trust', 'closeness', 'awe', 'obligation'] as const;

export interface RewardAuthorization {
  readonly questId: QuestId;
  readonly adventureId: AdventureId;
  readonly ownerCharacterId: PlayerCharacterId;
  readonly effect: ItemEffect;
}

export interface DomainPatchValidationContext {
  readonly campaignId: CampaignId;
  readonly world: WorldBible;
  readonly quests: readonly Quest[];
  readonly relationships: readonly NpcRelationship[];
  readonly clocks: readonly WorldClock[];
  readonly rewardAuthorizations: readonly RewardAuthorization[];
}

export type ValidatedDomainPatch =
  | Readonly<{ kind: 'QUEST'; quest: Quest }>
  | Readonly<{ kind: 'RELATIONSHIP'; relationship: NpcRelationship }>
  | Readonly<{
      kind: 'ITEM_REWARD';
      content: ItemContent;
      rewardTier: RewardTier;
      authorization: RewardAuthorization;
    }>
  | Readonly<{ kind: 'FACT'; statement: string; factKind: 'DEVELOPING_FACT' }>
  | Readonly<{ kind: 'CLOCK'; result: WorldClockAdvanceResult }>;

export type DomainPatchErrorCode =
  | 'INVALID_PATCH'
  | 'UNKNOWN_TARGET'
  | 'ILLEGAL_QUEST_TRANSITION'
  | 'RELATIONSHIP_LIMIT'
  | 'REWARD_NOT_AUTHORIZED'
  | 'REWARD_TIER_EXCEEDED'
  | 'LOCKED_RULE'
  | 'ATTRIBUTE_CHANGE_FORBIDDEN'
  | 'CLOCK_LIMIT';

export class DomainPatchValidationError extends Error {
  public constructor(
    public readonly code: DomainPatchErrorCode,
    public readonly patchIndex: number,
    public readonly path: readonly (string | number)[],
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'DomainPatchValidationError';
  }
}

export function validateDomainStatePatches(
  proposals: readonly unknown[],
  context: DomainPatchValidationContext,
): readonly ValidatedDomainPatch[] {
  if (context.world.campaignId !== context.campaignId) {
    throw new DomainPatchValidationError(
      'INVALID_PATCH',
      -1,
      ['world', 'campaignId'],
      'World belongs to another campaign',
    );
  }
  const quests = new Map(
    context.quests
      .filter((quest) => quest.campaignId === context.campaignId)
      .map((quest) => [quest.id, quest]),
  );
  const relationships = new Map(context.relationships.map((value) => [value.npcId, value]));
  const clocks = new Map(
    context.clocks
      .filter((clock) => clock.campaignId === context.campaignId)
      .map((clock) => [clock.id, clock]),
  );
  const authorizations = new Map(
    context.rewardAuthorizations.map((authorization) => [authorization.questId, authorization]),
  );
  const result: ValidatedDomainPatch[] = [];

  proposals.forEach((value, index) => {
    const proposal = patchRecord(value, index);
    const kind = requiredString(proposal, 'kind', index);
    switch (kind) {
      case 'QUEST': {
        const target = requiredTarget(proposal, index);
        const current = quests.get(questId(target));
        if (current === undefined) {
          fail('UNKNOWN_TARGET', index, ['targetId'], `Unknown quest: ${target}`);
        }
        const payload = payloadRecord(proposal, index, ['status']);
        const status = requiredString(payload, 'status', index);
        if (!isQuestStatus(status) || !QUEST_TRANSITIONS[current.status].includes(status)) {
          fail(
            'ILLEGAL_QUEST_TRANSITION',
            index,
            ['payload', 'status'],
            `Illegal quest transition: ${current.status} -> ${status}`,
          );
        }
        const quest = Object.freeze({ ...current, status });
        quests.set(quest.id, quest);
        result.push(Object.freeze({ kind: 'QUEST', quest }));
        break;
      }
      case 'RELATIONSHIP': {
        const target = requiredTarget(proposal, index);
        const current = relationships.get(npcId(target));
        if (current === undefined) {
          fail('UNKNOWN_TARGET', index, ['targetId'], `Unknown NPC relationship: ${target}`);
        }
        const payload = payloadRecord(proposal, index, RELATIONSHIP_FIELDS);
        const delta: RelationshipPatch = {};
        for (const field of RELATIONSHIP_FIELDS) {
          const value = payload[field];
          if (value !== undefined) {
            if (typeof value !== 'number') {
              fail(
                'RELATIONSHIP_LIMIT',
                index,
                ['payload', field],
                `${field} delta must be a number`,
              );
            }
            delta[field] = value;
          }
        }
        try {
          const relationship = applyRelationshipPatch(current, delta);
          relationships.set(relationship.npcId, relationship);
          result.push(Object.freeze({ kind: 'RELATIONSHIP', relationship }));
        } catch (error) {
          if (!(error instanceof DomainPatchError)) throw error;
          throw new DomainPatchValidationError(
            'RELATIONSHIP_LIMIT',
            index,
            ['payload'],
            error.message,
            { cause: error },
          );
        }
        break;
      }
      case 'ITEM_REWARD': {
        requireNullTarget(proposal, index);
        const payload = payloadRecord(proposal, index, [
          'name',
          'description',
          'rewardTier',
          'questId',
        ]);
        const rewardQuestId = questId(requiredString(payload, 'questId', index));
        const quest = quests.get(rewardQuestId);
        const authorization = authorizations.get(rewardQuestId);
        if (quest === undefined || authorization === undefined || quest.status !== 'COMPLETED') {
          fail(
            'REWARD_NOT_AUTHORIZED',
            index,
            ['payload', 'questId'],
            'Item rewards require an explicitly authorized completed quest',
          );
        }
        const rewardTier = requiredString(payload, 'rewardTier', index);
        if (!isRewardTier(rewardTier)) {
          fail(
            'INVALID_PATCH',
            index,
            ['payload', 'rewardTier'],
            `Unknown reward tier: ${rewardTier}`,
          );
        }
        if (REWARD_RANK[rewardTier] > REWARD_RANK[quest.rewardTier]) {
          fail(
            'REWARD_TIER_EXCEEDED',
            index,
            ['payload', 'rewardTier'],
            `Reward tier ${rewardTier} exceeds quest tier ${quest.rewardTier}`,
          );
        }
        result.push(
          Object.freeze({
            kind: 'ITEM_REWARD',
            content: Object.freeze({
              name: requiredString(payload, 'name', index),
              description: requiredString(payload, 'description', index),
            }),
            rewardTier,
            authorization,
          }),
        );
        break;
      }
      case 'FACT': {
        requireNullTarget(proposal, index);
        const payload = payloadRecord(proposal, index, ['statement', 'kind']);
        const factKind = payload['kind'] ?? 'DEVELOPING_FACT';
        if (factKind === 'LOCKED_RULE') {
          fail(
            'LOCKED_RULE',
            index,
            ['payload', 'kind'],
            'AI cannot create or modify locked world rules',
          );
        }
        if (factKind !== 'DEVELOPING_FACT') {
          fail(
            'INVALID_PATCH',
            index,
            ['payload', 'kind'],
            'This validator only accepts append-only developing facts',
          );
        }
        result.push(
          Object.freeze({
            kind: 'FACT',
            statement: requiredString(payload, 'statement', index),
            factKind,
          }),
        );
        break;
      }
      case 'CLOCK': {
        const target = requiredTarget(proposal, index);
        const clock = clocks.get(worldClockId(target));
        if (clock === undefined) {
          fail('UNKNOWN_TARGET', index, ['targetId'], `Unknown world clock: ${target}`);
        }
        const payload = payloadRecord(proposal, index, ['amount']);
        const amount = payload['amount'];
        if (typeof amount !== 'number') {
          fail('CLOCK_LIMIT', index, ['payload', 'amount'], 'Clock amount must be a number');
        }
        try {
          const advanced = advanceWorldClock(clock, amount);
          clocks.set(advanced.clock.id, advanced.clock);
          result.push(Object.freeze({ kind: 'CLOCK', result: advanced }));
        } catch (error) {
          if (!(error instanceof DomainPatchError)) throw error;
          throw new DomainPatchValidationError(
            'CLOCK_LIMIT',
            index,
            ['payload', 'amount'],
            error.message,
            { cause: error },
          );
        }
        break;
      }
      case 'PLAYER_ATTRIBUTE':
      case 'ATTRIBUTES':
        fail('ATTRIBUTE_CHANGE_FORBIDDEN', index, ['kind'], 'AI cannot modify player attributes');
        break;
      default:
        fail('INVALID_PATCH', index, ['kind'], `Unsupported state patch kind: ${kind}`);
    }
  });

  return Object.freeze(result);
}

function patchRecord(value: unknown, index: number): Record<string, unknown> {
  const record = recordValue(value, index, []);
  rejectExtraKeys(record, ['kind', 'targetId', 'rationale', 'payload'], index, []);
  requiredString(record, 'rationale', index);
  return record;
}

function payloadRecord(
  proposal: Record<string, unknown>,
  index: number,
  allowedKeys: readonly string[],
): Record<string, unknown> {
  const payload = recordValue(proposal['payload'], index, ['payload']);
  rejectExtraKeys(payload, allowedKeys, index, ['payload']);
  return payload;
}

function recordValue(
  value: unknown,
  index: number,
  path: readonly (string | number)[],
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail('INVALID_PATCH', index, path, 'Expected an object');
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail('INVALID_PATCH', index, path, 'Expected a plain object');
  }
  return Object.fromEntries(Object.entries(value));
}

function rejectExtraKeys(
  record: Record<string, unknown>,
  allowedKeys: readonly string[],
  index: number,
  path: readonly (string | number)[],
): void {
  const extra = Object.keys(record).find((key) => !allowedKeys.includes(key));
  if (extra !== undefined) {
    const code =
      /attribute/i.test(extra) && path[0] === 'payload'
        ? 'ATTRIBUTE_CHANGE_FORBIDDEN'
        : 'INVALID_PATCH';
    fail(code, index, [...path, extra], `Unexpected patch field: ${extra}`);
  }
}

function requiredString(record: Record<string, unknown>, key: string, index: number): string {
  const value = record[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    fail('INVALID_PATCH', index, [key], `${key} must be non-empty text`);
  }
  return value;
}

function requiredTarget(record: Record<string, unknown>, index: number): string {
  return requiredString(record, 'targetId', index);
}

function requireNullTarget(record: Record<string, unknown>, index: number): void {
  if (record['targetId'] !== null) {
    const code = record['kind'] === 'FACT' ? 'LOCKED_RULE' : 'INVALID_PATCH';
    fail(code, index, ['targetId'], `${record['kind']} patches must create append-only content`);
  }
}

function isQuestStatus(value: string): value is QuestStatus {
  return Object.hasOwn(QUEST_TRANSITIONS, value);
}

function isRewardTier(value: string): value is RewardTier {
  return Object.hasOwn(REWARD_RANK, value);
}

function fail(
  code: DomainPatchErrorCode,
  patchIndex: number,
  path: readonly (string | number)[],
  message: string,
): never {
  throw new DomainPatchValidationError(code, patchIndex, Object.freeze([...path]), message);
}

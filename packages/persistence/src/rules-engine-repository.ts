import {
  CHARACTER_ATTRIBUTE_NAMES,
  QUEST_STATUSES,
  RULE_COMMAND_AUTHORITIES,
  RULE_STATUS_KINDS,
  campaignId,
  characterTraitId,
  createPlayerAttributes,
  idempotencyKey,
  isoTimestamp,
  itemId,
  playerCharacterId,
  questId,
  rulesEventId,
  schemaVersion,
  type CharacterAttributeName,
  type CharacterRuleState,
  type IdempotencyKey,
  type IsoTimestamp,
  type QuestStatus,
  type RuleResource,
  type RuleStatus,
  type RulesCommand,
  type RulesEvent,
  type RulesEventId,
  type TraitModifierTarget,
  type TraitRuleModifier,
} from '@ember-tavern/contracts';
import { applyRulesCommand, validateCharacterRuleState } from '@ember-tavern/domain';

import { PersistenceDataError } from './campaign-repository.js';
import {
  parseJson,
  requireArray,
  requireEnum,
  requireNullableString,
  requireNumber,
  requireRecord,
  requireString,
} from './persistence-validation.js';
import { QuestRepository } from './quest-adventure-repository.js';
import type { TransactionalSqliteDatabase } from './sqlite-port.js';

export interface CommitRulesCommand {
  readonly eventId: RulesEventId;
  readonly idempotencyKey: IdempotencyKey;
  readonly command: RulesCommand;
  readonly expectedRevision: number;
  readonly occurredAt: IsoTimestamp;
}

export interface RulesCommitResult {
  readonly status: 'COMMITTED' | 'ALREADY_COMMITTED';
  readonly event: RulesEvent;
}

export class RulesIdempotencyConflictError extends PersistenceDataError {
  public constructor() {
    super('Rules idempotency key was already used by a different command');
    this.name = 'RulesIdempotencyConflictError';
  }
}

export class RulesEngineRepository {
  public constructor(private readonly database: TransactionalSqliteDatabase) {}

  public getState(id: CharacterRuleState['playerCharacterId']): CharacterRuleState | null {
    const row = this.database
      .prepare('SELECT * FROM character_rule_states WHERE player_character_id = ?')
      .get(id);
    return row === undefined ? null : mapStateRow(row);
  }

  public listEvents(id: CharacterRuleState['playerCharacterId']): readonly RulesEvent[] {
    return Object.freeze(
      this.database
        .prepare(
          `SELECT * FROM rules_events
           WHERE player_character_id = ?
           ORDER BY after_revision`,
        )
        .all(id)
        .map(mapEventRow),
    );
  }

  public commitOnce(input: CommitRulesCommand): RulesCommitResult {
    const canonicalCommand = canonicalJson(input.command);
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const existingRow = this.database
        .prepare('SELECT * FROM rules_events WHERE idempotency_key = ?')
        .get(input.idempotencyKey);
      if (existingRow !== undefined) {
        const row = requireRecord(existingRow, 'Rules event row');
        if (
          requireString(row['command_json'], 'command_json') !== canonicalCommand ||
          requireString(row['campaign_id'], 'campaign_id') !== input.command.campaignId ||
          requireString(row['player_character_id'], 'player_character_id') !==
            input.command.playerCharacterId
        ) {
          throw new RulesIdempotencyConflictError();
        }
        const event = mapEventRow(row);
        this.database.exec('COMMIT');
        return Object.freeze({ status: 'ALREADY_COMMITTED', event });
      }

      const before = this.getState(input.command.playerCharacterId);
      if (before === null) throw new PersistenceDataError('Character rules state not found');
      if (before.revision !== input.expectedRevision) {
        throw new PersistenceDataError(
          `Character rules revision mismatch: expected ${input.expectedRevision}, found ${before.revision}`,
        );
      }
      const quests = new QuestRepository(this.database).listByCampaign(input.command.campaignId);
      const ownedItemIds = this.database
        .prepare(
          `SELECT id FROM items
           WHERE campaign_id = ? AND owner_character_id = ?
           ORDER BY id`,
        )
        .all(input.command.campaignId, input.command.playerCharacterId)
        .map((value) =>
          itemId(requireString(requireRecord(value, 'Owned item row')['id'], 'owned item id')),
        );
      const result = applyRulesCommand(
        before,
        input.command,
        { ownedItemIds, quests },
        input.occurredAt,
      );

      const changed = this.database
        .prepare(
          `UPDATE character_rule_states SET
             skills_json = ?, hp_current = ?, hp_max = ?, statuses_json = ?,
             equipped_item_ids_json = ?, money = ?, game_time_minutes = ?,
             trait_modifiers_json = ?, resources_json = ?, revision = ?, updated_at = ?
           WHERE player_character_id = ? AND campaign_id = ? AND revision = ?`,
        )
        .run(
          JSON.stringify(result.state.skills),
          result.state.hitPoints.current,
          result.state.hitPoints.max,
          JSON.stringify(result.state.statuses),
          JSON.stringify(result.state.equippedItemIds),
          result.state.money,
          result.state.gameTimeMinutes,
          JSON.stringify(result.state.traitModifiers),
          JSON.stringify(result.state.resources),
          result.state.revision,
          result.state.updatedAt,
          result.state.playerCharacterId,
          result.state.campaignId,
          before.revision,
        );
      if (Number(changed.changes) !== 1) {
        throw new PersistenceDataError('Character rules state changed during commit');
      }
      if (result.questAfter !== null) new QuestRepository(this.database).update(result.questAfter);

      this.database
        .prepare(
          `INSERT INTO rules_events (
             id, campaign_id, player_character_id, idempotency_key, source, command_kind,
             command_json, before_revision, after_revision, state_before_json, state_after_json,
             quest_before_status, quest_after_status, occurred_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.eventId,
          input.command.campaignId,
          input.command.playerCharacterId,
          input.idempotencyKey,
          input.command.authority,
          input.command.kind,
          canonicalCommand,
          before.revision,
          result.state.revision,
          JSON.stringify(before),
          JSON.stringify(result.state),
          result.questBefore?.status ?? null,
          result.questAfter?.status ?? null,
          input.occurredAt,
        );
      const event = this.requireEvent(input.eventId);
      this.database.exec('COMMIT');
      return Object.freeze({ status: 'COMMITTED', event });
    } catch (error) {
      try {
        this.database.exec('ROLLBACK');
      } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], 'Rules command and rollback both failed', {
          cause: rollbackError,
        });
      }
      throw error;
    }
  }

  private requireEvent(id: RulesEventId): RulesEvent {
    const row = this.database.prepare('SELECT * FROM rules_events WHERE id = ?').get(id);
    if (row === undefined) throw new PersistenceDataError(`Rules event not found: ${id}`);
    return mapEventRow(row);
  }
}

function mapStateRow(value: unknown): CharacterRuleState {
  const row = requireRecord(value, 'Character rules state row');
  const state = {
    schemaVersion: schemaVersion(requireNumber(row['schema_version'], 'schema_version')),
    campaignId: campaignId(requireString(row['campaign_id'], 'campaign_id')),
    playerCharacterId: playerCharacterId(
      requireString(row['player_character_id'], 'player_character_id'),
    ),
    baseAttributes: parseAttributes(parseJson(row['base_attributes_json'], 'base_attributes_json')),
    skills: Object.freeze(
      requireArray(parseJson(row['skills_json'], 'skills_json'), 'skills').map(parseSkill),
    ),
    hitPoints: Object.freeze({
      current: requireNumber(row['hp_current'], 'hp_current'),
      max: requireNumber(row['hp_max'], 'hp_max'),
    }),
    statuses: Object.freeze(
      requireArray(parseJson(row['statuses_json'], 'statuses_json'), 'statuses').map(parseStatus),
    ),
    equippedItemIds: Object.freeze(
      requireArray(
        parseJson(row['equipped_item_ids_json'], 'equipped_item_ids_json'),
        'equippedItemIds',
      ).map((entry, index) => itemId(requireString(entry, `equippedItemIds[${index}]`))),
    ),
    money: requireNumber(row['money'], 'money'),
    gameTimeMinutes: requireNumber(row['game_time_minutes'], 'game_time_minutes'),
    traitModifiers: Object.freeze(
      requireArray(
        parseJson(row['trait_modifiers_json'], 'trait_modifiers_json'),
        'traitModifiers',
      ).map(parseTraitModifier),
    ),
    resources: Object.freeze(
      requireArray(parseJson(row['resources_json'], 'resources_json'), 'resources').map(
        parseResource,
      ),
    ),
    revision: requireNumber(row['revision'], 'revision'),
    updatedAt: isoTimestamp(requireString(row['updated_at'], 'updated_at')),
  } satisfies CharacterRuleState;
  return validateCharacterRuleState(state);
}

function mapEventRow(value: unknown): RulesEvent {
  const row = requireRecord(value, 'Rules event row');
  const before = parseStoredState(parseJson(row['state_before_json'], 'state_before_json'));
  const after = parseStoredState(parseJson(row['state_after_json'], 'state_after_json'));
  const command = parseCommand(parseJson(row['command_json'], 'command_json'));
  const beforeStatus = parseNullableQuestStatus(row['quest_before_status'], 'quest_before_status');
  const afterStatus = parseNullableQuestStatus(row['quest_after_status'], 'quest_after_status');
  const event = Object.freeze({
    id: rulesEventId(requireString(row['id'], 'id')),
    campaignId: campaignId(requireString(row['campaign_id'], 'campaign_id')),
    playerCharacterId: playerCharacterId(
      requireString(row['player_character_id'], 'player_character_id'),
    ),
    idempotencyKey: idempotencyKey(requireString(row['idempotency_key'], 'idempotency_key')),
    command,
    beforeRevision: requireNumber(row['before_revision'], 'before_revision'),
    afterRevision: requireNumber(row['after_revision'], 'after_revision'),
    stateBefore: before,
    stateAfter: after,
    questBeforeStatus: beforeStatus,
    questAfterStatus: afterStatus,
    occurredAt: isoTimestamp(requireString(row['occurred_at'], 'occurred_at')),
  });
  if (
    event.campaignId !== command.campaignId ||
    event.playerCharacterId !== command.playerCharacterId ||
    event.beforeRevision !== before.revision ||
    event.afterRevision !== after.revision ||
    after.revision !== before.revision + 1 ||
    (beforeStatus === null) !== (afterStatus === null)
  ) {
    throw new PersistenceDataError('Rules event does not match its command and state snapshots');
  }
  return event;
}

function parseStoredState(value: unknown): CharacterRuleState {
  const state = requireRecord(value, 'Stored rules state');
  return validateCharacterRuleState({
    schemaVersion: schemaVersion(requireNumber(state['schemaVersion'], 'schemaVersion')),
    campaignId: campaignId(requireString(state['campaignId'], 'campaignId')),
    playerCharacterId: playerCharacterId(
      requireString(state['playerCharacterId'], 'playerCharacterId'),
    ),
    baseAttributes: parseAttributes(state['baseAttributes']),
    skills: Object.freeze(requireArray(state['skills'], 'skills').map(parseSkill)),
    hitPoints: parseHitPoints(state['hitPoints']),
    statuses: Object.freeze(requireArray(state['statuses'], 'statuses').map(parseStatus)),
    equippedItemIds: Object.freeze(
      requireArray(state['equippedItemIds'], 'equippedItemIds').map((entry, index) =>
        itemId(requireString(entry, `equippedItemIds[${index}]`)),
      ),
    ),
    money: requireNumber(state['money'], 'money'),
    gameTimeMinutes: requireNumber(state['gameTimeMinutes'], 'gameTimeMinutes'),
    traitModifiers: Object.freeze(
      requireArray(state['traitModifiers'], 'traitModifiers').map(parseTraitModifier),
    ),
    resources: Object.freeze(requireArray(state['resources'], 'resources').map(parseResource)),
    revision: requireNumber(state['revision'], 'revision'),
    updatedAt: isoTimestamp(requireString(state['updatedAt'], 'updatedAt')),
  });
}

function parseCommand(value: unknown): RulesCommand {
  const command = requireRecord(value, 'Rules command');
  const common = {
    campaignId: campaignId(requireString(command['campaignId'], 'campaignId')),
    playerCharacterId: playerCharacterId(
      requireString(command['playerCharacterId'], 'playerCharacterId'),
    ),
    authority: requireEnum(RULE_COMMAND_AUTHORITIES, command['authority'], 'authority'),
  };
  const kind = requireString(command['kind'], 'kind');
  switch (kind) {
    case 'TAKE_DAMAGE':
    case 'RECOVER_HP':
      return Object.freeze({ ...common, kind, amount: requireNumber(command['amount'], 'amount') });
    case 'DEFINE_SKILL':
      return Object.freeze({ ...common, kind, skill: parseSkill(command['skill']) });
    case 'CHANGE_SKILL':
      return Object.freeze({
        ...common,
        kind,
        skillKey: requireString(command['skillKey'], 'skillKey'),
        delta: requireNumber(command['delta'], 'delta'),
      });
    case 'ADD_STATUS':
      return Object.freeze({ ...common, kind, status: parseStatus(command['status']) });
    case 'REMOVE_STATUS':
      return Object.freeze({
        ...common,
        kind,
        statusId: requireString(command['statusId'], 'statusId'),
      });
    case 'EQUIP_ITEM':
    case 'UNEQUIP_ITEM':
      return Object.freeze({
        ...common,
        kind,
        itemId: itemId(requireString(command['itemId'], 'itemId')),
      });
    case 'CHANGE_MONEY':
      return Object.freeze({ ...common, kind, delta: requireNumber(command['delta'], 'delta') });
    case 'ADVANCE_TIME':
      return Object.freeze({
        ...common,
        kind,
        minutes: requireNumber(command['minutes'], 'minutes'),
      });
    case 'DEFINE_RESOURCE':
      return Object.freeze({ ...common, kind, resource: parseResource(command['resource']) });
    case 'CHANGE_RESOURCE':
      return Object.freeze({
        ...common,
        kind,
        resourceKey: requireString(command['resourceKey'], 'resourceKey'),
        delta: requireNumber(command['delta'], 'delta'),
      });
    case 'SET_TRAIT_MODIFIER':
      return Object.freeze({
        ...common,
        kind,
        traitId: characterTraitId(requireString(command['traitId'], 'traitId')),
        target: parseTarget(command['target']),
        modifier: requireNumber(command['modifier'], 'modifier'),
      });
    case 'REMOVE_TRAIT_MODIFIER':
      return Object.freeze({
        ...common,
        kind,
        traitId: characterTraitId(requireString(command['traitId'], 'traitId')),
      });
    case 'TRANSITION_QUEST':
      return Object.freeze({
        ...common,
        kind,
        questId: questId(requireString(command['questId'], 'questId')),
        status: requireEnum(QUEST_STATUSES, command['status'], 'status'),
      });
    default:
      throw new PersistenceDataError(`Unknown Rules command: ${kind}`);
  }
}

function parseAttributes(value: unknown) {
  const attributes = requireRecord(value, 'baseAttributes');
  return createPlayerAttributes({
    physique: requireNumber(attributes['physique'], 'baseAttributes.physique'),
    agility: requireNumber(attributes['agility'], 'baseAttributes.agility'),
    knowledge: requireNumber(attributes['knowledge'], 'baseAttributes.knowledge'),
    charisma: requireNumber(attributes['charisma'], 'baseAttributes.charisma'),
  });
}

function parseSkill(value: unknown, index?: number) {
  const label = index === undefined ? 'skill' : `skills[${index}]`;
  const skill = requireRecord(value, label);
  return Object.freeze({
    key: requireString(skill['key'], `${label}.key`),
    value: requireNumber(skill['value'], `${label}.value`),
  });
}

function parseHitPoints(value: unknown) {
  const hitPoints = requireRecord(value, 'hitPoints');
  return Object.freeze({
    current: requireNumber(hitPoints['current'], 'hitPoints.current'),
    max: requireNumber(hitPoints['max'], 'hitPoints.max'),
  });
}

function parseStatus(value: unknown, index?: number): RuleStatus {
  const label = index === undefined ? 'status' : `statuses[${index}]`;
  const status = requireRecord(value, label);
  const modifiers = requireRecord(status['attributeModifiers'], `${label}.attributeModifiers`);
  const attributeModifiers: Partial<Record<CharacterAttributeName, number>> = {};
  for (const attribute of CHARACTER_ATTRIBUTE_NAMES) {
    if (modifiers[attribute] !== undefined) {
      attributeModifiers[attribute] = requireNumber(
        modifiers[attribute],
        `${label}.attributeModifiers.${attribute}`,
      );
    }
  }
  const expires = status['expiresAtGameMinute'];
  return Object.freeze({
    id: requireString(status['id'], `${label}.id`),
    kind: requireEnum(RULE_STATUS_KINDS, status['kind'], `${label}.kind`),
    label: requireString(status['label'], `${label}.label`),
    attributeModifiers: Object.freeze(attributeModifiers),
    expiresAtGameMinute:
      expires === null ? null : requireNumber(expires, `${label}.expiresAtGameMinute`),
  });
}

function parseResource(value: unknown, index?: number): RuleResource {
  const label = index === undefined ? 'resource' : `resources[${index}]`;
  const resource = requireRecord(value, label);
  return Object.freeze({
    key: requireString(resource['key'], `${label}.key`),
    current: requireNumber(resource['current'], `${label}.current`),
    max: requireNumber(resource['max'], `${label}.max`),
  });
}

function parseTraitModifier(value: unknown, index?: number): TraitRuleModifier {
  const label = index === undefined ? 'traitModifier' : `traitModifiers[${index}]`;
  const modifier = requireRecord(value, label);
  return Object.freeze({
    traitId: characterTraitId(requireString(modifier['traitId'], `${label}.traitId`)),
    target: parseTarget(modifier['target']),
    modifier: requireNumber(modifier['modifier'], `${label}.modifier`),
  });
}

function parseTarget(value: unknown): TraitModifierTarget {
  const target = requireRecord(value, 'target');
  const kind = requireEnum(
    ['ATTRIBUTE', 'SKILL', 'RESOURCE'] as const,
    target['kind'],
    'target.kind',
  );
  const key = requireString(target['key'], 'target.key');
  if (kind === 'ATTRIBUTE') {
    return Object.freeze({
      kind,
      key: requireEnum(CHARACTER_ATTRIBUTE_NAMES, key, 'target.key'),
    });
  }
  return Object.freeze({ kind, key });
}

function parseNullableQuestStatus(value: unknown, label: string): QuestStatus | null {
  const status = requireNullableString(value, label);
  return status === null ? null : requireEnum(QUEST_STATUSES, status, label);
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value))
      throw new PersistenceDataError('Rules command contains non-finite number');
    return value;
  }
  if (Array.isArray(value)) return value.map(sortJson);
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, sortJson(entry)]),
    );
  }
  throw new PersistenceDataError('Rules command contains non-JSON value');
}

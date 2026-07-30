import {
  AI_REQUEST_STATUSES,
  aiRequestId,
  campaignId,
  idempotencyKey,
  isoTimestamp,
  modelProfileId,
  turnId,
  type AiRequestError,
  type AiRequestId,
  type IdempotencyKey,
  type IsoTimestamp,
  type JsonValue,
  type PendingAiRequest,
  type Campaign,
  type Item,
  type NpcKnowledge,
  type NpcProfile,
  type NpcRelationship,
  type PlayerCharacter,
  type Tavern,
  type TemporaryVisitor,
  type WorldBible,
  type WorldFact,
} from '@ember-tavern/contracts';

import { CampaignRepository, PersistenceDataError } from './campaign-repository.js';
import { ItemRepository } from './conversation-item-clock-repository.js';
import {
  parseJson,
  requireBoolean,
  requireEnum,
  requireNullableString,
  requireNumber,
  requireRecord,
  requireString,
} from './persistence-validation.js';
import type { SqliteRunResult, TransactionalSqliteDatabase } from './sqlite-port.js';
import { applyTurnCommit, type TurnCommit } from './turn-transaction.js';
import { WorldRepository } from './world-repository.js';
import { PlayerCharacterRepository } from './player-character-repository.js';
import { NpcRepository, TavernRepository } from './tavern-npc-repository.js';

const TERMINAL_STATUSES = ['COMMITTED', 'CANCELLED'] as const;
const SECRET_FIELD = /api.?key|authorization|bearer|access.?token|secret.?key/i;

export interface CreatePendingAiRequest {
  readonly id: AiRequestId;
  readonly campaignId: PendingAiRequest['campaignId'];
  readonly turnId: PendingAiRequest['turnId'];
  readonly idempotencyKey: IdempotencyKey;
  readonly task: string;
  readonly modelProfileId: PendingAiRequest['modelProfileId'];
  readonly input: JsonValue;
  readonly createdAt: IsoTimestamp;
}

export type IdempotentCommitResult = 'COMMITTED' | 'ALREADY_COMMITTED';

export interface NpcInitializationRecord {
  readonly profile: NpcProfile;
  readonly visitor: TemporaryVisitor | null;
  readonly knowledge: NpcKnowledge;
  readonly relationship: NpcRelationship;
}

export class IdempotencyConflictError extends PersistenceDataError {
  public constructor(key: IdempotencyKey) {
    super(`Idempotency key is already bound to another request: ${key}`);
    this.name = 'IdempotencyConflictError';
  }
}

export class AiRequestTransitionError extends PersistenceDataError {
  public constructor(id: AiRequestId, current: string, next: string) {
    super(`Illegal AI request transition for ${id}: ${current} -> ${next}`);
    this.name = 'AiRequestTransitionError';
  }
}

export class PendingAiRequestRepository {
  public constructor(private readonly database: TransactionalSqliteDatabase) {}

  public createOrGet(input: CreatePendingAiRequest): PendingAiRequest {
    validateJsonForStorage(input.input, 'input');
    requireNonEmpty(input.task, 'task');
    requireTurnCampaign(this.database, input.turnId, input.campaignId);
    const existing = this.getByIdempotencyKey(input.idempotencyKey);
    if (existing !== null) {
      if (!sameRequestIdentity(existing, input)) {
        throw new IdempotencyConflictError(input.idempotencyKey);
      }
      return existing;
    }
    this.database
      .prepare(
        `INSERT INTO pending_ai_requests (
           id, campaign_id, turn_id, idempotency_key, task, status,
           model_profile_id, input_json, context_json, attempt_count,
           last_error_json, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, 'CREATED', ?, ?, NULL, 0, NULL, ?, ?)`,
      )
      .run(
        input.id,
        input.campaignId,
        input.turnId,
        input.idempotencyKey,
        input.task,
        input.modelProfileId,
        JSON.stringify(input.input),
        input.createdAt,
        input.createdAt,
      );
    return this.require(input.id);
  }

  public get(id: AiRequestId): PendingAiRequest | null {
    const row = this.database.prepare('SELECT * FROM pending_ai_requests WHERE id = ?').get(id);
    return row === undefined ? null : mapRequest(row);
  }

  public getByIdempotencyKey(key: IdempotencyKey): PendingAiRequest | null {
    const row = this.database
      .prepare('SELECT * FROM pending_ai_requests WHERE idempotency_key = ?')
      .get(key);
    return row === undefined ? null : mapRequest(row);
  }

  public listUnfinished(campaign: PendingAiRequest['campaignId']): readonly PendingAiRequest[] {
    return Object.freeze(
      this.database
        .prepare(
          `SELECT * FROM pending_ai_requests
           WHERE campaign_id = ? AND status NOT IN ('COMMITTED', 'CANCELLED')
           ORDER BY created_at, id`,
        )
        .all(campaign)
        .map(mapRequest),
    );
  }

  public setContext(id: AiRequestId, context: JsonValue, at: IsoTimestamp): PendingAiRequest {
    validateJsonForStorage(context, 'context');
    return this.transition(
      id,
      ['CREATED'],
      'CONTEXT_READY',
      'context_json = ?, last_error_json = NULL',
      [JSON.stringify(context)],
      at,
    );
  }

  public retryWithContext(id: AiRequestId, context: JsonValue, at: IsoTimestamp): PendingAiRequest {
    const current = this.require(id);
    if (current.status !== 'FAILED' || current.lastError?.retryable !== true) {
      throw new AiRequestTransitionError(id, current.status, 'CONTEXT_READY');
    }
    validateJsonForStorage(context, 'context');
    return this.transition(
      id,
      ['FAILED'],
      'CONTEXT_READY',
      'context_json = ?, last_error_json = NULL',
      [JSON.stringify(context)],
      at,
    );
  }

  public startAttempt(id: AiRequestId, at: IsoTimestamp): PendingAiRequest {
    return this.transition(
      id,
      ['CONTEXT_READY'],
      'SENDING',
      'attempt_count = attempt_count + 1',
      [],
      at,
    );
  }

  public markReceived(id: AiRequestId, at: IsoTimestamp): PendingAiRequest {
    return this.transition(id, ['SENDING'], 'RECEIVED', '', [], at);
  }

  public markValidating(id: AiRequestId, at: IsoTimestamp): PendingAiRequest {
    return this.transition(id, ['RECEIVED'], 'VALIDATING', '', [], at);
  }

  public fail(id: AiRequestId, error: AiRequestError, at: IsoTimestamp): PendingAiRequest {
    validateError(error);
    const current = this.require(id);
    if ((TERMINAL_STATUSES as readonly string[]).includes(current.status)) {
      throw new AiRequestTransitionError(id, current.status, 'FAILED');
    }
    return this.transition(
      id,
      [current.status],
      'FAILED',
      'last_error_json = ?',
      [JSON.stringify(error)],
      at,
    );
  }

  public cancel(id: AiRequestId, at: IsoTimestamp): PendingAiRequest {
    const current = this.require(id);
    if ((TERMINAL_STATUSES as readonly string[]).includes(current.status)) {
      throw new AiRequestTransitionError(id, current.status, 'CANCELLED');
    }
    return this.transition(id, [current.status], 'CANCELLED', '', [], at);
  }

  public commitTurnOnce(
    key: IdempotencyKey,
    command: TurnCommit,
    at: IsoTimestamp,
  ): IdempotentCommitResult {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const request = this.getByIdempotencyKey(key);
      if (request === null) {
        throw new PersistenceDataError(`Pending AI request not found for idempotency key: ${key}`);
      }
      if (request.status === 'COMMITTED') {
        this.database.exec('COMMIT');
        return 'ALREADY_COMMITTED';
      }
      if (request.status !== 'VALIDATING') {
        throw new AiRequestTransitionError(request.id, request.status, 'COMMITTED');
      }
      if (
        request.campaignId !== command.campaignId ||
        request.turnId === null ||
        request.turnId !== command.turn.id
      ) {
        throw new PersistenceDataError('Pending AI request does not match the turn commit');
      }

      applyTurnCommit(this.database, command);
      one(
        this.database
          .prepare(
            `UPDATE pending_ai_requests
             SET status = 'COMMITTED', last_error_json = NULL, updated_at = ?
             WHERE id = ? AND status = 'VALIDATING'`,
          )
          .run(at, request.id),
        `Pending AI request changed during commit: ${request.id}`,
      );
      this.database.exec('COMMIT');
      return 'COMMITTED';
    } catch (error) {
      try {
        this.database.exec('ROLLBACK');
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          'AI request commit and rollback both failed',
          { cause: rollbackError },
        );
      }
      throw error;
    }
  }

  public commitWorldOnce(
    key: IdempotencyKey,
    campaign: Campaign,
    world: WorldBible,
    at: IsoTimestamp,
  ): IdempotentCommitResult {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const request = this.getByIdempotencyKey(key);
      if (request === null) {
        throw new PersistenceDataError(`Pending AI request not found for idempotency key: ${key}`);
      }
      if (request.status === 'COMMITTED') {
        this.database.exec('COMMIT');
        return 'ALREADY_COMMITTED';
      }
      if (request.status !== 'VALIDATING') {
        throw new AiRequestTransitionError(request.id, request.status, 'COMMITTED');
      }
      if (
        request.turnId !== null ||
        request.campaignId !== campaign.id ||
        world.campaignId !== campaign.id
      ) {
        throw new PersistenceDataError('Pending AI request does not match the world commit');
      }
      new WorldRepository(this.database).saveBible(world);
      new CampaignRepository(this.database).update(campaign);
      one(
        this.database
          .prepare(
            `UPDATE pending_ai_requests
             SET status = 'COMMITTED', last_error_json = NULL, updated_at = ?
             WHERE id = ? AND status = 'VALIDATING'`,
          )
          .run(at, request.id),
        `Pending AI request changed during commit: ${request.id}`,
      );
      this.database.exec('COMMIT');
      return 'COMMITTED';
    } catch (error) {
      try {
        this.database.exec('ROLLBACK');
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          'AI world commit and rollback both failed',
          { cause: rollbackError },
        );
      }
      throw error;
    }
  }

  public commitContentOnce(
    key: IdempotencyKey,
    campaign: Campaign['id'],
    at: IsoTimestamp,
  ): IdempotentCommitResult {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const request = this.requireValidatingRequest(key, campaign);
      if (request === null) {
        this.database.exec('COMMIT');
        return 'ALREADY_COMMITTED';
      }
      this.markCommitted(request.id, at);
      this.database.exec('COMMIT');
      return 'COMMITTED';
    } catch (error) {
      this.rollback(error, 'AI content commit and rollback both failed');
    }
  }

  public commitCharacterOnce(
    key: IdempotencyKey,
    campaign: Campaign,
    character: PlayerCharacter,
    items: readonly Item[],
    at: IsoTimestamp,
  ): IdempotentCommitResult {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const request = this.requireValidatingRequest(key, campaign.id);
      if (request === null) {
        this.database.exec('COMMIT');
        return 'ALREADY_COMMITTED';
      }
      if (
        character.campaignId !== campaign.id ||
        items.some(({ campaignId }) => campaignId !== campaign.id) ||
        character.initialEquipment.some(
          ({ itemId }) => !items.some((candidate) => candidate.id === itemId),
        )
      ) {
        throw new PersistenceDataError('Character commit contains mismatched campaign or items');
      }
      new PlayerCharacterRepository(this.database).create(character);
      const itemRepository = new ItemRepository(this.database);
      for (const item of items) itemRepository.create(item, character.id);
      new CampaignRepository(this.database).update(campaign);
      this.markCommitted(request.id, at);
      this.database.exec('COMMIT');
      return 'COMMITTED';
    } catch (error) {
      this.rollback(error, 'AI character commit and rollback both failed');
    }
  }

  public commitTavernOnce(
    key: IdempotencyKey,
    campaign: Campaign['id'],
    tavern: Tavern,
    owner: NpcInitializationRecord,
    at: IsoTimestamp,
  ): IdempotentCommitResult {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const request = this.requireValidatingRequest(key, campaign);
      if (request === null) {
        this.database.exec('COMMIT');
        return 'ALREADY_COMMITTED';
      }
      if (
        tavern.campaignId !== campaign ||
        tavern.ownerNpcId !== owner.profile.id ||
        owner.profile.campaignId !== campaign ||
        owner.profile.tavernId !== tavern.id ||
        owner.profile.residency !== 'OWNER' ||
        owner.visitor !== null ||
        owner.knowledge.npcId !== owner.profile.id ||
        owner.relationship.npcId !== owner.profile.id
      ) {
        throw new PersistenceDataError('Tavern owner commit contains mismatched records');
      }
      const taverns = new TavernRepository(this.database);
      const npcs = new NpcRepository(this.database);
      taverns.create(tavern);
      npcs.create(owner.profile);
      taverns.assignOwner(tavern.id, owner.profile.id);
      npcs.saveKnowledge(owner.knowledge, at);
      npcs.saveRelationship(owner.relationship, at);
      this.markCommitted(request.id, at);
      this.database.exec('COMMIT');
      return 'COMMITTED';
    } catch (error) {
      this.rollback(error, 'AI tavern commit and rollback both failed');
    }
  }

  public commitNpcRosterOnce(
    key: IdempotencyKey,
    campaign: Campaign,
    tavern: Tavern['id'],
    records: readonly NpcInitializationRecord[],
    rumors: readonly WorldFact[],
    at: IsoTimestamp,
  ): IdempotentCommitResult {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const request = this.requireValidatingRequest(key, campaign.id);
      if (request === null) {
        this.database.exec('COMMIT');
        return 'ALREADY_COMMITTED';
      }
      if (
        records.some(
          ({ profile, visitor, knowledge, relationship }) =>
            profile.campaignId !== campaign.id ||
            profile.tavernId !== tavern ||
            profile.residency === 'OWNER' ||
            knowledge.npcId !== profile.id ||
            relationship.npcId !== profile.id ||
            (visitor !== null && (visitor.npcId !== profile.id || visitor.tavernId !== tavern)),
        ) ||
        rumors.some((fact) => fact.campaignId !== campaign.id || fact.kind !== 'RUMOR')
      ) {
        throw new PersistenceDataError('NPC roster commit contains mismatched records');
      }
      const npcs = new NpcRepository(this.database);
      for (const record of records) {
        npcs.create(record.profile, record.visitor);
        npcs.saveKnowledge(record.knowledge, at);
        npcs.saveRelationship(record.relationship, at);
      }
      const worlds = new WorldRepository(this.database);
      for (const rumor of rumors) worlds.addFact(rumor);
      new CampaignRepository(this.database).update(campaign);
      this.markCommitted(request.id, at);
      this.database.exec('COMMIT');
      return 'COMMITTED';
    } catch (error) {
      this.rollback(error, 'AI NPC roster commit and rollback both failed');
    }
  }

  private requireValidatingRequest(
    key: IdempotencyKey,
    campaign: Campaign['id'],
  ): PendingAiRequest | null {
    const request = this.getByIdempotencyKey(key);
    if (request === null) {
      throw new PersistenceDataError(`Pending AI request not found for idempotency key: ${key}`);
    }
    if (request.status === 'COMMITTED') return null;
    if (request.status !== 'VALIDATING') {
      throw new AiRequestTransitionError(request.id, request.status, 'COMMITTED');
    }
    if (request.turnId !== null || request.campaignId !== campaign) {
      throw new PersistenceDataError('Pending AI request does not match the content commit');
    }
    return request;
  }

  private markCommitted(id: AiRequestId, at: IsoTimestamp): void {
    one(
      this.database
        .prepare(
          `UPDATE pending_ai_requests
           SET status = 'COMMITTED', last_error_json = NULL, updated_at = ?
           WHERE id = ? AND status = 'VALIDATING'`,
        )
        .run(at, id),
      `Pending AI request changed during commit: ${id}`,
    );
  }

  private rollback(error: unknown, message: string): never {
    try {
      this.database.exec('ROLLBACK');
    } catch (rollbackError) {
      throw new AggregateError([error, rollbackError], message, { cause: rollbackError });
    }
    throw error;
  }

  private require(id: AiRequestId): PendingAiRequest {
    const request = this.get(id);
    if (request === null) throw new PersistenceDataError(`Pending AI request not found: ${id}`);
    return request;
  }

  private transition(
    id: AiRequestId,
    allowed: readonly PendingAiRequest['status'][],
    next: PendingAiRequest['status'],
    assignment: string,
    values: readonly (string | number | null)[],
    at: IsoTimestamp,
  ): PendingAiRequest {
    const current = this.require(id);
    if (!allowed.includes(current.status)) {
      throw new AiRequestTransitionError(id, current.status, next);
    }
    const extra = assignment.length === 0 ? '' : `${assignment}, `;
    one(
      this.database
        .prepare(
          `UPDATE pending_ai_requests
           SET ${extra}status = ?, updated_at = ?
           WHERE id = ? AND status = ?`,
        )
        .run(...values, next, at, id, current.status),
      `Pending AI request changed during transition: ${id}`,
    );
    return this.require(id);
  }
}

function mapRequest(value: unknown): PendingAiRequest {
  const row = requireRecord(value, 'PendingAiRequest row');
  const turn = requireNullableString(row['turn_id'], 'turn_id');
  const model = requireNullableString(row['model_profile_id'], 'model_profile_id');
  const context = row['context_json'];
  const error = row['last_error_json'];
  const request = Object.freeze({
    id: aiRequestId(requireString(row['id'], 'id')),
    campaignId: campaignId(requireString(row['campaign_id'], 'campaign_id')),
    turnId: turn === null ? null : turnId(turn),
    idempotencyKey: idempotencyKey(requireString(row['idempotency_key'], 'idempotency_key')),
    task: requireNonEmpty(row['task'], 'task'),
    status: requireEnum(AI_REQUEST_STATUSES, row['status'], 'status'),
    modelProfileId: model === null ? null : modelProfileId(model),
    input: parseStoredJson(row['input_json'], 'input_json'),
    context: context === null ? null : parseStoredJson(context, 'context_json'),
    attemptCount: requireAttemptCount(row['attempt_count']),
    lastError: error === null ? null : parseError(parseJson(error, 'last_error_json')),
    createdAt: isoTimestamp(requireString(row['created_at'], 'created_at')),
    updatedAt: isoTimestamp(requireString(row['updated_at'], 'updated_at')),
  });
  return request;
}

function sameRequestIdentity(existing: PendingAiRequest, input: CreatePendingAiRequest): boolean {
  return (
    existing.id === input.id &&
    existing.campaignId === input.campaignId &&
    existing.turnId === input.turnId &&
    existing.task === input.task &&
    existing.modelProfileId === input.modelProfileId &&
    canonicalJson(existing.input) === canonicalJson(input.input)
  );
}

function parseStoredJson(value: unknown, label: string): JsonValue {
  const parsed = parseJson(value, label);
  validateJsonForStorage(parsed, label);
  return freezeJson(parsed);
}

function validateJsonForStorage(value: unknown, label: string): asserts value is JsonValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => validateJsonForStorage(entry, `${label}[${index}]`));
    return;
  }
  if (typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new PersistenceDataError(`${label} must be a plain JSON object`);
    }
    for (const [key, entry] of Object.entries(value)) {
      if (SECRET_FIELD.test(key)) {
        throw new PersistenceDataError(`${label} contains forbidden credential field: ${key}`);
      }
      validateJsonForStorage(entry, `${label}.${key}`);
    }
    return;
  }
  throw new PersistenceDataError(`${label} must contain only JSON values`);
}

function canonicalJson(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isJsonObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key] ?? null)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function isJsonObject(value: JsonValue): value is { readonly [key: string]: JsonValue } {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function freezeJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return Object.freeze(value.map(freezeJson));
  if (value !== null && typeof value === 'object') {
    return Object.freeze(
      Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, freezeJson(entry)])),
    );
  }
  return value;
}

function validateError(error: AiRequestError): void {
  requireNonEmpty(error.code, 'error.code');
  requireNonEmpty(error.message, 'error.message');
  requireBoolean(error.retryable, 'error.retryable');
  validateJsonForStorage(error, 'error');
}

function parseError(value: unknown): AiRequestError {
  const error = requireRecord(value, 'AiRequestError');
  const result = Object.freeze({
    code: requireNonEmpty(error['code'], 'error.code'),
    message: requireNonEmpty(error['message'], 'error.message'),
    retryable: requireBoolean(error['retryable'], 'error.retryable'),
  });
  validateError(result);
  return result;
}

function requireNonEmpty(value: unknown, label: string): string {
  const text = requireString(value, label);
  if (text.length === 0 || text.trim() !== text) {
    throw new PersistenceDataError(`${label} must be non-empty canonical text`);
  }
  return text;
}

function requireAttemptCount(value: unknown): number {
  const count = requireNumber(value, 'attempt_count');
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new PersistenceDataError('attempt_count must be a non-negative safe integer');
  }
  return count;
}

function one(result: SqliteRunResult, message: string): void {
  if (result.changes !== 1 && result.changes !== 1n) {
    throw new PersistenceDataError(message);
  }
}

function requireTurnCampaign(
  database: TransactionalSqliteDatabase,
  requestTurnId: PendingAiRequest['turnId'],
  requestCampaignId: PendingAiRequest['campaignId'],
): void {
  if (requestTurnId === null) return;
  const row = database
    .prepare(
      `SELECT adventures.campaign_id
       FROM adventure_turns
       JOIN adventures ON adventures.id = adventure_turns.adventure_id
       WHERE adventure_turns.id = ?`,
    )
    .get(requestTurnId);
  if (
    row === undefined ||
    requireString(
      requireRecord(row, 'Pending request turn campaign row')['campaign_id'],
      'campaign_id',
    ) !== requestCampaignId
  ) {
    throw new PersistenceDataError('Pending AI request turn belongs to another campaign');
  }
}

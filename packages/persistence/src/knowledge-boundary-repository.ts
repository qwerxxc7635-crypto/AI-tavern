import {
  KNOWLEDGE_ACTOR_TYPES,
  KNOWLEDGE_PROVENANCE_KINDS,
  KNOWLEDGE_STATES,
  KNOWLEDGE_VISIBILITIES,
  TRUTH_AUTHORITIES,
  TRUTH_VISIBILITIES,
  aiOperationId,
  campaignId,
  claimId,
  createClaim,
  createKnowledge,
  createMemory,
  createWorldTruth,
  eventLedgerId,
  gameEventId,
  isoTimestamp,
  knowledgeId,
  memoryId,
  worldTruthId,
  type AiOperationId,
  type CampaignId,
  type Claim,
  type EventLedgerEntry,
  type EventLedgerId,
  type JsonValue,
  type Knowledge,
  type KnowledgeActor,
  type KnowledgeId,
  type LedgerSource,
  type Memory,
  type WorldTruth,
} from '@ember-tavern/contracts';
import { projectActorKnowledge, type ActorKnowledgeProjection } from '@ember-tavern/domain';

import { PersistenceDataError } from './campaign-repository.js';
import { EventLedgerRepository } from './event-ledger-repository.js';
import {
  parseJson,
  requireArray,
  requireEnum,
  requireNullableString,
  requireNumber,
  requireRecord,
  requireString,
} from './persistence-validation.js';
import type { TransactionalSqliteDatabase } from './sqlite-port.js';

const MAX_ACTOR_KNOWLEDGE = 256;
const MAX_ACTOR_MEMORIES = 128;

export interface KnowledgeMutationIdentity {
  readonly operationId: AiOperationId;
  readonly ledgerId: EventLedgerId;
  readonly source: LedgerSource;
}

export interface SaveKnowledgeOnceInput extends KnowledgeMutationIdentity {
  readonly knowledge: Knowledge;
  readonly expectedRevision: number;
  readonly updatedAt: ReturnType<typeof isoTimestamp>;
}

export interface ForgetKnowledgeOnceInput extends KnowledgeMutationIdentity {
  readonly campaignId: CampaignId;
  readonly knowledgeId: KnowledgeId;
  readonly expectedRevision: number;
}

export interface KnowledgeCommitReceipt {
  readonly status: 'COMMITTED' | 'ALREADY_COMMITTED';
  readonly action: 'LEARN' | 'UPDATE' | 'FORGET';
  readonly knowledge: Knowledge | null;
  readonly revision: number;
  readonly ledger: EventLedgerEntry;
}

export class KnowledgeBoundaryRepository {
  private readonly ledger: EventLedgerRepository;

  public constructor(private readonly database: TransactionalSqliteDatabase) {
    this.ledger = new EventLedgerRepository(database);
  }

  public saveWorldTruth(truth: WorldTruth, expectedRevision: number): WorldTruth {
    const canonical = createWorldTruth(truth);
    requireExpectedRevision(expectedRevision);
    if (canonical.revision !== expectedRevision + 1) {
      throw new PersistenceDataError('World Truth revision does not follow expected revision');
    }
    return this.inTransaction(() => {
      const current = this.getWorldTruth(canonical.id);
      requireScopeRevision(current, canonical.campaignId, expectedRevision, 'World Truth');
      if (current === null) {
        this.database
          .prepare(
            `INSERT INTO world_truths (
               id, campaign_id, subject, predicate, object_json, authority, visibility,
               source_event_id, revision, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            canonical.id,
            canonical.campaignId,
            canonical.subject,
            canonical.predicate,
            json(canonical.object),
            canonical.authority,
            canonical.visibility,
            canonical.sourceEventId,
            canonical.revision,
            canonical.createdAt,
            canonical.createdAt,
          );
      } else {
        this.database
          .prepare(
            `UPDATE world_truths SET
               subject = ?, predicate = ?, object_json = ?, authority = ?, visibility = ?,
               source_event_id = ?, revision = ?, updated_at = ?
             WHERE id = ?`,
          )
          .run(
            canonical.subject,
            canonical.predicate,
            json(canonical.object),
            canonical.authority,
            canonical.visibility,
            canonical.sourceEventId,
            canonical.revision,
            canonical.createdAt,
            canonical.id,
          );
      }
      return this.requireWorldTruth(canonical.id);
    });
  }

  public getWorldTruth(id: WorldTruth['id']): WorldTruth | null {
    const row = this.database.prepare('SELECT * FROM world_truths WHERE id = ?').get(id);
    return row === undefined ? null : mapWorldTruth(row);
  }

  public requireWorldTruth(id: WorldTruth['id']): WorldTruth {
    const truth = this.getWorldTruth(id);
    if (truth === null) throw new PersistenceDataError(`World Truth not found: ${id}`);
    return truth;
  }

  public saveClaim(claim: Claim, expectedRevision: number): Claim {
    const canonical = createClaim(claim);
    requireExpectedRevision(expectedRevision);
    if (canonical.revision !== expectedRevision + 1) {
      throw new PersistenceDataError('Claim revision does not follow expected revision');
    }
    return this.inTransaction(() => {
      const current = this.getClaim(canonical.id);
      requireScopeRevision(current, canonical.campaignId, expectedRevision, 'Claim');
      const source = claimSourceColumns(canonical);
      if (current === null) {
        this.database
          .prepare(
            `INSERT INTO knowledge_claims (
               id, campaign_id, subject, predicate, object_json, source_kind,
               source_truth_id, source_event_id, source_actor_type, source_actor_id,
               confidence, revision, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            canonical.id,
            canonical.campaignId,
            canonical.subject,
            canonical.predicate,
            json(canonical.object),
            ...source,
            canonical.confidence,
            canonical.revision,
            canonical.createdAt,
            canonical.createdAt,
          );
      } else {
        this.database
          .prepare(
            `UPDATE knowledge_claims SET
               subject = ?, predicate = ?, object_json = ?, source_kind = ?,
               source_truth_id = ?, source_event_id = ?, source_actor_type = ?,
               source_actor_id = ?, confidence = ?, revision = ?, updated_at = ?
             WHERE id = ?`,
          )
          .run(
            canonical.subject,
            canonical.predicate,
            json(canonical.object),
            ...source,
            canonical.confidence,
            canonical.revision,
            canonical.createdAt,
            canonical.id,
          );
      }
      return this.requireClaim(canonical.id);
    });
  }

  public getClaim(id: Claim['id']): Claim | null {
    const row = this.database.prepare('SELECT * FROM knowledge_claims WHERE id = ?').get(id);
    return row === undefined ? null : mapClaim(row);
  }

  public requireClaim(id: Claim['id']): Claim {
    const claim = this.getClaim(id);
    if (claim === null) throw new PersistenceDataError(`Claim not found: ${id}`);
    return claim;
  }

  public saveKnowledgeOnce(input: SaveKnowledgeOnceInput): KnowledgeCommitReceipt {
    const canonical = createKnowledge(input.knowledge);
    requireExpectedRevision(input.expectedRevision);
    const action = input.expectedRevision === 0 ? 'LEARN' : 'UPDATE';
    if (canonical.revision !== input.expectedRevision + 1) {
      throw new PersistenceDataError('Knowledge revision does not follow expected revision');
    }
    return this.inTransaction(() => {
      const replay = this.findReplay(input.operationId);
      if (replay !== null) return replayKnowledge(replay, action, canonical);
      const current = this.getKnowledge(canonical.id);
      requireScopeRevision(current, canonical.campaignId, input.expectedRevision, 'Knowledge');
      if (current === null) this.insertKnowledge(canonical, input.updatedAt);
      else this.updateKnowledge(canonical, input.updatedAt);
      const ledger = this.ledger.append({
        id: input.ledgerId,
        campaignId: canonical.campaignId,
        eventType: 'KNOWLEDGE_COMMITTED',
        operationId: input.operationId,
        aggregateType: 'KNOWLEDGE',
        aggregateId: canonical.id,
        revision: canonical.revision,
        payload: jsonValue({ action, knowledge: canonical }),
        payloadVersion: 1,
        source: input.source,
      });
      return Object.freeze({
        status: 'COMMITTED',
        action,
        knowledge: this.requireKnowledge(canonical.id),
        revision: canonical.revision,
        ledger,
      });
    });
  }

  public forgetKnowledgeOnce(input: ForgetKnowledgeOnceInput): KnowledgeCommitReceipt {
    requireExpectedRevision(input.expectedRevision);
    if (input.expectedRevision < 1) {
      throw new PersistenceDataError('Forgetting Knowledge requires an existing revision');
    }
    return this.inTransaction(() => {
      const replay = this.findReplay(input.operationId);
      if (replay !== null) return replayForget(replay, input);
      const current = this.getKnowledge(input.knowledgeId);
      requireScopeRevision(current, input.campaignId, input.expectedRevision, 'Knowledge');
      if (current === null) throw new PersistenceDataError('Knowledge not found for forget');
      this.database.prepare('DELETE FROM actor_knowledge WHERE id = ?').run(input.knowledgeId);
      const revision = input.expectedRevision + 1;
      const ledger = this.ledger.append({
        id: input.ledgerId,
        campaignId: input.campaignId,
        eventType: 'KNOWLEDGE_COMMITTED',
        operationId: input.operationId,
        aggregateType: 'KNOWLEDGE',
        aggregateId: input.knowledgeId,
        revision,
        payload: { action: 'FORGET', knowledgeId: input.knowledgeId },
        payloadVersion: 1,
        source: input.source,
      });
      return Object.freeze({
        status: 'COMMITTED',
        action: 'FORGET',
        knowledge: null,
        revision,
        ledger,
      });
    });
  }

  public getKnowledge(id: KnowledgeId): Knowledge | null {
    const row = this.database.prepare('SELECT * FROM actor_knowledge WHERE id = ?').get(id);
    return row === undefined ? null : mapKnowledge(row);
  }

  public requireKnowledge(id: KnowledgeId): Knowledge {
    const knowledge = this.getKnowledge(id);
    if (knowledge === null) throw new PersistenceDataError(`Knowledge not found: ${id}`);
    return knowledge;
  }

  public listActorKnowledge(campaign: CampaignId, actor: KnowledgeActor): readonly Knowledge[] {
    const rows = this.database
      .prepare(
        `SELECT * FROM actor_knowledge
         WHERE campaign_id = ? AND actor_type = ? AND actor_id = ?
         ORDER BY id LIMIT ?`,
      )
      .all(campaign, actor.type, actor.id, MAX_ACTOR_KNOWLEDGE + 1);
    if (rows.length > MAX_ACTOR_KNOWLEDGE) {
      throw new PersistenceDataError('Actor Knowledge exceeds the projection limit');
    }
    return Object.freeze(rows.map(mapKnowledge));
  }

  public appendMemory(memory: Memory): Memory {
    const canonical = createMemory(memory);
    return this.inTransaction(() => {
      this.requireActor(canonical.campaignId, canonical.actor);
      for (const id of canonical.sourceKnowledgeIds) {
        const source = this.getKnowledge(id);
        if (
          source !== null &&
          (source.campaignId !== canonical.campaignId ||
            source.actor.type !== canonical.actor.type ||
            source.actor.id !== canonical.actor.id)
        ) {
          throw new PersistenceDataError('Memory cannot reference another actor Knowledge');
        }
      }
      this.database
        .prepare(
          `INSERT INTO knowledge_memories (
             id, campaign_id, actor_type, actor_id, summary,
             source_knowledge_ids_json, source_event_ids_json, revision, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          canonical.id,
          canonical.campaignId,
          canonical.actor.type,
          canonical.actor.id,
          canonical.summary,
          json(canonical.sourceKnowledgeIds),
          json(canonical.sourceEventIds),
          canonical.revision,
          canonical.createdAt,
        );
      return this.requireMemory(canonical.id);
    });
  }

  public requireMemory(id: Memory['id']): Memory {
    const row = this.database.prepare('SELECT * FROM knowledge_memories WHERE id = ?').get(id);
    if (row === undefined) throw new PersistenceDataError(`Memory not found: ${id}`);
    return mapMemory(row);
  }

  public listActorMemories(campaign: CampaignId, actor: KnowledgeActor): readonly Memory[] {
    const rows = this.database
      .prepare(
        `SELECT * FROM knowledge_memories
         WHERE campaign_id = ? AND actor_type = ? AND actor_id = ?
         ORDER BY created_at, id LIMIT ?`,
      )
      .all(campaign, actor.type, actor.id, MAX_ACTOR_MEMORIES + 1);
    if (rows.length > MAX_ACTOR_MEMORIES) {
      throw new PersistenceDataError('Actor Memories exceed the projection limit');
    }
    return Object.freeze(rows.map(mapMemory));
  }

  public projectActor(campaign: CampaignId, actor: KnowledgeActor): ActorKnowledgeProjection {
    this.requireActor(campaign, actor);
    const knowledge = this.listActorKnowledge(campaign, actor);
    const truths = knowledge.flatMap(({ target }) =>
      target.kind === 'TRUTH' ? [this.requireWorldTruth(target.truthId)] : [],
    );
    const claims = knowledge.flatMap(({ target }) =>
      target.kind === 'CLAIM' ? [this.requireClaim(target.claimId)] : [],
    );
    return projectActorKnowledge({
      campaignId: campaign,
      actor,
      knowledge,
      truths,
      claims,
      memories: this.listActorMemories(campaign, actor),
    });
  }

  private insertKnowledge(knowledge: Knowledge, updatedAt: ReturnType<typeof isoTimestamp>): void {
    const target = knowledgeTargetColumns(knowledge);
    this.database
      .prepare(
        `INSERT INTO actor_knowledge (
           id, campaign_id, actor_type, actor_id, target_kind, truth_id, claim_id,
           knowledge_state, visibility, provenance_kind, provenance_source_id,
           provenance_event_id, learned_at, confidence, revision, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        knowledge.id,
        knowledge.campaignId,
        knowledge.actor.type,
        knowledge.actor.id,
        ...target,
        knowledge.state,
        knowledge.visibility,
        knowledge.provenance.kind,
        knowledge.provenance.sourceId,
        knowledge.provenance.eventId,
        knowledge.provenance.learnedAt,
        knowledge.provenance.confidence,
        knowledge.revision,
        updatedAt,
      );
  }

  private updateKnowledge(knowledge: Knowledge, updatedAt: ReturnType<typeof isoTimestamp>): void {
    this.database
      .prepare(
        `UPDATE actor_knowledge SET
           knowledge_state = ?, visibility = ?, provenance_kind = ?,
           provenance_source_id = ?, provenance_event_id = ?, learned_at = ?,
           confidence = ?, revision = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        knowledge.state,
        knowledge.visibility,
        knowledge.provenance.kind,
        knowledge.provenance.sourceId,
        knowledge.provenance.eventId,
        knowledge.provenance.learnedAt,
        knowledge.provenance.confidence,
        knowledge.revision,
        updatedAt,
        knowledge.id,
      );
  }

  private findReplay(operationId: AiOperationId): EventLedgerEntry | null {
    const row = this.database
      .prepare(
        `SELECT * FROM event_ledger
         WHERE operation_id = ? AND event_type = 'KNOWLEDGE_COMMITTED'
         ORDER BY occurred_at, id LIMIT 1`,
      )
      .get(operationId);
    return row === undefined ? null : mapLedger(row);
  }

  private requireActor(campaign: CampaignId, actor: KnowledgeActor): void {
    const row = this.database
      .prepare(
        actor.type === 'NPC'
          ? `SELECT 1 AS present FROM npcs WHERE id = ? AND campaign_id = ?
             UNION
             SELECT 1 AS present FROM npc_lod_profiles WHERE id = ? AND campaign_id = ?`
          : `SELECT 1 AS present FROM player_characters WHERE id = ? AND campaign_id = ?`,
      )
      .get(
        ...(actor.type === 'NPC' ? [actor.id, campaign, actor.id, campaign] : [actor.id, campaign]),
      );
    if (row === undefined)
      throw new PersistenceDataError('Knowledge actor is outside the campaign');
  }

  private inTransaction<Value>(run: () => Value): Value {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const value = run();
      this.database.exec('COMMIT');
      return value;
    } catch (error) {
      try {
        this.database.exec('ROLLBACK');
      } catch (rollbackError) {
        throw new PersistenceDataError('Knowledge transaction and rollback both failed', {
          cause: new AggregateError([error, rollbackError]),
        });
      }
      if (error instanceof PersistenceDataError) throw error;
      throw new PersistenceDataError('Knowledge transaction failed', { cause: error });
    }
  }
}

function replayKnowledge(
  ledger: EventLedgerEntry,
  action: 'LEARN' | 'UPDATE',
  expected: Knowledge,
): KnowledgeCommitReceipt {
  const payload = requireRecord(ledger.payload, 'Knowledge replay payload');
  if (payload['action'] !== action)
    throw new PersistenceDataError('Knowledge operation was reused');
  const knowledge = mapKnowledgePayload(payload['knowledge']);
  if (json(knowledge) !== json(expected)) {
    throw new PersistenceDataError('Knowledge operation payload conflicts with its first commit');
  }
  return Object.freeze({
    status: 'ALREADY_COMMITTED',
    action,
    knowledge,
    revision: knowledge.revision,
    ledger,
  });
}

function replayForget(
  ledger: EventLedgerEntry,
  input: ForgetKnowledgeOnceInput,
): KnowledgeCommitReceipt {
  const payload = requireRecord(ledger.payload, 'Knowledge replay payload');
  if (payload['action'] !== 'FORGET' || payload['knowledgeId'] !== input.knowledgeId) {
    throw new PersistenceDataError('Knowledge operation was reused');
  }
  return Object.freeze({
    status: 'ALREADY_COMMITTED',
    action: 'FORGET',
    knowledge: null,
    revision: ledger.revision,
    ledger,
  });
}

function requireScopeRevision(
  current: { readonly campaignId: CampaignId; readonly revision: number } | null,
  campaign: CampaignId,
  expectedRevision: number,
  label: string,
): void {
  if (current === null) {
    if (expectedRevision !== 0) throw new PersistenceDataError(`${label} revision drift`);
    return;
  }
  if (current.campaignId !== campaign) throw new PersistenceDataError(`${label} campaign mismatch`);
  if (current.revision !== expectedRevision)
    throw new PersistenceDataError(`${label} revision drift`);
}

function requireExpectedRevision(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new PersistenceDataError('Expected revision must be a non-negative safe integer');
  }
}

function claimSourceColumns(claim: Claim): readonly (string | null)[] {
  if (claim.source.kind === 'TRUTH') return ['TRUTH', claim.source.truthId, null, null, null];
  if (claim.source.kind === 'EVENT') return ['EVENT', null, claim.source.eventId, null, null];
  return ['ACTOR', null, null, claim.source.actorType, claim.source.actorId];
}

function knowledgeTargetColumns(knowledge: Knowledge): readonly (string | null)[] {
  return knowledge.target.kind === 'TRUTH'
    ? ['TRUTH', knowledge.target.truthId, null]
    : ['CLAIM', null, knowledge.target.claimId];
}

function mapWorldTruth(value: unknown): WorldTruth {
  const row = requireRecord(value, 'World Truth row');
  const event = requireNullableString(row['source_event_id'], 'source_event_id');
  return createWorldTruth({
    id: worldTruthId(requireString(row['id'], 'id')),
    campaignId: campaignId(requireString(row['campaign_id'], 'campaign_id')),
    subject: requireString(row['subject'], 'subject'),
    predicate: requireString(row['predicate'], 'predicate'),
    object: jsonValue(parseJson(row['object_json'], 'object_json')),
    authority: requireEnum(TRUTH_AUTHORITIES, row['authority'], 'authority'),
    visibility: requireEnum(TRUTH_VISIBILITIES, row['visibility'], 'visibility'),
    sourceEventId: event === null ? null : gameEventId(event),
    revision: positiveInteger(row['revision'], 'revision'),
    createdAt: isoTimestamp(requireString(row['created_at'], 'created_at')),
  });
}

function mapClaim(value: unknown): Claim {
  const row = requireRecord(value, 'Claim row');
  const kind = requireEnum(['TRUTH', 'EVENT', 'ACTOR'] as const, row['source_kind'], 'source_kind');
  const source =
    kind === 'TRUTH'
      ? { kind, truthId: worldTruthId(requireString(row['source_truth_id'], 'source_truth_id')) }
      : kind === 'EVENT'
        ? { kind, eventId: gameEventId(requireString(row['source_event_id'], 'source_event_id')) }
        : {
            kind,
            actorType: requireEnum(
              KNOWLEDGE_ACTOR_TYPES,
              row['source_actor_type'],
              'source_actor_type',
            ),
            actorId: requireString(row['source_actor_id'], 'source_actor_id'),
          };
  return createClaim({
    id: claimId(requireString(row['id'], 'id')),
    campaignId: campaignId(requireString(row['campaign_id'], 'campaign_id')),
    subject: requireString(row['subject'], 'subject'),
    predicate: requireString(row['predicate'], 'predicate'),
    object: jsonValue(parseJson(row['object_json'], 'object_json')),
    source,
    confidence: requireNumber(row['confidence'], 'confidence'),
    revision: positiveInteger(row['revision'], 'revision'),
    createdAt: isoTimestamp(requireString(row['created_at'], 'created_at')),
  });
}

function mapKnowledge(value: unknown): Knowledge {
  const row = requireRecord(value, 'Knowledge row');
  const targetKind = requireEnum(['TRUTH', 'CLAIM'] as const, row['target_kind'], 'target_kind');
  const event = requireNullableString(row['provenance_event_id'], 'provenance_event_id');
  return createKnowledge({
    id: knowledgeId(requireString(row['id'], 'id')),
    campaignId: campaignId(requireString(row['campaign_id'], 'campaign_id')),
    actor: {
      type: requireEnum(KNOWLEDGE_ACTOR_TYPES, row['actor_type'], 'actor_type'),
      id: requireString(row['actor_id'], 'actor_id'),
    },
    target:
      targetKind === 'TRUTH'
        ? { kind: targetKind, truthId: worldTruthId(requireString(row['truth_id'], 'truth_id')) }
        : { kind: targetKind, claimId: claimId(requireString(row['claim_id'], 'claim_id')) },
    state: requireEnum(KNOWLEDGE_STATES, row['knowledge_state'], 'knowledge_state'),
    visibility: requireEnum(KNOWLEDGE_VISIBILITIES, row['visibility'], 'visibility'),
    provenance: {
      kind: requireEnum(KNOWLEDGE_PROVENANCE_KINDS, row['provenance_kind'], 'provenance_kind'),
      sourceId: requireString(row['provenance_source_id'], 'provenance_source_id'),
      eventId: event === null ? null : gameEventId(event),
      learnedAt: isoTimestamp(requireString(row['learned_at'], 'learned_at')),
      confidence: requireNumber(row['confidence'], 'confidence'),
    },
    revision: positiveInteger(row['revision'], 'revision'),
  });
}

function mapMemory(value: unknown): Memory {
  const row = requireRecord(value, 'Knowledge Memory row');
  return createMemory({
    id: memoryId(requireString(row['id'], 'id')),
    campaignId: campaignId(requireString(row['campaign_id'], 'campaign_id')),
    actor: {
      type: requireEnum(KNOWLEDGE_ACTOR_TYPES, row['actor_type'], 'actor_type'),
      id: requireString(row['actor_id'], 'actor.id'),
    },
    summary: requireString(row['summary'], 'summary'),
    sourceKnowledgeIds: requireArray(
      parseJson(row['source_knowledge_ids_json'], 'source_knowledge_ids_json'),
      'source_knowledge_ids_json',
    ).map((id, index) => knowledgeId(requireString(id, `source_knowledge_ids_json[${index}]`))),
    sourceEventIds: requireArray(
      parseJson(row['source_event_ids_json'], 'source_event_ids_json'),
      'source_event_ids_json',
    ).map((id, index) => gameEventId(requireString(id, `source_event_ids_json[${index}]`))),
    revision: positiveInteger(row['revision'], 'revision'),
    createdAt: isoTimestamp(requireString(row['created_at'], 'created_at')),
  });
}

function mapKnowledgePayload(value: unknown): Knowledge {
  const row = requireRecord(value, 'Knowledge payload');
  const actor = requireRecord(row['actor'], 'Knowledge payload actor');
  const target = requireRecord(row['target'], 'Knowledge payload target');
  const provenance = requireRecord(row['provenance'], 'Knowledge payload provenance');
  const targetKind = requireEnum(['TRUTH', 'CLAIM'] as const, target['kind'], 'target.kind');
  const event = requireNullableString(provenance['eventId'], 'provenance.eventId');
  return createKnowledge({
    id: knowledgeId(requireString(row['id'], 'id')),
    campaignId: campaignId(requireString(row['campaignId'], 'campaignId')),
    actor: {
      type: requireEnum(KNOWLEDGE_ACTOR_TYPES, actor['type'], 'actor.type'),
      id: requireString(actor['id'], 'actor.id'),
    },
    target:
      targetKind === 'TRUTH'
        ? {
            kind: targetKind,
            truthId: worldTruthId(requireString(target['truthId'], 'target.truthId')),
          }
        : {
            kind: targetKind,
            claimId: claimId(requireString(target['claimId'], 'target.claimId')),
          },
    state: requireEnum(KNOWLEDGE_STATES, row['state'], 'state'),
    visibility: requireEnum(KNOWLEDGE_VISIBILITIES, row['visibility'], 'visibility'),
    provenance: {
      kind: requireEnum(KNOWLEDGE_PROVENANCE_KINDS, provenance['kind'], 'provenance.kind'),
      sourceId: requireString(provenance['sourceId'], 'provenance.sourceId'),
      eventId: event === null ? null : gameEventId(event),
      learnedAt: isoTimestamp(requireString(provenance['learnedAt'], 'provenance.learnedAt')),
      confidence: requireNumber(provenance['confidence'], 'provenance.confidence'),
    },
    revision: positiveInteger(row['revision'], 'revision'),
  });
}

function mapLedger(value: unknown): EventLedgerEntry {
  const row = requireRecord(value, 'Knowledge Ledger row');
  return Object.freeze({
    id: eventLedgerId(requireString(row['id'], 'id')),
    campaignId: campaignId(requireString(row['campaign_id'], 'campaign_id')),
    eventType: 'KNOWLEDGE_COMMITTED',
    operationId: aiOperationId(requireString(row['operation_id'], 'operation_id')),
    aggregateType: 'KNOWLEDGE',
    aggregateId: requireString(row['aggregate_id'], 'aggregate_id'),
    revision: positiveInteger(row['revision'], 'revision'),
    payload: jsonValue(parseJson(row['payload_json'], 'payload_json')),
    payloadVersion: positiveInteger(row['payload_version'], 'payload_version'),
    source: requireEnum(
      ['LOCAL_RULE', 'USER_ACCEPTANCE', 'IMPORT', 'SYSTEM'] as const,
      row['source'],
      'source',
    ),
    occurredAt: isoTimestamp(requireString(row['occurred_at'], 'occurred_at')),
  });
}

function positiveInteger(value: unknown, label: string): number {
  const number = requireNumber(value, label);
  if (!Number.isSafeInteger(number) || number < 1) {
    throw new PersistenceDataError(`${label} must be a positive safe integer`);
  }
  return number;
}

function json(value: unknown): string {
  return JSON.stringify(value);
}

function jsonValue(value: unknown): JsonValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return value;
  }
  if (Array.isArray(value)) return Object.freeze(value.map(jsonValue));
  if (typeof value === 'object') {
    return Object.freeze(
      Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, jsonValue(entry)])),
    );
  }
  throw new PersistenceDataError('Knowledge value is not JSON serializable');
}

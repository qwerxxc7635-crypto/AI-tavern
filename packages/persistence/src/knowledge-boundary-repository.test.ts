import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import {
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
} from '@ember-tavern/contracts';
import { describe, expect, it } from 'vitest';

import { applyMigrations } from './migrations.mjs';
import { KnowledgeBoundaryRepository } from './knowledge-boundary-repository.js';

const campaign = campaignId('campaign-knowledge-v3');
const otherCampaign = campaignId('campaign-knowledge-other');
const at = isoTimestamp('2026-08-14T12:00:00.000Z');
const later = isoTimestamp('2026-08-14T12:10:00.000Z');
const observed = gameEventId('event-knowledge-observed');

describe('KnowledgeBoundaryRepository', () => {
  it('keeps NPC and Player Knowledge independent through learn, update and forget', async () => {
    const database = await createDatabase();
    const repository = new KnowledgeBoundaryRepository(database);
    const truth = secretTruth();
    const claim = rumorClaim();
    repository.saveWorldTruth(truth, 0);
    repository.saveClaim(claim, 0);

    const npcKnowledge = knowledge(
      'knowledge-npc-secret',
      'NPC',
      'npc-one',
      { kind: 'TRUTH', truthId: truth.id },
      'KNOWN',
      1,
    );
    const playerKnowledge = knowledge(
      'knowledge-player-rumor',
      'PLAYER_CHARACTER',
      'player-one',
      { kind: 'CLAIM', claimId: claim.id },
      'SUSPECTED',
      1,
    );
    const learned = repository.saveKnowledgeOnce({
      knowledge: npcKnowledge,
      expectedRevision: 0,
      updatedAt: at,
      operationId: aiOperationId('knowledge-learn-npc'),
      ledgerId: eventLedgerId('ledger-knowledge-npc-1'),
      source: 'LOCAL_RULE',
    });
    const replay = repository.saveKnowledgeOnce({
      knowledge: npcKnowledge,
      expectedRevision: 0,
      updatedAt: at,
      operationId: aiOperationId('knowledge-learn-npc'),
      ledgerId: eventLedgerId('unused-replay-ledger'),
      source: 'LOCAL_RULE',
    });
    expect(learned.status).toBe('COMMITTED');
    expect(replay).toMatchObject({ status: 'ALREADY_COMMITTED', revision: 1 });
    repository.saveKnowledgeOnce({
      knowledge: playerKnowledge,
      expectedRevision: 0,
      updatedAt: at,
      operationId: aiOperationId('knowledge-learn-player'),
      ledgerId: eventLedgerId('ledger-knowledge-player-1'),
      source: 'USER_ACCEPTANCE',
    });

    const updated = createKnowledge({
      ...npcKnowledge,
      state: 'SUSPECTED',
      provenance: {
        kind: 'INFERENCE',
        sourceId: 'reasoning:event-knowledge-observed',
        eventId: observed,
        learnedAt: later,
        confidence: 0.6,
      },
      revision: 2,
    });
    repository.saveKnowledgeOnce({
      knowledge: updated,
      expectedRevision: 1,
      updatedAt: later,
      operationId: aiOperationId('knowledge-update-npc'),
      ledgerId: eventLedgerId('ledger-knowledge-npc-2'),
      source: 'LOCAL_RULE',
    });

    expect(repository.projectActor(campaign, { type: 'NPC', id: 'npc-one' }).entries).toEqual([
      expect.objectContaining({ targetKind: 'TRUTH', state: 'SUSPECTED', object: 'moonrise' }),
    ]);
    expect(
      repository.projectActor(campaign, { type: 'PLAYER_CHARACTER', id: 'player-one' }).entries,
    ).toEqual([expect.objectContaining({ targetKind: 'CLAIM', state: 'SUSPECTED', object: true })]);

    const forgotten = repository.forgetKnowledgeOnce({
      campaignId: campaign,
      knowledgeId: updated.id,
      expectedRevision: 2,
      operationId: aiOperationId('knowledge-forget-npc'),
      ledgerId: eventLedgerId('ledger-knowledge-npc-3'),
      source: 'LOCAL_RULE',
    });
    expect(forgotten).toMatchObject({ action: 'FORGET', revision: 3, knowledge: null });
    expect(
      repository.forgetKnowledgeOnce({
        campaignId: campaign,
        knowledgeId: updated.id,
        expectedRevision: 2,
        operationId: aiOperationId('knowledge-forget-npc'),
        ledgerId: eventLedgerId('unused-forget-replay'),
        source: 'LOCAL_RULE',
      }).status,
    ).toBe('ALREADY_COMMITTED');
    expect(repository.getKnowledge(updated.id)).toBeNull();
    expect(
      database
        .prepare(
          `SELECT revision FROM event_ledger
           WHERE aggregate_type = 'KNOWLEDGE' AND aggregate_id = ? ORDER BY revision`,
        )
        .all(updated.id),
    ).toEqual([{ revision: 1 }, { revision: 2 }, { revision: 3 }]);

    database.close();
  });

  it('persists projections and subjective memory on a durable database reopen', async () => {
    const directory = await mkdtemp(join(tmpdir(), `ember-knowledge-${randomUUID()}-`));
    const path = join(directory, 'knowledge.sqlite');
    let database: DatabaseSync | null = new DatabaseSync(path);
    try {
      await applyMigrations(database);
      seedActors(database);
      let repository = new KnowledgeBoundaryRepository(database);
      const truth = secretTruth();
      repository.saveWorldTruth(truth, 0);
      const foreignEventTruth = createWorldTruth({
        ...truth,
        id: worldTruthId('truth-foreign-event'),
        campaignId: otherCampaign,
      });
      expect(() => repository.saveWorldTruth(foreignEventTruth, 0)).toThrow('transaction failed');
      expect(repository.getWorldTruth(foreignEventTruth.id)).toBeNull();
      const invalidClaim = createClaim({
        ...rumorClaim(),
        id: claimId('claim-missing-source-actor'),
        source: { kind: 'ACTOR', actorType: 'NPC', actorId: 'npc-missing' },
      });
      expect(() => repository.saveClaim(invalidClaim, 0)).toThrow('transaction failed');
      expect(repository.getClaim(invalidClaim.id)).toBeNull();
      const entry = knowledge(
        'knowledge-durable',
        'NPC',
        'npc-one',
        { kind: 'TRUTH', truthId: truth.id },
        'KNOWN',
        1,
      );
      repository.saveKnowledgeOnce({
        knowledge: entry,
        expectedRevision: 0,
        updatedAt: at,
        operationId: aiOperationId('knowledge-durable-learn'),
        ledgerId: eventLedgerId('ledger-knowledge-durable'),
        source: 'LOCAL_RULE',
      });
      repository.appendMemory(
        createMemory({
          id: memoryId('memory-durable'),
          campaignId: campaign,
          actor: entry.actor,
          summary: 'The innkeeper remembers seeing the sealed route open.',
          sourceKnowledgeIds: [entry.id],
          sourceEventIds: [],
          revision: 1,
          createdAt: at,
        }),
      );
      database.close();
      database = null;
      database = new DatabaseSync(path);
      repository = new KnowledgeBoundaryRepository(database);
      expect(repository.projectActor(campaign, entry.actor)).toMatchObject({
        entries: [expect.objectContaining({ object: 'moonrise' })],
        memories: [expect.objectContaining({ summary: expect.stringContaining('sealed route') })],
      });
    } finally {
      database?.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('rejects cross-campaign actors, cross-actor memory and operation/ledger collisions atomically', async () => {
    const database = await createDatabase();
    const repository = new KnowledgeBoundaryRepository(database);
    const truth = secretTruth();
    repository.saveWorldTruth(truth, 0);
    const npcOne = knowledge(
      'knowledge-owner',
      'NPC',
      'npc-one',
      { kind: 'TRUTH', truthId: truth.id },
      'KNOWN',
      1,
    );
    repository.saveKnowledgeOnce({
      knowledge: npcOne,
      expectedRevision: 0,
      updatedAt: at,
      operationId: aiOperationId('knowledge-owner-learn'),
      ledgerId: eventLedgerId('ledger-collision'),
      source: 'LOCAL_RULE',
    });
    const invalidUpdate = createKnowledge({
      ...npcOne,
      provenance: {
        ...npcOne.provenance,
        sourceId: 'event-missing',
        eventId: gameEventId('event-missing'),
        learnedAt: later,
      },
      revision: 2,
    });
    expect(() =>
      repository.saveKnowledgeOnce({
        knowledge: invalidUpdate,
        expectedRevision: 1,
        updatedAt: later,
        operationId: aiOperationId('knowledge-invalid-provenance-update'),
        ledgerId: eventLedgerId('ledger-invalid-provenance-update'),
        source: 'LOCAL_RULE',
      }),
    ).toThrow('transaction failed');
    expect(repository.requireKnowledge(npcOne.id)).toMatchObject({ revision: 1 });
    expect(() =>
      repository.appendMemory(
        createMemory({
          id: memoryId('memory-cross-actor'),
          campaignId: campaign,
          actor: { type: 'NPC', id: 'npc-two' },
          summary: 'An invalid borrowed memory.',
          sourceKnowledgeIds: [npcOne.id],
          sourceEventIds: [],
          revision: 1,
          createdAt: at,
        }),
      ),
    ).toThrow('another actor');
    expect(() =>
      repository.appendMemory(
        createMemory({
          id: memoryId('memory-missing-event'),
          campaignId: campaign,
          actor: { type: 'NPC', id: 'npc-one' },
          summary: 'A memory cannot cite an unknown event.',
          sourceKnowledgeIds: [],
          sourceEventIds: [gameEventId('event-missing')],
          revision: 1,
          createdAt: at,
        }),
      ),
    ).toThrow('transaction failed');
    expect(() =>
      repository.appendMemory(
        createMemory({
          id: memoryId('memory-missing-knowledge'),
          campaignId: campaign,
          actor: { type: 'NPC', id: 'npc-one' },
          summary: 'A memory cannot cite Knowledge that does not exist.',
          sourceKnowledgeIds: [knowledgeId('knowledge-missing')],
          sourceEventIds: [],
          revision: 1,
          createdAt: at,
        }),
      ),
    ).toThrow('transaction failed');
    const second = knowledge(
      'knowledge-rollback',
      'NPC',
      'npc-two',
      { kind: 'TRUTH', truthId: truth.id },
      'KNOWN',
      1,
    );
    expect(() =>
      repository.saveKnowledgeOnce({
        knowledge: second,
        expectedRevision: 0,
        updatedAt: at,
        operationId: aiOperationId('knowledge-owner-learn'),
        ledgerId: eventLedgerId('ledger-operation-conflict'),
        source: 'LOCAL_RULE',
      }),
    ).toThrow('conflicts');
    expect(repository.getKnowledge(second.id)).toBeNull();
    expect(() =>
      repository.saveKnowledgeOnce({
        knowledge: second,
        expectedRevision: 0,
        updatedAt: at,
        operationId: aiOperationId('knowledge-second-learn'),
        ledgerId: eventLedgerId('ledger-collision'),
        source: 'LOCAL_RULE',
      }),
    ).toThrow();
    expect(repository.getKnowledge(second.id)).toBeNull();

    const foreign = createKnowledge({
      ...second,
      id: knowledgeId('knowledge-foreign'),
      campaignId: otherCampaign,
      actor: { type: 'NPC', id: 'npc-one' },
    });
    expect(() =>
      repository.saveKnowledgeOnce({
        knowledge: foreign,
        expectedRevision: 0,
        updatedAt: at,
        operationId: aiOperationId('knowledge-foreign-learn'),
        ledgerId: eventLedgerId('ledger-foreign'),
        source: 'LOCAL_RULE',
      }),
    ).toThrow();
    expect(repository.getKnowledge(foreign.id)).toBeNull();
    database.close();
  });
});

function secretTruth() {
  return createWorldTruth({
    id: worldTruthId('truth-sealed-route'),
    campaignId: campaign,
    subject: 'route:sealed',
    predicate: 'opens_at',
    object: 'moonrise',
    authority: 'DOMAIN_TRANSACTION',
    visibility: 'SECRET',
    sourceEventId: observed,
    revision: 1,
    createdAt: at,
  });
}

function rumorClaim() {
  return createClaim({
    id: claimId('claim-route-cursed'),
    campaignId: campaign,
    subject: 'route:sealed',
    predicate: 'is_cursed',
    object: true,
    source: { kind: 'ACTOR', actorType: 'NPC', actorId: 'npc-two' },
    confidence: 0.5,
    revision: 1,
    createdAt: at,
  });
}

function knowledge(
  id: string,
  actorType: 'NPC' | 'PLAYER_CHARACTER',
  actorId: string,
  target:
    | { readonly kind: 'TRUTH'; readonly truthId: ReturnType<typeof worldTruthId> }
    | { readonly kind: 'CLAIM'; readonly claimId: ReturnType<typeof claimId> },
  state: 'KNOWN' | 'SUSPECTED' | 'BELIEVED',
  revision: number,
) {
  return createKnowledge({
    id: knowledgeId(id),
    campaignId: campaign,
    actor: { type: actorType, id: actorId },
    target,
    state,
    visibility: 'ACTOR_PRIVATE',
    provenance: {
      kind: 'OBSERVATION',
      sourceId: observed,
      eventId: observed,
      learnedAt: at,
      confidence: 0.8,
    },
    revision,
  });
}

async function createDatabase(): Promise<DatabaseSync> {
  const database = new DatabaseSync(':memory:');
  await applyMigrations(database);
  seedActors(database);
  return database;
}

function seedActors(database: DatabaseSync): void {
  for (const id of [campaign, otherCampaign]) {
    database
      .prepare(
        `INSERT INTO campaigns (
           id, schema_version, state, task_model_overrides_json, model_switch_policy,
           created_at, updated_at
         ) VALUES (?, 1, 'CREATING_WORLD', '{}', 'ASK', ?, ?)`,
      )
      .run(id, at, at);
  }
  database
    .prepare(
      `INSERT INTO game_events (
         id, campaign_id, schema_version, type, payload_json, occurred_at
       ) VALUES (?, ?, 1, 'FACT_DISCOVERED', '{}', ?)`,
    )
    .run(observed, campaign, at);
  database
    .prepare(
      `INSERT INTO player_characters (
         id, campaign_id, name, gender, age, concept, story_preferences_json,
         content_boundaries_json, class_archetype, class_display_name, attributes_json,
         traits_json, personal_goal, background_json, initial_equipment_ids_json,
         created_at, updated_at
       ) VALUES (?, ?, 'Mira', NULL, NULL, 'Scout', '[]', '{}', 'ROGUE', 'Scout',
         '{"physique":2,"agility":4,"knowledge":3,"charisma":1}', '[]', 'Explore', '{}',
         '[]', ?, ?)`,
    )
    .run('player-one', campaign, at, at);
  database
    .prepare(
      `INSERT INTO taverns (
         id, campaign_id, location_id, name, position, environment,
         special_rules_json, long_term_problem, owner_npc_id, changes_json,
         created_at, updated_at
       ) VALUES ('tavern-one', ?, 'location-one', 'Ember Rest', 'Harbor', 'Warm',
         '[]', 'Sealed route', NULL, '[]', ?, ?)`,
    )
    .run(campaign, at, at);
  for (const id of ['npc-one', 'npc-two']) {
    database
      .prepare(
        `INSERT INTO npcs (
           id, campaign_id, tavern_id, residency, name, identity, appearance,
           personality, goal, secret, speech_style, current_mood, current_status,
           visit_json, memories_json, created_at, updated_at
         ) VALUES (?, ?, 'tavern-one', 'RESIDENT', ?, 'Keeper', 'Weathered',
           'Careful', 'Protect route', 'Private', 'Measured', 'Calm', 'ACTIVE',
           NULL, '[]', ?, ?)`,
      )
      .run(id, campaign, id, at, at);
  }
}

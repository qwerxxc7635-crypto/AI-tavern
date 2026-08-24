import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import {
  aiOperationId,
  campaignId,
  createHistoricalSummary,
  createKnowledge,
  createMemory,
  createWorldLoreEntry,
  createWorldTruth,
  eventLedgerId,
  gameEventId,
  generationRecordId,
  historicalSummaryId,
  isoTimestamp,
  knowledgeId,
  memoryId,
  schemaVersion,
  snapshotId,
  worldLoreEntryId,
  worldTruthId,
} from '@ember-tavern/contracts';
import { describe, expect, it } from 'vitest';

import { KnowledgeBoundaryRepository } from './knowledge-boundary-repository.js';
import { MemoryLayerRepository, memorySourceDigest } from './memory-layer-repository.js';
import { applyMigrations } from './migrations.mjs';
import { SnapshotRepository } from './snapshot-repository.js';

const campaign = campaignId('campaign-memory-layers');
const at = isoTimestamp('2026-08-24T08:00:00.000Z');
const later = isoTimestamp('2026-08-24T09:00:00.000Z');

describe('MemoryLayerRepository', () => {
  it('stores traceable Summary and World Lore without deleting Recent or promoting Truth', async () => {
    const database = await createDatabase();
    const repository = new MemoryLayerRepository(database);
    const summarySources = repository.captureSources(campaign, [
      { kind: 'GAME_EVENT', id: 'event-summary-source' },
      { kind: 'MESSAGE', id: 'message-summary-source' },
    ]);
    const summary = repository.saveSummary(
      createHistoricalSummary({
        id: historicalSummaryId('summary-harbor-night'),
        campaignId: campaign,
        scopeKind: 'CONVERSATION',
        scopeId: 'conversation-memory',
        actor: null,
        text: 'The keeper and player agreed to inspect the beacon.',
        sources: summarySources,
        sourceDigest: memorySourceDigest(summarySources),
        coveredFrom: at,
        coveredTo: later,
        generationRecordId: generationRecordId('generation-memory-summary'),
        revision: 1,
        createdAt: later,
        updatedAt: later,
      }),
      0,
    );
    const loreSources = repository.captureSources(campaign, [
      { kind: 'WORLD_FACT', id: 'fact-beacon-custom' },
    ]);
    const lore = repository.saveWorldLore(
      createWorldLoreEntry({
        id: worldLoreEntryId('lore-beacon-custom'),
        campaignId: campaign,
        title: 'Beacon Customs',
        text: 'Harbor keepers light the beacon before the storm tide.',
        sources: loreSources,
        sourceDigest: memorySourceDigest(loreSources),
        generationRecordId: generationRecordId('generation-memory-lore'),
        revision: 1,
        createdAt: later,
        updatedAt: later,
      }),
      0,
    );

    expect(repository.inspectSummary(summary.id).status).toBe('CURRENT');
    expect(repository.inspectWorldLore(lore.id).status).toBe('CURRENT');
    expect(summary.generationRecordId).toBe('generation-memory-summary');
    expect(lore.generationRecordId).toBe('generation-memory-lore');
    expect(database.prepare('SELECT COUNT(*) AS count FROM messages').get()).toEqual({ count: 1 });
    expect(database.prepare('SELECT COUNT(*) AS count FROM game_events').get()).toEqual({
      count: 2,
    });
    expect(database.prepare('SELECT COUNT(*) AS count FROM world_truths').get()).toEqual({
      count: 0,
    });
    database.close();
  });

  it('detects source update and deletion, then accepts an explicit revision rebuild', async () => {
    const database = await createDatabase();
    const repository = new MemoryLayerRepository(database);
    const initialSources = repository.captureSources(campaign, [
      { kind: 'GAME_EVENT', id: 'event-summary-source' },
    ]);
    const initial = repository.saveSummary(
      createHistoricalSummary({
        id: historicalSummaryId('summary-drift'),
        campaignId: campaign,
        scopeKind: 'CAMPAIGN',
        scopeId: campaign,
        actor: null,
        text: 'The beacon was dark.',
        sources: initialSources,
        sourceDigest: memorySourceDigest(initialSources),
        coveredFrom: at,
        coveredTo: at,
        generationRecordId: null,
        revision: 1,
        createdAt: at,
        updatedAt: at,
      }),
      0,
    );
    database
      .prepare(`UPDATE game_events SET payload_json='{"state":"lit"}' WHERE id=?`)
      .run('event-summary-source');
    expect(repository.inspectSummary(initial.id)).toMatchObject({
      status: 'STALE',
      reason: 'SOURCE_UPDATED',
    });
    expect(repository.listCurrentSummaries(campaign)).toEqual([]);
    expect(() =>
      repository.saveSummary(
        createHistoricalSummary({ ...initial, text: 'The beacon is now lit.', revision: 2 }),
        1,
      ),
    ).toThrow('source drift');

    const currentSources = repository.captureSources(campaign, [
      { kind: 'GAME_EVENT', id: 'event-summary-source' },
    ]);
    repository.saveSummary(
      createHistoricalSummary({
        ...initial,
        text: 'The beacon is now lit.',
        sources: currentSources,
        sourceDigest: memorySourceDigest(currentSources),
        revision: 2,
        updatedAt: later,
      }),
      1,
    );
    expect(repository.inspectSummary(initial.id).status).toBe('CURRENT');
    database.prepare('DELETE FROM game_events WHERE id=?').run('event-summary-source');
    expect(repository.inspectSummary(initial.id)).toMatchObject({
      status: 'STALE',
      reason: 'SOURCE_DELETED',
    });
    database.close();
  });

  it('enforces Actor isolation and marks Long-term Memory stale when Knowledge changes', async () => {
    const database = await createDatabase();
    const knowledge = new KnowledgeBoundaryRepository(database);
    const memoryLayers = new MemoryLayerRepository(database);
    const truth = createWorldTruth({
      id: worldTruthId('truth-beacon-route'),
      campaignId: campaign,
      subject: 'beacon-route',
      predicate: 'state',
      object: 'open',
      authority: 'DOMAIN_TRANSACTION',
      visibility: 'GAME_PRIVATE',
      sourceEventId: gameEventId('event-knowledge-source'),
      revision: 1,
      createdAt: at,
    });
    knowledge.saveWorldTruth(truth, 0);
    const npcOneKnowledge = actorKnowledge('knowledge-npc-one', 'npc-one', truth.id, 1);
    const npcTwoKnowledge = actorKnowledge('knowledge-npc-two', 'npc-two', truth.id, 1);
    saveKnowledge(knowledge, npcOneKnowledge, 'one');
    saveKnowledge(knowledge, npcTwoKnowledge, 'two');

    expect(() =>
      memoryLayers.captureSources(
        campaign,
        [{ kind: 'KNOWLEDGE', id: npcTwoKnowledge.id }],
        npcOneKnowledge.actor,
      ),
    ).toThrow('another actor');

    const longTerm = knowledge.appendMemory(
      createMemory({
        id: memoryId('memory-npc-one-route'),
        campaignId: campaign,
        actor: npcOneKnowledge.actor,
        summary: 'The keeper remembers the beacon route being opened.',
        sourceKnowledgeIds: [npcOneKnowledge.id],
        sourceEventIds: [],
        revision: 1,
        createdAt: later,
      }),
    );
    expect(memoryLayers.inspectLongTermMemory(longTerm.id).status).toBe('CURRENT');

    knowledge.saveKnowledgeOnce({
      knowledge: createKnowledge({
        ...npcOneKnowledge,
        state: 'SUSPECTED',
        provenance: {
          ...npcOneKnowledge.provenance,
          learnedAt: later,
          confidence: 0.6,
        },
        revision: 2,
      }),
      expectedRevision: 1,
      updatedAt: later,
      operationId: aiOperationId('knowledge-memory-update'),
      ledgerId: eventLedgerId('ledger-memory-update'),
      source: 'LOCAL_RULE',
    });
    expect(memoryLayers.inspectLongTermMemory(longTerm.id)).toMatchObject({
      status: 'STALE',
      reason: 'SOURCE_UPDATED',
    });
    database.close();
  });

  it('round-trips all memory layers through an internal save snapshot', async () => {
    const database = await createDatabase();
    const repository = new MemoryLayerRepository(database);
    const sources = repository.captureSources(campaign, [
      { kind: 'GAME_EVENT', id: 'event-summary-source' },
    ]);
    const summary = repository.saveSummary(
      createHistoricalSummary({
        id: historicalSummaryId('summary-snapshot'),
        campaignId: campaign,
        scopeKind: 'CAMPAIGN',
        scopeId: campaign,
        actor: null,
        text: 'The beacon is part of the active campaign history.',
        sources,
        sourceDigest: memorySourceDigest(sources),
        coveredFrom: at,
        coveredTo: at,
        generationRecordId: null,
        revision: 1,
        createdAt: at,
        updatedAt: at,
      }),
      0,
    );
    const snapshots = new SnapshotRepository(database);
    const saved = snapshots.create({
      id: snapshotId('snapshot-memory-layers'),
      campaignId: campaign,
      kind: 'MANUAL',
      reason: 'M9-T02 memory layer round-trip',
      schemaVersion: schemaVersion(28),
      createdAt: later,
    });
    database.prepare("UPDATE historical_summaries SET summary_text='Mutated', revision=2").run();
    database.prepare('DELETE FROM game_events WHERE id=?').run('event-summary-source');

    snapshots.restore(saved.id);
    expect(repository.requireSummary(summary.id).text).toBe(summary.text);
    expect(repository.inspectSummary(summary.id).status).toBe('CURRENT');
    expect(database.prepare('SELECT COUNT(*) AS count FROM messages').get()).toEqual({ count: 1 });
    database.close();
  });

  it('reopens source-backed artifacts from durable SQLite', async () => {
    const directory = await mkdtemp(join(tmpdir(), `ember-memory-${randomUUID()}-`));
    const path = join(directory, 'memory.sqlite');
    let database: DatabaseSync | null = await createDatabase(path);
    try {
      let repository = new MemoryLayerRepository(database);
      const sources = repository.captureSources(campaign, [
        { kind: 'WORLD_FACT', id: 'fact-beacon-custom' },
      ]);
      const lore = repository.saveWorldLore(
        createWorldLoreEntry({
          id: worldLoreEntryId('lore-durable'),
          campaignId: campaign,
          title: 'Durable Beacon Lore',
          text: 'The harbor keeps a written record of each beacon season.',
          sources,
          sourceDigest: memorySourceDigest(sources),
          generationRecordId: null,
          revision: 1,
          createdAt: at,
          updatedAt: later,
        }),
        0,
      );
      database.close();
      database = new DatabaseSync(path);
      await applyMigrations(database);
      repository = new MemoryLayerRepository(database);
      expect(repository.requireWorldLore(lore.id)).toEqual(lore);
      expect(repository.inspectWorldLore(lore.id).status).toBe('CURRENT');
    } finally {
      database?.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});

function actorKnowledge(
  id: string,
  actorId: string,
  truthId: ReturnType<typeof worldTruthId>,
  revision: number,
) {
  return createKnowledge({
    id: knowledgeId(id),
    campaignId: campaign,
    actor: { type: 'NPC', id: actorId },
    target: { kind: 'TRUTH', truthId },
    state: 'KNOWN',
    visibility: 'ACTOR_PRIVATE',
    provenance: {
      kind: 'OBSERVATION',
      sourceId: 'event-knowledge-source',
      eventId: gameEventId('event-knowledge-source'),
      learnedAt: at,
      confidence: 0.9,
    },
    revision,
  });
}

function saveKnowledge(
  repository: KnowledgeBoundaryRepository,
  knowledge: ReturnType<typeof actorKnowledge>,
  suffix: string,
): void {
  repository.saveKnowledgeOnce({
    knowledge,
    expectedRevision: 0,
    updatedAt: at,
    operationId: aiOperationId(`knowledge-memory-${suffix}`),
    ledgerId: eventLedgerId(`ledger-memory-${suffix}`),
    source: 'LOCAL_RULE',
  });
}

async function createDatabase(path = ':memory:'): Promise<DatabaseSync> {
  const database = new DatabaseSync(path);
  await applyMigrations(database);
  database
    .prepare(
      `INSERT INTO campaigns (
         id,schema_version,state,task_model_overrides_json,model_switch_policy,created_at,updated_at
       ) VALUES (?,28,'CREATING_WORLD','{}','ASK',?,?)`,
    )
    .run(campaign, at, at);
  for (const [id, requestId, task] of [
    ['generation-memory-summary', 'request-memory-summary', 'SUMMARIZE_ADVENTURE'],
    ['generation-memory-lore', 'request-memory-lore', 'GENERATE_WORLD_EVENT'],
  ] as const) {
    database
      .prepare(
        `INSERT INTO generation_records (
           id,campaign_id,request_id,task,model_profile_id,prompt_version,request_json,
           raw_response_text,validated_output_json,validation_error_json,started_at,completed_at
         ) VALUES (?,?,?, ?,NULL,1,'{}','{}','{}',NULL,?,?)`,
      )
      .run(id, campaign, requestId, task, at, at);
  }
  database
    .prepare(
      `INSERT INTO world_facts (
         id,campaign_id,kind,statement,faction_ids_json,detail_json,created_at
       ) VALUES ('fact-beacon-custom',?,'DEVELOPING_FACT','Beacon customs are seasonal.','[]','{}',?)`,
    )
    .run(campaign, at);
  for (const id of ['event-summary-source', 'event-knowledge-source']) {
    database
      .prepare(
        `INSERT INTO game_events (id,campaign_id,schema_version,type,payload_json,occurred_at)
         VALUES (?,?,1,'FACT_DISCOVERED','{"state":"dark"}',?)`,
      )
      .run(id, campaign, at);
  }
  database
    .prepare(
      `INSERT INTO taverns (
         id,campaign_id,location_id,name,position,environment,special_rules_json,
         long_term_problem,owner_npc_id,changes_json,created_at,updated_at
       ) VALUES ('tavern-memory',?,'harbor','Ember Rest','Harbor','Warm','[]','Beacon',NULL,'[]',?,?)`,
    )
    .run(campaign, at, at);
  for (const id of ['npc-one', 'npc-two']) {
    database
      .prepare(
        `INSERT INTO npcs (
           id,campaign_id,tavern_id,residency,name,identity,appearance,personality,goal,
           secret,speech_style,current_mood,current_status,visit_json,memories_json,created_at,updated_at
         ) VALUES (?,?,'tavern-memory','RESIDENT',?,'Keeper','Weathered','Careful','Protect route',
           'Private','Measured','Calm','ACTIVE',NULL,'[]',?,?)`,
      )
      .run(id, campaign, id, at, at);
  }
  database
    .prepare(
      `INSERT INTO conversations (id,campaign_id,kind,npc_id,adventure_id,created_at,updated_at)
       VALUES ('conversation-memory',?,'NPC','npc-one',NULL,?,?)`,
    )
    .run(campaign, at, later);
  database
    .prepare(
      `INSERT INTO messages (
         id,conversation_id,sequence_number,role,speaker_npc_id,content,generation_record_id,created_at
       ) VALUES ('message-summary-source','conversation-memory',1,'PLAYER',NULL,
         'We should inspect the beacon.',NULL,?)`,
    )
    .run(later);
  return database;
}

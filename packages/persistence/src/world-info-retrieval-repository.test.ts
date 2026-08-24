import { DatabaseSync } from 'node:sqlite';

import {
  campaignId,
  createWorldLoreEntry,
  createWorldLoreRetrievalRule,
  isoTimestamp,
  locationId,
  npcId,
  questId,
  schemaVersion,
  snapshotId,
  worldLoreEntryId,
} from '@ember-tavern/contracts';
import { describe, expect, it } from 'vitest';

import { MemoryLayerRepository, memorySourceDigest } from './memory-layer-repository.js';
import { applyMigrations } from './migrations.mjs';
import { SnapshotRepository } from './snapshot-repository.js';
import { WorldInfoRetrievalRepository } from './world-info-retrieval-repository.js';

const campaign = campaignId('campaign-world-info');
const at = isoTimestamp('2026-08-24T10:00:00.000Z');
const later = isoTimestamp('2026-08-24T11:00:00.000Z');

describe('WorldInfoRetrievalRepository', () => {
  it('persists scoped rules, returns current corpus and observes source drift', async () => {
    const database = await createDatabase();
    const memory = new MemoryLayerRepository(database);
    const repository = new WorldInfoRetrievalRepository(database);
    const sources = memory.captureSources(campaign, [{ kind: 'WORLD_FACT', id: 'fact-beacon' }]);
    const lore = memory.saveWorldLore(
      createWorldLoreEntry({
        id: worldLoreEntryId('lore-beacon'),
        campaignId: campaign,
        title: 'Beacon Rite',
        text: 'The harbor keeper lights three lamps before a storm tide.',
        sources,
        sourceDigest: memorySourceDigest(sources),
        generationRecordId: null,
        revision: 1,
        createdAt: at,
        updatedAt: at,
      }),
      0,
    );
    const rule = repository.saveRule(
      createWorldLoreRetrievalRule({
        loreEntryId: lore.id,
        campaignId: campaign,
        keywords: ['beacon'],
        entityRefs: [{ kind: 'NPC', id: npcId('npc-keeper') }],
        locationIds: [locationId('location-harbor')],
        questIds: [questId('quest-beacon')],
        alwaysActive: false,
        matchMode: 'ANY',
        priority: 600,
        tokenBudget: 800,
        enabled: true,
        revision: 1,
        updatedAt: at,
      }),
      0,
    );
    const query = {
      campaignId: campaign,
      text: 'What is the beacon rite?',
      entityRefs: [{ kind: 'NPC' as const, id: npcId('npc-keeper') }],
      locationIds: [locationId('location-harbor')],
      questIds: [questId('quest-beacon')],
      minimumScore: 0.2,
      maxTokens: 1_000,
    };
    expect(repository.loadWorldInfoCorpus(query).candidates[0]).toMatchObject({
      current: true,
      rule: { revision: 1, priority: 600 },
    });
    expect(() =>
      database
        .prepare(
          `UPDATE world_lore_retrieval_rules
           SET entity_refs_json='[{"kind":"NPC","id":"npc-keeper","extra":true}]',
               revision=revision+1
           WHERE lore_entry_id='lore-beacon'`,
        )
        .run(),
    ).toThrow('lore retrieval entity ref is invalid');
    expect(() =>
      database
        .prepare(
          `UPDATE world_lore_retrieval_rules
           SET location_ids_json='["other-location"]', revision=revision+1
           WHERE lore_entry_id='lore-beacon'`,
        )
        .run(),
    ).toThrow('lore retrieval location belongs to another campaign');

    repository.saveRule(
      createWorldLoreRetrievalRule({ ...rule, priority: 700, revision: 2, updatedAt: later }),
      1,
    );
    expect(repository.requireRule(lore.id).priority).toBe(700);
    database
      .prepare("UPDATE world_facts SET statement='Changed rite' WHERE id='fact-beacon'")
      .run();
    expect(repository.loadWorldInfoCorpus(query).candidates[0]?.current).toBe(false);
    database.close();
  });

  it('rejects cross-campaign references and round-trips rules through internal snapshots', async () => {
    const database = await createDatabase();
    const memory = new MemoryLayerRepository(database);
    const repository = new WorldInfoRetrievalRepository(database);
    const sources = memory.captureSources(campaign, [{ kind: 'WORLD_FACT', id: 'fact-beacon' }]);
    const lore = memory.saveWorldLore(
      createWorldLoreEntry({
        id: worldLoreEntryId('lore-snapshot'),
        campaignId: campaign,
        title: 'Snapshot Lore',
        text: 'A source-backed entry survives internal restore.',
        sources,
        sourceDigest: memorySourceDigest(sources),
        generationRecordId: null,
        revision: 1,
        createdAt: at,
        updatedAt: at,
      }),
      0,
    );
    const rule = repository.saveRule(
      createWorldLoreRetrievalRule({
        loreEntryId: lore.id,
        campaignId: campaign,
        keywords: ['snapshot'],
        entityRefs: [],
        locationIds: [],
        questIds: [],
        alwaysActive: false,
        matchMode: 'ANY',
        priority: 100,
        tokenBudget: 500,
        enabled: true,
        revision: 1,
        updatedAt: at,
      }),
      0,
    );
    expect(() =>
      repository.loadWorldInfoCorpus({
        campaignId: campaign,
        text: '',
        entityRefs: [{ kind: 'NPC', id: 'npc-other-campaign' }],
        locationIds: [],
        questIds: [],
        minimumScore: 0,
        maxTokens: 100,
      }),
    ).toThrow('outside the campaign');

    const snapshots = new SnapshotRepository(database);
    const saved = snapshots.create({
      id: snapshotId('snapshot-world-info-rule'),
      campaignId: campaign,
      kind: 'MANUAL',
      reason: 'World Info retrieval rule round-trip',
      schemaVersion: schemaVersion(29),
      createdAt: at,
    });
    repository.saveRule(
      createWorldLoreRetrievalRule({ ...rule, priority: 900, revision: 2, updatedAt: later }),
      1,
    );
    snapshots.restore(saved.id);
    expect(repository.requireRule(lore.id)).toEqual(rule);
    database.close();
  });
});

async function createDatabase(): Promise<DatabaseSync> {
  const database = new DatabaseSync(':memory:');
  await applyMigrations(database);
  for (const id of [campaign, 'campaign-other']) {
    database
      .prepare(
        `INSERT INTO campaigns (
           id,schema_version,state,task_model_overrides_json,model_switch_policy,created_at,updated_at
         ) VALUES (?,29,'CREATING_WORLD','{}','ASK',?,?)`,
      )
      .run(id, at, at);
  }
  database
    .prepare(
      `INSERT INTO world_facts (
         id,campaign_id,kind,statement,faction_ids_json,detail_json,created_at
       ) VALUES ('fact-beacon',?,'DEVELOPING_FACT','The beacon rite uses three lamps.','[]','{}',?)`,
    )
    .run(campaign, at);
  database
    .prepare(
      `INSERT INTO taverns (
         id,campaign_id,location_id,name,position,environment,special_rules_json,
         long_term_problem,owner_npc_id,changes_json,created_at,updated_at
       ) VALUES ('tavern-world-info',?,'location-harbor','Ember Rest','Harbor','Warm','[]',
         'Storm tide',NULL,'[]',?,?)`,
    )
    .run(campaign, at, at);
  for (const [id, ownerCampaign, tavern] of [
    ['npc-keeper', campaign, 'tavern-world-info'],
    ['npc-other-campaign', 'campaign-other', 'tavern-other'],
  ] as const) {
    if (tavern === 'tavern-other') {
      database
        .prepare(
          `INSERT INTO taverns (
             id,campaign_id,location_id,name,position,environment,special_rules_json,
             long_term_problem,owner_npc_id,changes_json,created_at,updated_at
           ) VALUES (?,?,'other-location','Other','Elsewhere','Cold','[]','None',NULL,'[]',?,?)`,
        )
        .run(tavern, ownerCampaign, at, at);
    }
    database
      .prepare(
        `INSERT INTO npcs (
           id,campaign_id,tavern_id,residency,name,identity,appearance,personality,goal,
           secret,speech_style,current_mood,current_status,visit_json,memories_json,created_at,updated_at
         ) VALUES (?,?,?,'OWNER',?,'Keeper','Weathered','Careful','Keep watch',
           'Private','Measured','Calm','ACTIVE',NULL,'[]',?,?)`,
      )
      .run(id, ownerCampaign, tavern, id, at, at);
  }
  database
    .prepare(
      `INSERT INTO quests (
         id,campaign_id,publisher_npc_id,content_json,status,risk,recommended_attributes_json,
         expected_turns_min,expected_turns_max,reward_tier,related_npc_ids_json,
         related_fact_ids_json,created_at,updated_at
       ) VALUES ('quest-beacon',?,'npc-keeper','{"title":"Beacon"}','AVAILABLE','LOW','[]',
         1,2,'BASIC','["npc-keeper"]','["fact-beacon"]',?,?)`,
    )
    .run(campaign, at, at);
  return database;
}

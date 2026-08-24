import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { URL } from 'node:url';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { applyMigrations, migrationCount } from './migrations.mjs';

const coreTables = [
  'active_factions',
  'actor_knowledge',
  'adventure_turns',
  'adventures',
  'ai_candidates',
  'app_settings',
  'campaign_location_states',
  'campaigns',
  'career_pools',
  'character_creation_sessions',
  'character_extension_definitions',
  'character_rule_states',
  'conversations',
  'credential_cleanup_queue',
  'dialogue_suggestion_cache',
  'director_budget_admissions',
  'director_budget_cooldowns',
  'director_budget_decisions',
  'director_budget_entries',
  'director_budget_states',
  'dynamic_locations',
  'dynamic_quest_sources',
  'event_ledger',
  'faction_action_events',
  'game_events',
  'generation_records',
  'historical_summaries',
  'items',
  'knowledge_claims',
  'knowledge_memories',
  'lazy_world_generation_plans',
  'lazy_world_generation_transitions',
  'location_connections',
  'location_travel_events',
  'memory_artifact_sources',
  'messages',
  'model_profiles',
  'npc_knowledge',
  'npc_lod_profiles',
  'npc_lod_transitions',
  'npc_relationships',
  'npc_timeline_attempts',
  'npc_timeline_operations',
  'npcs',
  'pending_ai_requests',
  'player_characters',
  'prefetch_candidates',
  'prefetch_events',
  'provider_configs',
  'quest_graph_edges',
  'quest_graph_evaluations',
  'quest_graph_revisions',
  'quest_graphs',
  'quest_pool_creation_intents',
  'quest_pool_restore_sessions',
  'quest_pool_states',
  'quest_pool_transitions',
  'quests',
  'rules_events',
  'save_snapshots',
  'scene_frames',
  'tavern_population_cycles',
  'tavern_population_focus_events',
  'tavern_population_members',
  'tavern_population_states',
  'tavern_scene_actor_proposals',
  'tavern_scene_participants',
  'tavern_scene_turns',
  'tavern_scenes',
  'taverns',
  'universal_character_profiles',
  'world_bibles',
  'world_clocks',
  'world_constitutions',
  'world_director_proposals',
  'world_director_runs',
  'world_facts',
  'world_lore_entries',
  'world_lore_retrieval_rules',
  'world_random_streams',
  'world_seeds',
  'world_truths',
];

async function withDatabase(run) {
  const directory = await mkdtemp(join(tmpdir(), 'ember-tavern-migration-'));
  const database = new DatabaseSync(join(directory, 'test.sqlite'));
  try {
    await run(database);
  } finally {
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
}

test('migrates a new database to the complete initial schema', async () => {
  await withDatabase(async (database) => {
    await applyMigrations(database);

    const tables = database
      .prepare(
        `SELECT name
         FROM sqlite_master
         WHERE type = 'table'
           AND name NOT LIKE 'sqlite_%'
           AND name <> 'schema_migrations'
         ORDER BY name`,
      )
      .all()
      .map((row) => row.name);
    assert.deepEqual(tables, coreTables);
    assert.equal(database.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
    assert.equal(
      database.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get().count,
      migrationCount,
    );
  });
});

test('skips an already applied migration on repeated startup', async () => {
  await withDatabase(async (database) => {
    await applyMigrations(database);
    const firstRows = database
      .prepare('SELECT version, name, applied_at FROM schema_migrations ORDER BY version')
      .all()
      .map((row) => ({ ...row }));

    await applyMigrations(database);

    const rows = database.prepare('SELECT version, name, applied_at FROM schema_migrations').all();
    assert.deepEqual(
      rows.map((row) => ({ ...row })),
      firstRows,
    );
    assert.equal(
      database.prepare(`SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table'`).get()
        .count,
      coreTables.length + 2,
    );
  });
});

test('backfills every legacy quest into the multi-quest pool without changing its status', async () => {
  await withDatabase(async (database) => {
    await applyMigrations(database);
    database.exec(`
      DROP TRIGGER quest_pool_state_insert_guard;
      DROP TRIGGER quest_pool_state_update_guard;
      DROP TRIGGER quest_pool_state_after_update;
      DROP TRIGGER quest_pool_after_quest_insert;
      DROP TRIGGER quest_pool_legacy_status_stale_guard;
      DROP TRIGGER quest_pool_after_legacy_status_update;
      DROP TRIGGER quest_pool_transition_update_guard;
      DROP TRIGGER quest_pool_transition_delete_guard;
      DROP TABLE quest_pool_transitions;
      DROP TABLE quest_pool_states;
      DROP TABLE quest_pool_restore_sessions;
      DELETE FROM schema_migrations WHERE version=23;
      INSERT INTO campaigns(id,schema_version,state,created_at,updated_at)
      VALUES('campaign-quest-migration',1,'TAVERN','2026-08-24T00:00:00.000Z','2026-08-24T00:00:00.000Z');
      INSERT INTO taverns(
        id,campaign_id,location_id,name,position,environment,special_rules_json,
        long_term_problem,changes_json,created_at,updated_at
      ) VALUES('tavern-quest-migration','campaign-quest-migration','location','Ember','Road',
        'Warm','[]','Storm','[]','2026-08-24T00:00:00.000Z','2026-08-24T00:00:00.000Z');
      INSERT INTO npcs(
        id,campaign_id,tavern_id,residency,name,identity,appearance,personality,goal,secret,
        speech_style,current_mood,current_status,memories_json,created_at,updated_at
      ) VALUES('npc-quest-migration','campaign-quest-migration','tavern-quest-migration','OWNER',
        'Keeper','Keeper','Coat','Steady','Protect','Hidden','Brief','Calm','ACTIVE','[]',
        '2026-08-24T00:00:00.000Z','2026-08-24T00:00:00.000Z');
      INSERT INTO quests(
        id,campaign_id,publisher_npc_id,content_json,status,risk,recommended_attributes_json,
        expected_turns_min,expected_turns_max,reward_tier,related_npc_ids_json,
        related_fact_ids_json,created_at,updated_at
      ) VALUES('quest-migration','campaign-quest-migration','npc-quest-migration',
        '{"title":"Old","summary":"Old","objective":"Old","failureCost":"Old"}',
        'FAILED','LOW','["knowledge"]',8,12,'BASIC','[]','[]',
        '2026-08-24T00:00:00.000Z','2026-08-24T01:00:00.000Z');
    `);

    await applyMigrations(database);
    assert.deepEqual(
      { ...database.prepare('SELECT status,revision,last_source FROM quest_pool_states').get() },
      { status: 'FAILED', revision: 1, last_source: 'MIGRATION' },
    );
    assert.deepEqual(
      {
        ...database
          .prepare(
            'SELECT from_status,to_status,before_revision,after_revision FROM quest_pool_transitions',
          )
          .get(),
      },
      { from_status: null, to_status: 'FAILED', before_revision: 0, after_revision: 1 },
    );
    assert.throws(() =>
      database
        .prepare(
          `UPDATE quest_pool_states SET status='ACTIVE',revision=2,last_source='SYSTEM',
           last_reason='Rewrite',last_operation_id='rewrite',updated_at='2026-08-24T02:00:00.000Z'`,
        )
        .run(),
    );
  });
});

test('backfills rules state from schema 10 characters and keeps base attributes immutable', async () => {
  await withDatabase(async (database) => {
    database.exec(`CREATE TABLE schema_migrations (
      version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL
    )`);
    const names = [
      'initial',
      'credential_cleanup_queue',
      'provider_probe_consistency',
      'ai_candidates',
      'event_ledger',
      'scene_frames',
      'knowledge_provenance',
      'rumor_claim_sources',
      'world_constitutions',
      'world_seed',
    ];
    for (let version = 1; version <= 10; version += 1) {
      const filename = `${String(version).padStart(4, '0')}_${names[version - 1]}.sql`;
      database.exec(
        await readFile(
          new URL(`../../../database/migrations/${filename}`, import.meta.url),
          'utf8',
        ),
      );
      database
        .prepare('INSERT INTO schema_migrations VALUES (?, ?, ?)')
        .run(version, names[version - 1], '2026-08-14T00:00:00.000Z');
    }
    database.exec(`
      INSERT INTO campaigns (id, schema_version, state, created_at, updated_at)
      VALUES ('campaign-rules-backfill', 1, 'CREATING_CHARACTER',
              '2026-08-14T00:00:00.000Z', '2026-08-14T00:00:00.000Z');
      INSERT INTO player_characters (
        id, campaign_id, name, concept, story_preferences_json, content_boundaries_json,
        class_archetype, class_display_name, attributes_json, traits_json, personal_goal,
        background_json, initial_equipment_ids_json, created_at, updated_at
      ) VALUES (
        'character-rules-backfill', 'campaign-rules-backfill', 'Hero', 'Test', '[]',
        '{"allowHorror":true,"allowPermanentDeath":false,"allowRomance":false,"allowBetrayal":true,"excludedContent":[]}',
        'SCHOLAR', 'Scholar', '{"physique":3,"agility":2,"knowledge":3,"charisma":2}',
        '[{"id":"trait-one","name":"One","description":"One"},{"id":"trait-two","name":"Two","description":"Two"}]',
        'Verify',
        '{"birthplace":"A","formativeExperience":"B","adventureMotivation":"C","secret":"D","importantPerson":"E","tavernArrivalReason":"F"}',
        '[]', '2026-08-14T00:00:00.000Z', '2026-08-14T00:00:00.000Z'
      );
    `);

    await applyMigrations(database);

    const state = database
      .prepare(
        `SELECT base_attributes_json, hp_current, hp_max, money, revision
         FROM character_rule_states WHERE player_character_id = 'character-rules-backfill'`,
      )
      .get();
    assert.deepEqual(JSON.parse(state.base_attributes_json), {
      physique: 3,
      agility: 2,
      knowledge: 3,
      charisma: 2,
    });
    assert.deepEqual(
      {
        hpCurrent: state.hp_current,
        hpMax: state.hp_max,
        money: state.money,
        revision: state.revision,
      },
      { hpCurrent: 10, hpMax: 10, money: 0, revision: 1 },
    );
    assert.throws(() =>
      database
        .prepare('UPDATE character_rule_states SET base_attributes_json = ?')
        .run('{"physique":4,"agility":2,"knowledge":2,"charisma":2}'),
    );
    const universal = database
      .prepare(
        `SELECT schema_version, revision, profile_json
         FROM universal_character_profiles
         WHERE player_character_id = 'character-rules-backfill'`,
      )
      .get();
    assert.equal(universal.schema_version, 1);
    assert.equal(universal.revision, 1);
    assert.deepEqual(JSON.parse(universal.profile_json), {
      kind: 'UNIVERSAL_CHARACTER_PROFILE',
      schemaVersion: 1,
      revision: 1,
      id: 'character-rules-backfill',
      campaignId: 'campaign-rules-backfill',
      name: 'Hero',
      nickname: null,
      gender: null,
      age: null,
      identity: 'Test',
      ancestry: null,
      birthplace: 'A',
      socialClass: null,
      faith: null,
      appearance: '',
      personality: '',
      values: [],
      goals: ['Verify'],
      fears: [],
      secrets: ['D'],
      family: [],
      education: [],
      importantPeople: ['E'],
      enemies: [],
      experiences: ['B'],
      concept: 'Test',
      storyPreferences: [],
      contentBoundaries: {
        allowHorror: true,
        allowPermanentDeath: false,
        allowRomance: false,
        allowBetrayal: true,
        excludedContent: [],
      },
      career: { id: null, displayName: 'Scholar', legacyArchetype: 'SCHOLAR' },
      attributes: { physique: 3, agility: 2, knowledge: 3, charisma: 2 },
      derivedAttributes: [],
      skills: [],
      proficiencies: [],
      abilities: [],
      languages: [],
      wealth: 0,
      equipmentIds: [],
      reputations: [],
      relationships: [],
      traits: [
        { id: 'trait-one', name: 'One', description: 'One' },
        { id: 'trait-two', name: 'Two', description: 'Two' },
      ],
      statuses: [],
      legacyBackground: {
        birthplace: 'A',
        formativeExperience: 'B',
        adventureMotivation: 'C',
        secret: 'D',
        importantPerson: 'E',
        tavernArrivalReason: 'F',
      },
      extensions: [],
      createdAt: '2026-08-14T00:00:00.000Z',
      updatedAt: '2026-08-14T00:00:00.000Z',
    });
    assert.throws(() =>
      database
        .prepare('UPDATE player_characters SET attributes_json = ?')
        .run('{"physique":4,"agility":2,"knowledge":2,"charisma":2}'),
    );
  });
});

test('backfills deterministic provenance from schema 6 without exposing excluded secrets', async () => {
  await withDatabase(async (database) => {
    database.exec(`CREATE TABLE schema_migrations (
      version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL
    )`);
    const names = [
      'initial',
      'credential_cleanup_queue',
      'provider_probe_consistency',
      'ai_candidates',
      'event_ledger',
      'scene_frames',
    ];
    for (let version = 1; version <= 6; version += 1) {
      const filename = `${String(version).padStart(4, '0')}_${names[version - 1]}.sql`;
      database.exec(
        await readFile(
          new URL(`../../../database/migrations/${filename}`, import.meta.url),
          'utf8',
        ),
      );
      database
        .prepare('INSERT INTO schema_migrations VALUES (?, ?, ?)')
        .run(version, names[version - 1], '2026-08-09T00:00:00.000Z');
    }
    database.exec(`
      INSERT INTO campaigns (id, schema_version, state, created_at, updated_at)
      VALUES ('campaign-provenance', 1, 'TAVERN', '2026-08-09T00:00:00.000Z', '2026-08-09T00:00:00.000Z');
      INSERT INTO taverns (
        id, campaign_id, location_id, name, position, environment, special_rules_json,
        long_term_problem, changes_json, created_at, updated_at
      ) VALUES (
        'tavern-provenance', 'campaign-provenance', 'location-one', 'Ember', 'Road', 'Warm',
        '[]', 'None', '[]', '2026-08-09T00:00:00.000Z', '2026-08-09T00:00:00.000Z'
      );
      INSERT INTO npcs (
        id, campaign_id, tavern_id, residency, name, identity, appearance, personality,
        goal, secret, speech_style, current_mood, current_status, memories_json, created_at, updated_at
      ) VALUES (
        'npc-provenance', 'campaign-provenance', 'tavern-provenance', 'OWNER', 'Ilyra', 'Keeper',
        'Red coat', 'Watchful', 'Protect', 'Hidden', 'Brief', 'Calm', 'ACTIVE', '[]',
        '2026-08-09T00:00:00.000Z', '2026-08-09T00:00:00.000Z'
      );
      INSERT INTO npc_knowledge (
        npc_id, known_fact_ids_json, suspected_fact_ids_json, false_belief_fact_ids_json,
        excluded_secret_fact_ids_json, updated_at
      ) VALUES (
        'npc-provenance', '["fact-known","fact-rumor","fact-excluded"]', '["fact-suspected"]',
        '["fact-believed"]', '["fact-excluded"]', '2026-08-09T01:02:03.004Z'
      );
      INSERT INTO world_facts (
        id, campaign_id, kind, statement, faction_ids_json, detail_json, created_at
      ) VALUES (
        'fact-known', 'campaign-provenance', 'DEVELOPING_FACT', 'The old key fits the cellar.',
        '[]', '{}', '2026-08-09T01:02:03.004Z'
      ), (
        'fact-suspected', 'campaign-provenance', 'DEVELOPING_FACT', 'The bell rope may be cut.',
        '[]', '{}', '2026-08-09T01:02:03.004Z'
      ), (
        'fact-believed', 'campaign-provenance', 'FALSE_BELIEF', 'The harbor gate is sealed.',
        '[]', '{"believedByNpcIds":["npc-provenance"]}', '2026-08-09T01:02:03.004Z'
      ), (
        'fact-excluded', 'campaign-provenance', 'DEVELOPING_FACT', 'The ledger names the heir.',
        '[]', '{}', '2026-08-09T01:02:03.004Z'
      ), (
        'fact-rumor', 'campaign-provenance', 'RUMOR', 'The bell rings below the cellar.',
        '[]', '{"veracity":"UNKNOWN"}', '2026-08-09T01:02:03.004Z'
      );
    `);

    await applyMigrations(database);

    const row = database.prepare('SELECT provenance_json FROM npc_knowledge').get();
    assert.deepEqual(JSON.parse(row.provenance_json), [
      {
        factId: 'fact-known',
        state: 'KNOWN',
        source: 'IMPORT',
        eventId: null,
        learnedAt: '2026-08-09T01:02:03.004Z',
        confidence: 1,
      },
      {
        factId: 'fact-rumor',
        state: 'KNOWN',
        source: 'IMPORT',
        eventId: null,
        learnedAt: '2026-08-09T01:02:03.004Z',
        confidence: 1,
      },
      {
        factId: 'fact-suspected',
        state: 'SUSPECTED',
        source: 'IMPORT',
        eventId: null,
        learnedAt: '2026-08-09T01:02:03.004Z',
        confidence: 0.5,
      },
      {
        factId: 'fact-believed',
        state: 'BELIEVED',
        source: 'IMPORT',
        eventId: null,
        learnedAt: '2026-08-09T01:02:03.004Z',
        confidence: 1,
      },
    ]);
    assert.deepEqual(
      JSON.parse(
        database.prepare('SELECT known_fact_ids_json FROM npc_knowledge').get().known_fact_ids_json,
      ),
      ['fact-known', 'fact-rumor'],
    );
    assert.deepEqual(
      JSON.parse(
        database.prepare("SELECT detail_json FROM world_facts WHERE id = 'fact-rumor'").get()
          .detail_json,
      ),
      {
        veracity: 'UNKNOWN',
        claimId: 'claim-fact-rumor',
        claimRevision: 1,
        confidence: 0.5,
        sourceBasis: 'HEARSAY',
        sourceNpcId: 'npc-provenance',
      },
    );
    assert.equal(
      database.prepare('SELECT MAX(version) AS version FROM schema_migrations').get().version,
      31,
    );
    const importedKnowledge = database
      .prepare(
        `SELECT target_kind, knowledge_state,
                COALESCE(truth_id, claim_id) AS target_id
         FROM actor_knowledge ORDER BY knowledge_state, target_id`,
      )
      .all()
      .map((entry) => ({ ...entry }));
    assert.deepEqual(importedKnowledge, [
      { target_kind: 'CLAIM', knowledge_state: 'BELIEVED', target_id: 'claim-fact-believed' },
      { target_kind: 'CLAIM', knowledge_state: 'KNOWN', target_id: 'claim-fact-rumor' },
      { target_kind: 'TRUTH', knowledge_state: 'KNOWN', target_id: 'truth-fact-known' },
      { target_kind: 'TRUTH', knowledge_state: 'SUSPECTED', target_id: 'truth-fact-suspected' },
    ]);
    assert.equal(JSON.stringify(importedKnowledge).includes('fact-excluded'), false);
    assert.equal(
      database
        .prepare("SELECT object_json FROM knowledge_claims WHERE id = 'claim-fact-rumor'")
        .get().object_json,
      '"The bell rings below the cellar."',
    );
    assert.deepEqual(
      database
        .prepare(
          `SELECT aggregate_id, revision, source FROM event_ledger
           WHERE event_type = 'KNOWLEDGE_COMMITTED' ORDER BY aggregate_id`,
        )
        .all()
        .map((entry) => ({ ...entry })),
      ['fact-believed', 'fact-known', 'fact-rumor', 'fact-suspected'].map((factId) => ({
        aggregate_id: `knowledge:npc-provenance:${factId}`,
        revision: 1,
        source: 'IMPORT',
      })),
    );
    const seed = database
      .prepare("SELECT algorithm, seed FROM world_seeds WHERE campaign_id = 'campaign-provenance'")
      .get();
    assert.equal(seed.algorithm, 'EMBER_STREAM_V1');
    assert.match(seed.seed, /^[0-9a-f]{32}$/u);
  });
});

test('enforces representative JSON, range, foreign-key, and secret-storage constraints', async () => {
  await withDatabase(async (database) => {
    await applyMigrations(database);
    const providerColumns = database.prepare('PRAGMA table_info(provider_configs)').all();
    assert.equal(
      providerColumns.some((column) => /api.?key|authorization|token/i.test(column.name)),
      false,
    );
    assert.equal(
      providerColumns.some((column) => column.name === 'endpoint_fingerprint'),
      true,
    );
    const profileColumns = database.prepare('PRAGMA table_info(model_profiles)').all();
    assert.equal(
      profileColumns.some((column) => column.name === 'capability_source'),
      true,
    );
    assert.equal(
      profileColumns.some((column) => column.name === 'probe_fingerprint'),
      true,
    );
    const at = '2026-08-08T00:00:00.000Z';
    assert.throws(() =>
      database
        .prepare(
          `INSERT INTO provider_configs (
             id, provider_type, preset_key, display_name, base_url, options_json,
             enabled, created_at, updated_at, endpoint_fingerprint
           ) VALUES (?, 'OpenAI-Compatible', 'custom', 'Bad fingerprint', ?, '{}', 1, ?, ?, ?)`,
        )
        .run('provider-bad-fingerprint', 'http://127.0.0.1:11434/v1/', at, at, 'short'),
    );
    database
      .prepare(
        `INSERT INTO provider_configs (
           id, provider_type, preset_key, display_name, base_url, options_json,
           enabled, created_at, updated_at, endpoint_fingerprint
         ) VALUES (?, 'OpenAI-Compatible', 'custom', 'Probe constraints', ?, '{}', 1, ?, ?, ?)`,
      )
      .run('provider-probe-constraints', 'http://127.0.0.1:11434/v1/', at, at, 'a'.repeat(64));
    assert.throws(() =>
      database
        .prepare(
          `INSERT INTO model_profiles (
             id, provider_config_id, model_name, display_name, capabilities_json,
             task_options_json, enabled, created_at, updated_at, capability_source,
             probe_fingerprint
           ) VALUES (?, ?, 'model', 'Model', '{}', '{}', 1, ?, ?, 'INVENTED', ?)`,
        )
        .run('profile-bad-source', 'provider-probe-constraints', at, at, 'b'.repeat(64)),
    );

    database
      .prepare(
        `INSERT INTO credential_cleanup_queue (
           credential_ref, reason, attempts, created_at, updated_at
         ) VALUES (?, 'REPLACED', 0, ?, ?)`,
      )
      .run(
        'credential:v1:00000000-0000-0000-0000-000000000001',
        '2026-08-08T00:00:00.000Z',
        '2026-08-08T00:00:00.000Z',
      );
    assert.throws(() =>
      database
        .prepare(
          `INSERT INTO credential_cleanup_queue (
             credential_ref, reason, attempts, created_at, updated_at
           ) VALUES (?, 'INVALID', 0, ?, ?)`,
        )
        .run(
          'credential:v1:00000000-0000-0000-0000-000000000002',
          '2026-08-08T00:00:00.000Z',
          '2026-08-08T00:00:00.000Z',
        ),
    );

    assert.throws(() =>
      database
        .prepare(
          `INSERT INTO provider_configs (
             id, provider_type, preset_key, display_name, options_json,
             enabled, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          'provider-1',
          'OPENAI_COMPATIBLE',
          'custom',
          'Invalid JSON',
          '{',
          1,
          '2026-07-30T15:00:00.000Z',
          '2026-07-30T15:00:00.000Z',
        ),
    );

    database
      .prepare(
        `INSERT INTO campaigns (
           id, schema_version, state, task_model_overrides_json, model_switch_policy,
           created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'campaign-1',
        1,
        'CREATING_WORLD',
        '{}',
        'ASK',
        '2026-07-30T15:00:00.000Z',
        '2026-07-30T15:00:00.000Z',
      );

    assert.throws(() =>
      database
        .prepare(
          `INSERT INTO world_clocks (
             id, campaign_id, name, current, max, stages_json, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          'clock-1',
          'campaign-1',
          'Storm',
          7,
          6,
          '[]',
          '2026-07-30T15:00:00.000Z',
          '2026-07-30T15:00:00.000Z',
        ),
    );

    assert.throws(() =>
      database
        .prepare(
          `INSERT INTO items (
             id, campaign_id, content_json, reward_tier, effect_json, created_at
           ) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          'item-1',
          'missing-campaign',
          '{"name":"Token","description":"A token"}',
          'BASIC',
          '{"kind":"NONE"}',
          '2026-07-30T15:00:00.000Z',
        ),
    );
  });
});

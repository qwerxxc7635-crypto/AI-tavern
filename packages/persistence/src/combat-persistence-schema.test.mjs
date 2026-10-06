import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { applyMigrations, currentSchemaVersion } from './migrations.mjs';

const COMBAT_ID = 'combat:persistence-schema';
const CAMPAIGN_ID = 'campaign-combat-schema';
const AT = '2026-09-12T16:00:00.000Z';
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const SEED = '0123456789abcdef0123456789abcdef';

test('current schema stores the complete BattleRecord and ActiveCombatSave boundary', async () => {
  const database = new DatabaseSync(':memory:');
  await applyMigrations(database);
  seedCampaign(database);
  insertBattleRecord(database);
  insertActiveSave(database, { pendingReaction: true });

  assert.equal(currentSchemaVersion, 35);
  assert.deepEqual(
    row(database, `SELECT * FROM battle_records WHERE combat_instance_id=?`, COMBAT_ID),
    {
      combat_instance_id: COMBAT_ID,
      campaign_id: CAMPAIGN_ID,
      combat_schema_version: 1,
      ruleset_version: 1,
      balance_version: 1,
      engine_version: 1,
      world_profile_version: 1,
      attribute_mapping_version: 1,
      rng_contract_version: 1,
      random_seed: SEED,
      initial_state_json: '{"combatInstanceId":"combat:persistence-schema"}',
      initial_state_hash: HASH_A,
      accepted_commands_json: '[{"acceptedSequence":1}]',
      events_json: '[{"sequence":1}]',
      event_digest: HASH_B,
      last_committed_sequence: 1,
      combat_result: null,
      result_commit_id: null,
      canonical_delta_hash: null,
      canonical_result_committed_at: null,
      created_at: AT,
      updated_at: AT,
    },
  );
  assert.deepEqual(
    row(
      database,
      `SELECT combat_instance_id,campaign_id,rng_streams_json,current_combat_state_json,
              checkpoint_hash,objective_runtime_state_json,reinforcement_runtime_state_json,
              event_scheduler_checkpoint_json,loop_guard_contract_json,
              pending_reaction_snapshot_json,resolution_context_snapshot_json,cost_snapshot_json,
              last_committed_sequence,revision
       FROM active_combat_saves WHERE combat_instance_id=?`,
      COMBAT_ID,
    ),
    {
      combat_instance_id: COMBAT_ID,
      campaign_id: CAMPAIGN_ID,
      rng_streams_json: '{"rngContractVersion":1,"streams":[]}',
      current_combat_state_json: '{"combatInstanceId":"combat:persistence-schema"}',
      checkpoint_hash: HASH_A,
      objective_runtime_state_json:
        '{"requiredObjectiveIds":[],"completedObjectiveIds":[],"failedObjectiveIds":[]}',
      reinforcement_runtime_state_json: '{"reinforcements":[]}',
      event_scheduler_checkpoint_json:
        '{"eventChainId":"chain-1","executedEventCount":7,"queue":[],"nextSequence":9}',
      loop_guard_contract_json: '{"maxTriggerDepth":16,"maxEventCount":1024}',
      pending_reaction_snapshot_json: '{"windowId":"reaction-window-1","status":"UNRESOLVED"}',
      resolution_context_snapshot_json: '{"resolutionContextId":"resolution-1"}',
      cost_snapshot_json: '{"combatants":[]}',
      last_committed_sequence: 1,
      revision: 1,
    },
  );
  database
    .prepare(
      `UPDATE battle_records
       SET combat_result='VICTORY',result_commit_id='result:combat-persistence-schema',
           canonical_delta_hash=?,canonical_result_committed_at=?,updated_at=?
       WHERE combat_instance_id=?`,
    )
    .run(HASH_A, AT, AT, COMBAT_ID);
  assert.deepEqual(
    row(
      database,
      `SELECT combat_result,result_commit_id,canonical_delta_hash,
              canonical_result_committed_at FROM battle_records WHERE combat_instance_id=?`,
      COMBAT_ID,
    ),
    {
      combat_result: 'VICTORY',
      result_commit_id: 'result:combat-persistence-schema',
      canonical_delta_hash: HASH_A,
      canonical_result_committed_at: AT,
    },
  );
  database.close();
});

test('schema rejects version drift malformed checkpoints and incomplete result identity', async () => {
  const database = new DatabaseSync(':memory:');
  await applyMigrations(database);
  seedCampaign(database);
  insertBattleRecord(database);

  assert.throws(
    () => insertActiveSave(database, { engineVersion: 2 }),
    /active combat versions must match battle record/u,
  );
  assert.throws(
    () => insertActiveSave(database, { currentState: '[]' }),
    /CHECK constraint failed/u,
  );
  assert.throws(
    () =>
      database
        .prepare(
          `UPDATE battle_records SET result_commit_id='result:orphan',updated_at=?
           WHERE combat_instance_id=?`,
        )
        .run(AT, COMBAT_ID),
    /CHECK constraint failed/u,
  );
  assert.throws(
    () =>
      database
        .prepare(`UPDATE battle_records SET random_seed=?,updated_at=? WHERE combat_instance_id=?`)
        .run('f'.repeat(32), AT, COMBAT_ID),
    /battle record deterministic identity is immutable/u,
  );
  database.close();
});

test('migration upgrades schema 32 through combat persistence without rewriting campaign data', async () => {
  const database = new DatabaseSync(':memory:');
  await applyMigrations(database);
  seedCampaign(database);
  database.exec(`
    DROP TRIGGER active_combat_save_identity_update;
    DROP TRIGGER active_combat_save_version_insert;
    DROP TRIGGER battle_record_identity_immutable;
    DROP TABLE campaign_combat_profiles;
    DROP TABLE active_combat_saves;
    DROP TABLE battle_records;
    DELETE FROM schema_migrations WHERE version=34;
    DELETE FROM schema_migrations WHERE version=35;
    DELETE FROM schema_migrations WHERE version=33;
  `);

  await applyMigrations(database);

  assert.equal(
    database.prepare('SELECT MAX(version) AS version FROM schema_migrations').get().version,
    35,
  );
  assert.equal(
    database.prepare('SELECT state FROM campaigns WHERE id=?').get(CAMPAIGN_ID).state,
    'TAVERN',
  );
  assert.deepEqual(
    database
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type='table' AND name IN ('battle_records','active_combat_saves') ORDER BY name`,
      )
      .all()
      .map((entry) => entry.name),
    ['active_combat_saves', 'battle_records'],
  );
  database.close();
});

function seedCampaign(database) {
  database
    .prepare(
      `INSERT INTO campaigns(id,schema_version,state,created_at,updated_at)
       VALUES(?,1,'TAVERN',?,?)`,
    )
    .run(CAMPAIGN_ID, AT, AT);
}

function insertBattleRecord(database) {
  database
    .prepare(
      `INSERT INTO battle_records(
         combat_instance_id,campaign_id,combat_schema_version,ruleset_version,balance_version,
         engine_version,world_profile_version,attribute_mapping_version,rng_contract_version,
         random_seed,initial_state_json,initial_state_hash,accepted_commands_json,events_json,
         event_digest,last_committed_sequence,created_at,updated_at
       ) VALUES(?,?,1,1,1,1,1,1,1,?,?,?,?,?,?,1,?,?)`,
    )
    .run(
      COMBAT_ID,
      CAMPAIGN_ID,
      SEED,
      '{"combatInstanceId":"combat:persistence-schema"}',
      HASH_A,
      '[{"acceptedSequence":1}]',
      '[{"sequence":1}]',
      HASH_B,
      AT,
      AT,
    );
}

function insertActiveSave(database, options = {}) {
  database
    .prepare(
      `INSERT INTO active_combat_saves(
         combat_instance_id,campaign_id,combat_schema_version,ruleset_version,balance_version,
         engine_version,world_profile_version,attribute_mapping_version,rng_contract_version,
         rng_streams_json,current_combat_state_json,checkpoint_hash,objective_runtime_state_json,
         reinforcement_runtime_state_json,event_scheduler_checkpoint_json,loop_guard_contract_json,
         pending_reaction_snapshot_json,resolution_context_snapshot_json,cost_snapshot_json,
         last_committed_sequence,revision,created_at,updated_at
       ) VALUES(?,?,1,1,1,?,1,1,1,?,?,?,?,?,?,?,?,?,?,1,1,?,?)`,
    )
    .run(
      COMBAT_ID,
      CAMPAIGN_ID,
      options.engineVersion ?? 1,
      '{"rngContractVersion":1,"streams":[]}',
      options.currentState ?? '{"combatInstanceId":"combat:persistence-schema"}',
      HASH_A,
      '{"requiredObjectiveIds":[],"completedObjectiveIds":[],"failedObjectiveIds":[]}',
      '{"reinforcements":[]}',
      options.pendingReaction
        ? '{"eventChainId":"chain-1","executedEventCount":7,"queue":[],"nextSequence":9}'
        : null,
      '{"maxTriggerDepth":16,"maxEventCount":1024}',
      options.pendingReaction ? '{"windowId":"reaction-window-1","status":"UNRESOLVED"}' : null,
      options.pendingReaction ? '{"resolutionContextId":"resolution-1"}' : null,
      '{"combatants":[]}',
      AT,
      AT,
    );
}

function row(database, sql, parameter) {
  return { ...database.prepare(sql).get(parameter) };
}

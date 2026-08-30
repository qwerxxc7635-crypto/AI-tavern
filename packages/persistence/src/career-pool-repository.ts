import { parseCareerPool, type CampaignId, type CareerPool } from '@ember-tavern/contracts';

import { PersistenceDataError } from './campaign-repository.js';
import { requireNumber, requireRecord, requireString } from './persistence-validation.js';
import type { TransactionalSqliteDatabase } from './sqlite-port.js';

export class CareerPoolRepository {
  public constructor(private readonly database: TransactionalSqliteDatabase) {}

  public get(campaignId: CampaignId): CareerPool | null {
    const row = this.database
      .prepare('SELECT * FROM career_pools WHERE campaign_id = ?')
      .get(campaignId);
    if (row === undefined) return null;
    const pool = mapPool(row);
    requireLockedConstitution(this.database, pool, true);
    return pool;
  }

  public require(campaignId: CampaignId): CareerPool {
    const pool = this.get(campaignId);
    if (pool === null) throw new PersistenceDataError('Career pool does not exist');
    return pool;
  }

  public save(pool: CareerPool, expectedRevision: number): CareerPool {
    const canonical = parseCareerPool(pool);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      throw new PersistenceDataError('Career pool expected revision is invalid');
    }
    if (canonical.revision !== expectedRevision + 1) {
      throw new PersistenceDataError('Career pool revision does not follow expected revision');
    }
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const current = this.get(canonical.campaignId);
      if ((current?.revision ?? 0) !== expectedRevision) {
        throw new PersistenceDataError('Career pool revision drift');
      }
      requireLockedConstitution(this.database, canonical, false);
      if (current === null) {
        this.database
          .prepare(
            `INSERT INTO career_pools (
               campaign_id, schema_version, constitution_revision, pool_json,
               revision, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            canonical.campaignId,
            canonical.schemaVersion,
            canonical.constitutionRevision,
            JSON.stringify(canonical),
            canonical.revision,
            canonical.createdAt,
            canonical.updatedAt,
          );
      } else {
        if (
          current.createdAt !== canonical.createdAt ||
          current.constitutionRevision !== canonical.constitutionRevision
        ) {
          throw new PersistenceDataError('Career pool identity is immutable');
        }
        const changed = this.database
          .prepare(
            `UPDATE career_pools
             SET pool_json = ?, revision = ?, updated_at = ?
             WHERE campaign_id = ? AND revision = ?`,
          )
          .run(
            JSON.stringify(canonical),
            canonical.revision,
            canonical.updatedAt,
            canonical.campaignId,
            expectedRevision,
          ).changes;
        if (changed !== 1) throw new PersistenceDataError('Career pool revision drift');
      }
      const saved = this.require(canonical.campaignId);
      this.database.exec('COMMIT');
      return saved;
    } catch (error) {
      try {
        this.database.exec('ROLLBACK');
      } catch (rollbackError) {
        throw new PersistenceDataError('Career pool transaction and rollback both failed', {
          cause: new AggregateError([error, rollbackError]),
        });
      }
      if (error instanceof PersistenceDataError) throw error;
      throw new PersistenceDataError('Career pool persistence failed', { cause: error });
    }
  }
}

function mapPool(value: unknown): CareerPool {
  try {
    const row = requireRecord(value, 'Career pool row');
    const pool = parseCareerPool(
      JSON.parse(requireString(row['pool_json'], 'pool_json')) as unknown,
    );
    if (
      pool.campaignId !== requireString(row['campaign_id'], 'campaign_id') ||
      pool.schemaVersion !== requireNumber(row['schema_version'], 'schema_version') ||
      pool.constitutionRevision !==
        requireNumber(row['constitution_revision'], 'constitution_revision') ||
      pool.revision !== requireNumber(row['revision'], 'revision') ||
      pool.createdAt !== requireString(row['created_at'], 'created_at') ||
      pool.updatedAt !== requireString(row['updated_at'], 'updated_at')
    ) {
      throw new PersistenceDataError('Career pool columns disagree with pool JSON');
    }
    return pool;
  } catch (error) {
    if (error instanceof PersistenceDataError) throw error;
    throw new PersistenceDataError('Persisted career pool is invalid', { cause: error });
  }
}

function requireLockedConstitution(
  database: TransactionalSqliteDatabase,
  pool: CareerPool,
  verifyEvidence: boolean,
): void {
  const row = database
    .prepare(
      `SELECT revision, career_rules, society, technology, economy
       FROM world_constitutions
       WHERE campaign_id = ? AND revision = ? AND status = 'LOCKED'`,
    )
    .get(pool.campaignId, pool.constitutionRevision);
  if (row === undefined) {
    throw new PersistenceDataError('Career pool requires the locked Constitution revision');
  }
  const constitution = requireRecord(row, 'Locked Constitution');
  requireNumber(constitution['revision'], 'revision');
  if (!verifyEvidence) return;
  const evidence = {
    careerRules: requireString(constitution['career_rules'], 'career_rules'),
    society: requireString(constitution['society'], 'society'),
    technology: requireString(constitution['technology'], 'technology'),
    economy: requireString(constitution['economy'], 'economy'),
  };
  if (
    pool.careers.some(
      (career) =>
        career.constitutionEvidence.careerRules !== evidence.careerRules ||
        career.constitutionEvidence.society !== evidence.society ||
        career.constitutionEvidence.technology !== evidence.technology ||
        career.constitutionEvidence.economy !== evidence.economy,
    )
  ) {
    throw new PersistenceDataError('Career pool evidence disagrees with the locked Constitution');
  }
}

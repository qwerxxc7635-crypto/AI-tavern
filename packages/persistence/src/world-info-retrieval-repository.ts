import {
  LORE_MATCH_MODES,
  RETRIEVAL_ENTITY_KINDS,
  campaignId,
  createWorldInfoRetrievalQuery,
  createWorldLoreRetrievalRule,
  isoTimestamp,
  locationId,
  questId,
  worldLoreEntryId,
  type CampaignId,
  type RetrievalEntityKind,
  type RetrievalEntityRef,
  type WorldInfoCandidateSource,
  type WorldInfoRetrievalCorpus,
  type WorldInfoRetrievalQuery,
  type WorldLoreRetrievalRule,
} from '@ember-tavern/contracts';

import { PersistenceDataError } from './campaign-repository.js';
import { MemoryLayerRepository } from './memory-layer-repository.js';
import {
  parseJson,
  requireArray,
  requireEnum,
  requireNumber,
  requireRecord,
  requireString,
  requireStringArray,
} from './persistence-validation.js';
import type { SqliteValue, TransactionalSqliteDatabase } from './sqlite-port.js';

const MAX_RULES = 512;

export class WorldInfoRetrievalRepository implements WorldInfoCandidateSource {
  private readonly memoryLayers: MemoryLayerRepository;

  public constructor(private readonly database: TransactionalSqliteDatabase) {
    this.memoryLayers = new MemoryLayerRepository(database);
  }

  public saveRule(
    ruleInput: WorldLoreRetrievalRule,
    expectedRevision: number,
  ): WorldLoreRetrievalRule {
    const rule = createWorldLoreRetrievalRule(ruleInput);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      throw new PersistenceDataError('Lore retrieval expected revision is invalid');
    }
    if (rule.revision !== expectedRevision + 1) {
      throw new PersistenceDataError('Lore retrieval revision does not follow expected revision');
    }
    return this.inTransaction(() => {
      const lore = this.memoryLayers.getWorldLore(rule.loreEntryId);
      if (lore === null || lore.campaignId !== rule.campaignId) {
        throw new PersistenceDataError('Lore retrieval rule belongs to another campaign');
      }
      this.requireReferences(rule.campaignId, rule.entityRefs, rule.locationIds, rule.questIds);
      const current = this.getRule(rule.loreEntryId);
      if (current === null) {
        if (expectedRevision !== 0) {
          throw new PersistenceDataError('Lore retrieval expected revision drift');
        }
        this.insertRule(rule);
      } else {
        if (current.campaignId !== rule.campaignId || current.revision !== expectedRevision) {
          throw new PersistenceDataError('Lore retrieval expected revision drift');
        }
        this.updateRule(rule);
      }
      return this.requireRule(rule.loreEntryId);
    });
  }

  public getRule(loreId: WorldLoreRetrievalRule['loreEntryId']): WorldLoreRetrievalRule | null {
    const row = this.database
      .prepare('SELECT * FROM world_lore_retrieval_rules WHERE lore_entry_id = ?')
      .get(loreId);
    return row === undefined ? null : mapRule(row);
  }

  public requireRule(loreId: WorldLoreRetrievalRule['loreEntryId']): WorldLoreRetrievalRule {
    const rule = this.getRule(loreId);
    if (rule === null)
      throw new PersistenceDataError(`World Lore retrieval rule not found: ${loreId}`);
    return rule;
  }

  public listRules(campaign: CampaignId): readonly WorldLoreRetrievalRule[] {
    const rows = this.database
      .prepare(
        `SELECT * FROM world_lore_retrieval_rules
         WHERE campaign_id = ? ORDER BY priority DESC, lore_entry_id LIMIT ?`,
      )
      .all(campaign, MAX_RULES + 1);
    if (rows.length > MAX_RULES) {
      throw new PersistenceDataError('World Lore retrieval rule projection exceeds the limit');
    }
    return Object.freeze(rows.map(mapRule));
  }

  public loadWorldInfoCorpus(queryInput: WorldInfoRetrievalQuery): WorldInfoRetrievalCorpus {
    const query = createWorldInfoRetrievalQuery(queryInput);
    this.requireReferences(query.campaignId, query.entityRefs, query.locationIds, query.questIds);
    const rules = new Map(
      this.listRules(query.campaignId).map((rule) => [rule.loreEntryId, rule] as const),
    );
    const candidates = this.memoryLayers.listWorldLore(query.campaignId).map((lore) =>
      Object.freeze({
        lore,
        rule: rules.get(lore.id) ?? null,
        current: this.memoryLayers.inspectWorldLore(lore.id).status === 'CURRENT',
      }),
    );
    return Object.freeze({ campaignId: query.campaignId, candidates: Object.freeze(candidates) });
  }

  private insertRule(rule: WorldLoreRetrievalRule): void {
    this.database
      .prepare(
        `INSERT INTO world_lore_retrieval_rules (
           lore_entry_id,campaign_id,keywords_json,entity_refs_json,location_ids_json,
           quest_ids_json,always_active,match_mode,priority,token_budget,enabled,revision,updated_at
         ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(...ruleValues(rule));
  }

  private updateRule(rule: WorldLoreRetrievalRule): void {
    this.database
      .prepare(
        `UPDATE world_lore_retrieval_rules SET
           keywords_json=?,entity_refs_json=?,location_ids_json=?,quest_ids_json=?,always_active=?,
           match_mode=?,priority=?,token_budget=?,enabled=?,revision=?,updated_at=?
         WHERE lore_entry_id=?`,
      )
      .run(
        JSON.stringify(rule.keywords),
        JSON.stringify(rule.entityRefs),
        JSON.stringify(rule.locationIds),
        JSON.stringify(rule.questIds),
        Number(rule.alwaysActive),
        rule.matchMode,
        rule.priority,
        rule.tokenBudget,
        Number(rule.enabled),
        rule.revision,
        rule.updatedAt,
        rule.loreEntryId,
      );
  }

  private requireReferences(
    campaign: CampaignId,
    entities: readonly RetrievalEntityRef[],
    locations: readonly string[],
    quests: readonly string[],
  ): void {
    for (const entity of entities) {
      const policy = ENTITY_POLICIES[entity.kind];
      const row = this.database.prepare(policy.query).get(entity.id, campaign);
      if (row === undefined) {
        throw new PersistenceDataError(`Retrieval entity is outside the campaign: ${entity.kind}`);
      }
    }
    for (const id of locations) {
      const row = this.database
        .prepare(
          `SELECT 1 AS present FROM dynamic_locations WHERE id=? AND campaign_id=?
           UNION SELECT 1 FROM taverns WHERE location_id=? AND campaign_id=?
           UNION SELECT 1 FROM world_facts WHERE location_id=? AND campaign_id=?`,
        )
        .get(id, campaign, id, campaign, id, campaign);
      if (row === undefined) {
        throw new PersistenceDataError('Retrieval location is outside the campaign');
      }
    }
    for (const id of quests) {
      const row = this.database
        .prepare('SELECT 1 AS present FROM quests WHERE id=? AND campaign_id=?')
        .get(id, campaign);
      if (row === undefined)
        throw new PersistenceDataError('Retrieval Quest is outside the campaign');
    }
  }

  private inTransaction<Value>(operation: () => Value): Value {
    this.database.exec('SAVEPOINT world_info_retrieval');
    try {
      const value = operation();
      this.database.exec('RELEASE SAVEPOINT world_info_retrieval');
      return value;
    } catch (error) {
      try {
        this.database.exec('ROLLBACK TO SAVEPOINT world_info_retrieval');
        this.database.exec('RELEASE SAVEPOINT world_info_retrieval');
      } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], 'World Info retrieval rollback failed', {
          cause: rollbackError,
        });
      }
      throw error;
    }
  }
}

const ENTITY_POLICIES: Readonly<Record<RetrievalEntityKind, { readonly query: string }>> =
  Object.freeze({
    NPC: { query: 'SELECT 1 AS present FROM npcs WHERE id=? AND campaign_id=?' },
    PLAYER_CHARACTER: {
      query: 'SELECT 1 AS present FROM player_characters WHERE id=? AND campaign_id=?',
    },
    FACTION: { query: 'SELECT 1 AS present FROM active_factions WHERE id=? AND campaign_id=?' },
    ITEM: { query: 'SELECT 1 AS present FROM items WHERE id=? AND campaign_id=?' },
    WORLD_FACT: { query: 'SELECT 1 AS present FROM world_facts WHERE id=? AND campaign_id=?' },
  });

function ruleValues(rule: WorldLoreRetrievalRule): readonly SqliteValue[] {
  return [
    rule.loreEntryId,
    rule.campaignId,
    JSON.stringify(rule.keywords),
    JSON.stringify(rule.entityRefs),
    JSON.stringify(rule.locationIds),
    JSON.stringify(rule.questIds),
    Number(rule.alwaysActive),
    rule.matchMode,
    rule.priority,
    rule.tokenBudget,
    Number(rule.enabled),
    rule.revision,
    rule.updatedAt,
  ];
}

function mapRule(value: unknown): WorldLoreRetrievalRule {
  const row = requireRecord(value, 'World Lore retrieval row');
  return createWorldLoreRetrievalRule({
    loreEntryId: worldLoreEntryId(requireString(row['lore_entry_id'], 'lore_entry_id')),
    campaignId: campaignId(requireString(row['campaign_id'], 'campaign_id')),
    keywords: requireStringArray(parseJson(row['keywords_json'], 'keywords_json'), 'keywords'),
    entityRefs: mapEntityRefs(parseJson(row['entity_refs_json'], 'entity_refs_json')),
    locationIds: requireStringArray(
      parseJson(row['location_ids_json'], 'location_ids_json'),
      'location IDs',
    ).map(locationId),
    questIds: requireStringArray(
      parseJson(row['quest_ids_json'], 'quest_ids_json'),
      'Quest IDs',
    ).map(questId),
    alwaysActive: booleanInteger(row['always_active'], 'always_active'),
    matchMode: requireEnum(LORE_MATCH_MODES, row['match_mode'], 'match_mode'),
    priority: integer(row['priority'], 'priority'),
    tokenBudget: integer(row['token_budget'], 'token_budget'),
    enabled: booleanInteger(row['enabled'], 'enabled'),
    revision: integer(row['revision'], 'revision'),
    updatedAt: isoTimestamp(requireString(row['updated_at'], 'updated_at')),
  });
}

function mapEntityRefs(value: unknown): readonly RetrievalEntityRef[] {
  return Object.freeze(
    requireArray(value, 'entity refs').map((entry, index) => {
      const row = requireRecord(entry, `entity refs[${index}]`);
      const keys = Object.keys(row).sort();
      if (keys.length !== 2 || keys[0] !== 'id' || keys[1] !== 'kind') {
        throw new PersistenceDataError('Retrieval entity ref contains unknown fields');
      }
      return Object.freeze({
        kind: requireEnum(RETRIEVAL_ENTITY_KINDS, row['kind'], 'entity kind'),
        id: requireString(row['id'], 'entity ID'),
      });
    }),
  );
}

function booleanInteger(value: unknown, label: string): boolean {
  const number = integer(value, label);
  if (number !== 0 && number !== 1) throw new PersistenceDataError(`${label} must be 0 or 1`);
  return number === 1;
}

function integer(value: unknown, label: string): number {
  const number = requireNumber(value, label);
  if (!Number.isSafeInteger(number)) throw new PersistenceDataError(`${label} must be an integer`);
  return number;
}

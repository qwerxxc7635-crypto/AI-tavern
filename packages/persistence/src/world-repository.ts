import {
  WORLD_BIBLE_LOCKABLE_FIELDS,
  RUMOR_SOURCE_BASES,
  campaignId,
  claimId,
  createClaimFromRumor,
  factionId,
  isoTimestamp,
  locationId,
  npcId,
  schemaVersion,
  worldFactId,
  type CampaignId,
  type Faction,
  type Location,
  type WorldBible,
  type WorldFact,
  type WorldFactId,
} from '@ember-tavern/contracts';

import { PersistenceDataError } from './campaign-repository.js';
import {
  parseJson,
  requireArray,
  requireEnum,
  requireNullableString,
  requireNumber,
  requireRecord,
  requireString,
  requireStringArray,
} from './persistence-validation.js';
import type { SqliteDatabase } from './sqlite-port.js';

const FACT_KINDS = [
  'LOCKED_RULE',
  'DEVELOPING_FACT',
  'TEMPORARY_NARRATIVE',
  'RUMOR',
  'FALSE_BELIEF',
] as const;
const FACTION_DISPOSITIONS = ['ALLY', 'FRIENDLY', 'NEUTRAL', 'HOSTILE', 'WAR'] as const;
const RUMOR_VERACITIES = ['UNKNOWN', 'TRUE', 'PARTIAL', 'FALSE'] as const;

export class WorldRepository {
  public constructor(private readonly database: SqliteDatabase) {}

  public saveBible(world: WorldBible): void {
    const current = this.getBible(world.campaignId);
    if (current !== null && current.createdAt !== world.createdAt) {
      throw new PersistenceDataError('WorldBible createdAt cannot be changed');
    }
    this.database
      .prepare(
        `INSERT INTO world_bibles (
           campaign_id, schema_version, name, current_region, summary, core_conflict,
           technology_level, power_rules_json, factions_json, locations_json,
           narrative_style, forbidden_elements_json, tavern_reason, story_hooks_json,
           locked_fields_json, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(campaign_id) DO UPDATE SET
           schema_version = excluded.schema_version,
           name = excluded.name,
           current_region = excluded.current_region,
           summary = excluded.summary,
           core_conflict = excluded.core_conflict,
           technology_level = excluded.technology_level,
           power_rules_json = excluded.power_rules_json,
           factions_json = excluded.factions_json,
           locations_json = excluded.locations_json,
           narrative_style = excluded.narrative_style,
           forbidden_elements_json = excluded.forbidden_elements_json,
           tavern_reason = excluded.tavern_reason,
           story_hooks_json = excluded.story_hooks_json,
           locked_fields_json = excluded.locked_fields_json,
           updated_at = excluded.updated_at`,
      )
      .run(
        world.campaignId,
        world.schemaVersion,
        world.name,
        world.currentRegion,
        world.summary,
        world.coreConflict,
        world.technologyLevel,
        JSON.stringify(world.powerRules),
        JSON.stringify(world.factions),
        JSON.stringify(world.locations),
        world.narrativeStyle,
        JSON.stringify(world.forbiddenElements),
        world.tavernReason,
        JSON.stringify(world.storyHooks),
        JSON.stringify(world.lockedFields),
        world.createdAt,
        world.updatedAt,
      );
  }

  public getBible(id: CampaignId): WorldBible | null {
    const row = this.database.prepare('SELECT * FROM world_bibles WHERE campaign_id = ?').get(id);
    return row === undefined ? null : mapWorldBible(row);
  }

  public addFact(fact: WorldFact): void {
    if (fact.kind === 'RUMOR') {
      createClaimFromRumor(fact);
      const source = this.database
        .prepare('SELECT 1 FROM npcs WHERE id = ? AND campaign_id = ?')
        .get(fact.sourceNpcId, fact.campaignId);
      if (source === undefined) {
        throw new PersistenceDataError(
          `Rumor source NPC is outside the campaign: ${fact.sourceNpcId}`,
        );
      }
    }
    const stored = factStorage(fact);
    this.database
      .prepare(
        `INSERT INTO world_facts (
           id, campaign_id, kind, statement, location_id, faction_ids_json,
           detail_json, supersedes_fact_id, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        fact.id,
        fact.campaignId,
        fact.kind,
        fact.statement,
        fact.locationId,
        JSON.stringify(fact.factionIds),
        JSON.stringify(stored.detail),
        stored.supersedesFactId,
        fact.createdAt,
      );
  }

  public getFact(id: WorldFactId): WorldFact | null {
    const row = this.database.prepare('SELECT * FROM world_facts WHERE id = ?').get(id);
    if (row === undefined) return null;
    const fact = mapWorldFact(row);
    this.validateRumorSource(fact);
    return fact;
  }

  public listFacts(id: CampaignId): readonly WorldFact[] {
    const facts = this.database
      .prepare(
        `SELECT * FROM world_facts
           WHERE campaign_id = ?
           ORDER BY created_at, id`,
      )
      .all(id)
      .map(mapWorldFact);
    for (const fact of facts) this.validateRumorSource(fact);
    return Object.freeze(facts);
  }

  private validateRumorSource(fact: WorldFact): void {
    if (fact.kind !== 'RUMOR') return;
    const source = this.database
      .prepare('SELECT 1 FROM npcs WHERE id = ? AND campaign_id = ?')
      .get(fact.sourceNpcId, fact.campaignId);
    if (source === undefined) {
      throw new PersistenceDataError(
        `Rumor source NPC is outside the campaign: ${fact.sourceNpcId}`,
      );
    }
  }
}

function mapWorldBible(value: unknown): WorldBible {
  try {
    const row = requireRecord(value, 'WorldBible row');
    return Object.freeze({
      campaignId: campaignId(requireString(row['campaign_id'], 'campaign_id')),
      schemaVersion: schemaVersion(requireNumber(row['schema_version'], 'schema_version')),
      name: requireString(row['name'], 'name'),
      currentRegion: requireString(row['current_region'], 'current_region'),
      summary: requireString(row['summary'], 'summary'),
      coreConflict: requireString(row['core_conflict'], 'core_conflict'),
      technologyLevel: requireString(row['technology_level'], 'technology_level'),
      powerRules: requireStringArray(
        parseJson(row['power_rules_json'], 'power_rules_json'),
        'powerRules',
      ),
      factions: parseFactions(parseJson(row['factions_json'], 'factions_json')),
      locations: parseLocations(parseJson(row['locations_json'], 'locations_json')),
      narrativeStyle: requireString(row['narrative_style'], 'narrative_style'),
      forbiddenElements: requireStringArray(
        parseJson(row['forbidden_elements_json'], 'forbidden_elements_json'),
        'forbiddenElements',
      ),
      tavernReason: requireString(row['tavern_reason'], 'tavern_reason'),
      storyHooks: requireStringArray(
        parseJson(row['story_hooks_json'], 'story_hooks_json'),
        'storyHooks',
      ),
      lockedFields: Object.freeze(
        requireArray(
          parseJson(row['locked_fields_json'], 'locked_fields_json'),
          'lockedFields',
        ).map((entry, index) =>
          requireEnum(WORLD_BIBLE_LOCKABLE_FIELDS, entry, `lockedFields[${index}]`),
        ),
      ),
      createdAt: isoTimestamp(requireString(row['created_at'], 'created_at')),
      updatedAt: isoTimestamp(requireString(row['updated_at'], 'updated_at')),
    });
  } catch (error) {
    if (error instanceof PersistenceDataError) throw error;
    throw new PersistenceDataError('Persisted WorldBible row is invalid', { cause: error });
  }
}

function parseFactions(value: unknown): readonly Faction[] {
  return Object.freeze(
    requireArray(value, 'factions').map((entry, index) => {
      const row = requireRecord(entry, `factions[${index}]`);
      return Object.freeze({
        id: factionId(requireString(row['id'], `factions[${index}].id`)),
        name: requireString(row['name'], `factions[${index}].name`),
        description: requireString(row['description'], `factions[${index}].description`),
        goals: requireStringArray(row['goals'], `factions[${index}].goals`),
        relations: Object.freeze(
          requireArray(row['relations'], `factions[${index}].relations`).map(
            (relation, relationIndex) => {
              const relationRow = requireRecord(
                relation,
                `factions[${index}].relations[${relationIndex}]`,
              );
              return Object.freeze({
                factionId: factionId(
                  requireString(
                    relationRow['factionId'],
                    `factions[${index}].relations[${relationIndex}].factionId`,
                  ),
                ),
                disposition: requireEnum(
                  FACTION_DISPOSITIONS,
                  relationRow['disposition'],
                  `factions[${index}].relations[${relationIndex}].disposition`,
                ),
                summary: requireString(
                  relationRow['summary'],
                  `factions[${index}].relations[${relationIndex}].summary`,
                ),
              });
            },
          ),
        ),
      });
    }),
  );
}

function parseLocations(value: unknown): readonly Location[] {
  return Object.freeze(
    requireArray(value, 'locations').map((entry, index) => {
      const row = requireRecord(entry, `locations[${index}]`);
      const parent = requireNullableString(row['parentLocationId'], `locations[${index}].parent`);
      return Object.freeze({
        id: locationId(requireString(row['id'], `locations[${index}].id`)),
        name: requireString(row['name'], `locations[${index}].name`),
        description: requireString(row['description'], `locations[${index}].description`),
        parentLocationId: parent === null ? null : locationId(parent),
        factionIds: Object.freeze(
          requireArray(row['factionIds'], `locations[${index}].factionIds`).map(
            (id, factionIndex) =>
              factionId(requireString(id, `locations[${index}].factionIds[${factionIndex}]`)),
          ),
        ),
      });
    }),
  );
}

function factStorage(fact: WorldFact): {
  readonly detail: Readonly<Record<string, unknown>>;
  readonly supersedesFactId: WorldFactId | null;
} {
  switch (fact.kind) {
    case 'LOCKED_RULE':
      return { detail: { field: fact.field }, supersedesFactId: null };
    case 'DEVELOPING_FACT':
      return { detail: {}, supersedesFactId: fact.supersedesFactId };
    case 'TEMPORARY_NARRATIVE':
      return { detail: { expiresAt: fact.expiresAt }, supersedesFactId: null };
    case 'RUMOR':
      return {
        detail: {
          claimId: fact.claimId,
          sourceNpcId: fact.sourceNpcId,
          sourceBasis: fact.sourceBasis,
          confidence: fact.confidence,
          claimRevision: fact.claimRevision,
          veracity: fact.veracity,
        },
        supersedesFactId: null,
      };
    case 'FALSE_BELIEF':
      return { detail: { believedByNpcIds: fact.believedByNpcIds }, supersedesFactId: null };
  }
}

function mapWorldFact(value: unknown): WorldFact {
  try {
    const row = requireRecord(value, 'WorldFact row');
    const base = {
      id: worldFactId(requireString(row['id'], 'id')),
      campaignId: campaignId(requireString(row['campaign_id'], 'campaign_id')),
      statement: requireString(row['statement'], 'statement'),
      locationId: nullableLocation(row['location_id']),
      factionIds: Object.freeze(
        requireArray(parseJson(row['faction_ids_json'], 'faction_ids_json'), 'factionIds').map(
          (id, index) => factionId(requireString(id, `factionIds[${index}]`)),
        ),
      ),
      createdAt: isoTimestamp(requireString(row['created_at'], 'created_at')),
    };
    const kind = requireEnum(FACT_KINDS, row['kind'], 'kind');
    const detail = requireRecord(parseJson(row['detail_json'], 'detail_json'), 'detail');
    switch (kind) {
      case 'LOCKED_RULE':
        return Object.freeze({
          ...base,
          kind,
          field: requireEnum(WORLD_BIBLE_LOCKABLE_FIELDS, detail['field'], 'detail.field'),
        });
      case 'DEVELOPING_FACT': {
        const supersedes = requireNullableString(row['supersedes_fact_id'], 'supersedes_fact_id');
        return Object.freeze({
          ...base,
          kind,
          supersedesFactId: supersedes === null ? null : worldFactId(supersedes),
        });
      }
      case 'TEMPORARY_NARRATIVE': {
        const expiresAt = requireNullableString(detail['expiresAt'], 'detail.expiresAt');
        return Object.freeze({
          ...base,
          kind,
          expiresAt: expiresAt === null ? null : isoTimestamp(expiresAt),
        });
      }
      case 'RUMOR': {
        const confidence = requireNumber(detail['confidence'], 'detail.confidence');
        const claimRevision = requireNumber(detail['claimRevision'], 'detail.claimRevision');
        if (
          confidence < 0 ||
          confidence > 1 ||
          !Number.isInteger(claimRevision) ||
          claimRevision < 1
        ) {
          throw new PersistenceDataError('Rumor claim confidence or revision is invalid');
        }
        return Object.freeze({
          ...base,
          kind,
          claimId: claimId(requireString(detail['claimId'], 'detail.claimId')),
          sourceNpcId: npcId(requireString(detail['sourceNpcId'], 'detail.sourceNpcId')),
          sourceBasis: requireEnum(RUMOR_SOURCE_BASES, detail['sourceBasis'], 'detail.sourceBasis'),
          confidence,
          claimRevision,
          veracity: requireEnum(RUMOR_VERACITIES, detail['veracity'], 'detail.veracity'),
        });
      }
      case 'FALSE_BELIEF':
        return Object.freeze({
          ...base,
          kind,
          believedByNpcIds: Object.freeze(
            requireArray(detail['believedByNpcIds'], 'detail.believedByNpcIds').map((id, index) =>
              npcId(requireString(id, `detail.believedByNpcIds[${index}]`)),
            ),
          ),
        });
    }
  } catch (error) {
    if (error instanceof PersistenceDataError) throw error;
    throw new PersistenceDataError('Persisted WorldFact row is invalid', { cause: error });
  }
}

function nullableLocation(value: unknown) {
  const id = requireNullableString(value, 'location_id');
  return id === null ? null : locationId(id);
}

import {
  adventureId,
  campaignId,
  createNpcKnowledge,
  createNpcRelationship,
  gameEventId,
  isoTimestamp,
  locationId,
  npcId,
  npcMemoryId,
  playerCharacterId,
  tavernChangeId,
  tavernId,
  turnId,
  worldFactId,
  type NpcKnowledge,
  type NpcKnowledgeProvenance,
  type NpcMemory,
  type NpcProfile,
  type NpcRelationship,
  type TemporaryVisitor,
  type Tavern,
  type TavernChange,
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
import type { SqliteDatabase, SqliteRunResult } from './sqlite-port.js';

const NPC_RESIDENCIES = ['OWNER', 'RESIDENT', 'TEMPORARY_VISITOR'] as const;
const NPC_STATUSES = ['ACTIVE', 'ABSENT', 'LEFT', 'DECEASED'] as const;
const NPC_KNOWLEDGE_STATES = ['KNOWN', 'SUSPECTED', 'BELIEVED'] as const;
const NPC_KNOWLEDGE_SOURCES = [
  'LOCAL_RULE',
  'OBSERVATION',
  'COMMUNICATION',
  'INFERENCE',
  'IMPORT',
] as const;
const TAVERN_CHANGE_KINDS = ['TROPHY', 'MENU', 'DAMAGE', 'DECORATION', 'LAYOUT', 'OTHER'] as const;

export class TavernRepository {
  public constructor(private readonly database: SqliteDatabase) {}

  public create(tavern: Tavern): void {
    this.database
      .prepare(
        `INSERT INTO taverns (
           id, campaign_id, location_id, name, position, environment,
           special_rules_json, long_term_problem, owner_npc_id, changes_json,
           created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, '[]', ?, ?)`,
      )
      .run(
        tavern.id,
        tavern.campaignId,
        tavern.locationId,
        tavern.name,
        tavern.position,
        tavern.environment,
        JSON.stringify(tavern.specialRules),
        tavern.longTermProblem,
        tavern.createdAt,
        tavern.updatedAt,
      );
  }

  public assignOwner(id: Tavern['id'], ownerId: Tavern['ownerNpcId']): void {
    requireOneChange(
      this.database
        .prepare(
          `UPDATE taverns
           SET owner_npc_id = ?
           WHERE id = ?`,
        )
        .run(ownerId, id),
      `Tavern not found: ${id}`,
    );
  }

  public update(tavern: Tavern): void {
    const current = this.get(tavern.id);
    if (current === null) throw new PersistenceDataError(`Tavern not found: ${tavern.id}`);
    if (
      current.campaignId !== tavern.campaignId ||
      current.locationId !== tavern.locationId ||
      current.createdAt !== tavern.createdAt
    ) {
      throw new PersistenceDataError('Tavern campaignId, locationId and createdAt cannot change');
    }
    requireOneChange(
      this.database
        .prepare(
          `UPDATE taverns SET
             name = ?, position = ?, environment = ?, special_rules_json = ?,
             long_term_problem = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(
          tavern.name,
          tavern.position,
          tavern.environment,
          JSON.stringify(tavern.specialRules),
          tavern.longTermProblem,
          tavern.updatedAt,
          tavern.id,
        ),
      `Tavern not found: ${tavern.id}`,
    );
  }

  public get(id: Tavern['id']): Tavern | null {
    const row = this.database.prepare('SELECT * FROM taverns WHERE id = ?').get(id);
    if (row === undefined) return null;
    const stored = requireRecord(row, 'Tavern row');
    const owner = requireNullableString(stored['owner_npc_id'], 'owner_npc_id');
    if (owner === null) {
      throw new PersistenceDataError(`Tavern owner is not assigned: ${id}`);
    }
    const npcRows = this.database
      .prepare(
        `SELECT id, residency
         FROM npcs
         WHERE tavern_id = ?
         ORDER BY created_at, id`,
      )
      .all(id);
    const residents: ReturnType<typeof npcId>[] = [];
    const visitors: ReturnType<typeof npcId>[] = [];
    for (const value of npcRows) {
      const npc = requireRecord(value, 'Tavern NPC row');
      const storedId = npcId(requireString(npc['id'], 'npc.id'));
      const residency = requireEnum(NPC_RESIDENCIES, npc['residency'], 'npc.residency');
      if (residency === 'TEMPORARY_VISITOR') visitors.push(storedId);
      else residents.push(storedId);
    }
    try {
      return Object.freeze({
        id: tavernId(requireString(stored['id'], 'id')),
        campaignId: campaignId(requireString(stored['campaign_id'], 'campaign_id')),
        locationId: locationId(requireString(stored['location_id'], 'location_id')),
        name: requireString(stored['name'], 'name'),
        position: requireString(stored['position'], 'position'),
        environment: requireString(stored['environment'], 'environment'),
        specialRules: requireStringArray(
          parseJson(stored['special_rules_json'], 'special_rules_json'),
          'specialRules',
        ),
        longTermProblem: requireString(stored['long_term_problem'], 'long_term_problem'),
        ownerNpcId: npcId(owner),
        residentNpcIds: Object.freeze(residents),
        visitorNpcIds: Object.freeze(visitors),
        createdAt: isoTimestamp(requireString(stored['created_at'], 'created_at')),
        updatedAt: isoTimestamp(requireString(stored['updated_at'], 'updated_at')),
      });
    } catch (error) {
      if (error instanceof PersistenceDataError) throw error;
      throw new PersistenceDataError('Persisted Tavern row is invalid', { cause: error });
    }
  }

  public appendChange(change: TavernChange): void {
    const row = this.database
      .prepare('SELECT changes_json FROM taverns WHERE id = ?')
      .get(change.tavernId);
    if (row === undefined) throw new PersistenceDataError(`Tavern not found: ${change.tavernId}`);
    const stored = requireRecord(row, 'Tavern changes row');
    const changes = parseTavernChanges(parseJson(stored['changes_json'], 'changes_json'));
    this.database
      .prepare('UPDATE taverns SET changes_json = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify([...changes, change]), change.occurredAt, change.tavernId);
  }

  public listChanges(id: Tavern['id']): readonly TavernChange[] {
    const row = this.database.prepare('SELECT changes_json FROM taverns WHERE id = ?').get(id);
    if (row === undefined) return Object.freeze([]);
    return parseTavernChanges(
      parseJson(requireRecord(row, 'Tavern changes row')['changes_json'], 'changes_json'),
    );
  }
}

export class NpcRepository {
  public constructor(private readonly database: SqliteDatabase) {}

  public create(profile: NpcProfile, visitor: TemporaryVisitor | null = null): void {
    if ((profile.residency === 'TEMPORARY_VISITOR') !== (visitor !== null)) {
      throw new PersistenceDataError('Temporary visitor details must match NPC residency');
    }
    if (
      visitor !== null &&
      (visitor.npcId !== profile.id || visitor.tavernId !== profile.tavernId)
    ) {
      throw new PersistenceDataError('Temporary visitor identifiers must match the NPC profile');
    }
    this.database
      .prepare(
        `INSERT INTO npcs (
           id, campaign_id, tavern_id, residency, name, identity, appearance,
           personality, goal, secret, speech_style, current_mood, current_status,
           visit_json, memories_json, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?)`,
      )
      .run(
        profile.id,
        profile.campaignId,
        profile.tavernId,
        profile.residency,
        profile.name,
        profile.identity,
        profile.appearance,
        profile.personality,
        profile.goal,
        profile.secret,
        profile.speechStyle,
        profile.currentMood,
        profile.currentStatus,
        visitor === null ? null : JSON.stringify(visitor),
        profile.createdAt,
        profile.updatedAt,
      );
  }

  public get(id: NpcProfile['id']): NpcProfile | null {
    const row = this.database.prepare('SELECT * FROM npcs WHERE id = ?').get(id);
    return row === undefined ? null : mapNpc(row);
  }

  public update(profile: NpcProfile): void {
    const current = this.get(profile.id);
    if (current === null) throw new PersistenceDataError(`NPC not found: ${profile.id}`);
    if (
      current.campaignId !== profile.campaignId ||
      current.tavernId !== profile.tavernId ||
      current.residency !== profile.residency ||
      current.createdAt !== profile.createdAt
    ) {
      throw new PersistenceDataError(
        'NPC campaignId, tavernId, residency and createdAt cannot change',
      );
    }
    requireOneChange(
      this.database
        .prepare(
          `UPDATE npcs SET
             name = ?, identity = ?, appearance = ?, personality = ?, goal = ?,
             secret = ?, speech_style = ?, current_mood = ?, current_status = ?,
             updated_at = ?
           WHERE id = ?`,
        )
        .run(
          profile.name,
          profile.identity,
          profile.appearance,
          profile.personality,
          profile.goal,
          profile.secret,
          profile.speechStyle,
          profile.currentMood,
          profile.currentStatus,
          profile.updatedAt,
          profile.id,
        ),
      `NPC not found: ${profile.id}`,
    );
  }

  public getVisitor(id: NpcProfile['id']): TemporaryVisitor | null {
    const row = this.database.prepare('SELECT visit_json FROM npcs WHERE id = ?').get(id);
    if (row === undefined) return null;
    const json = requireRecord(row, 'NPC visitor row')['visit_json'];
    if (json === null) return null;
    const visitor = mapVisitor(parseJson(json, 'visit_json'));
    if (visitor.npcId !== id) {
      throw new PersistenceDataError(`Visitor data belongs to another NPC: ${visitor.npcId}`);
    }
    return visitor;
  }

  public saveKnowledge(knowledge: NpcKnowledge, at: ReturnType<typeof isoTimestamp>): void {
    const canonical = createNpcKnowledge(knowledge);
    for (const entry of canonical.provenance) {
      if (entry.eventId === null) continue;
      const event = this.database
        .prepare(
          `SELECT 1 FROM game_events
           JOIN npcs ON npcs.campaign_id = game_events.campaign_id
           WHERE game_events.id = ? AND npcs.id = ?`,
        )
        .get(entry.eventId, canonical.npcId);
      if (event === undefined) {
        throw new PersistenceDataError(
          `Knowledge provenance event is outside the NPC campaign: ${entry.eventId}`,
        );
      }
    }
    this.database
      .prepare(
        `INSERT INTO npc_knowledge (
           npc_id, known_fact_ids_json, suspected_fact_ids_json,
           false_belief_fact_ids_json, excluded_secret_fact_ids_json,
           provenance_json, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(npc_id) DO UPDATE SET
           known_fact_ids_json = excluded.known_fact_ids_json,
           suspected_fact_ids_json = excluded.suspected_fact_ids_json,
           false_belief_fact_ids_json = excluded.false_belief_fact_ids_json,
           excluded_secret_fact_ids_json = excluded.excluded_secret_fact_ids_json,
           provenance_json = excluded.provenance_json,
           updated_at = excluded.updated_at`,
      )
      .run(
        canonical.npcId,
        JSON.stringify(canonical.knownFactIds),
        JSON.stringify(canonical.suspectedFactIds),
        JSON.stringify(canonical.falseBeliefFactIds),
        JSON.stringify(canonical.excludedSecretFactIds),
        JSON.stringify(canonical.provenance),
        at,
      );
  }

  public getKnowledge(id: NpcProfile['id']): NpcKnowledge | null {
    const row = this.database.prepare('SELECT * FROM npc_knowledge WHERE npc_id = ?').get(id);
    return row === undefined ? null : mapKnowledge(row);
  }

  public saveRelationship(
    relationship: NpcRelationship,
    at: ReturnType<typeof isoTimestamp>,
  ): void {
    this.database
      .prepare(
        `INSERT INTO npc_relationships (
           npc_id, player_character_id, trust, closeness, awe, obligation, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(npc_id) DO UPDATE SET
           player_character_id = excluded.player_character_id,
           trust = excluded.trust,
           closeness = excluded.closeness,
           awe = excluded.awe,
           obligation = excluded.obligation,
           updated_at = excluded.updated_at`,
      )
      .run(
        relationship.npcId,
        relationship.playerCharacterId,
        relationship.trust,
        relationship.closeness,
        relationship.awe,
        relationship.obligation,
        at,
      );
  }

  public getRelationship(id: NpcProfile['id']): NpcRelationship | null {
    const row = this.database.prepare('SELECT * FROM npc_relationships WHERE npc_id = ?').get(id);
    return row === undefined ? null : mapRelationship(row);
  }

  public appendMemory(memory: NpcMemory): void {
    const row = this.database
      .prepare('SELECT memories_json FROM npcs WHERE id = ?')
      .get(memory.npcId);
    if (row === undefined) throw new PersistenceDataError(`NPC not found: ${memory.npcId}`);
    const stored = requireRecord(row, 'NPC memories row');
    const memories = parseMemories(parseJson(stored['memories_json'], 'memories_json'));
    if (memories.some(({ id }) => id === memory.id)) {
      throw new PersistenceDataError(`NPC memory already exists: ${memory.id}`);
    }
    this.database
      .prepare('UPDATE npcs SET memories_json = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify([...memories, memory]), memory.createdAt, memory.npcId);
  }

  public listMemories(id: NpcProfile['id']): readonly NpcMemory[] {
    const row = this.database.prepare('SELECT memories_json FROM npcs WHERE id = ?').get(id);
    if (row === undefined) return Object.freeze([]);
    const memories = parseMemories(
      parseJson(requireRecord(row, 'NPC memories row')['memories_json'], 'memories_json'),
    );
    if (memories.some((memory) => memory.npcId !== id)) {
      throw new PersistenceDataError(`Memory data belongs to another NPC: ${id}`);
    }
    return memories;
  }
}

function mapNpc(value: unknown): NpcProfile {
  try {
    const row = requireRecord(value, 'NPC row');
    return Object.freeze({
      id: npcId(requireString(row['id'], 'id')),
      campaignId: campaignId(requireString(row['campaign_id'], 'campaign_id')),
      tavernId: tavernId(requireString(row['tavern_id'], 'tavern_id')),
      residency: requireEnum(NPC_RESIDENCIES, row['residency'], 'residency'),
      name: requireString(row['name'], 'name'),
      identity: requireString(row['identity'], 'identity'),
      appearance: requireString(row['appearance'], 'appearance'),
      personality: requireString(row['personality'], 'personality'),
      goal: requireString(row['goal'], 'goal'),
      secret: requireString(row['secret'], 'secret'),
      speechStyle: requireString(row['speech_style'], 'speech_style'),
      currentMood: requireString(row['current_mood'], 'current_mood'),
      currentStatus: requireEnum(NPC_STATUSES, row['current_status'], 'current_status'),
      createdAt: isoTimestamp(requireString(row['created_at'], 'created_at')),
      updatedAt: isoTimestamp(requireString(row['updated_at'], 'updated_at')),
    });
  } catch (error) {
    if (error instanceof PersistenceDataError) throw error;
    throw new PersistenceDataError('Persisted NPC row is invalid', { cause: error });
  }
}

function mapVisitor(value: unknown): TemporaryVisitor {
  const row = requireRecord(value, 'TemporaryVisitor');
  const departure = requireNullableString(row['plannedDepartureAt'], 'plannedDepartureAt');
  return Object.freeze({
    npcId: npcId(requireString(row['npcId'], 'npcId')),
    tavernId: tavernId(requireString(row['tavernId'], 'tavernId')),
    visitReason: requireString(row['visitReason'], 'visitReason'),
    arrivedAt: isoTimestamp(requireString(row['arrivedAt'], 'arrivedAt')),
    plannedDepartureAt: departure === null ? null : isoTimestamp(departure),
  });
}

function mapKnowledge(value: unknown): NpcKnowledge {
  try {
    const row = requireRecord(value, 'NpcKnowledge row');
    const ids = (key: string) =>
      Object.freeze(
        requireArray(parseJson(row[key], key), key).map((id, index) =>
          worldFactId(requireString(id, `${key}[${index}]`)),
        ),
      );
    return createNpcKnowledge({
      npcId: npcId(requireString(row['npc_id'], 'npc_id')),
      knownFactIds: ids('known_fact_ids_json'),
      suspectedFactIds: ids('suspected_fact_ids_json'),
      falseBeliefFactIds: ids('false_belief_fact_ids_json'),
      excludedSecretFactIds: ids('excluded_secret_fact_ids_json'),
      provenance: Object.freeze(
        requireArray(parseJson(row['provenance_json'], 'provenance_json'), 'provenance_json').map(
          (value, index): NpcKnowledgeProvenance => {
            const entry = requireRecord(value, `provenance_json[${index}]`);
            const rawEventId = requireNullableString(
              entry['eventId'],
              `provenance_json[${index}].eventId`,
            );
            return Object.freeze({
              factId: worldFactId(
                requireString(entry['factId'], `provenance_json[${index}].factId`),
              ),
              state: requireEnum(
                NPC_KNOWLEDGE_STATES,
                entry['state'],
                `provenance_json[${index}].state`,
              ),
              source: requireEnum(
                NPC_KNOWLEDGE_SOURCES,
                entry['source'],
                `provenance_json[${index}].source`,
              ),
              eventId: rawEventId === null ? null : gameEventId(rawEventId),
              learnedAt: isoTimestamp(
                requireString(entry['learnedAt'], `provenance_json[${index}].learnedAt`),
              ),
              confidence: requireNumber(
                entry['confidence'],
                `provenance_json[${index}].confidence`,
              ),
            });
          },
        ),
      ),
    });
  } catch (error) {
    if (error instanceof PersistenceDataError) throw error;
    throw new PersistenceDataError('Persisted NPC knowledge is invalid', { cause: error });
  }
}

function mapRelationship(value: unknown): NpcRelationship {
  const row = requireRecord(value, 'NpcRelationship row');
  return createNpcRelationship({
    npcId: npcId(requireString(row['npc_id'], 'npc_id')),
    playerCharacterId: playerCharacterId(
      requireString(row['player_character_id'], 'player_character_id'),
    ),
    trust: requireNumber(row['trust'], 'trust'),
    closeness: requireNumber(row['closeness'], 'closeness'),
    awe: requireNumber(row['awe'], 'awe'),
    obligation: requireNumber(row['obligation'], 'obligation'),
  });
}

function parseMemories(value: unknown): readonly NpcMemory[] {
  return Object.freeze(
    requireArray(value, 'memories').map((entry, index) => {
      const row = requireRecord(entry, `memories[${index}]`);
      return Object.freeze({
        id: npcMemoryId(requireString(row['id'], `memories[${index}].id`)),
        npcId: npcId(requireString(row['npcId'], `memories[${index}].npcId`)),
        summary: requireString(row['summary'], `memories[${index}].summary`),
        sourceTurnIds: Object.freeze(
          requireArray(row['sourceTurnIds'], `memories[${index}].sourceTurnIds`).map(
            (id, turnIndex) =>
              turnId(requireString(id, `memories[${index}].sourceTurnIds[${turnIndex}]`)),
          ),
        ),
        createdAt: isoTimestamp(requireString(row['createdAt'], `memories[${index}].createdAt`)),
      });
    }),
  );
}

function parseTavernChanges(value: unknown): readonly TavernChange[] {
  return Object.freeze(
    requireArray(value, 'tavernChanges').map((entry, index) => {
      const row = requireRecord(entry, `tavernChanges[${index}]`);
      const source = requireNullableString(
        row['sourceAdventureId'],
        `tavernChanges[${index}].sourceAdventureId`,
      );
      return Object.freeze({
        id: tavernChangeId(requireString(row['id'], `tavernChanges[${index}].id`)),
        tavernId: tavernId(requireString(row['tavernId'], `tavernChanges[${index}].tavernId`)),
        kind: requireEnum(TAVERN_CHANGE_KINDS, row['kind'], `tavernChanges[${index}].kind`),
        description: requireString(row['description'], `tavernChanges[${index}].description`),
        sourceAdventureId: source === null ? null : adventureId(source),
        occurredAt: isoTimestamp(
          requireString(row['occurredAt'], `tavernChanges[${index}].occurredAt`),
        ),
      });
    }),
  );
}

function requireOneChange(result: SqliteRunResult, message: string): void {
  if (result.changes !== 1 && result.changes !== 1n) {
    throw new PersistenceDataError(message);
  }
}

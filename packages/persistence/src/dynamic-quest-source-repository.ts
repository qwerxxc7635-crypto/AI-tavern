import { createHash } from 'node:crypto';

import {
  DYNAMIC_QUEST_ENTITY_KINDS,
  DYNAMIC_QUEST_SOURCE_KINDS,
  DYNAMIC_QUEST_VISIBILITIES,
  campaignId,
  generationRecordId,
  isoTimestamp,
  npcId,
  questId,
  worldFactId,
  type CampaignId,
  type DynamicQuestPreparation,
  type DynamicQuestProvenance,
  type DynamicQuestRelevantFact,
  type DynamicQuestSourceContext,
  type DynamicQuestSourceKind,
  type GenerationRecordId,
  type IsoTimestamp,
  type JsonValue,
  type Quest,
} from '@ember-tavern/contracts';
import {
  assertDynamicQuestBudget,
  dynamicQuestBudget,
  dynamicQuestInitialStatus,
  validateDynamicQuestSource,
} from '@ember-tavern/domain';

import { PersistenceDataError } from './campaign-repository.js';
import {
  parseJson,
  requireEnum,
  requireNumber,
  requireRecord,
  requireString,
  requireStringArray,
} from './persistence-validation.js';
import type { TransactionalSqliteDatabase } from './sqlite-port.js';

export interface CommitDynamicQuest {
  readonly campaignId: CampaignId;
  readonly sourceKind: DynamicQuestSourceKind;
  readonly occurrenceId: string;
  readonly expectedContextDigest: string;
  readonly generationRecordId: GenerationRecordId;
  readonly quest: Quest;
  readonly occurredAt: IsoTimestamp;
}

interface SourceProjection {
  readonly source: DynamicQuestSourceContext;
  readonly relevantFacts: readonly DynamicQuestRelevantFact[];
  readonly snapshot: JsonValue;
}

export class DynamicQuestSourceRepository {
  private readonly database: TransactionalSqliteDatabase;

  public constructor(database: TransactionalSqliteDatabase) {
    this.database = database;
  }

  public prepare(
    campaign: CampaignId,
    sourceKind: DynamicQuestSourceKind,
    occurrenceId: string,
  ): DynamicQuestPreparation {
    canonical(occurrenceId, 'Dynamic Quest occurrence ID', 200);
    if (!DYNAMIC_QUEST_SOURCE_KINDS.includes(sourceKind)) {
      throw new PersistenceDataError('Dynamic Quest source kind is invalid');
    }
    const existing = this.database
      .prepare(
        `SELECT quest_id FROM dynamic_quest_sources
         WHERE campaign_id=? AND source_kind=? AND occurrence_id=?`,
      )
      .get(campaign, sourceKind, occurrenceId);
    const source = loadQuestGenerationSource(this.database, campaign);
    const projection = projectSource(this.database, campaign, sourceKind, occurrenceId);
    validateDynamicQuestSource(projection.source);
    const currentOpenQuests = countOpenQuests(this.database, campaign);
    const budget = dynamicQuestBudget(currentOpenQuests);
    if (existing === undefined) assertDynamicQuestBudget(budget);
    const constitution = loadConstitution(this.database, campaign);
    const publisher = selectPublisher(source.availableNpcs, projection.source.actorNpcId);
    const input = freezeJson({
      world: source.world,
      tavernName: source.tavernName,
      publisher,
      availableNpcs: source.availableNpcs,
      playerConcept: source.playerConcept,
      recentQuestTitles: source.recentQuestTitles,
      recentQuestStructures: source.recentQuestStructures,
      dynamicSource: projection.source,
      relevantFacts: projection.relevantFacts,
      constitution,
      generationBudget: budget,
    });
    const contextDigest = digest(input);
    return Object.freeze({
      campaignId: campaign,
      source: projection.source,
      publisherNpcId: npcId(publisher.id),
      relevantFacts: projection.relevantFacts,
      constitution,
      budget,
      initialStatus: dynamicQuestInitialStatus(projection.source),
      contextDigest,
      existingQuestId:
        existing === undefined
          ? null
          : questId(
              requireString(
                requireRecord(existing, 'Dynamic Quest source')['quest_id'],
                'quest_id',
              ),
            ),
      input,
    });
  }

  public commit(input: CommitDynamicQuest): DynamicQuestProvenance {
    return this.transaction(() => this.commitInCurrentTransaction(input));
  }

  public get(quest: Quest['id']): DynamicQuestProvenance | null {
    const row = this.database
      .prepare('SELECT * FROM dynamic_quest_sources WHERE quest_id=?')
      .get(quest);
    return row === undefined ? null : mapProvenance(row);
  }

  private commitInCurrentTransaction(input: CommitDynamicQuest): DynamicQuestProvenance {
    const replay = this.database
      .prepare(
        `SELECT * FROM dynamic_quest_sources
         WHERE campaign_id=? AND source_kind=? AND occurrence_id=?`,
      )
      .get(input.campaignId, input.sourceKind, input.occurrenceId);
    if (replay !== undefined) {
      const provenance = mapProvenance(replay);
      if (
        provenance.questId !== input.quest.id ||
        provenance.generationRecordId !== input.generationRecordId ||
        provenance.contextDigest !== input.expectedContextDigest
      ) {
        throw new PersistenceDataError('Dynamic Quest source was reused with other input');
      }
      return provenance;
    }
    const prepared = this.prepare(input.campaignId, input.sourceKind, input.occurrenceId);
    if (prepared.contextDigest !== input.expectedContextDigest) {
      throw new PersistenceDataError('Dynamic Quest source context changed');
    }
    validateQuest(input.quest, prepared, input.campaignId, input.occurredAt);
    requireGeneration(this.database, input.generationRecordId, input.campaignId);
    this.database
      .prepare(
        `INSERT INTO quest_pool_creation_intents
         (quest_id,campaign_id,status,reason,operation_id,created_at)
         VALUES (?,?,?,?,?,?)`,
      )
      .run(
        input.quest.id,
        input.campaignId,
        prepared.initialStatus,
        `Dynamic ${input.sourceKind} source ${input.occurrenceId} created the quest.`,
        `quest:dynamic:${input.sourceKind.toLowerCase()}:${input.occurrenceId}`,
        input.occurredAt,
      );
    this.database
      .prepare(
        `INSERT INTO quests (
           id,campaign_id,publisher_npc_id,content_json,status,risk,
           recommended_attributes_json,expected_turns_min,expected_turns_max,reward_tier,
           related_npc_ids_json,related_fact_ids_json,created_at,updated_at
         ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        input.quest.id,
        input.campaignId,
        input.quest.publisherNpcId,
        JSON.stringify(input.quest.content),
        'AVAILABLE',
        input.quest.risk,
        JSON.stringify(input.quest.recommendedAttributes),
        input.quest.expectedTurns.min,
        input.quest.expectedTurns.max,
        input.quest.rewardTier,
        JSON.stringify(input.quest.relatedNpcIds),
        JSON.stringify(input.quest.relatedFactIds),
        input.occurredAt,
        input.occurredAt,
      );
    this.database
      .prepare(
        `INSERT INTO dynamic_quest_sources (
           quest_id,campaign_id,source_kind,occurrence_id,entity_kind,entity_id,actor_npc_id,
           visibility,player_intervened,source_summary,source_snapshot_json,
           relevant_fact_ids_json,context_digest,generation_record_id,budget_json,created_at
         ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        input.quest.id,
        input.campaignId,
        prepared.source.kind,
        prepared.source.occurrenceId,
        prepared.source.entityKind,
        prepared.source.entityId,
        prepared.source.actorNpcId,
        prepared.source.visibility,
        prepared.source.playerIntervened ? 1 : 0,
        prepared.source.summary,
        JSON.stringify(
          projectSource(this.database, input.campaignId, input.sourceKind, input.occurrenceId)
            .snapshot,
        ),
        JSON.stringify(prepared.relevantFacts.map(({ id }) => id)),
        prepared.contextDigest,
        input.generationRecordId,
        JSON.stringify(prepared.budget),
        input.occurredAt,
      );
    const committed = this.get(input.quest.id);
    if (committed === null) throw new PersistenceDataError('Dynamic Quest provenance is missing');
    return committed;
  }

  private transaction(run: () => DynamicQuestProvenance): DynamicQuestProvenance {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const result = run();
      this.database.exec('COMMIT');
      return result;
    } catch (error) {
      try {
        this.database.exec('ROLLBACK');
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          'Dynamic Quest commit and rollback failed',
          {
            cause: rollbackError,
          },
        );
      }
      throw error;
    }
  }
}

interface QuestGenerationSource {
  readonly world: JsonValue;
  readonly tavernName: string;
  readonly playerConcept: string;
  readonly availableNpcs: readonly NpcBrief[];
  readonly recentQuestTitles: readonly string[];
  readonly recentQuestStructures: readonly string[];
}

interface NpcBrief {
  readonly id: string;
  readonly name: string;
  readonly identity: string;
  readonly personality: string;
  readonly goal: string;
  readonly currentMood: string;
}

function loadQuestGenerationSource(
  database: TransactionalSqliteDatabase,
  campaign: CampaignId,
): QuestGenerationSource {
  const campaignRow = requireRecord(
    database.prepare('SELECT state FROM campaigns WHERE id=?').get(campaign),
    'Dynamic Quest campaign is missing',
  );
  if (requireString(campaignRow['state'], 'campaign.state') !== 'TAVERN') {
    throw new PersistenceDataError('Dynamic Quest generation requires Tavern state');
  }
  const world = requireRecord(
    database.prepare('SELECT * FROM world_bibles WHERE campaign_id=?').get(campaign),
    'Dynamic Quest world is missing',
  );
  const tavern = requireRecord(
    database.prepare('SELECT id,name FROM taverns WHERE campaign_id=?').get(campaign),
    'Dynamic Quest Tavern is missing',
  );
  const character = requireRecord(
    database.prepare('SELECT concept FROM player_characters WHERE campaign_id=?').get(campaign),
    'Dynamic Quest player is missing',
  );
  const npcs = database
    .prepare(
      `SELECT id,name,identity,personality,goal,current_mood
       FROM npcs WHERE campaign_id=? AND tavern_id=? AND current_status='ACTIVE'
       ORDER BY CASE residency WHEN 'OWNER' THEN 0 WHEN 'RESIDENT' THEN 1 ELSE 2 END,created_at,id`,
    )
    .all(campaign, requireString(tavern['id'], 'tavern.id'))
    .map((value): NpcBrief => {
      const row = requireRecord(value, 'Dynamic Quest NPC');
      return Object.freeze({
        id: requireString(row['id'], 'npc.id'),
        name: requireString(row['name'], 'npc.name'),
        identity: requireString(row['identity'], 'npc.identity'),
        personality: requireString(row['personality'], 'npc.personality'),
        goal: requireString(row['goal'], 'npc.goal'),
        currentMood: requireString(row['current_mood'], 'npc.current_mood'),
      });
    });
  if (npcs.length === 0) throw new PersistenceDataError('Dynamic Quest publisher is missing');
  const recent = [
    ...database
      .prepare(
        `SELECT json_extract(content_json,'$.title') AS title,risk,reward_tier,
              expected_turns_min,expected_turns_max,recommended_attributes_json
       FROM quests q JOIN quest_pool_states pool ON pool.quest_id=q.id
       WHERE q.campaign_id=? AND pool.status<>'HIDDEN'
       ORDER BY q.created_at DESC,q.id DESC LIMIT 20`,
      )
      .all(campaign),
  ].reverse();
  return Object.freeze({
    world: Object.freeze({
      name: requireString(world['name'], 'world.name'),
      currentRegion: requireString(world['current_region'], 'world.current_region'),
      summary: requireString(world['summary'], 'world.summary'),
      coreConflict: requireString(world['core_conflict'], 'world.core_conflict'),
      technologyLevel: requireString(world['technology_level'], 'world.technology_level'),
      powerRules: requireStringArray(
        parseJson(world['power_rules_json'], 'power_rules_json'),
        'power_rules_json',
      ),
    }),
    tavernName: requireString(tavern['name'], 'tavern.name'),
    playerConcept: requireString(character['concept'], 'character.concept'),
    availableNpcs: Object.freeze(npcs),
    recentQuestTitles: Object.freeze(
      recent.map((value) =>
        requireString(requireRecord(value, 'Recent Quest')['title'], 'quest.title'),
      ),
    ),
    recentQuestStructures: Object.freeze(recent.map(questStructure)),
  });
}

function projectSource(
  database: TransactionalSqliteDatabase,
  campaign: CampaignId,
  kind: DynamicQuestSourceKind,
  occurrenceId: string,
): SourceProjection {
  switch (kind) {
    case 'NPC':
      return npcSource(database, campaign, occurrenceId);
    case 'FACTION':
      return factionSource(database, campaign, occurrenceId);
    case 'WORLD_EVENT':
      return worldEventSource(database, campaign, occurrenceId);
    case 'DISCOVERY':
      return discoverySource(database, campaign, occurrenceId);
    case 'PLAYER_ACTION':
      return playerActionSource(database, campaign, occurrenceId);
    case 'CONSEQUENCE':
      return consequenceSource(database, campaign, occurrenceId);
  }
}

function npcSource(
  database: TransactionalSqliteDatabase,
  campaign: CampaignId,
  occurrenceId: string,
): SourceProjection {
  const row = requireRecord(
    database
      .prepare(
        `SELECT operation.scope_id,operation.player_intent,message.content,operation.committed_ref_id
         FROM npc_timeline_operations operation
         JOIN messages message ON message.id=operation.committed_ref_id
         WHERE operation.id=? AND operation.campaign_id=?
           AND operation.scope_kind='NPC_DIALOGUE' AND operation.status='COMMITTED'`,
      )
      .get(occurrenceId, campaign),
    'Dynamic NPC source is invalid',
  );
  const entityId = requireString(row['scope_id'], 'source.npcId');
  const playerIntent = requireString(row['player_intent'], 'source.playerIntent');
  const reply = requireString(row['content'], 'source.reply');
  return projection(
    {
      kind: 'NPC',
      occurrenceId,
      entityKind: 'NPC',
      entityId,
      summary: bounded(`${playerIntent}\n${reply}`),
      actorNpcId: npcId(entityId),
      visibility: 'PLAYER_VISIBLE',
      playerIntervened: false,
    },
    [],
    Object.freeze({
      playerIntent,
      reply,
      committedRefId: requireString(row['committed_ref_id'], 'source.ref'),
    }),
  );
}

function factionSource(
  database: TransactionalSqliteDatabase,
  campaign: CampaignId,
  occurrenceId: string,
): SourceProjection {
  const row = requireRecord(
    database
      .prepare(
        `SELECT faction_id,source,action_kind,summary,world_fact_id,proposal_json
         FROM faction_action_events WHERE id=? AND campaign_id=?`,
      )
      .get(occurrenceId, campaign),
    'Dynamic Faction source is invalid',
  );
  const factionId = requireString(row['faction_id'], 'source.factionId');
  const actionSource = requireString(row['source'], 'source.actionSource');
  const worldFact = nullableString(row['world_fact_id'], 'source.worldFactId');
  const relevantFacts = worldFact === null ? [] : [loadFact(database, campaign, worldFact)];
  return projection(
    {
      kind: 'FACTION',
      occurrenceId,
      entityKind: 'FACTION',
      entityId: factionId,
      summary: requireString(row['summary'], 'source.summary'),
      actorNpcId: null,
      visibility: actionSource === 'PLAYER' ? 'PLAYER_VISIBLE' : 'HIDDEN',
      playerIntervened: false,
    },
    relevantFacts,
    Object.freeze({
      actionKind: requireString(row['action_kind'], 'source.actionKind'),
      actionSource,
      proposal: freezeJson(parseJson(row['proposal_json'], 'source.proposal')),
    }),
  );
}

function worldEventSource(
  database: TransactionalSqliteDatabase,
  campaign: CampaignId,
  occurrenceId: string,
): SourceProjection {
  const row = event(database, campaign, occurrenceId, [
    'WORLD_CLOCK_ADVANCED',
    'ADVENTURE_COMPLETED',
  ]);
  const type = requireString(row['type'], 'source.eventType');
  const payload = freezeJson(parseJson(row['payload_json'], 'source.payload'));
  return projection(
    {
      kind: 'WORLD_EVENT',
      occurrenceId,
      entityKind: 'GAME_EVENT',
      entityId: occurrenceId,
      summary: bounded(`${type}: ${stableJson(payload)}`),
      actorNpcId: null,
      visibility: 'PLAYER_VISIBLE',
      playerIntervened: false,
    },
    [],
    Object.freeze({ type, payload }),
  );
}

function discoverySource(
  database: TransactionalSqliteDatabase,
  campaign: CampaignId,
  occurrenceId: string,
): SourceProjection {
  const row = event(database, campaign, occurrenceId, ['FACT_DISCOVERED']);
  const payload = requireRecord(
    parseJson(row['payload_json'], 'source.payload'),
    'Discovery payload',
  );
  const factId = requireString(payload['worldFactId'], 'source.worldFactId');
  const fact = loadFact(database, campaign, factId);
  return projection(
    {
      kind: 'DISCOVERY',
      occurrenceId,
      entityKind: 'WORLD_FACT',
      entityId: factId,
      summary: fact.statement,
      actorNpcId: null,
      visibility: 'PLAYER_VISIBLE',
      playerIntervened: false,
    },
    [fact],
    Object.freeze({ eventType: 'FACT_DISCOVERED', worldFactId: factId }),
  );
}

function playerActionSource(
  database: TransactionalSqliteDatabase,
  campaign: CampaignId,
  occurrenceId: string,
): SourceProjection {
  const row = event(database, campaign, occurrenceId, ['PLAYER_ACTION_SUBMITTED']);
  const payload = requireRecord(
    parseJson(row['payload_json'], 'source.payload'),
    'Player Action payload',
  );
  const action = freezeJson(payload['action']);
  return projection(
    {
      kind: 'PLAYER_ACTION',
      occurrenceId,
      entityKind: 'PLAYER_ACTION',
      entityId: requireString(payload['adventureId'], 'source.adventureId'),
      summary: bounded(`Player action: ${stableJson(action)}`),
      actorNpcId: null,
      visibility: 'PLAYER_VISIBLE',
      playerIntervened: true,
    },
    [],
    Object.freeze({ action, turnId: requireString(payload['turnId'], 'source.turnId') }),
  );
}

function consequenceSource(
  database: TransactionalSqliteDatabase,
  campaign: CampaignId,
  occurrenceId: string,
): SourceProjection {
  const row = requireRecord(
    database
      .prepare(
        `SELECT trigger_kind,trigger_id,changes_json
         FROM quest_graph_evaluations WHERE operation_id=? AND campaign_id=?
           AND json_array_length(changes_json)>0`,
      )
      .get(occurrenceId, campaign),
    'Dynamic Consequence source is invalid',
  );
  const changes = freezeJson(parseJson(row['changes_json'], 'source.changes'));
  return projection(
    {
      kind: 'CONSEQUENCE',
      occurrenceId,
      entityKind: 'QUEST_GRAPH',
      entityId: requireString(row['trigger_id'], 'source.triggerId'),
      summary: bounded(`Quest consequence: ${stableJson(changes)}`),
      actorNpcId: null,
      visibility: 'HIDDEN',
      playerIntervened: false,
    },
    [],
    Object.freeze({
      triggerKind: requireString(row['trigger_kind'], 'source.triggerKind'),
      changes,
    }),
  );
}

function projection(
  source: DynamicQuestSourceContext,
  relevantFacts: readonly DynamicQuestRelevantFact[],
  snapshot: JsonValue,
): SourceProjection {
  return Object.freeze({
    source: Object.freeze(source),
    relevantFacts: Object.freeze(relevantFacts),
    snapshot,
  });
}

function event(
  database: TransactionalSqliteDatabase,
  campaign: CampaignId,
  occurrenceId: string,
  allowed: readonly string[],
): Record<string, unknown> {
  const row = requireRecord(
    database
      .prepare('SELECT type,payload_json FROM game_events WHERE id=? AND campaign_id=?')
      .get(occurrenceId, campaign),
    'Dynamic Quest event source is invalid',
  );
  if (!allowed.includes(requireString(row['type'], 'event.type'))) {
    throw new PersistenceDataError('Dynamic Quest event type is invalid');
  }
  return row;
}

function loadFact(
  database: TransactionalSqliteDatabase,
  campaign: CampaignId,
  id: string,
): DynamicQuestRelevantFact {
  const row = requireRecord(
    database
      .prepare('SELECT id,statement FROM world_facts WHERE id=? AND campaign_id=?')
      .get(id, campaign),
    'Dynamic Quest fact is invalid',
  );
  return Object.freeze({
    id: worldFactId(requireString(row['id'], 'fact.id')),
    statement: requireString(row['statement'], 'fact.statement'),
  });
}

function loadConstitution(
  database: TransactionalSqliteDatabase,
  campaign: CampaignId,
): DynamicQuestPreparation['constitution'] {
  const row = requireRecord(
    database
      .prepare(
        `SELECT revision,technology,magic,society,politics,economy,taboos_json
         FROM world_constitutions WHERE campaign_id=? AND status='LOCKED'`,
      )
      .get(campaign),
    'Dynamic Quest locked Constitution is missing',
  );
  return Object.freeze({
    revision: positiveInteger(row['revision'], 'constitution.revision'),
    technology: requireString(row['technology'], 'constitution.technology'),
    magic: requireString(row['magic'], 'constitution.magic'),
    society: requireString(row['society'], 'constitution.society'),
    politics: requireString(row['politics'], 'constitution.politics'),
    economy: requireString(row['economy'], 'constitution.economy'),
    taboos: Object.freeze(
      requireStringArray(
        parseJson(row['taboos_json'], 'constitution.taboos'),
        'constitution.taboos',
      ),
    ),
  });
}

function countOpenQuests(database: TransactionalSqliteDatabase, campaign: CampaignId): number {
  const row = requireRecord(
    database
      .prepare(
        `SELECT COUNT(*) AS count FROM quest_pool_states
         WHERE campaign_id=? AND status NOT IN ('COMPLETED','FAILED','EXPIRED','ABANDONED')`,
      )
      .get(campaign),
    'Dynamic Quest budget is missing',
  );
  return nonNegativeInteger(row['count'], 'budget.currentOpenQuests');
}

function selectPublisher(npcs: readonly NpcBrief[], actorNpcId: string | null): NpcBrief {
  const selected =
    (actorNpcId === null ? undefined : npcs.find(({ id }) => id === actorNpcId)) ?? npcs[0];
  if (selected === undefined) throw new PersistenceDataError('Dynamic Quest publisher is missing');
  return selected;
}

function validateQuest(
  quest: Quest,
  prepared: DynamicQuestPreparation,
  campaign: CampaignId,
  occurredAt: IsoTimestamp,
): void {
  if (
    quest.campaignId !== campaign ||
    quest.publisherNpcId !== prepared.publisherNpcId ||
    quest.status !== prepared.initialStatus ||
    quest.createdAt !== occurredAt ||
    quest.updatedAt !== occurredAt ||
    quest.expectedTurns.min < 8 ||
    quest.expectedTurns.max > 12 ||
    quest.expectedTurns.max < quest.expectedTurns.min
  ) {
    throw new PersistenceDataError('Dynamic Quest does not match its local preparation');
  }
  const rawNpcs = requireRecord(prepared.input, 'Dynamic Quest input')['availableNpcs'];
  if (!Array.isArray(rawNpcs)) throw new PersistenceDataError('Dynamic Quest NPC input is invalid');
  const allowedNpcs = new Set(
    rawNpcs.map((value) =>
      requireString(requireRecord(value, 'Dynamic Quest NPC')['id'], 'npc.id'),
    ),
  );
  if (quest.relatedNpcIds.some((id) => !allowedNpcs.has(id))) {
    throw new PersistenceDataError('Dynamic Quest references an unavailable NPC');
  }
  const allowedFacts = new Set(prepared.relevantFacts.map(({ id }) => id));
  if (quest.relatedFactIds.some((id) => !allowedFacts.has(id))) {
    throw new PersistenceDataError('Dynamic Quest references an unauthorized fact');
  }
  const recentStructures = requireStringArray(
    requireRecord(prepared.input, 'Dynamic Quest input')['recentQuestStructures'],
    'recentQuestStructures',
  );
  const structure = [
    quest.risk.toLowerCase(),
    quest.rewardTier.toLowerCase(),
    `${quest.expectedTurns.min}-${quest.expectedTurns.max}`,
    [...quest.recommendedAttributes]
      .map((value) => value.toLowerCase())
      .sort()
      .join(','),
  ].join('|');
  if (recentStructures.includes(structure)) {
    throw new PersistenceDataError('Dynamic Quest repeats an existing Quest structure');
  }
  for (const value of Object.values(quest.content))
    canonical(value, 'Dynamic Quest content', 4_000);
}

function requireGeneration(
  database: TransactionalSqliteDatabase,
  generation: GenerationRecordId,
  campaign: CampaignId,
): void {
  const row = database
    .prepare(
      `SELECT 1 FROM generation_records
       WHERE id=? AND campaign_id=? AND task='GENERATE_QUEST' AND validated_output_json IS NOT NULL`,
    )
    .get(generation, campaign);
  if (row === undefined) throw new PersistenceDataError('Dynamic Quest generation is invalid');
}

function mapProvenance(value: unknown): DynamicQuestProvenance {
  const row = requireRecord(value, 'Dynamic Quest provenance');
  const source: DynamicQuestSourceContext = Object.freeze({
    kind: requireEnum(DYNAMIC_QUEST_SOURCE_KINDS, row['source_kind'], 'source_kind'),
    occurrenceId: requireString(row['occurrence_id'], 'occurrence_id'),
    entityKind: requireEnum(DYNAMIC_QUEST_ENTITY_KINDS, row['entity_kind'], 'entity_kind'),
    entityId: requireString(row['entity_id'], 'entity_id'),
    summary: requireString(row['source_summary'], 'source_summary'),
    actorNpcId:
      row['actor_npc_id'] === null
        ? null
        : npcId(requireString(row['actor_npc_id'], 'actor_npc_id')),
    visibility: requireEnum(DYNAMIC_QUEST_VISIBILITIES, row['visibility'], 'visibility'),
    playerIntervened: requireNumber(row['player_intervened'], 'player_intervened') === 1,
  });
  const budgetRow = requireRecord(
    parseJson(row['budget_json'], 'budget_json'),
    'Dynamic Quest budget',
  );
  const budget = Object.freeze({
    policyVersion: 1 as const,
    openQuestLimit: positiveInteger(budgetRow['openQuestLimit'], 'budget.openQuestLimit'),
    currentOpenQuests: nonNegativeInteger(
      budgetRow['currentOpenQuests'],
      'budget.currentOpenQuests',
    ),
    remainingSlots: nonNegativeInteger(budgetRow['remainingSlots'], 'budget.remainingSlots'),
  });
  return Object.freeze({
    questId: questId(requireString(row['quest_id'], 'quest_id')),
    campaignId: campaignId(requireString(row['campaign_id'], 'campaign_id')),
    source,
    relevantFactIds: Object.freeze(
      requireStringArray(
        parseJson(row['relevant_fact_ids_json'], 'relevant_fact_ids_json'),
        'relevant_fact_ids_json',
      ).map(worldFactId),
    ),
    contextDigest: requireString(row['context_digest'], 'context_digest'),
    generationRecordId: generationRecordId(
      requireString(row['generation_record_id'], 'generation_record_id'),
    ),
    budget,
    createdAt: isoTimestamp(requireString(row['created_at'], 'created_at')),
  });
}

function questStructure(value: unknown): string {
  const row = requireRecord(value, 'Recent Quest');
  const attributes = requireStringArray(
    parseJson(row['recommended_attributes_json'], 'recommended_attributes_json'),
    'recommended_attributes_json',
  )
    .map((item) => item.toLowerCase())
    .sort();
  return [
    requireString(row['risk'], 'quest.risk').toLowerCase(),
    requireString(row['reward_tier'], 'quest.rewardTier').toLowerCase(),
    `${positiveInteger(row['expected_turns_min'], 'quest.min')}-${positiveInteger(row['expected_turns_max'], 'quest.max')}`,
    attributes.join(','),
  ].join('|');
}

function digest(value: JsonValue): string {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

function stableJson(value: JsonValue): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
    .join(',')}}`;
}

function freezeJson(value: unknown): JsonValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return value;
  }
  if (Array.isArray(value)) return Object.freeze(value.map(freezeJson));
  if (typeof value === 'object') {
    return Object.freeze(
      Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, freezeJson(entry)])),
    );
  }
  throw new PersistenceDataError('Dynamic Quest source contains unsupported data');
}

function bounded(value: string): string {
  const result = [...value].slice(0, 4_000).join('').trim();
  if (result.length === 0) throw new PersistenceDataError('Dynamic Quest source summary is empty');
  return result;
}

function nullableString(value: unknown, label: string): string | null {
  return value === null ? null : requireString(value, label);
}

function canonical(value: string, label: string, max: number): void {
  if (value.length === 0 || value.length > max || value.trim() !== value) {
    throw new PersistenceDataError(`${label} is invalid`);
  }
}

function positiveInteger(value: unknown, label: string): number {
  const parsed = requireNumber(value, label);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new PersistenceDataError(`${label} is invalid`);
  }
  return parsed;
}

function nonNegativeInteger(value: unknown, label: string): number {
  const parsed = requireNumber(value, label);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new PersistenceDataError(`${label} is invalid`);
  }
  return parsed;
}

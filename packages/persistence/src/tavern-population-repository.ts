import { randomUUID } from 'node:crypto';

import {
  TAVERN_POPULATION_TRIGGERS,
  createNpcLodProfile,
  createTavernOpportunity,
  createTavernPopulationContext,
  createTavernPopulationCycle,
  createTavernPopulationFocusEvent,
  createTavernPopulationMember,
  createTavernPopulationSnapshot,
  createTavernPopulationState,
  isoTimestamp,
  parseActiveFactionProfile,
  parseNpcLodProfile,
  type CampaignId,
  type NpcLodProfile,
  type TavernOpportunity,
  type TavernPopulationContext,
  type TavernPopulationMember,
  type TavernPopulationSnapshot,
  type TavernPopulationSourceKind,
  type TavernPopulationTrigger,
} from '@ember-tavern/contracts';
import {
  focusTavernPopulation,
  projectTavernPopulation,
  type TavernPopulationCandidate,
} from '@ember-tavern/domain';

import { PersistenceDataError } from './campaign-repository.js';
import {
  parseJson,
  requireNumber,
  requireRecord,
  requireString,
} from './persistence-validation.js';
import type { TransactionalSqliteDatabase } from './sqlite-port.js';

export interface ProjectTavernPopulation {
  readonly campaignId: CampaignId;
  readonly trigger: TavernPopulationTrigger;
  readonly operationId: string;
  readonly cycleId: string;
  readonly at: string;
}

export interface FocusTavernPopulation {
  readonly campaignId: CampaignId;
  readonly npcId: string;
  readonly expectedRevision: number;
  readonly operationId: string;
  readonly eventId: string;
  readonly at: string;
}

interface PopulationFactor {
  readonly sourceKind: Exclude<TavernPopulationSourceKind, 'OWNER' | 'ESTABLISHED'>;
  readonly sourceId: string;
  readonly populationRole: string;
}

interface PopulationFacts {
  readonly context: TavernPopulationContext;
  readonly factors: readonly PopulationFactor[];
  readonly opportunities: readonly TavernOpportunity[];
  readonly constitutionRevision: number;
  readonly constitutionEvidence: NpcLodProfile['constitutionEvidence'];
}

export class TavernPopulationRepository {
  public constructor(
    private readonly database: TransactionalSqliteDatabase,
    private readonly createId: () => string = randomUUID,
  ) {}

  public snapshot(campaign: CampaignId): TavernPopulationSnapshot {
    const tavern = this.requireTavern(campaign);
    const stateRow = this.database
      .prepare('SELECT * FROM tavern_population_states WHERE tavern_id=? AND campaign_id=?')
      .get(tavern.id, campaign);
    const state = stateRow === undefined ? null : mapState(stateRow);
    const members = Object.freeze(
      this.database
        .prepare(
          `SELECT member.*,profile.profile_json
           FROM tavern_population_members member
           JOIN npc_lod_profiles profile ON profile.id=member.npc_id
           WHERE member.tavern_id=? AND member.campaign_id=?
           ORDER BY CASE member.presence WHEN 'PRESENT' THEN 0 ELSE 1 END,
                    member.source_kind,member.npc_id`,
        )
        .all(tavern.id, campaign)
        .map(mapMember),
    );
    const cycles = Object.freeze(
      this.database
        .prepare(
          `SELECT * FROM tavern_population_cycles
           WHERE tavern_id=? AND campaign_id=? ORDER BY occurred_at,id`,
        )
        .all(tavern.id, campaign)
        .map(mapCycle),
    );
    const focusHistory = Object.freeze(
      this.database
        .prepare(
          `SELECT * FROM tavern_population_focus_events
           WHERE tavern_id=? AND campaign_id=? ORDER BY occurred_at,id`,
        )
        .all(tavern.id, campaign)
        .map(mapFocusEvent),
    );
    return createTavernPopulationSnapshot({ state, members, cycles, focusHistory });
  }

  public project(command: ProjectTavernPopulation): TavernPopulationSnapshot {
    requireIdentity(command.operationId, 'population operation');
    requireIdentity(command.cycleId, 'population cycle');
    if (!TAVERN_POPULATION_TRIGGERS.includes(command.trigger)) {
      throw new PersistenceDataError('Tavern population trigger is invalid');
    }
    const at = isoTimestamp(command.at);
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const replay = this.database
        .prepare('SELECT campaign_id,trigger FROM tavern_population_cycles WHERE operation_id=?')
        .get(command.operationId);
      if (replay !== undefined) {
        const row = requireRecord(replay, 'population replay');
        if (
          requireString(row['campaign_id'], 'campaign_id') !== command.campaignId ||
          requireString(row['trigger'], 'trigger') !== command.trigger
        ) {
          throw new PersistenceDataError('Tavern population operation conflicts with prior use');
        }
        const snapshot = this.snapshot(command.campaignId);
        this.database.exec('COMMIT');
        return snapshot;
      }
      const current = this.snapshot(command.campaignId);
      const facts = this.readFacts(command.campaignId, current.members);
      const candidates = this.buildCandidates(command.campaignId, current.members, facts, at);
      const plan = projectTavernPopulation({
        currentState: current.state,
        currentMembers: current.members,
        context: facts.context,
        candidates,
        opportunities: facts.opportunities,
        trigger: command.trigger,
        at,
      });
      if (!plan.changed) {
        this.database.exec('COMMIT');
        return current;
      }
      this.writeProjection(plan.state, plan.members);
      this.database
        .prepare(
          `INSERT INTO tavern_population_cycles
          (id,operation_id,campaign_id,tavern_id,trigger,before_revision,after_revision,
           context_json,present_npc_ids_json,opportunity_ids_json,occurred_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          command.cycleId,
          command.operationId,
          command.campaignId,
          plan.state.tavernId,
          command.trigger,
          current.state?.revision ?? 0,
          plan.state.revision,
          JSON.stringify(plan.state.context),
          JSON.stringify(
            plan.members.filter(({ presence }) => presence === 'PRESENT').map(({ npcId }) => npcId),
          ),
          JSON.stringify(plan.state.opportunities.map(({ id }) => id)),
          at,
        );
      const saved = this.snapshot(command.campaignId);
      this.database.exec('COMMIT');
      return saved;
    } catch (error) {
      rollback(this.database, error, 'Tavern population projection failed');
    }
  }

  public focus(command: FocusTavernPopulation): TavernPopulationSnapshot {
    requireIdentity(command.operationId, 'population focus operation');
    requireIdentity(command.eventId, 'population focus event');
    const at = isoTimestamp(command.at);
    if (!Number.isSafeInteger(command.expectedRevision) || command.expectedRevision < 1) {
      throw new PersistenceDataError('Tavern population focus revision is invalid');
    }
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const replay = this.database
        .prepare(
          `SELECT campaign_id,npc_id,before_revision
           FROM tavern_population_focus_events WHERE operation_id=?`,
        )
        .get(command.operationId);
      if (replay !== undefined) {
        const row = requireRecord(replay, 'population focus replay');
        if (
          requireString(row['campaign_id'], 'campaign_id') !== command.campaignId ||
          requireString(row['npc_id'], 'npc_id') !== command.npcId ||
          requireNumber(row['before_revision'], 'before_revision') !== command.expectedRevision
        ) {
          throw new PersistenceDataError('Tavern population focus operation conflicts');
        }
        const saved = this.snapshot(command.campaignId);
        this.database.exec('COMMIT');
        return saved;
      }
      const current = this.snapshot(command.campaignId);
      if (current.state === null)
        throw new PersistenceDataError('Tavern population is not projected');
      const profileRow = this.database
        .prepare('SELECT profile_json FROM npc_lod_profiles WHERE id=? AND campaign_id=?')
        .get(command.npcId, command.campaignId);
      if (profileRow === undefined)
        throw new PersistenceDataError('Population NPC identity is missing');
      const profile = parseProfileRow(profileRow);
      const plan = focusTavernPopulation({
        state: current.state,
        members: current.members,
        npcProfile: profile,
        expectedRevision: command.expectedRevision,
        at,
      });
      this.writeProjection(plan.state, plan.members);
      this.database
        .prepare(
          `INSERT INTO tavern_population_focus_events
          (id,operation_id,campaign_id,tavern_id,npc_id,before_revision,after_revision,npc_lod,occurred_at)
          VALUES (?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          command.eventId,
          command.operationId,
          command.campaignId,
          plan.state.tavernId,
          command.npcId,
          command.expectedRevision,
          plan.state.revision,
          profile.lod,
          at,
        );
      const saved = this.snapshot(command.campaignId);
      this.database.exec('COMMIT');
      return saved;
    } catch (error) {
      rollback(this.database, error, 'Tavern population focus failed');
    }
  }

  private requireTavern(campaign: CampaignId): {
    readonly id: string;
    readonly ownerNpcId: string;
  } {
    const value = this.database
      .prepare(
        'SELECT id,owner_npc_id FROM taverns WHERE campaign_id=? ORDER BY created_at,id LIMIT 1',
      )
      .get(campaign);
    if (value === undefined) throw new PersistenceDataError(`Tavern not found: ${campaign}`);
    const row = requireRecord(value, 'tavern');
    return Object.freeze({
      id: requireString(row['id'], 'tavern.id'),
      ownerNpcId: requireString(row['owner_npc_id'], 'tavern.owner_npc_id'),
    });
  }

  private readFacts(
    campaign: CampaignId,
    currentMembers: readonly TavernPopulationMember[],
  ): PopulationFacts {
    const tavern = this.requireTavern(campaign);
    const worldValue = this.database
      .prepare(
        `SELECT bible.updated_at,constitution.revision,constitution.npc_rules,
                constitution.society,constitution.technology
         FROM world_bibles bible
         JOIN world_constitutions constitution ON constitution.campaign_id=bible.campaign_id
           AND constitution.status='LOCKED'
         WHERE bible.campaign_id=?`,
      )
      .get(campaign);
    const locationValue = this.database
      .prepare(
        `SELECT state.current_location_id,state.revision,location.name
         FROM campaign_location_states state
         JOIN dynamic_locations location ON location.id=state.current_location_id
         WHERE state.campaign_id=?`,
      )
      .get(campaign);
    if (worldValue === undefined || locationValue === undefined) {
      throw new PersistenceDataError('Tavern population requires locked world and location state');
    }
    const world = requireRecord(worldValue, 'population world');
    const location = requireRecord(locationValue, 'population location');
    const locationId = requireString(location['current_location_id'], 'current_location_id');
    const clocks = this.database
      .prepare(
        'SELECT id,name,current,max,stages_json,updated_at FROM world_clocks WHERE campaign_id=? ORDER BY id',
      )
      .all(campaign)
      .map((value) => requireRecord(value, 'population clock'));
    const factions = this.database
      .prepare(
        `SELECT id,name,revision,profile_json FROM active_factions
         WHERE campaign_id=? AND materialization='ACTIVE' ORDER BY id`,
      )
      .all(campaign)
      .map((value) => {
        const row = requireRecord(value, 'population faction');
        return parseActiveFactionProfile(parseJson(row['profile_json'], 'profile_json'));
      });
    const events = this.database
      .prepare(
        `SELECT id,type,payload_json FROM game_events
         WHERE campaign_id=? ORDER BY occurred_at DESC,id DESC LIMIT 8`,
      )
      .all(campaign)
      .map((value) => requireRecord(value, 'population event'));
    const historyNpcIds = new Set(
      this.database
        .prepare(
          `SELECT DISTINCT npc_id FROM conversations
           WHERE campaign_id=? AND kind='NPC' AND npc_id IS NOT NULL ORDER BY npc_id`,
        )
        .all(campaign)
        .map((value) =>
          requireString(requireRecord(value, 'population history')['npc_id'], 'npc_id'),
        ),
    );
    for (const member of currentMembers) if (member.isImportant) historyNpcIds.add(member.npcId);
    const context = createTavernPopulationContext({
      campaignId: campaign,
      tavernId: tavern.id,
      worldUpdatedAt: requireString(world['updated_at'], 'world.updated_at'),
      currentLocationId: locationId,
      locationRevision: requireNumber(location['revision'], 'location.revision'),
      clocks: clocks.map((clock) => ({
        id: requireString(clock['id'], 'clock.id'),
        current: requireNumber(clock['current'], 'clock.current'),
        max: requireNumber(clock['max'], 'clock.max'),
        updatedAt: requireString(clock['updated_at'], 'clock.updated_at'),
      })),
      activeFactions: factions.map((faction) => ({
        id: faction.id,
        revision: faction.revision,
        currentAction: faction.currentAction ?? faction.goal,
        playerRelation: faction.playerRelation,
        territoryLocationIds: faction.territoryLocationIds,
      })),
      recentEventIds: events.map((event) => requireString(event['id'], 'event.id')),
      historyNpcIds: [...historyNpcIds].sort(),
    });
    const factors: PopulationFactor[] = [
      ...(requireNumber(location['revision'], 'location.revision') > 1
        ? [
            {
              sourceKind: 'LOCATION' as const,
              sourceId: locationId,
              populationRole: `${requireString(location['name'], 'location.name')}的旅人`,
            },
          ]
        : []),
      ...clocks
        .filter((clock) => requireNumber(clock['current'], 'clock.current') > 0)
        .map((clock) => ({
          sourceKind: 'CLOCK' as const,
          sourceId: requireString(clock['id'], 'clock.id'),
          populationRole: `${requireString(clock['name'], 'clock.name')}的关注者`,
        })),
      ...factions
        .filter(({ territoryLocationIds }) =>
          territoryLocationIds.includes(context.currentLocationId),
        )
        .map((faction) => ({
          sourceKind: 'FACTION' as const,
          sourceId: faction.id,
          populationRole: `${faction.name}的联络人`,
        })),
    ];
    const latestEvent = events[0];
    if (latestEvent !== undefined) {
      factors.push({
        sourceKind: 'EVENT',
        sourceId: requireString(latestEvent['id'], 'event.id'),
        populationRole: `${requireString(latestEvent['type'], 'event.type')}的见证者`,
      });
    }
    const opportunities = this.readOpportunities(
      campaign,
      currentMembers,
      factors,
      factions,
      clocks,
      events,
    );
    return Object.freeze({
      context,
      factors: Object.freeze(factors),
      opportunities,
      constitutionRevision: requireNumber(world['revision'], 'constitution.revision'),
      constitutionEvidence: Object.freeze({
        npcRules: requireString(world['npc_rules'], 'constitution.npc_rules'),
        society: requireString(world['society'], 'constitution.society'),
        technology: requireString(world['technology'], 'constitution.technology'),
      }),
    });
  }

  private readOpportunities(
    campaign: CampaignId,
    currentMembers: readonly TavernPopulationMember[],
    factors: readonly PopulationFactor[],
    factions: readonly ReturnType<typeof parseActiveFactionProfile>[],
    clocks: readonly Record<string, unknown>[],
    events: readonly Record<string, unknown>[],
  ): readonly TavernOpportunity[] {
    const presentNpcIds = new Set<string>([
      ...currentMembers.filter(({ presence }) => presence === 'PRESENT').map(({ npcId }) => npcId),
      ...currentMembers
        .filter(({ sourceKind }) => sourceKind === 'OWNER' || sourceKind === 'ESTABLISHED')
        .map(({ npcId }) => npcId),
    ]);
    for (const value of this.database
      .prepare(
        `SELECT id FROM npcs
         WHERE campaign_id=? AND current_status='ACTIVE'
           AND tavern_id=(SELECT id FROM taverns WHERE campaign_id=? ORDER BY created_at,id LIMIT 1)
         ORDER BY id`,
      )
      .all(campaign, campaign)) {
      presentNpcIds.add(requireString(requireRecord(value, 'active tavern NPC')['id'], 'npc.id'));
    }
    const opportunities: TavernOpportunity[] = [];
    for (const value of this.database
      .prepare(
        `SELECT id,statement,detail_json FROM world_facts
         WHERE campaign_id=? AND kind='RUMOR' ORDER BY created_at,id`,
      )
      .all(campaign)) {
      const row = requireRecord(value, 'population rumor');
      const detail = requireRecord(
        parseJson(row['detail_json'], 'rumor.detail_json'),
        'rumor detail',
      );
      const source = detail['sourceNpcId'];
      if (typeof source === 'string' && presentNpcIds.has(source)) {
        opportunities.push(
          createTavernOpportunity({
            id: `rumor:${requireString(row['id'], 'rumor.id')}`,
            kind: 'RUMOR',
            sourceId: source,
            title: requireString(row['statement'], 'rumor.statement'),
            detail: requireString(row['statement'], 'rumor.statement'),
          }),
        );
      }
    }
    for (const value of this.database
      .prepare(
        `SELECT id,publisher_npc_id,content_json FROM quests
         WHERE campaign_id=? AND status='AVAILABLE' ORDER BY created_at,id`,
      )
      .all(campaign)) {
      const row = requireRecord(value, 'population quest');
      const source = requireString(row['publisher_npc_id'], 'quest.publisher_npc_id');
      if (!presentNpcIds.has(source)) continue;
      const content = requireRecord(
        parseJson(row['content_json'], 'quest.content_json'),
        'quest content',
      );
      opportunities.push(
        createTavernOpportunity({
          id: `quest:${requireString(row['id'], 'quest.id')}`,
          kind: 'QUEST',
          sourceId: source,
          title: requireString(content['title'], 'quest.title'),
          detail: requireString(content['summary'], 'quest.summary'),
        }),
      );
    }
    for (const faction of factions) {
      if (
        !factors.some(
          ({ sourceKind, sourceId }) => sourceKind === 'FACTION' && sourceId === faction.id,
        )
      )
        continue;
      opportunities.push(
        createTavernOpportunity({
          id: `faction:${faction.id}:${faction.revision}`,
          kind: 'FACTION',
          sourceId: faction.id,
          title: faction.name,
          detail: faction.currentAction ?? faction.goal,
        }),
      );
    }
    for (const clock of clocks) {
      const current = requireNumber(clock['current'], 'clock.current');
      if (current <= 0) continue;
      opportunities.push(
        createTavernOpportunity({
          id: `clock:${requireString(clock['id'], 'clock.id')}:${current}`,
          kind: 'CLOCK',
          sourceId: requireString(clock['id'], 'clock.id'),
          title: requireString(clock['name'], 'clock.name'),
          detail: `进度 ${current}/${requireNumber(clock['max'], 'clock.max')}`,
        }),
      );
    }
    const event = events[0];
    if (event !== undefined) {
      const eventId = requireString(event['id'], 'event.id');
      opportunities.push(
        createTavernOpportunity({
          id: `event:${eventId}`,
          kind: 'EVENT',
          sourceId: eventId,
          title: requireString(event['type'], 'event.type'),
          detail:
            JSON.stringify(parseJson(event['payload_json'], 'event.payload_json')).slice(
              0,
              4_000,
            ) || '{}',
        }),
      );
    }
    return Object.freeze(opportunities);
  }

  private buildCandidates(
    campaign: CampaignId,
    currentMembers: readonly TavernPopulationMember[],
    facts: PopulationFacts,
    at: string,
  ): readonly TavernPopulationCandidate[] {
    const tavern = this.requireTavern(campaign);
    const established = this.database
      .prepare(
        `SELECT npc.id,npc.residency,profile.profile_json
         FROM npcs npc JOIN npc_lod_profiles profile ON profile.id=npc.id
         WHERE npc.campaign_id=? AND npc.tavern_id=? AND npc.current_status='ACTIVE'
         ORDER BY CASE npc.residency WHEN 'OWNER' THEN 0 WHEN 'RESIDENT' THEN 1 ELSE 2 END,npc.id`,
      )
      .all(campaign, tavern.id)
      .map((value) => {
        const row = requireRecord(value, 'established population');
        const profile = parseProfileRow(row);
        const sourceKind = profile.id === tavern.ownerNpcId ? 'OWNER' : 'ESTABLISHED';
        return Object.freeze({
          profile,
          sourceKind,
          sourceId: profile.id,
          populationRole: profile.populationRole,
        }) satisfies TavernPopulationCandidate;
      });
    const bySource = new Map(
      currentMembers.map((member) => [`${member.sourceKind}:${member.sourceId}`, member]),
    );
    const dynamic = facts.factors.map((factor) => {
      const prior = bySource.get(`${factor.sourceKind}:${factor.sourceId}`);
      const profile =
        prior?.profile ??
        createNpcLodProfile({
          schemaVersion: 1,
          id: this.createId(),
          campaignId: campaign,
          constitutionRevision: facts.constitutionRevision,
          lod: 0,
          revision: 1,
          identityAnchor: `population:${factor.sourceKind.toLowerCase()}:${factor.sourceId}`,
          populationRole: factor.populationRole,
          name: null,
          appearance: null,
          currentBehavior: null,
          career: null,
          personality: null,
          goals: [],
          knowledgeFactIds: [],
          relationshipNpcIds: [],
          memoryIds: [],
          secretFactIds: [],
          questIds: [],
          itemIds: [],
          experienceEventIds: [],
          constitutionEvidence: facts.constitutionEvidence,
          generationRecordId: null,
          createdAt: at,
          updatedAt: at,
        });
      if (prior === undefined) this.insertProfile(profile);
      return Object.freeze({ ...factor, profile }) satisfies TavernPopulationCandidate;
    });
    return Object.freeze([...established, ...dynamic]);
  }

  private insertProfile(profile: NpcLodProfile): void {
    this.database
      .prepare(
        `INSERT INTO npc_lod_profiles
        (id,campaign_id,schema_version,constitution_revision,lod,revision,profile_json,
         generation_record_id,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,NULL,?,?)`,
      )
      .run(
        profile.id,
        profile.campaignId,
        profile.schemaVersion,
        profile.constitutionRevision,
        profile.lod,
        profile.revision,
        JSON.stringify(profile),
        profile.createdAt,
        profile.updatedAt,
      );
  }

  private writeProjection(
    state: NonNullable<TavernPopulationSnapshot['state']>,
    members: readonly TavernPopulationMember[],
  ): void {
    const exists = this.database
      .prepare('SELECT revision FROM tavern_population_states WHERE tavern_id=?')
      .get(state.tavernId);
    if (exists === undefined) {
      this.database
        .prepare(
          `INSERT INTO tavern_population_states
          (tavern_id,campaign_id,revision,last_trigger,context_json,opportunities_json,empty_state,projected_at)
          VALUES (?,?,?,?,?,?,?,?)`,
        )
        .run(
          state.tavernId,
          state.campaignId,
          state.revision,
          state.trigger,
          JSON.stringify(state.context),
          JSON.stringify(state.opportunities),
          state.emptyState ? 1 : 0,
          state.projectedAt,
        );
    } else {
      const changed = this.database
        .prepare(
          `UPDATE tavern_population_states SET
           revision=?,last_trigger=?,context_json=?,opportunities_json=?,empty_state=?,projected_at=?
           WHERE tavern_id=? AND campaign_id=? AND revision=?`,
        )
        .run(
          state.revision,
          state.trigger,
          JSON.stringify(state.context),
          JSON.stringify(state.opportunities),
          state.emptyState ? 1 : 0,
          state.projectedAt,
          state.tavernId,
          state.campaignId,
          state.revision - 1,
        ).changes;
      if (changed !== 1) throw new PersistenceDataError('Tavern population revision drift');
    }
    for (const member of members) {
      const memberExists = this.database
        .prepare('SELECT 1 FROM tavern_population_members WHERE tavern_id=? AND npc_id=?')
        .get(state.tavernId, member.npcId);
      if (memberExists === undefined) {
        this.database
          .prepare(
            `INSERT INTO tavern_population_members
            (tavern_id,campaign_id,npc_id,source_kind,source_id,population_role,presence,
             is_important,first_seen_at,last_seen_at,encounter_count)
            VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
          )
          .run(
            state.tavernId,
            state.campaignId,
            member.npcId,
            member.sourceKind,
            member.sourceId,
            member.populationRole,
            member.presence,
            member.isImportant ? 1 : 0,
            member.firstSeenAt,
            member.lastSeenAt,
            member.encounterCount,
          );
      } else {
        this.database
          .prepare(
            `UPDATE tavern_population_members SET
             presence=?,is_important=?,last_seen_at=?,encounter_count=?
             WHERE tavern_id=? AND campaign_id=? AND npc_id=?`,
          )
          .run(
            member.presence,
            member.isImportant ? 1 : 0,
            member.lastSeenAt,
            member.encounterCount,
            state.tavernId,
            state.campaignId,
            member.npcId,
          );
      }
    }
  }
}

function mapState(value: unknown): NonNullable<TavernPopulationSnapshot['state']> {
  const row = requireRecord(value, 'population state');
  return createTavernPopulationState({
    campaignId: requireString(row['campaign_id'], 'campaign_id'),
    tavernId: requireString(row['tavern_id'], 'tavern_id'),
    revision: requireNumber(row['revision'], 'revision'),
    trigger: requireString(row['last_trigger'], 'last_trigger') as TavernPopulationTrigger,
    context: parseJson(row['context_json'], 'context_json') as TavernPopulationContext,
    opportunities: parseJson(
      row['opportunities_json'],
      'opportunities_json',
    ) as TavernOpportunity[],
    emptyState: requireNumber(row['empty_state'], 'empty_state') === 1,
    projectedAt: requireString(row['projected_at'], 'projected_at'),
  });
}

function mapMember(value: unknown): TavernPopulationMember {
  const row = requireRecord(value, 'population member');
  return createTavernPopulationMember({
    npcId: requireString(row['npc_id'], 'npc_id'),
    sourceKind: requireString(row['source_kind'], 'source_kind') as TavernPopulationSourceKind,
    sourceId: requireString(row['source_id'], 'source_id'),
    populationRole: requireString(row['population_role'], 'population_role'),
    presence: requireString(row['presence'], 'presence') as TavernPopulationMember['presence'],
    isImportant: requireNumber(row['is_important'], 'is_important') === 1,
    firstSeenAt: requireString(row['first_seen_at'], 'first_seen_at'),
    lastSeenAt: requireString(row['last_seen_at'], 'last_seen_at'),
    encounterCount: requireNumber(row['encounter_count'], 'encounter_count'),
    profile: parseProfileRow(row),
  });
}

function mapCycle(value: unknown): TavernPopulationSnapshot['cycles'][number] {
  const row = requireRecord(value, 'population cycle');
  return createTavernPopulationCycle({
    id: requireString(row['id'], 'id'),
    operationId: requireString(row['operation_id'], 'operation_id'),
    campaignId: requireString(row['campaign_id'], 'campaign_id'),
    tavernId: requireString(row['tavern_id'], 'tavern_id'),
    trigger: requireString(row['trigger'], 'trigger') as TavernPopulationTrigger,
    beforeRevision: requireNumber(row['before_revision'], 'before_revision'),
    afterRevision: requireNumber(row['after_revision'], 'after_revision'),
    context: parseJson(row['context_json'], 'context_json') as TavernPopulationContext,
    presentNpcIds: parseJson(row['present_npc_ids_json'], 'present_npc_ids_json') as string[],
    opportunityIds: parseJson(row['opportunity_ids_json'], 'opportunity_ids_json') as string[],
    occurredAt: requireString(row['occurred_at'], 'occurred_at'),
  });
}

function mapFocusEvent(value: unknown): TavernPopulationSnapshot['focusHistory'][number] {
  const row = requireRecord(value, 'population focus event');
  return createTavernPopulationFocusEvent({
    id: requireString(row['id'], 'id'),
    operationId: requireString(row['operation_id'], 'operation_id'),
    campaignId: requireString(row['campaign_id'], 'campaign_id'),
    tavernId: requireString(row['tavern_id'], 'tavern_id'),
    npcId: requireString(row['npc_id'], 'npc_id'),
    beforeRevision: requireNumber(row['before_revision'], 'before_revision'),
    afterRevision: requireNumber(row['after_revision'], 'after_revision'),
    npcLod: requireNumber(row['npc_lod'], 'npc_lod'),
    occurredAt: requireString(row['occurred_at'], 'occurred_at'),
  });
}

function parseProfileRow(value: unknown): NpcLodProfile {
  const row = requireRecord(value, 'population profile');
  return parseNpcLodProfile(parseJson(row['profile_json'], 'profile_json'));
}

function requireIdentity(value: string, label: string): void {
  if (value.trim() !== value || value.length === 0 || value.length > 200) {
    throw new PersistenceDataError(`${label} identity is invalid`);
  }
}

function rollback(database: TransactionalSqliteDatabase, error: unknown, message: string): never {
  try {
    database.exec('ROLLBACK');
  } catch (rollbackError) {
    throw new PersistenceDataError(`${message}; rollback failed`, {
      cause: new AggregateError([error, rollbackError]),
    });
  }
  if (error instanceof PersistenceDataError) throw error;
  throw new PersistenceDataError(message, { cause: error });
}

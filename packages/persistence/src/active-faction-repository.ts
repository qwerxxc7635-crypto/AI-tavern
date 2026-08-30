import {
  campaignId,
  factionActionProposal,
  isoTimestamp,
  parseActiveFactionProfile,
  type ActiveFactionCandidate,
  type ActiveFactionProfile,
  type CampaignId,
  type FactionActionBudget,
  type FactionActionEvent,
  type FactionActionProposal,
  type Quest,
} from '@ember-tavern/contracts';
import { activateFactions, applyFactionAction } from '@ember-tavern/domain';

import { PersistenceDataError } from './campaign-repository.js';
import {
  parseJson,
  requireNumber,
  requireRecord,
  requireString,
} from './persistence-validation.js';
import { QuestRepository } from './quest-adventure-repository.js';
import type { TransactionalSqliteDatabase } from './sqlite-port.js';
import { WorldConstitutionRepository } from './world-constitution-repository.js';

export interface ActiveFactionSnapshot {
  readonly factions: readonly ActiveFactionProfile[];
  readonly actionHistory: readonly FactionActionEvent[];
}

export interface CommitFactionActivation {
  readonly campaignId: CampaignId;
  readonly requestedFactionIds: readonly string[];
  readonly candidates: readonly ActiveFactionCandidate[];
  readonly generationRecordId: string;
  readonly at: string;
}

export interface CommitFactionAction {
  readonly eventId: string;
  readonly operationId: string;
  readonly campaignId: CampaignId;
  readonly expectedRevision: number;
  readonly proposal: FactionActionProposal;
  readonly budget: FactionActionBudget;
  readonly worldFactId: string | null;
  readonly at: string;
}

export class ActiveFactionRepository {
  public constructor(private readonly database: TransactionalSqliteDatabase) {}

  public snapshot(campaign: CampaignId): ActiveFactionSnapshot {
    const factions = Object.freeze(
      this.database
        .prepare('SELECT * FROM active_factions WHERE campaign_id=? ORDER BY name,id')
        .all(campaign)
        .map(mapFaction),
    );
    if (factions.length === 0)
      throw new PersistenceDataError(`Active factions not found: ${campaign}`);
    const actionHistory = Object.freeze(
      this.database
        .prepare('SELECT * FROM faction_action_events WHERE campaign_id=? ORDER BY occurred_at,id')
        .all(campaign)
        .map(mapActionEvent),
    );
    return Object.freeze({ factions, actionHistory });
  }

  public activate(command: CommitFactionActivation): ActiveFactionSnapshot {
    const at = isoTimestamp(command.at);
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const replay = this.database
        .prepare(
          'SELECT profile_json FROM active_factions WHERE generation_record_id=? ORDER BY id',
        )
        .all(command.generationRecordId)
        .map((row) =>
          parseActiveFactionProfile(
            parseJson(requireRecord(row, 'faction replay')['profile_json'], 'profile_json'),
          ),
        );
      if (replay.length > 0) {
        const expected = [...command.candidates].sort((a, b) => a.id.localeCompare(b.id));
        const actual = replay.map(toCandidate).sort((a, b) => a.id.localeCompare(b.id));
        if (JSON.stringify(actual) !== JSON.stringify(expected)) {
          throw new PersistenceDataError('Faction generation replay conflicts with prior data');
        }
        const saved = this.snapshot(command.campaignId);
        this.database.exec('COMMIT');
        return saved;
      }
      requireFactionGeneration(this.database, command.campaignId, command.generationRecordId);
      const current = this.snapshot(command.campaignId);
      const constitution = new WorldConstitutionRepository(this.database).requireRevision(
        command.campaignId,
        current.factions[0]?.constitutionRevision ?? 0,
      );
      const locations = this.database
        .prepare('SELECT id FROM dynamic_locations WHERE campaign_id=? ORDER BY id')
        .all(command.campaignId)
        .map((row) => requireString(requireRecord(row, 'faction location')['id'], 'id'));
      const profiles = activateFactions({
        campaignId: command.campaignId,
        constitution,
        existing: current.factions,
        requestedFactionIds: command.requestedFactionIds,
        candidates: command.candidates,
        allowedLocationIds: locations,
        generationRecordId: command.generationRecordId,
        at,
      });
      for (const profile of profiles) updateFaction(this.database, profile, profile.revision - 1);
      const saved = this.snapshot(command.campaignId);
      this.database.exec('COMMIT');
      return saved;
    } catch (error) {
      rollback(this.database, error, 'Faction activation failed');
    }
  }

  public applyAction(command: CommitFactionAction): ActiveFactionSnapshot {
    const at = isoTimestamp(command.at);
    if (!Number.isSafeInteger(command.expectedRevision) || command.expectedRevision < 1) {
      throw new PersistenceDataError('Faction action revision is invalid');
    }
    const proposal = factionActionProposal(command.proposal);
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const replay = this.database
        .prepare('SELECT * FROM faction_action_events WHERE operation_id=?')
        .get(command.operationId);
      if (replay !== undefined) {
        const row = requireRecord(replay, 'faction action replay');
        if (
          requireString(row['campaign_id'], 'campaign_id') !== command.campaignId ||
          requireNumber(row['before_revision'], 'before_revision') !== command.expectedRevision ||
          requireString(row['budget_decision_id'], 'budget_decision_id') !==
            command.budget.decisionId ||
          JSON.stringify(parseJson(row['proposal_json'], 'proposal_json')) !==
            JSON.stringify(proposal) ||
          JSON.stringify(parseJson(row['budget_json'], 'budget_json')) !==
            JSON.stringify(command.budget)
        ) {
          throw new PersistenceDataError('Faction action operation conflicts with prior use');
        }
        const saved = this.snapshot(command.campaignId);
        this.database.exec('COMMIT');
        return saved;
      }
      const before = this.snapshot(command.campaignId);
      const actor = before.factions.find(({ id }) => id === proposal.factionId);
      if (actor?.revision !== command.expectedRevision) {
        throw new PersistenceDataError('Faction action revision drift');
      }
      const constitution = new WorldConstitutionRepository(this.database).requireRevision(
        command.campaignId,
        actor.constitutionRevision,
      );
      const locations = this.database
        .prepare('SELECT id FROM dynamic_locations WHERE campaign_id=?')
        .all(command.campaignId)
        .map((row) => requireString(requireRecord(row, 'faction location')['id'], 'id'));
      const quests = new QuestRepository(this.database).listByCampaign(command.campaignId);
      const plan = applyFactionAction({
        campaignId: command.campaignId,
        constitution,
        factions: before.factions,
        locationIds: locations,
        quests,
        proposal,
        budget: command.budget,
        at,
      });
      const changed = plan.factions.filter((next) => {
        const prior = before.factions.find(({ id }) => id === next.id);
        return prior !== undefined && next.revision !== prior.revision;
      });
      for (const profile of changed) updateFaction(this.database, profile, profile.revision - 1);
      const questChange = changedQuest(quests, plan.quests);
      if (questChange !== null) {
        new QuestRepository(this.database).update(questChange.after);
      }
      if (plan.worldFacts.length !== (command.worldFactId === null ? 0 : 1)) {
        throw new PersistenceDataError('Faction action world fact identity is invalid');
      }
      const fact = plan.worldFacts[0];
      if (fact !== undefined && command.worldFactId !== null) {
        this.database
          .prepare(
            `INSERT INTO world_facts
            (id,campaign_id,kind,statement,location_id,faction_ids_json,detail_json,supersedes_fact_id,created_at)
            VALUES (?,?,'DEVELOPING_FACT',?,?,?,'{}',NULL,?)`,
          )
          .run(
            command.worldFactId,
            command.campaignId,
            fact.statement,
            fact.locationId,
            JSON.stringify([proposal.factionId]),
            at,
          );
      }
      const afterActor = plan.factions.find(({ id }) => id === proposal.factionId);
      if (afterActor === undefined)
        throw new PersistenceDataError('Faction action actor disappeared');
      this.database
        .prepare(
          `INSERT INTO faction_action_events
          (id,campaign_id,faction_id,operation_id,source,action_kind,summary,cost,budget_decision_id,
           budget_json,proposal_json,affected_before_json,affected_after_json,before_revision,after_revision,
           quest_id,quest_before_status,quest_after_status,world_fact_id,occurred_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          command.eventId,
          command.campaignId,
          proposal.factionId,
          command.operationId,
          proposal.source,
          proposal.kind,
          proposal.summary,
          plan.cost,
          command.budget.decisionId,
          JSON.stringify(command.budget),
          JSON.stringify(proposal),
          JSON.stringify(changed.map(({ id }) => before.factions.find((item) => item.id === id))),
          JSON.stringify(changed),
          actor.revision,
          afterActor.revision,
          questChange?.after.id ?? null,
          questChange?.before.status ?? null,
          questChange?.after.status ?? null,
          command.worldFactId,
          at,
        );
      const saved = this.snapshot(command.campaignId);
      this.database.exec('COMMIT');
      return saved;
    } catch (error) {
      rollback(this.database, error, 'Faction action failed');
    }
  }
}

function updateFaction(
  database: TransactionalSqliteDatabase,
  profile: ActiveFactionProfile,
  expected: number,
): void {
  const changed = database
    .prepare(
      `UPDATE active_factions SET materialization=?,profile_json=?,generation_record_id=?,revision=?,updated_at=?
      WHERE id=? AND campaign_id=? AND revision=?`,
    )
    .run(
      profile.materialization,
      JSON.stringify(profile),
      profile.generationRecordId,
      profile.revision,
      profile.updatedAt,
      profile.id,
      profile.campaignId,
      expected,
    ).changes;
  if (changed !== 1) throw new PersistenceDataError(`Faction revision drift: ${profile.id}`);
}

function mapFaction(value: unknown): ActiveFactionProfile {
  const row = requireRecord(value, 'active faction row');
  const profile = parseActiveFactionProfile(parseJson(row['profile_json'], 'profile_json'));
  if (
    profile.id !== requireString(row['id'], 'id') ||
    profile.campaignId !== requireString(row['campaign_id'], 'campaign_id') ||
    profile.revision !== requireNumber(row['revision'], 'revision') ||
    profile.materialization !== requireString(row['materialization'], 'materialization')
  )
    throw new PersistenceDataError('Active faction columns disagree with profile JSON');
  return profile;
}

function mapActionEvent(value: unknown): FactionActionEvent {
  const row = requireRecord(value, 'faction action row');
  return Object.freeze({
    id: requireString(row['id'], 'id'),
    campaignId: campaignId(requireString(row['campaign_id'], 'campaign_id')),
    factionId: requireString(row['faction_id'], 'faction_id') as FactionActionEvent['factionId'],
    source: requireString(row['source'], 'source') as FactionActionEvent['source'],
    actionKind: requireString(
      row['action_kind'],
      'action_kind',
    ) as FactionActionEvent['actionKind'],
    summary: requireString(row['summary'], 'summary'),
    cost: requireNumber(row['cost'], 'cost'),
    budgetDecisionId: requireString(row['budget_decision_id'], 'budget_decision_id'),
    beforeRevision: requireNumber(row['before_revision'], 'before_revision'),
    afterRevision: requireNumber(row['after_revision'], 'after_revision'),
    proposal: factionActionProposal(
      parseJson(row['proposal_json'], 'proposal_json') as FactionActionProposal,
    ),
    occurredAt: isoTimestamp(requireString(row['occurred_at'], 'occurred_at')),
  });
}

function changedQuest(
  before: readonly Quest[],
  after: readonly Quest[],
): { before: Quest; after: Quest } | null {
  const changes = after.flatMap((next) => {
    const prior = before.find(({ id }) => id === next.id);
    return prior !== undefined && prior.status !== next.status
      ? [{ before: prior, after: next }]
      : [];
  });
  if (changes.length > 1) throw new PersistenceDataError('Faction action changed multiple quests');
  return changes[0] ?? null;
}

function toCandidate(profile: ActiveFactionProfile): ActiveFactionCandidate {
  if (profile.currentAction === null)
    throw new PersistenceDataError('Activated faction action missing');
  return {
    id: profile.id,
    name: profile.name,
    goal: profile.goal,
    resources: profile.resources,
    leadership: profile.leadership,
    enemyFactionIds: profile.enemyFactionIds,
    allyFactionIds: profile.allyFactionIds,
    territoryLocationIds: profile.territoryLocationIds,
    currentAction: profile.currentAction,
    playerRelation: profile.playerRelation,
    constitutionEvidence: profile.constitutionEvidence,
  };
}

function requireFactionGeneration(
  database: TransactionalSqliteDatabase,
  campaign: CampaignId,
  generation: string,
): void {
  const row = requireRecord(
    database.prepare('SELECT campaign_id,task FROM generation_records WHERE id=?').get(generation),
    'faction generation',
  );
  if (
    requireString(row['campaign_id'], 'campaign_id') !== campaign ||
    requireString(row['task'], 'task') !== 'GENERATE_FACTIONS'
  ) {
    throw new PersistenceDataError('Faction generation record is invalid');
  }
}

function rollback(database: TransactionalSqliteDatabase, error: unknown, message: string): never {
  try {
    database.exec('ROLLBACK');
  } catch (rollbackError) {
    throw new AggregateError([error, rollbackError], `${message}; rollback failed`, {
      cause: rollbackError,
    });
  }
  if (error instanceof PersistenceDataError) throw error;
  throw new PersistenceDataError(message, { cause: error });
}

import {
  DIRECTOR_BUDGET_CATEGORIES,
  DIRECTOR_BUDGET_REASONS,
  DIRECTOR_BUDGET_STATUSES,
  WORLD_DIRECTOR_ACTION_KINDS,
  WORLD_DIRECTOR_URGENCIES,
  campaignId,
  isoTimestamp,
  type CampaignId,
  type DirectorBudgetCategory,
  type DirectorBudgetEntry,
  type DirectorBudgetReason,
  type DirectorBudgetSnapshot,
  type DirectorBudgetStatus,
  type IsoTimestamp,
  type WorldDirectorActionKind,
  type WorldDirectorUrgency,
} from '@ember-tavern/contracts';
import {
  DIRECTOR_BUDGET_LIMITS,
  capacityReason,
  compareDirectorBudgetEntries,
  directorBudgetCategory,
  directorCooldownMinutes,
  directorGameDay,
  nextDirectorGameDay,
} from '@ember-tavern/domain';
import { PersistenceDataError } from './campaign-repository.js';
import {
  requireEnum,
  requireNumber,
  requireRecord,
  requireString,
} from './persistence-validation.js';
import type { TransactionalSqliteDatabase } from './sqlite-port.js';

export interface AdmitDirectorRun {
  readonly campaignId: CampaignId;
  readonly runId: string;
  readonly occurredAt: IsoTimestamp;
}
interface PendingEntry extends DirectorBudgetEntry {
  readonly campaignId: CampaignId;
}
interface MutableUsage {
  dailyEvents: number;
  urgentEvents: number;
  npcProactive: number;
  backgroundChanges: number;
}

export class DirectorBudgetRepository {
  public constructor(private readonly database: TransactionalSqliteDatabase) {}

  public admitRun(command: AdmitDirectorRun): DirectorBudgetSnapshot {
    requireIdentity(command.runId, 'Director run');
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const result = this.admit(command);
      this.database.exec('COMMIT');
      return result;
    } catch (error) {
      try {
        this.database.exec('ROLLBACK');
      } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], 'Director Budget rollback failed', {
          cause: rollbackError,
        });
      }
      throw error;
    }
  }

  public get(campaign: CampaignId): DirectorBudgetSnapshot | null {
    const state = this.database
      .prepare('SELECT * FROM director_budget_states WHERE campaign_id=?')
      .get(campaign);
    return state === undefined ? null : this.mapSnapshot(campaign, state);
  }

  private admit(command: AdmitDirectorRun): DirectorBudgetSnapshot {
    const run = requireRecord(
      this.database
        .prepare('SELECT campaign_id FROM world_director_runs WHERE id=?')
        .get(command.runId),
      'Director run is missing',
    );
    if (requireString(run['campaign_id'], 'run.campaignId') !== command.campaignId)
      throw new PersistenceDataError('Director run belongs to another campaign');
    if (
      this.database
        .prepare('SELECT 1 FROM director_budget_admissions WHERE run_id=?')
        .get(command.runId) !== undefined
    ) {
      const existing = this.get(command.campaignId);
      if (existing === null) throw new PersistenceDataError('Director Budget state is missing');
      return existing;
    }
    this.database
      .prepare(
        'INSERT INTO director_budget_admissions(run_id,campaign_id,admitted_at) VALUES(?,?,?)',
      )
      .run(command.runId, command.campaignId, command.occurredAt);
    const clock = requireRecord(
      this.database
        .prepare('SELECT game_time_minutes FROM character_rule_states WHERE campaign_id=?')
        .get(command.campaignId),
      'Director Budget requires an initialized Rules Engine clock',
    );
    const gameTime = safeInteger(clock['game_time_minutes'], 'rules.gameTimeMinutes');
    const gameDay = directorGameDay(gameTime);
    const stored = this.database
      .prepare('SELECT * FROM director_budget_states WHERE campaign_id=?')
      .get(command.campaignId);
    let revision = 1;
    const usage: MutableUsage = {
      dailyEvents: 0,
      urgentEvents: 0,
      npcProactive: 0,
      backgroundChanges: 0,
    };
    if (stored !== undefined) {
      const state = requireRecord(stored, 'Director Budget state');
      if (gameTime < safeInteger(state['game_time_minutes'], 'budget.gameTimeMinutes'))
        throw new PersistenceDataError('Director game time cannot move backwards');
      revision = positiveInteger(state['revision'], 'budget.revision') + 1;
      if (safeInteger(state['game_day'], 'budget.gameDay') === gameDay) {
        usage.dailyEvents = safeInteger(state['daily_events_used'], 'budget.dailyEvents');
        usage.urgentEvents = safeInteger(state['urgent_events_used'], 'budget.urgentEvents');
        usage.npcProactive = safeInteger(state['npc_proactive_used'], 'budget.npcProactive');
        usage.backgroundChanges = safeInteger(
          state['background_changes_used'],
          'budget.backgroundChanges',
        );
      }
    }
    this.insertRunEntries(command, gameTime);
    const pending = this.loadPending(command.campaignId).sort((a, b) =>
      compareDirectorBudgetEntries(a, b, gameTime),
    );
    let activeReservations = this.activeQuestCount(command.campaignId);
    for (const entry of pending) {
      let reason: DirectorBudgetReason | null = null;
      let eligibleAt = gameTime;
      if (
        entry.kind === 'OPPORTUNITY' &&
        activeReservations >= DIRECTOR_BUDGET_LIMITS.activeQuests
      ) {
        reason = 'ACTIVE_QUEST_LIMIT';
        eligibleAt = nextDirectorGameDay(gameTime);
      }
      const cooldown = this.cooldown(command.campaignId, entry.cooldownKey);
      if (reason === null && cooldown > gameTime) {
        reason = 'COOLDOWN';
        eligibleAt = cooldown;
      }
      if (reason === null) {
        reason = capacityReason(entry.category, usage);
        if (reason !== null) eligibleAt = nextDirectorGameDay(gameTime);
      }
      if (reason === null) {
        this.database
          .prepare(
            `UPDATE director_budget_entries SET status='APPROVED',approved_game_time=?,eligible_game_time=?,
           reason='AVAILABLE',updated_at=? WHERE run_id=? AND ordinal=?`,
          )
          .run(gameTime, gameTime, command.occurredAt, entry.runId, entry.ordinal);
        consume(entry.category, usage);
        if (entry.kind === 'OPPORTUNITY') activeReservations += 1;
        this.storeCooldown(entry, gameTime, command.occurredAt);
        this.recordDecision(command, entry, 'APPROVED', 'AVAILABLE', gameDay, gameTime);
      } else {
        this.database
          .prepare(
            `UPDATE director_budget_entries SET eligible_game_time=?,reason=?,updated_at=? WHERE run_id=? AND ordinal=?`,
          )
          .run(
            Math.max(entry.requestedGameTime, eligibleAt),
            reason,
            command.occurredAt,
            entry.runId,
            entry.ordinal,
          );
        this.recordDecision(command, entry, 'DEFERRED', reason, gameDay, gameTime);
      }
    }
    this.storeState(command, gameDay, gameTime, usage, revision);
    const snapshot = this.get(command.campaignId);
    if (snapshot === null) throw new PersistenceDataError('Director Budget state was not stored');
    return snapshot;
  }

  private insertRunEntries(command: AdmitDirectorRun, gameTime: number): void {
    const rows = this.database
      .prepare('SELECT ordinal,kind FROM world_director_proposals WHERE run_id=? ORDER BY ordinal')
      .all(command.runId);
    const statement = this.database.prepare(
      `INSERT INTO director_budget_entries(run_id,campaign_id,ordinal,category,status,requested_game_time,
       eligible_game_time,approved_game_time,reason,created_at,updated_at)
       VALUES(?,?,?,?,'DEFERRED',?,?,NULL,'AVAILABLE',?,?)`,
    );
    for (const value of rows) {
      const row = requireRecord(value, 'Director proposal');
      const kind = requireEnum(WORLD_DIRECTOR_ACTION_KINDS, row['kind'], 'proposal.kind');
      statement.run(
        command.runId,
        command.campaignId,
        positiveInteger(row['ordinal'], 'proposal.ordinal'),
        directorBudgetCategory(kind),
        gameTime,
        gameTime,
        command.occurredAt,
        command.occurredAt,
      );
    }
  }

  private loadPending(campaign: CampaignId): PendingEntry[] {
    return this.database
      .prepare(
        `SELECT entry.*,proposal.action_id,proposal.kind,proposal.urgency,proposal.cooldown_key
       FROM director_budget_entries entry JOIN world_director_proposals proposal
       ON proposal.run_id=entry.run_id AND proposal.ordinal=entry.ordinal
       WHERE entry.campaign_id=? AND entry.status='DEFERRED'`,
      )
      .all(campaign)
      .map((value) => mapEntry(value, campaign));
  }

  private cooldown(campaign: CampaignId, key: string): number {
    const row = this.database
      .prepare(
        'SELECT next_eligible_game_time FROM director_budget_cooldowns WHERE campaign_id=? AND cooldown_key=?',
      )
      .get(campaign, key);
    return row === undefined
      ? 0
      : safeInteger(requireRecord(row, 'cooldown')['next_eligible_game_time'], 'cooldown.next');
  }

  private storeCooldown(entry: PendingEntry, gameTime: number, at: IsoTimestamp): void {
    const duration = directorCooldownMinutes(entry.kind);
    if (duration === 0) return;
    this.database
      .prepare(
        `INSERT INTO director_budget_cooldowns(campaign_id,cooldown_key,next_eligible_game_time,
       source_run_id,source_ordinal,updated_at) VALUES(?,?,?,?,?,?)
       ON CONFLICT(campaign_id,cooldown_key) DO UPDATE SET
       next_eligible_game_time=excluded.next_eligible_game_time,source_run_id=excluded.source_run_id,
       source_ordinal=excluded.source_ordinal,updated_at=excluded.updated_at`,
      )
      .run(
        entry.campaignId,
        entry.cooldownKey,
        gameTime + duration,
        entry.runId,
        entry.ordinal,
        at,
      );
  }

  private activeQuestCount(campaign: CampaignId): number {
    const row = requireRecord(
      this.database
        .prepare(
          "SELECT COUNT(*) AS count FROM quest_pool_states WHERE campaign_id=? AND status='ACTIVE'",
        )
        .get(campaign),
      'active Quest count',
    );
    return safeInteger(row['count'], 'active Quest count');
  }

  private recordDecision(
    command: AdmitDirectorRun,
    entry: PendingEntry,
    outcome: 'APPROVED' | 'DEFERRED',
    reason: DirectorBudgetReason,
    gameDay: number,
    gameTime: number,
  ): void {
    this.database
      .prepare(
        `INSERT INTO director_budget_decisions(campaign_id,evaluation_run_id,proposal_run_id,
       proposal_ordinal,outcome,reason,game_day,game_time_minutes,occurred_at) VALUES(?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        command.campaignId,
        command.runId,
        entry.runId,
        entry.ordinal,
        outcome,
        reason,
        gameDay,
        gameTime,
        command.occurredAt,
      );
  }

  private storeState(
    command: AdmitDirectorRun,
    gameDay: number,
    gameTime: number,
    usage: MutableUsage,
    revision: number,
  ): void {
    this.database
      .prepare(
        `INSERT INTO director_budget_states(campaign_id,schema_version,game_day,game_time_minutes,
       daily_events_used,urgent_events_used,npc_proactive_used,background_changes_used,revision,updated_at)
       VALUES(?,1,?,?,?,?,?,?,?,?) ON CONFLICT(campaign_id) DO UPDATE SET
       game_day=excluded.game_day,game_time_minutes=excluded.game_time_minutes,
       daily_events_used=excluded.daily_events_used,urgent_events_used=excluded.urgent_events_used,
       npc_proactive_used=excluded.npc_proactive_used,background_changes_used=excluded.background_changes_used,
       revision=excluded.revision,updated_at=excluded.updated_at`,
      )
      .run(
        command.campaignId,
        gameDay,
        gameTime,
        usage.dailyEvents,
        usage.urgentEvents,
        usage.npcProactive,
        usage.backgroundChanges,
        revision,
        command.occurredAt,
      );
  }

  private mapSnapshot(campaign: CampaignId, value: unknown): DirectorBudgetSnapshot {
    const row = requireRecord(value, 'Director Budget state');
    const entries = this.database
      .prepare(
        `SELECT entry.*,proposal.action_id,proposal.kind,proposal.urgency,proposal.cooldown_key
       FROM director_budget_entries entry JOIN world_director_proposals proposal
       ON proposal.run_id=entry.run_id AND proposal.ordinal=entry.ordinal
       WHERE entry.campaign_id=? ORDER BY entry.requested_game_time,entry.run_id,entry.ordinal`,
      )
      .all(campaign)
      .map((entry) => mapEntry(entry, campaign));
    return Object.freeze({
      campaignId: campaignId(requireString(row['campaign_id'], 'budget.campaignId')),
      gameDay: safeInteger(row['game_day'], 'budget.gameDay'),
      gameTimeMinutes: safeInteger(row['game_time_minutes'], 'budget.gameTimeMinutes'),
      activeQuestCount: this.activeQuestCount(campaign),
      limits: DIRECTOR_BUDGET_LIMITS,
      usage: Object.freeze({
        dailyEvents: safeInteger(row['daily_events_used'], 'budget.dailyEvents'),
        urgentEvents: safeInteger(row['urgent_events_used'], 'budget.urgentEvents'),
        npcProactive: safeInteger(row['npc_proactive_used'], 'budget.npcProactive'),
        backgroundChanges: safeInteger(row['background_changes_used'], 'budget.backgroundChanges'),
      }),
      revision: positiveInteger(row['revision'], 'budget.revision'),
      entries: Object.freeze(entries),
      updatedAt: isoTimestamp(requireString(row['updated_at'], 'budget.updatedAt')),
    });
  }
}

function mapEntry(value: unknown, campaign: CampaignId): PendingEntry {
  const row = requireRecord(value, 'Director Budget entry');
  return Object.freeze({
    campaignId: campaign,
    runId: requireString(row['run_id'], 'entry.runId'),
    ordinal: positiveInteger(row['ordinal'], 'entry.ordinal'),
    actionId: requireString(row['action_id'], 'entry.actionId'),
    kind: requireEnum(
      WORLD_DIRECTOR_ACTION_KINDS,
      row['kind'],
      'entry.kind',
    ) as WorldDirectorActionKind,
    urgency: requireEnum(
      WORLD_DIRECTOR_URGENCIES,
      row['urgency'],
      'entry.urgency',
    ) as WorldDirectorUrgency,
    cooldownKey: requireString(row['cooldown_key'], 'entry.cooldownKey'),
    category: requireEnum(
      DIRECTOR_BUDGET_CATEGORIES,
      row['category'],
      'entry.category',
    ) as DirectorBudgetCategory,
    status: requireEnum(
      DIRECTOR_BUDGET_STATUSES,
      row['status'],
      'entry.status',
    ) as DirectorBudgetStatus,
    requestedGameTime: safeInteger(row['requested_game_time'], 'entry.requestedGameTime'),
    eligibleGameTime: safeInteger(row['eligible_game_time'], 'entry.eligibleGameTime'),
    approvedGameTime:
      row['approved_game_time'] === null
        ? null
        : safeInteger(row['approved_game_time'], 'entry.approvedGameTime'),
    reason: requireEnum(
      DIRECTOR_BUDGET_REASONS,
      row['reason'],
      'entry.reason',
    ) as DirectorBudgetReason,
  });
}
function consume(category: DirectorBudgetCategory, usage: MutableUsage): void {
  if (category === 'DAILY_EVENT') usage.dailyEvents += 1;
  if (category === 'URGENT_EVENT') {
    usage.dailyEvents += 1;
    usage.urgentEvents += 1;
  }
  if (category === 'NPC_PROACTIVE') usage.npcProactive += 1;
  if (category === 'BACKGROUND_CHANGE') usage.backgroundChanges += 1;
}
function safeInteger(value: unknown, label: string): number {
  const result = requireNumber(value, label);
  if (!Number.isSafeInteger(result) || result < 0)
    throw new PersistenceDataError(`${label} is invalid`);
  return result;
}
function positiveInteger(value: unknown, label: string): number {
  const result = safeInteger(value, label);
  if (result < 1) throw new PersistenceDataError(`${label} must be positive`);
  return result;
}
function requireIdentity(value: string, label: string): void {
  if (value.trim() !== value || value.length < 1 || value.length > 200)
    throw new PersistenceDataError(`${label} is invalid`);
}

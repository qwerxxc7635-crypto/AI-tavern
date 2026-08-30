import { createHash } from 'node:crypto';

import {
  WORLD_DIRECTOR_ACTION_KINDS,
  WORLD_DIRECTOR_PACES,
  WORLD_DIRECTOR_ROUTES,
  WORLD_DIRECTOR_SUPPRESSION_REASONS,
  WORLD_DIRECTOR_TRIGGER_KINDS,
  WORLD_DIRECTOR_URGENCIES,
  campaignId,
  isoTimestamp,
  type CampaignId,
  type IsoTimestamp,
  type JsonValue,
  type WorldDirectorPreparation,
  type WorldDirectorProposal,
  type WorldDirectorRun,
  type WorldDirectorSuppression,
  type WorldDirectorTrigger,
} from '@ember-tavern/contracts';
import { evaluateWorldDirector, type EvaluateWorldDirectorInput } from '@ember-tavern/domain';

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

export interface CommitWorldDirectorRun {
  readonly id: string;
  readonly campaignId: CampaignId;
  readonly trigger: WorldDirectorTrigger;
  readonly expectedContextDigest: string;
  readonly occurredAt: IsoTimestamp;
}

export class WorldDirectorRepository {
  private readonly database: TransactionalSqliteDatabase;

  public constructor(database: TransactionalSqliteDatabase) {
    this.database = database;
  }

  public prepare(campaign: CampaignId): WorldDirectorPreparation {
    return prepare(this.database, campaign);
  }

  public commit(command: CommitWorldDirectorRun): WorldDirectorRun {
    validateCommand(command);
    return this.transaction(() => {
      const replay = this.database
        .prepare(
          `SELECT id FROM world_director_runs
           WHERE campaign_id=? AND trigger_kind=? AND trigger_id=?`,
        )
        .get(command.campaignId, command.trigger.kind, command.trigger.id);
      if (replay !== undefined) {
        const stored = this.get(
          requireString(requireRecord(replay, 'Director replay')['id'], 'id'),
        );
        if (
          stored === null ||
          stored.id !== command.id ||
          stored.contextDigest !== command.expectedContextDigest ||
          stored.createdAt !== command.occurredAt
        ) {
          throw new PersistenceDataError('World Director trigger was reused with other input');
        }
        return stored;
      }
      const prepared = prepare(this.database, command.campaignId);
      if (prepared.contextDigest !== command.expectedContextDigest) {
        throw new PersistenceDataError('World Director context changed before commit');
      }
      this.database
        .prepare(
          `INSERT INTO world_director_runs(
             id,campaign_id,trigger_kind,trigger_id,context_digest,pace,pressure_score,
             signals_json,suppressed_json,source_snapshot_json,created_at
           ) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          command.id,
          command.campaignId,
          command.trigger.kind,
          command.trigger.id,
          prepared.contextDigest,
          prepared.pace,
          prepared.pressureScore,
          JSON.stringify(prepared.signals),
          JSON.stringify(prepared.suppressed),
          JSON.stringify(prepared.sourceSnapshot),
          command.occurredAt,
        );
      const insert = this.database.prepare(
        `INSERT INTO world_director_proposals(
           run_id,campaign_id,ordinal,action_id,kind,actor_entity_id,target_entity_ids_json,
           rationale,proposed_effects_json,urgency,cooldown_key,route
         ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      );
      for (const proposal of prepared.proposals) {
        insert.run(
          command.id,
          command.campaignId,
          proposal.rank,
          proposal.id,
          proposal.kind,
          proposal.actorEntityId,
          JSON.stringify(proposal.targetEntityIds),
          proposal.rationale,
          JSON.stringify(proposal.proposedEffects),
          proposal.urgency,
          proposal.cooldownKey,
          proposal.route,
        );
      }
      const saved = this.get(command.id);
      if (saved === null) throw new PersistenceDataError('World Director run is missing');
      return saved;
    });
  }

  public get(id: string): WorldDirectorRun | null {
    canonical(id, 'World Director run ID', 200);
    const row = this.database.prepare('SELECT * FROM world_director_runs WHERE id=?').get(id);
    return row === undefined ? null : mapRun(this.database, row);
  }

  public history(campaign: CampaignId, limit = 20): readonly WorldDirectorRun[] {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new PersistenceDataError('World Director history limit is invalid');
    }
    return Object.freeze(
      this.database
        .prepare(
          `SELECT * FROM world_director_runs
           WHERE campaign_id=? ORDER BY created_at DESC,id DESC LIMIT ?`,
        )
        .all(campaign, limit)
        .map((row) => mapRun(this.database, row)),
    );
  }

  private transaction(run: () => WorldDirectorRun): WorldDirectorRun {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const value = run();
      this.database.exec('COMMIT');
      return value;
    } catch (error) {
      try {
        this.database.exec('ROLLBACK');
      } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], 'World Director rollback failed', {
          cause: rollbackError,
        });
      }
      throw error;
    }
  }
}

function prepare(
  database: TransactionalSqliteDatabase,
  campaign: CampaignId,
): WorldDirectorPreparation {
  const source = loadSource(database, campaign);
  const evaluation = evaluateWorldDirector(source.input);
  const sourceSnapshot = freezeJson(source.snapshot);
  return Object.freeze({
    campaignId: campaign,
    campaignState: source.input.campaignState,
    contextDigest: digest(sourceSnapshot),
    ...evaluation,
    sourceSnapshot,
  });
}

function loadSource(
  database: TransactionalSqliteDatabase,
  campaign: CampaignId,
): { readonly input: EvaluateWorldDirectorInput; readonly snapshot: JsonValue } {
  const campaignRow = requireRecord(
    database.prepare('SELECT state FROM campaigns WHERE id=?').get(campaign),
    'World Director campaign is missing',
  );
  const campaignState = requireString(campaignRow['state'], 'campaign.state');
  const constitution = requireRecord(
    database
      .prepare(
        `SELECT revision FROM world_constitutions
         WHERE campaign_id=? AND status='LOCKED'`,
      )
      .get(campaign),
    'World Director locked Constitution is missing',
  );
  const tavern = requireRecord(
    database.prepare('SELECT location_id FROM taverns WHERE campaign_id=?').get(campaign),
    'World Director current location is missing',
  );
  const locationState = database
    .prepare('SELECT current_location_id FROM campaign_location_states WHERE campaign_id=?')
    .get(campaign);
  const currentLocationId =
    locationState === undefined
      ? requireString(tavern['location_id'], 'tavern.location_id')
      : requireString(
          requireRecord(locationState, 'location state')['current_location_id'],
          'location.current',
        );
  const quests = database
    .prepare(
      `SELECT pool.quest_id AS id,pool.status,pool.created_at,pool.updated_at,
              (SELECT COUNT(*) FROM game_events event
               WHERE event.campaign_id=pool.campaign_id
                 AND event.type='WORLD_CLOCK_ADVANCED'
                 AND event.occurred_at>pool.created_at) AS world_clock_advances
       FROM quest_pool_states pool WHERE pool.campaign_id=? ORDER BY pool.quest_id`,
    )
    .all(campaign)
    .map((value) => {
      const row = requireRecord(value, 'Director Quest');
      return Object.freeze({
        id: requireString(row['id'], 'quest.id'),
        status: requireString(row['status'], 'quest.status'),
        createdAt: requireString(row['created_at'], 'quest.createdAt'),
        updatedAt: requireString(row['updated_at'], 'quest.updatedAt'),
        worldClockAdvancesSinceCreation: nonNegativeInteger(
          row['world_clock_advances'],
          'quest.worldClockAdvancesSinceCreation',
        ),
      });
    });
  const clocks = database
    .prepare('SELECT id,current,max FROM world_clocks WHERE campaign_id=? ORDER BY id')
    .all(campaign)
    .map((value) => {
      const row = requireRecord(value, 'Director Clock');
      return Object.freeze({
        id: requireString(row['id'], 'clock.id'),
        current: integer(row['current'], 'clock.current'),
        max: integer(row['max'], 'clock.max'),
      });
    });
  const factions = database
    .prepare(
      `SELECT id,materialization,
              json_extract(profile_json,'$.playerRelation') AS player_relation,
              json_extract(profile_json,'$.currentAction') AS current_action
       FROM active_factions WHERE campaign_id=? ORDER BY id`,
    )
    .all(campaign)
    .map((value) => {
      const row = requireRecord(value, 'Director Faction');
      return Object.freeze({
        id: requireString(row['id'], 'faction.id'),
        materialization: requireString(row['materialization'], 'faction.materialization'),
        playerRelation: requireString(row['player_relation'], 'faction.playerRelation'),
        currentAction:
          row['current_action'] === null
            ? null
            : requireString(row['current_action'], 'faction.currentAction'),
      });
    });
  const recentTransitions = [
    ...database
      .prepare(
        `SELECT to_status,occurred_at FROM quest_pool_transitions
         WHERE campaign_id=? ORDER BY occurred_at DESC,operation_id DESC LIMIT 20`,
      )
      .all(campaign),
  ]
    .reverse()
    .map((value) => {
      const row = requireRecord(value, 'Director transition');
      return Object.freeze({
        toStatus: requireString(row['to_status'], 'transition.toStatus'),
        occurredAt: requireString(row['occurred_at'], 'transition.occurredAt'),
      });
    });
  const recentEvents = [
    ...database
      .prepare(
        `SELECT id,type,occurred_at FROM game_events
         WHERE campaign_id=? ORDER BY occurred_at DESC,id DESC LIMIT 20`,
      )
      .all(campaign),
  ]
    .reverse()
    .map((value) => {
      const row = requireRecord(value, 'Director event');
      return Object.freeze({
        id: requireString(row['id'], 'event.id'),
        type: requireString(row['type'], 'event.type'),
        occurredAt: requireString(row['occurred_at'], 'event.occurredAt'),
      });
    });
  const input: EvaluateWorldDirectorInput = Object.freeze({
    campaignId: campaign,
    campaignState,
    currentLocationId,
    quests: Object.freeze(quests),
    clocks: Object.freeze(clocks),
    factions: Object.freeze(factions),
    recentTransitions: Object.freeze(recentTransitions),
    recentEvents: Object.freeze(recentEvents),
  });
  return Object.freeze({
    input,
    snapshot: freezeJson({
      schemaVersion: 1,
      constitutionRevision: positiveInteger(constitution['revision'], 'constitution.revision'),
      ...input,
    }),
  });
}

function mapRun(database: TransactionalSqliteDatabase, value: unknown): WorldDirectorRun {
  const row = requireRecord(value, 'World Director run');
  const id = requireString(row['id'], 'run.id');
  const campaign = campaignId(requireString(row['campaign_id'], 'run.campaignId'));
  const proposals = database
    .prepare(
      `SELECT * FROM world_director_proposals
       WHERE run_id=? AND campaign_id=? ORDER BY ordinal`,
    )
    .all(id, campaign)
    .map(mapProposal);
  const suppressed = requireArray(
    parseJson(row['suppressed_json'], 'run.suppressed'),
    'run.suppressed',
  ).map(mapSuppression);
  const signals = requireRecord(parseJson(row['signals_json'], 'run.signals'), 'run.signals');
  const sourceSnapshot = freezeJson(parseJson(row['source_snapshot_json'], 'run.sourceSnapshot'));
  return Object.freeze({
    id,
    campaignId: campaign,
    campaignState: requireString(
      requireRecord(sourceSnapshot, 'run.sourceSnapshot')['campaignState'],
      'run.campaignState',
    ),
    trigger: Object.freeze({
      kind: requireEnum(WORLD_DIRECTOR_TRIGGER_KINDS, row['trigger_kind'], 'run.triggerKind'),
      id: requireString(row['trigger_id'], 'run.triggerId'),
    }),
    contextDigest: requireDigest(row['context_digest']),
    pace: requireEnum(WORLD_DIRECTOR_PACES, row['pace'], 'run.pace'),
    pressureScore: nonNegativeInteger(row['pressure_score'], 'run.pressureScore'),
    signals: Object.freeze({
      openQuestCount: nonNegativeInteger(signals['openQuestCount'], 'signals.openQuestCount'),
      activeQuestCount: nonNegativeInteger(signals['activeQuestCount'], 'signals.activeQuestCount'),
      blockedQuestCount: nonNegativeInteger(
        signals['blockedQuestCount'],
        'signals.blockedQuestCount',
      ),
      staleQuestIds: Object.freeze(requireStringArray(signals['staleQuestIds'], 'staleQuestIds')),
      urgentClockIds: Object.freeze(
        requireStringArray(signals['urgentClockIds'], 'urgentClockIds'),
      ),
      foreshadowClockIds: Object.freeze(
        requireStringArray(signals['foreshadowClockIds'], 'foreshadowClockIds'),
      ),
      hostileFactionIds: Object.freeze(
        requireStringArray(signals['hostileFactionIds'], 'hostileFactionIds'),
      ),
      recentFailureCount: nonNegativeInteger(
        signals['recentFailureCount'],
        'signals.recentFailureCount',
      ),
      recentEventCount: nonNegativeInteger(signals['recentEventCount'], 'signals.recentEventCount'),
    }),
    proposals: Object.freeze(proposals),
    suppressed: Object.freeze(suppressed),
    sourceSnapshot,
    createdAt: isoTimestamp(requireString(row['created_at'], 'run.createdAt')),
  });
}

function mapProposal(value: unknown): WorldDirectorProposal {
  const row = requireRecord(value, 'World Director proposal');
  return Object.freeze({
    id: requireString(row['action_id'], 'proposal.id'),
    rank: positiveInteger(row['ordinal'], 'proposal.rank'),
    kind: requireEnum(WORLD_DIRECTOR_ACTION_KINDS, row['kind'], 'proposal.kind'),
    actorEntityId:
      row['actor_entity_id'] === null
        ? null
        : requireString(row['actor_entity_id'], 'proposal.actorEntityId'),
    targetEntityIds: Object.freeze(
      requireStringArray(
        parseJson(row['target_entity_ids_json'], 'proposal.targets'),
        'proposal.targets',
      ),
    ),
    rationale: requireString(row['rationale'], 'proposal.rationale'),
    proposedEffects: Object.freeze(
      requireStringArray(
        parseJson(row['proposed_effects_json'], 'proposal.effects'),
        'proposal.effects',
      ),
    ),
    urgency: requireEnum(WORLD_DIRECTOR_URGENCIES, row['urgency'], 'proposal.urgency'),
    cooldownKey: requireString(row['cooldown_key'], 'proposal.cooldownKey'),
    route: requireEnum(WORLD_DIRECTOR_ROUTES, row['route'], 'proposal.route'),
  });
}

function mapSuppression(value: unknown): WorldDirectorSuppression {
  const row = requireRecord(value, 'World Director suppression');
  return Object.freeze({
    kind: requireEnum(WORLD_DIRECTOR_ACTION_KINDS, row['kind'], 'suppression.kind'),
    targetEntityId:
      row['targetEntityId'] === null
        ? null
        : requireString(row['targetEntityId'], 'suppression.targetEntityId'),
    reason: requireEnum(WORLD_DIRECTOR_SUPPRESSION_REASONS, row['reason'], 'suppression.reason'),
    rationale: requireString(row['rationale'], 'suppression.rationale'),
  });
}

function validateCommand(command: CommitWorldDirectorRun): void {
  canonical(command.id, 'World Director run ID', 200);
  canonical(command.trigger.id, 'World Director trigger ID', 200);
  if (!WORLD_DIRECTOR_TRIGGER_KINDS.includes(command.trigger.kind)) {
    throw new PersistenceDataError('World Director trigger kind is invalid');
  }
  requireDigest(command.expectedContextDigest);
  isoTimestamp(command.occurredAt);
}

function digest(value: JsonValue): string {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

function stableJson(value: JsonValue): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  return `{${Object.entries(value)
    .sort(([left], [right]) => compareText(left, right))
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
  throw new PersistenceDataError('World Director snapshot contains unsupported data');
}

function requireArray(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new PersistenceDataError(`${label} is invalid`);
  return value;
}

function requireDigest(value: unknown): string {
  const parsed = requireString(value, 'contextDigest');
  if (!/^[0-9a-f]{64}$/.test(parsed)) {
    throw new PersistenceDataError('World Director context digest is invalid');
  }
  return parsed;
}

function canonical(value: string, label: string, max: number): void {
  if (value.length === 0 || [...value].length > max || value.trim() !== value) {
    throw new PersistenceDataError(`${label} is invalid`);
  }
}

function compareText(left: string, right: string): number {
  const leftPoints = [...left];
  const rightPoints = [...right];
  const length = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < length; index += 1) {
    const leftPoint = leftPoints[index]?.codePointAt(0) ?? 0;
    const rightPoint = rightPoints[index]?.codePointAt(0) ?? 0;
    if (leftPoint !== rightPoint) return leftPoint < rightPoint ? -1 : 1;
  }
  return leftPoints.length - rightPoints.length;
}

function integer(value: unknown, label: string): number {
  const parsed = requireNumber(value, label);
  if (!Number.isSafeInteger(parsed)) throw new PersistenceDataError(`${label} is invalid`);
  return parsed;
}

function positiveInteger(value: unknown, label: string): number {
  const parsed = integer(value, label);
  if (parsed < 1) throw new PersistenceDataError(`${label} is invalid`);
  return parsed;
}

function nonNegativeInteger(value: unknown, label: string): number {
  const parsed = integer(value, label);
  if (parsed < 0) throw new PersistenceDataError(`${label} is invalid`);
  return parsed;
}

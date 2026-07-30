import {
  transitionCampaign,
  type AdventureEnding,
  type CampaignId,
  type GameEvent,
  type IdempotencyKey,
  type IsoTimestamp,
  type Item,
  type NpcProfile,
  type NpcRelationship,
  type PlayerCharacterId,
  type Quest,
  type TavernChange,
  type WorldFact,
} from '@ember-tavern/contracts';
import type { WorldClockAdvanceResult } from '@ember-tavern/domain';

import { CampaignRepository, PersistenceDataError } from './campaign-repository.js';
import { ItemRepository, WorldClockRepository } from './conversation-item-clock-repository.js';
import { GameEventRepository } from './game-event-repository.js';
import { requireRecord, requireString } from './persistence-validation.js';
import { AdventureRepository, QuestRepository } from './quest-adventure-repository.js';
import { NpcRepository, TavernRepository } from './tavern-npc-repository.js';
import type { TransactionalSqliteDatabase } from './sqlite-port.js';
import { WorldRepository } from './world-repository.js';

export interface SettlementNpcUpdate {
  readonly profile: NpcProfile;
  readonly before: NpcRelationship;
  readonly after: NpcRelationship;
}

export interface AdventureSettlementCommit {
  readonly campaignId: CampaignId;
  readonly playerCharacterId: PlayerCharacterId;
  readonly summaryIdempotencyKey: IdempotencyKey;
  readonly worldEventIdempotencyKey: IdempotencyKey;
  readonly quest: Quest;
  readonly ending: AdventureEnding;
  readonly npcUpdates: readonly SettlementNpcUpdate[];
  readonly tavernChange: TavernChange;
  readonly rewardItem: Item | null;
  readonly worldFacts: readonly WorldFact[];
  readonly clockAdvances: readonly WorldClockAdvanceResult[];
  readonly events: readonly GameEvent[];
  readonly committedAt: IsoTimestamp;
}

export type SettlementCommitResult = 'COMMITTED' | 'ALREADY_COMMITTED';

export class AdventureSettlementRepository {
  public constructor(private readonly database: TransactionalSqliteDatabase) {}

  public commitOnce(command: AdventureSettlementCommit): SettlementCommitResult {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const summary = this.pending(command.summaryIdempotencyKey, command.campaignId);
      const worldEvent = this.pending(command.worldEventIdempotencyKey, command.campaignId);
      if (summary.status === 'COMMITTED' || worldEvent.status === 'COMMITTED') {
        if (
          summary.status !== 'COMMITTED' ||
          worldEvent.status !== 'COMMITTED' ||
          new AdventureRepository(this.database).getEnding(command.ending.adventureId) === null
        ) {
          throw new PersistenceDataError('Settlement requests have inconsistent commit state');
        }
        this.database.exec('COMMIT');
        return 'ALREADY_COMMITTED';
      }
      if (
        summary.status !== 'VALIDATING' ||
        summary.task !== 'SUMMARIZE_ADVENTURE' ||
        worldEvent.status !== 'VALIDATING' ||
        worldEvent.task !== 'GENERATE_WORLD_EVENT'
      ) {
        throw new PersistenceDataError('Settlement AI requests are not ready to commit');
      }

      this.validateCurrentState(command);
      const npcs = new NpcRepository(this.database);
      for (const update of command.npcUpdates) {
        npcs.update(update.profile);
        npcs.saveRelationship(update.after, command.committedAt);
      }
      new TavernRepository(this.database).appendChange(command.tavernChange);

      if (command.rewardItem !== null) {
        const items = new ItemRepository(this.database);
        items.create(command.rewardItem);
        items.assign(command.rewardItem.id, command.playerCharacterId, command.ending.adventureId);
      }
      const worlds = new WorldRepository(this.database);
      for (const fact of command.worldFacts) worlds.addFact(fact);
      const clocks = new WorldClockRepository(this.database);
      for (const advance of command.clockAdvances) {
        clocks.update(advance.clock, command.committedAt);
      }

      new QuestRepository(this.database).update(command.quest);
      new AdventureRepository(this.database).saveEnding(command.ending);
      const campaigns = new CampaignRepository(this.database);
      const campaign = campaigns.get(command.campaignId);
      if (campaign === null) throw new PersistenceDataError('Settlement campaign not found');
      const settling = transitionCampaign(campaign, 'SETTLEMENT', command.committedAt);
      campaigns.update(settling);
      campaigns.update(transitionCampaign(settling, 'TAVERN', command.committedAt));

      const eventRepository = new GameEventRepository(this.database);
      for (const event of command.events) eventRepository.append(event);
      this.markCommitted(summary.id, command.committedAt);
      this.markCommitted(worldEvent.id, command.committedAt);
      this.database.exec('COMMIT');
      return 'COMMITTED';
    } catch (error) {
      try {
        this.database.exec('ROLLBACK');
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          'Adventure settlement and rollback both failed',
          { cause: rollbackError },
        );
      }
      throw error;
    }
  }

  private validateCurrentState(command: AdventureSettlementCommit): void {
    const campaign = new CampaignRepository(this.database).get(command.campaignId);
    const adventures = new AdventureRepository(this.database);
    const adventure = adventures.get(command.ending.adventureId);
    const quest = new QuestRepository(this.database).get(command.quest.id);
    const tavern = new TavernRepository(this.database).get(command.tavernChange.tavernId);
    const character = this.database
      .prepare('SELECT campaign_id FROM player_characters WHERE id = ?')
      .get(command.playerCharacterId);
    if (
      campaign?.state !== 'ADVENTURE' ||
      adventure?.state !== 'ENDING' ||
      adventure.campaignId !== command.campaignId ||
      adventure.questId !== command.quest.id ||
      quest?.status !== 'ACTIVE' ||
      command.quest.campaignId !== command.campaignId ||
      !['COMPLETED', 'FAILED'].includes(command.quest.status) ||
      tavern?.campaignId !== command.campaignId ||
      command.tavernChange.sourceAdventureId !== adventure.id ||
      campaignOf(character) !== command.campaignId ||
      command.worldFacts.some(({ campaignId }) => campaignId !== command.campaignId) ||
      command.clockAdvances.some(({ clock }) => clock.campaignId !== command.campaignId) ||
      (command.rewardItem !== null && command.rewardItem.campaignId !== command.campaignId) ||
      command.npcUpdates.some(
        ({ profile, before, after }) =>
          profile.campaignId !== command.campaignId ||
          before.npcId !== profile.id ||
          after.npcId !== profile.id ||
          before.playerCharacterId !== command.playerCharacterId ||
          after.playerCharacterId !== command.playerCharacterId,
      )
    ) {
      throw new PersistenceDataError('Settlement records do not match current campaign state');
    }
    const completion = command.events.find(
      (event) =>
        event.type === 'ADVENTURE_COMPLETED' &&
        event.payload.adventureId === adventure.id &&
        event.payload.questId === quest.id,
    );
    if (
      completion?.type !== 'ADVENTURE_COMPLETED' ||
      JSON.stringify(completion.payload.ending) !== JSON.stringify(command.ending) ||
      command.events.some(({ campaignId }) => campaignId !== command.campaignId)
    ) {
      throw new PersistenceDataError('Settlement completion event is missing or inconsistent');
    }
  }

  private pending(key: IdempotencyKey, campaignId: CampaignId) {
    const value = this.database
      .prepare(
        `SELECT id, campaign_id, task, status
         FROM pending_ai_requests
         WHERE idempotency_key = ?`,
      )
      .get(key);
    if (value === undefined) throw new PersistenceDataError('Settlement AI request not found');
    const row = requireRecord(value, 'Settlement pending request');
    const campaign = requireString(row['campaign_id'], 'campaign_id');
    if (campaign !== campaignId) {
      throw new PersistenceDataError('Settlement AI request belongs to another campaign');
    }
    return {
      id: requireString(row['id'], 'id'),
      task: requireString(row['task'], 'task'),
      status: requireString(row['status'], 'status'),
    };
  }

  private markCommitted(id: string, at: IsoTimestamp): void {
    const result = this.database
      .prepare(
        `UPDATE pending_ai_requests
         SET status = 'COMMITTED', last_error_json = NULL, updated_at = ?
         WHERE id = ? AND status = 'VALIDATING'`,
      )
      .run(at, id);
    if (Number(result.changes) !== 1) {
      throw new PersistenceDataError('Settlement AI request changed during commit');
    }
  }
}

function campaignOf(value: unknown): string | null {
  if (value === undefined) return null;
  return requireString(
    requireRecord(value, 'Character campaign row')['campaign_id'],
    'campaign_id',
  );
}

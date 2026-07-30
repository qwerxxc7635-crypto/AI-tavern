import type {
  Adventure,
  AdventureTurn,
  CampaignId,
  GameEvent,
  IsoTimestamp,
  NpcRelationship,
  Quest,
  WorldFact,
} from '@ember-tavern/contracts';

import { PersistenceDataError } from './campaign-repository.js';
import { GameEventRepository } from './game-event-repository.js';
import { requireRecord, requireString } from './persistence-validation.js';
import { AdventureRepository, QuestRepository } from './quest-adventure-repository.js';
import { NpcRepository } from './tavern-npc-repository.js';
import type { TransactionalSqliteDatabase } from './sqlite-port.js';
import { WorldRepository } from './world-repository.js';

export type TurnStatePatch =
  | { readonly kind: 'QUEST'; readonly quest: Quest }
  | {
      readonly kind: 'NPC_RELATIONSHIP';
      readonly relationship: NpcRelationship;
      readonly updatedAt: IsoTimestamp;
    }
  | { readonly kind: 'WORLD_FACT'; readonly fact: WorldFact };

export interface TurnCommit {
  readonly campaignId: CampaignId;
  readonly adventure: Adventure;
  readonly turn: AdventureTurn;
  readonly statePatches: readonly TurnStatePatch[];
  readonly events: readonly GameEvent[];
}

export class TurnTransaction {
  public constructor(private readonly database: TransactionalSqliteDatabase) {}

  public commit(command: TurnCommit): void {
    validateCommand(command);
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const adventures = new AdventureRepository(this.database);
      adventures.update(command.adventure);
      adventures.addTurn(command.turn);

      const quests = new QuestRepository(this.database);
      const npcs = new NpcRepository(this.database);
      const worlds = new WorldRepository(this.database);
      for (const patch of command.statePatches) {
        switch (patch.kind) {
          case 'QUEST':
            quests.update(patch.quest);
            break;
          case 'NPC_RELATIONSHIP':
            requireRelationshipCampaign(this.database, patch.relationship, command.campaignId);
            npcs.saveRelationship(patch.relationship, patch.updatedAt);
            break;
          case 'WORLD_FACT':
            worlds.addFact(patch.fact);
            break;
        }
      }

      const events = new GameEventRepository(this.database);
      for (const event of command.events) events.append(event);
      this.database.exec('COMMIT');
    } catch (error) {
      try {
        this.database.exec('ROLLBACK');
      } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], 'Turn commit and rollback both failed', {
          cause: rollbackError,
        });
      }
      throw error;
    }
  }
}

function validateCommand(command: TurnCommit): void {
  if (command.adventure.campaignId !== command.campaignId) {
    throw new PersistenceDataError('Adventure belongs to another campaign');
  }
  if (command.turn.adventureId !== command.adventure.id) {
    throw new PersistenceDataError('Turn belongs to another adventure');
  }
  if (command.turn.turnNumber !== command.adventure.currentTurnNumber) {
    throw new PersistenceDataError('Adventure current turn number must match committed turn');
  }
  if (command.turn.playerAction === null || command.turn.resolvedAt === null) {
    throw new PersistenceDataError('Only complete turns with player input can be committed');
  }
  if (command.turn.sceneText.trim().length === 0) {
    throw new PersistenceDataError('Committed AI scene output cannot be empty');
  }
  if (command.events.length === 0) {
    throw new PersistenceDataError('A turn commit must append at least one GameEvent');
  }
  const actionEvent = command.events.find(
    (event) =>
      event.type === 'PLAYER_ACTION_SUBMITTED' &&
      event.payload.adventureId === command.adventure.id &&
      event.payload.turnId === command.turn.id,
  );
  if (
    actionEvent?.type !== 'PLAYER_ACTION_SUBMITTED' ||
    JSON.stringify(actionEvent.payload.action) !== JSON.stringify(command.turn.playerAction)
  ) {
    throw new PersistenceDataError('Player action event must match the committed turn input');
  }
  for (const event of command.events) {
    if (event.campaignId !== command.campaignId) {
      throw new PersistenceDataError('GameEvent belongs to another campaign');
    }
  }
  for (const patch of command.statePatches) {
    if (
      (patch.kind === 'QUEST' && patch.quest.campaignId !== command.campaignId) ||
      (patch.kind === 'WORLD_FACT' && patch.fact.campaignId !== command.campaignId)
    ) {
      throw new PersistenceDataError('State patch belongs to another campaign');
    }
  }
}

function requireRelationshipCampaign(
  database: TransactionalSqliteDatabase,
  relationship: NpcRelationship,
  campaign: CampaignId,
): void {
  const npc = database.prepare('SELECT campaign_id FROM npcs WHERE id = ?').get(relationship.npcId);
  const character = database
    .prepare('SELECT campaign_id FROM player_characters WHERE id = ?')
    .get(relationship.playerCharacterId);
  if (
    campaignOf(npc, 'NPC') !== campaign ||
    campaignOf(character, 'PlayerCharacter') !== campaign
  ) {
    throw new PersistenceDataError('NPC relationship patch belongs to another campaign');
  }
}

function campaignOf(value: unknown, label: string): string | null {
  if (value === undefined) return null;
  return requireString(requireRecord(value, `${label} campaign row`)['campaign_id'], 'campaign_id');
}

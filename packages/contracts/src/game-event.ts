import type { AdventureEnding, DiceResult, PlayerAction } from './adventure.js';
import type {
  AdventureId,
  CampaignId,
  GameEventId,
  IsoTimestamp,
  ItemId,
  NpcId,
  PlayerCharacterId,
  QuestId,
  SchemaVersion,
  TavernId,
  TurnId,
  WorldClockId,
  WorldFactId,
} from './foundation.js';
import type { NpcRelationship } from './tavern.js';

export const GAME_EVENT_TYPES = [
  'WORLD_CREATED',
  'CHARACTER_CREATED',
  'NPC_CREATED',
  'QUEST_ACCEPTED',
  'PLAYER_ACTION_SUBMITTED',
  'DICE_ROLLED',
  'FACT_DISCOVERED',
  'ITEM_ACQUIRED',
  'RELATIONSHIP_CHANGED',
  'WORLD_CLOCK_ADVANCED',
  'ADVENTURE_COMPLETED',
  'MODEL_SWITCHED',
] as const;

export type GameEventType = (typeof GAME_EVENT_TYPES)[number];

export interface ModelSelectionRef {
  readonly providerKey: string;
  readonly modelName: string;
}

export interface GameEventPayloads {
  readonly WORLD_CREATED: {
    readonly worldName: string;
  };
  readonly CHARACTER_CREATED: {
    readonly playerCharacterId: PlayerCharacterId;
  };
  readonly NPC_CREATED: {
    readonly npcId: NpcId;
    readonly tavernId: TavernId;
  };
  readonly QUEST_ACCEPTED: {
    readonly questId: QuestId;
  };
  readonly PLAYER_ACTION_SUBMITTED: {
    readonly adventureId: AdventureId;
    readonly turnId: TurnId;
    readonly action: PlayerAction;
  };
  readonly DICE_ROLLED: {
    readonly adventureId: AdventureId;
    readonly turnId: TurnId;
    readonly result: DiceResult;
  };
  readonly FACT_DISCOVERED: {
    readonly worldFactId: WorldFactId;
    readonly playerCharacterId: PlayerCharacterId;
  };
  readonly ITEM_ACQUIRED: {
    readonly itemId: ItemId;
    readonly playerCharacterId: PlayerCharacterId;
    readonly sourceAdventureId: AdventureId | null;
  };
  readonly RELATIONSHIP_CHANGED: {
    readonly before: NpcRelationship;
    readonly after: NpcRelationship;
  };
  readonly WORLD_CLOCK_ADVANCED: {
    readonly worldClockId: WorldClockId;
    readonly previous: number;
    readonly current: number;
    readonly triggeredStageThresholds: readonly number[];
  };
  readonly ADVENTURE_COMPLETED: {
    readonly adventureId: AdventureId;
    readonly questId: QuestId;
    readonly ending: AdventureEnding;
  };
  readonly MODEL_SWITCHED: {
    readonly previous: ModelSelectionRef | null;
    readonly current: ModelSelectionRef;
  };
}

export interface GameEventOf<Type extends GameEventType> {
  readonly id: GameEventId;
  readonly campaignId: CampaignId;
  readonly schemaVersion: SchemaVersion;
  readonly type: Type;
  readonly payload: GameEventPayloads[Type];
  readonly occurredAt: IsoTimestamp;
}

export type GameEvent = {
  readonly [Type in GameEventType]: GameEventOf<Type>;
}[GameEventType];

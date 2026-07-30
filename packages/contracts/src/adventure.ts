import type { CharacterAttributeName } from './character.js';
import type {
  ActionOptionId,
  AdventureId,
  CampaignId,
  CheckRequestId,
  ClueId,
  IsoTimestamp,
  ItemId,
  NpcId,
  QuestId,
  TurnId,
} from './foundation.js';
import type { QuestRisk } from './quest.js';

export interface AdventurePlan {
  readonly adventureId: AdventureId;
  readonly objective: string;
  readonly risk: QuestRisk;
  readonly expectedTurns: Readonly<{ min: number; max: number }>;
  readonly coreScenes: readonly string[];
  readonly necessaryClueIds: readonly ClueId[];
  readonly majorObstacles: readonly string[];
  readonly possibleEndings: readonly string[];
  readonly failureCost: string;
}

export const ADVENTURE_STATES = [
  'PREPARING',
  'SCENE',
  'WAITING_FOR_PLAYER',
  'CHECK_REQUIRED',
  'RESOLVING',
  'ENDING',
  'SETTLED',
] as const;
export type AdventureState = (typeof ADVENTURE_STATES)[number];

export const ADVENTURE_TRANSITIONS: Readonly<Record<AdventureState, readonly AdventureState[]>> = {
  PREPARING: ['SCENE'],
  SCENE: ['WAITING_FOR_PLAYER', 'ENDING'],
  WAITING_FOR_PLAYER: ['CHECK_REQUIRED', 'RESOLVING'],
  CHECK_REQUIRED: ['RESOLVING'],
  RESOLVING: ['SCENE', 'ENDING'],
  ENDING: ['SETTLED'],
  SETTLED: [],
};

export class AdventureTransitionError extends Error {
  public constructor(current: AdventureState, next: AdventureState) {
    super(`Illegal adventure transition: ${current} -> ${next}`);
    this.name = 'AdventureTransitionError';
  }
}

export function transitionAdventureState(
  current: AdventureState,
  next: AdventureState,
): AdventureState {
  if (!ADVENTURE_TRANSITIONS[current].includes(next)) {
    throw new AdventureTransitionError(current, next);
  }
  return next;
}

export interface Adventure {
  readonly id: AdventureId;
  readonly campaignId: CampaignId;
  readonly questId: QuestId;
  readonly state: AdventureState;
  readonly plan: AdventurePlan;
  readonly currentTurnNumber: number;
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
}

export type PlayerAction =
  | { readonly kind: 'SUGGESTED'; readonly optionId: ActionOptionId; readonly text: string }
  | { readonly kind: 'FREEFORM'; readonly text: string }
  | { readonly kind: 'USE_ITEM'; readonly itemId: ItemId; readonly intent: string }
  | { readonly kind: 'EXIT_ADVENTURE'; readonly reason: string };

export type CheckDifficulty = 8 | 11 | 14 | 17;

export interface CheckRequest {
  readonly id: CheckRequestId;
  readonly turnId: TurnId;
  readonly attribute: CharacterAttributeName;
  readonly difficulty: CheckDifficulty;
  readonly reason: string;
}

export interface DiceResult {
  readonly checkRequestId: CheckRequestId;
  readonly d20: number;
  readonly attributeModifier: number;
  readonly equipmentModifier: number;
  readonly statusModifier: number;
  readonly total: number;
  readonly difficulty: CheckDifficulty;
  readonly success: boolean;
}

export interface AdventureTurn {
  readonly id: TurnId;
  readonly adventureId: AdventureId;
  readonly turnNumber: number;
  readonly sceneText: string;
  readonly speakerNpcIds: readonly NpcId[];
  readonly suggestedActions: readonly Extract<PlayerAction, { kind: 'SUGGESTED' }>[];
  readonly playerAction: PlayerAction | null;
  readonly checkRequest: CheckRequest | null;
  readonly diceResult: DiceResult | null;
  readonly createdAt: IsoTimestamp;
  readonly resolvedAt: IsoTimestamp | null;
}

export interface Clue {
  readonly id: ClueId;
  readonly adventureId: AdventureId;
  readonly title: string;
  readonly description: string;
  readonly isCore: boolean;
  readonly discoveredInTurnId: TurnId | null;
}

export type AdventureOutcome = 'SUCCESS' | 'PARTIAL_SUCCESS' | 'FAILURE';

export interface AdventureEnding {
  readonly adventureId: AdventureId;
  readonly outcome: AdventureOutcome;
  readonly summary: string;
  readonly unresolvedClueIds: readonly ClueId[];
  readonly completedAt: IsoTimestamp;
}

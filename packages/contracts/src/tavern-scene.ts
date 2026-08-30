import type { IsoTimestamp } from './foundation.js';

export const TAVERN_SCENE_ACTIONS = [
  'SPEAK',
  'INTERRUPT',
  'SILENCE',
  'EAVESDROP',
  'LEAVE',
  'INTERVENE',
] as const;
export type TavernSceneAction = (typeof TAVERN_SCENE_ACTIONS)[number];

export const TAVERN_SCENE_PARTICIPANT_STATUSES = ['ACTIVE', 'LISTENING', 'LEFT'] as const;
export type TavernSceneParticipantStatus = (typeof TAVERN_SCENE_PARTICIPANT_STATUSES)[number];

export interface TavernSceneParticipant {
  readonly npcId: string;
  readonly name: string;
  readonly populationRole: string;
  readonly status: TavernSceneParticipantStatus;
  readonly joinedAt: IsoTimestamp;
  readonly leftAt: IsoTimestamp | null;
}

export interface TavernSceneActorProposal {
  readonly actorId: string;
  readonly action: TavernSceneAction;
  readonly targetNpcId: string | null;
  readonly utterance: string | null;
  readonly citedKnowledgeIds: readonly string[];
  readonly urgency: 0 | 1 | 2 | 3;
  readonly rationale: string;
}

export interface TavernSceneResolvedAction extends TavernSceneActorProposal {
  readonly selected: boolean;
}

export interface TavernSceneTurn {
  readonly id: string;
  readonly operationId: string;
  readonly sceneId: string;
  readonly sequence: number;
  readonly beforeRevision: number;
  readonly afterRevision: number;
  readonly playerIntent: string;
  readonly addressedNpcId: string | null;
  readonly actions: readonly TavernSceneResolvedAction[];
  readonly occurredAt: IsoTimestamp;
}

export interface TavernSceneSnapshot {
  readonly id: string;
  readonly campaignId: string;
  readonly tavernId: string;
  readonly revision: number;
  readonly status: 'ACTIVE' | 'CLOSED';
  readonly participants: readonly TavernSceneParticipant[];
  readonly turns: readonly TavernSceneTurn[];
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
}

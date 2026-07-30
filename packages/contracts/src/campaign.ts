import type { CampaignId, IsoTimestamp, SchemaVersion } from './foundation.js';

export const CAMPAIGN_ACTIVE_STATES = [
  'CREATING_WORLD',
  'REVIEWING_WORLD',
  'CREATING_CHARACTER',
  'GENERATING_TAVERN',
  'TAVERN',
  'ADVENTURE',
  'SETTLEMENT',
] as const;

export const CAMPAIGN_EXCEPTION_STATES = [
  'GENERATION_FAILED',
  'WAITING_FOR_MODEL',
  'RECOVERY_REQUIRED',
] as const;

export type CampaignActiveState = (typeof CAMPAIGN_ACTIVE_STATES)[number];
export type CampaignExceptionState = (typeof CAMPAIGN_EXCEPTION_STATES)[number];
export type CampaignState = CampaignActiveState | CampaignExceptionState | 'ARCHIVED';

export interface Campaign {
  readonly id: CampaignId;
  readonly schemaVersion: SchemaVersion;
  readonly state: CampaignState;
  readonly resumeState: CampaignActiveState | null;
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
}

export interface CreateCampaignInput {
  readonly id: CampaignId;
  readonly schemaVersion: SchemaVersion;
  readonly now: IsoTimestamp;
}

export const CAMPAIGN_NORMAL_TRANSITIONS: Readonly<
  Record<CampaignActiveState, readonly CampaignActiveState[]>
> = {
  CREATING_WORLD: ['REVIEWING_WORLD'],
  REVIEWING_WORLD: ['CREATING_WORLD', 'CREATING_CHARACTER'],
  CREATING_CHARACTER: ['GENERATING_TAVERN'],
  GENERATING_TAVERN: ['TAVERN'],
  TAVERN: ['ADVENTURE'],
  ADVENTURE: ['SETTLEMENT'],
  SETTLEMENT: ['TAVERN'],
};

export class CampaignTransitionError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'CampaignTransitionError';
  }
}

export function createCampaign(input: CreateCampaignInput): Campaign {
  return {
    id: input.id,
    schemaVersion: input.schemaVersion,
    state: 'CREATING_WORLD',
    resumeState: null,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

export function isCampaignActiveState(state: CampaignState): state is CampaignActiveState {
  return (CAMPAIGN_ACTIVE_STATES as readonly CampaignState[]).includes(state);
}

export function isCampaignExceptionState(state: CampaignState): state is CampaignExceptionState {
  return (CAMPAIGN_EXCEPTION_STATES as readonly CampaignState[]).includes(state);
}

export function transitionCampaign(
  campaign: Campaign,
  nextState: CampaignState,
  at: IsoTimestamp,
): Campaign {
  assertTransitionTime(campaign, at);

  if (campaign.state === nextState) {
    throw new CampaignTransitionError(`Campaign is already in state ${nextState}`);
  }

  if (campaign.state === 'ARCHIVED') {
    throw new CampaignTransitionError('An archived campaign cannot transition');
  }

  if (nextState === 'ARCHIVED') {
    return withState(campaign, nextState, null, at);
  }

  if (isCampaignActiveState(campaign.state)) {
    if (isCampaignExceptionState(nextState)) {
      return withState(campaign, nextState, campaign.state, at);
    }

    if (
      isCampaignActiveState(nextState) &&
      CAMPAIGN_NORMAL_TRANSITIONS[campaign.state].includes(nextState)
    ) {
      return withState(campaign, nextState, null, at);
    }

    throw illegalTransition(campaign.state, nextState);
  }

  if (isCampaignExceptionState(nextState)) {
    return withState(campaign, nextState, requireResumeState(campaign), at);
  }

  if (nextState === requireResumeState(campaign)) {
    return withState(campaign, nextState, null, at);
  }

  throw illegalTransition(campaign.state, nextState);
}

function requireResumeState(campaign: Campaign): CampaignActiveState {
  if (campaign.resumeState === null) {
    throw new CampaignTransitionError(`Exception state ${campaign.state} requires a resume state`);
  }
  return campaign.resumeState;
}

function assertTransitionTime(campaign: Campaign, at: IsoTimestamp): void {
  if (at < campaign.updatedAt) {
    throw new CampaignTransitionError('Campaign transition time cannot move backwards');
  }
}

function withState(
  campaign: Campaign,
  state: CampaignState,
  resumeState: CampaignActiveState | null,
  updatedAt: IsoTimestamp,
): Campaign {
  return { ...campaign, state, resumeState, updatedAt };
}

function illegalTransition(current: CampaignState, next: CampaignState): CampaignTransitionError {
  return new CampaignTransitionError(`Illegal campaign transition: ${current} -> ${next}`);
}

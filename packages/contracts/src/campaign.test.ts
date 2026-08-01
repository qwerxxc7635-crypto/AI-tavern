import { describe, expect, it } from 'vitest';

import {
  CAMPAIGN_ACTIVE_STATES,
  CAMPAIGN_EXCEPTION_STATES,
  CampaignTransitionError,
  campaignId,
  createCampaign,
  isCampaignActiveState,
  isCampaignExceptionState,
  isoTimestamp,
  schemaVersion,
  transitionCampaign,
  type Campaign,
  type CampaignState,
} from './index.js';

const times = [
  '2026-07-30T10:00:00.000Z',
  '2026-07-30T10:01:00.000Z',
  '2026-07-30T10:02:00.000Z',
  '2026-07-30T10:03:00.000Z',
  '2026-07-30T10:04:00.000Z',
  '2026-07-30T10:05:00.000Z',
  '2026-07-30T10:06:00.000Z',
  '2026-07-30T10:07:00.000Z',
  '2026-07-30T10:08:00.000Z',
] as const;

function freshCampaign(): Campaign {
  return createCampaign({
    id: campaignId('campaign-1'),
    schemaVersion: schemaVersion(1),
    now: isoTimestamp(times[0]),
  });
}

function advance(campaign: Campaign, state: CampaignState, timeIndex: number): Campaign {
  const value = times[timeIndex];
  if (value === undefined) throw new RangeError(`Missing test timestamp at index ${timeIndex}`);
  return transitionCampaign(campaign, state, isoTimestamp(value));
}

describe('campaign state machine', () => {
  it('creates a campaign in the first lifecycle state', () => {
    expect(freshCampaign()).toMatchObject({
      state: 'CREATING_WORLD',
      resumeState: null,
      createdAt: times[0],
      updatedAt: times[0],
    });
  });

  it('runs the complete normal lifecycle and returns to the tavern', () => {
    const states: CampaignState[] = [
      'REVIEWING_WORLD',
      'CREATING_CHARACTER',
      'GENERATING_TAVERN',
      'TAVERN',
      'ADVENTURE',
      'SETTLEMENT',
      'TAVERN',
    ];

    const completed = states.reduce(
      (campaign, state, index) => advance(campaign, state, index + 1),
      freshCampaign(),
    );

    expect(completed.state).toBe('TAVERN');
    expect(completed.updatedAt).toBe(times[7]);
  });

  it('allows world regeneration while reviewing', () => {
    const reviewing = advance(freshCampaign(), 'REVIEWING_WORLD', 1);
    expect(advance(reviewing, 'CREATING_WORLD', 2).state).toBe('CREATING_WORLD');
  });

  it('suspends and resumes only the interrupted active state', () => {
    const reviewing = advance(freshCampaign(), 'REVIEWING_WORLD', 1);
    const waiting = advance(reviewing, 'WAITING_FOR_MODEL', 2);
    const failed = advance(waiting, 'GENERATION_FAILED', 3);

    expect(waiting.resumeState).toBe('REVIEWING_WORLD');
    expect(failed.resumeState).toBe('REVIEWING_WORLD');
    expect(advance(failed, 'REVIEWING_WORLD', 4)).toMatchObject({
      state: 'REVIEWING_WORLD',
      resumeState: null,
    });
    expect(() => advance(failed, 'TAVERN', 4)).toThrow(CampaignTransitionError);
  });

  it.each(CAMPAIGN_EXCEPTION_STATES)(
    'classifies, enters and resumes exception state %s without losing the active state',
    (exceptionState) => {
      const reviewing = advance(freshCampaign(), 'REVIEWING_WORLD', 1);
      const suspended = advance(reviewing, exceptionState, 2);

      expect(isCampaignExceptionState(suspended.state)).toBe(true);
      expect(isCampaignActiveState(suspended.state)).toBe(false);
      expect(suspended.resumeState).toBe('REVIEWING_WORLD');
      expect(advance(suspended, 'REVIEWING_WORLD', 3)).toMatchObject({
        state: 'REVIEWING_WORLD',
        resumeState: null,
      });
    },
  );

  it('classifies every declared state without overlap', () => {
    for (const state of CAMPAIGN_ACTIVE_STATES) {
      expect(isCampaignActiveState(state)).toBe(true);
      expect(isCampaignExceptionState(state)).toBe(false);
    }
    for (const state of CAMPAIGN_EXCEPTION_STATES) {
      expect(isCampaignActiveState(state)).toBe(false);
      expect(isCampaignExceptionState(state)).toBe(true);
    }
    expect(isCampaignActiveState('ARCHIVED')).toBe(false);
    expect(isCampaignExceptionState('ARCHIVED')).toBe(false);
  });

  it('allows any non-archived campaign to be archived and makes archive terminal', () => {
    const archived = advance(freshCampaign(), 'ARCHIVED', 1);
    expect(archived).toMatchObject({ state: 'ARCHIVED', resumeState: null });
    expect(() => advance(archived, 'CREATING_WORLD', 2)).toThrow(CampaignTransitionError);
  });

  it('archives an exception state without retaining a stale resume state', () => {
    const waiting = advance(freshCampaign(), 'WAITING_FOR_MODEL', 1);
    expect(advance(waiting, 'ARCHIVED', 2)).toMatchObject({
      state: 'ARCHIVED',
      resumeState: null,
    });
  });

  it.each([
    ['CREATING_WORLD', 'CREATING_CHARACTER'],
    ['REVIEWING_WORLD', 'TAVERN'],
    ['TAVERN', 'SETTLEMENT'],
  ] as const)('rejects illegal transition %s -> %s', (current, next) => {
    let campaign = freshCampaign();
    if (current === 'REVIEWING_WORLD') campaign = advance(campaign, current, 1);
    if (current === 'TAVERN') {
      campaign = advance(campaign, 'REVIEWING_WORLD', 1);
      campaign = advance(campaign, 'CREATING_CHARACTER', 2);
      campaign = advance(campaign, 'GENERATING_TAVERN', 3);
      campaign = advance(campaign, 'TAVERN', 4);
    }
    expect(() => transitionCampaign(campaign, next, isoTimestamp(times[8]))).toThrow(
      CampaignTransitionError,
    );
  });

  it('rejects repeated states and backwards timestamps', () => {
    const campaign = freshCampaign();
    expect(() => advance(campaign, 'CREATING_WORLD', 1)).toThrow(CampaignTransitionError);
    const reviewing = advance(campaign, 'REVIEWING_WORLD', 2);
    expect(() =>
      transitionCampaign(reviewing, 'CREATING_CHARACTER', isoTimestamp(times[1])),
    ).toThrow(CampaignTransitionError);
  });

  it('rejects a forged exception state without a recovery target', () => {
    const invalid: Campaign = {
      ...freshCampaign(),
      state: 'RECOVERY_REQUIRED',
      resumeState: null,
    };

    expect(() => advance(invalid, 'GENERATION_FAILED', 1)).toThrow(/requires a resume state/u);
  });

  it('allows an atomic transition at the same canonical timestamp', () => {
    const campaign = freshCampaign();
    const reviewing = transitionCampaign(campaign, 'REVIEWING_WORLD', campaign.updatedAt);
    expect(reviewing.updatedAt).toBe(campaign.updatedAt);
  });

  it('does not mutate the original campaign', () => {
    const original = freshCampaign();
    const next = advance(original, 'REVIEWING_WORLD', 1);
    expect(original.state).toBe('CREATING_WORLD');
    expect(next).not.toBe(original);
  });
});

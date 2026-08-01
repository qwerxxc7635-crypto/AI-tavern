import { invoke } from '@tauri-apps/api/core';

import { parseCampaignSummary, type CampaignSummary } from './campaign-gateway.js';

export interface CampaignRecoverySnapshot {
  readonly campaign: CampaignSummary;
  readonly resumeState: Exclude<
    CampaignSummary['state'],
    'GENERATION_FAILED' | 'WAITING_FOR_MODEL' | 'RECOVERY_REQUIRED'
  >;
  readonly unfinishedRequestCount: number;
}

export interface RecoveryGateway {
  inspect(id: string): Promise<CampaignRecoverySnapshot>;
  restore(id: string): Promise<CampaignSummary>;
}

export const tauriRecoveryGateway: RecoveryGateway = {
  async inspect(id) {
    return parseRecoverySnapshot(await invoke<unknown>('campaign_recovery_get', { id }));
  },
  async restore(id) {
    return parseCampaignSummary(await invoke<unknown>('campaign_recovery_restore', { id }));
  },
};

export function parseRecoverySnapshot(value: unknown): CampaignRecoverySnapshot {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('Recovery response must be an object');
  }
  const record = value as Record<string, unknown>;
  const campaign = parseCampaignSummary(record['campaign']);
  const resumeState = record['resumeState'];
  if (
    typeof resumeState !== 'string' ||
    ![
      'CREATING_WORLD',
      'REVIEWING_WORLD',
      'CREATING_CHARACTER',
      'GENERATING_TAVERN',
      'TAVERN',
      'ADVENTURE',
      'SETTLEMENT',
    ].includes(resumeState)
  ) {
    throw new TypeError('Recovery resume state is invalid');
  }
  const unfinishedRequestCount = record['unfinishedRequestCount'];
  if (!Number.isSafeInteger(unfinishedRequestCount) || (unfinishedRequestCount as number) < 0) {
    throw new TypeError('Recovery request count is invalid');
  }
  return Object.freeze({
    campaign,
    resumeState: resumeState as CampaignRecoverySnapshot['resumeState'],
    unfinishedRequestCount: unfinishedRequestCount as number,
  });
}

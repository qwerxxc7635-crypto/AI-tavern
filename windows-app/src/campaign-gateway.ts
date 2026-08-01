import { invoke } from '@tauri-apps/api/core';

const CAMPAIGN_STATES = [
  'CREATING_WORLD',
  'REVIEWING_WORLD',
  'CREATING_CHARACTER',
  'GENERATING_TAVERN',
  'TAVERN',
  'ADVENTURE',
  'SETTLEMENT',
  'GENERATION_FAILED',
  'WAITING_FOR_MODEL',
  'RECOVERY_REQUIRED',
] as const;

export type ActiveCampaignState = (typeof CAMPAIGN_STATES)[number];

export interface CampaignSummary {
  readonly id: string;
  readonly state: ActiveCampaignState;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CampaignGateway {
  list(): Promise<readonly CampaignSummary[]>;
  create(): Promise<CampaignSummary>;
  continueCampaign(id: string): Promise<CampaignSummary>;
  archive(id: string): Promise<void>;
  deleteCampaign(id: string): Promise<void>;
}

export const tauriCampaignGateway: CampaignGateway = {
  async list() {
    return parseCampaignList(await invoke<unknown>('campaign_list'));
  },
  async create() {
    return parseCampaignSummary(await invoke<unknown>('campaign_create'));
  },
  async continueCampaign(id) {
    return parseCampaignSummary(await invoke<unknown>('campaign_continue', { id }));
  },
  async archive(id) {
    await invoke('campaign_archive', { id });
  },
  async deleteCampaign(id) {
    await invoke('campaign_delete', { id });
  },
};

function parseCampaignList(value: unknown): readonly CampaignSummary[] {
  if (!Array.isArray(value)) throw new TypeError('Campaign list response must be an array');
  return Object.freeze(value.map(parseCampaignSummary));
}

export function parseCampaignSummary(value: unknown): CampaignSummary {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError('Campaign response must be an object');
  }
  const record = value as Record<string, unknown>;
  const id = requireCanonicalText(record['id']);
  const state = requireCampaignState(record['state']);
  const createdAt = requireTimestamp(record['createdAt']);
  const updatedAt = requireTimestamp(record['updatedAt']);
  if (updatedAt < createdAt) throw new TypeError('Campaign timestamps are out of order');
  return Object.freeze({ id, state, createdAt, updatedAt });
}

function requireCanonicalText(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) {
    throw new TypeError('Campaign identifier is invalid');
  }
  return value;
}

function requireCampaignState(value: unknown): ActiveCampaignState {
  if (typeof value !== 'string' || !(CAMPAIGN_STATES as readonly string[]).includes(value)) {
    throw new TypeError('Campaign state is invalid');
  }
  return value as ActiveCampaignState;
}

function requireTimestamp(value: unknown): string {
  if (typeof value !== 'string') throw new TypeError('Campaign timestamp is invalid');
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new TypeError('Campaign timestamp is invalid');
  }
  return value;
}

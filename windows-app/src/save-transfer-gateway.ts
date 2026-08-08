import { invoke } from '@tauri-apps/api/core';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { open, save } from '@tauri-apps/plugin-dialog';

import type { CampaignSummary } from './campaign-gateway.js';
import { playerText } from './localization/index.js';

export type CampaignArchiveImportMode = 'CREATE' | 'OVERWRITE';

export interface CampaignArchiveInspection {
  readonly campaignId: string;
  readonly campaignExists: boolean;
}

export interface ImportedCampaignSummary {
  readonly id: string;
  readonly state: CampaignSummary['state'] | 'ARCHIVED';
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SaveTransferGateway {
  chooseImportPath(): Promise<string | null>;
  chooseExportPath(suggestedName: string): Promise<string | null>;
  inspect(path: string): Promise<CampaignArchiveInspection>;
  importArchive(path: string, mode: CampaignArchiveImportMode): Promise<ImportedCampaignSummary>;
  exportArchive(campaignId: string, path: string): Promise<void>;
  subscribeToArchiveDrops(handler: (paths: readonly string[]) => void): Promise<() => void>;
}

const ARCHIVE_FILTER = Object.freeze({
  name: playerText.archiveDialog.filterName,
  extensions: ['emtavern'],
});

export const tauriSaveTransferGateway: SaveTransferGateway = {
  async chooseImportPath() {
    return open({
      title: playerText.archiveDialog.importTitle,
      filters: [ARCHIVE_FILTER],
      multiple: false,
      directory: false,
    });
  },
  async chooseExportPath(suggestedName) {
    return save({
      title: playerText.archiveDialog.exportTitle,
      filters: [ARCHIVE_FILTER],
      defaultPath: suggestedName,
    });
  },
  async inspect(path) {
    return parseInspection(await invoke<unknown>('save_archive_inspect', { path }));
  },
  async importArchive(path, mode) {
    return parseCampaign(await invoke<unknown>('save_archive_import', { path, mode }));
  },
  async exportArchive(campaignId, path) {
    await invoke('save_archive_export', { id: campaignId, path });
  },
  async subscribeToArchiveDrops(handler) {
    return getCurrentWebview().onDragDropEvent((event) => {
      if (event.payload.type === 'drop') handler(event.payload.paths);
    });
  },
};

function parseInspection(value: unknown): CampaignArchiveInspection {
  const record = requireRecord(value, 'Archive inspection');
  const campaignId = requireCanonicalText(record['campaignId'], 'Archive campaign identifier');
  if (typeof record['campaignExists'] !== 'boolean') {
    throw new TypeError('Archive campaign existence flag is invalid');
  }
  return Object.freeze({ campaignId, campaignExists: record['campaignExists'] });
}

function parseCampaign(value: unknown): ImportedCampaignSummary {
  const record = requireRecord(value, 'Imported campaign');
  const id = requireCanonicalText(record['id'], 'Imported campaign identifier');
  const state = record['state'];
  const createdAt = requireTimestamp(record['createdAt']);
  const updatedAt = requireTimestamp(record['updatedAt']);
  const allowedStates = [
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
    'ARCHIVED',
  ] as const;
  if (typeof state !== 'string' || !(allowedStates as readonly string[]).includes(state)) {
    throw new TypeError('Imported campaign state is invalid');
  }
  if (updatedAt < createdAt) throw new TypeError('Imported campaign timestamps are invalid');
  return Object.freeze({
    id,
    state: state as ImportedCampaignSummary['state'],
    createdAt,
    updatedAt,
  });
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireCanonicalText(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function requireTimestamp(value: unknown): string {
  if (typeof value !== 'string') throw new TypeError('Imported campaign timestamp is invalid');
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new TypeError('Imported campaign timestamp is invalid');
  }
  return value;
}

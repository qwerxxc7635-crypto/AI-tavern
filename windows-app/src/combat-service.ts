import { invoke } from '@tauri-apps/api/core';

import type {
  CombatCommandEnvelope,
  CombatCommandPayload,
  CombatVersionSet,
} from '@ember-tavern/contracts';

import type { CombatScreenShellViewModel } from './combat-screen.js';

export type CombatWorld = 'CULTIVATION' | 'FANTASY' | 'SCI_FI' | 'URBAN';

export interface CombatSessionSnapshot {
  readonly campaignId: string;
  readonly world: CombatWorld;
  readonly persistenceRevision: number;
  readonly viewModel: CombatScreenShellViewModel;
}

export interface CombatSessionGateway {
  start(campaignId: string, world: CombatWorld): Promise<CombatSessionSnapshot>;
  submit(
    campaignId: string,
    world: CombatWorld,
    command: CombatCommandEnvelope,
  ): Promise<CombatSessionSnapshot>;
  complete(campaignId: string, world: CombatWorld): Promise<void>;
}

export const tauriCombatSessionGateway: CombatSessionGateway = {
  async start(campaignId, world) {
    return parseCombatSessionSnapshot(
      await invoke<unknown>('combat_session_start', { campaignId, world }),
      campaignId,
      world,
    );
  },
  async submit(campaignId, world, command) {
    return parseCombatSessionSnapshot(
      await invoke<unknown>('combat_session_submit', { campaignId, world, command }),
      campaignId,
      world,
    );
  },
  async complete(campaignId, world) {
    const value = await invoke<unknown>('combat_session_complete', { campaignId, world });
    if (!isRecord(value) || typeof value['resultCommitId'] !== 'string') {
      throw new TypeError('Combat completion response is invalid');
    }
  },
};

export function createCombatCommand(
  snapshot: CombatSessionSnapshot,
  payload: CombatCommandPayload,
): CombatCommandEnvelope {
  return {
    commandId: crypto.randomUUID(),
    source: { kind: 'PLAYER', controllerId: 'local-player' },
    actorId: snapshot.viewModel.activeCombatantId ?? 'hero',
    versions: snapshot.viewModel.versions,
    payload,
  };
}

export function parseCombatWorld(value: string | null): CombatWorld | null {
  return value === 'CULTIVATION' || value === 'FANTASY' || value === 'SCI_FI' || value === 'URBAN'
    ? value
    : null;
}

export function parseCombatSessionSnapshot(
  value: unknown,
  expectedCampaignId: string,
  expectedWorld: CombatWorld,
): CombatSessionSnapshot {
  if (!isRecord(value)) throw new TypeError('Combat session response is invalid');
  const viewModel = value['viewModel'];
  if (
    value['campaignId'] !== expectedCampaignId ||
    value['world'] !== expectedWorld ||
    !Number.isSafeInteger(value['persistenceRevision']) ||
    Number(value['persistenceRevision']) < 1 ||
    !isCombatViewModel(viewModel)
  ) {
    throw new TypeError('Combat session response is invalid');
  }
  return value as unknown as CombatSessionSnapshot;
}

function isCombatViewModel(value: unknown): value is CombatScreenShellViewModel {
  if (!isRecord(value)) return false;
  return (
    typeof value['combatInstanceId'] === 'string' &&
    Number.isSafeInteger(value['stateRevision']) &&
    isVersionSet(value['versions']) &&
    typeof value['phaseLabelZhCn'] === 'string' &&
    typeof value['roundLabelZhCn'] === 'string' &&
    (value['activeCombatantId'] === null || typeof value['activeCombatantId'] === 'string') &&
    Array.isArray(value['timeline']) &&
    Array.isArray(value['combatants']) &&
    Array.isArray(value['enemyIntents']) &&
    Array.isArray(value['actions']) &&
    Array.isArray(value['reactionModes']) &&
    Array.isArray(value['tacticalSettings']) &&
    Array.isArray(value['combatLog']) &&
    (value['pendingReaction'] === null || isRecord(value['pendingReaction'])) &&
    (value['result'] === null || isRecord(value['result']))
  );
}

function isVersionSet(value: unknown): value is CombatVersionSet {
  if (!isRecord(value)) return false;
  return [
    'combatSchemaVersion',
    'rulesetVersion',
    'balanceVersion',
    'engineVersion',
    'worldProfileVersion',
    'attributeMappingVersion',
    'rngContractVersion',
  ].every((key) => Number.isSafeInteger(value[key]) && Number(value[key]) > 0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

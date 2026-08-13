import { campaignId, npcId, questId } from '@ember-tavern/contracts';

import type { CampaignSummary } from './campaign-gateway.js';

export const APP_PATHS = Object.freeze({
  saves: '/saves',
  recovery: '/recovery',
  world: '/world',
  characterCreation: '/character/create',
  tavern: '/tavern',
  npc: '/npc',
  quests: '/quests',
  adventure: '/adventure',
  character: '/character',
  archives: '/archives',
  my: '/my',
  settings: '/settings',
});

export type RouteContextKey = 'campaignId' | 'npcId' | 'questId';

export interface RouteContext {
  readonly campaignId?: string;
  readonly npcId?: string;
  readonly questId?: string;
}

export type RouteContextResult =
  | { readonly ok: true; readonly context: RouteContext }
  | {
      readonly ok: false;
      readonly reason: 'MISSING' | 'DUPLICATE' | 'INVALID';
      readonly key: RouteContextKey;
    };

export function readRouteContext(
  search: URLSearchParams,
  required: readonly RouteContextKey[],
): RouteContextResult {
  const valuesByKey = new Map<RouteContextKey, string>();
  for (const key of ['campaignId', 'npcId', 'questId'] as const) {
    const values = search.getAll(key);
    if (values.length > 1) return { ok: false, reason: 'DUPLICATE', key };
    const value = values[0];
    if (value === undefined) {
      if (required.includes(key)) return { ok: false, reason: 'MISSING', key };
      continue;
    }
    try {
      validateRouteId(key, value);
      valuesByKey.set(key, value);
    } catch {
      return { ok: false, reason: 'INVALID', key };
    }
  }
  const campaign = valuesByKey.get('campaignId');
  const npc = valuesByKey.get('npcId');
  const quest = valuesByKey.get('questId');
  return {
    ok: true,
    context: Object.freeze({
      ...(campaign === undefined ? {} : { campaignId: campaign }),
      ...(npc === undefined ? {} : { npcId: npc }),
      ...(quest === undefined ? {} : { questId: quest }),
    }),
  };
}

export function buildRoute(path: string, context: RouteContext = {}): string {
  const search = new URLSearchParams();
  if (context.campaignId !== undefined) {
    validateRouteId('campaignId', context.campaignId);
    search.set('campaignId', context.campaignId);
  }
  if (context.npcId !== undefined) {
    validateRouteId('npcId', context.npcId);
    search.set('npcId', context.npcId);
  }
  if (context.questId !== undefined) {
    validateRouteId('questId', context.questId);
    search.set('questId', context.questId);
  }
  const suffix = search.toString();
  return suffix.length === 0 ? path : `${path}?${suffix}`;
}

export function campaignRoute(path: string, campaign: string): string {
  return buildRoute(path, { campaignId: campaign });
}

export function campaignParentRoute(search: URLSearchParams, path: string): string {
  const result = readRouteContext(search, ['campaignId']);
  return result.ok && result.context.campaignId !== undefined
    ? campaignRoute(path, result.context.campaignId)
    : APP_PATHS.saves;
}

export function optionalCampaignRoute(search: URLSearchParams, path: string): string {
  const result = readRouteContext(search, []);
  return result.ok && result.context.campaignId !== undefined
    ? campaignRoute(path, result.context.campaignId)
    : path;
}

export function destinationForCampaign(campaign: CampaignSummary): string {
  const path =
    campaign.state === 'GENERATION_FAILED' ||
    campaign.state === 'WAITING_FOR_MODEL' ||
    campaign.state === 'RECOVERY_REQUIRED'
      ? APP_PATHS.recovery
      : campaign.state === 'CREATING_WORLD' || campaign.state === 'REVIEWING_WORLD'
        ? APP_PATHS.world
        : campaign.state === 'CREATING_CHARACTER'
          ? APP_PATHS.characterCreation
          : campaign.state === 'ADVENTURE' || campaign.state === 'SETTLEMENT'
            ? APP_PATHS.adventure
            : APP_PATHS.tavern;
  return campaignRoute(path, campaign.id);
}

function validateRouteId(key: RouteContextKey, value: string): void {
  const hasControlCharacter = [...value].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 31 || codePoint === 127);
  });
  if (value.length > 256 || hasControlCharacter) {
    throw new TypeError('Route identifier is invalid');
  }
  if (key === 'campaignId') campaignId(value);
  else if (key === 'npcId') npcId(value);
  else questId(value);
}

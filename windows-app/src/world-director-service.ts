import { invoke } from '@tauri-apps/api/core';

import {
  WORLD_DIRECTOR_ACTION_KINDS,
  WORLD_DIRECTOR_PACES,
  WORLD_DIRECTOR_ROUTES,
  WORLD_DIRECTOR_SUPPRESSION_REASONS,
  WORLD_DIRECTOR_TRIGGER_KINDS,
  WORLD_DIRECTOR_URGENCIES,
  campaignId,
  isoTimestamp,
  type WorldDirectorPreparation,
  type WorldDirectorRun,
  type WorldDirectorTrigger,
  type WorldDirectorTriggerKind,
} from '@ember-tavern/contracts';

interface WorldDirectorIdentity {
  readonly id: string;
  readonly occurredAt: string;
}

interface WorldDirectorPrepareCommand {
  readonly campaignId: string;
}

export interface WorldDirectorGateway {
  prepare(command: WorldDirectorPrepareCommand): Promise<WorldDirectorPreparation>;
  commit(command: Readonly<Record<string, unknown>>): Promise<WorldDirectorRun>;
  history(campaignIdValue: string, limit: number): Promise<readonly WorldDirectorRun[]>;
}

export const tauriWorldDirectorGateway: WorldDirectorGateway = {
  async prepare(command) {
    return parsePreparation(await invoke<unknown>('world_director_prepare', { command }), command);
  },
  async commit(command) {
    const campaignIdValue = requireText(command['campaignId'], 'Director campaign');
    return parseRun(await invoke<unknown>('world_director_commit', { command }), campaignIdValue);
  },
  async history(campaignIdValue, limit) {
    const value = await invoke<unknown>('world_director_history', {
      campaignId: campaignIdValue,
      limit,
    });
    if (!Array.isArray(value)) throw new TypeError('Director history is invalid');
    return Object.freeze(value.map((entry) => parseRun(entry, campaignIdValue)));
  },
};

export class WorldDirectorService {
  private readonly active = new Map<string, Promise<WorldDirectorRun>>();
  private readonly gateway: WorldDirectorGateway;
  private readonly createIdentity: () => WorldDirectorIdentity;

  public constructor(
    gateway: WorldDirectorGateway = tauriWorldDirectorGateway,
    createIdentity: () => WorldDirectorIdentity = defaultIdentity,
  ) {
    this.gateway = gateway;
    this.createIdentity = createIdentity;
  }

  public schedule(
    campaignIdValue: string,
    triggerKind: WorldDirectorTriggerKind,
    triggerId: string,
  ): Promise<WorldDirectorRun> {
    campaignId(campaignIdValue);
    if (!WORLD_DIRECTOR_TRIGGER_KINDS.includes(triggerKind)) {
      throw new WorldDirectorServiceError('TRIGGER_KIND_INVALID');
    }
    requireBoundedText(triggerId, 'Director trigger', 200);
    const key = `${campaignIdValue}:${triggerKind}:${triggerId}`;
    const existing = this.active.get(key);
    if (existing !== undefined) return existing;
    const operation = this.perform(campaignIdValue, { kind: triggerKind, id: triggerId }).finally(
      () => {
        if (this.active.get(key) === operation) this.active.delete(key);
      },
    );
    this.active.set(key, operation);
    return operation;
  }

  public async history(campaignIdValue: string, limit = 20): Promise<readonly WorldDirectorRun[]> {
    campaignId(campaignIdValue);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new WorldDirectorServiceError('HISTORY_LIMIT_INVALID');
    }
    try {
      return await this.gateway.history(campaignIdValue, limit);
    } catch (error) {
      throw new WorldDirectorServiceError('HISTORY_FAILED', { cause: error });
    }
  }

  private async perform(
    campaignIdValue: string,
    trigger: WorldDirectorTrigger,
  ): Promise<WorldDirectorRun> {
    let prepared: WorldDirectorPreparation;
    try {
      prepared = await this.gateway.prepare({ campaignId: campaignIdValue });
    } catch (error) {
      throw new WorldDirectorServiceError('PREPARE_FAILED', { cause: error });
    }
    const identity = this.createIdentity();
    try {
      return await this.gateway.commit({
        id: requireBoundedText(identity.id, 'Director run', 200),
        campaignId: campaignIdValue,
        trigger,
        expectedContextDigest: prepared.contextDigest,
        occurredAt: isoTimestamp(identity.occurredAt),
      });
    } catch (error) {
      throw new WorldDirectorServiceError('COMMIT_FAILED', { cause: error });
    }
  }
}

export const worldDirectorService = new WorldDirectorService();

export class WorldDirectorServiceError extends Error {
  public constructor(
    public readonly code: string,
    options?: ErrorOptions,
  ) {
    super('World Director operation failed', options);
    this.name = 'WorldDirectorServiceError';
  }
}

function defaultIdentity(): WorldDirectorIdentity {
  return {
    id: `director-run-${crypto.randomUUID()}`,
    occurredAt: new Date().toISOString(),
  };
}

function parsePreparation(
  value: unknown,
  expected: WorldDirectorPrepareCommand,
): WorldDirectorPreparation {
  const record = requireRecord(value, 'Director preparation');
  if (campaignId(requireText(record['campaignId'], 'Director campaign')) !== expected.campaignId) {
    throw new TypeError('Director preparation belongs to another campaign');
  }
  requireEnum(
    ['TAVERN', 'ADVENTURE', 'SETTLEMENT'] as const,
    record['campaignState'],
    'Director campaign state',
  );
  requireDigest(record['contextDigest']);
  requireEnum(WORLD_DIRECTOR_PACES, record['pace'], 'Director pace');
  requireInteger(record['pressureScore'], 'Director pressure', 0, 99);
  parseSignals(record['signals']);
  parseProposals(record['proposals']);
  parseSuppressions(record['suppressed']);
  requireRecord(record['sourceSnapshot'], 'Director source snapshot');
  return value as WorldDirectorPreparation;
}

function parseRun(value: unknown, expectedCampaignId: string): WorldDirectorRun {
  const record = requireRecord(value, 'Director run');
  parsePreparation(record, { campaignId: expectedCampaignId });
  requireBoundedText(record['id'], 'Director run ID', 200);
  const trigger = requireRecord(record['trigger'], 'Director trigger');
  requireEnum(WORLD_DIRECTOR_TRIGGER_KINDS, trigger['kind'], 'Director trigger kind');
  requireBoundedText(trigger['id'], 'Director trigger ID', 200);
  isoTimestamp(requireText(record['createdAt'], 'Director createdAt'));
  return value as WorldDirectorRun;
}

function parseSignals(value: unknown): void {
  const record = requireRecord(value, 'Director signals');
  for (const key of [
    'openQuestCount',
    'activeQuestCount',
    'blockedQuestCount',
    'recentFailureCount',
    'recentEventCount',
  ]) {
    requireInteger(record[key], `Director signal ${key}`, 0, Number.MAX_SAFE_INTEGER);
  }
  for (const key of [
    'staleQuestIds',
    'urgentClockIds',
    'foreshadowClockIds',
    'hostileFactionIds',
  ]) {
    requireStringArray(record[key], `Director signal ${key}`);
  }
}

function parseProposals(value: unknown): void {
  if (!Array.isArray(value) || value.length > 8)
    throw new TypeError('Director proposals are invalid');
  value.forEach((entry, index) => {
    const proposal = requireRecord(entry, 'Director proposal');
    requireText(proposal['id'], 'Director proposal ID');
    if (requireInteger(proposal['rank'], 'Director rank', 1, 8) !== index + 1) {
      throw new TypeError('Director proposal ordering is invalid');
    }
    requireEnum(WORLD_DIRECTOR_ACTION_KINDS, proposal['kind'], 'Director action kind');
    if (proposal['actorEntityId'] !== null)
      requireText(proposal['actorEntityId'], 'Director actor');
    requireStringArray(proposal['targetEntityIds'], 'Director targets');
    requireText(proposal['rationale'], 'Director rationale');
    if (requireStringArray(proposal['proposedEffects'], 'Director effects').length === 0) {
      throw new TypeError('Director effects are invalid');
    }
    requireEnum(WORLD_DIRECTOR_URGENCIES, proposal['urgency'], 'Director urgency');
    requireText(proposal['cooldownKey'], 'Director cooldown key');
    requireEnum(WORLD_DIRECTOR_ROUTES, proposal['route'], 'Director route');
  });
}

function parseSuppressions(value: unknown): void {
  if (!Array.isArray(value)) throw new TypeError('Director suppressions are invalid');
  value.forEach((entry) => {
    const suppression = requireRecord(entry, 'Director suppression');
    requireEnum(WORLD_DIRECTOR_ACTION_KINDS, suppression['kind'], 'Director suppression kind');
    if (suppression['targetEntityId'] !== null) {
      requireText(suppression['targetEntityId'], 'Director suppression target');
    }
    requireEnum(
      WORLD_DIRECTOR_SUPPRESSION_REASONS,
      suppression['reason'],
      'Director suppression reason',
    );
    requireText(suppression['rationale'], 'Director suppression rationale');
  });
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value as Record<string, unknown>;
}

function requireText(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function requireBoundedText(value: unknown, label: string, max: number): string {
  const parsed = requireText(value, label);
  if ([...parsed].length > max) throw new TypeError(`${label} is invalid`);
  return parsed;
}

function requireDigest(value: unknown): string {
  const parsed = requireText(value, 'Director context digest');
  if (!/^[0-9a-f]{64}$/.test(parsed)) throw new TypeError('Director context digest is invalid');
  return parsed;
}

function requireInteger(value: unknown, label: string, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
    throw new TypeError(`${label} is invalid`);
  }
  return value as number;
}

function requireStringArray(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value)) throw new TypeError(`${label} is invalid`);
  value.forEach((entry) => requireText(entry, label));
  return value as readonly string[];
}

function requireEnum<const Values extends readonly string[]>(
  values: Values,
  value: unknown,
  label: string,
): Values[number] {
  if (typeof value !== 'string' || !values.includes(value))
    throw new TypeError(`${label} is invalid`);
  return value;
}

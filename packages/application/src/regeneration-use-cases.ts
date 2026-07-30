import type { ProviderConfig, ProviderType } from '@ember-tavern/ai-core';
import {
  schemaVersion,
  type AdventureTurn,
  type CampaignId,
  type GameEventId,
  type IsoTimestamp,
  type ModelSwitchPolicy,
  type SaveSnapshot,
  type SnapshotId,
} from '@ember-tavern/contracts';
import {
  AdventureRepository,
  CampaignRepository,
  GameEventRepository,
  SnapshotRepository,
  type TransactionalSqliteDatabase,
} from '@ember-tavern/persistence';

import { AIOrchestrationError } from './ai-turn-orchestrator.js';
import {
  turnInputSnapshotReason,
  type AdventureTurnUseCases,
  type ResolveAdventureTurnCommand,
} from './adventure-turn-use-cases.js';

export type RegenerationPolicy =
  { readonly mode: 'FREE_STORY' } | { readonly mode: 'RULES'; readonly maxRegenerations: number };

export interface PreviousModelSelection {
  readonly providerConfigId: string;
  readonly providerType: ProviderType;
  readonly providerKey: string;
  readonly modelName: string;
}

export interface RegenerateAdventureTurnCommand extends ResolveAdventureTurnCommand {
  readonly previous: PreviousModelSelection;
  readonly switchApproved: boolean;
  readonly crossProviderDisclosureAccepted: boolean;
  readonly policy: RegenerationPolicy;
  readonly safetySnapshotId: SnapshotId;
  readonly modelSwitchedEventId: GameEventId;
}

export class RegenerationUseCases {
  private readonly snapshots: SnapshotRepository;
  private readonly campaigns: CampaignRepository;
  private readonly adventures: AdventureRepository;
  private readonly events: GameEventRepository;

  public constructor(
    private readonly database: TransactionalSqliteDatabase,
    private readonly selectedTurns: AdventureTurnUseCases,
    private readonly selectedProvider: ProviderConfig,
    private readonly now: () => IsoTimestamp,
  ) {
    this.snapshots = new SnapshotRepository(database);
    this.campaigns = new CampaignRepository(database);
    this.adventures = new AdventureRepository(database);
    this.events = new GameEventRepository(database);
  }

  public async regenerateCurrentReply(
    command: RegenerateAdventureTurnCommand,
  ): Promise<AdventureTurn> {
    const original = this.requireTurn(command);
    if (original.playerAction === null) {
      throw new AIOrchestrationError('TURN_INPUT_MISSING', 'Adventure turn has no player action');
    }
    this.assertRegenerationAllowance(command);
    const switched = this.selectedProvider.id !== command.previous.providerConfigId;
    if (switched) this.assertSwitchAllowed(command);

    const baseline = this.snapshots.findLatest(
      command.campaignId,
      turnInputSnapshotReason(command.turnId),
    );
    if (baseline === null) {
      throw new AIOrchestrationError(
        'TURN_SNAPSHOT_MISSING',
        'Adventure turn has no pre-generation snapshot',
      );
    }
    const safety = this.snapshots.create({
      id: command.safetySnapshotId,
      campaignId: command.campaignId,
      kind: 'AUTO',
      reason: `BEFORE_REGENERATION:${command.turnId}`,
      schemaVersion: schemaVersion(1),
      createdAt: this.now(),
    });

    try {
      this.snapshots.restore(baseline.id);
      const restored = this.requireTurn(command);
      if (JSON.stringify(restored.playerAction) !== JSON.stringify(original.playerAction)) {
        throw new AIOrchestrationError(
          'TURN_INPUT_CHANGED',
          'Snapshot did not preserve the original player action',
        );
      }
      if (switched) {
        this.events.append({
          id: command.modelSwitchedEventId,
          campaignId: command.campaignId,
          schemaVersion: schemaVersion(1),
          type: 'MODEL_SWITCHED',
          payload: {
            previous: {
              providerKey: command.previous.providerKey,
              modelName: command.previous.modelName,
            },
            current: {
              providerKey: this.selectedProvider.presetKey,
              modelName: command.modelName,
            },
          },
          occurredAt: this.now(),
        });
      }
      return await this.selectedTurns.resolveAdventureTurn(command);
    } catch (error) {
      this.snapshots.restore(safety.id);
      throw error;
    }
  }

  public rollbackLatestSnapshot(campaign: CampaignId): SaveSnapshot {
    const latest = this.snapshots.findLatest(campaign);
    if (latest === null) {
      throw new AIOrchestrationError('SNAPSHOT_NOT_FOUND', 'Campaign has no snapshot to restore');
    }
    return this.snapshots.restore(latest.id);
  }

  private requireTurn(command: RegenerateAdventureTurnCommand): AdventureTurn {
    const adventure = this.adventures.get(command.adventureId);
    const turn = this.adventures.getTurn(command.turnId);
    if (
      adventure === null ||
      adventure.campaignId !== command.campaignId ||
      turn === null ||
      turn.adventureId !== adventure.id
    ) {
      throw new AIOrchestrationError('TURN_NOT_FOUND', 'Campaign adventure turn not found');
    }
    return turn;
  }

  private assertRegenerationAllowance(command: RegenerateAdventureTurnCommand): void {
    if (command.policy.mode === 'FREE_STORY') return;
    if (
      !Number.isSafeInteger(command.policy.maxRegenerations) ||
      command.policy.maxRegenerations < 0
    ) {
      throw new AIOrchestrationError(
        'REGENERATION_POLICY_INVALID',
        'Rules regeneration limit must be a non-negative safe integer',
      );
    }
    const row = this.database
      .prepare(
        `SELECT COUNT(*) AS count
         FROM pending_ai_requests
         WHERE turn_id = ? AND task = 'GENERATE_ADVENTURE_TURN' AND status = 'COMMITTED'`,
      )
      .get(command.turnId);
    const count =
      typeof row === 'object' && row !== null
        ? (row as Record<string, unknown>)['count']
        : undefined;
    if (typeof count !== 'number' && typeof count !== 'bigint') {
      throw new AIOrchestrationError(
        'REGENERATION_COUNT_INVALID',
        'Committed regeneration count could not be read',
      );
    }
    const regenerations = Number(count) - 1;
    if (regenerations >= command.policy.maxRegenerations) {
      throw new AIOrchestrationError(
        'REGENERATION_LIMIT_REACHED',
        'Rules-mode regeneration limit has been reached',
      );
    }
  }

  private assertSwitchAllowed(command: RegenerateAdventureTurnCommand): void {
    const policy = this.campaigns.getModelSwitchPolicy(command.campaignId);
    const crossProvider = command.previous.providerType !== this.selectedProvider.providerType;
    if (crossProvider && !command.crossProviderDisclosureAccepted) {
      throw new AIOrchestrationError(
        'CROSS_PROVIDER_DISCLOSURE_REQUIRED',
        'Cross-provider regeneration requires data-transfer disclosure acceptance',
      );
    }
    if (!isAutomaticSwitchAllowed(policy, crossProvider) && !command.switchApproved) {
      throw new AIOrchestrationError(
        'MODEL_SWITCH_APPROVAL_REQUIRED',
        'Campaign model-switch policy requires player approval',
      );
    }
  }
}

function isAutomaticSwitchAllowed(policy: ModelSwitchPolicy, crossProvider: boolean): boolean {
  if (policy === 'CROSS_PROVIDER') return true;
  return policy === 'SAME_PROVIDER' && !crossProvider;
}

import {
  type Adventure,
  type AdventureId,
  type AiRequestId,
  type CampaignId,
  type IsoTimestamp,
  type PendingAiRequest,
  type SaveSnapshot,
  type TurnId,
} from '@ember-tavern/contracts';
import {
  AdventureRepository,
  CampaignRepository,
  PendingAiRequestRepository,
  SnapshotRepository,
  type DatabaseStartupResult,
  type TransactionalSqliteDatabase,
} from '@ember-tavern/persistence';

import { AIOrchestrationError } from './ai-turn-orchestrator.js';

export type RecoveryAction = 'CONTINUE' | 'RETRY' | 'CHANGE_MODEL' | 'CANCEL';

export interface RecoveryIssue {
  readonly kind: 'INTERRUPTED_AI_REQUEST' | 'FAILED_AI_REQUEST' | 'CRASHED_TURN';
  readonly requestId: AiRequestId | null;
  readonly turnId: TurnId | null;
  readonly actions: readonly RecoveryAction[];
}

export interface CampaignRecoveryState {
  readonly campaignId: CampaignId;
  readonly adventureId: AdventureId | null;
  readonly needsRecovery: boolean;
  readonly issues: readonly RecoveryIssue[];
}

export type AdventureContinueTarget =
  | Readonly<{ kind: 'OPEN_ADVENTURE'; adventureId: AdventureId; turnId: null }>
  | Readonly<{ kind: 'ROLL_CHECK'; adventureId: AdventureId; turnId: TurnId }>;

export type DatabaseRecoveryState =
  | Readonly<{ status: 'READY'; databasePath: string }>
  | Readonly<{
      status: 'RECOVERY_REQUIRED';
      databasePath: string;
      code: string;
      message: string;
      originalPreserved: boolean;
    }>;

const INTERRUPTED_STATUSES = new Set([
  'CREATED',
  'CONTEXT_READY',
  'SENDING',
  'RECEIVED',
  'VALIDATING',
]);

export class RecoveryCenterUseCases {
  private readonly campaigns: CampaignRepository;
  private readonly adventures: AdventureRepository;
  private readonly requests: PendingAiRequestRepository;
  private readonly snapshots: SnapshotRepository;

  public constructor(
    private readonly database: TransactionalSqliteDatabase,
    private readonly now: () => IsoTimestamp,
  ) {
    this.campaigns = new CampaignRepository(database);
    this.adventures = new AdventureRepository(database);
    this.requests = new PendingAiRequestRepository(database);
    this.snapshots = new SnapshotRepository(database);
  }

  public inspectCampaign(campaignId: CampaignId): CampaignRecoveryState {
    const campaign = this.campaigns.get(campaignId);
    if (campaign === null || campaign.state === 'ARCHIVED') {
      throw new AIOrchestrationError('CAMPAIGN_NOT_RECOVERABLE', 'Active campaign is required');
    }
    const adventure = this.currentAdventure(campaignId);
    const completeSnapshot =
      adventure === null
        ? null
        : this.snapshots.findLatestAutoByReasonPrefix(
            campaignId,
            `AFTER_COMPLETE_TURN:${adventure.id}:`,
          );
    const unfinished = this.relevantUnfinishedRequests(campaignId);
    const issues: RecoveryIssue[] = unfinished.map((request) =>
      this.requestIssue(request, completeSnapshot !== null),
    );

    if (adventure !== null) {
      const unresolved = this.adventures
        .listTurns(adventure.id)
        .find((turn) => turn.resolvedAt === null);
      if (
        unresolved !== undefined &&
        !unfinished.some((request) => request.turnId === unresolved.id)
      ) {
        const canContinue =
          adventure.state === 'CHECK_REQUIRED' &&
          unresolved.checkRequest !== null &&
          unresolved.diceResult === null;
        issues.push(
          Object.freeze({
            kind: 'CRASHED_TURN',
            requestId: null,
            turnId: unresolved.id,
            actions: Object.freeze([
              ...(canContinue ? (['CONTINUE'] as const) : []),
              ...(completeSnapshot === null ? [] : (['CANCEL'] as const)),
            ]),
          }),
        );
      }
    }

    return Object.freeze({
      campaignId,
      adventureId: adventure?.id ?? null,
      needsRecovery: issues.length > 0,
      issues: Object.freeze(issues),
    });
  }

  public prepareRetry(campaignId: CampaignId, requestId: AiRequestId): PendingAiRequest {
    const request = this.requests.get(requestId);
    if (
      request === null ||
      request.campaignId !== campaignId ||
      request.turnId === null ||
      request.context === null
    ) {
      throw new AIOrchestrationError(
        'RECOVERY_RETRY_UNAVAILABLE',
        'Interrupted request has no persisted turn context',
      );
    }
    if (request.status === 'FAILED') return request;
    if (!INTERRUPTED_STATUSES.has(request.status)) {
      throw new AIOrchestrationError(
        'RECOVERY_RETRY_UNAVAILABLE',
        'Request is not interrupted or failed',
      );
    }
    return this.requests.fail(
      request.id,
      {
        code: 'APP_INTERRUPTED',
        message: 'The application stopped before the AI request completed',
        retryable: true,
      },
      this.now(),
    );
  }

  public continueAdventure(
    campaignId: CampaignId,
    adventureId: AdventureId,
  ): AdventureContinueTarget {
    const adventure = this.requireAdventure(campaignId, adventureId);
    const unresolved = this.adventures
      .listTurns(adventure.id)
      .find((turn) => turn.resolvedAt === null);
    if (
      unresolved !== undefined &&
      adventure.state === 'CHECK_REQUIRED' &&
      unresolved.checkRequest !== null &&
      unresolved.diceResult === null
    ) {
      return Object.freeze({ kind: 'ROLL_CHECK', adventureId, turnId: unresolved.id });
    }
    if (unresolved === undefined && ['SCENE', 'ENDING'].includes(adventure.state)) {
      return Object.freeze({ kind: 'OPEN_ADVENTURE', adventureId, turnId: null });
    }
    throw new AIOrchestrationError(
      'RECOVERY_CONTINUE_UNAVAILABLE',
      'Adventure requires retry, model change, or cancellation',
    );
  }

  public cancelAndRestoreLatestCompleteTurn(
    campaignId: CampaignId,
    adventureId: AdventureId,
  ): SaveSnapshot {
    this.requireAdventure(campaignId, adventureId);
    const snapshot = this.snapshots.findLatestAutoByReasonPrefix(
      campaignId,
      `AFTER_COMPLETE_TURN:${adventureId}:`,
    );
    if (snapshot === null) {
      throw new AIOrchestrationError(
        'RECOVERY_SNAPSHOT_UNAVAILABLE',
        'Adventure has no complete turn snapshot',
      );
    }

    this.database.exec('BEGIN IMMEDIATE');
    try {
      for (const request of this.relevantUnfinishedRequests(campaignId)) {
        if (request.turnId === null) continue;
        this.requests.cancel(request.id, this.now());
      }
      const restored = this.snapshots.restoreInCurrentTransaction(snapshot.id);
      this.database.exec('COMMIT');
      return restored;
    } catch (error) {
      try {
        this.database.exec('ROLLBACK');
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          'Recovery cancellation and rollback both failed',
          { cause: rollbackError },
        );
      }
      throw error;
    }
  }

  public cancelContentRequest(campaignId: CampaignId, requestId: AiRequestId): PendingAiRequest {
    const request = this.requests.get(requestId);
    if (request === null || request.campaignId !== campaignId || request.turnId !== null) {
      throw new AIOrchestrationError(
        'RECOVERY_CANCEL_UNAVAILABLE',
        'A campaign-level pending request is required',
      );
    }
    return this.requests.cancel(request.id, this.now());
  }

  private requestIssue(request: PendingAiRequest, canCancel: boolean): RecoveryIssue {
    const canRetry = request.turnId !== null && request.context !== null;
    return Object.freeze({
      kind: request.status === 'FAILED' ? 'FAILED_AI_REQUEST' : 'INTERRUPTED_AI_REQUEST',
      requestId: request.id,
      turnId: request.turnId,
      actions: Object.freeze([
        ...(canRetry ? (['RETRY', 'CHANGE_MODEL'] as const) : []),
        ...(request.turnId === null || canCancel ? (['CANCEL'] as const) : []),
      ]),
    });
  }

  private currentAdventure(campaignId: CampaignId): Adventure | null {
    return (
      this.adventures
        .listByCampaign(campaignId)
        .find((adventure) => adventure.state !== 'SETTLED') ?? null
    );
  }

  private relevantUnfinishedRequests(campaignId: CampaignId): readonly PendingAiRequest[] {
    return Object.freeze(
      this.requests.listUnfinished(campaignId).filter((request) => {
        if (request.turnId === null) return true;
        const turn = this.adventures.getTurn(request.turnId);
        return turn !== null && turn.resolvedAt === null;
      }),
    );
  }

  private requireAdventure(campaignId: CampaignId, adventureId: AdventureId): Adventure {
    const adventure = this.adventures.get(adventureId);
    if (
      adventure === null ||
      adventure.campaignId !== campaignId ||
      adventure.state === 'SETTLED'
    ) {
      throw new AIOrchestrationError(
        'ADVENTURE_NOT_RECOVERABLE',
        'Active campaign adventure is required',
      );
    }
    return adventure;
  }
}

export function inspectDatabaseStartup(result: DatabaseStartupResult): DatabaseRecoveryState {
  if (result.status !== 'FAILED') {
    return Object.freeze({ status: 'READY', databasePath: result.databasePath });
  }
  return Object.freeze({
    status: 'RECOVERY_REQUIRED',
    databasePath: result.databasePath,
    code: result.error.code,
    message: result.error.message,
    originalPreserved: result.error.originalPreserved,
  });
}

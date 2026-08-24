import { invoke } from '@tauri-apps/api/core';

import {
  ProposeTavernSceneActionInputSchema,
  ProposeTavernSceneActionOutputSchema,
  type AIProvider,
} from '@ember-tavern/ai-core';
import {
  campaignId,
  isoTimestamp,
  type NpcTimelineOperation,
  type TavernSceneSnapshot,
} from '@ember-tavern/contracts';
import {
  desktopAIEngine,
  tauriDesktopAIOrchestrator,
  type DesktopAIEngine,
} from './desktop-ai-orchestrator.js';
import {
  balancedRandomnessTemperatureSource,
  tauriRandomnessTemperatureSource,
  type RandomnessTemperatureSource,
} from './randomness-settings-service.js';
import { npcTimelineService, type NpcTimelineService } from './npc-timeline-service.js';

interface GenerationAudit {
  readonly requestId: string;
  readonly generationRecordId: string;
  readonly idempotencyKey: string;
  readonly promptVersion: number;
  readonly input: unknown;
  readonly context: unknown;
  readonly request: unknown;
  readonly rawResponseText: string;
  readonly validatedOutput: unknown;
}

export interface TavernSceneActorInput {
  readonly actorId: string;
  readonly input: unknown;
  readonly authorizedKnowledgeIds: readonly string[];
}

interface TavernSceneGenerationRequest {
  readonly scene: TavernSceneSnapshot;
  readonly actorInputs: readonly TavernSceneActorInput[];
}

export interface TavernSceneGateway {
  start(command: {
    readonly campaignId: string;
    readonly sceneId: string;
    readonly operationId: string;
    readonly participantNpcIds: readonly string[];
    readonly listeningNpcIds: readonly string[];
  }): Promise<TavernSceneSnapshot>;
  prepare(command: {
    readonly campaignId: string;
    readonly sceneId: string;
    readonly playerIntent: string;
    readonly addressedNpcId: string | null;
  }): Promise<TavernSceneGenerationRequest>;
  commit(command: {
    readonly campaignId: string;
    readonly sceneId: string;
    readonly expectedRevision: number;
    readonly turnId: string;
    readonly operationId: string;
    readonly playerIntent: string;
    readonly addressedNpcId: string | null;
    readonly generations: readonly {
      readonly actorId: string;
      readonly generation: GenerationAudit;
    }[];
    readonly timelineSubmissionId: string;
    readonly timelineAttemptId: string;
  }): Promise<TavernSceneSnapshot>;
}

export const tauriTavernSceneGateway: TavernSceneGateway = {
  async start(command) {
    return parseSnapshot(await invoke<unknown>('tavern_scene_start', { command }));
  },
  async prepare(command) {
    const value = requireRecord(await invoke<unknown>('tavern_scene_turn_prepare', { command }));
    return Object.freeze({
      scene: parseSnapshot(value['scene']),
      actorInputs: Object.freeze(requireArray(value['actorInputs']).map(parseActorInput)),
    });
  },
  async commit(command) {
    return parseSnapshot(await invoke<unknown>('tavern_scene_turn_commit', { command }));
  },
};

export class TavernSceneService {
  private readonly sends = new Map<string, Promise<TavernSceneSnapshot>>();
  private readonly ai: DesktopAIEngine;

  public constructor(
    private readonly gateway: TavernSceneGateway = tauriTavernSceneGateway,
    provider?: AIProvider | DesktopAIEngine,
    private readonly randomness: RandomnessTemperatureSource = balancedRandomnessTemperatureSource,
    private readonly timeline: Pick<
      NpcTimelineService,
      'latest' | 'begin' | 'recordFailure'
    > = npcTimelineService,
  ) {
    this.ai = desktopAIEngine(provider);
  }

  public start(
    campaign: string,
    participantNpcIds: readonly string[],
  ): Promise<TavernSceneSnapshot> {
    campaignId(campaign);
    if (
      participantNpcIds.length < 2 ||
      participantNpcIds.length > 6 ||
      new Set(participantNpcIds).size !== participantNpcIds.length
    ) {
      throw new TavernSceneServiceError('PARTICIPANTS_INVALID');
    }
    const suffix = crypto.randomUUID();
    return this.gateway.start({
      campaignId: campaign,
      sceneId: `tavern-scene-${suffix}`,
      operationId: `tavern-scene-start-${suffix}`,
      participantNpcIds,
      listeningNpcIds: participantNpcIds.slice(1),
    });
  }

  public send(
    campaign: string,
    scene: TavernSceneSnapshot,
    playerIntent: string,
    addressedNpcId: string | null,
  ): Promise<TavernSceneSnapshot> {
    const key = `${campaign}:${scene.id}`;
    const existing = this.sends.get(key);
    if (existing !== undefined) return existing;
    const operation = this.performWithRecovery(
      campaign,
      scene,
      playerIntent,
      addressedNpcId,
    ).finally(() => {
      if (this.sends.get(key) === operation) this.sends.delete(key);
    });
    this.sends.set(key, operation);
    return operation;
  }

  public retry(campaign: string, scene: TavernSceneSnapshot): Promise<TavernSceneSnapshot> {
    const key = `${campaign}:${scene.id}`;
    const existing = this.sends.get(key);
    if (existing !== undefined) return existing;
    const operation = this.timeline
      .latest(campaign, 'TAVERN_SCENE', scene.id)
      .then((timeline) => {
        if (timeline === null || !['PENDING', 'FAILED_RETRYABLE'].includes(timeline.status)) {
          throw new TavernSceneServiceError('TIMELINE_RETRY_UNAVAILABLE');
        }
        return this.performSend(
          campaign,
          scene,
          timeline.playerIntent,
          timeline.addressedNpcId,
          timeline,
        );
      })
      .finally(() => {
        if (this.sends.get(key) === operation) this.sends.delete(key);
      });
    this.sends.set(key, operation);
    return operation;
  }

  private async performWithRecovery(
    campaign: string,
    scene: TavernSceneSnapshot,
    playerIntent: string,
    addressedNpcId: string | null,
  ): Promise<TavernSceneSnapshot> {
    const timeline = await this.timeline.latest(campaign, 'TAVERN_SCENE', scene.id);
    return timeline !== null && ['PENDING', 'FAILED_RETRYABLE'].includes(timeline.status)
      ? this.performSend(campaign, scene, timeline.playerIntent, timeline.addressedNpcId, timeline)
      : this.performSend(campaign, scene, playerIntent, addressedNpcId, null);
  }

  private async performSend(
    campaign: string,
    scene: TavernSceneSnapshot,
    playerIntent: string,
    addressedNpcId: string | null,
    existingTimeline: NpcTimelineOperation | null,
  ): Promise<TavernSceneSnapshot> {
    campaignId(campaign);
    const prepared = await this.gateway.prepare({
      campaignId: campaign,
      sceneId: scene.id,
      playerIntent,
      addressedNpcId,
    });
    if (prepared.scene.revision !== scene.revision)
      throw new TavernSceneServiceError('REVISION_CONFLICT');
    const planned = prepared.actorInputs.map(({ actorId, input }) => {
      const suffix = crypto.randomUUID();
      return Object.freeze({
        actorId,
        input,
        requestId: `scene-request-${suffix}`,
        generationRecordId: `scene-generation-${suffix}`,
        idempotencyKey: `scene-action:${scene.id}:${scene.revision}:${actorId}`,
      });
    });
    const attemptId = `npc-timeline-attempt-${crypto.randomUUID()}`;
    const operation = await this.timeline.begin(
      {
        campaignId: campaign,
        scopeKind: 'TAVERN_SCENE',
        scopeId: scene.id,
        playerIntent,
        addressedNpcId,
        hardResultKey: null,
      },
      {
        attemptId,
        requestIds: planned.map(({ requestId }) => requestId),
        generationRecordIds: planned.map(({ generationRecordId }) => generationRecordId),
        idempotencyKeys: planned.map(({ idempotencyKey }) => idempotencyKey),
      },
      existingTimeline,
    );
    try {
      const temperature = await this.randomness.resolveTemperature();
      const generations = await Promise.all(
        planned.map(
          async ({ actorId, input: rawInput, requestId, generationRecordId, idempotencyKey }) => {
            const input = ProposeTavernSceneActionInputSchema.parse(rawInput);
            const generated = await this.ai.execute('PROPOSE_TAVERN_SCENE_ACTION', input, {
              requestId,
              temperature,
              maxOutputTokens: 1_000,
              timeoutMs: 5_000,
            });
            let output: ReturnType<typeof ProposeTavernSceneActionOutputSchema.parse>;
            try {
              output = ProposeTavernSceneActionOutputSchema.parse(generated.validatedOutput);
            } catch (error) {
              throw new TavernSceneServiceError('SCHEMA_VALIDATION_FAILED', { cause: error });
            }
            if (
              output.actorId !== actorId ||
              !input.allowedActions.includes(output.action) ||
              output.citedKnowledgeIds.some(
                (id) => !input.authorizedKnowledge.some((entry) => entry.id === id),
              )
            ) {
              throw new TavernSceneServiceError('ACTOR_SCOPE_VIOLATION');
            }
            return Object.freeze({
              actorId,
              generation: Object.freeze({
                requestId: generated.request.requestId,
                generationRecordId,
                idempotencyKey,
                promptVersion: generated.request.promptVersion,
                input,
                context: { actorId, sceneId: scene.id },
                request: generated.request,
                rawResponseText: generated.response.content,
                validatedOutput: output,
              }),
            });
          },
        ),
      );
      return await this.gateway.commit({
        campaignId: campaign,
        sceneId: scene.id,
        expectedRevision: scene.revision,
        turnId: `tavern-scene-turn-${operation.id}`,
        operationId: `tavern-scene-turn-operation-${operation.operationId}`,
        playerIntent,
        addressedNpcId,
        generations,
        timelineSubmissionId: operation.id,
        timelineAttemptId: attemptId,
      });
    } catch (error) {
      const durable = await this.timeline.latest(campaign, 'TAVERN_SCENE', scene.id);
      if (durable?.status === 'COMMITTED') {
        return this.gateway.start({
          campaignId: campaign,
          sceneId: scene.id,
          operationId: `tavern-scene-reopen-${scene.id}`,
          participantNpcIds: scene.participants.map(({ npcId }) => npcId),
          listeningNpcIds: scene.participants
            .filter(({ status }) => status === 'LISTENING')
            .map(({ npcId }) => npcId),
        });
      }
      throw await this.timeline.recordFailure(operation, attemptId, error);
    }
  }
}

export class TavernSceneServiceError extends Error {
  public constructor(
    public readonly code: string,
    options?: ErrorOptions,
  ) {
    super('Tavern scene operation failed', options);
    this.name = 'TavernSceneServiceError';
  }
}

function parseActorInput(value: unknown): TavernSceneActorInput {
  const record = requireRecord(value);
  return Object.freeze({
    actorId: text(record['actorId']),
    input: record['input'],
    authorizedKnowledgeIds: Object.freeze(requireArray(record['authorizedKnowledgeIds']).map(text)),
  });
}

function parseSnapshot(value: unknown): TavernSceneSnapshot {
  const record = requireRecord(value);
  const status = text(record['status']);
  if (status !== 'ACTIVE' && status !== 'CLOSED') throw new TypeError('Scene status is invalid');
  return Object.freeze({
    id: text(record['id']),
    campaignId: campaignId(text(record['campaignId'])),
    tavernId: text(record['tavernId']),
    revision: positiveInteger(record['revision']),
    status,
    participants: Object.freeze(
      requireArray(record['participants']).map((value) => {
        const participant = requireRecord(value);
        const participantStatus = text(participant['status']);
        if (
          participantStatus !== 'ACTIVE' &&
          participantStatus !== 'LISTENING' &&
          participantStatus !== 'LEFT'
        )
          throw new TypeError('Participant status is invalid');
        return Object.freeze({
          npcId: text(participant['npcId']),
          name: text(participant['name']),
          populationRole: text(participant['populationRole']),
          status: participantStatus,
          joinedAt: isoTimestamp(text(participant['joinedAt'])),
          leftAt: participant['leftAt'] === null ? null : isoTimestamp(text(participant['leftAt'])),
        });
      }),
    ),
    turns: Object.freeze(
      requireArray(record['turns']).map((value) => {
        const turn = requireRecord(value);
        return Object.freeze({
          id: text(turn['id']),
          operationId: text(turn['operationId']),
          sceneId: text(turn['sceneId']),
          sequence: positiveInteger(turn['sequence']),
          beforeRevision: positiveInteger(turn['beforeRevision']),
          afterRevision: positiveInteger(turn['afterRevision']),
          playerIntent: text(turn['playerIntent']),
          addressedNpcId: turn['addressedNpcId'] === null ? null : text(turn['addressedNpcId']),
          actions: requireArray(turn['actions']) as TavernSceneSnapshot['turns'][number]['actions'],
          occurredAt: isoTimestamp(text(turn['occurredAt'])),
        });
      }),
    ),
    createdAt: isoTimestamp(text(record['createdAt'])),
    updatedAt: isoTimestamp(text(record['updatedAt'])),
  });
}
function requireRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new TypeError('Native scene value must be an object');
  return value as Record<string, unknown>;
}
function requireArray(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) throw new TypeError('Native scene value must be an array');
  return value;
}
function text(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0)
    throw new TypeError('Native scene text is invalid');
  return value;
}
function positiveInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1)
    throw new TypeError('Native scene number is invalid');
  return value as number;
}

export const tavernSceneService = new TavernSceneService(
  tauriTavernSceneGateway,
  tauriDesktopAIOrchestrator,
  tauriRandomnessTemperatureSource,
  npcTimelineService,
);

import { invoke } from '@tauri-apps/api/core';

import {
  FakeAIProvider,
  assertTaskContextBudget,
  GenerateAdventurePlanInputSchema,
  GenerateAdventurePlanOutputSchema,
  GenerateAdventureTurnInputSchema,
  GenerateAdventureTurnOutputSchema,
  ResolveDiceResultInputSchema,
  ResolveDiceResultOutputSchema,
  SceneFrameSchema,
  validateAIOutput,
  type AIProvider,
  type AITask,
  type NormalizedAIRequest,
  type ProviderConfig,
} from '@ember-tavern/ai-core';
import {
  aiRequestId,
  campaignId,
  generationRecordId,
  idempotencyKey,
  type AdventureActionMode,
  type SceneFrame,
} from '@ember-tavern/contracts';
import { formatTaskPrompt } from '@ember-tavern/prompts';
import { recordContextInspection } from './context-inspector-service.js';
import { parseD20HardResult, type D20HardResultView } from './d20-hard-result.js';
import {
  balancedRandomnessTemperatureSource,
  tauriRandomnessTemperatureSource,
  type RandomnessTemperatureSource,
} from './randomness-settings-service.js';

export interface AdventureTurnView {
  readonly id: string;
  readonly turnNumber: number;
  readonly sceneText: string;
  readonly playerAction: string;
  readonly actionMode: AdventureActionMode;
  readonly suggestedActions: readonly { readonly text: string }[];
  readonly checkRequest: {
    readonly attribute: Attribute;
    readonly difficulty: number;
    readonly reason: string;
  } | null;
  readonly diceResult: D20HardResultView | null;
  readonly resolved: boolean;
}

export type Attribute = 'physique' | 'agility' | 'knowledge' | 'charisma';

export interface AdventureSnapshot {
  readonly campaignId: string;
  readonly campaignState: string;
  readonly adventureId: string | null;
  readonly state:
    'PREPARING' | 'SCENE' | 'WAITING_FOR_PLAYER' | 'CHECK_REQUIRED' | 'RESOLVING' | 'ENDING' | null;
  readonly currentTurnNumber: number;
  readonly planInput: unknown;
  readonly player: {
    readonly id: string;
    readonly name: string;
    readonly classDisplayName: string;
    readonly personalGoal: string;
    readonly attributes: Readonly<Record<Attribute, number>>;
  };
  readonly quest: {
    readonly id: string;
    readonly publisherNpcId: string;
    readonly relatedNpcIds: readonly string[];
    readonly content: {
      readonly title: string;
      readonly objective: string;
      readonly summary: string;
    };
  };
  readonly clocks: readonly {
    readonly id: string;
    readonly name: string;
    readonly current: number;
    readonly max: number;
  }[];
  readonly items: readonly {
    readonly id: string;
    readonly content: { readonly name: string; readonly description: string };
  }[];
  readonly clues: readonly {
    readonly id: string;
    readonly title: string;
    readonly description: string;
    readonly isCore: boolean;
    readonly discoveredInTurnId: string | null;
  }[];
  readonly turns: readonly AdventureTurnView[];
  readonly currentScene: string;
  readonly sceneFrame: SceneFrame | null;
  readonly suggestedActions: readonly string[];
  readonly turnGenerationContext: unknown | null;
  readonly diceGenerationInput: unknown | null;
}

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

export interface AdventureGateway {
  load(campaignId: string, questId?: string): Promise<AdventureSnapshot>;
  commitPlan(
    campaignId: string,
    questId: string,
    generation: GenerationAudit,
  ): Promise<AdventureSnapshot>;
  start(campaignId: string, adventureId: string): Promise<AdventureSnapshot>;
  submit(
    campaignId: string,
    adventureId: string,
    actionMode: AdventureActionMode,
    playerAction: string,
  ): Promise<AdventureSnapshot>;
  commitTurn(
    campaignId: string,
    adventureId: string,
    generation: GenerationAudit,
  ): Promise<AdventureSnapshot>;
  roll(campaignId: string, adventureId: string): Promise<AdventureSnapshot>;
  commitDice(
    campaignId: string,
    adventureId: string,
    generation: GenerationAudit,
  ): Promise<AdventureSnapshot>;
}

export interface AdventureTurnObserver {
  readonly onSubmitted?: () => void;
  readonly onGenerationStarted?: () => void;
  readonly onValidationStarted?: () => void;
  readonly onResolutionStarted?: () => void;
  readonly onCommitted?: () => void;
}

interface RequestIdentity {
  readonly requestId: string;
  readonly generationRecordId: string;
  readonly idempotencyKey: string;
}

const PROVIDER_CONFIG: ProviderConfig = Object.freeze({
  id: 'windows-offline-fake',
  providerType: 'LOCAL_OPENAI_COMPATIBLE',
  presetKey: 'custom',
  displayName: 'Ember Fake',
  baseUrl: null,
  credentialRef: null,
  options: {},
  enabled: true,
});

export const tauriAdventureGateway: AdventureGateway = {
  async load(id, questId) {
    return parseSnapshot(
      await invoke<unknown>('adventure_get', { campaignId: id, questId: questId ?? null }),
      id,
    );
  },
  async commitPlan(id, questId, generation) {
    return parseSnapshot(
      await invoke<unknown>('adventure_plan_commit', {
        command: { campaignId: id, questId, generation },
      }),
      id,
    );
  },
  async start(id, adventureId) {
    return parseSnapshot(
      await invoke<unknown>('adventure_start', { campaignId: id, adventureId }),
      id,
    );
  },
  async submit(id, adventureId, actionMode, playerAction) {
    return parseSnapshot(
      await invoke<unknown>('adventure_action_submit', {
        command: { campaignId: id, adventureId, actionMode, playerAction },
      }),
      id,
    );
  },
  async commitTurn(id, adventureId, generation) {
    return parseSnapshot(
      await invoke<unknown>('adventure_turn_commit', {
        command: { campaignId: id, adventureId, generation },
      }),
      id,
    );
  },
  async roll(id, adventureId) {
    return parseSnapshot(
      await invoke<unknown>('adventure_roll', { campaignId: id, adventureId }),
      id,
    );
  },
  async commitDice(id, adventureId, generation) {
    return parseSnapshot(
      await invoke<unknown>('adventure_dice_commit', {
        command: { campaignId: id, adventureId, generation },
      }),
      id,
    );
  },
};

export class WindowsAdventureService {
  private readonly operations = new Map<string, Promise<AdventureSnapshot>>();

  public constructor(
    private readonly gateway: AdventureGateway = tauriAdventureGateway,
    private readonly provider: AIProvider = new FakeAIProvider(),
    private readonly createIdentity: (task: AITask) => RequestIdentity = defaultIdentity,
    private readonly randomness: RandomnessTemperatureSource = balancedRandomnessTemperatureSource,
  ) {}

  public load(
    id: string,
    questId?: string,
    observer?: AdventureTurnObserver,
  ): Promise<AdventureSnapshot> {
    campaignId(id);
    if (questId !== undefined) requireText(questId);
    return this.singleFlight(id, async () => {
      const snapshot = await this.gateway.load(id, questId);
      if (snapshot.adventureId === null) return snapshot;
      if (snapshot.state === 'WAITING_FOR_PLAYER') {
        notifyAdventureObserver(observer, 'onSubmitted');
        return this.completeTurn(id, snapshot.adventureId, snapshot, observer);
      }
      return snapshot;
    });
  }

  public prepare(id: string, questId: string): Promise<AdventureSnapshot> {
    return this.singleFlight(id, async () => {
      const snapshot = await this.gateway.load(id, questId);
      if (snapshot.adventureId !== null) return snapshot;
      const input = GenerateAdventurePlanInputSchema.parse(snapshot.planInput);
      const generation = await this.generate(
        'GENERATE_ADVENTURE_PLAN',
        input,
        GenerateAdventurePlanOutputSchema.parse,
        {
          questId: snapshot.quest.id,
          playerCharacterId: requireText(requireRecord(snapshot.player)['id']),
        },
      );
      return this.gateway.commitPlan(id, questId, generation);
    });
  }

  public start(id: string, adventureId: string): Promise<AdventureSnapshot> {
    campaignId(id);
    requireText(adventureId);
    return this.gateway.start(id, adventureId);
  }

  public act(
    id: string,
    adventureId: string,
    actionMode: AdventureActionMode,
    action: string,
    observer?: AdventureTurnObserver,
  ): Promise<AdventureSnapshot> {
    return this.singleFlight(id, async () => {
      requireText(action);
      requireActionMode(actionMode);
      const current = await this.gateway.load(id);
      if (current.state === 'WAITING_FOR_PLAYER') {
        notifyAdventureObserver(observer, 'onSubmitted');
        return this.completeTurn(id, adventureId, current, observer);
      }
      const pending = await this.gateway.submit(id, adventureId, actionMode, action);
      notifyAdventureObserver(observer, 'onSubmitted');
      return this.completeTurn(id, adventureId, pending, observer);
    });
  }

  public resolveCheck(id: string, adventureId: string): Promise<AdventureSnapshot> {
    return this.rollCheck(id, adventureId).then(() => this.completeCheck(id, adventureId));
  }

  public rollCheck(id: string, adventureId: string): Promise<AdventureSnapshot> {
    return this.singleFlight(id, async () => {
      const current = await this.gateway.load(id);
      if (current.state === 'RESOLVING') return current;
      if (current.state !== 'CHECK_REQUIRED') {
        throw new AdventureServiceError('CHECK_NOT_READY');
      }
      return this.gateway.roll(id, adventureId);
    });
  }

  public completeCheck(id: string, adventureId: string): Promise<AdventureSnapshot> {
    return this.singleFlight(id, async () => {
      const current = await this.gateway.load(id);
      if (current.state !== 'RESOLVING') return current;
      return this.completeDice(id, adventureId, current);
    });
  }

  private async completeTurn(
    id: string,
    adventureId: string,
    pending: AdventureSnapshot,
    observer?: AdventureTurnObserver,
  ): Promise<AdventureSnapshot> {
    notifyAdventureObserver(observer, 'onGenerationStarted');
    const input = GenerateAdventureTurnInputSchema.parse(pending.turnGenerationContext);
    const generation = await this.generate(
      'GENERATE_ADVENTURE_TURN',
      input,
      GenerateAdventureTurnOutputSchema.parse,
      { adventureId, turnId: requireLastTurn(pending).id },
      () => notifyAdventureObserver(observer, 'onValidationStarted'),
    );
    notifyAdventureObserver(observer, 'onResolutionStarted');
    const committed = await this.gateway.commitTurn(id, adventureId, generation);
    notifyAdventureObserver(observer, 'onCommitted');
    return committed;
  }

  private async completeDice(
    id: string,
    adventureId: string,
    rolled: AdventureSnapshot,
  ): Promise<AdventureSnapshot> {
    const input = ResolveDiceResultInputSchema.parse(rolled.diceGenerationInput);
    const generation = await this.generate(
      'RESOLVE_DICE_RESULT',
      input,
      ResolveDiceResultOutputSchema.parse,
      { adventureId, turnId: requireLastTurn(rolled).id },
    );
    return this.gateway.commitDice(id, adventureId, generation);
  }

  private async generate(
    task: AITask,
    input: unknown,
    parseOutput: (value: unknown) => unknown,
    context: unknown,
    onValidationStarted?: () => void,
  ): Promise<GenerationAudit> {
    const identity = this.createIdentity(task);
    const model = (await this.provider.listModels()).find(({ name }) => name === 'ember-fake-v1');
    if (model === undefined) throw new AdventureServiceError('MODEL_NOT_FOUND');
    assertTaskContextBudget(task, input);
    await recordContextInspection(task, input);
    const prompt = formatTaskPrompt(task, input, model.capabilities);
    const temperature = await this.randomness.resolveTemperature();
    const request: NormalizedAIRequest = {
      requestId: aiRequestId(identity.requestId),
      task,
      promptVersion: prompt.promptVersion,
      modelName: model.name,
      messages: prompt.messages,
      responseFormat: prompt.responseFormat,
      temperature,
      maxOutputTokens: 8_000,
      timeoutMs: 5_000,
    };
    const response = await this.provider.generate(request, PROVIDER_CONFIG);
    if (response.requestId !== request.requestId || response.modelName !== request.modelName) {
      throw new AdventureServiceError('PROVIDER_IDENTITY_MISMATCH');
    }
    onValidationStarted?.();
    const validation = validateAIOutput(task, response.content);
    if (!validation.ok) throw new AdventureServiceError(validation.error.code);
    return {
      ...identity,
      promptVersion: request.promptVersion,
      input,
      context,
      request,
      rawResponseText: response.content,
      validatedOutput: parseOutput(validation.validatedOutput),
    };
  }

  private async singleFlight(
    campaign: string,
    operation: () => Promise<AdventureSnapshot>,
  ): Promise<AdventureSnapshot> {
    campaignId(campaign);
    const existing = this.operations.get(campaign);
    if (existing !== undefined) return existing;
    const current = operation();
    this.operations.set(campaign, current);
    try {
      return await current;
    } finally {
      if (this.operations.get(campaign) === current) this.operations.delete(campaign);
    }
  }
}

export const windowsAdventureService = new WindowsAdventureService(
  tauriAdventureGateway,
  new FakeAIProvider(),
  defaultIdentity,
  tauriRandomnessTemperatureSource,
);

export class AdventureServiceError extends Error {
  public constructor(public readonly code: string) {
    super('Adventure operation failed');
    this.name = 'AdventureServiceError';
  }
}

function notifyAdventureObserver(
  observer: AdventureTurnObserver | undefined,
  event: keyof AdventureTurnObserver,
): void {
  try {
    observer?.[event]?.();
  } catch {
    // UI observation must never change the persisted adventure workflow.
  }
}

function defaultIdentity(task: AITask): RequestIdentity {
  const suffix = crypto.randomUUID();
  const key = task.toLowerCase().replaceAll('_', '-');
  return {
    requestId: aiRequestId(`${key}-request-${suffix}`),
    generationRecordId: generationRecordId(`${key}-generation-${suffix}`),
    idempotencyKey: idempotencyKey(`${key}:${suffix}`),
  };
}

function parseSnapshot(value: unknown, expectedCampaignId: string): AdventureSnapshot {
  const record = requireRecord(value);
  const storedCampaignId = campaignId(requireText(record['campaignId']));
  if (storedCampaignId !== expectedCampaignId) throw new TypeError('Adventure campaign mismatch');
  const adventureId = nullableText(record['adventureId']);
  const state = nullableEnum(
    ['PREPARING', 'SCENE', 'WAITING_FOR_PLAYER', 'CHECK_REQUIRED', 'RESOLVING', 'ENDING'] as const,
    record['state'],
  );
  const player = requireRecord(record['player']);
  const attributes = requireRecord(player['attributes']);
  const quest = requireRecord(record['quest']);
  const content = requireRecord(quest['content']);
  const currentScene = requireText(record['currentScene']);
  const sceneFrame =
    record['sceneFrame'] === null ? null : SceneFrameSchema.parse(record['sceneFrame']);
  if (sceneFrame !== null && sceneFrame.returnPoint.summary !== currentScene) {
    throw new TypeError('Adventure scene does not match its recovery frame');
  }
  return Object.freeze({
    campaignId: storedCampaignId,
    campaignState: requireText(record['campaignState']),
    adventureId,
    state,
    currentTurnNumber: nonnegativeInteger(record['currentTurnNumber']),
    planInput: record['planInput'],
    player: Object.freeze({
      id: requireText(player['id']),
      name: requireText(player['name']),
      classDisplayName: requireText(player['classDisplayName']),
      personalGoal: requireText(player['personalGoal']),
      attributes: Object.freeze({
        physique: integer(attributes['physique']),
        agility: integer(attributes['agility']),
        knowledge: integer(attributes['knowledge']),
        charisma: integer(attributes['charisma']),
      }),
    }),
    quest: Object.freeze({
      id: requireText(quest['id']),
      publisherNpcId: requireText(quest['publisherNpcId']),
      relatedNpcIds: Object.freeze(requireArray(quest['relatedNpcIds']).map(requireText)),
      content: Object.freeze({
        title: requireText(content['title']),
        objective: requireText(content['objective']),
        summary: requireText(content['summary']),
      }),
    }),
    clocks: Object.freeze(requireArray(record['clocks']).map(parseClock)),
    items: Object.freeze(requireArray(record['items']).map(parseItem)),
    clues: Object.freeze(requireArray(record['clues']).map(parseClue)),
    turns: Object.freeze(requireArray(record['turns']).map(parseTurn)),
    currentScene,
    sceneFrame,
    suggestedActions: Object.freeze(requireArray(record['suggestedActions']).map(requireText)),
    turnGenerationContext: record['turnGenerationContext'] ?? null,
    diceGenerationInput: record['diceGenerationInput'] ?? null,
  });
}

function parseClock(value: unknown) {
  const record = requireRecord(value);
  return Object.freeze({
    id: requireText(record['id']),
    name: requireText(record['name']),
    current: nonnegativeInteger(record['current']),
    max: positiveInteger(record['max']),
  });
}

function parseItem(value: unknown) {
  const record = requireRecord(value);
  const content = requireRecord(record['content']);
  return Object.freeze({
    id: requireText(record['id']),
    content: Object.freeze({
      name: requireText(content['name']),
      description: requireText(content['description']),
    }),
  });
}

function parseClue(value: unknown) {
  const record = requireRecord(value);
  return Object.freeze({
    id: requireText(record['id']),
    title: requireText(record['title']),
    description: requireText(record['description']),
    isCore: requireBoolean(record['isCore']),
    discoveredInTurnId: nullableText(record['discoveredInTurnId']),
  });
}

function parseTurn(value: unknown): AdventureTurnView {
  const record = requireRecord(value);
  const check = record['checkRequest'] === null ? null : requireRecord(record['checkRequest']);
  const dice = record['diceResult'];
  return Object.freeze({
    id: requireText(record['id']),
    turnNumber: positiveInteger(record['turnNumber']),
    sceneText: requireText(record['sceneText']),
    playerAction: requireText(record['playerAction']),
    actionMode: requireActionMode(record['actionMode']),
    suggestedActions: Object.freeze(
      requireArray(record['suggestedActions']).map((value) => {
        const action = requireRecord(value);
        return Object.freeze({ text: requireText(action['text']) });
      }),
    ),
    checkRequest:
      check === null
        ? null
        : Object.freeze({
            attribute: enumValue(
              ['physique', 'agility', 'knowledge', 'charisma'] as const,
              check['attribute'],
            ),
            difficulty: positiveInteger(check['difficulty']),
            reason: requireText(check['reason']),
          }),
    diceResult: dice === null ? null : parseD20HardResult(dice),
    resolved: requireBoolean(record['resolved']),
  });
}

function requireLastTurn(snapshot: AdventureSnapshot): AdventureTurnView {
  const turn = snapshot.turns.at(-1);
  if (turn === undefined) throw new AdventureServiceError('TURN_MISSING');
  return turn;
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('Native adventure response must be an object');
  }
  return value as Record<string, unknown>;
}

function requireArray(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) throw new TypeError('Native adventure collection is invalid');
  return value;
}

function requireText(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) {
    throw new TypeError('Adventure text is invalid');
  }
  return value;
}

function nullableText(value: unknown): string | null {
  return value === null ? null : requireText(value);
}

function integer(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new TypeError('Adventure number is invalid');
  }
  return value;
}

function nonnegativeInteger(value: unknown): number {
  const parsed = integer(value);
  if (parsed < 0) throw new TypeError('Adventure number is negative');
  return parsed;
}

function positiveInteger(value: unknown): number {
  const parsed = integer(value);
  if (parsed < 1) throw new TypeError('Adventure number is not positive');
  return parsed;
}

function requireBoolean(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new TypeError('Adventure boolean is invalid');
  return value;
}

function requireActionMode(value: unknown): AdventureActionMode {
  return enumValue(['ACTION', 'DIALOGUE', 'OBSERVE'] as const, value);
}

function enumValue<const Values extends readonly string[]>(
  values: Values,
  value: unknown,
): Values[number] {
  if (typeof value !== 'string' || !values.includes(value)) {
    throw new TypeError('Adventure enum is invalid');
  }
  return value;
}

function nullableEnum<const Values extends readonly string[]>(
  values: Values,
  value: unknown,
): Values[number] | null {
  return value === null ? null : enumValue(values, value);
}

import { invoke } from '@tauri-apps/api/core';
import {
  FakeAIProvider,
  assertTaskContextBudget,
  compressContextHistory,
  contextBudgetForTask,
  GenerateWorldEventInputSchema,
  GenerateWorldEventOutputSchema,
  SummarizeAdventureInputSchema,
  SummarizeAdventureOutputSchema,
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
} from '@ember-tavern/contracts';
import { formatTaskPrompt } from '@ember-tavern/prompts';
import { recordContextInspection } from './context-inspector-service.js';
import type { AdventureSnapshot } from './adventure-service.js';
import { parseD20HardResult, type D20HardResultView } from './d20-hard-result.js';
import {
  balancedRandomnessTemperatureSource,
  tauriRandomnessTemperatureSource,
  type RandomnessTemperatureSource,
} from './randomness-settings-service.js';

export interface AdventureArchive {
  readonly campaignId: string;
  readonly adventureId: string;
  readonly title: string;
  readonly outcome: 'SUCCESS' | 'PARTIAL_SUCCESS' | 'FAILURE';
  readonly summary: string;
  readonly keyDecisions: readonly string[];
  readonly unresolvedThreads: readonly string[];
  readonly nextDirections: readonly string[];
  readonly diceResults: readonly D20HardResultView[];
  readonly participantNpcs: readonly { readonly id: string; readonly name: string }[];
  readonly unresolvedClues: readonly {
    readonly id: string;
    readonly title: string;
    readonly description: string;
  }[];
  readonly tavernChange: { readonly kind: string; readonly description: string };
  readonly acquiredItems: readonly { readonly name: string; readonly description: string }[];
  readonly worldFacts: readonly { readonly statement: string; readonly kind: string }[];
  readonly generationUses: readonly {
    readonly task: string;
    readonly modelName: string;
    readonly promptVersion: number;
  }[];
  readonly completedAt: string;
}
interface Audit<T = unknown> {
  readonly requestId: string;
  readonly generationRecordId: string;
  readonly idempotencyKey: string;
  readonly promptVersion: number;
  readonly input: unknown;
  readonly context: unknown;
  readonly request: unknown;
  readonly rawResponseText: string;
  readonly validatedOutput: T;
}
export interface SettlementGateway {
  commit(command: {
    campaignId: string;
    adventureId: string;
    outcome: 'SUCCESS';
    summary: Audit;
    worldEvent: Audit;
  }): Promise<AdventureArchive>;
  list(campaignId: string): Promise<readonly AdventureArchive[]>;
}
export const tauriSettlementGateway: SettlementGateway = {
  async commit(command) {
    return parseArchive(
      await invoke<unknown>('adventure_settlement_commit', { command }),
      command.campaignId,
    );
  },
  async list(id) {
    return requireArray(await invoke<unknown>('adventure_archives_get', { campaignId: id })).map(
      (v) => parseArchive(v, id),
    );
  },
};
const CONFIG: ProviderConfig = {
  id: 'fake-windows',
  providerType: 'LOCAL_OPENAI_COMPATIBLE',
  presetKey: 'custom',
  displayName: 'Fake',
  baseUrl: null,
  credentialRef: null,
  options: {},
  enabled: true,
};
export class WindowsSettlementService {
  private readonly active = new Map<string, Promise<AdventureArchive>>();
  public constructor(
    private readonly gateway: SettlementGateway = tauriSettlementGateway,
    private readonly provider: AIProvider = new FakeAIProvider(),
    private readonly randomness: RandomnessTemperatureSource = balancedRandomnessTemperatureSource,
  ) {}
  public list(id: string) {
    campaignId(id);
    return this.gateway.list(id);
  }
  public settle(id: string, snapshot: AdventureSnapshot): Promise<AdventureArchive> {
    campaignId(id);
    if (snapshot.campaignId !== id || snapshot.state !== 'ENDING' || snapshot.adventureId === null)
      throw new TypeError('Adventure is not ready for settlement');
    const prior = this.active.get(id);
    if (prior !== undefined) return prior;
    const operation = this.execute(id, snapshot, snapshot.adventureId);
    this.active.set(id, operation);
    void operation.finally(() => {
      if (this.active.get(id) === operation) this.active.delete(id);
    });
    return operation;
  }
  private async execute(id: string, s: AdventureSnapshot, adventureId: string) {
    const relatedNpcIds = [s.quest.publisherNpcId];
    const summaryInput = SummarizeAdventureInputSchema.parse({
      questTitle: s.quest.content.title,
      turnSummaries: compressContextHistory(
        s.turns.map((t) => `${t.playerAction}: ${t.sceneText}`),
        contextBudgetForTask('SUMMARIZE_ADVENTURE').recentTurnLimit,
        contextBudgetForTask('SUMMARIZE_ADVENTURE').historicalSummaryMaxCharacters,
      ),
      ending: 'SUCCESS',
      discoveredClues: s.clues.filter((c) => c.discoveredInTurnId !== null).map((c) => c.title),
      relatedNpcs: relatedNpcIds.map((npcId) => ({
        id: npcId,
        name: npcId,
        currentMood: 'Expectant',
      })),
    });
    const summary = await this.generate(
      'SUMMARIZE_ADVENTURE',
      summaryInput,
      SummarizeAdventureOutputSchema.parse,
      { adventureId },
    );
    const worldInput = GenerateWorldEventInputSchema.parse({
      activeClocks: s.clocks,
      factionStates: [],
      recentImportantEvents: [],
      currentChapter: summary.validatedOutput.summary,
    });
    const worldEvent = await this.generate(
      'GENERATE_WORLD_EVENT',
      worldInput,
      GenerateWorldEventOutputSchema.parse,
      { adventureId },
    );
    return this.gateway.commit({
      campaignId: id,
      adventureId,
      outcome: 'SUCCESS',
      summary,
      worldEvent,
    });
  }
  private async generate<T>(
    task: Extract<AITask, 'SUMMARIZE_ADVENTURE' | 'GENERATE_WORLD_EVENT'>,
    input: unknown,
    parse: (v: unknown) => T,
    context: Readonly<{ adventureId: string }>,
  ): Promise<Audit<T>> {
    const suffix = crypto.randomUUID();
    const model = (await this.provider.listModels()).find((m) => m.name === 'ember-fake-v1');
    if (model === undefined) throw new Error('Fake model unavailable');
    assertTaskContextBudget(task, input);
    await recordContextInspection(task, input);
    const prompt = formatTaskPrompt(task, input, model.capabilities);
    const temperature = await this.randomness.resolveTemperature();
    const request: NormalizedAIRequest = {
      requestId: aiRequestId(`${task.toLowerCase()}-${suffix}`),
      task,
      promptVersion: prompt.promptVersion,
      modelName: model.name,
      messages: prompt.messages,
      responseFormat: prompt.responseFormat,
      temperature,
      maxOutputTokens: 8000,
      timeoutMs: 5000,
    };
    const response = await this.provider.generate(request, CONFIG);
    if (response.requestId !== request.requestId || response.modelName !== request.modelName) {
      throw new Error('Settlement provider identity mismatch');
    }
    const checked = validateAIOutput(task, response.content);
    if (!checked.ok) throw new Error('Settlement output invalid');
    return {
      requestId: request.requestId,
      generationRecordId: generationRecordId(`settlement-generation-${suffix}`),
      idempotencyKey: idempotencyKey(`settlement:${task}:${suffix}`),
      promptVersion: request.promptVersion,
      input,
      context,
      request,
      rawResponseText: response.content,
      validatedOutput: parse(checked.validatedOutput),
    };
  }
}
export const windowsSettlementService = new WindowsSettlementService(
  tauriSettlementGateway,
  new FakeAIProvider(),
  tauriRandomnessTemperatureSource,
);
function parseArchive(value: unknown, id: string): AdventureArchive {
  const r = requireRecord(value);
  if (requireString(r['campaignId']) !== id) throw new TypeError('Archive campaign mismatch');
  return Object.freeze({
    campaignId: id,
    adventureId: requireString(r['adventureId']),
    title: requireString(r['title']),
    outcome: requireEnum(r['outcome'], ['SUCCESS', 'PARTIAL_SUCCESS', 'FAILURE'] as const),
    summary: requireString(r['summary']),
    keyDecisions: stringArray(r['keyDecisions']),
    unresolvedThreads: stringArray(r['unresolvedThreads']),
    nextDirections: stringArray(r['nextDirections']),
    diceResults: requireArray(r['diceResults']).map(parseD20HardResult),
    participantNpcs: requireArray(r['participantNpcs']).map((v) => {
      const x = requireRecord(v);
      return { id: requireString(x['id']), name: requireString(x['name']) };
    }),
    unresolvedClues: requireArray(r['unresolvedClues']).map((v) => {
      const x = requireRecord(v);
      return {
        id: requireString(x['id']),
        title: requireString(x['title']),
        description: requireString(x['description']),
      };
    }),
    tavernChange: (() => {
      const c = requireRecord(r['tavernChange']);
      return { kind: requireString(c['kind']), description: requireString(c['description']) };
    })(),
    acquiredItems: requireArray(r['acquiredItems']).map((v) => {
      const x = requireRecord(v);
      return { name: requireString(x['name']), description: requireString(x['description']) };
    }),
    worldFacts: requireArray(r['worldFacts']).map((v) => {
      const x = requireRecord(v);
      return { statement: requireString(x['statement']), kind: requireString(x['kind']) };
    }),
    generationUses: requireArray(r['generationUses']).map((v) => {
      const x = requireRecord(v);
      return {
        task: requireString(x['task']),
        modelName: requireString(x['modelName']),
        promptVersion: requireInteger(x['promptVersion']),
      };
    }),
    completedAt: requireString(r['completedAt']),
  });
}
function requireRecord(v: unknown): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v))
    throw new TypeError('Expected object');
  return v as Record<string, unknown>;
}
function requireArray(v: unknown): readonly unknown[] {
  if (!Array.isArray(v)) throw new TypeError('Expected array');
  return v;
}
function requireString(v: unknown): string {
  if (typeof v !== 'string' || v.trim() !== v || v.length === 0)
    throw new TypeError('Expected text');
  return v;
}
function requireInteger(v: unknown): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v)) throw new TypeError('Expected integer');
  return v;
}
function stringArray(v: unknown) {
  return Object.freeze(requireArray(v).map(requireString));
}
function requireEnum<const T extends readonly string[]>(v: unknown, a: T): T[number] {
  const s = requireString(v);
  if (!a.includes(s)) throw new TypeError('Unexpected value');
  return s as T[number];
}

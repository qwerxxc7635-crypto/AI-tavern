import {
  GenerateWorldEventOutputSchema,
  SummarizeAdventureInputSchema,
  SummarizeAdventureOutputSchema,
  buildWorldEventContext,
  compressContextHistory,
  contextBudgetForTask,
  standardizeAIError,
  validateAIOutput,
  type AIProvider,
  type AITask,
  type NormalizedAIRequest,
  type ProviderConfig,
} from '@ember-tavern/ai-core';
import {
  npcId,
  schemaVersion,
  worldClockId,
  type AdventureEnding,
  type AdventureId,
  type AdventureOutcome,
  type AiRequestId,
  type CampaignId,
  type DiceResult,
  type GameEvent,
  type GameEventId,
  type GenerationRecord,
  type GenerationRecordId,
  type IdempotencyKey,
  type IsoTimestamp,
  type Item,
  type ItemEffect,
  type ItemId,
  type JsonValue,
  type ModelProfileId,
  type NpcId,
  type PlayerCharacterId,
  type PromptVersion,
  type Quest,
  type TavernChange,
  type TavernChangeId,
  type WorldFact,
  type WorldFactId,
} from '@ember-tavern/contracts';
import {
  validateDomainStatePatches,
  type ValidatedDomainPatch,
  type WorldClockAdvanceResult,
} from '@ember-tavern/domain';
import {
  AdventureRepository,
  AdventureSettlementRepository,
  CampaignRepository,
  GameEventRepository,
  GenerationRecordRepository,
  ItemRepository,
  NpcRepository,
  PendingAiRequestRepository,
  PlayerCharacterRepository,
  QuestRepository,
  TavernRepository,
  WorldClockRepository,
  WorldRepository,
  type SettlementNpcUpdate,
  type TransactionalSqliteDatabase,
} from '@ember-tavern/persistence';
import { formatTaskPrompt } from '@ember-tavern/prompts';

import { AIOrchestrationError, type AITurnGenerationOptions } from './ai-turn-orchestrator.js';
import { executePrimaryAITask } from './ai-task-orchestrator.js';

type SummaryOutput = ReturnType<typeof SummarizeAdventureOutputSchema.parse>;
type WorldEventOutput = ReturnType<typeof GenerateWorldEventOutputSchema.parse>;
type SettlementTask = Extract<AITask, 'SUMMARIZE_ADVENTURE' | 'GENERATE_WORLD_EVENT'>;

export interface SettlementGenerationRequest {
  readonly campaignId: CampaignId;
  readonly adventureId: AdventureId;
  readonly requestId: AiRequestId;
  readonly generationRecordId: GenerationRecordId;
  readonly idempotencyKey: IdempotencyKey;
  readonly modelProfileId: ModelProfileId | null;
  readonly modelName: string;
  readonly generationOptions: AITurnGenerationOptions;
}

export interface SummarizeAdventureCommand extends SettlementGenerationRequest {
  readonly outcome: AdventureOutcome;
}

export interface AdvanceWorldClocksCommand extends SettlementGenerationRequest {
  readonly summaryGenerationRecordId: GenerationRecordId;
}

export interface FinishAdventureCommand {
  readonly campaignId: CampaignId;
  readonly adventureId: AdventureId;
  readonly playerCharacterId: PlayerCharacterId;
  readonly outcome: AdventureOutcome;
  readonly summaryGenerationRecordId: GenerationRecordId;
  readonly worldEventGenerationRecordId: GenerationRecordId;
  readonly summaryIdempotencyKey: IdempotencyKey;
  readonly worldEventIdempotencyKey: IdempotencyKey;
}

export interface AdventureSettlementIdentityFactory {
  item(adventureId: AdventureId): ItemId;
  fact(adventureId: AdventureId, index: number): WorldFactId;
  tavernChange(adventureId: AdventureId): TavernChangeId;
  event(
    adventureId: AdventureId,
    kind: 'RELATIONSHIP' | 'ITEM' | 'CLOCK' | 'COMPLETED',
    index: number,
  ): GameEventId;
}

export interface AdventureSettlementPolicy {
  rewardEffect(quest: Quest, outcome: AdventureOutcome): ItemEffect;
}

export interface SettlementGenerationUse {
  readonly id: GenerationRecordId;
  readonly task: string;
  readonly modelProfileId: ModelProfileId | null;
  readonly modelName: string;
  readonly promptVersion: PromptVersion;
}

export interface AdventureArchive {
  readonly title: string;
  readonly ending: AdventureEnding;
  readonly turns: ReturnType<AdventureRepository['listTurns']>;
  readonly diceResults: readonly DiceResult[];
  readonly participantNpcIds: readonly NpcId[];
  readonly acquiredItems: readonly Item[];
  readonly worldFacts: readonly WorldFact[];
  readonly tavernChange: TavernChange;
  readonly generationUses: readonly SettlementGenerationUse[];
}

export class AdventureSettlementUseCases {
  private readonly campaigns: CampaignRepository;
  private readonly adventures: AdventureRepository;
  private readonly quests: QuestRepository;
  private readonly npcs: NpcRepository;
  private readonly taverns: TavernRepository;
  private readonly characters: PlayerCharacterRepository;
  private readonly worlds: WorldRepository;
  private readonly clocks: WorldClockRepository;
  private readonly items: ItemRepository;
  private readonly events: GameEventRepository;
  private readonly requests: PendingAiRequestRepository;
  private readonly generations: GenerationRecordRepository;
  private readonly settlements: AdventureSettlementRepository;

  public constructor(
    database: TransactionalSqliteDatabase,
    private readonly provider: AIProvider,
    private readonly providerConfig: ProviderConfig,
    private readonly identities: AdventureSettlementIdentityFactory,
    private readonly policy: AdventureSettlementPolicy,
    private readonly now: () => IsoTimestamp,
  ) {
    this.campaigns = new CampaignRepository(database);
    this.adventures = new AdventureRepository(database);
    this.quests = new QuestRepository(database);
    this.npcs = new NpcRepository(database);
    this.taverns = new TavernRepository(database);
    this.characters = new PlayerCharacterRepository(database);
    this.worlds = new WorldRepository(database);
    this.clocks = new WorldClockRepository(database);
    this.items = new ItemRepository(database);
    this.events = new GameEventRepository(database);
    this.requests = new PendingAiRequestRepository(database);
    this.generations = new GenerationRecordRepository(database);
    this.settlements = new AdventureSettlementRepository(database);
  }

  public async summarizeAdventure(command: SummarizeAdventureCommand): Promise<SummaryOutput> {
    const { adventure, quest, turns } = this.requireEndingAdventure(command);
    const clues = this.adventures.getClues(adventure.id);
    const relatedNpcs = quest.relatedNpcIds.map((id) => this.requireNpc(id, command.campaignId));
    const budget = contextBudgetForTask('SUMMARIZE_ADVENTURE');
    const input = SummarizeAdventureInputSchema.parse({
      questTitle: quest.content.title,
      turnSummaries: compressContextHistory(
        turns.map(turnSummary),
        budget.recentTurnLimit,
        budget.historicalSummaryMaxCharacters,
      ),
      ending: command.outcome,
      discoveredClues: clues
        .filter(({ discoveredInTurnId }) => discoveredInTurnId !== null)
        .map(({ title }) => title),
      relatedNpcs: relatedNpcs.map(({ id, name, currentMood }) => ({
        id,
        name,
        currentMood,
      })),
    });
    const output = SummarizeAdventureOutputSchema.parse(
      await this.generateValidated('SUMMARIZE_ADVENTURE', command, input),
    );
    const allowedNpcs = new Set(relatedNpcs.map(({ id }) => id));
    const updatedNpcs = output.npcUpdates.map(({ npcId: value }) => npcId(value));
    if (
      new Set(updatedNpcs).size !== updatedNpcs.length ||
      updatedNpcs.some((id) => !allowedNpcs.has(id))
    ) {
      throw new AIOrchestrationError(
        'SETTLEMENT_REFERENCE_INVALID',
        'Settlement summary references an unrelated NPC',
      );
    }
    return output;
  }

  public async advanceWorldClocks(command: AdvanceWorldClocksCommand): Promise<WorldEventOutput> {
    this.requireEndingAdventure(command);
    const summary = this.summaryOutput(command.summaryGenerationRecordId, command.campaignId);
    const world = this.requireWorld(command.campaignId);
    const input = buildWorldEventContext(
      {
        world,
        clocks: this.clocks.list(command.campaignId),
        recentEvents: this.events.list(command.campaignId),
        currentChapter: summary.summary,
      },
      contextBudgetForTask('GENERATE_WORLD_EVENT'),
    );
    const output = GenerateWorldEventOutputSchema.parse(
      await this.generateValidated('GENERATE_WORLD_EVENT', command, input),
    );
    const knownClockIds = new Set(this.clocks.list(command.campaignId).map(({ id }) => id));
    const proposedClockIds = output.clockAdvances.map(({ clockId }) => clockId);
    if (
      new Set(proposedClockIds).size !== proposedClockIds.length ||
      proposedClockIds.some((id) => !knownClockIds.has(worldClockId(id)))
    ) {
      throw new AIOrchestrationError(
        'SETTLEMENT_REFERENCE_INVALID',
        'World event references an unknown or duplicate clock',
      );
    }
    return output;
  }

  public finishAdventure(command: FinishAdventureCommand): AdventureArchive {
    const existingEnding = this.adventures.getEnding(command.adventureId);
    if (existingEnding !== null) {
      const existingAdventure = this.adventures.get(command.adventureId);
      const existingCharacter = this.characters.get(command.playerCharacterId);
      if (
        existingAdventure?.campaignId !== command.campaignId ||
        existingCharacter?.campaignId !== command.campaignId ||
        existingEnding.summaryGenerationRecordId !== command.summaryGenerationRecordId ||
        existingEnding.worldEventGenerationRecordId !== command.worldEventGenerationRecordId ||
        existingEnding.outcome !== command.outcome
      ) {
        throw new AIOrchestrationError(
          'SETTLEMENT_CONFLICT',
          'Settled adventure does not match the requested generation records',
        );
      }
      return this.archive(
        command.adventureId,
        command.summaryGenerationRecordId,
        command.worldEventGenerationRecordId,
      );
    }
    const { adventure, quest, turns } = this.requireEndingAdventure(command);
    const character = this.characters.get(command.playerCharacterId);
    if (character === null || character.campaignId !== command.campaignId) {
      throw new AIOrchestrationError('CHARACTER_NOT_FOUND', 'Campaign player character not found');
    }
    const summary = this.summaryOutput(command.summaryGenerationRecordId, command.campaignId);
    const worldEvent = this.worldEventOutput(
      command.worldEventGenerationRecordId,
      command.campaignId,
    );
    const relationships = quest.relatedNpcIds.map((id) => {
      const relationship = this.npcs.getRelationship(id);
      if (relationship === null || relationship.playerCharacterId !== character.id) {
        throw new AIOrchestrationError(
          'RELATIONSHIP_NOT_FOUND',
          'Related NPC relationship not found',
        );
      }
      return relationship;
    });
    this.validateSettlementProposalShape(summary, worldEvent, quest, command.outcome);
    const validated = validateDomainStatePatches(
      [
        ...summary.statePatchProposals,
        ...worldEvent.newFacts.map((statement) => ({
          kind: 'FACT',
          targetId: null,
          rationale: 'The settlement world event becomes a durable fact.',
          payload: { statement },
        })),
        ...worldEvent.clockAdvances.map(({ clockId, amount, reason }) => ({
          kind: 'CLOCK',
          targetId: clockId,
          rationale: reason,
          payload: { amount },
        })),
      ],
      {
        campaignId: command.campaignId,
        world: this.requireWorld(command.campaignId),
        quests: [quest],
        relationships,
        clocks: this.clocks.list(command.campaignId),
        rewardAuthorizations: [
          {
            questId: quest.id,
            adventureId: adventure.id,
            ownerCharacterId: character.id,
            effect: this.policy.rewardEffect(quest, command.outcome),
          },
        ],
      },
    );
    const timestamp = this.now();
    const settlement = mapSettlement(validated);
    if (
      settlement.quest === null ||
      settlement.quest.status !== expectedQuestStatus(command.outcome)
    ) {
      throw new AIOrchestrationError(
        'SETTLEMENT_OUTCOME_INVALID',
        'Quest result does not match the locally selected adventure outcome',
      );
    }
    const npcUpdates = this.npcUpdates(
      summary,
      settlement.relationships,
      command.campaignId,
      timestamp,
    );
    const publisher = this.requireNpc(quest.publisherNpcId, command.campaignId);
    const tavern = this.taverns.get(publisher.tavernId);
    if (tavern === null || tavern.campaignId !== command.campaignId) {
      throw new AIOrchestrationError('TAVERN_NOT_FOUND', 'Settlement tavern not found');
    }
    const tavernChange: TavernChange = Object.freeze({
      id: this.identities.tavernChange(adventure.id),
      tavernId: tavern.id,
      kind: summary.tavernChange.kind,
      description: summary.tavernChange.description,
      sourceAdventureId: adventure.id,
      occurredAt: timestamp,
    });
    const rewardItem =
      settlement.reward === null
        ? null
        : Object.freeze({
            id: this.identities.item(adventure.id),
            campaignId: command.campaignId,
            content: settlement.reward.content,
            rewardTier: settlement.reward.rewardTier,
            effect: settlement.reward.authorization.effect,
            createdAt: timestamp,
          });
    const facts = settlement.facts.map((fact, index): WorldFact =>
      Object.freeze({
        id: this.identities.fact(adventure.id, index),
        campaignId: command.campaignId,
        kind: fact.factKind,
        statement: fact.statement,
        locationId: null,
        factionIds: Object.freeze([]),
        supersedesFactId: null,
        createdAt: timestamp,
      }),
    );
    const participantNpcIds = Object.freeze([
      ...new Set([
        ...turns.flatMap(({ speakerNpcIds }) => speakerNpcIds),
        ...npcUpdates.map(({ profile }) => profile.id),
      ]),
    ]);
    const ending: AdventureEnding = Object.freeze({
      adventureId: adventure.id,
      outcome: command.outcome,
      summary: summary.summary,
      keyDecisions: Object.freeze([...summary.keyDecisions]),
      unresolvedThreads: Object.freeze([...summary.unresolvedThreads]),
      nextDirections: Object.freeze([...summary.nextDirections]),
      unresolvedClueIds: Object.freeze(
        this.adventures
          .getClues(adventure.id)
          .filter(({ discoveredInTurnId }) => discoveredInTurnId === null)
          .map(({ id }) => id),
      ),
      participantNpcIds,
      acquiredItemIds: Object.freeze(rewardItem === null ? [] : [rewardItem.id]),
      worldFactIds: Object.freeze(facts.map(({ id }) => id)),
      tavernChangeId: tavernChange.id,
      summaryGenerationRecordId: command.summaryGenerationRecordId,
      worldEventGenerationRecordId: command.worldEventGenerationRecordId,
      completedAt: timestamp,
    });
    const events = this.settlementEvents(
      command,
      ending,
      quest,
      npcUpdates,
      rewardItem,
      settlement.clocks,
      timestamp,
    );
    try {
      this.settlements.commitOnce({
        campaignId: command.campaignId,
        playerCharacterId: character.id,
        summaryIdempotencyKey: command.summaryIdempotencyKey,
        worldEventIdempotencyKey: command.worldEventIdempotencyKey,
        quest: Object.freeze({ ...settlement.quest, updatedAt: timestamp }),
        ending,
        npcUpdates,
        tavernChange,
        rewardItem,
        worldFacts: facts,
        clockAdvances: settlement.clocks,
        events,
        committedAt: timestamp,
      });
    } catch (error) {
      throw new AIOrchestrationError('SETTLEMENT_COMMIT_FAILED', 'Adventure settlement failed', {
        cause: error,
      });
    }
    return this.archive(
      adventure.id,
      command.summaryGenerationRecordId,
      command.worldEventGenerationRecordId,
    );
  }

  private async generateValidated(
    task: SettlementTask,
    command: SettlementGenerationRequest,
    input: unknown,
  ): Promise<JsonValue> {
    const inputJson = json(input);
    const pending = this.requests.createOrGet({
      id: command.requestId,
      campaignId: command.campaignId,
      turnId: null,
      idempotencyKey: command.idempotencyKey,
      task,
      modelProfileId: command.modelProfileId,
      input: inputJson,
      createdAt: this.now(),
    });
    if (pending.status === 'VALIDATING' || pending.status === 'COMMITTED') {
      return this.validatedOutput(command.generationRecordId, task, command.campaignId);
    }
    if (pending.status !== 'CREATED') {
      throw new AIOrchestrationError('REQUEST_NOT_READY', `Cannot start from ${pending.status}`);
    }
    this.requests.setContext(command.requestId, inputJson, this.now());
    const model = (await this.provider.listModels()).find(({ name }) => name === command.modelName);
    if (model === undefined) {
      this.fail(command, 'MODEL_NOT_FOUND', 'Configured model is unavailable', false);
      throw new AIOrchestrationError('MODEL_NOT_FOUND', 'Configured model is unavailable');
    }
    const prompt = formatTaskPrompt(task, input, model.capabilities);
    const request: NormalizedAIRequest = {
      requestId: command.requestId,
      task,
      promptVersion: prompt.promptVersion,
      modelName: command.modelName,
      messages: prompt.messages,
      responseFormat: prompt.responseFormat,
      ...command.generationOptions,
    };
    this.generations.create({
      id: command.generationRecordId,
      campaignId: command.campaignId,
      requestId: command.requestId,
      task,
      modelProfileId: command.modelProfileId,
      promptVersion: request.promptVersion,
      request: json({ ...request, context: inputJson }),
      startedAt: this.now(),
    });
    this.requests.startAttempt(command.requestId, this.now());
    let raw: string;
    try {
      const response = await executePrimaryAITask(
        this.provider,
        this.providerConfig,
        command.campaignId,
        request,
        inputJson,
      );
      if (response.requestId !== request.requestId || response.modelName !== request.modelName) {
        throw new AIOrchestrationError('INVALID_OUTPUT', 'Provider response identity mismatch');
      }
      raw = response.content;
      this.requests.markReceived(command.requestId, this.now());
      this.requests.markValidating(command.requestId, this.now());
    } catch (error) {
      const providerError = standardizeAIError(error);
      this.generations.complete(command.generationRecordId, {
        rawResponseText: null,
        validatedOutput: null,
        validationError: generationError(providerError.code, 'Settlement provider request failed'),
        completedAt: this.now(),
      });
      this.fail(
        command,
        providerError.code,
        'Settlement provider request failed',
        providerError.retryable,
      );
      throw new AIOrchestrationError(providerError.code, 'Settlement provider request failed', {
        cause: providerError,
      });
    }
    const validated = validateAIOutput(task, raw);
    if (!validated.ok) {
      this.generations.complete(command.generationRecordId, {
        rawResponseText: raw,
        validatedOutput: null,
        validationError: validated.error,
        completedAt: this.now(),
      });
      this.fail(command, 'INVALID_OUTPUT', 'Settlement output validation failed', true);
      throw new AIOrchestrationError('INVALID_OUTPUT', 'Settlement output validation failed');
    }
    this.generations.complete(command.generationRecordId, {
      rawResponseText: raw,
      validatedOutput: validated.validatedOutput,
      validationError: null,
      completedAt: this.now(),
    });
    return validated.validatedOutput;
  }

  private requireEndingAdventure(command: { campaignId: CampaignId; adventureId: AdventureId }) {
    const campaign = this.campaigns.get(command.campaignId);
    const adventure = this.adventures.get(command.adventureId);
    if (
      campaign?.state !== 'ADVENTURE' ||
      adventure === null ||
      adventure.campaignId !== command.campaignId ||
      adventure.state !== 'ENDING'
    ) {
      throw new AIOrchestrationError(
        'SETTLEMENT_NOT_READY',
        'Settlement requires an ending adventure',
      );
    }
    const quest = this.quests.get(adventure.questId);
    if (quest === null || quest.campaignId !== command.campaignId || quest.status !== 'ACTIVE') {
      throw new AIOrchestrationError(
        'SETTLEMENT_NOT_READY',
        'Settlement requires the active adventure quest',
      );
    }
    const turns = this.adventures.listTurns(adventure.id);
    if (turns.length === 0 || turns.some(({ resolvedAt }) => resolvedAt === null)) {
      throw new AIOrchestrationError(
        'SETTLEMENT_NOT_READY',
        'Settlement requires at least one fully resolved turn',
      );
    }
    return { adventure, quest, turns };
  }

  private validateSettlementProposalShape(
    summary: SummaryOutput,
    worldEvent: WorldEventOutput,
    quest: Quest,
    outcome: AdventureOutcome,
  ): void {
    const kinds = summary.statePatchProposals.map(({ kind }) => kind);
    const questPatches = summary.statePatchProposals.filter(({ kind }) => kind === 'QUEST');
    const rewards = summary.statePatchProposals.filter(({ kind }) => kind === 'ITEM_REWARD');
    const relationshipTargets = summary.statePatchProposals
      .filter(({ kind }) => kind === 'RELATIONSHIP')
      .map(({ targetId }) => targetId);
    const moodTargets = summary.npcUpdates.map(({ npcId: value }) => value);
    if (
      kinds.some((kind) => !['QUEST', 'RELATIONSHIP', 'ITEM_REWARD'].includes(kind)) ||
      questPatches.length !== 1 ||
      questPatches[0]?.targetId !== quest.id ||
      rewards.length > 1 ||
      (outcome === 'FAILURE' && rewards.length !== 0) ||
      relationshipTargets.length !== moodTargets.length ||
      relationshipTargets.some((id) => id === null || !moodTargets.includes(id)) ||
      moodTargets.some((id) => !relationshipTargets.includes(id)) ||
      worldEvent.newFacts.length === 0
    ) {
      throw new AIOrchestrationError(
        'SETTLEMENT_PATCH_INVALID',
        'Settlement proposals do not match the local settlement contract',
      );
    }
  }

  private npcUpdates(
    summary: SummaryOutput,
    patches: readonly ValidatedDomainPatch[],
    campaignId: CampaignId,
    at: IsoTimestamp,
  ): readonly SettlementNpcUpdate[] {
    return Object.freeze(
      summary.npcUpdates.map((proposal) => {
        const profile = this.requireNpc(npcId(proposal.npcId), campaignId);
        const before = this.npcs.getRelationship(profile.id);
        const validated = patches.find(
          (patch) => patch.kind === 'RELATIONSHIP' && patch.relationship.npcId === profile.id,
        );
        if (before === null || validated?.kind !== 'RELATIONSHIP') {
          throw new AIOrchestrationError(
            'SETTLEMENT_PATCH_INVALID',
            'NPC update has no validated relationship change',
          );
        }
        return Object.freeze({
          profile: Object.freeze({ ...profile, currentMood: proposal.currentMood, updatedAt: at }),
          before,
          after: validated.relationship,
        });
      }),
    );
  }

  private settlementEvents(
    command: FinishAdventureCommand,
    ending: AdventureEnding,
    quest: Quest,
    npcUpdates: readonly SettlementNpcUpdate[],
    rewardItem: Item | null,
    clocks: readonly WorldClockAdvanceResult[],
    at: IsoTimestamp,
  ): readonly GameEvent[] {
    const events: GameEvent[] = npcUpdates.map(({ before, after }, index) =>
      Object.freeze({
        id: this.identities.event(command.adventureId, 'RELATIONSHIP', index),
        campaignId: command.campaignId,
        schemaVersion: schemaVersion(1),
        type: 'RELATIONSHIP_CHANGED',
        payload: Object.freeze({ before, after }),
        occurredAt: at,
      }),
    );
    if (rewardItem !== null) {
      events.push(
        Object.freeze({
          id: this.identities.event(command.adventureId, 'ITEM', 0),
          campaignId: command.campaignId,
          schemaVersion: schemaVersion(1),
          type: 'ITEM_ACQUIRED',
          payload: Object.freeze({
            itemId: rewardItem.id,
            playerCharacterId: command.playerCharacterId,
            sourceAdventureId: command.adventureId,
          }),
          occurredAt: at,
        }),
      );
    }
    clocks.forEach(({ clock, triggeredStages }, index) => {
      events.push(
        Object.freeze({
          id: this.identities.event(command.adventureId, 'CLOCK', index),
          campaignId: command.campaignId,
          schemaVersion: schemaVersion(1),
          type: 'WORLD_CLOCK_ADVANCED',
          payload: Object.freeze({
            worldClockId: clock.id,
            previous: clock.current - 1,
            current: clock.current,
            triggeredStageThresholds: Object.freeze(triggeredStages.map(({ at: value }) => value)),
          }),
          occurredAt: at,
        }),
      );
    });
    events.push(
      Object.freeze({
        id: this.identities.event(command.adventureId, 'COMPLETED', 0),
        campaignId: command.campaignId,
        schemaVersion: schemaVersion(1),
        type: 'ADVENTURE_COMPLETED',
        payload: Object.freeze({ adventureId: command.adventureId, questId: quest.id, ending }),
        occurredAt: at,
      }),
    );
    return Object.freeze(events);
  }

  private archive(
    adventureId: AdventureId,
    summaryId: GenerationRecordId,
    worldEventId: GenerationRecordId,
  ): AdventureArchive {
    const adventure = this.adventures.get(adventureId);
    const ending = this.adventures.getEnding(adventureId);
    if (adventure === null || ending === null) {
      throw new AIOrchestrationError('ARCHIVE_NOT_FOUND', 'Settled adventure archive not found');
    }
    const quest = this.quests.get(adventure.questId);
    if (quest === null) {
      throw new AIOrchestrationError('ARCHIVE_NOT_FOUND', 'Archive quest not found');
    }
    const publisher = this.requireNpc(quest.publisherNpcId, adventure.campaignId);
    const tavernChange = this.taverns
      .listChanges(publisher.tavernId)
      .find(({ id }) => id === ending.tavernChangeId);
    if (tavernChange === undefined) {
      throw new AIOrchestrationError('ARCHIVE_NOT_FOUND', 'Archive tavern change not found');
    }
    const turns = this.adventures.listTurns(adventure.id);
    return Object.freeze({
      title: quest.content.title,
      ending,
      turns,
      diceResults: Object.freeze(
        turns.flatMap(({ diceResult }) => (diceResult === null ? [] : [diceResult])),
      ),
      participantNpcIds: ending.participantNpcIds,
      acquiredItems: Object.freeze(
        ending.acquiredItemIds.map((id) => {
          const item = this.items.get(id);
          if (item === null) {
            throw new AIOrchestrationError('ARCHIVE_NOT_FOUND', 'Archive item not found');
          }
          return item;
        }),
      ),
      worldFacts: Object.freeze(
        ending.worldFactIds.map((id) => {
          const fact = this.worlds.getFact(id);
          if (fact === null) {
            throw new AIOrchestrationError('ARCHIVE_NOT_FOUND', 'Archive fact not found');
          }
          return fact;
        }),
      ),
      tavernChange,
      generationUses: Object.freeze([
        generationUse(this.requireGeneration(summaryId)),
        generationUse(this.requireGeneration(worldEventId)),
      ]),
    });
  }

  private summaryOutput(id: GenerationRecordId, campaignId: CampaignId): SummaryOutput {
    return SummarizeAdventureOutputSchema.parse(
      this.validatedOutput(id, 'SUMMARIZE_ADVENTURE', campaignId),
    );
  }

  private worldEventOutput(id: GenerationRecordId, campaignId: CampaignId): WorldEventOutput {
    return GenerateWorldEventOutputSchema.parse(
      this.validatedOutput(id, 'GENERATE_WORLD_EVENT', campaignId),
    );
  }

  private validatedOutput(id: GenerationRecordId, task: AITask, campaignId: CampaignId): JsonValue {
    const record = this.requireGeneration(id);
    if (
      record.campaignId !== campaignId ||
      record.task !== task ||
      record.validatedOutput === null
    ) {
      throw new AIOrchestrationError(
        'GENERATION_RECORD_MISSING',
        'Settlement generation record is missing or mismatched',
      );
    }
    return record.validatedOutput;
  }

  private requireGeneration(id: GenerationRecordId): GenerationRecord {
    const record = this.generations.get(id);
    if (record === null) {
      throw new AIOrchestrationError('GENERATION_RECORD_MISSING', 'Generation record not found');
    }
    return record;
  }

  private requireNpc(id: NpcId, campaignId: CampaignId) {
    const npc = this.npcs.get(id);
    if (npc === null || npc.campaignId !== campaignId) {
      throw new AIOrchestrationError('NPC_NOT_FOUND', 'Campaign NPC not found');
    }
    return npc;
  }

  private requireWorld(campaignId: CampaignId) {
    const world = this.worlds.getBible(campaignId);
    if (world === null) throw new AIOrchestrationError('WORLD_NOT_FOUND', 'World not found');
    return world;
  }

  private fail(
    command: SettlementGenerationRequest,
    code: string,
    message: string,
    retryable: boolean,
  ): void {
    this.requests.fail(command.requestId, { code, message, retryable }, this.now());
  }
}

function mapSettlement(patches: readonly ValidatedDomainPatch[]) {
  let quest: Quest | null = null;
  let reward: Extract<ValidatedDomainPatch, { kind: 'ITEM_REWARD' }> | null = null;
  const relationships: ValidatedDomainPatch[] = [];
  const facts: Extract<ValidatedDomainPatch, { kind: 'FACT' }>[] = [];
  const clocks: WorldClockAdvanceResult[] = [];
  for (const patch of patches) {
    switch (patch.kind) {
      case 'QUEST':
        quest = patch.quest;
        break;
      case 'RELATIONSHIP':
        relationships.push(patch);
        break;
      case 'ITEM_REWARD':
        reward = patch;
        break;
      case 'FACT':
        facts.push(patch);
        break;
      case 'CLOCK':
        clocks.push(patch.result);
        break;
    }
  }
  return {
    quest,
    reward,
    relationships: Object.freeze(relationships),
    facts: Object.freeze(facts),
    clocks: Object.freeze(clocks),
  };
}

function expectedQuestStatus(outcome: AdventureOutcome): Quest['status'] {
  return outcome === 'FAILURE' ? 'FAILED' : 'COMPLETED';
}

function turnSummary(turn: ReturnType<AdventureRepository['listTurns']>[number]): string {
  const action =
    turn.playerAction === null
      ? 'No player action.'
      : turn.playerAction.kind === 'SUGGESTED' || turn.playerAction.kind === 'FREEFORM'
        ? turn.playerAction.text
        : turn.playerAction.kind === 'USE_ITEM'
          ? turn.playerAction.intent
          : turn.playerAction.reason;
  const dice =
    turn.diceResult === null
      ? ''
      : ` D20 ${turn.diceResult.d20}, total ${turn.diceResult.total}, ${
          turn.diceResult.success ? 'success' : 'failure'
        }.`;
  return `Turn ${turn.turnNumber}: ${action} ${turn.sceneText}${dice}`;
}

function generationUse(record: GenerationRecord): SettlementGenerationUse {
  return Object.freeze({
    id: record.id,
    task: record.task,
    modelProfileId: record.modelProfileId,
    modelName: modelName(record.request),
    promptVersion: record.promptVersion,
  });
}

function modelName(value: JsonValue): string {
  if (!isJsonObject(value)) return 'unknown';
  const name = value['modelName'];
  return typeof name === 'string' && name.trim().length > 0 ? name : 'unknown';
}

function isJsonObject(value: JsonValue): value is { readonly [key: string]: JsonValue } {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function generationError(code: string, message: string) {
  return Object.freeze({
    code,
    issues: Object.freeze([Object.freeze({ path: Object.freeze([]), code, message })]),
  });
}

function json(value: unknown): JsonValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return value;
  }
  if (Array.isArray(value)) return value.map(json);
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, json(entry)]));
  }
  throw new TypeError('Value must be finite JSON');
}

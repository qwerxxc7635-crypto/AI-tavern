import {
  GenerateAdventureTurnOutputSchema,
  ResolveDiceResultInputSchema,
  ResolveDiceResultOutputSchema,
  buildAdventureTurnContext,
  compressContextHistory,
  contextBudgetForTask,
  type AIProvider,
  type ProviderConfig,
} from '@ember-tavern/ai-core';
import {
  aiOperationId,
  npcId,
  schemaVersion,
  transitionAdventureState,
  type ActionOptionId,
  type Adventure,
  type AdventureId,
  type AdventureTurn,
  type AiRequestId,
  type CampaignId,
  type CheckRequestId,
  type Clue,
  type GameEvent,
  type GameEventId,
  type GenerationRecordId,
  type IdempotencyKey,
  type IsoTimestamp,
  type JsonValue,
  type ModelProfileId,
  type PlayerAction,
  type PlayerCharacterId,
  type SnapshotId,
  type TurnId,
  type WorldFactId,
} from '@ember-tavern/contracts';
import {
  resolveD20Check,
  validateDomainStatePatches,
  type D20RandomSource,
  type ValidatedDomainPatch,
} from '@ember-tavern/domain';
import {
  AdventureRepository,
  ItemRepository,
  NpcRepository,
  PlayerCharacterRepository,
  QuestRepository,
  SnapshotRepository,
  WorldClockRepository,
  WorldRepository,
  type CreateSnapshot,
  type TransactionalSqliteDatabase,
  type TurnCommit,
  type TurnStatePatch,
} from '@ember-tavern/persistence';

import {
  AIOrchestrationError,
  AITurnOrchestrator,
  type AITurnGenerationOptions,
} from './ai-turn-orchestrator.js';

export interface AdventureTurnIdentityFactory {
  check(turnId: TurnId): CheckRequestId;
  option(turnId: TurnId, index: number): ActionOptionId;
  event(turnId: TurnId, kind: 'ACTION' | 'DICE'): GameEventId;
  fact(turnId: TurnId, phase: 'ACTION' | 'DICE', index: number): WorldFactId;
  snapshot(turnId: TurnId): SnapshotId;
  completedSnapshot(requestId: AiRequestId): SnapshotId;
}

export interface SubmitPlayerActionCommand {
  readonly campaignId: CampaignId;
  readonly adventureId: AdventureId;
  readonly turnId: TurnId;
  readonly currentScene: string;
  readonly action: PlayerAction;
}

export interface ResolveAdventureTurnCommand {
  readonly campaignId: CampaignId;
  readonly adventureId: AdventureId;
  readonly turnId: TurnId;
  readonly playerCharacterId: PlayerCharacterId;
  readonly requestId: AiRequestId;
  readonly generationRecordId: GenerationRecordId;
  readonly idempotencyKey: IdempotencyKey;
  readonly modelProfileId: ModelProfileId | null;
  readonly modelName: string;
  readonly generationOptions: AITurnGenerationOptions;
}

export interface RollCheckCommand {
  readonly campaignId: CampaignId;
  readonly adventureId: AdventureId;
  readonly turnId: TurnId;
  readonly playerCharacterId: PlayerCharacterId;
  readonly statusModifier: number;
}

export class AdventureTurnUseCases {
  private readonly adventures: AdventureRepository;
  private readonly quests: QuestRepository;
  private readonly worlds: WorldRepository;
  private readonly characters: PlayerCharacterRepository;
  private readonly npcs: NpcRepository;
  private readonly items: ItemRepository;
  private readonly clocks: WorldClockRepository;
  private readonly snapshots: SnapshotRepository;
  private readonly orchestrator: AITurnOrchestrator;

  public constructor(
    database: TransactionalSqliteDatabase,
    provider: AIProvider,
    providerConfig: ProviderConfig,
    private readonly identities: AdventureTurnIdentityFactory,
    private readonly random: D20RandomSource,
    private readonly now: () => IsoTimestamp,
  ) {
    this.adventures = new AdventureRepository(database);
    this.quests = new QuestRepository(database);
    this.worlds = new WorldRepository(database);
    this.characters = new PlayerCharacterRepository(database);
    this.npcs = new NpcRepository(database);
    this.items = new ItemRepository(database);
    this.clocks = new WorldClockRepository(database);
    this.snapshots = new SnapshotRepository(database);
    this.orchestrator = new AITurnOrchestrator(database, provider, providerConfig, now);
  }

  public submitPlayerAction(command: SubmitPlayerActionCommand): AdventureTurn {
    const adventure = this.requireAdventure(command.adventureId, command.campaignId);
    if (!['SCENE', 'WAITING_FOR_PLAYER'].includes(adventure.state)) {
      throw new AIOrchestrationError(
        'ACTION_NOT_ALLOWED',
        'Player action requires a current adventure scene',
      );
    }
    if (command.currentScene.trim().length === 0) {
      throw new AIOrchestrationError('ACTION_NOT_ALLOWED', 'Current scene must not be empty');
    }
    const timestamp = this.now();
    const turn: AdventureTurn = Object.freeze({
      id: command.turnId,
      adventureId: adventure.id,
      turnNumber: adventure.currentTurnNumber + 1,
      sceneText: command.currentScene,
      speakerNpcIds: Object.freeze([]),
      suggestedActions: Object.freeze([]),
      playerAction: Object.freeze({ ...command.action }),
      checkRequest: null,
      diceResult: null,
      createdAt: timestamp,
      resolvedAt: null,
    });
    const waiting: Adventure = Object.freeze({
      ...adventure,
      state:
        adventure.state === 'SCENE'
          ? transitionAdventureState(adventure.state, 'WAITING_FOR_PLAYER')
          : adventure.state,
      updatedAt: timestamp,
    });
    try {
      this.adventures.submitAction(waiting, turn);
    } catch (error) {
      throw new AIOrchestrationError('ACTION_NOT_ALLOWED', 'Player action could not be saved', {
        cause: error,
      });
    }
    try {
      this.snapshots.create({
        id: this.identities.snapshot(turn.id),
        campaignId: command.campaignId,
        kind: 'AUTO',
        reason: turnInputSnapshotReason(turn.id),
        schemaVersion: schemaVersion(1),
        createdAt: timestamp,
      });
    } catch (error) {
      throw new AIOrchestrationError(
        'SNAPSHOT_CREATE_FAILED',
        'Player action was saved but its pre-generation snapshot could not be created',
        { cause: error },
      );
    }
    return this.requireTurn(turn.id, adventure.id);
  }

  public restoreLatestCompleteTurn(campaign: CampaignId, adventureId: AdventureId): AdventureTurn {
    const snapshot = this.snapshots.findLatestAutoByReasonPrefix(
      campaign,
      completedTurnSnapshotPrefix(adventureId),
    );
    if (snapshot === null) {
      throw new AIOrchestrationError(
        'COMPLETE_TURN_SNAPSHOT_NOT_FOUND',
        'Adventure has no complete turn snapshot to restore',
      );
    }
    this.snapshots.restore(snapshot.id);
    const adventure = this.requireAdventure(adventureId, campaign);
    const turn = this.adventures
      .listTurns(adventure.id)
      .find((candidate) => candidate.turnNumber === adventure.currentTurnNumber);
    if (turn === undefined || turn.playerAction === null || turn.resolvedAt === null) {
      throw new AIOrchestrationError(
        'COMPLETE_TURN_SNAPSHOT_INVALID',
        'Restored snapshot does not end at a complete adventure turn',
      );
    }
    return turn;
  }

  public async resolveAdventureTurn(command: ResolveAdventureTurnCommand): Promise<AdventureTurn> {
    const adventure = this.requireAdventure(command.adventureId, command.campaignId);
    const turn = this.requireTurn(command.turnId, adventure.id);
    if (turn.playerAction === null) {
      throw new AIOrchestrationError('TURN_INPUT_MISSING', 'Adventure turn has no player action');
    }
    if (this.snapshots.findLatest(command.campaignId, turnInputSnapshotReason(turn.id)) === null) {
      throw new AIOrchestrationError(
        'TURN_SNAPSHOT_MISSING',
        'Adventure turn cannot resolve without a pre-generation snapshot',
      );
    }
    if (turn.diceResult !== null) {
      if (adventure.state !== 'RESOLVING' || turn.checkRequest === null) {
        throw new AIOrchestrationError(
          'TURN_NOT_RESOLVABLE',
          'Dice narration requires a resolving check',
        );
      }
      await this.resolveDiceNarration(command, adventure, turn);
    } else {
      if (adventure.state !== 'WAITING_FOR_PLAYER') {
        throw new AIOrchestrationError(
          'TURN_NOT_RESOLVABLE',
          'Action resolution requires WAITING_FOR_PLAYER',
        );
      }
      await this.resolveAction(command, adventure, turn);
    }
    return this.requireTurn(turn.id, adventure.id);
  }

  public rollCheck(command: RollCheckCommand): AdventureTurn {
    const adventure = this.requireAdventure(command.adventureId, command.campaignId);
    const turn = this.requireTurn(command.turnId, adventure.id);
    const check = turn.checkRequest;
    if (adventure.state !== 'CHECK_REQUIRED' || check === null || turn.diceResult !== null) {
      throw new AIOrchestrationError('CHECK_NOT_READY', 'Turn has no unresolved check');
    }
    const character = this.characters.get(command.playerCharacterId);
    if (character === null || character.campaignId !== command.campaignId) {
      throw new AIOrchestrationError('CHARACTER_NOT_FOUND', 'Campaign player character not found');
    }
    const equipmentModifier = this.items
      .listOwned(character.id)
      .reduce(
        (sum, item) =>
          item.effect.kind === 'CHECK_MODIFIER' && item.effect.attribute === check.attribute
            ? sum + item.effect.modifier
            : sum,
        0,
      );
    const result = resolveD20Check(
      {
        checkRequestId: check.id,
        attributeValue: character.attributes[check.attribute],
        equipmentModifier,
        statusModifier: command.statusModifier,
        difficulty: check.difficulty,
      },
      this.random,
    );
    const timestamp = this.now();
    const resolving: Adventure = Object.freeze({
      ...adventure,
      state: transitionAdventureState(adventure.state, 'RESOLVING'),
      updatedAt: timestamp,
    });
    const rolled: AdventureTurn = Object.freeze({ ...turn, diceResult: result });
    const event: GameEvent = Object.freeze({
      id: this.identities.event(turn.id, 'DICE'),
      campaignId: command.campaignId,
      schemaVersion: schemaVersion(1),
      type: 'DICE_ROLLED',
      payload: Object.freeze({
        adventureId: adventure.id,
        turnId: turn.id,
        result,
      }),
      occurredAt: timestamp,
    });
    try {
      this.adventures.saveRoll(resolving, rolled, event);
    } catch (error) {
      throw new AIOrchestrationError('CHECK_COMMIT_FAILED', 'Dice result could not be saved', {
        cause: error,
      });
    }
    return this.requireTurn(turn.id, adventure.id);
  }

  private async resolveAction(
    command: ResolveAdventureTurnCommand,
    adventure: Adventure,
    turn: AdventureTurn,
  ): Promise<void> {
    const action = requireAction(turn);
    await this.orchestrator.execute({
      ...generation(command),
      turnId: turn.id,
      task: 'GENERATE_ADVENTURE_TURN',
      input: json({ action }),
      buildContext: () =>
        buildAdventureTurnContext(
          {
            world: this.requireWorld(command.campaignId),
            playerCharacter: this.requireCharacter(command.playerCharacterId, command.campaignId),
            quest: this.requireQuest(adventure.questId, command.campaignId),
            adventure,
            currentScene: turn.sceneText,
            turns: this.adventures.listTurns(adventure.id),
            clues: this.adventures.getClues(adventure.id),
            relatedNpcs: this.relatedNpcs(adventure.questId, command.campaignId),
            playerAction: actionText(action),
            longTermSummary: this.priorAdventureSummary(command.campaignId, adventure.id),
          },
          contextBudgetForTask('GENERATE_ADVENTURE_TURN'),
        ),
      validateDomainAndBuildCommit: (value) => this.actionCommit(command, adventure, turn, value),
    });
  }

  private priorAdventureSummary(
    campaignId: CampaignId,
    currentAdventureId: AdventureId,
  ): string | null {
    const budget = contextBudgetForTask('GENERATE_ADVENTURE_TURN');
    const summaries = this.adventures
      .listByCampaign(campaignId)
      .filter(({ id, state }) => id !== currentAdventureId && state === 'SETTLED')
      .reverse()
      .flatMap(({ id }) => {
        const ending = this.adventures.getEnding(id);
        return ending === null ? [] : [ending.summary];
      });
    const compressed = compressContextHistory(
      summaries,
      budget.recentTurnLimit,
      budget.historicalSummaryMaxCharacters,
    );
    return compressed.length === 0 ? null : compressed.join('\n');
  }

  private async resolveDiceNarration(
    command: ResolveAdventureTurnCommand,
    adventure: Adventure,
    turn: AdventureTurn,
  ): Promise<void> {
    const action = requireAction(turn);
    const check = turn.checkRequest;
    const result = turn.diceResult;
    if (check === null || result === null) {
      throw new AIOrchestrationError('CHECK_NOT_READY', 'Turn check result is missing');
    }
    const input = ResolveDiceResultInputSchema.parse({
      scene: turn.sceneText,
      action: actionText(action),
      attribute: check.attribute,
      difficulty: check.difficulty,
      total: result.total,
      success: result.success,
    });
    await this.orchestrator.execute({
      ...generation(command),
      turnId: turn.id,
      task: 'RESOLVE_DICE_RESULT',
      input: json(input),
      buildContext: () => input,
      validateDomainAndBuildCommit: (value) => this.diceCommit(command, adventure, turn, value),
    });
  }

  private actionCommit(
    command: ResolveAdventureTurnCommand,
    adventure: Adventure,
    turn: AdventureTurn,
    value: JsonValue,
  ): TurnCommit {
    const output = GenerateAdventureTurnOutputSchema.parse(value);
    const quest = this.requireQuest(adventure.questId, command.campaignId);
    const related = new Set(quest.relatedNpcIds);
    const speakerNpcIds = output.speakerNpcIds.map(npcId);
    if (speakerNpcIds.some((id) => !related.has(id))) {
      throw new AIOrchestrationError(
        'TURN_REFERENCE_INVALID',
        'Adventure turn references an unrelated NPC',
      );
    }
    if (
      (output.checkRequest === null && output.adventureState === 'CHECK_REQUIRED') ||
      (output.checkRequest !== null && output.adventureState !== 'CHECK_REQUIRED')
    ) {
      throw new AIOrchestrationError(
        'TURN_STATE_INVALID',
        'Check request and adventure state do not agree',
      );
    }
    const clues = updateDiscoveredClues(
      this.adventures.getClues(adventure.id),
      output.discoveredClues,
      turn.id,
    );
    const timestamp = this.now();
    const resolvedState =
      output.checkRequest === null
        ? transitionAdventureState(
            transitionAdventureState(adventure.state, 'RESOLVING'),
            output.adventureState === 'ENDING' ? 'ENDING' : 'SCENE',
          )
        : transitionAdventureState(adventure.state, 'CHECK_REQUIRED');
    const nextTurn: AdventureTurn = Object.freeze({
      ...turn,
      sceneText: output.sceneText,
      speakerNpcIds: Object.freeze(speakerNpcIds),
      suggestedActions: Object.freeze(
        output.suggestedActions.map(({ text }, index) =>
          Object.freeze({
            kind: 'SUGGESTED' as const,
            optionId: this.identities.option(turn.id, index),
            text,
          }),
        ),
      ),
      checkRequest:
        output.checkRequest === null
          ? null
          : Object.freeze({
              id: this.identities.check(turn.id),
              turnId: turn.id,
              ...output.checkRequest,
            }),
      resolvedAt: output.checkRequest === null ? timestamp : null,
    });
    return {
      campaignId: command.campaignId,
      adventure: Object.freeze({
        ...adventure,
        state: resolvedState,
        currentTurnNumber: turn.turnNumber,
        updatedAt: timestamp,
      }),
      turn: nextTurn,
      clues,
      statePatches: this.statePatches(command, output.statePatchProposals, 'ACTION', timestamp),
      events: [this.actionEvent(command.campaignId, adventure.id, nextTurn, timestamp)],
      ...(nextTurn.resolvedAt === null
        ? {}
        : { automaticSnapshot: this.completedSnapshot(command, adventure.id, turn.id, timestamp) }),
    };
  }

  private diceCommit(
    command: ResolveAdventureTurnCommand,
    adventure: Adventure,
    turn: AdventureTurn,
    value: JsonValue,
  ): TurnCommit {
    const output = ResolveDiceResultOutputSchema.parse(value);
    const timestamp = this.now();
    return {
      campaignId: command.campaignId,
      adventure: Object.freeze({
        ...adventure,
        state: transitionAdventureState(adventure.state, 'SCENE'),
        updatedAt: timestamp,
      }),
      turn: Object.freeze({
        ...turn,
        sceneText: `${turn.sceneText}\n\n${output.narration}\n${output.consequence}`,
        resolvedAt: timestamp,
      }),
      statePatches: this.statePatches(command, output.statePatchProposals, 'DICE', timestamp),
      events: [],
      automaticSnapshot: this.completedSnapshot(command, adventure.id, turn.id, timestamp),
    };
  }

  private completedSnapshot(
    command: ResolveAdventureTurnCommand,
    adventureId: AdventureId,
    turnId: TurnId,
    createdAt: IsoTimestamp,
  ): CreateSnapshot {
    return {
      id: this.identities.completedSnapshot(command.requestId),
      campaignId: command.campaignId,
      kind: 'AUTO',
      reason: completedTurnSnapshotReason(adventureId, turnId),
      schemaVersion: schemaVersion(1),
      createdAt,
    };
  }

  private statePatches(
    command: ResolveAdventureTurnCommand,
    proposals: readonly unknown[],
    phase: 'ACTION' | 'DICE',
    at: IsoTimestamp,
  ): readonly TurnStatePatch[] {
    const quest = this.requireQuest(
      this.requireAdventure(command.adventureId, command.campaignId).questId,
      command.campaignId,
    );
    const validated = validateDomainStatePatches(proposals, {
      campaignId: command.campaignId,
      world: this.requireWorld(command.campaignId),
      quests: [quest],
      relationships: quest.relatedNpcIds.flatMap((id) => {
        const relationship = this.npcs.getRelationship(id);
        return relationship === null ? [] : [relationship];
      }),
      clocks: this.clocks.list(command.campaignId),
      rewardAuthorizations: [],
    });
    return Object.freeze(
      validated.map((patch, index) => this.toStatePatch(command, patch, phase, index, at)),
    );
  }

  private toStatePatch(
    command: ResolveAdventureTurnCommand,
    patch: ValidatedDomainPatch,
    phase: 'ACTION' | 'DICE',
    index: number,
    at: IsoTimestamp,
  ): TurnStatePatch {
    switch (patch.kind) {
      case 'QUEST':
        return { kind: 'QUEST', quest: { ...patch.quest, updatedAt: at } };
      case 'RELATIONSHIP':
        return { kind: 'NPC_RELATIONSHIP', relationship: patch.relationship, updatedAt: at };
      case 'FACT':
        return {
          kind: 'WORLD_FACT',
          fact: {
            id: this.identities.fact(command.turnId, phase, index),
            campaignId: command.campaignId,
            kind: patch.factKind,
            statement: patch.statement,
            locationId: null,
            factionIds: [],
            supersedesFactId: null,
            createdAt: at,
          },
        };
      case 'ITEM_REWARD':
      case 'CLOCK':
        throw new AIOrchestrationError(
          'TURN_PATCH_DEFERRED',
          'Reward and clock patches are resolved during adventure settlement',
        );
    }
  }

  private actionEvent(
    campaignId: CampaignId,
    adventureId: AdventureId,
    turn: AdventureTurn,
    at: IsoTimestamp,
  ): GameEvent {
    return Object.freeze({
      id: this.identities.event(turn.id, 'ACTION'),
      campaignId,
      schemaVersion: schemaVersion(1),
      type: 'PLAYER_ACTION_SUBMITTED',
      payload: Object.freeze({
        adventureId,
        turnId: turn.id,
        action: requireAction(turn),
      }),
      occurredAt: at,
    });
  }

  private relatedNpcs(questIdValue: Adventure['questId'], campaignId: CampaignId) {
    return this.requireQuest(questIdValue, campaignId).relatedNpcIds.map((id) => {
      const npc = this.npcs.get(id);
      if (npc === null || npc.campaignId !== campaignId) {
        throw new AIOrchestrationError('NPC_NOT_FOUND', 'Related campaign NPC not found');
      }
      return npc;
    });
  }

  private requireAdventure(id: AdventureId, campaignId: CampaignId): Adventure {
    const adventure = this.adventures.get(id);
    if (adventure === null || adventure.campaignId !== campaignId) {
      throw new AIOrchestrationError('ADVENTURE_NOT_FOUND', 'Campaign adventure not found');
    }
    return adventure;
  }

  private requireTurn(id: TurnId, adventureId: AdventureId): AdventureTurn {
    const turn = this.adventures.getTurn(id);
    if (turn === null || turn.adventureId !== adventureId) {
      throw new AIOrchestrationError('TURN_NOT_FOUND', 'Adventure turn not found');
    }
    return turn;
  }

  private requireWorld(campaignId: CampaignId) {
    const world = this.worlds.getBible(campaignId);
    if (world === null) throw new AIOrchestrationError('WORLD_NOT_FOUND', 'World not found');
    return world;
  }

  private requireQuest(id: Adventure['questId'], campaignId: CampaignId) {
    const quest = this.quests.get(id);
    if (quest === null || quest.campaignId !== campaignId) {
      throw new AIOrchestrationError('QUEST_NOT_FOUND', 'Campaign quest not found');
    }
    return quest;
  }

  private requireCharacter(id: PlayerCharacterId, campaignId: CampaignId) {
    const character = this.characters.get(id);
    if (character === null || character.campaignId !== campaignId) {
      throw new AIOrchestrationError('CHARACTER_NOT_FOUND', 'Campaign player character not found');
    }
    return character;
  }
}

export function turnInputSnapshotReason(turn: TurnId): string {
  return `TURN_INPUT:${turn}`;
}

export function completedTurnSnapshotReason(adventure: AdventureId, turn: TurnId): string {
  return `${completedTurnSnapshotPrefix(adventure)}${turn}`;
}

function completedTurnSnapshotPrefix(adventure: AdventureId): string {
  return `AFTER_COMPLETE_TURN:${adventure}:`;
}

function generation(command: ResolveAdventureTurnCommand) {
  return {
    operationId: aiOperationId(command.idempotencyKey),
    requestId: command.requestId,
    generationRecordId: command.generationRecordId,
    campaignId: command.campaignId,
    idempotencyKey: command.idempotencyKey,
    modelProfileId: command.modelProfileId,
    modelName: command.modelName,
    generationOptions: command.generationOptions,
  };
}

function requireAction(turn: AdventureTurn): PlayerAction {
  if (turn.playerAction === null) {
    throw new AIOrchestrationError('TURN_INPUT_MISSING', 'Adventure turn has no player action');
  }
  return turn.playerAction;
}

function actionText(action: PlayerAction): string {
  switch (action.kind) {
    case 'SUGGESTED':
    case 'FREEFORM':
      return action.text;
    case 'USE_ITEM':
      return action.intent;
    case 'EXIT_ADVENTURE':
      return action.reason;
  }
}

function updateDiscoveredClues(
  clues: readonly Clue[],
  titles: readonly string[],
  turnIdValue: TurnId,
) {
  const requested = new Set(titles);
  for (const title of requested) {
    if (!clues.some((clue) => clue.title === title)) {
      throw new AIOrchestrationError(
        'TURN_REFERENCE_INVALID',
        'Adventure turn references an unknown clue',
      );
    }
  }
  return Object.freeze(
    clues.map((clue) =>
      requested.has(clue.title) && clue.discoveredInTurnId === null
        ? Object.freeze({ ...clue, discoveredInTurnId: turnIdValue })
        : clue,
    ),
  );
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

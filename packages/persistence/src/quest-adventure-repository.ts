import {
  ADVENTURE_STATES,
  CHARACTER_ATTRIBUTE_NAMES,
  QUEST_STATUSES,
  actionOptionId,
  adventureId,
  campaignId,
  checkRequestId,
  clueId,
  generationRecordId,
  isoTimestamp,
  itemId,
  npcId,
  questId,
  tavernChangeId,
  turnId,
  worldFactId,
  transitionAdventureState,
  transitionCampaign,
  type Adventure,
  type AdventureEnding,
  type AdventurePlan,
  type AdventureTurn,
  type CheckDifficulty,
  type CheckRequest,
  type Clue,
  type DiceResult,
  type GameEvent,
  type PlayerAction,
  type Quest,
} from '@ember-tavern/contracts';

import { CampaignRepository, PersistenceDataError } from './campaign-repository.js';
import { parseStoredDiceResult } from './dice-result-validation.js';
import { GameEventRepository } from './game-event-repository.js';
import {
  parseJson,
  requireArray,
  requireBoolean,
  requireEnum,
  requireNullableString,
  requireNumber,
  requireRecord,
  requireString,
  requireStringArray,
} from './persistence-validation.js';
import type {
  SqliteDatabase,
  SqliteRunResult,
  TransactionalSqliteDatabase,
} from './sqlite-port.js';

const QUEST_RISKS = ['LOW', 'MODERATE', 'HIGH', 'EXTREME'] as const;
const REWARD_TIERS = ['BASIC', 'NOTABLE', 'RARE', 'LEGENDARY'] as const;
const ADVENTURE_OUTCOMES = ['SUCCESS', 'PARTIAL_SUCCESS', 'FAILURE'] as const;
const CHECK_DIFFICULTIES = [8, 11, 14, 17] as const;

export class QuestRepository {
  public constructor(private readonly database: SqliteDatabase) {}

  public create(quest: Quest): void {
    this.database
      .prepare(
        `INSERT INTO quests (
           id, campaign_id, publisher_npc_id, content_json, status, risk,
           recommended_attributes_json, expected_turns_min, expected_turns_max,
           reward_tier, related_npc_ids_json, related_fact_ids_json, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(...questValues(quest));
  }

  public get(id: Quest['id']): Quest | null {
    const row = this.database.prepare('SELECT * FROM quests WHERE id = ?').get(id);
    return row === undefined ? null : mapQuest(row);
  }

  public listByCampaign(id: Quest['campaignId']): readonly Quest[] {
    return Object.freeze(
      this.database
        .prepare(
          `SELECT * FROM quests
           WHERE campaign_id = ?
           ORDER BY created_at, id`,
        )
        .all(id)
        .map(mapQuest),
    );
  }

  public acceptAsOnlyMain(
    id: Quest['id'],
    campaign: Quest['campaignId'],
    at: Quest['updatedAt'],
  ): Quest {
    const database = requireTransactional(this.database);
    database.exec('BEGIN IMMEDIATE');
    try {
      const quest = this.get(id);
      if (quest === null || quest.campaignId !== campaign) {
        throw new PersistenceDataError(`Quest not found in campaign: ${id}`);
      }
      if (quest.status !== 'AVAILABLE') {
        throw new PersistenceDataError(`Only AVAILABLE quests can be accepted: ${id}`);
      }
      const active = database
        .prepare(
          `SELECT id FROM quests
           WHERE campaign_id = ? AND status IN ('ACCEPTED', 'ACTIVE')
           LIMIT 1`,
        )
        .get(campaign);
      if (active !== undefined) {
        throw new PersistenceDataError('Campaign already has an accepted or active main quest');
      }
      one(
        database
          .prepare(
            `UPDATE quests
             SET status = 'ACCEPTED', updated_at = ?
             WHERE id = ? AND campaign_id = ? AND status = 'AVAILABLE'`,
          )
          .run(at, id, campaign),
        `Quest changed while being accepted: ${id}`,
      );
      database.exec('COMMIT');
      const accepted = this.get(id);
      if (accepted === null) throw new PersistenceDataError(`Accepted quest not found: ${id}`);
      return accepted;
    } catch (error) {
      try {
        database.exec('ROLLBACK');
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          'Quest acceptance and rollback both failed',
          { cause: rollbackError },
        );
      }
      throw error;
    }
  }

  public update(quest: Quest): void {
    const current = this.get(quest.id);
    if (current === null) throw new PersistenceDataError(`Quest not found: ${quest.id}`);
    if (
      current.campaignId !== quest.campaignId ||
      current.publisherNpcId !== quest.publisherNpcId ||
      current.createdAt !== quest.createdAt
    ) {
      throw new PersistenceDataError(
        'Quest campaignId, publisherNpcId and createdAt cannot change',
      );
    }
    one(
      this.database
        .prepare(
          `UPDATE quests SET
             content_json = ?, status = ?, risk = ?, recommended_attributes_json = ?,
             expected_turns_min = ?, expected_turns_max = ?, reward_tier = ?,
             related_npc_ids_json = ?, related_fact_ids_json = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(
          JSON.stringify(quest.content),
          quest.status,
          quest.risk,
          JSON.stringify(quest.recommendedAttributes),
          quest.expectedTurns.min,
          quest.expectedTurns.max,
          quest.rewardTier,
          JSON.stringify(quest.relatedNpcIds),
          JSON.stringify(quest.relatedFactIds),
          quest.updatedAt,
          quest.id,
        ),
      `Quest not found: ${quest.id}`,
    );
  }
}

export class AdventureRepository {
  public constructor(private readonly database: SqliteDatabase) {}

  public create(adventure: Adventure, clues: readonly Clue[] = []): void {
    this.database
      .prepare(
        `INSERT INTO adventures (
           id, campaign_id, quest_id, state, plan_json, current_turn_number,
           clues_json, ending_json, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
      )
      .run(
        adventure.id,
        adventure.campaignId,
        adventure.questId,
        adventure.state,
        JSON.stringify(adventure.plan),
        adventure.currentTurnNumber,
        JSON.stringify(clues),
        adventure.createdAt,
        adventure.updatedAt,
      );
  }

  public get(id: Adventure['id']): Adventure | null {
    const row = this.database.prepare('SELECT * FROM adventures WHERE id = ?').get(id);
    return row === undefined ? null : mapAdventure(row);
  }

  public listByCampaign(id: Adventure['campaignId']): readonly Adventure[] {
    return Object.freeze(
      this.database
        .prepare(
          `SELECT * FROM adventures
           WHERE campaign_id = ?
           ORDER BY updated_at DESC, id`,
        )
        .all(id)
        .map(mapAdventure),
    );
  }

  public startPrepared(
    id: Adventure['id'],
    campaignIdValue: Adventure['campaignId'],
    at: Adventure['updatedAt'],
  ): Adventure {
    const database = requireTransactional(this.database);
    database.exec('BEGIN IMMEDIATE');
    try {
      const adventure = this.get(id);
      if (
        adventure === null ||
        adventure.campaignId !== campaignIdValue ||
        adventure.state !== 'PREPARING'
      ) {
        throw new PersistenceDataError(`Prepared adventure not found: ${id}`);
      }
      const quests = new QuestRepository(database);
      const quest = quests.get(adventure.questId);
      if (quest === null || quest.campaignId !== campaignIdValue || quest.status !== 'ACCEPTED') {
        throw new PersistenceDataError('Adventure requires its accepted quest');
      }
      const campaigns = new CampaignRepository(database);
      const campaign = campaigns.get(campaignIdValue);
      if (campaign === null || campaign.state !== 'TAVERN') {
        throw new PersistenceDataError('Adventure can only start from TAVERN state');
      }
      const started = Object.freeze({
        ...adventure,
        state: transitionAdventureState(adventure.state, 'SCENE'),
        updatedAt: at,
      });
      this.update(started);
      quests.update(Object.freeze({ ...quest, status: 'ACTIVE', updatedAt: at }));
      campaigns.update(transitionCampaign(campaign, 'ADVENTURE', at));
      database.exec('COMMIT');
      return started;
    } catch (error) {
      try {
        database.exec('ROLLBACK');
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          'Adventure start and rollback both failed',
          { cause: rollbackError },
        );
      }
      throw error;
    }
  }

  public submitAction(adventure: Adventure, turn: AdventureTurn): void {
    const database = requireTransactional(this.database);
    database.exec('BEGIN IMMEDIATE');
    try {
      const current = this.get(adventure.id);
      const unresolvedTurn = database
        .prepare(
          `SELECT id FROM adventure_turns
           WHERE adventure_id = ? AND resolved_at IS NULL
           LIMIT 1`,
        )
        .get(adventure.id);
      if (
        current === null ||
        unresolvedTurn !== undefined ||
        current.campaignId !== adventure.campaignId ||
        current.questId !== adventure.questId ||
        !['SCENE', 'WAITING_FOR_PLAYER'].includes(current.state) ||
        adventure.state !== 'WAITING_FOR_PLAYER' ||
        turn.adventureId !== adventure.id ||
        turn.turnNumber !== current.currentTurnNumber + 1 ||
        turn.playerAction === null ||
        turn.checkRequest !== null ||
        turn.diceResult !== null ||
        turn.resolvedAt !== null
      ) {
        throw new PersistenceDataError('Player action submission is not valid for this adventure');
      }
      this.update(adventure);
      this.addTurn(turn);
      database.exec('COMMIT');
    } catch (error) {
      rollback(database, error, 'Player action submission and rollback both failed');
    }
  }

  public saveRoll(adventure: Adventure, turn: AdventureTurn, event: GameEvent): void {
    const database = requireTransactional(this.database);
    database.exec('BEGIN IMMEDIATE');
    try {
      const currentAdventure = this.get(adventure.id);
      const currentTurn = this.getTurn(turn.id);
      if (
        currentAdventure === null ||
        currentTurn === null ||
        currentAdventure.state !== 'CHECK_REQUIRED' ||
        adventure.state !== 'RESOLVING' ||
        currentTurn.checkRequest === null ||
        currentTurn.diceResult !== null ||
        turn.checkRequest?.id !== currentTurn.checkRequest.id ||
        turn.diceResult?.checkRequestId !== currentTurn.checkRequest.id
      ) {
        throw new PersistenceDataError('Dice result is not valid for the pending check');
      }
      this.update(adventure);
      this.saveTurn(turn);
      if (
        event.type !== 'DICE_ROLLED' ||
        event.campaignId !== adventure.campaignId ||
        event.payload.adventureId !== adventure.id ||
        event.payload.turnId !== turn.id ||
        JSON.stringify(event.payload.result) !== JSON.stringify(turn.diceResult)
      ) {
        throw new PersistenceDataError('Dice event does not match the saved result');
      }
      new GameEventRepository(database).append(event);
      database.exec('COMMIT');
    } catch (error) {
      rollback(database, error, 'Dice result commit and rollback both failed');
    }
  }

  public update(adventure: Adventure): void {
    one(
      this.database
        .prepare(
          `UPDATE adventures SET
             state = ?, plan_json = ?, current_turn_number = ?, updated_at = ?
           WHERE id = ? AND campaign_id = ? AND quest_id = ? AND created_at = ?`,
        )
        .run(
          adventure.state,
          JSON.stringify(adventure.plan),
          adventure.currentTurnNumber,
          adventure.updatedAt,
          adventure.id,
          adventure.campaignId,
          adventure.questId,
          adventure.createdAt,
        ),
      `Adventure identity changed or record not found: ${adventure.id}`,
    );
  }

  public saveClues(id: Adventure['id'], clues: readonly Clue[]): void {
    one(
      this.database
        .prepare('UPDATE adventures SET clues_json = ? WHERE id = ?')
        .run(JSON.stringify(clues), id),
      `Adventure not found: ${id}`,
    );
  }

  public getClues(id: Adventure['id']): readonly Clue[] {
    const row = this.database.prepare('SELECT clues_json FROM adventures WHERE id = ?').get(id);
    if (row === undefined) return Object.freeze([]);
    return parseClues(
      parseJson(requireRecord(row, 'Adventure clues row')['clues_json'], 'clues_json'),
    );
  }

  public saveEnding(ending: AdventureEnding): void {
    one(
      this.database
        .prepare(
          `UPDATE adventures
           SET ending_json = ?, state = 'SETTLED', updated_at = ?
           WHERE id = ?`,
        )
        .run(JSON.stringify(ending), ending.completedAt, ending.adventureId),
      `Adventure not found: ${ending.adventureId}`,
    );
  }

  public getEnding(id: Adventure['id']): AdventureEnding | null {
    const row = this.database.prepare('SELECT ending_json FROM adventures WHERE id = ?').get(id);
    if (row === undefined) return null;
    const value = requireRecord(row, 'Adventure ending row')['ending_json'];
    return value === null ? null : parseEnding(parseJson(value, 'ending_json'));
  }

  public addTurn(turn: AdventureTurn): void {
    this.database
      .prepare(
        `INSERT INTO adventure_turns (
           id, adventure_id, turn_number, scene_text, speaker_npc_ids_json,
           suggested_actions_json, player_action_json, check_request_json,
           dice_result_json, created_at, resolved_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        turn.id,
        turn.adventureId,
        turn.turnNumber,
        turn.sceneText,
        JSON.stringify(turn.speakerNpcIds),
        JSON.stringify(turn.suggestedActions),
        turn.playerAction === null ? null : JSON.stringify(turn.playerAction),
        turn.checkRequest === null ? null : JSON.stringify(turn.checkRequest),
        turn.diceResult === null ? null : JSON.stringify(turn.diceResult),
        turn.createdAt,
        turn.resolvedAt,
      );
  }

  public saveTurn(turn: AdventureTurn): void {
    const current = this.getTurn(turn.id);
    if (current === null) {
      this.addTurn(turn);
      return;
    }
    if (
      current.adventureId !== turn.adventureId ||
      current.turnNumber !== turn.turnNumber ||
      current.createdAt !== turn.createdAt
    ) {
      throw new PersistenceDataError(
        `AdventureTurn identity changed or record not found: ${turn.id}`,
      );
    }
    one(
      this.database
        .prepare(
          `UPDATE adventure_turns SET
             scene_text = ?, speaker_npc_ids_json = ?, suggested_actions_json = ?,
             player_action_json = ?, check_request_json = ?, dice_result_json = ?,
             resolved_at = ?
           WHERE id = ?`,
        )
        .run(
          turn.sceneText,
          JSON.stringify(turn.speakerNpcIds),
          JSON.stringify(turn.suggestedActions),
          turn.playerAction === null ? null : JSON.stringify(turn.playerAction),
          turn.checkRequest === null ? null : JSON.stringify(turn.checkRequest),
          turn.diceResult === null ? null : JSON.stringify(turn.diceResult),
          turn.resolvedAt,
          turn.id,
        ),
      `AdventureTurn not found: ${turn.id}`,
    );
  }

  public getTurn(id: AdventureTurn['id']): AdventureTurn | null {
    const row = this.database.prepare('SELECT * FROM adventure_turns WHERE id = ?').get(id);
    return row === undefined ? null : mapTurn(row);
  }

  public listTurns(id: Adventure['id']): readonly AdventureTurn[] {
    return Object.freeze(
      this.database
        .prepare(
          `SELECT * FROM adventure_turns
           WHERE adventure_id = ?
           ORDER BY turn_number`,
        )
        .all(id)
        .map(mapTurn),
    );
  }
}

function questValues(quest: Quest) {
  return [
    quest.id,
    quest.campaignId,
    quest.publisherNpcId,
    JSON.stringify(quest.content),
    quest.status,
    quest.risk,
    JSON.stringify(quest.recommendedAttributes),
    quest.expectedTurns.min,
    quest.expectedTurns.max,
    quest.rewardTier,
    JSON.stringify(quest.relatedNpcIds),
    JSON.stringify(quest.relatedFactIds),
    quest.createdAt,
    quest.updatedAt,
  ] as const;
}

function mapQuest(value: unknown): Quest {
  const row = requireRecord(value, 'Quest row');
  const content = requireRecord(parseJson(row['content_json'], 'content_json'), 'content');
  return Object.freeze({
    id: questId(requireString(row['id'], 'id')),
    campaignId: campaignId(requireString(row['campaign_id'], 'campaign_id')),
    publisherNpcId: npcId(requireString(row['publisher_npc_id'], 'publisher_npc_id')),
    content: Object.freeze({
      title: requireString(content['title'], 'content.title'),
      summary: requireString(content['summary'], 'content.summary'),
      objective: requireString(content['objective'], 'content.objective'),
      failureCost: requireString(content['failureCost'], 'content.failureCost'),
    }),
    status: requireEnum(QUEST_STATUSES, row['status'], 'status'),
    risk: requireEnum(QUEST_RISKS, row['risk'], 'risk'),
    recommendedAttributes: Object.freeze(
      requireArray(
        parseJson(row['recommended_attributes_json'], 'recommended_attributes_json'),
        'recommendedAttributes',
      ).map((entry, index) =>
        requireEnum(CHARACTER_ATTRIBUTE_NAMES, entry, `recommendedAttributes[${index}]`),
      ),
    ),
    expectedTurns: Object.freeze({
      min: requireNumber(row['expected_turns_min'], 'expected_turns_min'),
      max: requireNumber(row['expected_turns_max'], 'expected_turns_max'),
    }),
    rewardTier: requireEnum(REWARD_TIERS, row['reward_tier'], 'reward_tier'),
    relatedNpcIds: Object.freeze(
      requireArray(parseJson(row['related_npc_ids_json'], 'related_npc_ids_json'), 'npcIds').map(
        (id, index) => npcId(requireString(id, `npcIds[${index}]`)),
      ),
    ),
    relatedFactIds: Object.freeze(
      requireArray(parseJson(row['related_fact_ids_json'], 'related_fact_ids_json'), 'factIds').map(
        (id, index) => worldFactId(requireString(id, `factIds[${index}]`)),
      ),
    ),
    createdAt: isoTimestamp(requireString(row['created_at'], 'created_at')),
    updatedAt: isoTimestamp(requireString(row['updated_at'], 'updated_at')),
  });
}

function mapAdventure(value: unknown): Adventure {
  const row = requireRecord(value, 'Adventure row');
  return Object.freeze({
    id: adventureId(requireString(row['id'], 'id')),
    campaignId: campaignId(requireString(row['campaign_id'], 'campaign_id')),
    questId: questId(requireString(row['quest_id'], 'quest_id')),
    state: requireEnum(ADVENTURE_STATES, row['state'], 'state'),
    plan: parsePlan(parseJson(row['plan_json'], 'plan_json')),
    currentTurnNumber: requireNumber(row['current_turn_number'], 'current_turn_number'),
    createdAt: isoTimestamp(requireString(row['created_at'], 'created_at')),
    updatedAt: isoTimestamp(requireString(row['updated_at'], 'updated_at')),
  });
}

function parsePlan(value: unknown): AdventurePlan {
  const row = requireRecord(value, 'AdventurePlan');
  const expected = requireRecord(row['expectedTurns'], 'AdventurePlan.expectedTurns');
  return Object.freeze({
    adventureId: adventureId(requireString(row['adventureId'], 'AdventurePlan.adventureId')),
    objective: requireString(row['objective'], 'AdventurePlan.objective'),
    risk: requireEnum(QUEST_RISKS, row['risk'], 'AdventurePlan.risk'),
    expectedTurns: Object.freeze({
      min: requireNumber(expected['min'], 'AdventurePlan.expectedTurns.min'),
      max: requireNumber(expected['max'], 'AdventurePlan.expectedTurns.max'),
    }),
    coreScenes: requireStringArray(row['coreScenes'], 'AdventurePlan.coreScenes'),
    necessaryClueIds: Object.freeze(
      requireArray(row['necessaryClueIds'], 'AdventurePlan.necessaryClueIds').map((id, index) =>
        clueId(requireString(id, `AdventurePlan.necessaryClueIds[${index}]`)),
      ),
    ),
    majorObstacles: requireStringArray(row['majorObstacles'], 'AdventurePlan.majorObstacles'),
    possibleEndings: requireStringArray(row['possibleEndings'], 'AdventurePlan.possibleEndings'),
    failureCost: requireString(row['failureCost'], 'AdventurePlan.failureCost'),
  });
}

function mapTurn(value: unknown): AdventureTurn {
  const row = requireRecord(value, 'AdventureTurn row');
  return Object.freeze({
    id: turnId(requireString(row['id'], 'id')),
    adventureId: adventureId(requireString(row['adventure_id'], 'adventure_id')),
    turnNumber: requireNumber(row['turn_number'], 'turn_number'),
    sceneText: requireString(row['scene_text'], 'scene_text'),
    speakerNpcIds: Object.freeze(
      requireArray(
        parseJson(row['speaker_npc_ids_json'], 'speaker_npc_ids_json'),
        'speakerNpcIds',
      ).map((id, index) => npcId(requireString(id, `speakerNpcIds[${index}]`))),
    ),
    suggestedActions: Object.freeze(
      requireArray(
        parseJson(row['suggested_actions_json'], 'suggested_actions_json'),
        'suggestedActions',
      ).map(parseSuggestedAction),
    ),
    playerAction: nullableJson(row['player_action_json'], 'player_action_json', parsePlayerAction),
    checkRequest: nullableJson(row['check_request_json'], 'check_request_json', parseCheckRequest),
    diceResult: nullableJson(row['dice_result_json'], 'dice_result_json', parseDiceResult),
    createdAt: isoTimestamp(requireString(row['created_at'], 'created_at')),
    resolvedAt: nullableTimestamp(row['resolved_at'], 'resolved_at'),
  });
}

function parseSuggestedAction(value: unknown, index: number) {
  const action = parsePlayerAction(value);
  if (action.kind !== 'SUGGESTED') {
    throw new PersistenceDataError(`suggestedActions[${index}] must be SUGGESTED`);
  }
  return action;
}

function parsePlayerAction(value: unknown): PlayerAction {
  const row = requireRecord(value, 'PlayerAction');
  const kind = requireEnum(
    ['SUGGESTED', 'FREEFORM', 'USE_ITEM', 'EXIT_ADVENTURE'] as const,
    row['kind'],
    'PlayerAction.kind',
  );
  const mode =
    row['mode'] === undefined
      ? Object.freeze({})
      : Object.freeze({
          mode: requireEnum(
            ['ACTION', 'DIALOGUE', 'OBSERVE'] as const,
            row['mode'],
            'PlayerAction.mode',
          ),
        });
  switch (kind) {
    case 'SUGGESTED':
      return Object.freeze({
        kind,
        ...mode,
        optionId: actionOptionId(requireString(row['optionId'], 'PlayerAction.optionId')),
        text: requireString(row['text'], 'PlayerAction.text'),
      });
    case 'FREEFORM':
      return Object.freeze({
        kind,
        ...mode,
        text: requireString(row['text'], 'PlayerAction.text'),
      });
    case 'USE_ITEM':
      return Object.freeze({
        kind,
        ...mode,
        itemId: itemId(requireString(row['itemId'], 'PlayerAction.itemId')),
        intent: requireString(row['intent'], 'PlayerAction.intent'),
      });
    case 'EXIT_ADVENTURE':
      return Object.freeze({
        kind,
        ...mode,
        reason: requireString(row['reason'], 'PlayerAction.reason'),
      });
  }
}

function parseCheckRequest(value: unknown): CheckRequest {
  const row = requireRecord(value, 'CheckRequest');
  return Object.freeze({
    id: checkRequestId(requireString(row['id'], 'CheckRequest.id')),
    turnId: turnId(requireString(row['turnId'], 'CheckRequest.turnId')),
    attribute: requireEnum(CHARACTER_ATTRIBUTE_NAMES, row['attribute'], 'CheckRequest.attribute'),
    difficulty: requireDifficulty(row['difficulty']),
    reason: requireString(row['reason'], 'CheckRequest.reason'),
  });
}

function parseDiceResult(value: unknown): DiceResult {
  return parseStoredDiceResult(value);
}

function parseClues(value: unknown): readonly Clue[] {
  return Object.freeze(
    requireArray(value, 'clues').map((entry, index) => {
      const row = requireRecord(entry, `clues[${index}]`);
      const discovered = requireNullableString(
        row['discoveredInTurnId'],
        `clues[${index}].discoveredInTurnId`,
      );
      return Object.freeze({
        id: clueId(requireString(row['id'], `clues[${index}].id`)),
        adventureId: adventureId(requireString(row['adventureId'], `clues[${index}].adventureId`)),
        title: requireString(row['title'], `clues[${index}].title`),
        description: requireString(row['description'], `clues[${index}].description`),
        isCore: requireBoolean(row['isCore'], `clues[${index}].isCore`),
        discoveredInTurnId: discovered === null ? null : turnId(discovered),
      });
    }),
  );
}

function parseEnding(value: unknown): AdventureEnding {
  const row = requireRecord(value, 'AdventureEnding');
  return Object.freeze({
    adventureId: adventureId(requireString(row['adventureId'], 'AdventureEnding.adventureId')),
    outcome: requireEnum(ADVENTURE_OUTCOMES, row['outcome'], 'AdventureEnding.outcome'),
    summary: requireString(row['summary'], 'AdventureEnding.summary'),
    keyDecisions: requireStringArray(row['keyDecisions'], 'AdventureEnding.keyDecisions'),
    unresolvedThreads: requireStringArray(
      row['unresolvedThreads'],
      'AdventureEnding.unresolvedThreads',
    ),
    nextDirections: requireStringArray(row['nextDirections'], 'AdventureEnding.nextDirections'),
    unresolvedClueIds: Object.freeze(
      requireArray(row['unresolvedClueIds'], 'AdventureEnding.unresolvedClueIds').map((id, index) =>
        clueId(requireString(id, `AdventureEnding.unresolvedClueIds[${index}]`)),
      ),
    ),
    participantNpcIds: Object.freeze(
      requireArray(row['participantNpcIds'], 'AdventureEnding.participantNpcIds').map((id, index) =>
        npcId(requireString(id, `AdventureEnding.participantNpcIds[${index}]`)),
      ),
    ),
    acquiredItemIds: Object.freeze(
      requireArray(row['acquiredItemIds'], 'AdventureEnding.acquiredItemIds').map((id, index) =>
        itemId(requireString(id, `AdventureEnding.acquiredItemIds[${index}]`)),
      ),
    ),
    worldFactIds: Object.freeze(
      requireArray(row['worldFactIds'], 'AdventureEnding.worldFactIds').map((id, index) =>
        worldFactId(requireString(id, `AdventureEnding.worldFactIds[${index}]`)),
      ),
    ),
    tavernChangeId: tavernChangeId(
      requireString(row['tavernChangeId'], 'AdventureEnding.tavernChangeId'),
    ),
    summaryGenerationRecordId: generationRecordId(
      requireString(row['summaryGenerationRecordId'], 'AdventureEnding.summaryGenerationRecordId'),
    ),
    worldEventGenerationRecordId: generationRecordId(
      requireString(
        row['worldEventGenerationRecordId'],
        'AdventureEnding.worldEventGenerationRecordId',
      ),
    ),
    completedAt: isoTimestamp(requireString(row['completedAt'], 'AdventureEnding.completedAt')),
  });
}

function nullableJson<T>(value: unknown, label: string, parser: (input: unknown) => T): T | null {
  return value === null ? null : parser(parseJson(value, label));
}

function nullableTimestamp(value: unknown, label: string) {
  const text = requireNullableString(value, label);
  return text === null ? null : isoTimestamp(text);
}

function requireDifficulty(value: unknown): CheckDifficulty {
  const number = requireNumber(value, 'difficulty');
  if (!(CHECK_DIFFICULTIES as readonly number[]).includes(number)) {
    throw new PersistenceDataError(`Unknown check difficulty: ${number}`);
  }
  return number as CheckDifficulty;
}

function one(result: SqliteRunResult, message: string): void {
  if (result.changes !== 1 && result.changes !== 1n) {
    throw new PersistenceDataError(message);
  }
}

function requireTransactional(database: SqliteDatabase): TransactionalSqliteDatabase {
  if ('exec' in database && typeof database.exec === 'function') {
    return database as TransactionalSqliteDatabase;
  }
  throw new PersistenceDataError('Quest acceptance requires a transactional SQLite database');
}

function rollback(database: TransactionalSqliteDatabase, error: unknown, message: string): never {
  try {
    database.exec('ROLLBACK');
  } catch (rollbackError) {
    throw new AggregateError([error, rollbackError], message, { cause: rollbackError });
  }
  throw error;
}

import {
  WorldDirectorContractError,
  type WorldDirectorActionKind,
  type WorldDirectorPace,
  type WorldDirectorProposal,
  type WorldDirectorSignals,
  type WorldDirectorSuppression,
} from '@ember-tavern/contracts';

const OPEN_STATUSES = new Set([
  'HIDDEN',
  'DISCOVERED',
  'AVAILABLE',
  'ACCEPTED',
  'ACTIVE',
  'BLOCKED',
  'UPDATED',
]);
const EXPIRABLE_STATUSES = new Set(['DISCOVERED', 'AVAILABLE', 'BLOCKED']);
const MAX_PROPOSALS = 8;

export interface WorldDirectorQuestInput {
  readonly id: string;
  readonly status: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly worldClockAdvancesSinceCreation: number;
}

export interface WorldDirectorClockInput {
  readonly id: string;
  readonly current: number;
  readonly max: number;
}

export interface WorldDirectorFactionInput {
  readonly id: string;
  readonly materialization: string;
  readonly playerRelation: string;
  readonly currentAction: string | null;
}

export interface WorldDirectorTransitionInput {
  readonly toStatus: string;
  readonly occurredAt: string;
}

export interface WorldDirectorEventInput {
  readonly id: string;
  readonly type: string;
  readonly occurredAt: string;
}

export interface EvaluateWorldDirectorInput {
  readonly campaignId: string;
  readonly campaignState: string;
  readonly currentLocationId: string;
  readonly quests: readonly WorldDirectorQuestInput[];
  readonly clocks: readonly WorldDirectorClockInput[];
  readonly factions: readonly WorldDirectorFactionInput[];
  readonly recentTransitions: readonly WorldDirectorTransitionInput[];
  readonly recentEvents: readonly WorldDirectorEventInput[];
}

export interface WorldDirectorEvaluation {
  readonly pace: WorldDirectorPace;
  readonly pressureScore: number;
  readonly signals: WorldDirectorSignals;
  readonly proposals: readonly WorldDirectorProposal[];
  readonly suppressed: readonly WorldDirectorSuppression[];
}

type Candidate = Omit<WorldDirectorProposal, 'id' | 'rank'>;

export function evaluateWorldDirector(input: EvaluateWorldDirectorInput): WorldDirectorEvaluation {
  validateInput(input);
  const quests = [...input.quests].sort(byId);
  const clocks = [...input.clocks].sort(byId);
  const factions = [...input.factions].sort(byId);
  const open = quests.filter(({ status }) => OPEN_STATUSES.has(status));
  const active = quests.filter(({ status }) => status === 'ACTIVE');
  const blocked = quests.filter(({ status }) => status === 'BLOCKED');
  const stale = quests.filter(
    (quest) =>
      EXPIRABLE_STATUSES.has(quest.status) &&
      quest.worldClockAdvancesSinceCreation >= (quest.status === 'BLOCKED' ? 5 : 3),
  );
  const urgent = clocks.filter(({ current, max }) => max - current <= 1);
  const foreshadow = clocks.filter(({ current, max }) => max - current === 2);
  const hostile = factions.filter(
    ({ materialization, playerRelation, currentAction }) =>
      materialization === 'ACTIVE' && playerRelation === 'HOSTILE' && currentAction !== null,
  );
  const recentFailureCount = input.recentTransitions.filter(({ toStatus }) =>
    ['FAILED', 'EXPIRED'].includes(toStatus),
  ).length;
  const pressureScore = Math.min(
    99,
    active.length * 2 +
      blocked.length * 2 +
      urgent.length * 3 +
      hostile.length +
      recentFailureCount * 2,
  );
  const pace = paceFor(pressureScore);
  const signals: WorldDirectorSignals = Object.freeze({
    openQuestCount: open.length,
    activeQuestCount: active.length,
    blockedQuestCount: blocked.length,
    staleQuestIds: Object.freeze(stale.map(({ id }) => id)),
    urgentClockIds: Object.freeze(urgent.map(({ id }) => id)),
    foreshadowClockIds: Object.freeze(foreshadow.map(({ id }) => id)),
    hostileFactionIds: Object.freeze(hostile.map(({ id }) => id)),
    recentFailureCount,
    recentEventCount: input.recentEvents.length,
  });
  const candidates: Candidate[] = stale.map((quest) =>
    candidate(
      'QUEST_EXPIRE',
      null,
      [quest.id],
      'The Quest remained unresolved across enough committed world-clock advances.',
      ['Request Rules validation for an EXPIRED Quest transition.'],
      'HIGH',
      'RULES',
    ),
  );
  const suppressed: WorldDirectorSuppression[] = [];
  if (pace === 'OVERLOADED') {
    suppressCandidates(urgent, 'PRESSURE', suppressed);
    suppressCandidates(foreshadow, 'FORESHADOW', suppressed);
    suppressCandidates(hostile, 'FACTION_ACTION', suppressed);
    if (urgent.length + foreshadow.length + hostile.length === 0) {
      suppressed.push(
        suppression(
          'PRESSURE',
          null,
          'OVERLOAD_GUARD',
          'The world is overloaded, so the Director schedules no new content-producing action.',
        ),
      );
    }
  } else {
    candidates.push(
      ...urgent.map((clock) =>
        candidate(
          'PRESSURE',
          null,
          [clock.id],
          'A committed world clock is one step or less from its maximum.',
          ['Request one grounded pressure candidate without mutating the clock or world.'],
          'HIGH',
          'GENERATOR',
        ),
      ),
      ...foreshadow.map((clock) =>
        candidate(
          'FORESHADOW',
          null,
          [clock.id],
          'A committed world clock is exactly two steps from its maximum.',
          ['Request one foreshadowing candidate grounded in the referenced clock.'],
          'MEDIUM',
          'GENERATOR',
        ),
      ),
      ...hostile.map((faction) =>
        candidate(
          'FACTION_ACTION',
          faction.id,
          [],
          'An active hostile Faction has a committed current action.',
          ['Request a Faction proposal; existing Faction Rules must validate every consequence.'],
          'MEDIUM',
          'FACTION_RULES',
        ),
      ),
    );
    if (pace === 'PRESSURED' && blocked[0] !== undefined) {
      candidates.push(
        candidate(
          'QUEST_UPDATE',
          null,
          [blocked[0].id],
          'A blocked Quest contributes to sustained world pressure.',
          ['Request deterministic Quest Graph reevaluation; do not set status directly.'],
          'HIGH',
          'RULES',
        ),
      );
    }
    if (pace === 'QUIET') {
      const oldest = [...open].sort(byUpdatedAtThenId)[0];
      candidates.push(
        oldest === undefined
          ? candidate(
              'OPPORTUNITY',
              null,
              [input.currentLocationId],
              'No open Quest or high-pressure signal exists in the current world state.',
              ['Request one local opportunity candidate without creating or committing a Quest.'],
              'MEDIUM',
              'GENERATOR',
            )
          : candidate(
              'FORESHADOW',
              null,
              [oldest.id],
              'The world is quiet while an open Quest remains unresolved.',
              ['Request one subtle reminder candidate without changing Quest state.'],
              'LOW',
              'GENERATOR',
            ),
      );
    }
  }
  candidates.sort(compareCandidate);
  for (const overflow of candidates.slice(MAX_PROPOSALS)) {
    suppressed.push(
      suppression(
        overflow.kind,
        overflow.targetEntityIds[0] ?? overflow.actorEntityId,
        'ACTION_LIMIT',
        'The bounded Director decision payload keeps only the first eight deterministic proposals.',
      ),
    );
  }
  const proposals = candidates.slice(0, MAX_PROPOSALS).map((value, index) =>
    Object.freeze({
      ...value,
      id: `director-action-${index + 1}`,
      rank: index + 1,
    }),
  );
  return Object.freeze({
    pace,
    pressureScore,
    signals,
    proposals: Object.freeze(proposals),
    suppressed: Object.freeze(suppressed.sort(compareSuppression)),
  });
}

function candidate(
  kind: WorldDirectorActionKind,
  actorEntityId: string | null,
  targetEntityIds: readonly string[],
  rationale: string,
  proposedEffects: readonly string[],
  urgency: Candidate['urgency'],
  route: Candidate['route'],
): Candidate {
  const cooldownTarget = actorEntityId ?? targetEntityIds[0] ?? 'world';
  return Object.freeze({
    kind,
    actorEntityId,
    targetEntityIds: Object.freeze([...targetEntityIds]),
    rationale,
    proposedEffects: Object.freeze([...proposedEffects]),
    urgency,
    cooldownKey: `director:${kind.toLowerCase()}:${[...cooldownTarget].slice(0, 80).join('')}`,
    route,
  });
}

function suppression(
  kind: WorldDirectorActionKind,
  targetEntityId: string | null,
  reason: WorldDirectorSuppression['reason'],
  rationale: string,
): WorldDirectorSuppression {
  return Object.freeze({ kind, targetEntityId, reason, rationale });
}

function suppressCandidates(
  values: readonly { readonly id: string }[],
  kind: WorldDirectorActionKind,
  output: WorldDirectorSuppression[],
): void {
  for (const { id } of values) {
    output.push(
      suppression(
        kind,
        id,
        'OVERLOAD_GUARD',
        'The current pressure band forbids scheduling another content-producing action.',
      ),
    );
  }
}

function paceFor(score: number): WorldDirectorPace {
  if (score <= 2) return 'QUIET';
  if (score <= 6) return 'BALANCED';
  if (score <= 10) return 'PRESSURED';
  return 'OVERLOADED';
}

function compareCandidate(left: Candidate, right: Candidate): number {
  const urgency = { HIGH: 0, MEDIUM: 1, LOW: 2 } as const;
  const kind = {
    QUEST_EXPIRE: 0,
    QUEST_UPDATE: 1,
    PRESSURE: 2,
    FORESHADOW: 3,
    FACTION_ACTION: 4,
    OPPORTUNITY: 5,
    WORLD_CHANGE: 6,
    NPC_ACTION: 7,
  } as const;
  return (
    urgency[left.urgency] - urgency[right.urgency] ||
    kind[left.kind] - kind[right.kind] ||
    compareText(
      left.targetEntityIds[0] ?? left.actorEntityId ?? '',
      right.targetEntityIds[0] ?? right.actorEntityId ?? '',
    )
  );
}

function compareSuppression(
  left: WorldDirectorSuppression,
  right: WorldDirectorSuppression,
): number {
  return (
    compareText(left.reason, right.reason) ||
    compareText(left.kind, right.kind) ||
    compareText(left.targetEntityId ?? '', right.targetEntityId ?? '')
  );
}

function byId(left: { readonly id: string }, right: { readonly id: string }): number {
  return compareText(left.id, right.id);
}

function byUpdatedAtThenId(left: WorldDirectorQuestInput, right: WorldDirectorQuestInput): number {
  return compareText(left.updatedAt, right.updatedAt) || compareText(left.id, right.id);
}

function compareText(left: string, right: string): number {
  const leftPoints = [...left];
  const rightPoints = [...right];
  const length = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < length; index += 1) {
    const leftPoint = leftPoints[index]?.codePointAt(0) ?? 0;
    const rightPoint = rightPoints[index]?.codePointAt(0) ?? 0;
    if (leftPoint !== rightPoint) return leftPoint < rightPoint ? -1 : 1;
  }
  return leftPoints.length - rightPoints.length;
}

function validateInput(input: EvaluateWorldDirectorInput): void {
  canonical(input.campaignId);
  canonical(input.currentLocationId);
  if (!['TAVERN', 'ADVENTURE', 'SETTLEMENT'].includes(input.campaignState)) invalid();
  uniqueIds(input.quests);
  uniqueIds(input.clocks);
  uniqueIds(input.factions);
  uniqueIds(input.recentEvents);
  for (const quest of input.quests) {
    canonical(quest.id);
    timestamp(quest.createdAt);
    timestamp(quest.updatedAt);
    if (
      !Number.isSafeInteger(quest.worldClockAdvancesSinceCreation) ||
      quest.worldClockAdvancesSinceCreation < 0
    )
      invalid();
    if (
      !OPEN_STATUSES.has(quest.status) &&
      !['COMPLETED', 'FAILED', 'EXPIRED', 'ABANDONED'].includes(quest.status)
    )
      invalid();
  }
  for (const clock of input.clocks) {
    canonical(clock.id);
    if (
      !Number.isSafeInteger(clock.current) ||
      !Number.isSafeInteger(clock.max) ||
      clock.current < 0 ||
      clock.max < 1 ||
      clock.current > clock.max
    )
      invalid();
  }
  for (const faction of input.factions) {
    canonical(faction.id);
    if (!['OUTLINE', 'ACTIVE'].includes(faction.materialization)) invalid();
    if (faction.currentAction !== null) canonical(faction.currentAction, 4_000);
  }
  for (const transition of input.recentTransitions) timestamp(transition.occurredAt);
  for (const event of input.recentEvents) {
    canonical(event.id);
    canonical(event.type, 100);
    timestamp(event.occurredAt);
  }
}

function uniqueIds(values: readonly { readonly id: string }[]): void {
  if (new Set(values.map(({ id }) => id)).size !== values.length) invalid();
}

function canonical(value: string, max = 200): void {
  if (value.length === 0 || [...value].length > max || value.trim() !== value) invalid();
}

function timestamp(value: string): void {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== value) invalid();
}

function invalid(): never {
  throw new WorldDirectorContractError('DIRECTOR_INPUT_INVALID');
}

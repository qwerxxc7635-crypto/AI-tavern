import type {
  DirectorBudgetCategory,
  DirectorBudgetEntry,
  DirectorBudgetReason,
  WorldDirectorActionKind,
  WorldDirectorUrgency,
} from '@ember-tavern/contracts';

export const DIRECTOR_BUDGET_LIMITS = Object.freeze({
  activeQuests: 4,
  dailyEvents: 4,
  urgentEvents: 2,
  npcProactive: 2,
  backgroundChanges: 3,
});
export const DIRECTOR_GAME_DAY_MINUTES = 1_440;
const COOLDOWN_MINUTES: Readonly<Record<WorldDirectorActionKind, number>> = Object.freeze({
  WORLD_CHANGE: 720,
  NPC_ACTION: 720,
  FACTION_ACTION: 720,
  OPPORTUNITY: 720,
  FORESHADOW: 360,
  PRESSURE: 180,
  QUEST_UPDATE: 0,
  QUEST_EXPIRE: 0,
});

export function directorBudgetCategory(kind: WorldDirectorActionKind): DirectorBudgetCategory {
  switch (kind) {
    case 'QUEST_UPDATE':
    case 'QUEST_EXPIRE':
      return 'MAINTENANCE';
    case 'OPPORTUNITY':
    case 'FORESHADOW':
      return 'DAILY_EVENT';
    case 'PRESSURE':
      return 'URGENT_EVENT';
    case 'NPC_ACTION':
      return 'NPC_PROACTIVE';
    case 'WORLD_CHANGE':
    case 'FACTION_ACTION':
      return 'BACKGROUND_CHANGE';
  }
}
export function directorCooldownMinutes(kind: WorldDirectorActionKind): number {
  return COOLDOWN_MINUTES[kind];
}
export function directorGameDay(gameTimeMinutes: number): number {
  if (!Number.isSafeInteger(gameTimeMinutes) || gameTimeMinutes < 0)
    throw new RangeError('Director game time must be a non-negative safe integer');
  return Math.floor(gameTimeMinutes / DIRECTOR_GAME_DAY_MINUTES);
}
export function nextDirectorGameDay(gameTimeMinutes: number): number {
  return (directorGameDay(gameTimeMinutes) + 1) * DIRECTOR_GAME_DAY_MINUTES;
}
export function directorEffectivePriority(
  urgency: WorldDirectorUrgency,
  requestedGameTime: number,
  currentGameTime: number,
): number {
  const base = { LOW: 1, MEDIUM: 2, HIGH: 3 }[urgency];
  const waitedDays = Math.floor(Math.max(0, currentGameTime - requestedGameTime) / 1_440);
  return base + Math.min(waitedDays, 3);
}
export function compareDirectorBudgetEntries(
  left: Pick<DirectorBudgetEntry, 'urgency' | 'requestedGameTime' | 'runId' | 'ordinal'>,
  right: Pick<DirectorBudgetEntry, 'urgency' | 'requestedGameTime' | 'runId' | 'ordinal'>,
  currentGameTime: number,
): number {
  return (
    directorEffectivePriority(right.urgency, right.requestedGameTime, currentGameTime) -
      directorEffectivePriority(left.urgency, left.requestedGameTime, currentGameTime) ||
    left.requestedGameTime - right.requestedGameTime ||
    left.runId.localeCompare(right.runId) ||
    left.ordinal - right.ordinal
  );
}
export function capacityReason(
  category: DirectorBudgetCategory,
  usage: {
    readonly dailyEvents: number;
    readonly urgentEvents: number;
    readonly npcProactive: number;
    readonly backgroundChanges: number;
  },
): DirectorBudgetReason | null {
  if (category === 'DAILY_EVENT' && usage.dailyEvents >= DIRECTOR_BUDGET_LIMITS.dailyEvents)
    return 'DAILY_LIMIT';
  if (category === 'URGENT_EVENT') {
    if (usage.urgentEvents >= DIRECTOR_BUDGET_LIMITS.urgentEvents) return 'URGENT_LIMIT';
    if (usage.dailyEvents >= DIRECTOR_BUDGET_LIMITS.dailyEvents) return 'DAILY_LIMIT';
  }
  if (category === 'NPC_PROACTIVE' && usage.npcProactive >= DIRECTOR_BUDGET_LIMITS.npcProactive)
    return 'NPC_LIMIT';
  if (
    category === 'BACKGROUND_CHANGE' &&
    usage.backgroundChanges >= DIRECTOR_BUDGET_LIMITS.backgroundChanges
  )
    return 'BACKGROUND_LIMIT';
  return null;
}

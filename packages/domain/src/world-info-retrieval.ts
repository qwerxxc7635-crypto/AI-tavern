import {
  createWorldInfoRetrievalQuery,
  type RetrievalEntityRef,
  type WorldInfoRetrievalCandidate,
  type WorldInfoRetrievalCorpus,
  type WorldInfoRetrievalManifestEntry,
  type WorldInfoRetrievalQuery,
  type WorldInfoRetrievalReason,
  type WorldInfoRetrievalResult,
  type WorldInfoRetrievalSelection,
  type WorldInfoTriggerMatch,
} from '@ember-tavern/contracts';

export class WorldInfoRetrievalError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'WorldInfoRetrievalError';
  }
}

interface EvaluatedCandidate {
  readonly candidate: WorldInfoRetrievalCandidate;
  readonly matches: readonly WorldInfoTriggerMatch[];
  readonly score: number;
  readonly estimatedTokens: number;
  readonly initialReason: WorldInfoRetrievalReason | null;
}

export function retrieveWorldInfo(
  queryInput: WorldInfoRetrievalQuery,
  corpus: WorldInfoRetrievalCorpus,
): WorldInfoRetrievalResult {
  const query = createWorldInfoRetrievalQuery(queryInput);
  if (corpus.campaignId !== query.campaignId) {
    throw new WorldInfoRetrievalError('World Info corpus belongs to another campaign');
  }
  const identities = new Set<string>();
  const evaluated = corpus.candidates.map((candidate) => {
    if (candidate.lore.campaignId !== query.campaignId) {
      throw new WorldInfoRetrievalError('World Lore candidate belongs to another campaign');
    }
    if (identities.has(candidate.lore.id)) {
      throw new WorldInfoRetrievalError('World Lore candidates must be unique');
    }
    identities.add(candidate.lore.id);
    return evaluateCandidate(query, candidate);
  });
  const ordered = [...evaluated].sort(compareCandidates);
  let estimatedTokens = 0;
  const selections: WorldInfoRetrievalSelection[] = [];
  const manifest: WorldInfoRetrievalManifestEntry[] = [];
  for (const item of ordered) {
    const { candidate, matches, score } = item;
    const rule = candidate.rule;
    let reason = item.initialReason;
    if (reason === null && rule !== null && item.estimatedTokens > rule.tokenBudget) {
      reason = 'ENTRY_BUDGET';
    }
    if (reason === null && estimatedTokens + item.estimatedTokens > query.maxTokens) {
      reason = 'TOTAL_BUDGET';
    }
    const included = reason === null;
    if (included && rule !== null) {
      estimatedTokens += item.estimatedTokens;
      selections.push(
        Object.freeze({
          loreEntryId: candidate.lore.id,
          title: candidate.lore.title,
          text: candidate.lore.text,
          revision: candidate.lore.revision,
          score,
          priority: rule.priority,
          matches,
        }),
      );
    }
    manifest.push(
      Object.freeze({
        loreEntryId: candidate.lore.id,
        loreRevision: candidate.lore.revision,
        ruleRevision: rule?.revision ?? null,
        priority: rule?.priority ?? null,
        score,
        estimatedTokens: item.estimatedTokens,
        matches,
        included,
        reason: reason ?? 'SELECTED',
      }),
    );
  }
  return Object.freeze({
    selections: Object.freeze(selections),
    manifest: Object.freeze(manifest),
    estimatedTokens,
  });
}

function evaluateCandidate(
  query: WorldInfoRetrievalQuery,
  candidate: WorldInfoRetrievalCandidate,
): EvaluatedCandidate {
  const rule = candidate.rule;
  const estimatedTokens = estimateLoreTokens(candidate.lore.title, candidate.lore.text);
  if (!candidate.current) return excluded('STALE_SOURCE');
  if (rule === null) return excluded('NOT_CONFIGURED');
  if (rule.campaignId !== query.campaignId || rule.loreEntryId !== candidate.lore.id) {
    throw new WorldInfoRetrievalError('World Lore rule scope does not match its candidate');
  }
  if (!rule.enabled) return excluded('DISABLED');

  const matches: WorldInfoTriggerMatch[] = [];
  let configuredTriggers = 0;
  if (rule.alwaysActive) {
    configuredTriggers += 1;
    matches.push(match('ALWAYS', '*', 0.2));
  }
  const normalizedText = normalize(query.text);
  for (const keyword of rule.keywords) {
    configuredTriggers += 1;
    if (containsKeyword(normalizedText, normalize(keyword))) {
      matches.push(match('KEYWORD', keyword, 0.45));
    }
  }
  const queryEntities = new Set(query.entityRefs.map(entityIdentity));
  for (const entity of rule.entityRefs) {
    configuredTriggers += 1;
    const identity = entityIdentity(entity);
    if (queryEntities.has(identity)) matches.push(match('ENTITY', identity, 0.9));
  }
  const queryLocations = new Set(query.locationIds);
  for (const location of rule.locationIds) {
    configuredTriggers += 1;
    if (queryLocations.has(location)) matches.push(match('LOCATION', location, 0.85));
  }
  const queryQuests = new Set(query.questIds);
  for (const quest of rule.questIds) {
    configuredTriggers += 1;
    if (queryQuests.has(quest)) matches.push(match('QUEST', quest, 0.8));
  }
  const triggerSatisfied =
    rule.matchMode === 'ALL'
      ? configuredTriggers > 0 && matches.length === configuredTriggers
      : matches.length > 0;
  const score = combinedScore(matches);
  return Object.freeze({
    candidate,
    matches: Object.freeze(matches),
    score,
    estimatedTokens,
    initialReason: !triggerSatisfied
      ? 'NO_TRIGGER_MATCH'
      : score < query.minimumScore
        ? 'BELOW_THRESHOLD'
        : null,
  });

  function excluded(reason: WorldInfoRetrievalReason): EvaluatedCandidate {
    return Object.freeze({
      candidate,
      matches: Object.freeze([]),
      score: 0,
      estimatedTokens,
      initialReason: reason,
    });
  }
}

function compareCandidates(left: EvaluatedCandidate, right: EvaluatedCandidate): number {
  return (
    (right.candidate.rule?.priority ?? -1) - (left.candidate.rule?.priority ?? -1) ||
    right.score - left.score ||
    left.candidate.lore.id.localeCompare(right.candidate.lore.id)
  );
}

function combinedScore(matches: readonly WorldInfoTriggerMatch[]): number {
  const remaining = matches.reduce((value, trigger) => value * (1 - trigger.weight), 1);
  return Math.round((1 - remaining) * 1_000_000) / 1_000_000;
}

function match(
  kind: WorldInfoTriggerMatch['kind'],
  value: string,
  weight: number,
): WorldInfoTriggerMatch {
  return Object.freeze({ kind, value, weight });
}

function entityIdentity(ref: RetrievalEntityRef): string {
  return `${ref.kind}:${ref.id}`;
}

function containsKeyword(text: string, keyword: string): boolean {
  if (keyword.length === 0) return false;
  if (/\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/u.test(keyword)) {
    return text.includes(keyword);
  }
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return new RegExp(`(^|[^\\p{L}\\p{N}_])${escaped}(?=$|[^\\p{L}\\p{N}_])`, 'u').test(text);
}

function normalize(value: string): string {
  return value.normalize('NFKC').toLowerCase();
}

function estimateLoreTokens(title: string, text: string): number {
  const bytes = new TextEncoder().encode(JSON.stringify({ title, text })).byteLength;
  return Math.max(1, Math.ceil(bytes / 4));
}

import {
  assembleTaskContext,
  contextBudgetForTask,
  type AITask,
  type ContextManifest,
  type ContextPrivacyClass,
  type ContextStability,
} from '@ember-tavern/ai-core';
import type { JsonValue } from '@ember-tavern/contracts';

export type ContextCacheObservation = 'HIT' | 'MISS' | 'NOT_APPLICABLE';

export interface ContextInspectorEntry {
  readonly block: string;
  readonly token: number;
  readonly source: string;
  readonly revision: number;
  readonly stability: ContextStability;
  readonly decision: 'INCLUDED' | 'OMITTED';
  readonly reason: string;
  readonly hash: string;
  readonly cache: ContextCacheObservation;
}

export interface ContextInspectorSnapshot {
  readonly task: AITask;
  readonly estimatedTokens: number;
  readonly maxTokens: number;
  readonly entries: readonly ContextInspectorEntry[];
}

export interface ContextInspectorGateway {
  load(): Promise<ContextInspectorSnapshot | null>;
}

let latestSnapshot: ContextInspectorSnapshot | null = null;
const observedCacheKeys = new Set<string>();

export const sessionContextInspectorGateway: ContextInspectorGateway = {
  async load() {
    return latestSnapshot;
  },
};

export async function recordContextInspection(task: AITask, input: unknown): Promise<void> {
  const content = jsonValue(input);
  const prepared = await assembleTaskContext(
    task,
    `windows:${task}`,
    1,
    content,
    contextBudgetForTask(task).maxCharacters,
  );
  latestSnapshot = projectContextManifest(task, prepared.assembly.manifest);
}

export function projectContextManifest(
  task: AITask,
  manifest: ContextManifest,
): ContextInspectorSnapshot {
  const entries = manifest.entries.map((entry) => {
    const cacheKey = [
      entry.type,
      entry.sourceId,
      entry.sourceRevision,
      entry.version,
      entry.contentHash,
    ].join(':');
    const cache = entry.included
      ? observedCacheKeys.has(cacheKey)
        ? 'HIT'
        : 'MISS'
      : 'NOT_APPLICABLE';
    if (entry.included) observedCacheKeys.add(cacheKey);
    return Object.freeze({
      block: entry.type,
      token: entry.estimatedTokens,
      source: displaySource(entry.sourceId, entry.privacyClass),
      revision: entry.sourceRevision,
      stability: entry.stability,
      decision: entry.included ? 'INCLUDED' : 'OMITTED',
      reason: entry.reason,
      hash: entry.contentHash.slice(0, 12),
      cache,
    }) satisfies ContextInspectorEntry;
  });
  return Object.freeze({
    task,
    estimatedTokens: manifest.estimatedTokens,
    maxTokens: manifest.maxTokens,
    entries: Object.freeze(entries),
  });
}

function displaySource(source: string, privacy: ContextPrivacyClass): string {
  return privacy === 'secret' ? '已遮罩' : source;
}

function jsonValue(input: unknown): JsonValue {
  const serialized = JSON.stringify(input);
  if (serialized === undefined) throw new TypeError('Context inspector input must be JSON');
  return JSON.parse(serialized) as JsonValue;
}

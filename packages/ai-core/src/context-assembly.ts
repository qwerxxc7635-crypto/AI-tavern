import type { JsonValue } from '@ember-tavern/contracts';

import { canonicalJson, sha256CanonicalJson } from './canonical-json.js';
import type { AITask } from './protocol.js';

export const CONTEXT_BLOCK_TYPES = [
  'rules',
  'task',
  'persona',
  'character',
  'world',
  'lore',
  'scene',
  'knowledge',
  'memory',
  'history',
  'user_input',
  'dice',
] as const;
export type ContextBlockType = (typeof CONTEXT_BLOCK_TYPES)[number];

export const CONTEXT_STABILITIES = ['stable', 'semi_stable', 'dynamic'] as const;
export type ContextStability = (typeof CONTEXT_STABILITIES)[number];

export const CONTEXT_PRIVACY_CLASSES = ['public', 'game_private', 'secret'] as const;
export type ContextPrivacyClass = (typeof CONTEXT_PRIVACY_CLASSES)[number];

export interface ContextBlockDraft {
  readonly id: string;
  readonly type: ContextBlockType;
  readonly content: JsonValue;
  readonly sourceId: string;
  readonly sourceRevision: number;
  readonly stability: ContextStability;
  readonly priority: number;
  readonly tokenBudget: number;
  readonly privacyClass: ContextPrivacyClass;
  readonly version: number;
}

export interface ContextBlock extends ContextBlockDraft {
  readonly contentHash: string;
}

export interface ContextCandidate {
  readonly block: ContextBlock;
  readonly relevance: number;
  readonly required: boolean;
}

export type ContextExclusionReason = 'not_relevant' | 'block_budget' | 'total_budget';

export interface ContextManifestEntry {
  readonly blockId: string;
  readonly type: ContextBlockType;
  readonly sourceId: string;
  readonly sourceRevision: number;
  readonly version: number;
  readonly contentHash: string;
  readonly privacyClass: ContextPrivacyClass;
  readonly estimatedTokens: number;
  readonly relevance: number;
  readonly required: boolean;
  readonly included: boolean;
  readonly reason: 'required' | 'relevant' | ContextExclusionReason;
}

export interface ContextManifest {
  readonly maxTokens: number;
  readonly estimatedTokens: number;
  readonly entries: readonly ContextManifestEntry[];
}

export interface ContextAssembly {
  readonly blocks: readonly ContextBlock[];
  readonly manifest: ContextManifest;
}

export interface ContextAssemblyPolicy {
  readonly maxTokens: number;
  readonly typeOrder: readonly ContextBlockType[];
  readonly minimumRelevance?: number;
}

export class ContextAssemblyError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'ContextAssemblyError';
  }
}

export async function createContextBlock(draft: ContextBlockDraft): Promise<ContextBlock> {
  validateDraft(draft);
  const fingerprintPayload = {
    id: draft.id,
    type: draft.type,
    content: draft.content,
    sourceId: draft.sourceId,
    sourceRevision: draft.sourceRevision,
    stability: draft.stability,
    priority: draft.priority,
    tokenBudget: draft.tokenBudget,
    privacyClass: draft.privacyClass,
    version: draft.version,
  } satisfies JsonValue;
  return Object.freeze({
    ...draft,
    contentHash: await sha256CanonicalJson(fingerprintPayload),
  });
}

export function assembleContextBlocks(
  candidates: readonly ContextCandidate[],
  policy: ContextAssemblyPolicy,
): ContextAssembly {
  validatePolicy(policy);
  const minimumRelevance = policy.minimumRelevance ?? 0;
  if (!Number.isFinite(minimumRelevance) || minimumRelevance < 0 || minimumRelevance > 1) {
    throw new ContextAssemblyError('minimumRelevance must be between 0 and 1');
  }
  const ids = new Set<string>();
  for (const candidate of candidates) {
    if (ids.has(candidate.block.id))
      throw new ContextAssemblyError('Context block IDs must be unique');
    ids.add(candidate.block.id);
    if (
      !Number.isFinite(candidate.relevance) ||
      candidate.relevance < 0 ||
      candidate.relevance > 1
    ) {
      throw new ContextAssemblyError('Context relevance must be between 0 and 1');
    }
  }
  const typeOrder = new Map(policy.typeOrder.map((type, index) => [type, index]));
  const stabilityOrder: Readonly<Record<ContextStability, number>> = Object.freeze({
    stable: 0,
    semi_stable: 1,
    dynamic: 2,
  });
  const ordered = [...candidates].sort((left, right) => {
    return (
      stabilityOrder[left.block.stability] - stabilityOrder[right.block.stability] ||
      (typeOrder.get(left.block.type) ?? CONTEXT_BLOCK_TYPES.length) -
        (typeOrder.get(right.block.type) ?? CONTEXT_BLOCK_TYPES.length) ||
      right.block.priority - left.block.priority ||
      left.block.id.localeCompare(right.block.id)
    );
  });

  let estimatedTokens = 0;
  const blocks: ContextBlock[] = [];
  const entries: ContextManifestEntry[] = [];
  for (const candidate of ordered) {
    const tokens = estimateContextTokens(candidate.block.content);
    let reason: ContextManifestEntry['reason'] = candidate.required ? 'required' : 'relevant';
    let included = true;
    if (!candidate.required && candidate.relevance < minimumRelevance) {
      included = false;
      reason = 'not_relevant';
    } else if (tokens > candidate.block.tokenBudget) {
      included = false;
      reason = 'block_budget';
    } else if (estimatedTokens + tokens > policy.maxTokens) {
      included = false;
      reason = 'total_budget';
    }
    if (candidate.required && !included) {
      throw new ContextAssemblyError(`Required context block ${candidate.block.id} exceeds budget`);
    }
    if (included) {
      estimatedTokens += tokens;
      blocks.push(candidate.block);
    }
    entries.push(
      Object.freeze({
        blockId: candidate.block.id,
        type: candidate.block.type,
        sourceId: candidate.block.sourceId,
        sourceRevision: candidate.block.sourceRevision,
        version: candidate.block.version,
        contentHash: candidate.block.contentHash,
        privacyClass: candidate.block.privacyClass,
        estimatedTokens: tokens,
        relevance: candidate.relevance,
        required: candidate.required,
        included,
        reason,
      }),
    );
  }
  return Object.freeze({
    blocks: Object.freeze(blocks),
    manifest: Object.freeze({
      maxTokens: policy.maxTokens,
      estimatedTokens,
      entries: Object.freeze(entries),
    }),
  });
}

export async function assembleTaskContext(
  task: AITask,
  sourceId: string,
  sourceRevision: number,
  content: JsonValue,
  maxTokens: number,
): Promise<Readonly<{ content: JsonValue; assembly: ContextAssembly }>> {
  const block = await createContextBlock({
    id: `${task}:${sourceId}:${sourceRevision}`,
    type: 'task',
    content,
    sourceId,
    sourceRevision,
    stability: 'dynamic',
    priority: 100,
    tokenBudget: maxTokens,
    privacyClass: 'game_private',
    version: 1,
  });
  return Object.freeze({
    content,
    assembly: assembleContextBlocks([{ block, relevance: 1, required: true }], {
      maxTokens,
      typeOrder: CONTEXT_BLOCK_TYPES,
    }),
  });
}

export function estimateContextTokens(content: JsonValue): number {
  return Math.max(1, Math.ceil(new TextEncoder().encode(canonicalJson(content)).byteLength / 4));
}

function validateDraft(draft: ContextBlockDraft): void {
  for (const [label, value] of [
    ['id', draft.id],
    ['sourceId', draft.sourceId],
  ] as const) {
    if (value.length === 0 || value.trim() !== value || value.normalize('NFC') !== value) {
      throw new ContextAssemblyError(`${label} must be non-empty canonical text`);
    }
  }
  if (!CONTEXT_BLOCK_TYPES.includes(draft.type)) {
    throw new ContextAssemblyError('Context block type is invalid');
  }
  if (!CONTEXT_STABILITIES.includes(draft.stability)) {
    throw new ContextAssemblyError('Context stability is invalid');
  }
  if (!CONTEXT_PRIVACY_CLASSES.includes(draft.privacyClass)) {
    throw new ContextAssemblyError('Context privacy class is invalid');
  }
  for (const [label, value] of [
    ['sourceRevision', draft.sourceRevision],
    ['priority', draft.priority],
    ['tokenBudget', draft.tokenBudget],
    ['version', draft.version],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < (label === 'priority' ? 0 : 1)) {
      throw new ContextAssemblyError(`${label} is invalid`);
    }
  }
}

function validatePolicy(policy: ContextAssemblyPolicy): void {
  if (!Number.isSafeInteger(policy.maxTokens) || policy.maxTokens < 1) {
    throw new ContextAssemblyError('maxTokens must be a positive safe integer');
  }
  if (new Set(policy.typeOrder).size !== policy.typeOrder.length) {
    throw new ContextAssemblyError('typeOrder must not contain duplicates');
  }
}

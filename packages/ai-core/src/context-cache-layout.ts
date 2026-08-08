import type { JsonValue } from '@ember-tavern/contracts';

import type { ContextAssembly, ContextBlock, ContextBlockType } from './context-assembly.js';

export const CONTEXT_CACHE_SECTION_KINDS = [
  'LONG_TERM_SUMMARY',
  'RELEVANT_LORE_KNOWLEDGE',
  'RECENT_HISTORY',
  'CURRENT_SCENE_STATE',
  'PLAYER_ACTION',
] as const;

export type ContextCacheSectionKind = (typeof CONTEXT_CACHE_SECTION_KINDS)[number];

export interface ContextCacheBlockProjection {
  readonly type: ContextBlockType;
  readonly sourceRevision: number;
  readonly version: number;
  readonly contentHash: string;
  readonly content: JsonValue;
}

export interface ContextCacheSection {
  readonly kind: ContextCacheSectionKind;
  readonly stability: 'semi_stable' | 'dynamic';
  readonly blocks: readonly ContextCacheBlockProjection[];
}

export interface ContextCacheLayout {
  readonly sections: readonly ContextCacheSection[];
}

export class ContextCacheLayoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContextCacheLayoutError';
  }
}

const SECTION_RULES = Object.freeze({
  LONG_TERM_SUMMARY: Object.freeze({
    stability: 'semi_stable',
    types: Object.freeze(['summary', 'memory'] as const),
  }),
  RELEVANT_LORE_KNOWLEDGE: Object.freeze({
    stability: 'semi_stable',
    types: Object.freeze(['lore', 'knowledge'] as const),
  }),
  RECENT_HISTORY: Object.freeze({
    stability: 'dynamic',
    types: Object.freeze(['history'] as const),
  }),
  CURRENT_SCENE_STATE: Object.freeze({
    stability: 'dynamic',
    types: Object.freeze(['scene', 'state', 'dice'] as const),
  }),
  PLAYER_ACTION: Object.freeze({
    stability: 'dynamic',
    types: Object.freeze(['action', 'user_input'] as const),
  }),
} satisfies Readonly<
  Record<
    ContextCacheSectionKind,
    { stability: 'semi_stable' | 'dynamic'; types: readonly ContextBlockType[] }
  >
>);

export function createContextCacheLayout(assembly: ContextAssembly): ContextCacheLayout {
  const classified = new Map<ContextCacheSectionKind, ContextBlock[]>();
  for (const kind of CONTEXT_CACHE_SECTION_KINDS) classified.set(kind, []);

  for (const block of assembly.blocks) {
    const kind = sectionFor(block.type);
    if (kind === null) {
      throw new ContextCacheLayoutError(`Context block type ${block.type} has no cache layout`);
    }
    const expected = SECTION_RULES[kind].stability;
    if (block.stability !== expected) {
      throw new ContextCacheLayoutError(
        `${block.type} must be ${expected}, received ${block.stability}`,
      );
    }
    classified.get(kind)?.push(block);
  }

  return Object.freeze({
    sections: Object.freeze(
      CONTEXT_CACHE_SECTION_KINDS.map((kind) => {
        const rule = SECTION_RULES[kind];
        const typeOrder = new Map(rule.types.map((type, index) => [type, index]));
        const blocks = [...(classified.get(kind) ?? [])]
          .sort((left, right) => compareBlocks(left, right, typeOrder, kind))
          .map(projectBlock);
        return Object.freeze({
          kind,
          stability: rule.stability,
          blocks: Object.freeze(blocks),
        });
      }),
    ),
  });
}

function sectionFor(type: ContextBlockType): ContextCacheSectionKind | null {
  for (const kind of CONTEXT_CACHE_SECTION_KINDS) {
    const types: readonly ContextBlockType[] = SECTION_RULES[kind].types;
    if (types.includes(type)) return kind;
  }
  return null;
}

function compareBlocks(
  left: ContextBlock,
  right: ContextBlock,
  typeOrder: ReadonlyMap<ContextBlockType, number>,
  kind: ContextCacheSectionKind,
): number {
  const chronological =
    kind === 'RECENT_HISTORY' || kind === 'CURRENT_SCENE_STATE' || kind === 'PLAYER_ACTION';
  return (
    (typeOrder.get(left.type) ?? 99) - (typeOrder.get(right.type) ?? 99) ||
    (chronological ? left.sourceRevision - right.sourceRevision : 0) ||
    left.contentHash.localeCompare(right.contentHash)
  );
}

function projectBlock(block: ContextBlock): ContextCacheBlockProjection {
  return Object.freeze({
    type: block.type,
    sourceRevision: block.sourceRevision,
    version: block.version,
    contentHash: block.contentHash,
    content: block.content,
  });
}

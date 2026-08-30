import type { JsonValue } from '@ember-tavern/contracts';

import type { AITask } from './protocol.js';
import {
  assembleContextBlocks,
  createContextBlock,
  type ContextAssembly,
  type ContextBlockType,
  type ContextCandidate,
  type ContextPrivacyClass,
  type ContextStability,
} from './context-assembly.js';
import {
  assertTaskContextBudget,
  contextBudgetForTask,
  ContextBuildError,
} from './context-builder.js';

export const UNIFIED_CONTEXT_LAYERS = [
  'SYSTEM',
  'CONSTITUTION',
  'LORE',
  'LOCATION',
  'PLAYER',
  'ACTOR_KNOWLEDGE',
  'QUEST_STATE',
  'MEMORY',
  'RECENT',
  'ACTION',
] as const;
export type UnifiedContextLayer = (typeof UNIFIED_CONTEXT_LAYERS)[number];

export interface UnifiedContextBuildOptions {
  readonly sourceId: string;
  readonly sourceRevision: number;
  readonly optionalFields?: readonly string[];
  readonly relevanceByField?: Readonly<Record<string, number>>;
  readonly minimumRelevance?: number;
  readonly maxTokens?: number;
}

export interface UnifiedContextBuild {
  readonly task: AITask;
  readonly content: JsonValue;
  readonly assembly: ContextAssembly;
  readonly includedFields: readonly string[];
  readonly omittedFields: readonly string[];
}

interface LayerPolicy {
  readonly type: ContextBlockType;
  readonly stability: ContextStability;
  readonly priority: number;
  readonly privacyClass: ContextPrivacyClass;
}

const LAYER_POLICIES = Object.freeze({
  SYSTEM: Object.freeze({
    type: 'task',
    stability: 'stable',
    priority: 1_000,
    privacyClass: 'public',
  }),
  CONSTITUTION: Object.freeze({
    type: 'rules',
    stability: 'stable',
    priority: 900,
    privacyClass: 'game_private',
  }),
  LORE: Object.freeze({
    type: 'lore',
    stability: 'semi_stable',
    priority: 800,
    privacyClass: 'game_private',
  }),
  LOCATION: Object.freeze({
    type: 'scene',
    stability: 'semi_stable',
    priority: 700,
    privacyClass: 'game_private',
  }),
  PLAYER: Object.freeze({
    type: 'character',
    stability: 'semi_stable',
    priority: 600,
    privacyClass: 'game_private',
  }),
  ACTOR_KNOWLEDGE: Object.freeze({
    type: 'knowledge',
    stability: 'semi_stable',
    priority: 500,
    privacyClass: 'secret',
  }),
  QUEST_STATE: Object.freeze({
    type: 'state',
    stability: 'semi_stable',
    priority: 400,
    privacyClass: 'game_private',
  }),
  MEMORY: Object.freeze({
    type: 'memory',
    stability: 'semi_stable',
    priority: 300,
    privacyClass: 'secret',
  }),
  RECENT: Object.freeze({
    type: 'history',
    stability: 'dynamic',
    priority: 200,
    privacyClass: 'game_private',
  }),
  ACTION: Object.freeze({
    type: 'action',
    stability: 'dynamic',
    priority: 100,
    privacyClass: 'game_private',
  }),
}) satisfies Readonly<Record<UnifiedContextLayer, LayerPolicy>>;

const TYPE_ORDER = Object.freeze(UNIFIED_CONTEXT_LAYERS.map((layer) => LAYER_POLICIES[layer].type));
const FORBIDDEN_DUMP_KEYS = new Set([
  'alldata',
  'allrows',
  'alltables',
  'database',
  'databasedump',
  'fulldatabase',
  'sqlitedump',
  'tables',
]);
const FORBIDDEN_SECRET_NAMES = new Set(['authorization', 'cookie', 'password', 'token']);
const FORBIDDEN_SECRET_FRAGMENTS = ['apikey', 'accesstoken', 'secretkey', 'credentialref'];

export async function buildUnifiedTaskContext(
  task: AITask,
  input: unknown,
  options: UnifiedContextBuildOptions,
): Promise<UnifiedContextBuild> {
  validateOptions(options);
  const content = toJsonObject(input);
  assertNoDatabaseDumpOrCredential(content, '$context');
  const maxTokens = options.maxTokens ?? contextBudgetForTask(task).maxCharacters;
  const optional = new Set(options.optionalFields ?? []);
  const candidates: ContextCandidate[] = [
    {
      block: await createLayerBlock(
        task,
        'SYSTEM',
        'taskContract',
        { task, contextContractVersion: 1 },
        options,
        maxTokens,
      ),
      relevance: 1,
      required: true,
    },
  ];
  const fieldLayers = new Map<string, UnifiedContextLayer>();
  for (const [field, value] of Object.entries(content)) {
    const layer = layerForField(field);
    fieldLayers.set(field, layer);
    const relevance = options.relevanceByField?.[field] ?? 1;
    candidates.push({
      block: await createLayerBlock(task, layer, field, { [field]: value }, options, maxTokens),
      relevance,
      required: !optional.has(field),
    });
  }
  const assembly = assembleContextBlocks(candidates, {
    maxTokens,
    typeOrder: TYPE_ORDER,
    minimumRelevance: options.minimumRelevance ?? 0.25,
  });
  const includedBlockIds = new Set(assembly.blocks.map(({ id }) => id));
  const projected: Record<string, JsonValue> = {};
  const includedFields: string[] = [];
  const omittedFields: string[] = [];
  for (const [field, value] of Object.entries(content)) {
    const layer = fieldLayers.get(field);
    if (layer === undefined) throw new ContextBuildError('Unified context field lost its layer');
    const id = blockId(task, layer, field);
    if (includedBlockIds.has(id)) {
      projected[field] = value;
      includedFields.push(field);
    } else {
      omittedFields.push(field);
    }
  }
  assertTaskContextBudget(task, projected);
  return Object.freeze({
    task,
    content: Object.freeze(projected),
    assembly,
    includedFields: Object.freeze(includedFields),
    omittedFields: Object.freeze(omittedFields),
  });
}

export function layerForContextField(field: string): UnifiedContextLayer {
  if (field.trim() !== field || field.length === 0)
    throw new ContextBuildError('Context field is invalid');
  return layerForField(field);
}

async function createLayerBlock(
  task: AITask,
  layer: UnifiedContextLayer,
  field: string,
  content: JsonValue,
  options: UnifiedContextBuildOptions,
  maxTokens: number,
) {
  const policy = LAYER_POLICIES[layer];
  return createContextBlock({
    id: blockId(task, layer, field),
    type: policy.type,
    content,
    sourceId: `${options.sourceId}:${field}`,
    sourceRevision: sourceRevisionFor(content, options.sourceRevision),
    stability: policy.stability,
    priority: policy.priority,
    tokenBudget: maxTokens,
    privacyClass: policy.privacyClass,
    version: 1,
  });
}

function blockId(task: AITask, layer: UnifiedContextLayer, field: string): string {
  return `unified:${task}:${layer.toLowerCase()}:${field}`;
}

function layerForField(field: string): UnifiedContextLayer {
  const key = normalizeKey(field);
  if (
    matches(key, [
      'constitution',
      'worldrules',
      'powerrules',
      'lockedrules',
      'contentboundaries',
      'forbiddenelements',
    ])
  )
    return 'CONSTITUTION';
  if (
    matches(key, ['currentlocation', 'location', 'region', 'currentscene', 'sceneframe', 'tavern'])
  )
    return 'LOCATION';
  if (matches(key, ['playercharacter', 'playerstate', 'characterstate', 'playerprofile']))
    return 'PLAYER';
  if (matches(key, ['knowledge', 'relationship', 'npc', 'actor', 'participant', 'relatednpc']))
    return 'ACTOR_KNOWLEDGE';
  if (matches(key, ['worldsummary'])) return 'LORE';
  if (matches(key, ['longtermmemory', 'memory', 'memories', 'summary'])) return 'MEMORY';
  if (matches(key, ['recent', 'history', 'message', 'turns', 'events'])) return 'RECENT';
  if (
    matches(key, [
      'quest',
      'adventure',
      'clock',
      'worldstate',
      'factionstate',
      'item',
      'equipment',
      'clue',
      'resource',
      'status',
    ])
  )
    return 'QUEST_STATE';
  if (
    matches(key, ['world', 'lore', 'fact', 'faction', 'storyhook', 'narrativestyle', 'technology'])
  )
    return 'LORE';
  return 'ACTION';
}

function sourceRevisionFor(content: JsonValue, fallback: number): number {
  if (content === null || typeof content !== 'object' || Array.isArray(content)) return fallback;
  const values = Object.values(content);
  if (values.length !== 1) return fallback;
  const value = values[0];
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return fallback;
  const record = value as Readonly<Record<string, JsonValue>>;
  for (const key of ['revision', 'schemaVersion'] as const) {
    const revision = record[key];
    if (Number.isSafeInteger(revision) && (revision as number) >= 1) return revision as number;
  }
  return fallback;
}

function matches(key: string, fragments: readonly string[]): boolean {
  return fragments.some((fragment) => key.includes(fragment));
}

function normalizeKey(value: string): string {
  return value.replaceAll(/[_-]/gu, '').toLowerCase();
}

function validateOptions(options: UnifiedContextBuildOptions): void {
  if (
    options.sourceId.trim() !== options.sourceId ||
    options.sourceId.length === 0 ||
    options.sourceId.normalize('NFC') !== options.sourceId ||
    !Number.isSafeInteger(options.sourceRevision) ||
    options.sourceRevision < 1
  ) {
    throw new ContextBuildError('Unified context source identity is invalid');
  }
  if (
    options.maxTokens !== undefined &&
    (!Number.isSafeInteger(options.maxTokens) || options.maxTokens < 1)
  ) {
    throw new ContextBuildError('Unified context maxTokens is invalid');
  }
}

function toJsonObject(input: unknown): Readonly<Record<string, JsonValue>> {
  let parsed: unknown;
  try {
    const serialized = JSON.stringify(input);
    if (serialized === undefined) throw new TypeError('Context is not JSON serializable');
    parsed = JSON.parse(serialized);
  } catch (error) {
    throw new ContextBuildError('Unified context must be JSON serializable', { cause: error });
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ContextBuildError('Unified context root must be an object');
  }
  return Object.freeze(parsed as Record<string, JsonValue>);
}

function assertNoDatabaseDumpOrCredential(value: JsonValue, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoDatabaseDumpOrCredential(entry, `${path}[${index}]`));
    return;
  }
  if (value === null || typeof value !== 'object') return;
  for (const [key, entry] of Object.entries(value)) {
    const normalized = normalizeKey(key);
    if (FORBIDDEN_DUMP_KEYS.has(normalized)) {
      throw new ContextBuildError(`Unified context rejects database dump field at ${path}.${key}`);
    }
    if (
      FORBIDDEN_SECRET_NAMES.has(normalized) ||
      FORBIDDEN_SECRET_FRAGMENTS.some((fragment) => normalized.includes(fragment))
    ) {
      throw new ContextBuildError(`Unified context rejects credential field at ${path}.${key}`);
    }
    assertNoDatabaseDumpOrCredential(entry, `${path}.${key}`);
  }
}

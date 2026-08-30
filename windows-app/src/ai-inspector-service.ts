import type {
  AITask,
  GeneratorAuditEntry,
  NormalizedAIRequest,
  NormalizedAIResponse,
} from '@ember-tavern/ai-core';

import {
  sessionContextInspectorGateway,
  type ContextInspectorSnapshot,
} from './context-inspector-service.js';
import { SessionCachePrefixTracker, type SessionCacheObservation } from './cache-observation.js';

export const AI_INSPECTOR_MODES = ['PLAYER', 'ADVANCED', 'DEVELOPER'] as const;
export type AIInspectorMode = (typeof AI_INSPECTOR_MODES)[number];

export interface AIInspectorPromptEntry {
  readonly role: string;
  readonly characters: number;
  readonly content: string;
}

export interface AIInspectorSnapshot {
  readonly generation: {
    readonly task: AITask;
    readonly status: 'SUCCEEDED' | 'FAILED';
    readonly errorCode: string | null;
  };
  readonly provider: {
    readonly id: string | null;
    readonly displayName: string | null;
    readonly model: string | null;
  };
  readonly latencyMs: number;
  readonly cache: {
    readonly providerObservation: 'HIT' | 'MISS' | 'UNKNOWN';
    readonly sessionObservation: SessionCacheObservation | 'UNKNOWN';
    readonly prefixHash: string | null;
  };
  readonly tokens: {
    readonly input: number | null;
    readonly output: number | null;
    readonly total: number | null;
    readonly cacheHit: number | null;
    readonly cacheMiss: number | null;
  };
  readonly context: ContextInspectorSnapshot | null;
  readonly prompt: readonly AIInspectorPromptEntry[];
  readonly raw: {
    readonly characters: number;
    readonly content: string;
  } | null;
  readonly parsed: unknown;
  readonly validation: {
    readonly status: 'PASSED' | 'FAILED' | 'NOT_REACHED';
    readonly code: string | null;
    readonly issues: readonly Readonly<{ path: string; code: string; message: string }>[];
  };
  readonly repair: {
    readonly attempted: boolean;
    readonly status: 'SUCCEEDED' | 'FAILED' | 'SKIPPED';
  };
  readonly lifecycle: readonly GeneratorAuditEntry[];
}

export interface AIInspectorGateway {
  load(mode: AIInspectorMode): Promise<AIInspectorSnapshot | null>;
}

interface InspectionDraft {
  readonly snapshot: AIInspectorSnapshot;
  readonly developerPrompt: readonly AIInspectorPromptEntry[];
  readonly developerRaw: AIInspectorSnapshot['raw'];
  readonly developerParsed: unknown;
}

export interface RecordAIInspectionSuccess {
  readonly task: AITask;
  readonly providerId: string;
  readonly providerDisplayName: string;
  readonly request: NormalizedAIRequest;
  readonly response: NormalizedAIResponse;
  readonly parsed: unknown;
  readonly cachePrefixHash: string;
  readonly latencyMs: number;
  readonly lifecycle: readonly GeneratorAuditEntry[];
}

export interface RecordAIInspectionFailure {
  readonly task: AITask;
  readonly providerId: string | null;
  readonly providerDisplayName: string | null;
  readonly model: string | null;
  readonly request?: NormalizedAIRequest;
  readonly raw?: string;
  readonly parsed?: unknown;
  readonly latencyMs: number;
  readonly errorCode: string;
  readonly validation?: Readonly<{
    code: string;
    issues: readonly Readonly<{
      path: readonly (string | number)[];
      code?: string;
      message: string;
    }>[];
  }>;
  readonly lifecycle: readonly GeneratorAuditEntry[];
}

const MAX_INSPECTIONS = 20;
const MAX_SECTION_CHARACTERS = 8_000;
const SECRET_FIELD =
  /api.?key|authorization|bearer|access.?token|secret|password|cookie|credential|world.?truth|hidden|unrevealed/i;
const INLINE_SECRET =
  /\b(?:bearer\s+|sk-|api[_ -]?key\s*[:=]\s*|authorization\s*[:=]\s*)[0-9a-z._~+/-]{8,}={0,2}/giu;
const JSON_SECRET_VALUE =
  /("(?:api.?key|authorization|access.?token|secret|password|cookie|credential|world.?truth|hidden|unrevealed)[^"]*"\s*:\s*)"(?:[^"\\]|\\.)*"/giu;
const inspections: InspectionDraft[] = [];
const sessionCachePrefixes = new SessionCachePrefixTracker();

export const sessionAIInspectorGateway: AIInspectorGateway = {
  async load(mode) {
    if (mode === 'PLAYER') return null;
    const latest = inspections.at(-1);
    if (latest === undefined) return null;
    if (mode === 'DEVELOPER') {
      return Object.freeze({
        ...latest.snapshot,
        prompt: latest.developerPrompt,
        raw: latest.developerRaw,
        parsed: latest.developerParsed,
      });
    }
    return latest.snapshot;
  },
};

export async function recordAIInspectionSuccess(input: RecordAIInspectionSuccess): Promise<void> {
  await safelyRecord(async () => {
    const lifecycle = boundedLifecycle(input.lifecycle);
    const context = await sessionContextInspectorGateway.load();
    const developerPrompt = projectPrompt(input.request, false);
    const developerRaw = projectRaw(input.response.content, false);
    const developerParsed = redactValue(input.parsed, false);
    append({
      developerPrompt,
      developerRaw,
      developerParsed,
      snapshot: Object.freeze({
        generation: Object.freeze({ task: input.task, status: 'SUCCEEDED', errorCode: null }),
        provider: Object.freeze({
          id: boundedText(redactText(input.providerId)),
          displayName: boundedText(redactText(input.providerDisplayName)),
          model: boundedText(redactText(input.request.modelName)),
        }),
        latencyMs: boundedLatency(input.latencyMs),
        cache: Object.freeze({
          providerObservation: cacheObservation(input.response),
          sessionObservation: sessionCachePrefixes.observe(input.cachePrefixHash),
          prefixHash: boundedHash(input.cachePrefixHash),
        }),
        tokens: tokenProjection(input.response),
        context,
        prompt: projectPrompt(input.request, true),
        raw: projectRaw(input.response.content, true),
        parsed: redactValue(input.parsed, true),
        validation: Object.freeze({ status: 'PASSED', code: null, issues: Object.freeze([]) }),
        repair: repairProjection(lifecycle),
        lifecycle,
      }),
    });
  });
}

export async function recordAIInspectionFailure(input: RecordAIInspectionFailure): Promise<void> {
  await safelyRecord(async () => {
    const lifecycle = boundedLifecycle(input.lifecycle);
    const context = await sessionContextInspectorGateway.load();
    const developerPrompt =
      input.request === undefined ? Object.freeze([]) : projectPrompt(input.request, false);
    const developerRaw = input.raw === undefined ? null : projectRaw(input.raw, false);
    const developerParsed = input.parsed === undefined ? null : redactValue(input.parsed, false);
    append({
      developerPrompt,
      developerRaw,
      developerParsed,
      snapshot: Object.freeze({
        generation: Object.freeze({
          task: input.task,
          status: 'FAILED',
          errorCode: safeCode(input.errorCode),
        }),
        provider: Object.freeze({
          id: optionalBoundedText(input.providerId),
          displayName: optionalBoundedText(input.providerDisplayName),
          model: optionalBoundedText(input.model),
        }),
        latencyMs: boundedLatency(input.latencyMs),
        cache: Object.freeze({
          providerObservation: 'UNKNOWN',
          sessionObservation: 'UNKNOWN',
          prefixHash: null,
        }),
        tokens: emptyTokens(),
        context,
        prompt:
          input.request === undefined ? Object.freeze([]) : projectPrompt(input.request, true),
        raw: input.raw === undefined ? null : projectRaw(input.raw, true),
        parsed: input.parsed === undefined ? null : redactValue(input.parsed, true),
        validation: validationProjection(input.validation),
        repair: repairProjection(lifecycle),
        lifecycle,
      }),
    });
  });
}

export function resetAIInspectorForTests(): void {
  inspections.length = 0;
  sessionCachePrefixes.reset();
}

function append(draft: InspectionDraft): void {
  inspections.push(Object.freeze(draft));
  if (inspections.length > MAX_INSPECTIONS)
    inspections.splice(0, inspections.length - MAX_INSPECTIONS);
}

async function safelyRecord(operation: () => Promise<void>): Promise<void> {
  try {
    await operation();
  } catch {
    // Diagnostics are best-effort and must never replace a generation result or error.
  }
}

function projectPrompt(
  request: NormalizedAIRequest,
  masked: boolean,
): readonly AIInspectorPromptEntry[] {
  return Object.freeze(
    request.messages.slice(0, 32).map((message) =>
      Object.freeze({
        role: message.role,
        characters: message.content.length,
        content:
          message.role === 'SYSTEM'
            ? '［核心提示已隐藏］'
            : masked
              ? '［提示内容已遮罩］'
              : boundedText(developerPromptContent(message.content)),
      }),
    ),
  );
}

function developerPromptContent(content: string): string {
  const taskInput = content.indexOf('[TASK_INPUT]');
  return developerContent(taskInput < 0 ? content : content.slice(taskInput));
}

function projectRaw(content: string, masked: boolean): NonNullable<AIInspectorSnapshot['raw']> {
  return Object.freeze({
    characters: content.length,
    content: masked ? '［原始输出内容已遮罩］' : developerContent(content),
  });
}

function developerContent(content: string): string {
  try {
    return JSON.stringify(redactValue(JSON.parse(content) as unknown, false));
  } catch {
    return boundedText(redactText(content));
  }
}

function redactValue(value: unknown, maskAllValues: boolean, depth = 0): unknown {
  if (depth > 12) return '［结构深度已截断］';
  if (value === null) return null;
  if (Array.isArray(value)) {
    return Object.freeze(
      value.slice(0, 64).map((entry) => redactValue(entry, maskAllValues, depth + 1)),
    );
  }
  if (typeof value === 'object') {
    return Object.freeze(
      Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .slice(0, 128)
          .map(([key, entry]) => [
            boundedText(key),
            SECRET_FIELD.test(key)
              ? '［秘密字段已遮罩］'
              : redactValue(entry, maskAllValues, depth + 1),
          ]),
      ),
    );
  }
  if (maskAllValues) {
    if (typeof value === 'string') return '［文本已遮罩］';
    if (typeof value === 'number') return '［数值已遮罩］';
    if (typeof value === 'boolean') return '［布尔值已遮罩］';
    return '［值已遮罩］';
  }
  return typeof value === 'string' ? boundedText(redactText(value)) : value;
}

function validationProjection(
  validation: RecordAIInspectionFailure['validation'],
): AIInspectorSnapshot['validation'] {
  if (validation === undefined) {
    return Object.freeze({ status: 'NOT_REACHED', code: null, issues: Object.freeze([]) });
  }
  return Object.freeze({
    status: 'FAILED',
    code: safeCode(validation.code),
    issues: Object.freeze(
      validation.issues.slice(0, 50).map((issue) =>
        Object.freeze({
          path: issue.path.slice(0, 20).map(String).join('.'),
          code: safeIssueCode(issue.code ?? 'VALIDATION_ISSUE'),
          message: boundedText(redactText(issue.message)),
        }),
      ),
    ),
  });
}

function repairProjection(
  lifecycle: readonly GeneratorAuditEntry[],
): AIInspectorSnapshot['repair'] {
  const repair = lifecycle.filter(({ stage }) => stage === 'REPAIR');
  const attempted = repair.some(({ status }) => status === 'STARTED');
  const repairSucceededAt = lifecycle.findIndex(
    ({ stage, status }) => stage === 'REPAIR' && status === 'SUCCEEDED',
  );
  const repairedValidationFailed =
    repairSucceededAt >= 0 &&
    lifecycle
      .slice(repairSucceededAt + 1)
      .some(({ stage, status }) => stage === 'VALIDATE' && status === 'FAILED');
  const status =
    repair.some(({ status: value }) => value === 'FAILED') || repairedValidationFailed
      ? 'FAILED'
      : repair.some(({ status: value }) => value === 'SUCCEEDED')
        ? 'SUCCEEDED'
        : 'SKIPPED';
  return Object.freeze({ attempted, status });
}

function boundedLifecycle(entries: readonly GeneratorAuditEntry[]): readonly GeneratorAuditEntry[] {
  return Object.freeze(entries.slice(0, 64).map((entry) => Object.freeze({ ...entry })));
}

function cacheObservation(
  response: NormalizedAIResponse,
): AIInspectorSnapshot['cache']['providerObservation'] {
  if ((response.usage.promptCacheHitTokens ?? 0) > 0) return 'HIT';
  if ((response.usage.promptCacheMissTokens ?? 0) > 0) return 'MISS';
  return 'UNKNOWN';
}

function tokenProjection(response: NormalizedAIResponse): AIInspectorSnapshot['tokens'] {
  return Object.freeze({
    input: response.usage.inputTokens,
    output: response.usage.outputTokens,
    total: response.usage.totalTokens,
    cacheHit: response.usage.promptCacheHitTokens ?? null,
    cacheMiss: response.usage.promptCacheMissTokens ?? null,
  });
}

function emptyTokens(): AIInspectorSnapshot['tokens'] {
  return Object.freeze({ input: null, output: null, total: null, cacheHit: null, cacheMiss: null });
}

function redactText(value: string): string {
  return value
    .replace(INLINE_SECRET, '［凭据已遮罩］')
    .replace(JSON_SECRET_VALUE, '$1"［秘密字段已遮罩］"');
}

function boundedText(value: string): string {
  return value.slice(0, MAX_SECTION_CHARACTERS);
}

function optionalBoundedText(value: string | null): string | null {
  return value === null ? null : boundedText(redactText(value));
}

function boundedHash(value: string): string | null {
  return /^[a-f0-9]{64}$/u.test(value) ? value.slice(0, 12) : null;
}

function boundedLatency(value: number): number {
  return Number.isFinite(value) ? Math.min(86_400_000, Math.max(0, Math.round(value))) : 0;
}

function safeCode(value: string): string {
  return /^[A-Z0-9_]{2,64}$/u.test(value) ? value : 'UNKNOWN';
}

function safeIssueCode(value: string): string {
  return /^[A-Za-z0-9_]{2,64}$/u.test(value) ? value : 'UNKNOWN';
}

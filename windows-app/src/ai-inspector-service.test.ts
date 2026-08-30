import { beforeEach, describe, expect, it } from 'vitest';

import type {
  GeneratorAuditEntry,
  NormalizedAIRequest,
  NormalizedAIResponse,
} from '@ember-tavern/ai-core';
import { aiRequestId, isoTimestamp, promptVersion } from '@ember-tavern/contracts';

import {
  recordAIInspectionFailure,
  recordAIInspectionSuccess,
  resetAIInspectorForTests,
  sessionAIInspectorGateway,
} from './ai-inspector-service.js';

describe('AI inspector service', () => {
  beforeEach(() => resetAIInspectorForTests());

  it('requires an explicit non-player mode and masks content by default', async () => {
    await recordAIInspectionSuccess(successInput());
    expect(await sessionAIInspectorGateway.load('PLAYER')).toBeNull();

    const advanced = await sessionAIInspectorGateway.load('ADVANCED');
    expect(advanced).toMatchObject({
      generation: { task: 'NPC_REPLY', status: 'SUCCEEDED' },
      prompt: [{ content: '［核心提示已隐藏］' }, { content: '［提示内容已遮罩］' }],
      raw: { content: '［原始输出内容已遮罩］' },
      parsed: {
        publicSummary: '［文本已遮罩］',
        secret: '［秘密字段已遮罩］',
      },
    });
    expect(JSON.stringify(advanced)).not.toContain('unreleased ending');
    expect(JSON.stringify(advanced)).not.toContain('sk-inspector-secret');
  });

  it('keeps developer diagnostics useful while always removing credentials and secret truth', async () => {
    await recordAIInspectionSuccess(successInput());
    const developer = await sessionAIInspectorGateway.load('DEVELOPER');
    expect(developer?.prompt[0]?.content).toBe('［核心提示已隐藏］');
    expect(developer?.prompt[1]?.content).toContain('public request');
    expect(developer?.raw?.content).toContain('public answer');
    expect(developer?.parsed).toMatchObject({ publicSummary: 'public answer' });
    const serialized = JSON.stringify(developer);
    expect(serialized).not.toContain('unreleased ending');
    expect(serialized).not.toContain('sk-inspector-secret');
    expect(serialized).not.toContain('Bearer inspector-token');
    expect(serialized).toContain('秘密字段已遮罩');
  });

  it('removes a merged Core Prompt when the model has no system-message role', async () => {
    const input = successInput();
    await recordAIInspectionSuccess({
      ...input,
      request: {
        ...input.request,
        messages: [
          {
            role: 'USER',
            content:
              'private core rules and stable world truth\n\n[TASK_INPUT]\nTask input JSON:\n{"concept":"public request"}',
          },
        ],
      },
    });
    const developer = await sessionAIInspectorGateway.load('DEVELOPER');
    expect(developer?.prompt[0]?.content).toContain('[TASK_INPUT]');
    expect(developer?.prompt[0]?.content).not.toContain('private core rules');
    expect(developer?.prompt[0]?.content).not.toContain('stable world truth');
  });

  it('projects latency, cache, tokens, lifecycle and repair without becoming mutable state', async () => {
    await recordAIInspectionSuccess(successInput());
    const snapshot = await sessionAIInspectorGateway.load('ADVANCED');
    expect(snapshot).toMatchObject({
      latencyMs: 125,
      cache: {
        providerObservation: 'HIT',
        sessionObservation: 'PREFIX_FIRST_SEEN',
        prefixHash: 'aaaaaaaaaaaa',
      },
      tokens: { input: 90, output: 20, total: 110, cacheHit: 50, cacheMiss: 0 },
      validation: { status: 'PASSED' },
      repair: { attempted: true, status: 'SUCCEEDED' },
    });
    expect(snapshot?.lifecycle).toHaveLength(2);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot?.parsed)).toBe(true);
  });

  it('labels repeated session prefixes without claiming a Provider cache hit', async () => {
    const input = successInput();
    await recordAIInspectionSuccess({
      ...input,
      response: {
        ...input.response,
        usage: { ...input.response.usage, promptCacheHitTokens: null, promptCacheMissTokens: null },
      },
    });
    await recordAIInspectionSuccess({
      ...input,
      response: {
        ...input.response,
        usage: { ...input.response.usage, promptCacheHitTokens: null, promptCacheMissTokens: null },
      },
    });
    expect((await sessionAIInspectorGateway.load('ADVANCED'))?.cache).toMatchObject({
      providerObservation: 'UNKNOWN',
      sessionObservation: 'PREFIX_REUSED',
    });
  });

  it('keeps empty and failed records diagnosable with bounded validation details', async () => {
    expect(await sessionAIInspectorGateway.load('ADVANCED')).toBeNull();
    await recordAIInspectionFailure({
      task: 'GENERATE_WORLD',
      providerId: null,
      providerDisplayName: null,
      model: null,
      latencyMs: Number.POSITIVE_INFINITY,
      errorCode: 'INVALID_OUTPUT',
      validation: {
        code: 'SCHEMA_VALIDATION_FAILED',
        issues: Array.from({ length: 80 }, (_, index) => ({
          path: ['world', index],
          code: 'too_small',
          message: `missing field ${index}`,
        })),
      },
      lifecycle: [audit('VALIDATE', 'FAILED', 'INVALID_OUTPUT')],
    });
    const failure = await sessionAIInspectorGateway.load('ADVANCED');
    expect(failure).toMatchObject({
      generation: { status: 'FAILED', errorCode: 'INVALID_OUTPUT' },
      provider: { id: null, model: null },
      latencyMs: 0,
      validation: { status: 'FAILED', code: 'SCHEMA_VALIDATION_FAILED' },
      repair: { attempted: false, status: 'SKIPPED' },
    });
    expect(failure?.validation.issues).toHaveLength(50);
    expect(failure?.validation.issues[0]?.code).toBe('too_small');
    expect(failure?.prompt).toEqual([]);
    expect(failure?.raw).toBeNull();
  });

  it('caps displayed sections and never retains API Key or Authorization material', async () => {
    const huge = 'x'.repeat(12_000);
    await recordAIInspectionFailure({
      task: 'NPC_REPLY',
      providerId: `apiKey=${huge}`,
      providerDisplayName: 'Authorization=Bearer inspector-token',
      model: huge,
      request: request(),
      raw: `Bearer inspector-token ${huge}`,
      parsed: { apiKey: 'sk-inspector-secret', authorization: 'Bearer inspector-token', huge },
      latencyMs: 90_000_000,
      errorCode: 'bad-code',
      lifecycle: Array.from({ length: 100 }, () => audit('GENERATE', 'STARTED', null)),
    });
    const snapshot = await sessionAIInspectorGateway.load('DEVELOPER');
    expect(snapshot?.latencyMs).toBe(86_400_000);
    expect(snapshot?.generation.errorCode).toBe('UNKNOWN');
    expect(snapshot?.lifecycle).toHaveLength(64);
    expect(snapshot?.raw?.content.length).toBeLessThanOrEqual(8_000);
    expect(snapshot?.provider.model?.length).toBe(8_000);
    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain('sk-inspector-secret');
    expect(serialized).not.toContain('Bearer inspector-token');
  });
});

function successInput() {
  return {
    task: 'NPC_REPLY' as const,
    providerId: 'provider-main',
    providerDisplayName: 'Provider Main',
    request: request(),
    response: response(),
    parsed: {
      publicSummary: 'public answer',
      secret: 'unreleased ending',
      authorization: 'Bearer inspector-token',
    },
    cachePrefixHash: 'a'.repeat(64),
    latencyMs: 125,
    lifecycle: [audit('REPAIR', 'STARTED', null), audit('REPAIR', 'SUCCEEDED', null)],
  };
}

function request(): NormalizedAIRequest {
  return {
    requestId: aiRequestId('request-inspector'),
    task: 'NPC_REPLY',
    promptVersion: promptVersion(1),
    modelName: 'model-main',
    messages: [
      { role: 'SYSTEM', content: 'core prompt with unreleased ending' },
      {
        role: 'USER',
        content: 'public request {"secret":"unreleased ending","apiKey":"sk-inspector-secret"}',
      },
    ],
    responseFormat: { kind: 'JSON_OBJECT' },
    temperature: 0.7,
    maxOutputTokens: 1_000,
    timeoutMs: 60_000,
  };
}

function response(): NormalizedAIResponse {
  return {
    requestId: aiRequestId('request-inspector'),
    providerRequestId: null,
    modelName: 'model-main',
    content:
      '{"publicSummary":"public answer","secret":"unreleased ending","authorization":"Bearer inspector-token"}',
    finishReason: 'STOP',
    usage: {
      inputTokens: 90,
      outputTokens: 20,
      totalTokens: 110,
      promptCacheHitTokens: 50,
      promptCacheMissTokens: 0,
    },
    receivedAt: isoTimestamp('2026-08-14T00:00:00.000Z'),
  };
}

function audit(
  stage: GeneratorAuditEntry['stage'],
  status: GeneratorAuditEntry['status'],
  code: string | null,
): GeneratorAuditEntry {
  return Object.freeze({ sequence: 1, stage, status, code });
}

import { isoTimestamp } from '@ember-tavern/contracts';
import { describe, expect, it } from 'vitest';

import { routeModel, selectStructuredFormat } from './model-router.js';
import type { ModelCapabilities, ModelInfo } from './protocol.js';

const checkedAt = isoTimestamp('2026-08-01T00:00:00.000Z');

function model(name: string, patch: Partial<ModelCapabilities>): ModelInfo {
  return {
    name,
    displayName: name,
    capabilities: {
      text: true,
      streaming: false,
      systemMessages: true,
      jsonMode: false,
      jsonSchema: false,
      toolCalling: false,
      reasoning: false,
      contextWindowTokens: 8192,
      costStatus: 'UNKNOWN',
      checkedAt,
      ...patch,
    },
  };
}

describe('model capability routing', () => {
  it('prefers JSON Schema, then JSON Object, while preserving candidate order on ties', () => {
    const text = model('text', {});
    const objectFirst = model('object-first', { jsonMode: true });
    const objectSecond = model('object-second', { jsonMode: true });
    const schema = model('schema', { jsonMode: true, jsonSchema: true });
    const requirements = {
      minimumContextTokens: 0,
      streaming: false,
      structuredOutput: true,
      allowTextFallback: true,
    };

    expect(routeModel([text, objectFirst, schema], requirements)).toEqual({
      model: schema,
      format: 'JSON_SCHEMA',
    });
    expect(routeModel([text, objectFirst, objectSecond], requirements).model).toBe(objectFirst);
  });

  it('falls back from unsupported JSON Schema to JSON Object explicitly', () => {
    const compatible = model('compatible-json', { jsonMode: true, jsonSchema: false });
    expect(selectStructuredFormat(compatible.capabilities)).toBe('JSON_OBJECT');
    expect(
      routeModel([compatible], {
        minimumContextTokens: 4096,
        streaming: false,
        structuredOutput: true,
        allowTextFallback: false,
      }),
    ).toEqual({ model: compatible, format: 'JSON_OBJECT' });
  });

  it('skips models that cannot meet streaming, context, or structured requirements', () => {
    const small = model('small', { jsonMode: true, contextWindowTokens: 2048 });
    const nonStreaming = model('batch', { jsonMode: true, contextWindowTokens: 32768 });
    const selected = model('streaming', {
      streaming: true,
      jsonSchema: true,
      contextWindowTokens: 32768,
    });
    expect(
      routeModel([small, nonStreaming, selected], {
        minimumContextTokens: 16000,
        streaming: true,
        structuredOutput: true,
        allowTextFallback: false,
      }).model.name,
    ).toBe('streaming');
  });

  it('allows text only for locally validated structured output', () => {
    const text = model('text-only', {});
    expect(
      routeModel([text], {
        minimumContextTokens: 0,
        streaming: false,
        structuredOutput: true,
        allowTextFallback: true,
      }),
    ).toEqual({ model: text, format: 'TEXT' });
    expect(() =>
      routeModel([text], {
        minimumContextTokens: 0,
        streaming: false,
        structuredOutput: true,
        allowTextFallback: false,
      }),
    ).toThrow(RangeError);
  });

  it('can select non-streaming or plain text models for an unstructured request', () => {
    const text = model('text-only', {});
    const schema = model('schema', { jsonSchema: true });
    expect(
      routeModel([text, schema], {
        minimumContextTokens: 0,
        streaming: false,
        structuredOutput: false,
        allowTextFallback: false,
      }),
    ).toEqual({ model: text, format: 'TEXT' });
  });

  it('never routes to a disabled model', () => {
    const disabled = { ...model('disabled-schema', { jsonSchema: true }), enabled: false };
    const enabled = model('enabled-object', { jsonMode: true });
    expect(
      routeModel([disabled, enabled], {
        minimumContextTokens: 0,
        streaming: false,
        structuredOutput: true,
        allowTextFallback: false,
      }).model,
    ).toBe(enabled);
  });

  it('rejects unknown or insufficient context and reports a stable no-candidate error', () => {
    const unknown = model('unknown-context', { contextWindowTokens: null });
    expect(() =>
      routeModel([unknown], {
        minimumContextTokens: 1,
        streaming: false,
        structuredOutput: false,
        allowTextFallback: false,
      }),
    ).toThrow('No configured model satisfies the task requirements');
    expect(() =>
      routeModel([], {
        minimumContextTokens: 0,
        streaming: false,
        structuredOutput: false,
        allowTextFallback: false,
      }),
    ).toThrow(RangeError);
  });
});

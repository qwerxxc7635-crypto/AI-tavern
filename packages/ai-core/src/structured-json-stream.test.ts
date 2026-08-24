import { describe, expect, it } from 'vitest';

import { StructuredJsonStreamProjector } from './structured-json-stream.js';
import type { StructuredJsonStreamError } from './structured-json-stream.js';

describe('StructuredJsonStreamProjector', () => {
  it('projects only a top-level string field in chunk order', () => {
    const projector = new StructuredJsonStreamProjector('reply');
    expect(projector.push('{"metadata":{"reply":"decoy"},"reply":"Stay')).toBe('Stay');
    expect(projector.push(' close.')).toBe(' close.');
    expect(projector.push('","mood":"Wary"}')).toBe('');
    expect(
      projector.finish('{"metadata":{"reply":"decoy"},"reply":"Stay close.","mood":"Wary"}'),
    ).toBe('');
    expect(projector.value()).toBe('Stay close.');
  });

  it('waits for complete unicode escapes and surrogate pairs', () => {
    const projector = new StructuredJsonStreamProjector('reply');
    expect(projector.push('{"reply":"炉火\\u')).toBe('炉火');
    expect(projector.push('D83D')).toBe('');
    expect(projector.push('\\uDE0A仍')).toBe('😊仍');
    expect(projector.push('明亮"}')).toBe('明亮');
    expect(projector.finish('{"reply":"炉火\\uD83D\\uDE0A仍明亮"}')).toBe('');
  });

  it('rejects a final payload that differs from streamed bytes', () => {
    const projector = new StructuredJsonStreamProjector('reply');
    projector.push('{"reply":"first"}');
    expect(() => projector.finish('{"reply":"second"}')).toThrowError(
      expect.objectContaining<Partial<StructuredJsonStreamError>>({
        code: 'STREAM_FINAL_MISMATCH',
      }),
    );
  });
});

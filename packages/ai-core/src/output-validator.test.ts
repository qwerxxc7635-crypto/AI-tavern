import { describe, expect, it } from 'vitest';

import { FAKE_TASK_OUTPUTS, validateAIOutput } from './index.js';

describe('AI output structure validation', () => {
  it('returns parsed JSON while retaining the exact raw response', () => {
    const raw = `\n${JSON.stringify(FAKE_TASK_OUTPUTS.GENERATE_WORLD)}\n`;
    const result = validateAIOutput('GENERATE_WORLD', raw);

    expect(result.ok).toBe(true);
    expect(result.rawResponseText).toBe(raw);
    if (result.ok) {
      expect(result.validatedOutput).toEqual(FAKE_TASK_OUTPUTS.GENERATE_WORLD);
      expect(result.validatedOutput).not.toBe(FAKE_TASK_OUTPUTS.GENERATE_WORLD);
    }
  });

  it('rejects invalid JSON with a stable root-level location and keeps the source', () => {
    const raw = '{"name":';
    const result = validateAIOutput('GENERATE_WORLD', raw);

    expect(result).toMatchObject({
      ok: false,
      rawResponseText: raw,
      error: {
        code: 'INVALID_JSON',
        issues: [{ path: [], code: 'invalid_json' }],
      },
    });
  });

  it('rejects a missing field and reports its path', () => {
    const withoutName: Record<string, unknown> = { ...FAKE_TASK_OUTPUTS.GENERATE_WORLD };
    delete withoutName['name'];
    const result = validateAIOutput('GENERATE_WORLD', JSON.stringify(withoutName));

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'SCHEMA_VALIDATION_FAILED',
        issues: [expect.objectContaining({ path: ['name'] })],
      },
    });
  });

  it('rejects an invalid enum and reports its path', () => {
    const invalid = { ...FAKE_TASK_OUTPUTS.GENERATE_QUEST, risk: 'IMPOSSIBLE' };
    const result = validateAIOutput('GENERATE_QUEST', JSON.stringify(invalid));

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'SCHEMA_VALIDATION_FAILED',
        issues: [expect.objectContaining({ path: ['risk'] })],
      },
    });
  });

  it('rejects an out-of-range nested value and reports the full path', () => {
    const invalid = {
      ...FAKE_TASK_OUTPUTS.GENERATE_ADVENTURE_TURN,
      checkRequest: {
        ...FAKE_TASK_OUTPUTS.GENERATE_ADVENTURE_TURN.checkRequest,
        difficulty: 99,
      },
    };
    const result = validateAIOutput('GENERATE_ADVENTURE_TURN', JSON.stringify(invalid));

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'SCHEMA_VALIDATION_FAILED',
        issues: [expect.objectContaining({ path: ['checkRequest', 'difficulty'] })],
      },
    });
  });
});

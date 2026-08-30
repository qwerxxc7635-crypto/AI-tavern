import { describe, expect, it } from 'vitest';

import { FAKE_TASK_OUTPUTS, validateAIOutput } from './index.js';

describe('AI output structure validation', () => {
  it('returns parsed JSON while retaining the exact raw response', () => {
    const raw = `\n${JSON.stringify(FAKE_TASK_OUTPUTS.GENERATE_WORLD)}\n`;
    const result = validateAIOutput('GENERATE_WORLD', raw);

    expect(result.ok).toBe(true);
    expect(result.rawResponseText).toBe(raw);
    if (result.ok) {
      expect(result.normalization).toBe('EXACT_JSON');
      expect(result.validatedOutput).toEqual(FAKE_TASK_OUTPUTS.GENERATE_WORLD);
      expect(result.validatedOutput).not.toBe(FAKE_TASK_OUTPUTS.GENERATE_WORLD);
    }
  });

  it('normalizes one JSON markdown fence before running the complete schema', () => {
    const raw = `\`\`\`json\n${JSON.stringify(FAKE_TASK_OUTPUTS.GENERATE_WORLD)}\n\`\`\``;
    const result = validateAIOutput('GENERATE_WORLD', raw);

    expect(result).toMatchObject({
      ok: true,
      rawResponseText: raw,
      normalization: 'MARKDOWN_FENCE',
      validatedOutput: FAKE_TASK_OUTPUTS.GENERATE_WORLD,
    });
  });

  it('extracts one unambiguous JSON object from short surrounding prose', () => {
    const raw = `这是生成结果：\n${JSON.stringify(FAKE_TASK_OUTPUTS.GENERATE_WORLD)}\n以上。`;
    const result = validateAIOutput('GENERATE_WORLD', raw);

    expect(result).toMatchObject({ ok: true, normalization: 'UNIQUE_JSON_OBJECT' });
  });

  it('does not guess when a response contains multiple JSON objects', () => {
    const valid = JSON.stringify(FAKE_TASK_OUTPUTS.GENERATE_WORLD);
    const result = validateAIOutput('GENERATE_WORLD', `${valid}\n${valid}`);

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'AMBIGUOUS_JSON', issues: [{ code: 'ambiguous_json' }] },
    });
  });

  it('does not treat an incomplete fenced object as repair-free valid JSON', () => {
    const result = validateAIOutput('GENERATE_WORLD', '```json\n{"name":\n```');

    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_JSON' } });
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

  it('rejects world references that the native business rules cannot commit', () => {
    const invalid = {
      ...FAKE_TASK_OUTPUTS.GENERATE_WORLD,
      locations: [
        {
          ...FAKE_TASK_OUTPUTS.GENERATE_WORLD.locations[0],
          parentName: '不存在的地点',
          factionNames: ['不存在的阵营'],
        },
      ],
    };
    const result = validateAIOutput('GENERATE_WORLD', JSON.stringify(invalid));

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'SCHEMA_VALIDATION_FAILED',
        issues: expect.arrayContaining([
          expect.objectContaining({ path: ['locations', 0, 'parentName'] }),
          expect.objectContaining({ path: ['locations', 0, 'factionNames', 0] }),
        ]),
      },
    });
  });

  it('keeps constitution drift structurally valid for the separate business-rule layer', () => {
    const valid = FAKE_TASK_OUTPUTS.GENERATE_WORLD;
    const invalid = {
      ...valid,
      technologyLevel: '不一致的技术水平',
      powerRules: [
        ...valid.powerRules.filter((rule) => rule !== valid.constitution.magic),
        '另一条仍然有效但不等于宪法魔法声明的规则。',
      ],
      forbiddenElements: [],
      constitution: { ...valid.constitution, taboos: ['禁止改写历史'] },
    };
    const result = validateAIOutput('GENERATE_WORLD', JSON.stringify(invalid));

    expect(result).toMatchObject({ ok: true });
  });

  it('rejects NPC rosters that the native residency and rumor rules cannot commit', () => {
    const output = FAKE_TASK_OUTPUTS.GENERATE_NPCS;
    const invalid = {
      ...output,
      npcs: output.npcs.map((npc) => ({ ...npc, residency: 'RESIDENT', visitReason: null })),
      rumors: output.rumors.map((rumor) => ({ ...rumor, sourceNpcName: '不存在的角色' })),
    };
    const result = validateAIOutput('GENERATE_NPCS', JSON.stringify(invalid));

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'SCHEMA_VALIDATION_FAILED',
        issues: expect.arrayContaining([
          expect.objectContaining({ path: ['npcs'] }),
          expect.objectContaining({ path: ['rumors', 0, 'sourceNpcName'] }),
        ]),
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

  it('rejects a wrong field type without coercion', () => {
    const invalid = { ...FAKE_TASK_OUTPUTS.GENERATE_WORLD, storyHooks: 'one hook' };
    const result = validateAIOutput('GENERATE_WORLD', JSON.stringify(invalid));

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'SCHEMA_VALIDATION_FAILED',
        issues: [expect.objectContaining({ path: ['storyHooks'] })],
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

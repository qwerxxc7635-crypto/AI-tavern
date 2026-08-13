import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { NATURAL_LANGUAGE_FIELDS } from './ai-field-inventory.js';

const sourceFiles = [
  'world-creation-page.tsx',
  'character-creation-page.tsx',
  'npc-dialogue-page.tsx',
  'adventure-page.tsx',
] as const;

describe('natural-language field inventory', () => {
  it('has unique ownership and exactly one source marker per field', () => {
    const ids = NATURAL_LANGUAGE_FIELDS.map(([id]) => id);
    expect(ids).toHaveLength(21);
    expect(new Set(ids).size).toBe(ids.length);

    for (const [id, owner] of NATURAL_LANGUAGE_FIELDS) {
      const source = readFileSync(new URL(`./${owner}`, import.meta.url), 'utf8');
      expect(source.match(new RegExp(`["']${id}["']`, 'g'))).toHaveLength(1);
    }
  });

  it('accounts for every literal data-ai-field marker with no omissions', () => {
    const marked = sourceFiles.flatMap((file) => {
      const source = readFileSync(new URL(`./${file}`, import.meta.url), 'utf8');
      return [...source.matchAll(/data-ai-field="([^"]+)"/g)].flatMap((match) =>
        match[1] === undefined ? [] : [match[1]],
      );
    });
    const inventory = new Set<string>(NATURAL_LANGUAGE_FIELDS.map(([id]) => id));
    expect(marked).toHaveLength(13);
    expect(new Set(marked).size).toBe(marked.length);
    expect(marked.every((id) => inventory.has(id))).toBe(true);
  });

  it('routes free-action fields to ActionComposer and post-draft facts to lockable ownership', () => {
    expect(
      NATURAL_LANGUAGE_FIELDS.filter(([, , owner]) => owner === 'ACTION_COMPOSER'),
    ).toHaveLength(2);
    expect(
      NATURAL_LANGUAGE_FIELDS.filter(([, , owner]) => owner === 'WORLD_LOCKABLE'),
    ).toHaveLength(9);
  });
});

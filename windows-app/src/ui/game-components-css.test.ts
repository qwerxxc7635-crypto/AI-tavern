import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./game-components.css', import.meta.url), 'utf8');
const tokens = readFileSync(new URL('../design-tokens.css', import.meta.url), 'utf8');

describe('game component visual contract', () => {
  it('uses defined tokens with no raw colors', () => {
    expect(css).not.toMatch(/#[0-9a-f]{3,8}|rgba?\(/i);
    const definitions = new Set([...tokens.matchAll(/(--[\w-]+)\s*:/g)].map((match) => match[1]));
    const usages = new Set([...css.matchAll(/var\((--[\w-]+)/g)].map((match) => match[1]));
    expect([...usages].filter((usage) => !definitions.has(usage))).toEqual([]);
  });

  it('keeps cards and dialogue usable below the compact sidebar breakpoint', () => {
    expect(css).toMatch(
      /@media \(max-width: 760px\)[\s\S]*\.game-character-card,[\s\S]*grid-template-columns: auto minmax\(0, 1fr\)/,
    );
    expect(css).toMatch(
      /@media \(max-width: 760px\)[\s\S]*\.game-dialogue__message\s*\{\s*max-width: 92%/,
    );
  });

  it('shows selection with structure as well as color and supports forced colors', () => {
    const selected = block(
      '.game-npc-card.is-selected,\n.game-quest-card.is-selected,\n.game-trait-card.is-selected',
    );
    expect(selected).toContain('box-shadow: var(--shadow-selection-rail)');
    expect(css).toMatch(
      /\.game-action-composer__suggestions \[aria-pressed='true'\][\s\S]*box-shadow:/,
    );
    expect(css).toContain('@media (forced-colors: active)');
  });
});

function block(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new TypeError(`Missing selector ${selector}`);
  const end = css.indexOf('}', start);
  if (end < 0) throw new TypeError(`Unclosed selector ${selector}`);
  return css.slice(start, end + 1);
}

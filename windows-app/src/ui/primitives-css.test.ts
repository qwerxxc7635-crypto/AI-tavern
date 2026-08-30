import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./primitives.css', import.meta.url), 'utf8');
const tokens = readFileSync(new URL('../design-tokens.css', import.meta.url), 'utf8');

describe('UI primitive visual contract', () => {
  it('uses tokens rather than raw colors and defines every consumed variable', () => {
    expect(css).not.toMatch(/#[0-9a-f]{3,8}|rgba?\(/i);
    const definitions = new Set([...tokens.matchAll(/(--[\w-]+)\s*:/g)].map((match) => match[1]));
    const usages = new Set([...css.matchAll(/var\((--[\w-]+)/g)].map((match) => match[1]));
    expect([...usages].filter((usage) => !definitions.has(usage))).toEqual([]);
  });

  it('keeps interactive targets comfortable and keyboard focus visible', () => {
    expect(block('.ui-button')).toContain('min-width: 2.75rem');
    expect(block('.ui-button')).toContain('min-height: 2.75rem');
    expect(block('.ui-field__control')).toContain('min-height: 2.75rem');
    expect(css).toMatch(
      /\.ui-button:focus-visible,[\s\S]*outline: var\(--border-width-medium\) solid var\(--control-focus-ring\)/,
    );
  });

  it('supports reduced motion, forced colors, overlays and responsive drawers', () => {
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.ui-spinner,[\s\S]*animation: none/,
    );
    expect(css).toContain('@media (forced-colors: active)');
    expect(css).toContain('.ui-dialog::backdrop');
    expect(block('.ui-dialog--drawer')).toContain('height: 100dvh');
  });
});

function block(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new TypeError(`Missing selector ${selector}`);
  const end = css.indexOf('}', start);
  if (end < 0) throw new TypeError(`Unclosed selector ${selector}`);
  return css.slice(start, end + 1);
}

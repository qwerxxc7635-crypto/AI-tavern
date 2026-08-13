import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const tokens = readFileSync(new URL('./design-tokens.css', import.meta.url), 'utf8');
const theme = readFileSync(new URL('./theme.css', import.meta.url), 'utf8');
const allStyles = `${tokens}\n${theme}`;

describe('three-layer design-token contract', () => {
  it('defines every required category and keeps layers ordered', () => {
    const primitive = tokens.indexOf('/* === PRIMITIVE TOKENS === */');
    const semantic = tokens.indexOf('/* === SEMANTIC TOKENS === */');
    const component = tokens.indexOf('/* === COMPONENT TOKENS === */');
    expect(primitive).toBeGreaterThanOrEqual(0);
    expect(semantic).toBeGreaterThan(primitive);
    expect(component).toBeGreaterThan(semantic);

    for (const category of [
      '--et-color-',
      '--et-font-',
      '--et-space-',
      '--et-radius-',
      '--et-shadow-',
      '--et-duration-',
      '--et-layer-',
    ]) {
      expect(tokens, category).toContain(category);
    }
  });

  it('keeps raw color values in the primitive layer and components off primitive names', () => {
    const semantic = section('/* === SEMANTIC TOKENS === */', '/* === COMPONENT TOKENS === */');
    const component = section('/* === COMPONENT TOKENS === */', '/* === PAPER THEME === */');
    expect(semantic).not.toMatch(/#[0-9a-f]{3,8}|rgba?\(/i);
    expect(component).not.toMatch(/#[0-9a-f]{3,8}|rgba?\(/i);
    expect(component).not.toMatch(/var\(--et-/);
  });

  it('defines every custom property used by application styles', () => {
    const definitions = new Set(
      [...allStyles.matchAll(/(--[\w-]+)\s*:/g)].map((match) => match[1]),
    );
    const usages = new Set([...allStyles.matchAll(/var\((--[\w-]+)/g)].map((match) => match[1]));
    expect([...usages].filter((usage) => !definitions.has(usage))).toEqual([]);
  });

  it('moves core-shell and paper-page colors to tokens while bounding legacy hardcodes', () => {
    const rawThemeColors = theme.match(/#[0-9a-f]{3,8}|rgba?\([^)]*\)/gi) ?? [];
    expect(rawThemeColors.length).toBeLessThanOrEqual(45);

    for (const selector of [
      'body',
      '.sidebar',
      ".navigation a[aria-current='page']",
      '.titlebar',
      '.dialogue-room',
      '.dialogue-panel,\n.dialogue-sidebar section',
      '.my-hub__entry',
      '.adventure-page',
      '.adventure-columns',
      '.quest-board-page',
      '.quest-board-layout',
    ]) {
      expect(block(theme, selector), selector).not.toMatch(/#[0-9a-f]{3,8}|rgba?\(/i);
    }
  });

  it('reduces semantic motion durations and disables legacy animations on request', () => {
    expect(tokens).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*--duration-interface: var\(--et-duration-instant\)/,
    );
    expect(theme).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.navigation a\s*\{\s*transition: none;/,
    );
    expect(theme).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.d20-animation__die\s*\{\s*animation: none;/,
    );
  });
});

describe('four-resolution token smoke contract', () => {
  it.each([
    [860, 600],
    [1180, 760],
    [1366, 768],
    [1920, 1080],
  ])('keeps the application shell viable at %ix%i', (width, height) => {
    const sidebarWidth = width <= 760 ? 5.2 * 16 : 15.5 * 16;
    const workspaceWidth = width - sidebarWidth;
    expect(workspaceWidth).toBeGreaterThanOrEqual(612);
    expect(height).toBeGreaterThanOrEqual(600);
    expect(theme).toContain('grid-template-columns: 15.5rem minmax(0, 1fr)');
    expect(theme).toMatch(
      /@media \(max-width: 760px\)[\s\S]*?\.app-frame\s*\{\s*grid-template-columns: 5\.2rem minmax\(0, 1fr\)/,
    );
  });
});

function section(start: string, end: string): string {
  const from = tokens.indexOf(start);
  const to = tokens.indexOf(end);
  if (from < 0 || to <= from) throw new TypeError(`Missing token section ${start}`);
  return tokens.slice(from, to);
}

function block(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new TypeError(`Missing CSS selector ${selector}`);
  const end = css.indexOf('}', start);
  if (end < 0) throw new TypeError(`Unclosed CSS selector ${selector}`);
  return css.slice(start, end + 1);
}

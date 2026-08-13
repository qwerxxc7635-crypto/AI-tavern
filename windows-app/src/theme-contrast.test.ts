import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const tokens = readFileSync(new URL('./design-tokens.css', import.meta.url), 'utf8');

describe('design-token theme contrast', () => {
  it.each([
    ['dark primary text', '--et-color-slate-100', '--et-color-night-900', 7],
    ['dark secondary text', '--et-color-slate-400', '--et-color-night-900', 4.5],
    ['dark accent text', '--et-color-copper-500', '--et-color-night-900', 4.5],
    ['dark focus ring', '--et-color-moss-400', '--et-color-night-900', 3],
    ['paper primary text', '--et-color-ink-900', '--et-color-paper-100', 7],
    ['paper secondary text', '--et-color-ink-500', '--et-color-paper-100', 4.5],
    ['paper accent text', '--et-color-ember-600', '--et-color-paper-100', 4.5],
    ['paper positive text', '--et-color-moss-700', '--et-color-paper-100', 4.5],
  ])('%s meets its WCAG contrast contract', (_label, foreground, background, minimum) => {
    expect(contrast(requireHex(foreground), requireHex(background))).toBeGreaterThanOrEqual(
      minimum,
    );
  });

  it('overrides semantic colors only inside the three paper-theme pages', () => {
    const paperTheme = tokens.match(
      /\.dialogue-room,\s*\.quest-board-page,\s*\.adventure-page\s*\{(?<body>[^}]+)\}/,
    );
    expect(paperTheme?.groups?.['body']).toContain('--color-text-primary: var(--et-color-ink-900)');
    expect(paperTheme?.groups?.['body']).toContain('--color-focus-ring: var(--et-color-ember-600)');
  });
});

function requireHex(name: string): string {
  const match = tokens.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (match?.[1] === undefined) throw new TypeError(`Missing ${name} primitive`);
  return match[1];
}

function contrast(foreground: string, background: string): number {
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

function luminance(hex: string): number {
  const channel = (offset: number) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const red = channel(1);
  const green = channel(3);
  const blue = channel(5);
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./theme.css', import.meta.url), 'utf8');

describe('paper-theme contrast', () => {
  it('scopes the readable palette to dialogue, quest, and adventure pages', () => {
    const palette = css.match(
      /\.dialogue-room,\s*\.quest-board-page,\s*\.adventure-page\s*\{(?<body>[^}]+)\}/,
    );

    expect(palette?.groups?.['body']).toBeDefined();
    const values = paletteValues(palette?.groups?.['body'] ?? '');

    expect(contrast(values.ink, values.paper)).toBeGreaterThanOrEqual(7);
    expect(contrast(values.muted, values.paper)).toBeGreaterThanOrEqual(4.5);
    expect(css).toMatch(/\.dialogue-room\s*\{[^}]+var\(--paper\)/s);
  });
});

function paletteValues(body: string) {
  return {
    ink: requireHex(body, '--ink'),
    muted: requireHex(body, '--muted'),
    paper: requireHex(body, '--paper'),
  };
}

function requireHex(body: string, name: string): string {
  const match = body.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (match?.[1] === undefined) throw new TypeError(`Missing ${name} palette value`);
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

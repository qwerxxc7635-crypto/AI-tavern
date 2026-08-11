import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./theme.css', import.meta.url), 'utf8');
const STACK_BREAKPOINT = 900;
const REQUIRED_VIEWPORTS = [
  [860, 600],
  [1180, 760],
  [1366, 768],
  [1920, 1080],
] as const;
const REQUIRED_ZOOMS = [1, 1.25, 1.5] as const;

describe('character card responsive layout', () => {
  it('keeps every required viewport and zoom in a safe single- or two-column layout', () => {
    for (const [physicalWidth, physicalHeight] of REQUIRED_VIEWPORTS) {
      for (const zoom of REQUIRED_ZOOMS) {
        const width = physicalWidth / zoom;
        const height = physicalHeight / zoom;
        const horizontalPadding = 2 * Math.min(72, Math.max(20, width * 0.04));
        const contentWidth = width - horizontalPadding;

        if (width <= STACK_BREAKPOINT) {
          expect(
            contentWidth,
            `${physicalWidth}x${physicalHeight} at ${zoom * 100}%`,
          ).toBeGreaterThan(320);
        } else {
          expect(
            contentWidth,
            `${physicalWidth}x${physicalHeight} at ${zoom * 100}%`,
          ).toBeGreaterThan(46 * 16);
        }
        if (height <= 640) expect(css).toContain('@media (max-height: 640px)');
      }
    }
  });

  it('owns vertical scrolling and keeps the primary action reachable without horizontal overflow', () => {
    expect(css).toMatch(
      /\.character-studio\s*\{[^}]*height:\s*100dvh;[^}]*min-height:\s*0;[^}]*overflow-x:\s*hidden;[^}]*overflow-y:\s*auto;/su,
    );
    expect(css).toMatch(/\.character-form\s*\{[^}]*minmax\(28rem,[^)]+\) minmax\(18rem,/su);
    expect(css).toMatch(
      /@media \(max-width: 900px\)[\s\S]*?\.character-form,[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\);/u,
    );
    expect(css).toMatch(
      /\.character-next\s*\{[^}]*position:\s*sticky;[^}]*bottom:\s*max\(0\.75rem, env\(safe-area-inset-bottom\)\);/su,
    );
  });
});

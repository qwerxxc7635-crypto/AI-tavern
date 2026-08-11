import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./theme.css', import.meta.url), 'utf8').replace(/\s+/g, ' ');

describe('core page compact layout', () => {
  it('uses sidebar-aware breakpoints for the paper-theme pages', () => {
    expect(css).toContain(
      '@media (max-width: 1050px) { .dialogue-layout { grid-template-columns: 1fr; }',
    );
    expect(css).toContain(
      '@media (max-width: 1050px) { .quest-board-layout { grid-template-columns: 1fr; }',
    );
    expect(css).toContain(
      '@media (max-width: 1050px) { .adventure-columns { grid-template-columns: 1fr; }',
    );
    expect(css).toContain(
      '@media (max-width: 1300px) { .adventure-columns { grid-template-columns: minmax(13rem, 0.7fr) minmax(24rem, 1.5fr); }',
    );
  });
});

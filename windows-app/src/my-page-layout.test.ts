import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./theme.css', import.meta.url), 'utf8').replace(/\s+/g, ' ');

describe('My page compact layout', () => {
  it('stacks the hub before the sidebar reduces an 860px window', () => {
    expect(css).toContain(
      '@media (max-width: 1050px) { .my-hub__layout { grid-template-columns: 1fr; }',
    );
  });
});

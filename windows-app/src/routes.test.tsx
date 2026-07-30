import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { AppRoutes } from './routes.js';

describe('Windows application routes', () => {
  it('renders the launch route with a value imported from shared contracts', () => {
    const html = render('/');

    expect(html).toContain('Ember Tavern');
    expect(html).toContain('Schema v1');
    expect(html).toContain('桌面运行时');
  });

  it('renders a stable not-found route', () => {
    expect(render('/missing')).toContain('这条路还没有点灯');
  });
});

function render(path: string): string {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes />
    </MemoryRouter>,
  );
}

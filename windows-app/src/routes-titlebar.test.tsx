// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import { AppShell } from './routes.js';

afterEach(cleanup);

describe('AppShell titlebar', () => {
  it('labels the model settings route instead of presenting it as unknown', () => {
    render(
      <MemoryRouter initialEntries={['/settings?campaignId=campaign-titlebar']}>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="settings" element={<main>设置内容</main>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText('模型设置', { selector: '.titlebar__title' })).toBeTruthy();
    expect(screen.queryByText('未知路径')).toBeNull();
  });

  it('shows a campaign-preserving parent breadcrumb for entity pages', () => {
    render(
      <MemoryRouter initialEntries={['/npc?campaignId=campaign-titlebar&npcId=npc-one']}>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="npc" element={<main>对话内容</main>} />
            <Route path="tavern" element={<main>酒馆内容</main>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    const breadcrumbs = screen.getByRole('navigation', { name: '当前位置' });
    expect(breadcrumbs.textContent).toContain('酒馆/NPC 对话');
    expect(within(breadcrumbs).getByRole('link', { name: '酒馆' }).getAttribute('href')).toBe(
      '/tavern?campaignId=campaign-titlebar',
    );
    expect(within(breadcrumbs).getByText('NPC 对话').getAttribute('aria-current')).toBe('page');
    fireEvent.click(within(breadcrumbs).getByRole('link', { name: '酒馆' }));
    expect(screen.getByText('酒馆内容')).toBeTruthy();
    expect(screen.getByText('存档 campaign')).toBeTruthy();
  });
});

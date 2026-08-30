// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppLoading, AppRoutes, AppShell, WINDOWS_NAVIGATION } from './routes.js';
import { AppErrorBoundary } from './ui-states.js';

afterEach(cleanup);

describe('Windows application shell', () => {
  it('navigates all six required sections through the shared shell', async () => {
    render(
      <MemoryRouter initialEntries={['/tavern?campaignId=campaign-shell']}>
        <Routes>
          <Route element={<AppShell />}>
            {WINDOWS_NAVIGATION.map(({ path, label }) => (
              <Route
                key={path}
                path={path.slice(1)}
                element={
                  <main>
                    <h1>{label}</h1>
                  </main>
                }
              />
            ))}
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole('navigation', { name: '主导航' })).toBeTruthy();
    expect(screen.getByRole('link', { name: '跳到主要内容' }).getAttribute('href')).toBe(
      '#app-main',
    );
    expect(document.querySelector('#app-main')?.getAttribute('tabindex')).toBe('-1');
    fireEvent.click(screen.getByRole('link', { name: '跳到主要内容' }));
    expect(document.activeElement).toBe(document.querySelector('#app-main'));
    expect(WINDOWS_NAVIGATION).toHaveLength(6);
    expect(screen.getByRole('heading', { name: '酒馆' })).toBeTruthy();
    expect(screen.getByRole('link', { name: '酒馆' }).getAttribute('aria-current')).toBe('page');

    for (const { label } of WINDOWS_NAVIGATION.slice(1)) {
      fireEvent.click(screen.getByRole('link', { name: label }));
      expect(await screen.findByRole('heading', { name: label })).toBeTruthy();
      expect(screen.getByRole('link', { name: label }).getAttribute('aria-current')).toBe('page');
    }
  });

  it('keeps only campaign context when leaving an entity deep link', () => {
    render(
      <MemoryRouter initialEntries={['/npc?campaignId=campaign-deep-link&npcId=npc-one']}>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="npc" element={<main>NPC 页面</main>} />
            <Route
              path="quests"
              element={
                <main>
                  <LocationValue />
                </main>
              }
            />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('link', { name: '任务' }));
    expect(screen.getByText('/quests?campaignId=campaign-deep-link')).toBeTruthy();
  });

  it('routes campaign-only navigation through save selection in a local session', async () => {
    render(
      <MemoryRouter initialEntries={['/my']}>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="my" element={<main>我的页面</main>} />
            <Route path="saves" element={<main>存档页面</main>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    const navigation = screen.getByRole('navigation', { name: '主导航' });
    expect(within(navigation).getByRole('link', { name: '我的' }).getAttribute('href')).toBe('/my');
    expect(within(navigation).getByRole('link', { name: '酒馆' }).getAttribute('href')).toBe(
      '/saves',
    );

    fireEvent.click(within(navigation).getByRole('link', { name: '酒馆' }));
    expect(await screen.findByText('存档页面')).toBeTruthy();
  });

  it('keeps the settings breadcrumb pointed at My without campaign context', async () => {
    render(
      <MemoryRouter initialEntries={['/settings']}>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="settings" element={<main>设置页面</main>} />
            <Route path="my" element={<main>我的页面</main>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    const breadcrumbs = screen.getByRole('navigation', { name: '当前位置' });
    const myLink = within(breadcrumbs).getByRole('link', { name: '我的' });
    expect(myLink.getAttribute('href')).toBe('/my');

    fireEvent.click(myLink);
    expect(await screen.findByText('我的页面')).toBeTruthy();
  });

  it.each([
    ['/tavern', '链接缺少存档信息。'],
    ['/npc?campaignId=campaign-route', '链接缺少NPC信息。'],
    ['/tavern?campaignId=%20bad', '存档链接无效。'],
    ['/tavern?campaignId=one&campaignId=two', '存档链接无效。'],
  ])('rejects an incomplete or invalid deep link %s', async (entry, message) => {
    render(
      <MemoryRouter initialEntries={[entry]}>
        <AppRoutes />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: message })).toBeTruthy();
    expect(screen.getByRole('link', { name: '返回存档首页' })).toBeTruthy();
  });

  it('renders the loading state with accessible progress semantics', () => {
    render(<AppLoading />);

    expect(screen.getByText('正在整理桌面…')).toBeTruthy();
    expect(screen.getByRole('main').getAttribute('aria-busy')).toBe('true');
  });

  it('contains failures without exposing the raw exception text', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(
      <AppErrorBoundary>
        <BrokenPage />
      </AppErrorBoundary>,
    );

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText('这个页面暂时无法打开。')).toBeTruthy();
    expect(screen.queryByText('private failure detail')).toBeNull();
    consoleError.mockRestore();
  });
});

function LocationValue() {
  const location = useLocation();
  return `${location.pathname}${location.search}`;
}

function BrokenPage(): never {
  throw new Error('private failure detail');
}

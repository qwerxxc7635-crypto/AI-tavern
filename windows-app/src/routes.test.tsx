// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppLoading, AppRoutes, WINDOWS_NAVIGATION } from './routes.js';
import { AppErrorBoundary } from './ui-states.js';

afterEach(cleanup);

describe('Windows application shell', () => {
  it('navigates all six required sections through the shared shell', async () => {
    render(
      <MemoryRouter initialEntries={['/tavern']}>
        <AppRoutes />
      </MemoryRouter>,
    );

    expect(screen.getByRole('navigation', { name: '主导航' })).toBeTruthy();
    expect(WINDOWS_NAVIGATION).toHaveLength(6);
    expect(
      await screen.findByRole(
        'heading',
        { name: '先从存档首页选择一段旅程。' },
        { timeout: 5_000 },
      ),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: '酒馆' }).getAttribute('aria-current')).toBe('page');

    for (const { label } of WINDOWS_NAVIGATION.slice(1)) {
      fireEvent.click(screen.getByRole('link', { name: label }));
      expect(await screen.findByRole('heading', { name: label })).toBeTruthy();
      expect(screen.getByRole('link', { name: label }).getAttribute('aria-current')).toBe('page');
    }
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

function BrokenPage(): never {
  throw new Error('private failure detail');
}

// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { AppShell } from './routes.js';

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

    expect(screen.getByText('模型设置')).toBeTruthy();
    expect(screen.queryByText('未知路径')).toBeNull();
  });
});

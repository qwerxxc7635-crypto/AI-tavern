// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import { RecoveryPage } from './recovery-page.js';
import type { RecoveryGateway } from './recovery-service.js';

afterEach(cleanup);

describe('recovery page', () => {
  it('shows an actionable recovery entry and restores the persisted resume state', async () => {
    const gateway: RecoveryGateway = {
      async inspect() {
        return {
          campaign: {
            id: 'campaign-recovery',
            state: 'RECOVERY_REQUIRED',
            createdAt: '2026-08-01T00:00:00.000Z',
            updatedAt: '2026-08-01T00:01:00.000Z',
          },
          resumeState: 'ADVENTURE',
          unfinishedRequestCount: 1,
        };
      },
      async restore() {
        return {
          id: 'campaign-recovery',
          state: 'ADVENTURE',
          createdAt: '2026-08-01T00:00:00.000Z',
          updatedAt: '2026-08-01T00:02:00.000Z',
        };
      },
    };
    render(
      <MemoryRouter initialEntries={['/recovery?campaignId=campaign-recovery']}>
        <Routes>
          <Route path="/recovery" element={<RecoveryPage gateway={gateway} />} />
          <Route path="/adventure" element={<LocationEcho />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: '恢复未完成的操作' })).toBeTruthy();
    expect(screen.getByText('待取消的未完成请求：1')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '恢复最近完整状态' }));
    expect(await screen.findByText('/adventure?campaignId=campaign-recovery')).toBeTruthy();
  });
});

function LocationEcho() {
  const location = useLocation();
  return <p>{`${location.pathname}${location.search}`}</p>;
}

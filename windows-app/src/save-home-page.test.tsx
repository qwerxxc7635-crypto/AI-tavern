// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CampaignGateway, CampaignSummary } from './campaign-gateway.js';
import { SaveHomePage } from './save-home-page.js';

const EXISTING_CAMPAIGN: CampaignSummary = {
  id: 'campaign-existing',
  state: 'TAVERN',
  createdAt: '2026-07-30T08:00:00.000Z',
  updatedAt: '2026-07-31T09:30:00.000Z',
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('save home page', () => {
  it('loads durable campaigns and shows their last-played time', async () => {
    const gateway = new FakeCampaignGateway([EXISTING_CAMPAIGN]);
    renderSaveHome(gateway);

    expect(await screen.findByRole('heading', { name: '存档 campaign' })).toBeTruthy();
    const timestamp = screen.getByText((_content, element) => element?.tagName === 'TIME');
    expect(timestamp.getAttribute('datetime')).toBe(EXISTING_CAMPAIGN.updatedAt);
    expect(gateway.listCalls).toBe(1);
  });

  it('creates and archives campaigns through the gateway before refreshing the list', async () => {
    const gateway = new FakeCampaignGateway([]);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderSaveHome(gateway);

    expect(await screen.findByText('炉边还没有你的故事。')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '新建存档' }));
    expect(await screen.findByRole('heading', { name: '存档 campaign' })).toBeTruthy();
    expect(gateway.createCalls).toBe(1);

    fireEvent.click(screen.getByRole('button', { name: '归档' }));
    expect(await screen.findByText('炉边还没有你的故事。')).toBeTruthy();
    expect(gateway.archiveCalls).toEqual(['campaign-created']);
  });

  it('continues a verified campaign and carries its identifier into the shell route', async () => {
    const gateway = new FakeCampaignGateway([EXISTING_CAMPAIGN]);
    renderSaveHome(gateway);

    fireEvent.click(await screen.findByRole('button', { name: '继续' }));
    expect(await screen.findByText('已进入 campaign-existing')).toBeTruthy();
    expect(gateway.continueCalls).toEqual(['campaign-existing']);
  });

  it('returns unfinished world campaigns to the world creation route', async () => {
    const gateway = new FakeCampaignGateway([{ ...EXISTING_CAMPAIGN, state: 'REVIEWING_WORLD' }]);
    renderSaveHome(gateway);

    fireEvent.click(await screen.findByRole('button', { name: '继续' }));
    expect(await screen.findByText('继续构筑 campaign-existing')).toBeTruthy();
  });

  it('reloads campaigns from the persistence gateway after a simulated application restart', async () => {
    const gateway = new FakeCampaignGateway([EXISTING_CAMPAIGN]);
    const firstRun = renderSaveHome(gateway);
    expect(await screen.findByRole('heading', { name: '存档 campaign' })).toBeTruthy();
    firstRun.unmount();

    renderSaveHome(gateway);
    expect(await screen.findByRole('heading', { name: '存档 campaign' })).toBeTruthy();
    await waitFor(() => expect(gateway.listCalls).toBe(2));
  });
});

function renderSaveHome(gateway: CampaignGateway) {
  return render(
    <MemoryRouter initialEntries={['/saves']}>
      <Routes>
        <Route path="/saves" element={<SaveHomePage gateway={gateway} />} />
        <Route path="/tavern" element={<CampaignRouteEcho />} />
        <Route path="/world" element={<WorldRouteEcho />} />
      </Routes>
    </MemoryRouter>,
  );
}

function CampaignRouteEcho() {
  const location = useLocation();
  const id = new URLSearchParams(location.search).get('campaignId');
  return <p>已进入 {id ?? '未选择'}</p>;
}

function WorldRouteEcho() {
  const location = useLocation();
  const id = new URLSearchParams(location.search).get('campaignId');
  return <p>继续构筑 {id ?? '未选择'}</p>;
}

class FakeCampaignGateway implements CampaignGateway {
  public listCalls = 0;
  public createCalls = 0;
  public readonly continueCalls: string[] = [];
  public readonly archiveCalls: string[] = [];

  public constructor(private campaigns: readonly CampaignSummary[]) {}

  public async list(): Promise<readonly CampaignSummary[]> {
    this.listCalls += 1;
    return this.campaigns;
  }

  public async create(): Promise<CampaignSummary> {
    this.createCalls += 1;
    const created: CampaignSummary = {
      id: 'campaign-created',
      state: 'CREATING_WORLD',
      createdAt: '2026-07-31T10:00:00.000Z',
      updatedAt: '2026-07-31T10:00:00.000Z',
    };
    this.campaigns = [created, ...this.campaigns];
    return created;
  }

  public async continueCampaign(id: string): Promise<CampaignSummary> {
    this.continueCalls.push(id);
    const campaign = this.campaigns.find((candidate) => candidate.id === id);
    if (campaign === undefined) throw new Error('not found');
    return campaign;
  }

  public async archive(id: string): Promise<void> {
    this.archiveCalls.push(id);
    this.campaigns = this.campaigns.filter((campaign) => campaign.id !== id);
  }
}

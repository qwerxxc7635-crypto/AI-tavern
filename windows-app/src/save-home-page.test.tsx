// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CampaignGateway, CampaignSummary } from './campaign-gateway.js';
import { SaveHomePage } from './save-home-page.js';
import type { CampaignArchiveImportMode, SaveTransferGateway } from './save-transfer-gateway.js';

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

  it('permanently deletes an exported campaign only after explicit confirmation', async () => {
    const gateway = new FakeCampaignGateway([EXISTING_CAMPAIGN]);
    const confirm = vi
      .spyOn(window, 'confirm')
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    renderSaveHome(gateway);

    fireEvent.click(await screen.findByRole('button', { name: '永久删除' }));
    expect(gateway.deleteCalls).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: '永久删除' }));
    expect((await screen.findByRole('status')).textContent).toContain('已永久删除');
    expect(gateway.deleteCalls).toEqual([EXISTING_CAMPAIGN.id]);
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('完整数据库备份'));
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

  it('returns unfinished character campaigns to the dedicated creation route', async () => {
    const gateway = new FakeCampaignGateway([
      { ...EXISTING_CAMPAIGN, state: 'CREATING_CHARACTER' },
    ]);
    renderSaveHome(gateway);

    fireEvent.click(await screen.findByRole('button', { name: '继续' }));
    expect(await screen.findByText('继续车卡 campaign-existing')).toBeTruthy();
  });

  it('returns an active campaign to its persisted adventure', async () => {
    const gateway = new FakeCampaignGateway([{ ...EXISTING_CAMPAIGN, state: 'ADVENTURE' }]);
    renderSaveHome(gateway);

    fireEvent.click(await screen.findByRole('button', { name: '继续' }));
    expect(await screen.findByText('继续冒险 campaign-existing')).toBeTruthy();
  });

  it('routes a recoverable campaign to the visible recovery center', async () => {
    const gateway = new FakeCampaignGateway([{ ...EXISTING_CAMPAIGN, state: 'RECOVERY_REQUIRED' }]);
    renderSaveHome(gateway);

    fireEvent.click(await screen.findByRole('button', { name: '继续' }));
    expect(await screen.findByText('恢复 campaign-existing')).toBeTruthy();
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

  it('exports a campaign to the location selected by the user', async () => {
    const gateway = new FakeCampaignGateway([EXISTING_CAMPAIGN]);
    const transfers = new FakeSaveTransferGateway();
    transfers.exportPath = 'D:\\Saves\\campaign-existing.emtavern';
    renderSaveHome(gateway, transfers);

    fireEvent.click(await screen.findByRole('button', { name: '导出' }));
    expect((await screen.findByRole('status')).textContent).toContain('已导出到所选位置');
    expect(transfers.exportCalls).toEqual([
      [EXISTING_CAMPAIGN.id, 'D:\\Saves\\campaign-existing.emtavern'],
    ]);
    expect(transfers.suggestedNames).toEqual(['campaign-existing.emtavern']);
  });

  it('imports a selected archive in create mode and refreshes the campaign list', async () => {
    const gateway = new FakeCampaignGateway([]);
    const transfers = new FakeSaveTransferGateway();
    transfers.importPath = 'D:\\Saves\\new.emtavern';
    renderSaveHome(gateway, transfers);

    fireEvent.click(await screen.findByRole('button', { name: '导入存档' }));
    expect((await screen.findByRole('status')).textContent).toContain('已导入存档 imported');
    expect(transfers.importCalls).toEqual([['D:\\Saves\\new.emtavern', 'CREATE']]);
    expect(gateway.listCalls).toBe(2);
  });

  it('confirms overwrite for a conflicting archive and accepts a single dropped file', async () => {
    const gateway = new FakeCampaignGateway([EXISTING_CAMPAIGN]);
    const transfers = new FakeSaveTransferGateway();
    transfers.importPath = 'D:\\Saves\\existing.emtavern';
    transfers.inspection = { campaignId: EXISTING_CAMPAIGN.id, campaignExists: true };
    vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    renderSaveHome(gateway, transfers);
    await waitFor(() => expect(transfers.dropHandler).not.toBeNull());

    fireEvent.click(screen.getByRole('button', { name: '导入存档' }));
    await waitFor(() =>
      expect((screen.getByRole('button', { name: '导入存档' }) as HTMLButtonElement).disabled).toBe(
        false,
      ),
    );
    expect(transfers.importCalls).toEqual([]);

    await act(async () => {
      transfers.drop(['D:\\Saves\\existing.emtavern']);
    });
    expect((await screen.findByRole('status')).textContent).toContain('已导入存档 imported');
    expect(transfers.importCalls).toEqual([['D:\\Saves\\existing.emtavern', 'OVERWRITE']]);
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('完整数据库备份'));
  });
});

function renderSaveHome(
  gateway: CampaignGateway,
  transferGateway: SaveTransferGateway = new FakeSaveTransferGateway(),
) {
  return render(
    <MemoryRouter initialEntries={['/saves']}>
      <Routes>
        <Route
          path="/saves"
          element={<SaveHomePage gateway={gateway} transferGateway={transferGateway} />}
        />
        <Route path="/tavern" element={<CampaignRouteEcho />} />
        <Route path="/world" element={<WorldRouteEcho />} />
        <Route path="/character/create" element={<CharacterRouteEcho />} />
        <Route path="/adventure" element={<AdventureRouteEcho />} />
        <Route path="/recovery" element={<RecoveryRouteEcho />} />
      </Routes>
    </MemoryRouter>,
  );
}

class FakeSaveTransferGateway implements SaveTransferGateway {
  public importPath: string | null = null;
  public exportPath: string | null = null;
  public inspection = { campaignId: 'campaign-imported', campaignExists: false };
  public readonly suggestedNames: string[] = [];
  public readonly importCalls: Array<[string, CampaignArchiveImportMode]> = [];
  public readonly exportCalls: Array<[string, string]> = [];
  public dropHandler: ((paths: readonly string[]) => void) | null = null;

  public async chooseImportPath(): Promise<string | null> {
    return this.importPath;
  }

  public async chooseExportPath(suggestedName: string): Promise<string | null> {
    this.suggestedNames.push(suggestedName);
    return this.exportPath;
  }

  public async inspect(): Promise<{
    readonly campaignId: string;
    readonly campaignExists: boolean;
  }> {
    return this.inspection;
  }

  public async importArchive(
    path: string,
    mode: CampaignArchiveImportMode,
  ): Promise<CampaignSummary> {
    this.importCalls.push([path, mode]);
    return {
      id: 'imported-campaign',
      state: 'TAVERN',
      createdAt: '2026-07-30T08:00:00.000Z',
      updatedAt: '2026-08-01T14:00:00.000Z',
    };
  }

  public async exportArchive(campaignId: string, path: string): Promise<void> {
    this.exportCalls.push([campaignId, path]);
  }

  public async subscribeToArchiveDrops(
    handler: (paths: readonly string[]) => void,
  ): Promise<() => void> {
    this.dropHandler = handler;
    return () => {
      this.dropHandler = null;
    };
  }

  public drop(paths: readonly string[]): void {
    this.dropHandler?.(paths);
  }
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

function CharacterRouteEcho() {
  const location = useLocation();
  const id = new URLSearchParams(location.search).get('campaignId');
  return <p>继续车卡 {id ?? '未选择'}</p>;
}

function AdventureRouteEcho() {
  const location = useLocation();
  const id = new URLSearchParams(location.search).get('campaignId');
  return <p>继续冒险 {id ?? '未选择'}</p>;
}

function RecoveryRouteEcho() {
  const location = useLocation();
  const id = new URLSearchParams(location.search).get('campaignId');
  return <p>恢复 {id ?? '未选择'}</p>;
}

class FakeCampaignGateway implements CampaignGateway {
  public listCalls = 0;
  public createCalls = 0;
  public readonly continueCalls: string[] = [];
  public readonly archiveCalls: string[] = [];
  public readonly deleteCalls: string[] = [];

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

  public async deleteCampaign(id: string): Promise<void> {
    this.deleteCalls.push(id);
    this.campaigns = this.campaigns.filter((campaign) => campaign.id !== id);
  }
}

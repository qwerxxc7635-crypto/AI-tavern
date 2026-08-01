import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  open: vi.fn(),
  save: vi.fn(),
  onDragDropEvent: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: mocks.open, save: mocks.save }));
vi.mock('@tauri-apps/api/webview', () => ({
  getCurrentWebview: () => ({ onDragDropEvent: mocks.onDragDropEvent }),
}));

import { tauriSaveTransferGateway } from './save-transfer-gateway.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('tauri save transfer gateway', () => {
  it('uses filtered native dialogs and validates command responses', async () => {
    mocks.open.mockResolvedValue('D:\\Saves\\journey.emtavern');
    mocks.save.mockResolvedValue('D:\\Exports\\journey.emtavern');
    mocks.invoke
      .mockResolvedValueOnce({ campaignId: 'campaign-transfer', campaignExists: false })
      .mockResolvedValueOnce({
        id: 'campaign-transfer',
        state: 'TAVERN',
        createdAt: '2026-08-01T13:00:00.000Z',
        updatedAt: '2026-08-01T14:00:00.000Z',
      })
      .mockResolvedValueOnce({ campaignId: 'campaign-transfer', path: 'ignored' });

    await expect(tauriSaveTransferGateway.chooseImportPath()).resolves.toBe(
      'D:\\Saves\\journey.emtavern',
    );
    await expect(
      tauriSaveTransferGateway.chooseExportPath('campaign-transfer.emtavern'),
    ).resolves.toBe('D:\\Exports\\journey.emtavern');
    await expect(tauriSaveTransferGateway.inspect('D:\\Saves\\journey.emtavern')).resolves.toEqual({
      campaignId: 'campaign-transfer',
      campaignExists: false,
    });
    await expect(
      tauriSaveTransferGateway.importArchive('D:\\Saves\\journey.emtavern', 'CREATE'),
    ).resolves.toMatchObject({ id: 'campaign-transfer', state: 'TAVERN' });
    await expect(
      tauriSaveTransferGateway.exportArchive('campaign-transfer', 'D:\\Exports\\journey.emtavern'),
    ).resolves.toBeUndefined();

    expect(mocks.open).toHaveBeenCalledWith(
      expect.objectContaining({
        multiple: false,
        directory: false,
        filters: [{ name: 'Ember Tavern 存档', extensions: ['emtavern'] }],
      }),
    );
    expect(mocks.save).toHaveBeenCalledWith(
      expect.objectContaining({ defaultPath: 'campaign-transfer.emtavern' }),
    );
    expect(mocks.invoke.mock.calls).toEqual([
      ['save_archive_inspect', { path: 'D:\\Saves\\journey.emtavern' }],
      ['save_archive_import', { path: 'D:\\Saves\\journey.emtavern', mode: 'CREATE' }],
      ['save_archive_export', { id: 'campaign-transfer', path: 'D:\\Exports\\journey.emtavern' }],
    ]);
  });

  it('forwards only native drop events and returns the unlisten callback', async () => {
    const unlisten = vi.fn();
    let listener: ((event: { payload: { type: string; paths?: string[] } }) => void) | null = null;
    mocks.onDragDropEvent.mockImplementation(async (handler) => {
      listener = handler;
      return unlisten;
    });
    const received: string[][] = [];
    const stop = await tauriSaveTransferGateway.subscribeToArchiveDrops((paths) => {
      received.push([...paths]);
    });

    const emit = listener as unknown as (event: {
      payload: { type: string; paths?: string[] };
    }) => void;
    emit({ payload: { type: 'over' } });
    emit({ payload: { type: 'drop', paths: ['D:\\Saves\\journey.emtavern'] } });
    expect(received).toEqual([['D:\\Saves\\journey.emtavern']]);
    stop();
    expect(unlisten).toHaveBeenCalledOnce();
  });
});

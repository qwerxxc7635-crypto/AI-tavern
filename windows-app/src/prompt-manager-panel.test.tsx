// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { PromptManagerSnapshot } from '@ember-tavern/prompts';
import { PromptManagerPanel } from './prompt-manager-panel.js';
import type { PromptManagerGateway, PromptPresetDraft } from './prompt-manager-service.js';

afterEach(cleanup);

describe('PromptManagerPanel', () => {
  it('keeps core rules read-only, reorders blocks and saves a versioned draft', async () => {
    const gateway = new MemoryPromptGateway();
    render(<PromptManagerPanel gateway={gateway} />);

    const core = await screen.findByLabelText('不可编辑核心规则');
    expect(core.querySelector('input, textarea, select')).toBeNull();
    expect(screen.getByText('管理器修订：3 · 预设版本：1')).toBeTruthy();
    const moveDown = screen.getAllByRole('button', { name: '下移' })[0];
    if (moveDown === undefined) throw new Error('move button missing');
    fireEvent.click(moveDown);
    fireEvent.click(screen.getByRole('button', { name: '保存预设' }));
    expect((await screen.findByText('提示词预设已保存。')).textContent).toBe('提示词预设已保存。');
    expect(gateway.saved?.blocks.map(({ id }) => id)).toEqual(['dialogue', 'tone']);
    expect(gateway.saved?.expectedVersion).toBe(1);
  });

  it('recovers the default and supports secret-free export/import copies', async () => {
    const gateway = new MemoryPromptGateway();
    render(<PromptManagerPanel gateway={gateway} />);
    const active = await screen.findByRole('combobox', { name: '当前启用预设' });
    fireEvent.change(active, { target: { value: '' } });
    expect((await screen.findByText('已恢复默认提示词。')).textContent).toBe('已恢复默认提示词。');
    expect(gateway.current.activePresetId).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '导出预设' }));
    await waitFor(() =>
      expect((screen.getByLabelText('预设导入导出数据') as HTMLTextAreaElement).value).toContain(
        'EMBER_PROMPT_PRESET',
      ),
    );
    expect((screen.getByLabelText('预设导入导出数据') as HTMLTextAreaElement).value).not.toContain(
      'api_key',
    );
    fireEvent.click(screen.getByRole('button', { name: '导入为新预设' }));
    expect((await screen.findByText('预设已作为新副本导入。')).textContent).toBe(
      '预设已作为新副本导入。',
    );
    expect(gateway.imported).toBe(true);
  });

  it('offers a fail-closed recovery path for a malformed stored snapshot', async () => {
    const gateway = new MemoryPromptGateway();
    gateway.loadFails = true;
    render(<PromptManagerPanel gateway={gateway} />);
    expect(await screen.findByText('提示词设置已损坏或无法读取。')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '安全恢复默认提示词' }));
    expect(await screen.findByText('损坏设置已清除，当前使用默认提示词。')).toBeTruthy();
    expect(gateway.current).toEqual({
      schemaVersion: 1,
      revision: 0,
      activePresetId: null,
      presets: [],
    });
  });
});

class MemoryPromptGateway implements PromptManagerGateway {
  public current: PromptManagerSnapshot = initialSnapshot();
  public saved: PromptPresetDraft | null = null;
  public imported = false;
  public loadFails = false;

  public async load() {
    if (this.loadFails) throw new TypeError('malformed');
    return this.current;
  }

  public async save(revision: number, draft: PromptPresetDraft) {
    expect(revision).toBe(this.current.revision);
    this.saved = draft;
    this.current = {
      ...this.current,
      revision: revision + 1,
      presets: [
        {
          id: draft.id,
          name: draft.name,
          version: (draft.expectedVersion ?? 0) + 1,
          blocks: draft.blocks,
        },
      ],
    };
    return this.current;
  }

  public async activate(revision: number, presetId: string | null) {
    this.current = { ...this.current, revision: revision + 1, activePresetId: presetId };
    return this.current;
  }

  public async import(revision: number) {
    this.imported = true;
    this.current = { ...this.current, revision: revision + 1 };
    return this.current;
  }

  public async export() {
    return JSON.stringify({
      format: 'EMBER_PROMPT_PRESET',
      formatVersion: 1,
      preset: this.current.presets[0],
    });
  }

  public async recover() {
    this.loadFails = false;
    this.current = { schemaVersion: 1, revision: 0, activePresetId: null, presets: [] };
    return this.current;
  }
}

function initialSnapshot(): PromptManagerSnapshot {
  return {
    schemaVersion: 1,
    revision: 3,
    activePresetId: 'preset-one',
    presets: [
      {
        id: 'preset-one',
        name: '烛火谜案',
        version: 1,
        blocks: [
          { id: 'tone', name: '语气', content: '克制的感官描写。', enabled: true, tasks: [] },
          {
            id: 'dialogue',
            name: '对白',
            content: '对白简短。',
            enabled: true,
            tasks: ['NPC_REPLY'],
          },
        ],
      },
    ],
  };
}

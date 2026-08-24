// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import { MY_SECTIONS, MyPage } from './my-page.js';
import type { AIInspectorSnapshot } from './ai-inspector-service.js';
import type { ContextInspectorSnapshot } from './context-inspector-service.js';
import { RELEASE_INFO } from './generated-release-info.js';
import type {
  RandomnessSettingsGateway,
  RandomnessSettingsSnapshot,
} from './randomness-settings-service.js';

afterEach(cleanup);

describe('My page information architecture', () => {
  function randomnessGateway(
    initial: RandomnessSettingsSnapshot = {
      profile: 'BALANCED',
      customTemperature: null,
      temperature: 0.7,
    },
  ): RandomnessSettingsGateway {
    let current = initial;
    return {
      async load() {
        return current;
      },
      async save(update) {
        const temperature =
          update.profile === 'CONSERVATIVE'
            ? 0.2
            : update.profile === 'BALANCED'
              ? 0.7
              : update.profile === 'HIGH'
                ? 1.1
                : (update.customTemperature ?? 0.7);
        current = { ...update, temperature };
        return current;
      },
    };
  }

  it('exposes all nine device-setting sections and the release version', async () => {
    render(
      <MemoryRouter>
        <MyPage
          versionGateway={{
            async getVersion() {
              return '0.2.0';
            },
          }}
          randomnessGateway={randomnessGateway()}
        />
      </MemoryRouter>,
    );

    const navigation = screen.getByRole('navigation', { name: '我的页面分区' });
    expect(navigation.querySelectorAll('a')).toHaveLength(9);
    for (const { id, label } of MY_SECTIONS) {
      expect(screen.getByRole('link', { name: new RegExp(label, 'u') }).getAttribute('href')).toBe(
        `#${id}`,
      );
      expect(screen.getByRole('heading', { name: label })).toBeTruthy();
    }
    expect(screen.getByRole('link', { name: '打开模型设置' }).getAttribute('href')).toBe(
      '/settings',
    );
    expect(await screen.findByText('当前版本：0.2.0')).toBeTruthy();
    expect(screen.getByText('发布状态：开发频道 / 未发布')).toBeTruthy();
    expect(
      screen.getByRole('list', { name: '当前版本更新记录' }).querySelectorAll('li'),
    ).toHaveLength(RELEASE_INFO.highlights.length);
    expect(await screen.findByText('当前实际温度：0.7')).toBeTruthy();
    for (const label of ['稳健', '平衡', '高随机', '自定义']) {
      expect(screen.getByRole('radio', { name: new RegExp(label, 'u') })).toBeTruthy();
    }
  });

  it('saves a bounded custom randomness profile', async () => {
    render(
      <MemoryRouter>
        <MyPage
          versionGateway={{
            async getVersion() {
              return '0.2.0';
            },
          }}
          randomnessGateway={randomnessGateway()}
        />
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole('radio', { name: /自定义/u }));
    fireEvent.change(screen.getByRole('spinbutton', { name: '自定义温度' }), {
      target: { value: '1.4' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存随机性设置' }));
    expect((await screen.findByRole('status')).textContent).toBe('已保存自定义档。');
    await waitFor(() => expect(screen.getByText('当前实际温度：1.4')).toBeTruthy());
  });

  it('renders only context manifest metadata for the latest request', async () => {
    const snapshot: ContextInspectorSnapshot = {
      task: 'NPC_REPLY',
      estimatedTokens: 80,
      maxTokens: 4_000,
      entries: [
        {
          block: 'knowledge',
          token: 80,
          source: 'npc-knowledge',
          revision: 4,
          stability: 'semi_stable',
          decision: 'INCLUDED',
          reason: 'relevant',
          hash: '0123456789ab',
          cache: 'HIT',
        },
      ],
    };
    render(
      <MemoryRouter>
        <MyPage
          versionGateway={{
            async getVersion() {
              return '0.2.0';
            },
          }}
          randomnessGateway={randomnessGateway()}
          contextInspectorGateway={{
            async load() {
              return snapshot;
            },
          }}
        />
      </MemoryRouter>,
    );
    const inspector = await screen.findByRole('table');
    expect(inspector.textContent).toContain('knowledge');
    expect(inspector.textContent).toContain('npc-knowledge');
    expect(inspector.textContent).toContain('semi_stable');
    expect(inspector.textContent).toContain('INCLUDED · relevant');
    expect(inspector.textContent).toContain('0123456789ab');
    expect(inspector.textContent).toContain('HIT');
    expect(screen.getByText(/秘密内容、完整系统提示与凭据不会/u)).toBeTruthy();
  });

  it('keeps AI diagnostics off in player mode and renders only the advanced snapshot', async () => {
    let loads = 0;
    const snapshot: AIInspectorSnapshot = {
      generation: { task: 'NPC_REPLY', status: 'FAILED', errorCode: 'INVALID_OUTPUT' },
      provider: { id: 'provider-main', displayName: '主模型', model: 'model-main' },
      latencyMs: 120,
      cache: {
        providerObservation: 'MISS',
        sessionObservation: 'PREFIX_REUSED',
        prefixHash: '0123456789ab',
      },
      tokens: { input: 90, output: 10, total: 100, cacheHit: 0, cacheMiss: 90 },
      context: null,
      prompt: [{ role: 'USER', characters: 200, content: '［提示内容已遮罩］' }],
      raw: { characters: 40, content: '［原始输出内容已遮罩］' },
      parsed: { secret: '［秘密字段已遮罩］' },
      validation: {
        status: 'FAILED',
        code: 'SCHEMA_VALIDATION_FAILED',
        issues: [{ path: 'reply', code: 'too_small', message: '字段缺失' }],
      },
      repair: { attempted: true, status: 'FAILED' },
      lifecycle: [{ sequence: 1, stage: 'VALIDATE', status: 'FAILED', code: 'INVALID_OUTPUT' }],
    };
    render(
      <MemoryRouter>
        <MyPage
          versionGateway={{
            async getVersion() {
              return '0.2.0';
            },
          }}
          randomnessGateway={randomnessGateway()}
          aiInspectorGateway={{
            async load(mode) {
              loads += 1;
              expect(mode).toBe('ADVANCED');
              return snapshot;
            },
          }}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText('玩家模式不会读取或显示生成诊断。')).toBeTruthy();
    expect(loads).toBe(0);
    fireEvent.click(screen.getByRole('checkbox', { name: '启用高级检查器' }));
    expect(await screen.findByText('NPC_REPLY · FAILED')).toBeTruthy();
    expect(loads).toBe(1);
    expect(screen.getByText('120 毫秒')).toBeTruthy();
    expect(screen.getByText('FAILED · SCHEMA_VALIDATION_FAILED')).toBeTruthy();
    expect(screen.getByText(/默认遮罩提示、原始内容/u)).toBeTruthy();
    expect(document.body.textContent).not.toContain('unreleased secret');
  });
});

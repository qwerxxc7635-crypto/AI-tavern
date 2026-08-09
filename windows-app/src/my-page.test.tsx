// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import { MY_SECTIONS, MyPage } from './my-page.js';
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

  it('exposes all seven device-setting sections and the release version', async () => {
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
    expect(navigation.querySelectorAll('a')).toHaveLength(7);
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
});

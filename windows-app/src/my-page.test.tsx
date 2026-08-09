// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import { MY_SECTIONS, MyPage } from './my-page.js';
import { RELEASE_INFO } from './generated-release-info.js';

afterEach(cleanup);

describe('My page information architecture', () => {
  it('exposes all seven device-setting sections and the release version', async () => {
    render(
      <MemoryRouter>
        <MyPage
          versionGateway={{
            async getVersion() {
              return '0.2.0';
            },
          }}
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
  });
});

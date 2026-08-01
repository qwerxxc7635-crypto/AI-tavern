// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ModelSettingsPage } from './model-settings-page.js';
import type { ModelSettingsGateway, ModelSettingsUpdate } from './model-settings-service.js';

afterEach(cleanup);

describe('model settings page', () => {
  it('tests a provider, saves an opaque credential reference and marks defaults', async () => {
    const saved: ModelSettingsUpdate[] = [];
    const deleted: string[] = [];
    const gateway: ModelSettingsGateway = {
      async load() {
        return { profiles: [], defaultModelProfileId: null, fallbackModelProfileId: null };
      },
      async save(update) {
        saved.push(update);
        return {
          profiles: [
            {
              id: 'profile-1',
              providerId: 'provider-1',
              presetKey: update.presetKey,
              providerDisplayName: update.providerDisplayName,
              baseUrl: update.baseUrl,
              hasCredential: update.credentialRef !== null,
              modelName: update.modelName,
              modelDisplayName: update.modelDisplayName,
            },
          ],
          defaultModelProfileId: 'profile-1',
          fallbackModelProfileId: 'profile-1',
        };
      },
      async saveSecret() {
        return 'credential:v1:00000000-0000-4000-8000-000000000001';
      },
      async deleteSecret(reference) {
        deleted.push(reference);
      },
      async probe() {
        return [
          {
            name: 'deepseek-v4-flash',
            displayName: 'DeepSeek V4 Flash',
            costStatus: 'PAID',
            contextWindowTokens: 1048576,
          },
        ];
      },
    };
    render(<ModelSettingsPage gateway={gateway} />);
    await screen.findByText('尚未配置模型。');
    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'private-key' } });
    fireEvent.click(screen.getByLabelText('备用模型'));
    fireEvent.click(screen.getByRole('button', { name: '测试连接并列出模型' }));
    expect(await screen.findByText('连接成功，发现 1 个模型。')).toBeTruthy();
    expect(deleted).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: '保存设置' }));
    expect(await screen.findByText('模型设置已保存；现有存档事实未被修改。')).toBeTruthy();
    expect(saved).toHaveLength(1);
    expect(saved[0]?.credentialRef).toMatch(/^credential:v1:/);
    expect(JSON.stringify(saved[0])).not.toContain('private-key');
    expect(screen.getByText('默认')).toBeTruthy();
    expect(screen.getByText('备用')).toBeTruthy();
    await waitFor(() =>
      expect((screen.getByLabelText('API Key') as HTMLInputElement).value).toBe(''),
    );
  });
});

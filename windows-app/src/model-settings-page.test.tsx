// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ModelSettingsPage } from './model-settings-page.js';
import type { ModelSettingsGateway, ModelSettingsUpdate } from './model-settings-service.js';

afterEach(cleanup);

describe('model settings page', () => {
  it('tests a provider, saves an opaque credential reference and marks defaults', async () => {
    const saved: ModelSettingsUpdate[] = [];
    const deleted: string[] = [];
    const gateway: ModelSettingsGateway = {
      async load() {
        return {
          profiles: [],
          defaultModelProfileId: null,
          fallbackModelProfileId: null,
          pendingCredentialCleanupCount: 0,
        };
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
              hasCredential: update.credentialAction !== 'CLEAR',
              modelName: update.modelName,
              modelDisplayName: update.modelDisplayName,
              capabilities: update.capabilities,
            },
          ],
          defaultModelProfileId: 'profile-1',
          fallbackModelProfileId: 'profile-1',
          pendingCredentialCleanupCount: 0,
        };
      },
      async forgetCredential(profileId) {
        expect(profileId).toBe('profile-1');
        return {
          profiles: [
            {
              id: 'profile-1',
              providerId: 'provider-1',
              presetKey: 'deepseek',
              providerDisplayName: 'DeepSeek',
              baseUrl: 'https://api.deepseek.com/',
              hasCredential: false,
              modelName: 'deepseek-v4-flash',
              modelDisplayName: 'DeepSeek V4 Flash',
              capabilities: null,
            },
          ],
          defaultModelProfileId: 'profile-1',
          fallbackModelProfileId: 'profile-1',
          pendingCredentialCleanupCount: 0,
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
            capabilities: {
              text: true,
              streaming: false,
              systemMessages: true,
              jsonMode: true,
              jsonSchema: false,
              toolCalling: false,
              reasoning: true,
              costStatus: 'PAID',
              contextWindowTokens: 1048576,
              checkedAt: '2026-08-01T00:00:00Z',
            },
          },
        ];
      },
    };
    render(<ModelSettingsPage gateway={gateway} />);
    expect(screen.getByRole('heading', { name: '隐私与联网' })).toBeTruthy();
    expect(screen.getByText(/保存默认或备用模型不会发送Campaign内容/)).toBeTruthy();
    expect(screen.getByText(/“测试连接”会向所选Base URL发送API Key/)).toBeTruthy();
    expect(screen.getByText(/发送必要游戏上下文前必须另行确认/)).toBeTruthy();
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
    expect(saved[0]?.credentialAction).toBe('REPLACE');
    expect(JSON.stringify(saved[0])).not.toContain('private-key');
    expect(screen.getByText('默认')).toBeTruthy();
    expect(screen.getByText('备用')).toBeTruthy();
    await waitFor(() =>
      expect((screen.getByLabelText('API Key') as HTMLInputElement).value).toBe(''),
    );

    fireEvent.click(screen.getByRole('button', { name: '保存设置' }));
    await waitFor(() => expect(saved).toHaveLength(2));
    expect(saved[1]?.credentialAction).toBe('KEEP');
    expect(saved[1]?.credentialRef).toBeNull();

    vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: '删除凭据' }));
    expect(await screen.findByText('已删除该Provider的系统凭据；模型配置仍保留。')).toBeTruthy();
    expect(screen.getByText('无已保存凭据')).toBeTruthy();
  });
});

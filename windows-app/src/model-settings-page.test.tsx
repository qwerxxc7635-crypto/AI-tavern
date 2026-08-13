// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ModelSettingsPage } from './model-settings-page.js';
import type { ModelSettingsGateway, ModelSettingsUpdate } from './model-settings-service.js';

afterEach(cleanup);

describe('model settings page', () => {
  it('offers all five connection profiles and applies their endpoint rules', async () => {
    const gateway: ModelSettingsGateway = {
      async load() {
        return {
          profiles: [],
          defaultModelProfileId: null,
          fallbackModelProfileId: null,
          pendingCredentialCleanupCount: 0,
        };
      },
      async save() {
        throw new Error('not used');
      },
      async forgetCredential() {
        throw new Error('not used');
      },
      async saveSecret() {
        throw new Error('not used');
      },
      async deleteSecret() {},
      async probe() {
        throw new Error('not used');
      },
    };

    render(<ModelSettingsPage gateway={gateway} />);
    expect(screen.getByTestId('api-binding-phase').textContent).toBe('连接状态：编辑中');
    await screen.findByText('尚未配置模型。');

    const selector = screen.getByLabelText('连接配置') as HTMLSelectElement;
    expect(Array.from(selector.options).map((option) => option.text)).toEqual([
      'DeepSeek',
      'Qwen',
      'OpenRouter',
      'Ollama',
      'OpenAI-Compatible',
    ]);

    const endpoint = screen.getByLabelText('Base URL') as HTMLInputElement;
    expect(endpoint.readOnly).toBe(true);
    fireEvent.change(selector, { target: { value: 'qwen' } });
    expect(endpoint.value).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1/');
    expect(endpoint.readOnly).toBe(true);
    fireEvent.change(selector, { target: { value: 'openrouter' } });
    expect(endpoint.value).toBe('https://openrouter.ai/api/v1/');
    expect(endpoint.readOnly).toBe(true);
    fireEvent.change(selector, { target: { value: 'ollama' } });
    expect(endpoint.value).toBe('http://localhost:11434/v1/');
    expect(endpoint.readOnly).toBe(false);
    expect((screen.getByLabelText('API Key') as HTMLInputElement).disabled).toBe(true);
    fireEvent.change(selector, { target: { value: 'custom' } });
    expect(endpoint.value).toBe('');
    expect(endpoint.readOnly).toBe(false);
    expect((screen.getByLabelText('API Key') as HTMLInputElement).disabled).toBe(false);
  });

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
              endpointFingerprint: update.endpointFingerprint,
              hasCredential: update.credentialAction !== 'CLEAR',
              modelName: update.modelName,
              modelDisplayName: update.modelDisplayName,
              capabilities: update.capabilities,
              capabilitySource: update.capabilitySource,
              probeFingerprint: update.probeFingerprint,
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
              endpointFingerprint: null,
              hasCredential: false,
              modelName: 'deepseek-v4-flash',
              modelDisplayName: 'DeepSeek-V4-Flash-0731',
              capabilities: null,
              capabilitySource: null,
              probeFingerprint: null,
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
        return {
          receiptId: '00000000-0000-4000-8000-000000000002',
          normalizedBaseUrl: 'https://api.deepseek.com/',
          endpointFingerprint: 'a'.repeat(64),
          models: [
            {
              name: 'deepseek-v4-flash',
              displayName: 'DeepSeek-V4-Flash-0731',
              capabilitySource: 'PRESET_METADATA',
              probeFingerprint: 'b'.repeat(64),
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
          ],
        };
      },
    };
    render(<ModelSettingsPage gateway={gateway} />);
    expect(screen.getByRole('heading', { name: '隐私与联网' })).toBeTruthy();
    expect(screen.getByText(/默认模型会用于实际游戏生成/)).toBeTruthy();
    expect(screen.getByText(/“测试连接”会向所选Base URL发送API Key/)).toBeTruthy();
    expect(screen.getByText(/认证、额度和输出校验错误不会自动切换/)).toBeTruthy();
    await screen.findByText('尚未配置模型。');
    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'private-key' } });
    fireEvent.click(screen.getByLabelText('备用模型'));
    fireEvent.click(screen.getByRole('button', { name: '测试连接并列出模型' }));
    expect(await screen.findByText('连接成功，发现 1 个模型。')).toBeTruthy();
    expect(screen.getByTestId('api-binding-phase').textContent).toBe('连接状态：选择模型');
    expect(deleted).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: '保存设置' }));
    expect(await screen.findByText('模型设置已保存；现有存档事实未被修改。')).toBeTruthy();
    expect(saved).toHaveLength(1);
    expect(saved[0]?.credentialRef).toMatch(/^credential:v1:/);
    expect(saved[0]?.credentialAction).toBe('REPLACE');
    expect(saved[0]?.probeReceiptId).toBe('00000000-0000-4000-8000-000000000002');
    expect(JSON.stringify(saved[0])).not.toContain('private-key');
    expect(screen.getByText('默认')).toBeTruthy();
    expect(screen.getByText('备用')).toBeTruthy();
    expect(screen.getByTestId('api-binding-phase').textContent).toBe('连接状态：已保存');
    await waitFor(() =>
      expect((screen.getByLabelText(/API Key/) as HTMLInputElement).value).toBe(''),
    );

    fireEvent.click(screen.getByRole('button', { name: '保存设置' }));
    await waitFor(() => expect(saved).toHaveLength(2));
    expect(saved[1]?.credentialAction).toBe('KEEP');
    expect(saved[1]?.credentialRef).toBeNull();

    fireEvent.change(screen.getByLabelText(/替换 API Key/), {
      target: { value: 'replacement-key' },
    });
    fireEvent.click(screen.getByRole('button', { name: '测试连接并列出模型' }));
    await waitFor(() =>
      expect(screen.getByTestId('api-binding-phase').textContent).toBe('连接状态：选择模型'),
    );
    fireEvent.click(screen.getByRole('button', { name: '保存设置' }));
    await waitFor(() => expect(saved).toHaveLength(3));
    expect(saved[2]?.credentialAction).toBe('REPLACE');
    expect(JSON.stringify(saved[2])).not.toContain('replacement-key');

    vi.spyOn(window, 'confirm').mockReturnValue(true);
    expect(screen.getByText('凭据状态：已保存引用，需连接测试确认当前可用性')).toBeTruthy();
    expect(screen.getAllByText('DeepSeek-V4-Flash-0731')).toHaveLength(2);
    expect(screen.getByText('最近连接测试：2026-08-01T00:00:00Z')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '删除已保存凭据' }));
    expect(await screen.findByText('已删除该Provider的系统凭据；模型配置仍保留。')).toBeTruthy();
    expect(screen.getByText('无已保存凭据')).toBeTruthy();
    expect(screen.getByText('凭据状态：未保存')).toBeTruthy();
  });

  it('cancels an in-flight test and ignores its late provider result', async () => {
    let resolveProbe!: (value: Awaited<ReturnType<ModelSettingsGateway['probe']>>) => void;
    const pendingProbe = new Promise<Awaited<ReturnType<ModelSettingsGateway['probe']>>>(
      (resolve) => {
        resolveProbe = resolve;
      },
    );
    const gateway: ModelSettingsGateway = {
      async load() {
        return {
          profiles: [],
          defaultModelProfileId: null,
          fallbackModelProfileId: null,
          pendingCredentialCleanupCount: 0,
        };
      },
      async save() {
        throw new Error('not used');
      },
      async forgetCredential() {
        throw new Error('not used');
      },
      async saveSecret() {
        throw new Error('not used');
      },
      async deleteSecret() {},
      async probe() {
        return pendingProbe;
      },
    };

    render(<ModelSettingsPage gateway={gateway} />);
    await screen.findByText('尚未配置模型。');
    fireEvent.click(screen.getByRole('button', { name: '测试连接并列出模型' }));
    expect(screen.getByTestId('api-binding-phase').textContent).toBe('连接状态：测试连接中');
    fireEvent.click(screen.getByRole('button', { name: '取消测试' }));
    expect(await screen.findByText('已取消等待连接测试；迟到的结果不会用于保存。')).toBeTruthy();
    expect(screen.getByTestId('api-binding-phase').textContent).toBe('连接状态：编辑中');

    resolveProbe({
      receiptId: '00000000-0000-4000-8000-000000000002',
      normalizedBaseUrl: 'https://api.deepseek.com/',
      endpointFingerprint: 'a'.repeat(64),
      models: [],
    });
    await Promise.resolve();
    expect(screen.queryByText('连接成功，发现 0 个模型。')).toBeNull();
    expect(screen.getByTestId('api-binding-phase').textContent).toBe('连接状态：编辑中');
  });

  it('clears a draft key and retries pending credential cleanup without exposing references', async () => {
    let loads = 0;
    const gateway: ModelSettingsGateway = {
      async load() {
        loads += 1;
        return {
          profiles: [],
          defaultModelProfileId: null,
          fallbackModelProfileId: null,
          pendingCredentialCleanupCount: loads === 1 ? 2 : 0,
        };
      },
      async save() {
        throw new Error('not used');
      },
      async forgetCredential() {
        throw new Error('not used');
      },
      async saveSecret() {
        throw new Error('not used');
      },
      async deleteSecret() {},
      async probe() {
        throw new Error('not used');
      },
    };

    render(<ModelSettingsPage gateway={gateway} />);
    expect(await screen.findByText('凭据清理待重试：2 项')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'draft-secret' } });
    fireEvent.click(screen.getByRole('button', { name: '清空未保存的 Key' }));
    expect((screen.getByLabelText('API Key') as HTMLInputElement).value).toBe('');
    expect(document.body.textContent).not.toContain('draft-secret');

    fireEvent.click(screen.getByRole('button', { name: '重试并检查凭据健康' }));
    expect(await screen.findByText('系统凭据清理队列已恢复健康。')).toBeTruthy();
    expect(screen.getByText('凭据清理健康：无待处理项')).toBeTruthy();
    expect(loads).toBe(2);
  });
});

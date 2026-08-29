// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { StandardAIError, type StandardAIErrorCode } from '@ember-tavern/ai-core';

import { AIErrorNotice } from './ai-error-notice.js';

afterEach(cleanup);

describe('AIErrorNotice', () => {
  it.each([
    ['QUOTA_EXCEEDED', '打开模型设置'],
    ['AUTHENTICATION_FAILED', '检查API Key'],
    ['MODEL_NOT_FOUND', '重新选择模型'],
  ] as const)('offers settings for %s', (code, label) => {
    renderNotice(code);
    expect(screen.getByRole('alert').getAttribute('data-error-code')).toBe(code);
    expect(screen.getByRole('link', { name: label }).getAttribute('href')).toBe('/settings');
  });

  it.each([
    ['RATE_LIMITED', '重试这一步'],
    ['TIMEOUT', '重新请求'],
    ['INVALID_OUTPUT', '重新生成'],
    ['NETWORK_FAILED', '重试连接'],
  ] as const)('offers a working retry for %s', (code, label) => {
    const retry = vi.fn();
    renderNotice(code, retry);
    fireEvent.click(screen.getByRole('button', { name: label }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it('does not leak an unknown provider message and still offers a next step', () => {
    render(
      <MemoryRouter>
        <AIErrorNotice error={new Error('secret upstream response')} />
      </MemoryRouter>,
    );
    expect(screen.queryByText(/secret upstream/)).toBeNull();
    expect(screen.getByRole('link', { name: '检查模型设置' })).toBeTruthy();
  });

  it.each([
    ['INVALID_JSON', 'JSON 解析', '模型返回内容无法解析'],
    ['SCHEMA_NAME_INVALID', 'Schema 验证', '模型输出结构不符合要求'],
    ['RESPONSE_TRUNCATED', '响应截断', '模型响应未完整返回'],
    ['WORLD_BUSINESS_RULE_INVALID', '业务规则', '模型输出违反世界规则'],
  ] as const)(
    'distinguishes %s without exposing internal response content',
    (code, layer, title) => {
      render(
        <MemoryRouter>
          <AIErrorNotice error={{ code }} onRetry={() => undefined} onDismiss={() => undefined} />
        </MemoryRouter>,
      );

      expect(screen.getByText(`失败层级：${layer}`)).toBeTruthy();
      expect(screen.getByText(title)).toBeTruthy();
      expect(screen.queryByText(/已锁定的硬结果/)).toBeNull();
    },
  );

  it('identifies a failed repair while retaining the original schema category', () => {
    render(
      <MemoryRouter>
        <AIErrorNotice
          error={{
            code: 'SCHEMA_NAME_INVALID',
            cause: {
              code: 'SCHEMA_NAME_INVALID',
              attempt: 'REPAIR',
              validation: { code: 'SCHEMA_VALIDATION_FAILED' },
            },
          }}
          onRetry={() => undefined}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText('结构修复后的模型输出结构不符合要求')).toBeTruthy();
    expect(screen.getByText('失败层级：Schema 验证')).toBeTruthy();
  });

  it('keeps a repair timeout distinct from the validation reason that triggered repair', () => {
    render(
      <MemoryRouter>
        <AIErrorNotice
          error={{
            code: 'TIMEOUT',
            cause: {
              code: 'SCHEMA_NAME_INVALID',
              attempt: 'INITIAL',
              validation: { code: 'SCHEMA_VALIDATION_FAILED' },
            },
          }}
          onRetry={() => undefined}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText('模型响应超时')).toBeTruthy();
    expect(screen.getByText('错误代码：TIMEOUT')).toBeTruthy();
    expect(screen.queryByText(/Schema 验证/)).toBeNull();
  });

  it.each(['SCHEMA_NAME_INVALID', 'RESPONSE_TRUNCATED', 'AMBIGUOUS_JSON'] as const)(
    'uses the world-safe regeneration action for %s',
    (code) => {
      render(
        <MemoryRouter>
          <AIErrorNotice error={{ code }} onRetry={() => undefined} />
        </MemoryRouter>,
      );

      expect(screen.getByRole('button', { name: '重新生成' })).toBeTruthy();
    },
  );

  it('offers retry, cancel and explicit fallback only for an eligible transient error', () => {
    const retry = vi.fn();
    const cancel = vi.fn();
    const fallback = vi.fn();
    render(
      <MemoryRouter initialEntries={['/adventure?campaignId=campaign-error']}>
        <AIErrorNotice
          error={{ code: 'NETWORK_FAILED' }}
          onRetry={retry}
          onCancel={cancel}
          onUseFallback={fallback}
        />
      </MemoryRouter>,
    );

    expect(screen.getByRole('alert').getAttribute('data-error-kind')).toBe('NETWORK');
    expect(screen.getByRole('alert').getAttribute('data-error-surface')).toBe('TOAST');
    fireEvent.click(screen.getByRole('button', { name: '重试连接' }));
    fireEvent.click(screen.getByRole('button', { name: '取消等待' }));
    fireEvent.click(screen.getByRole('button', { name: '使用已授权备用模型' }));
    expect(retry).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledOnce();
    expect(fallback).toHaveBeenCalledOnce();
  });

  it.each([
    ['AUTHENTICATION_FAILED', 'PROVIDER'],
    ['QUOTA_EXCEEDED', 'PROVIDER'],
    ['INVALID_OUTPUT', 'VALIDATION'],
    ['DOMAIN_RULE_REJECTED', 'RULE'],
    ['LOCAL_STORAGE_UNAVAILABLE', 'PERSISTENCE'],
  ] as const)('never offers fallback for %s', (code, kind) => {
    render(
      <MemoryRouter>
        <AIErrorNotice
          error={{ code }}
          onRetry={() => undefined}
          onUseFallback={() => undefined}
          onDismiss={() => undefined}
        />
      </MemoryRouter>,
    );

    expect(screen.getByRole('alert').getAttribute('data-error-kind')).toBe(kind);
    expect(screen.queryByRole('button', { name: '使用已授权备用模型' })).toBeNull();
  });
});

function renderNotice(code: StandardAIErrorCode, onRetry?: () => void): void {
  render(
    <MemoryRouter>
      <AIErrorNotice error={new StandardAIError(code)} onRetry={onRetry} />
    </MemoryRouter>,
  );
}

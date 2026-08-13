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

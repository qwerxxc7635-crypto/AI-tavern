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
});

function renderNotice(code: StandardAIErrorCode, onRetry?: () => void): void {
  render(
    <MemoryRouter>
      <AIErrorNotice error={new StandardAIError(code)} onRetry={onRetry} />
    </MemoryRouter>,
  );
}

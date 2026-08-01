import { Link } from 'react-router-dom';

import { standardizeAIError, type StandardAIErrorCode } from '@ember-tavern/ai-core';

type ErrorAction = 'OPEN_SETTINGS' | 'RETRY';

interface ErrorPresentation {
  readonly title: string;
  readonly detail: string;
  readonly action: ErrorAction;
  readonly actionLabel: string;
}

const PRESENTATIONS: Readonly<Record<StandardAIErrorCode, ErrorPresentation>> = Object.freeze({
  QUOTA_EXCEEDED: {
    title: '模型额度已用尽',
    detail: '本地进度没有改变。请补充额度或选择另一个可用模型。',
    action: 'OPEN_SETTINGS',
    actionLabel: '打开模型设置',
  },
  AUTHENTICATION_FAILED: {
    title: '模型认证失败',
    detail: '本地进度没有改变。请更新API Key后重新测试连接。',
    action: 'OPEN_SETTINGS',
    actionLabel: '检查API Key',
  },
  RATE_LIMITED: {
    title: '模型服务请求过于频繁',
    detail: '本地进度没有改变。请稍候片刻后重试同一步。',
    action: 'RETRY',
    actionLabel: '重试这一步',
  },
  TIMEOUT: {
    title: '模型响应超时',
    detail: '本地进度没有改变。网络恢复后可重试同一步。',
    action: 'RETRY',
    actionLabel: '重新请求',
  },
  MODEL_NOT_FOUND: {
    title: '当前模型不可用',
    detail: '本地进度没有改变。请在设置中选择仍然存在的模型。',
    action: 'OPEN_SETTINGS',
    actionLabel: '重新选择模型',
  },
  INVALID_OUTPUT: {
    title: '模型输出没有通过验证',
    detail: '不合规内容未写入存档。你可以重新生成这一步。',
    action: 'RETRY',
    actionLabel: '重新生成',
  },
  NETWORK_FAILED: {
    title: '无法连接模型服务',
    detail: '本地进度没有改变。请检查网络或本地模型服务后重试。',
    action: 'RETRY',
    actionLabel: '重试连接',
  },
  UNKNOWN: {
    title: '模型操作没有完成',
    detail: '本地进度没有改变。请检查模型设置后再试。',
    action: 'OPEN_SETTINGS',
    actionLabel: '检查模型设置',
  },
});

export interface AIErrorNoticeProps {
  readonly error: unknown;
  readonly onRetry?: (() => void) | undefined;
}

export function AIErrorNotice({ error, onRetry }: AIErrorNoticeProps) {
  const classified = standardizeAIError(error);
  const presentation = PRESENTATIONS[classified.code];
  return (
    <section
      className="inline-error ai-error-notice"
      role="alert"
      data-error-code={classified.code}
    >
      <strong>{presentation.title}</strong>
      <p>{presentation.detail}</p>
      {presentation.action === 'RETRY' && onRetry !== undefined ? (
        <button className="secondary-action" type="button" onClick={onRetry}>
          {presentation.actionLabel}
        </button>
      ) : (
        <Link className="text-link" to="/settings">
          {presentation.action === 'RETRY' ? '检查模型设置' : presentation.actionLabel}
        </Link>
      )}
    </section>
  );
}

import { Link, useSearchParams } from 'react-router-dom';

import {
  classifyApplicationError,
  standardizeAIError,
  type ApplicationErrorKind,
  type StandardAIErrorCode,
} from '@ember-tavern/ai-core';

import { APP_PATHS, optionalCampaignRoute } from './navigation.js';

interface ErrorPresentation {
  readonly title: string;
  readonly detail: string;
}

const PRESENTATIONS: Readonly<Record<StandardAIErrorCode, ErrorPresentation>> = Object.freeze({
  QUOTA_EXCEEDED: {
    title: '模型额度已用尽',
    detail: '本地进度没有改变。请补充额度或选择另一个可用模型。',
  },
  AUTHENTICATION_FAILED: {
    title: '模型认证失败',
    detail: '本地进度没有改变。请更新API Key后重新测试连接。',
  },
  RATE_LIMITED: {
    title: '模型服务请求过于频繁',
    detail: '本地进度没有改变。请稍候片刻后重试同一步。',
  },
  TIMEOUT: {
    title: '模型响应超时',
    detail: '本地进度没有改变。网络恢复后可重试同一步。',
  },
  MODEL_NOT_FOUND: {
    title: '当前模型不可用',
    detail: '本地进度没有改变。请在设置中选择仍然存在的模型。',
  },
  INVALID_OUTPUT: {
    title: '模型输出没有通过验证',
    detail: '不合规内容未写入存档。技术重试不会改变已锁定的硬结果。',
  },
  NETWORK_FAILED: {
    title: '无法连接模型服务',
    detail: '本地进度没有改变。请检查网络或本地模型服务后重试。',
  },
  UNKNOWN: {
    title: '生成操作没有完成',
    detail: '本地进度没有改变，已确定的游戏事实保持原样。',
  },
});

const KIND_PRESENTATIONS: Readonly<Record<ApplicationErrorKind, ErrorPresentation>> = Object.freeze(
  {
    PROVIDER: {
      title: '模型服务无法完成请求',
      detail: '本地进度没有改变。请按错误操作检查服务或模型设置。',
    },
    GENERATION: PRESENTATIONS.UNKNOWN,
    VALIDATION: {
      title: '生成内容未通过验证',
      detail: '不合规内容未写入存档；技术重试不会改变已锁定的硬结果。',
    },
    PERSISTENCE: {
      title: '本地存档操作没有完成',
      detail: '本地事务没有提交部分结果，请按提示重试或返回。',
    },
    RULE: {
      title: '世界规则不允许这项操作',
      detail: '这是规则拒绝，不会通过更换模型或重复请求绕过。',
    },
    NETWORK: PRESENTATIONS.NETWORK_FAILED,
  },
);

export interface AIErrorNoticeProps {
  readonly error: unknown;
  readonly onRetry?: (() => void) | undefined;
  readonly onCancel?: (() => void) | undefined;
  readonly onUseFallback?: (() => void) | undefined;
  readonly onDismiss?: (() => void) | undefined;
}

export function AIErrorNotice({
  error,
  onRetry,
  onCancel,
  onUseFallback,
  onDismiss,
}: AIErrorNoticeProps) {
  const [search] = useSearchParams();
  const classified = classifyApplicationError(error);
  const standardized = standardizeAIError(error);
  const presentation =
    standardized.code === 'UNKNOWN'
      ? KIND_PRESENTATIONS[classified.kind]
      : PRESENTATIONS[standardized.code];
  return (
    <section
      className={`inline-error ai-error-notice ai-error-notice--${classified.surface.toLowerCase()}`}
      role="alert"
      data-error-code={classified.code}
      data-error-kind={classified.kind}
      data-error-surface={classified.surface}
    >
      <strong>{presentation.title}</strong>
      <p>{presentation.detail}</p>
      <small>错误代码：{classified.code}</small>
      <div className="ai-error-notice__actions">
        {classified.actions.includes('RETRY') && onRetry !== undefined ? (
          <button className="secondary-action" type="button" onClick={onRetry}>
            {retryActionLabel(classified.code)}
          </button>
        ) : null}
        {classified.actions.includes('CANCEL') && onCancel !== undefined ? (
          <button className="quiet-action" type="button" onClick={onCancel}>
            取消等待
          </button>
        ) : null}
        {classified.actions.includes('USE_FALLBACK') && onUseFallback !== undefined ? (
          <button className="quiet-action" type="button" onClick={onUseFallback}>
            使用已授权备用模型
          </button>
        ) : null}
        {classified.actions.includes('OPEN_SETTINGS') ? (
          <Link className="text-link" to={optionalCampaignRoute(search, APP_PATHS.settings)}>
            {settingsActionLabel(classified.code)}
          </Link>
        ) : null}
        {classified.actions.includes('DISMISS') && onDismiss !== undefined ? (
          <button className="quiet-action" type="button" onClick={onDismiss}>
            知道了
          </button>
        ) : null}
      </div>
    </section>
  );
}

function settingsActionLabel(code: string): string {
  if (code === 'AUTHENTICATION_FAILED') return '检查API Key';
  if (code === 'MODEL_NOT_FOUND') return '重新选择模型';
  if (code === 'QUOTA_EXCEEDED') return '打开模型设置';
  return '检查模型设置';
}

function retryActionLabel(code: string): string {
  if (code === 'RATE_LIMITED') return '重试这一步';
  if (code === 'TIMEOUT') return '重新请求';
  if (code === 'INVALID_OUTPUT') return '重新生成';
  if (code === 'NETWORK_FAILED') return '重试连接';
  return '重试相同操作';
}

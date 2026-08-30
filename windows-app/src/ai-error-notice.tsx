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
    detail: '本地进度没有改变。模型未在本步的等待时间内完成响应，可以重试同一步。',
  },
  MODEL_NOT_FOUND: {
    title: '当前模型不可用',
    detail: '本地进度没有改变。请在设置中选择仍然存在的模型。',
  },
  INVALID_OUTPUT: {
    title: '模型输出没有通过验证',
    detail: '不合规内容未写入存档。可以重新生成，已提交的存档状态没有改变。',
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
      detail: '不合规内容未写入存档；可以重新生成，已提交的存档状态没有改变。',
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
  const failure =
    classified.kind === 'VALIDATION' || classified.kind === 'RULE'
      ? inspectOutputFailure(error)
      : null;
  const presentation =
    outputFailurePresentation(failure) ??
    (standardized.code === 'UNKNOWN'
      ? KIND_PRESENTATIONS[classified.kind]
      : PRESENTATIONS[standardized.code]);
  return (
    <section
      className={`inline-error ai-error-notice ai-error-notice--${classified.surface.toLowerCase()}`}
      role="alert"
      data-error-code={classified.code}
      data-error-kind={classified.kind}
      data-error-surface={classified.surface}
      data-error-reason={failure?.reason}
    >
      <strong>{presentation.title}</strong>
      <p>{presentation.detail}</p>
      {failure === null ? null : <small>失败层级：{failure.label}</small>}
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

interface OutputFailureInspection {
  readonly reason: string;
  readonly label: string;
  readonly repaired: boolean;
}

function inspectOutputFailure(error: unknown): OutputFailureInspection | null {
  let current: unknown = error;
  let repaired = false;
  let validationCode: string | null = null;
  let failureCode: string | null = null;
  for (let depth = 0; depth < 8; depth += 1) {
    if (typeof current !== 'object' || current === null || Array.isArray(current)) break;
    const record = current as Readonly<Record<string, unknown>>;
    repaired ||= record['attempt'] === 'REPAIR';
    const validation = record['validation'];
    if (typeof validation === 'object' && validation !== null && !Array.isArray(validation)) {
      const code = (validation as Readonly<Record<string, unknown>>)['code'];
      if (typeof code === 'string') validationCode = code;
    }
    const code = record['code'];
    if (typeof code === 'string') {
      if (failureCode === null && outputFailureLabel(code, false) !== null) failureCode = code;
    }
    current = record['cause'];
  }
  return outputFailureLabel(validationCode ?? failureCode ?? '', repaired);
}

function outputFailureLabel(code: string, repaired: boolean): OutputFailureInspection | null {
  if (code === 'RESPONSE_TRUNCATED') {
    return { reason: code, label: '响应截断', repaired };
  }
  if (code === 'INVALID_JSON' || code === 'AMBIGUOUS_JSON') {
    return { reason: code, label: 'JSON 解析', repaired };
  }
  if (code === 'SCHEMA_VALIDATION_FAILED' || code.startsWith('SCHEMA_')) {
    return { reason: code, label: 'Schema 验证', repaired };
  }
  if (code.endsWith('_BUSINESS_RULE_INVALID')) {
    return { reason: code, label: '业务规则', repaired };
  }
  return null;
}

function outputFailurePresentation(
  failure: OutputFailureInspection | null,
): ErrorPresentation | null {
  if (failure === null) return null;
  const prefix = failure.repaired ? '结构修复后的' : '';
  if (failure.reason === 'RESPONSE_TRUNCATED') {
    return {
      title: `${prefix}模型响应未完整返回`,
      detail: 'Provider 在 JSON 完成前停止了响应；未完成的世界草稿没有写入存档。',
    };
  }
  if (failure.reason === 'AMBIGUOUS_JSON') {
    return {
      title: `${prefix}模型返回了多个 JSON 对象`,
      detail: '无法安全判定唯一结果；冲突内容没有写入存档。',
    };
  }
  if (failure.reason === 'INVALID_JSON') {
    return {
      title: `${prefix}模型返回内容无法解析`,
      detail: '响应不是可验证的完整 JSON；不合规内容没有写入存档。',
    };
  }
  if (failure.reason.endsWith('_BUSINESS_RULE_INVALID')) {
    return {
      title: `${prefix}模型输出违反世界规则`,
      detail: 'JSON 结构有效，但内容不符合本地业务规则；结果没有写入存档。',
    };
  }
  return {
    title: `${prefix}模型输出结构不符合要求`,
    detail: 'JSON 已解析，但必填字段、字段类型或枚举未通过 Schema；结果没有写入存档。',
  };
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
  if (
    code === 'INVALID_OUTPUT' ||
    code === 'AMBIGUOUS_JSON' ||
    code === 'RESPONSE_TRUNCATED' ||
    code.startsWith('SCHEMA_')
  ) {
    return '重新生成';
  }
  if (code === 'NETWORK_FAILED') return '重试连接';
  return '重试相同操作';
}

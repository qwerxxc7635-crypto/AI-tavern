import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

import type { CampaignSummary } from './campaign-gateway.js';
import { playerText } from './localization/index.js';
import {
  tauriRecoveryGateway,
  type CampaignRecoverySnapshot,
  type RecoveryGateway,
} from './recovery-service.js';

export function RecoveryPage({
  gateway = tauriRecoveryGateway,
}: {
  readonly gateway?: RecoveryGateway;
}) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const campaignId = params.get('campaignId');
  const [snapshot, setSnapshot] = useState<CampaignRecoverySnapshot | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (campaignId === null) return;
    let active = true;
    void gateway
      .inspect(campaignId)
      .then((loaded) => {
        if (active) setSnapshot(loaded);
      })
      .catch(() => {
        if (active) setStatus('无法读取恢复信息。请返回存档首页后重试。');
      });
    return () => {
      active = false;
    };
  }, [campaignId, gateway]);

  async function restore() {
    if (campaignId === null) return;
    setBusy(true);
    setStatus(null);
    try {
      const campaign = await gateway.restore(campaignId);
      navigate(destinationFor(campaign));
    } catch {
      setStatus('恢复没有完成；本地存档保持在恢复状态，请重启应用后再试。');
      setBusy(false);
    }
  }

  if (campaignId === null) {
    return (
      <main className="recovery-page">
        <h1>没有选择需要恢复的存档</h1>
        <Link to="/saves">返回存档首页</Link>
      </main>
    );
  }

  return (
    <main className="recovery-page">
      <header>
        <p className="eyebrow">{playerText.coreUi.recoveryCenter}</p>
        <h1>恢复未完成的操作</h1>
        <p>检测到上次生成或提交没有完整结束。恢复操作不会重复提交已完成回合。</p>
      </header>
      {snapshot === null && status === null ? (
        <p aria-live="polite">正在检查最近完整状态…</p>
      ) : null}
      {snapshot === null ? null : (
        <section className="recovery-page__panel">
          <h2>存档 {snapshot.campaign.id.slice(0, 8)}</h2>
          <p>可恢复到：{snapshot.resumeState}</p>
          <p>待取消的未完成请求：{snapshot.unfinishedRequestCount}</p>
          <p>应用会取消未完成请求，并原子恢复到上一次已提交阶段。</p>
          <div className="recovery-page__actions">
            <button
              className="primary-action"
              type="button"
              disabled={busy}
              onClick={() => void restore()}
            >
              {busy ? '正在恢复…' : '恢复最近完整状态'}
            </button>
            <Link
              className="quiet-action"
              to={{
                pathname: '/settings',
                search: `?campaignId=${encodeURIComponent(campaignId)}`,
              }}
            >
              打开模型设置
            </Link>
            <Link className="quiet-action" to="/saves">
              返回存档首页
            </Link>
          </div>
        </section>
      )}
      {status === null ? null : (
        <p className="inline-error" role="alert">
          {status}
        </p>
      )}
    </main>
  );
}

function destinationFor(campaign: CampaignSummary): string {
  const path =
    campaign.state === 'CREATING_WORLD' || campaign.state === 'REVIEWING_WORLD'
      ? '/world'
      : campaign.state === 'CREATING_CHARACTER'
        ? '/character/create'
        : campaign.state === 'ADVENTURE'
          ? '/adventure'
          : '/tavern';
  return `${path}?campaignId=${encodeURIComponent(campaign.id)}`;
}

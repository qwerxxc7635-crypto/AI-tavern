import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import {
  tauriCampaignGateway,
  type CampaignGateway,
  type CampaignSummary,
} from './campaign-gateway.js';

const STATE_LABELS: Readonly<Record<CampaignSummary['state'], string>> = {
  CREATING_WORLD: '构筑世界',
  REVIEWING_WORLD: '确认世界',
  CREATING_CHARACTER: '创建角色',
  GENERATING_TAVERN: '点亮酒馆',
  TAVERN: '酒馆',
  ADVENTURE: '冒险途中',
  SETTLEMENT: '冒险结算',
  GENERATION_FAILED: '等待恢复',
  WAITING_FOR_MODEL: '等待模型',
  RECOVERY_REQUIRED: '需要恢复',
};

interface SaveHomePageProps {
  readonly gateway?: CampaignGateway;
}

export function SaveHomePage({ gateway = tauriCampaignGateway }: SaveHomePageProps) {
  const navigate = useNavigate();
  const [campaigns, setCampaigns] = useState<readonly CampaignSummary[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setError(null);
    const loaded = await gateway.list();
    setCampaigns(loaded);
  }, [gateway]);

  useEffect(() => {
    let active = true;
    void gateway
      .list()
      .then((loaded) => {
        if (active) setCampaigns(loaded);
      })
      .catch(() => {
        if (active) setError('暂时无法读取本地存档。请重新启动应用后再试。');
      });
    return () => {
      active = false;
    };
  }, [gateway]);

  async function createCampaign() {
    setBusyId('new');
    try {
      await gateway.create();
      await reload();
    } catch {
      setError('新存档没有创建成功，本地数据未被修改。');
    } finally {
      setBusyId(null);
    }
  }

  async function continueCampaign(campaign: CampaignSummary) {
    setBusyId(campaign.id);
    try {
      const continued = await gateway.continueCampaign(campaign.id);
      const destination =
        continued.state === 'CREATING_WORLD' || continued.state === 'REVIEWING_WORLD'
          ? '/world'
          : continued.state === 'CREATING_CHARACTER'
            ? '/character/create'
            : '/tavern';
      navigate(`${destination}?campaignId=${encodeURIComponent(continued.id)}`);
    } catch {
      setError('无法继续该存档。请返回列表后重试。');
      setBusyId(null);
    }
  }

  async function archiveCampaign(campaign: CampaignSummary) {
    const accepted = window.confirm('归档后，该存档会从当前列表中移除。确定继续吗？');
    if (!accepted) return;
    setBusyId(campaign.id);
    try {
      await gateway.archive(campaign.id);
      await reload();
    } catch {
      setError('存档没有归档成功，本地数据未被修改。');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <main className="save-home">
      <header className="save-home__header">
        <div className="save-home__brand" aria-hidden="true">
          <span />
        </div>
        <div>
          <p className="eyebrow">Local chronicles</p>
          <h1>选择一段旅程</h1>
          <p>每一页都保存在这台设备的 SQLite 存档中。</p>
        </div>
        <button
          className="primary-action"
          type="button"
          disabled={busyId !== null}
          onClick={() => void createCampaign()}
        >
          {busyId === 'new' ? '正在落笔…' : '新建存档'}
        </button>
      </header>

      {error === null ? null : (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}

      {campaigns === null && error === null ? (
        <section className="save-home__loading" aria-live="polite" aria-busy="true">
          <span className="loading-glyph" aria-hidden="true" />
          <p>正在翻阅本地账册…</p>
        </section>
      ) : null}

      {campaigns?.length === 0 ? (
        <section className="save-home__empty">
          <p className="eyebrow">No chronicles yet</p>
          <h2>炉边还没有你的故事。</h2>
          <p>新建存档后，世界构筑会从这里开始。归档内容仍保留在本地数据库中。</p>
        </section>
      ) : null}

      {campaigns !== null && campaigns.length > 0 ? (
        <section className="save-list" aria-label="本地存档">
          <div className="save-list__heading">
            <p>当前存档</p>
            <span>{campaigns.length.toString().padStart(2, '0')}</span>
          </div>
          {campaigns.map((campaign, index) => (
            <article className="save-card" key={campaign.id}>
              <div className="save-card__number" aria-hidden="true">
                {(index + 1).toString().padStart(2, '0')}
              </div>
              <div className="save-card__copy">
                <p className="save-card__state">{STATE_LABELS[campaign.state]}</p>
                <h2>存档 {campaign.id.slice(0, 8)}</h2>
                <p>
                  最后游玩：
                  <time dateTime={campaign.updatedAt}>{formatLastPlayed(campaign.updatedAt)}</time>
                </p>
              </div>
              <div className="save-card__actions">
                <button
                  className="primary-action primary-action--small"
                  type="button"
                  disabled={busyId !== null}
                  onClick={() => void continueCampaign(campaign)}
                >
                  {busyId === campaign.id ? '正在打开…' : '继续'}
                </button>
                <button
                  className="quiet-action"
                  type="button"
                  disabled={busyId !== null}
                  onClick={() => void archiveCampaign(campaign)}
                >
                  归档
                </button>
              </div>
            </article>
          ))}
        </section>
      ) : null}

      <footer className="save-home__footer">
        <span aria-hidden="true" />
        本地离线 · 存档不会发送到模型服务
      </footer>
    </main>
  );
}

function formatLastPlayed(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

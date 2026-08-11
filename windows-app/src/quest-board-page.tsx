import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import {
  windowsQuestBoardService,
  type QuestBoardSnapshot,
  type QuestView,
  type WindowsQuestBoardService,
} from './quest-board-service.js';
import { playerText } from './localization/index.js';

type QuestActions = Pick<WindowsQuestBoardService, 'load' | 'initialize' | 'accept'>;

const RISK_LABELS: Readonly<Record<QuestView['risk'], string>> = {
  LOW: '低',
  MODERATE: '中等',
  HIGH: '高',
  EXTREME: '极高',
};

const ATTRIBUTE_LABELS: Readonly<Record<QuestView['recommendedAttributes'][number], string>> = {
  physique: '体魄',
  agility: '敏捷',
  knowledge: '知识',
  charisma: '魅力',
};

export function QuestBoardPage({
  service = windowsQuestBoardService,
}: {
  readonly service?: QuestActions;
}) {
  const [search] = useSearchParams();
  const campaignId = search.get('campaignId');
  const [snapshot, setSnapshot] = useState<QuestBoardSnapshot | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (campaignId === null) return;
    let active = true;
    void service
      .load(campaignId)
      .then((loaded) => (loaded.quests.length < 2 ? service.initialize(campaignId) : loaded))
      .then((loaded) => {
        if (!active) return;
        setSnapshot(loaded);
        setSelectedId(
          loaded.quests.find(({ status }) => status === 'ACCEPTED' || status === 'ACTIVE')?.id ??
            loaded.quests[0]?.id ??
            null,
        );
      })
      .catch(() => {
        if (active) setError('任务告示没有成功展开，本地存档没有发生改变。');
      });
    return () => {
      active = false;
    };
  }, [campaignId, service]);

  const selected = useMemo(
    () => snapshot?.quests.find(({ id }) => id === selectedId) ?? null,
    [selectedId, snapshot],
  );
  const hasMainQuest =
    snapshot?.quests.some(({ status }) => status === 'ACCEPTED' || status === 'ACTIVE') ?? false;

  async function acceptSelected() {
    if (campaignId === null || selected === null || busy) return;
    setBusy(true);
    setError(null);
    try {
      setSnapshot(await service.accept(campaignId, selected.id));
    } catch {
      setError('当前已有主任务，或该任务已经不能接受。');
    } finally {
      setBusy(false);
    }
  }

  if (campaignId === null) {
    return <QuestMessage title="任务" detail="请先从存档首页选择一段旅程。" />;
  }
  if (snapshot === null) {
    return error === null ? (
      <main className="quest-board-page" aria-busy="true">
        <p className="eyebrow">{playerText.coreUi.readingNoticeBoard}</p>
        <h1>正在整理任务告示…</h1>
      </main>
    ) : (
      <QuestMessage title={error} />
    );
  }
  if (snapshot.campaignState !== 'TAVERN') {
    return <QuestMessage title="只有回到酒馆时才能查看和接受任务。" />;
  }

  return (
    <main className="quest-board-page">
      <header className="quest-board-header">
        <div>
          <p className="eyebrow">{snapshot.source.tavernName} · 任务告示</p>
          <h1>任务告示</h1>
          <p>选择一份委托，先确认风险、目标和推荐能力。</p>
        </div>
        <span>{snapshot.quests.length} 份委托</span>
      </header>

      <div className="quest-board-layout">
        <section className="quest-list" aria-label="任务列表">
          {snapshot.quests.map((quest) => (
            <button
              type="button"
              key={quest.id}
              className={quest.id === selectedId ? 'quest-card quest-card--selected' : 'quest-card'}
              aria-pressed={quest.id === selectedId}
              onClick={() => setSelectedId(quest.id)}
            >
              <small>
                风险 {RISK_LABELS[quest.risk]} · {quest.publisherName}
              </small>
              <strong>{quest.content.title}</strong>
              <span>{quest.content.summary}</span>
              <em>{statusLabel(quest.status)}</em>
            </button>
          ))}
        </section>

        {selected === null ? null : (
          <article className="quest-detail" aria-live="polite">
            <div className="quest-detail__heading">
              <div>
                <p className="eyebrow">发布者：{selected.publisherName}</p>
                <h2>{selected.content.title}</h2>
              </div>
              <span className={`risk-badge risk-badge--${selected.risk.toLowerCase()}`}>
                {RISK_LABELS[selected.risk]}风险
              </span>
            </div>
            <p>{selected.content.summary}</p>
            <dl>
              <div>
                <dt>任务目标</dt>
                <dd>{selected.content.objective}</dd>
              </div>
              <div>
                <dt>失败代价</dt>
                <dd>{selected.content.failureCost}</dd>
              </div>
              <div>
                <dt>预计长度</dt>
                <dd>
                  {selected.expectedTurnsMin}–{selected.expectedTurnsMax} 回合
                </dd>
              </div>
              <div>
                <dt>奖励级别</dt>
                <dd>{selected.rewardTier}</dd>
              </div>
            </dl>
            <div className="quest-attributes">
              <span>推荐属性</span>
              {selected.recommendedAttributes.map((attribute) => (
                <strong key={attribute}>{ATTRIBUTE_LABELS[attribute]}</strong>
              ))}
            </div>
            {selected.status === 'ACCEPTED' || selected.status === 'ACTIVE' ? (
              <Link
                className="primary-action"
                to={`/adventure?campaignId=${encodeURIComponent(campaignId)}&questId=${encodeURIComponent(selected.id)}`}
              >
                进入冒险准备
              </Link>
            ) : (
              <button
                className="primary-action"
                type="button"
                disabled={busy || hasMainQuest || selected.status !== 'AVAILABLE'}
                onClick={() => void acceptSelected()}
              >
                {hasMainQuest ? '已有主任务' : busy ? '正在接受…' : '接受任务'}
              </button>
            )}
            {error === null ? null : (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
          </article>
        )}
      </div>
    </main>
  );
}

function statusLabel(status: QuestView['status']): string {
  switch (status) {
    case 'AVAILABLE':
      return '可接受';
    case 'ACCEPTED':
      return '已接受';
    case 'ACTIVE':
      return '进行中';
    case 'COMPLETED':
      return '已完成';
    case 'FAILED':
      return '失败';
    case 'ABANDONED':
      return '已放弃';
  }
}

function QuestMessage({ title, detail }: { readonly title: string; readonly detail?: string }) {
  return (
    <main className="quest-board-page">
      <p className="eyebrow">{playerText.coreUi.questBoardUnavailable}</p>
      <h1>{title}</h1>
      {detail === undefined ? null : <p>{detail}</p>}
      <Link className="text-link" to="/tavern">
        返回酒馆
      </Link>
    </main>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import {
  windowsQuestBoardService,
  type QuestBoardSnapshot,
  type QuestView,
  type WindowsQuestBoardService,
} from './quest-board-service.js';
import { playerText } from './localization/index.js';
import { APP_PATHS, buildRoute, campaignParentRoute } from './navigation.js';
import { AIErrorNotice } from './ai-error-notice.js';
import { QuestCard } from './ui/game-components.js';

type QuestActions = Pick<WindowsQuestBoardService, 'load' | 'initialize' | 'intervene' | 'abandon'>;

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
  const [error, setError] = useState<unknown | null>(null);

  useEffect(() => {
    if (campaignId === null) return;
    let active = true;
    void service
      .load(campaignId)
      .then((loaded) => (loaded.quests.length < 2 ? service.initialize(campaignId) : loaded))
      .then((loaded) => {
        if (!active) return;
        setSnapshot(loaded);
        const visible = loaded.quests.filter(({ status }) => status !== 'HIDDEN');
        setSelectedId(
          visible.find(({ status }) => status === 'ACCEPTED' || status === 'ACTIVE')?.id ??
            visible[0]?.id ??
            null,
        );
      })
      .catch((caught: unknown) => {
        if (active) setError(caught);
      });
    return () => {
      active = false;
    };
  }, [campaignId, service]);

  const selected = useMemo(
    () => snapshot?.quests.find(({ id }) => id === selectedId) ?? null,
    [selectedId, snapshot],
  );
  const visibleQuests = useMemo(
    () => snapshot?.quests.filter(({ status }) => status !== 'HIDDEN') ?? [],
    [snapshot],
  );

  async function interveneSelected() {
    if (campaignId === null || selected === null || busy) return;
    setBusy(true);
    setError(null);
    try {
      setSnapshot(await service.intervene(campaignId, selected.id, selected.revision));
    } catch (cause) {
      setError(new Error('任务状态已经变化，无法按当前版本介入。', { cause }));
    } finally {
      setBusy(false);
    }
  }

  async function abandonSelected() {
    if (campaignId === null || selected === null || busy) return;
    setBusy(true);
    setError(null);
    try {
      setSnapshot(await service.abandon(campaignId, selected.id, selected.revision));
    } catch (cause) {
      setError(new Error('任务状态已经变化，无法按当前版本放弃。', { cause }));
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
      <main className="quest-board-page">
        <p className="eyebrow">任务告示尚未完成</p>
        <h1>本地存档没有发生改变。</h1>
        <AIErrorNotice error={error} />
      </main>
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
          <p>任务可以并行推进；实际介入会直接激活，不需要先接受为唯一主任务。</p>
        </div>
        <span>{visibleQuests.length} 份可见任务</span>
      </header>

      <div className="quest-board-layout">
        <section className="quest-list" aria-label="任务列表">
          {visibleQuests.map((quest) => (
            <QuestCard
              key={quest.id}
              className="quest-card"
              selected={quest.id === selectedId}
              onSelect={() => setSelectedId(quest.id)}
              quest={{
                id: quest.id,
                risk: RISK_LABELS[quest.risk],
                publisher: quest.publisherName,
                title: quest.content.title,
                summary: quest.content.summary,
                status: statusLabel(quest.status),
              }}
            />
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
            <p>
              状态依据：{selected.statusReason} · 修订 {selected.revision}
            </p>
            <div className="quest-detail__actions">
              {selected.status === 'ACCEPTED' || selected.status === 'ACTIVE' ? (
                <Link
                  className="primary-action"
                  to={buildRoute(APP_PATHS.adventure, {
                    campaignId,
                    questId: selected.id,
                  })}
                >
                  进入冒险准备
                </Link>
              ) : ['DISCOVERED', 'AVAILABLE', 'UPDATED'].includes(selected.status) ? (
                <button
                  className="primary-action"
                  type="button"
                  disabled={busy}
                  onClick={() => void interveneSelected()}
                >
                  {busy ? '正在介入…' : '介入任务'}
                </button>
              ) : null}
              {canAbandon(selected.status) ? (
                <button
                  className="quiet-action"
                  type="button"
                  disabled={busy}
                  onClick={() => void abandonSelected()}
                >
                  放弃任务
                </button>
              ) : null}
            </div>
            {error === null ? null : (
              <p className="form-error" role="alert">
                {typeof error === 'string' ? error : '操作未完成，请重试。'}
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
    case 'HIDDEN':
      return '隐藏';
    case 'DISCOVERED':
      return '已发现';
    case 'AVAILABLE':
      return '可接受';
    case 'ACCEPTED':
      return '已接受';
    case 'ACTIVE':
      return '进行中';
    case 'BLOCKED':
      return '受阻';
    case 'UPDATED':
      return '有更新';
    case 'COMPLETED':
      return '已完成';
    case 'FAILED':
      return '失败';
    case 'EXPIRED':
      return '已过期';
    case 'ABANDONED':
      return '已放弃';
  }
}

function canAbandon(status: QuestView['status']): boolean {
  return ['DISCOVERED', 'AVAILABLE', 'ACCEPTED', 'ACTIVE', 'BLOCKED', 'UPDATED'].includes(status);
}

function QuestMessage({ title, detail }: { readonly title: string; readonly detail?: string }) {
  const [search] = useSearchParams();
  return (
    <main className="quest-board-page">
      <p className="eyebrow">{playerText.coreUi.questBoardUnavailable}</p>
      <h1>{title}</h1>
      {detail === undefined ? null : <p>{detail}</p>}
      <Link className="text-link" to={campaignParentRoute(search, APP_PATHS.tavern)}>
        {search.has('campaignId') ? '返回酒馆' : '返回存档首页'}
      </Link>
    </main>
  );
}

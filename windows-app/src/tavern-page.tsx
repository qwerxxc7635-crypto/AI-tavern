import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import {
  windowsTavernService,
  type RumorView,
  type TavernNpcView,
  type TavernSnapshot,
  type WindowsTavernService,
} from './tavern-service.js';
import { playerText } from './localization/index.js';
import { AIErrorNotice } from './ai-error-notice.js';

type TavernActions = Pick<WindowsTavernService, 'load' | 'initialize'>;

interface TavernPageProps {
  readonly service?: TavernActions;
}

const RESIDENCY_LABELS: Readonly<Record<TavernNpcView['residency'], string>> = {
  OWNER: '酒馆老板',
  RESIDENT: '常驻客人',
  TEMPORARY_VISITOR: '临时访客',
};

export function TavernPage({ service = windowsTavernService }: TavernPageProps) {
  const [search] = useSearchParams();
  const campaignId = search.get('campaignId');
  const [snapshot, setSnapshot] = useState<TavernSnapshot | null>(null);
  const [selectedNpcId, setSelectedNpcId] = useState<string | null>(null);
  const [error, setError] = useState<unknown | null>(null);

  const initialize = () => {
    if (campaignId === null) return;
    setError(null);
    void service
      .load(campaignId)
      .then((loaded) =>
        loaded.campaignState === 'GENERATING_TAVERN' ? service.initialize(campaignId) : loaded,
      )
      .then((loaded) => {
        setSnapshot(loaded);
        setSelectedNpcId(loaded.npcs[0]?.id ?? null);
      })
      .catch(setError);
  };

  useEffect(() => {
    if (campaignId === null) return;
    let active = true;
    void service
      .load(campaignId)
      .then((loaded) =>
        loaded.campaignState === 'GENERATING_TAVERN' ? service.initialize(campaignId) : loaded,
      )
      .then((loaded) => {
        if (!active) return;
        setSnapshot(loaded);
        setSelectedNpcId(loaded.npcs[0]?.id ?? null);
      })
      .catch((caught: unknown) => {
        if (active) setError(caught);
      });
    return () => {
      active = false;
    };
  }, [campaignId, service]);

  const selectedNpc = useMemo(
    () => snapshot?.npcs.find(({ id }) => id === selectedNpcId) ?? null,
    [selectedNpcId, snapshot],
  );

  if (campaignId === null) {
    return <TavernMessage title="先从存档首页选择一段旅程。" />;
  }
  if (snapshot === null) {
    return error === null ? (
      <main className="tavern-room tavern-room--loading" aria-busy="true" aria-live="polite">
        <div className="hearth-loader" aria-hidden="true">
          <span />
        </div>
        <p className="eyebrow">{playerText.coreUi.lightingHearth}</p>
        <h1>正在点亮酒馆…</h1>
        <p>模型生成的内容会先经过验证，再由本地 SQLite 提交。</p>
      </main>
    ) : (
      <main className="tavern-room tavern-room--message">
        <p className="eyebrow">酒馆生成尚未完成</p>
        <h1>本地存档仍保持在上一个有效阶段。</h1>
        <AIErrorNotice error={error} onRetry={initialize} />
      </main>
    );
  }
  if (snapshot.campaignState !== 'TAVERN' || snapshot.tavern === null) {
    return <TavernMessage title="这个存档还不能进入酒馆。" />;
  }

  const tavern = snapshot.tavern;
  return (
    <main className="tavern-room">
      <section className="tavern-header">
        <div>
          <p className="eyebrow">
            {snapshot.source.world.currentRegion} · {playerText.coreUi.localChronicle}
          </p>
          <h1>{tavern.name}</h1>
          <p className="tavern-header__position">{tavern.position}</p>
        </div>
        <div className="tavern-header__clock" aria-label="当前世界时钟数量">
          <strong>{snapshot.clocks.length.toString().padStart(2, '0')}</strong>
          <span>活动时钟</span>
        </div>
      </section>

      <section className="tavern-atmosphere">
        <p>{tavern.environment}</p>
        <div>
          <span>长期问题</span>
          <strong>{tavern.longTermProblem}</strong>
        </div>
        <ul>
          {tavern.specialRules.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ul>
      </section>
      {tavern.changes.length === 0 ? null : (
        <section className="tavern-changes">
          <p className="eyebrow">{playerText.coreUi.returnedStories}</p>
          <h2>冒险留下的变化</h2>
          <ul>
            {tavern.changes.map((change) => (
              <li key={change.id}>
                <strong>{change.kind}</strong>
                <span>{change.description}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="tavern-grid">
        <section className="tavern-patrons">
          <div className="section-heading">
            <div>
              <p className="eyebrow">{playerText.coreUi.peopleByFire}</p>
              <h2>今晚的面孔</h2>
            </div>
            <span>{snapshot.npcs.length} 人</span>
          </div>
          <div className="patron-list">
            {snapshot.npcs.map((npc) => (
              <button
                className={
                  npc.id === selectedNpcId ? 'patron-card patron-card--selected' : 'patron-card'
                }
                type="button"
                key={npc.id}
                aria-pressed={npc.id === selectedNpcId}
                onClick={() => setSelectedNpcId(npc.id)}
              >
                <span className="patron-card__sigil" aria-hidden="true">
                  {npc.name.slice(0, 1)}
                </span>
                <span className="patron-card__copy">
                  <small>
                    {RESIDENCY_LABELS[npc.residency]} · {npc.currentMood}
                  </small>
                  <strong>{npc.name}</strong>
                  <span>{npc.identity}</span>
                </span>
              </button>
            ))}
          </div>
          {selectedNpc === null ? null : (
            <article className="selected-patron" aria-live="polite">
              <div>
                <p className="eyebrow">{playerText.coreUi.selectedPatron}</p>
                <h3>{selectedNpc.name}</h3>
              </div>
              <p>{selectedNpc.appearance}</p>
              <p>{selectedNpc.personality}</p>
              {selectedNpc.visitReason === null ? null : (
                <p>
                  <strong>来访原因：</strong>
                  {selectedNpc.visitReason}
                </p>
              )}
              <Link
                className="primary-action"
                to={`/npc?campaignId=${encodeURIComponent(campaignId)}&npcId=${encodeURIComponent(selectedNpc.id)}`}
              >
                开始交谈
              </Link>
            </article>
          )}
        </section>

        <aside className="tavern-sidebar">
          <section className="rumor-board">
            <p className="eyebrow">{playerText.coreUi.whispers}</p>
            <h2>炉边传闻</h2>
            <ol>
              {snapshot.rumors.map((rumor, index) => (
                <li key={rumor.id}>
                  <span>{(index + 1).toString().padStart(2, '0')}</span>
                  <p>{rumor.statement}</p>
                  <small>
                    — {npcName(snapshot.npcs, rumor.sourceNpcId)} ·{' '}
                    {rumorSourceLabel(rumor.sourceBasis)}
                  </small>
                </li>
              ))}
            </ol>
          </section>

          <section className="quest-door">
            <p className="eyebrow">{playerText.coreUi.questBoard}</p>
            <h2>告示板</h2>
            <p>常驻者会把需要帮手的事情钉在这里。任务详情与接受操作由任务页面处理。</p>
            <Link
              className="primary-action"
              to={`/quests?campaignId=${encodeURIComponent(campaignId)}`}
            >
              选择任务入口
            </Link>
          </section>
        </aside>
      </div>

      <section className="clock-board" aria-label="世界时钟">
        <div className="section-heading">
          <div>
            <p className="eyebrow">{playerText.coreUi.worldPressure}</p>
            <h2>世界时钟</h2>
          </div>
          <span>SQLite 事实</span>
        </div>
        <div className="clock-list">
          {snapshot.clocks.map((clock) => (
            <article key={clock.id}>
              <div>
                <strong>{clock.name}</strong>
                <span>
                  {clock.current} / {clock.max}
                </span>
              </div>
              <div
                className="clock-track"
                aria-label={`${clock.name} ${clock.current}/${clock.max}`}
              >
                {Array.from({ length: clock.max }, (_, index) => (
                  <span
                    key={index}
                    className={index < clock.current ? 'clock-track__filled' : undefined}
                  />
                ))}
              </div>
              <p>{clock.stages.find(({ at }) => at > clock.current)?.title ?? '阶段已完成'}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

function rumorSourceLabel(source: RumorView['sourceBasis']): string {
  switch (source) {
    case 'WITNESS':
      return '亲历';
    case 'HEARSAY':
      return '转述';
    case 'PERSONAL_BELIEF':
      return '个人判断';
    case 'FACTION_MESSAGE':
      return '势力消息';
  }
}

function TavernMessage({ title }: { readonly title: string }) {
  return (
    <main className="tavern-room tavern-room--loading" role="alert">
      <p className="eyebrow">{playerText.coreUi.tavernUnavailable}</p>
      <h1>{title}</h1>
      <Link className="text-link" to="/saves">
        返回存档首页
      </Link>
    </main>
  );
}

function npcName(npcs: readonly TavernNpcView[], id: string): string {
  return npcs.find((npc) => npc.id === id)?.name ?? '一位不愿留名的客人';
}

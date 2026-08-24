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
import { APP_PATHS, buildRoute, campaignRoute } from './navigation.js';
import { AIErrorNotice } from './ai-error-notice.js';
import { NpcCard } from './ui/game-components.js';
import { ActionComposer, DialogueView } from './ui/game-components.js';
import {
  tavernPopulationService,
  type TavernPopulationService,
} from './tavern-population-service.js';
import { tavernSceneService, type TavernSceneService } from './tavern-scene-service.js';
import type { TavernPopulationSnapshot, TavernSceneSnapshot } from '@ember-tavern/contracts';

type TavernActions = Pick<WindowsTavernService, 'load' | 'initialize'>;

interface TavernPageProps {
  readonly service?: TavernActions;
  readonly populationService?: Pick<TavernPopulationService, 'refresh' | 'focus'>;
  readonly sceneService?: Pick<TavernSceneService, 'start' | 'send'>;
}

const RESIDENCY_LABELS: Readonly<Record<TavernNpcView['residency'], string>> = {
  OWNER: '酒馆老板',
  RESIDENT: '常驻客人',
  TEMPORARY_VISITOR: '临时访客',
};

export function TavernPage({
  service = windowsTavernService,
  populationService = tavernPopulationService,
  sceneService = tavernSceneService,
}: TavernPageProps) {
  const [search] = useSearchParams();
  const campaignId = search.get('campaignId');
  const [snapshot, setSnapshot] = useState<TavernSnapshot | null>(null);
  const [selectedNpcId, setSelectedNpcId] = useState<string | null>(null);
  const [error, setError] = useState<unknown | null>(null);
  const [population, setPopulation] = useState<TavernPopulationSnapshot | null>(null);
  const [scene, setScene] = useState<TavernSceneSnapshot | null>(null);
  const [sceneSelection, setSceneSelection] = useState<ReadonlySet<string>>(new Set());
  const [sceneIntent, setSceneIntent] = useState('');
  const [sceneBusy, setSceneBusy] = useState(false);
  const [sceneError, setSceneError] = useState<string | undefined>();

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
        return populationService.refresh(campaignId, 'ENTERED');
      })
      .then(setPopulation)
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
        return populationService.refresh(campaignId, 'ENTERED');
      })
      .then((loaded) => {
        if (active && loaded !== undefined) setPopulation(loaded);
      })
      .catch((caught: unknown) => {
        if (active) setError(caught);
      });
    return () => {
      active = false;
    };
  }, [campaignId, populationService, service]);

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
  const presentPopulation =
    population?.members.filter(({ presence }) => presence === 'PRESENT') ?? [];
  const toggleSceneNpc = (npcId: string) => {
    setSceneSelection((current) => {
      const next = new Set(current);
      if (next.has(npcId)) next.delete(npcId);
      else if (next.size < 6) next.add(npcId);
      return next;
    });
  };
  const startScene = async () => {
    if (campaignId === null || population?.state === null || population === null) return;
    setSceneBusy(true);
    setSceneError(undefined);
    try {
      let focused = population;
      for (const npcId of sceneSelection) {
        const member = focused.members.find((candidate) => candidate.npcId === npcId);
        if (member?.profile.lod === 0 && focused.state !== null) {
          focused = await populationService.focus(campaignId, npcId, focused.state.revision);
        }
      }
      setPopulation(focused);
      setScene(await sceneService.start(campaignId, [...sceneSelection]));
    } catch (caught) {
      setSceneError(caught instanceof Error ? caught.message : '场景无法开始');
    } finally {
      setSceneBusy(false);
    }
  };
  const sendSceneIntent = async () => {
    if (campaignId === null || scene === null || sceneIntent.trim().length === 0) return;
    const intent = sceneIntent.trim();
    setSceneBusy(true);
    setSceneError(undefined);
    try {
      setScene(await sceneService.send(campaignId, scene, intent, selectedNpcId));
      setSceneIntent('');
    } catch (caught) {
      setSceneError(caught instanceof Error ? caught.message : '场景行动未完成');
    } finally {
      setSceneBusy(false);
    }
  };
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

      <section className="tavern-scene" aria-label="多人酒馆场景">
        <div className="section-heading">
          <div>
            <p className="eyebrow">炉边群像</p>
            <h2>多人场景</h2>
          </div>
          <span>{presentPopulation.length} 人在场</span>
        </div>
        {scene === null ? (
          <>
            <p>选择 2–6 位在场角色。尚未聚焦的背景人物会先按既有角色细化规则补全身份。</p>
            <div className="tavern-scene__participants">
              {presentPopulation.map((member) => (
                <NpcCard
                  key={member.npcId}
                  selected={sceneSelection.has(member.npcId)}
                  onSelect={() => toggleSceneNpc(member.npcId)}
                  npc={{
                    id: member.npcId,
                    name: member.profile.name ?? '尚未辨认的旅人',
                    identity: member.populationRole,
                    mood: member.profile.currentBehavior ?? '安静地留意炉边动静',
                    residency: member.sourceKind === 'OWNER' ? '酒馆老板' : member.populationRole,
                  }}
                />
              ))}
            </div>
            <button
              className="primary-action"
              disabled={sceneSelection.size < 2 || sceneBusy}
              onClick={() => void startScene()}
            >
              {sceneBusy ? '正在聚拢众人…' : '开始多人场景'}
            </button>
          </>
        ) : (
          <div className="tavern-scene__play">
            <div className="tavern-scene__status">
              {scene.participants.map((participant) => (
                <span key={participant.npcId}>
                  {participant.name} · {sceneParticipantLabel(participant.status)}
                </span>
              ))}
            </div>
            <DialogueView
              label="多人场景记录"
              emptyText="先向炉边众人开口。"
              loading={sceneBusy}
              {...(sceneError === undefined ? {} : { error: sceneError })}
              messages={scene.turns.flatMap((turn) => [
                {
                  id: `${turn.id}:player`,
                  speaker: '你',
                  content: turn.playerIntent,
                  side: 'PLAYER' as const,
                },
                ...turn.actions
                  .filter(({ selected }) => selected)
                  .map((action) => ({
                    id: `${turn.id}:${action.actorId}`,
                    speaker:
                      scene.participants.find(({ npcId }) => npcId === action.actorId)?.name ??
                      '某位客人',
                    content: action.utterance ?? sceneActionLabel(action.action),
                    side: action.utterance === null ? ('SYSTEM' as const) : ('NPC' as const),
                  })),
              ])}
            />
            <ActionComposer
              label="向场景行动"
              description="可直接说话、观察或点名回应；每位 NPC 只会收到自己的知识上下文。"
              value={sceneIntent}
              suggestions={scene.participants
                .filter(({ status }) => status !== 'LEFT')
                .map((participant) => ({ id: participant.npcId, label: `问 ${participant.name}` }))}
              submitLabel="推进场景"
              submitting={sceneBusy}
              {...(sceneError === undefined ? {} : { error: sceneError })}
              onChange={setSceneIntent}
              onSuggestion={(suggestion) => {
                setSelectedNpcId(suggestion.id);
                setSceneIntent(`我转向${suggestion.label.slice(2)}问道：`);
              }}
              onSubmit={() => void sendSceneIntent()}
            />
          </div>
        )}
      </section>

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
              <NpcCard
                key={npc.id}
                className="patron-card"
                selected={npc.id === selectedNpcId}
                onSelect={() => setSelectedNpcId(npc.id)}
                npc={{
                  id: npc.id,
                  name: npc.name,
                  identity: npc.identity,
                  mood: npc.currentMood,
                  residency: RESIDENCY_LABELS[npc.residency],
                }}
              />
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
                to={buildRoute(APP_PATHS.npc, {
                  campaignId,
                  npcId: selectedNpc.id,
                })}
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
            <Link className="primary-action" to={campaignRoute(APP_PATHS.quests, campaignId)}>
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
      <Link className="text-link" to={APP_PATHS.saves}>
        返回存档首页
      </Link>
    </main>
  );
}

function npcName(npcs: readonly TavernNpcView[], id: string): string {
  return npcs.find((npc) => npc.id === id)?.name ?? '一位不愿留名的客人';
}

function sceneParticipantLabel(
  status: TavernSceneSnapshot['participants'][number]['status'],
): string {
  return status === 'ACTIVE' ? '交谈中' : status === 'LISTENING' ? '旁听' : '已离开';
}

function sceneActionLabel(
  action: TavernSceneSnapshot['turns'][number]['actions'][number]['action'],
): string {
  return {
    SILENCE: '保持沉默。',
    EAVESDROP: '在一旁留意谈话。',
    LEAVE: '离开了炉边。',
    SPEAK: '开口说话。',
    INTERRUPT: '打断了谈话。',
    INTERVENE: '介入了谈话。',
  }[action];
}

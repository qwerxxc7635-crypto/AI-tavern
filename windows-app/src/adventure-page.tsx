import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

import {
  windowsAdventureService,
  type AdventureSnapshot,
  type WindowsAdventureService,
} from './adventure-service.js';
import { windowsSettlementService, type WindowsSettlementService } from './settlement-service.js';
import { AIErrorNotice } from './ai-error-notice.js';
import { playerText } from './localization/index.js';
import type { AdventureActionMode } from '@ember-tavern/contracts';

type AdventureActions = Pick<
  WindowsAdventureService,
  'load' | 'prepare' | 'start' | 'act' | 'resolveCheck'
>;

const ATTRIBUTE_LABELS = {
  physique: '体魄',
  agility: '敏捷',
  knowledge: '知识',
  charisma: '魅力',
} as const;

const ACTION_MODES: readonly {
  readonly mode: AdventureActionMode;
  readonly label: string;
  readonly placeholder: string;
}[] = [
  { mode: 'ACTION', label: '行动', placeholder: '描述角色下一步要做什么…' },
  { mode: 'DIALOGUE', label: '对话', placeholder: '描述要和谁说什么，以及想达成什么…' },
  { mode: 'OBSERVE', label: '观察', placeholder: '描述角色要仔细观察什么…' },
];

export function AdventurePage({
  service = windowsAdventureService,
  settlementService = windowsSettlementService,
}: {
  readonly service?: AdventureActions;
  readonly settlementService?: Pick<WindowsSettlementService, 'settle'>;
}) {
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const campaignId = search.get('campaignId');
  const questId = search.get('questId') ?? undefined;
  const [snapshot, setSnapshot] = useState<AdventureSnapshot | null>(null);
  const [action, setAction] = useState('');
  const [actionMode, setActionMode] = useState<AdventureActionMode>('ACTION');
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [aiError, setAiError] = useState<unknown | null>(null);
  const [retryOperation, setRetryOperation] = useState<(() => Promise<AdventureSnapshot>) | null>(
    null,
  );

  useEffect(() => {
    if (campaignId === null) return;
    let active = true;
    void service
      .load(campaignId, questId)
      .then((loaded) =>
        loaded.adventureId === null && questId !== undefined
          ? service.prepare(campaignId, questId)
          : loaded,
      )
      .then((loaded) => {
        if (active) setSnapshot(loaded);
      })
      .catch(() => {
        if (active) setLoadError('冒险记录无法载入，本地存档没有被更改。');
      });
    return () => {
      active = false;
    };
  }, [campaignId, questId, service]);

  async function run(operation: () => Promise<AdventureSnapshot>) {
    if (busy) return;
    setBusy(true);
    setAiError(null);
    setRetryOperation(null);
    try {
      setSnapshot(await operation());
      setAction('');
    } catch (error) {
      setAiError(error);
      setRetryOperation(() => operation);
    } finally {
      setBusy(false);
    }
  }

  if (campaignId === null) {
    return <AdventureMessage title="冒险" detail="请先从任务告示选择一项已接受的委托。" />;
  }
  if (snapshot === null) {
    return loadError === null ? (
      <main className="adventure-page adventure-page--loading" aria-busy="true">
        <p className="eyebrow">{playerText.coreUi.preparingRoad}</p>
        <h1>正在整理冒险记录…</h1>
      </main>
    ) : (
      <AdventureMessage title={loadError} />
    );
  }
  if (snapshot.adventureId === null || snapshot.state === null) {
    return <AdventureMessage title="当前没有可进入的冒险。" />;
  }
  const adventureId = snapshot.adventureId;
  if (snapshot.state === 'PREPARING') {
    return (
      <main className="adventure-page adventure-preparation">
        <p className="eyebrow">{playerText.coreUi.adventureReady}</p>
        <h1>{snapshot.quest.content.title}</h1>
        <p>{snapshot.quest.content.summary}</p>
        <dl>
          <div>
            <dt>任务目标</dt>
            <dd>{snapshot.quest.content.objective}</dd>
          </div>
          <div>
            <dt>角色</dt>
            <dd>
              {snapshot.player.name} · {snapshot.player.classDisplayName}
            </dd>
          </div>
        </dl>
        <button
          className="primary-action"
          type="button"
          disabled={busy}
          onClick={() => void run(() => service.start(campaignId, adventureId))}
        >
          {busy ? '正在启程…' : '开始冒险'}
        </button>
        {aiError === null ? null : (
          <AIErrorNotice
            error={aiError}
            onRetry={retryOperation === null ? undefined : () => void run(retryOperation)}
          />
        )}
      </main>
    );
  }

  const latestTurn = snapshot.turns.at(-1);
  const check = latestTurn?.checkRequest ?? null;
  const dice =
    [...snapshot.turns].reverse().find(({ diceResult }) => diceResult !== null)?.diceResult ?? null;
  const canAct = snapshot.state === 'SCENE';

  return (
    <main className="adventure-page">
      <header className="adventure-header">
        <div>
          <p className="eyebrow">{playerText.coreUi.adventureTurn(snapshot.currentTurnNumber)}</p>
          <h1>{snapshot.quest.content.title}</h1>
        </div>
        <span className={`adventure-state adventure-state--${snapshot.state.toLowerCase()}`}>
          {stateLabel(snapshot.state)}
        </span>
      </header>

      <div className="adventure-columns">
        <aside className="adventure-column adventure-character" aria-label="角色与目标">
          <section>
            <p className="eyebrow">{playerText.coreUi.character}</p>
            <h2>{snapshot.player.name}</h2>
            <p>{snapshot.player.classDisplayName}</p>
            <div className="attribute-grid">
              {Object.entries(snapshot.player.attributes).map(([name, value]) => (
                <span key={name}>
                  <small>{ATTRIBUTE_LABELS[name as keyof typeof ATTRIBUTE_LABELS]}</small>
                  <strong>{value}</strong>
                </span>
              ))}
            </div>
          </section>
          <section>
            <p className="eyebrow">{playerText.coreUi.objective}</p>
            <h3>{snapshot.quest.content.objective}</h3>
            <p>{snapshot.player.personalGoal}</p>
          </section>
          <section>
            <p className="eyebrow">{playerText.coreUi.worldClocks}</p>
            {snapshot.clocks.length === 0 ? (
              <p className="adventure-muted">暂无推进中的时钟</p>
            ) : (
              snapshot.clocks.map((clock) => (
                <div className="clock-row" key={clock.id}>
                  <span>{clock.name}</span>
                  <strong>
                    {clock.current}/{clock.max}
                  </strong>
                  <progress value={clock.current} max={clock.max} />
                </div>
              ))
            )}
          </section>
        </aside>

        <section className="adventure-column adventure-story" aria-label="剧情与行动">
          <div className="story-scroll" aria-live="polite">
            {snapshot.turns.length === 0 ? (
              <article>
                <small>序章</small>
                <p>{snapshot.currentScene}</p>
              </article>
            ) : (
              snapshot.turns.map((turn) => (
                <article key={turn.id}>
                  <small>
                    第 {turn.turnNumber} 回合 · {actionModeLabel(turn.actionMode)} ·{' '}
                    {turn.playerAction}
                  </small>
                  <p>{turn.sceneText}</p>
                </article>
              ))
            )}
          </div>

          {snapshot.state === 'ENDING' ? (
            <div className="adventure-ending">
              <p className="eyebrow">{playerText.coreUi.adventureEnding}</p>
              <h2>冒险已抵达结局</h2>
              <p>本轮记录已保存。结算将原子更新任务、人物、奖励与世界状态。</p>
              <button
                className="primary-action"
                type="button"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const archive = await settlementService.settle(campaignId, snapshot);
                    navigate(`/archives?campaignId=${encodeURIComponent(archive.campaignId)}`);
                    return snapshot;
                  })
                }
              >
                {busy ? '正在结算…' : '结算并查看档案'}
              </button>
            </div>
          ) : check !== null && snapshot.state === 'CHECK_REQUIRED' ? (
            <div className="check-prompt">
              <p>
                {ATTRIBUTE_LABELS[check.attribute]}检定 · 难度 {check.difficulty}
              </p>
              <span>{check.reason}</span>
              <button
                className="primary-action"
                type="button"
                disabled={busy}
                onClick={() => void run(() => service.resolveCheck(campaignId, adventureId))}
              >
                {busy ? '骰子落下…' : '投掷 D20'}
              </button>
            </div>
          ) : (
            <form
              className="adventure-actions"
              onSubmit={(event) => {
                event.preventDefault();
                if (action.trim().length > 0) {
                  void run(() => service.act(campaignId, adventureId, actionMode, action.trim()));
                }
              }}
            >
              <fieldset className="adventure-action-modes">
                <legend>选择意图</legend>
                {ACTION_MODES.map(({ mode, label }) => (
                  <label key={mode}>
                    <input
                      type="radio"
                      name="adventure-action-mode"
                      value={mode}
                      checked={actionMode === mode}
                      disabled={!canAct || busy}
                      onChange={() => setActionMode(mode)}
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </fieldset>
              <div className="suggested-actions">
                {snapshot.suggestedActions.map((suggestion) => (
                  <button
                    type="button"
                    key={suggestion}
                    disabled={!canAct || busy}
                    onClick={() => setAction(suggestion)}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
              <label htmlFor="player-action">自由输入</label>
              <p className="adventure-muted" id="free-input-help">
                可以忽略上方建议，直接描述角色想做、想说或想观察的内容。
              </p>
              <textarea
                id="player-action"
                aria-describedby="free-input-help"
                value={action}
                maxLength={4000}
                disabled={!canAct || busy}
                onChange={(event) => setAction(event.target.value)}
                placeholder={
                  ACTION_MODES.find(({ mode }) => mode === actionMode)?.placeholder ??
                  '描述角色下一步要做什么…'
                }
              />
              <button
                className="primary-action"
                type="submit"
                disabled={!canAct || busy || action.trim().length === 0}
              >
                {busy ? '正在推进…' : `提交${actionModeLabel(actionMode)}`}
              </button>
            </form>
          )}
          {aiError === null ? null : (
            <AIErrorNotice
              error={aiError}
              onRetry={retryOperation === null ? undefined : () => void run(retryOperation)}
            />
          )}
        </section>

        <aside className="adventure-column adventure-ledger" aria-label="物品线索与骰子">
          <section>
            <p className="eyebrow">{playerText.coreUi.items}</p>
            {snapshot.items.length === 0 ? (
              <p className="adventure-muted">行囊为空</p>
            ) : (
              snapshot.items.map((item) => (
                <div className="ledger-entry" key={item.id}>
                  <strong>{item.content.name}</strong>
                  <span>{item.content.description}</span>
                </div>
              ))
            )}
          </section>
          <section>
            <p className="eyebrow">{playerText.coreUi.clues}</p>
            {snapshot.clues.filter(({ discoveredInTurnId }) => discoveredInTurnId !== null)
              .length === 0 ? (
              <p className="adventure-muted">尚未发现线索</p>
            ) : (
              snapshot.clues
                .filter(({ discoveredInTurnId }) => discoveredInTurnId !== null)
                .map((clue) => (
                  <div className="ledger-entry" key={clue.id}>
                    <strong>{clue.title}</strong>
                    <span>{clue.description}</span>
                  </div>
                ))
            )}
          </section>
          <section className="dice-ledger">
            <p className="eyebrow">{playerText.coreUi.lastRoll}</p>
            {dice === null ? (
              <p className="adventure-muted">等待检定</p>
            ) : (
              <>
                <strong className="dice-face">{dice.naturalRoll}</strong>
                <span>
                  总计 {dice.total} / 难度 {dice.difficulty}
                </span>
                <em>{dice.success ? '成功' : '失败'}</em>
              </>
            )}
          </section>
        </aside>
      </div>
    </main>
  );
}

function actionModeLabel(mode: AdventureActionMode): string {
  return ACTION_MODES.find((entry) => entry.mode === mode)?.label ?? '行动';
}

function stateLabel(state: Exclude<AdventureSnapshot['state'], null>): string {
  switch (state) {
    case 'PREPARING':
      return '准备中';
    case 'SCENE':
      return '等待行动';
    case 'WAITING_FOR_PLAYER':
      return '生成剧情';
    case 'CHECK_REQUIRED':
      return '需要检定';
    case 'RESOLVING':
      return '结算检定';
    case 'ENDING':
      return '已抵达结局';
  }
}

function AdventureMessage({ title, detail }: { readonly title: string; readonly detail?: string }) {
  return (
    <main className="adventure-page adventure-preparation">
      <p className="eyebrow">{playerText.coreUi.adventureUnavailable}</p>
      <h1>{title}</h1>
      {detail === undefined ? null : <p>{detail}</p>}
      <Link className="text-link" to="/quests">
        返回任务告示
      </Link>
    </main>
  );
}

import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import {
  windowsNpcDialogueService,
  type NpcDialogueSnapshot,
  type WindowsNpcDialogueService,
} from './npc-dialogue-service.js';
import { AIErrorNotice } from './ai-error-notice.js';

type DialogueActions = Pick<WindowsNpcDialogueService, 'load' | 'send'>;

export function NpcDialoguePage({
  service = windowsNpcDialogueService,
}: {
  readonly service?: DialogueActions;
}) {
  const [search] = useSearchParams();
  const campaignId = search.get('campaignId');
  const npcId = search.get('npcId');
  const [snapshot, setSnapshot] = useState<NpcDialogueSnapshot | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [aiError, setAiError] = useState<unknown | null>(null);

  useEffect(() => {
    if (campaignId === null || npcId === null) return;
    let active = true;
    void service
      .load(campaignId, npcId)
      .then((loaded) => {
        if (active) setSnapshot(loaded);
      })
      .catch(() => {
        if (active) setLoadError('无法读取这段对话，本地存档没有发生改变。');
      });
    return () => {
      active = false;
    };
  }, [campaignId, npcId, service]);

  async function send() {
    if (campaignId === null || npcId === null || busy || draft.trim().length === 0) return;
    const message = draft.trim();
    setBusy(true);
    setAiError(null);
    try {
      setSnapshot(await service.send(campaignId, npcId, message));
      setDraft('');
    } catch (error) {
      setAiError(error);
    } finally {
      setBusy(false);
    }
  }

  if (campaignId === null || npcId === null) {
    return <DialogueMessage title="请先从酒馆选择一位 NPC。" />;
  }
  if (snapshot === null) {
    return loadError === null ? (
      <main className="dialogue-room" aria-busy="true">
        <p className="eyebrow">Opening conversation</p>
        <h1>正在回忆先前的谈话…</h1>
      </main>
    ) : (
      <DialogueMessage title={loadError} />
    );
  }

  const relationship = snapshot.relationship;
  return (
    <main className="dialogue-room">
      <header className="dialogue-profile">
        <div className="dialogue-profile__sigil" aria-hidden="true">
          {snapshot.npc.name.slice(0, 1)}
        </div>
        <div>
          <p className="eyebrow">Conversation by the fire</p>
          <h1>{snapshot.npc.name}</h1>
          <p>
            {snapshot.npc.identity} · {snapshot.npc.currentMood}
          </p>
        </div>
        <Link className="text-link" to={`/tavern?campaignId=${encodeURIComponent(campaignId)}`}>
          返回酒馆
        </Link>
      </header>

      <div className="dialogue-layout">
        <section className="dialogue-panel" aria-label="对话历史">
          <div className="dialogue-history" aria-live="polite">
            {snapshot.messages.length === 0 ? (
              <p className="dialogue-empty">炉火正旺。你可以先开口。</p>
            ) : (
              snapshot.messages.map((message) => (
                <article
                  className={`dialogue-bubble dialogue-bubble--${message.role.toLowerCase()}`}
                  key={message.id}
                >
                  <small>{message.role === 'PLAYER' ? '你' : snapshot.npc.name}</small>
                  <p>{message.content}</p>
                </article>
              ))
            )}
          </div>

          {snapshot.suggestedTopics.length === 0 ? null : (
            <div className="dialogue-topics" aria-label="建议话题">
              <span>建议话题</span>
              {snapshot.suggestedTopics.map((topic) => (
                <button type="button" key={topic} onClick={() => setDraft(topic)} disabled={busy}>
                  {topic}
                </button>
              ))}
            </div>
          )}

          <form
            className="dialogue-composer"
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
          >
            <label htmlFor="dialogue-message">你想说什么？</label>
            <textarea
              id="dialogue-message"
              maxLength={4_000}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              disabled={busy}
            />
            <div>
              <span>{draft.length} / 4000</span>
              <button className="primary-action" type="submit" disabled={busy || !draft.trim()}>
                {busy ? '等待回应…' : '发送'}
              </button>
            </div>
          </form>
          {aiError === null ? null : <AIErrorNotice error={aiError} onRetry={() => void send()} />}
        </section>

        <aside className="dialogue-sidebar">
          <section>
            <p className="eyebrow">Relationship</p>
            <h2>关系状态</h2>
            <Relationship label="信任" value={relationship.trust} />
            <Relationship label="亲近" value={relationship.closeness} />
            <Relationship label="敬畏" value={relationship.awe} />
            <Relationship label="人情" value={relationship.obligation} />
          </section>
          <section>
            <p className="eyebrow">First impression</p>
            <h2>眼前的人</h2>
            <p>{snapshot.npc.appearance}</p>
            <p>{snapshot.npc.personality}</p>
          </section>
        </aside>
      </div>
    </main>
  );
}

function Relationship({ label, value }: { readonly label: string; readonly value: number }) {
  return (
    <div className="relationship-row">
      <span>{label}</span>
      <strong>{value > 0 ? `+${value}` : value}</strong>
      <div aria-label={`${label} ${value}`}>
        <span style={{ width: `${((value + 5) / 10) * 100}%` }} />
      </div>
    </div>
  );
}

function DialogueMessage({ title }: { readonly title: string }) {
  return (
    <main className="dialogue-room">
      <p className="eyebrow">Conversation unavailable</p>
      <h1>{title}</h1>
      <Link className="text-link" to="/tavern">
        返回酒馆
      </Link>
    </main>
  );
}

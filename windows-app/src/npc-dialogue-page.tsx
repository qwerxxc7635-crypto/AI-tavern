import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import {
  windowsNpcDialogueService,
  type NpcDialogueSnapshot,
  type WindowsNpcDialogueService,
} from './npc-dialogue-service.js';
import { AIErrorNotice } from './ai-error-notice.js';
import { playerText } from './localization/index.js';
import { APP_PATHS, campaignParentRoute, campaignRoute } from './navigation.js';
import { ActionComposer, DialogueView } from './ui/game-components.js';
import {
  dialogueSuggestionService,
  type DialogueSuggestionSet,
  type WindowsDialogueSuggestionService,
} from './dialogue-suggestion-service.js';

type DialogueActions = Pick<WindowsNpcDialogueService, 'load' | 'send' | 'retry'>;

export function NpcDialoguePage({
  service = windowsNpcDialogueService,
  suggestionService = dialogueSuggestionService,
}: {
  readonly service?: DialogueActions;
  readonly suggestionService?: Pick<WindowsDialogueSuggestionService, 'load'>;
}) {
  const [search] = useSearchParams();
  const campaignId = search.get('campaignId');
  const npcId = search.get('npcId');
  const [snapshot, setSnapshot] = useState<NpcDialogueSnapshot | null>(null);
  const [draft, setDraft] = useState('');
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [streamedText, setStreamedText] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [aiError, setAiError] = useState<unknown | null>(null);
  const [suggestions, setSuggestions] = useState<DialogueSuggestionSet | null>(null);
  const [suggestionError, setSuggestionError] = useState<string | undefined>();
  const [suggestionRevision, setSuggestionRevision] = useState(0);
  const sendInFlight = useRef(false);
  const streamController = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      streamController.current?.abort();
    },
    [],
  );

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

  useEffect(() => {
    if (campaignId === null || npcId === null || snapshot === null) return;
    const controller = new AbortController();
    setSuggestions(null);
    setSuggestionError(undefined);
    void suggestionService
      .load(campaignId, 'NPC_DIALOGUE', npcId, controller.signal)
      .then(setSuggestions)
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setSuggestionError(error instanceof Error ? error.message : '对话建议暂时无法生成。');
        }
      });
    return () => controller.abort();
  }, [campaignId, npcId, snapshot, suggestionRevision, suggestionService]);

  async function send() {
    if (
      campaignId === null ||
      npcId === null ||
      busy ||
      sendInFlight.current ||
      draft.trim().length === 0
    )
      return;
    const message = draft.trim();
    sendInFlight.current = true;
    setBusy(true);
    setStreaming(false);
    setStreamedText('');
    setAiError(null);
    const controller = new AbortController();
    streamController.current = controller;
    try {
      setSnapshot(
        await service.send(campaignId, npcId, message, {
          signal: controller.signal,
          onChunk(content) {
            setStreaming(true);
            setStreamedText((current) => `${current}${content}`);
          },
          onReset() {
            setStreaming(false);
            setStreamedText('');
          },
        }),
      );
      setDraft('');
      setSelectedTopicId(null);
    } catch (error) {
      setAiError(error);
    } finally {
      streamController.current = null;
      sendInFlight.current = false;
      setBusy(false);
      setStreaming(false);
      setStreamedText('');
    }
  }

  async function retry() {
    if (campaignId === null || npcId === null || busy || sendInFlight.current) return;
    sendInFlight.current = true;
    setBusy(true);
    setStreaming(false);
    setStreamedText('');
    setAiError(null);
    const controller = new AbortController();
    streamController.current = controller;
    try {
      setSnapshot(
        await service.retry(campaignId, npcId, {
          signal: controller.signal,
          onChunk(content) {
            setStreaming(true);
            setStreamedText((current) => `${current}${content}`);
          },
          onReset() {
            setStreaming(false);
            setStreamedText('');
          },
        }),
      );
      setDraft('');
      setSelectedTopicId(null);
    } catch (error) {
      setAiError(error);
    } finally {
      streamController.current = null;
      sendInFlight.current = false;
      setBusy(false);
      setStreaming(false);
      setStreamedText('');
    }
  }

  if (campaignId === null || npcId === null) {
    return <DialogueMessage title="请先从酒馆选择一位 NPC。" />;
  }
  if (snapshot === null) {
    return loadError === null ? (
      <main className="dialogue-room" aria-busy="true">
        <p className="eyebrow">{playerText.coreUi.openingConversation}</p>
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
          <p className="eyebrow">{playerText.coreUi.conversationByFire}</p>
          <h1>{snapshot.npc.name}</h1>
          <p>
            {snapshot.npc.identity} · {snapshot.npc.currentMood}
          </p>
        </div>
        <Link className="text-link" to={campaignRoute(APP_PATHS.tavern, campaignId)}>
          返回酒馆
        </Link>
      </header>

      <div className="dialogue-layout">
        <section className="dialogue-panel" aria-label="对话历史">
          <DialogueView
            className="dialogue-history"
            label="对话历史"
            emptyText="炉火正旺。你可以先开口。"
            messages={snapshot.messages.map((message) => ({
              id: message.id,
              content: message.content,
              side: message.role,
              speaker: message.role === 'PLAYER' ? '你' : snapshot.npc.name,
            }))}
          />

          <ActionComposer
            className="dialogue-composer"
            fieldId="npc-dialogue-free-input"
            label="你想说什么？"
            description="可以选择建议话题，也可以永久使用自由输入。按住控制键或命令键，再按回车发送。"
            value={draft}
            suggestions={(suggestions?.suggestions ?? []).map((suggestion) => ({
              id: suggestion.id,
              label: suggestion.text,
            }))}
            selectedSuggestionId={selectedTopicId}
            disabled={busy}
            submitting={busy && !streaming}
            streaming={streaming}
            streamedText={streamedText}
            {...(suggestions === null && suggestionError === undefined
              ? { status: '正在整理对话建议…' }
              : {})}
            {...(suggestionError === undefined ? {} : { error: suggestionError })}
            submitLabel="发送"
            onChange={(value) => {
              setDraft(value);
              setSelectedTopicId(null);
            }}
            onSuggestion={(suggestion) => {
              setDraft(suggestion.label);
              setSelectedTopicId(suggestion.id);
            }}
            onRetry={() => setSuggestionRevision((current) => current + 1)}
            onCancel={() => streamController.current?.abort()}
            onSubmit={() => void send()}
          />
          {snapshot.timeline === null && aiError === null ? null : (
            <AIErrorNotice
              error={aiError ?? restoredTimelineError(snapshot)}
              onRetry={() => void retry()}
            />
          )}
        </section>

        <aside className="dialogue-sidebar">
          <section>
            <p className="eyebrow">{playerText.coreUi.relationship}</p>
            <h2>关系状态</h2>
            <Relationship label="信任" value={relationship.trust} />
            <Relationship label="亲近" value={relationship.closeness} />
            <Relationship label="敬畏" value={relationship.awe} />
            <Relationship label="人情" value={relationship.obligation} />
          </section>
          <section>
            <p className="eyebrow">{playerText.coreUi.firstImpression}</p>
            <h2>眼前的人</h2>
            <p>{snapshot.npc.appearance}</p>
            <p>{snapshot.npc.personality}</p>
          </section>
        </aside>
      </div>
    </main>
  );
}

function restoredTimelineError(snapshot: NpcDialogueSnapshot): { readonly code: string } {
  const timeline = snapshot.timeline;
  if (timeline === null || timeline.status === 'PENDING') return { code: 'APP_INTERRUPTED' };
  const latest = timeline.attempts.at(-1);
  return { code: latest?.errorCode ?? 'APP_INTERRUPTED' };
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
  const [search] = useSearchParams();
  return (
    <main className="dialogue-room">
      <p className="eyebrow">{playerText.coreUi.conversationUnavailable}</p>
      <h1>{title}</h1>
      <Link className="text-link" to={campaignParentRoute(search, APP_PATHS.tavern)}>
        {search.has('campaignId') ? '返回酒馆' : '返回存档首页'}
      </Link>
    </main>
  );
}

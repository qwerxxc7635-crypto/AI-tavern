import { useId, type FormEvent, type ReactNode } from 'react';

import { Button, EmptyState, ErrorState, Progress, Skeleton, Textarea } from './primitives.js';

interface SelectableCardProps {
  readonly selected?: boolean;
  readonly disabled?: boolean;
  readonly onSelect?: () => void;
  readonly className?: string;
}

export interface CharacterCardView {
  readonly id: string;
  readonly name: string;
  readonly className: string;
  readonly summary: string;
  readonly level?: number;
  readonly status?: string;
}

export function CharacterCard({
  character,
  action,
}: {
  readonly character: CharacterCardView;
  readonly action?: ReactNode;
}) {
  const titleId = useId();
  return (
    <article className="game-card game-character-card" aria-labelledby={titleId}>
      <span className="game-card__sigil" aria-hidden="true">
        {character.name.slice(0, 1)}
      </span>
      <div>
        <p className="game-card__meta">
          {character.className}
          {character.level === undefined ? '' : ` · ${character.level}级`}
        </p>
        <h3 id={titleId}>{character.name}</h3>
        <p>{character.summary}</p>
        {character.status === undefined ? null : <small>{character.status}</small>}
      </div>
      {action}
    </article>
  );
}

export interface NpcCardView {
  readonly id: string;
  readonly name: string;
  readonly identity: string;
  readonly mood: string;
  readonly residency?: string;
}

export function NpcCard({
  npc,
  selected,
  disabled,
  onSelect,
  className,
}: SelectableCardProps & {
  readonly npc: NpcCardView;
}) {
  return (
    <button
      type="button"
      className={classes(
        'game-card',
        'game-npc-card',
        className,
        selected ? 'is-selected' : undefined,
      )}
      aria-pressed={selected}
      disabled={disabled}
      onClick={onSelect}
    >
      <span className="game-card__sigil" aria-hidden="true">
        {npc.name.slice(0, 1)}
      </span>
      <span className="game-card__copy">
        <small>{[npc.residency, npc.mood].filter(Boolean).join(' · ')}</small>
        <strong>{npc.name}</strong>
        <span>{npc.identity}</span>
      </span>
    </button>
  );
}

export interface TraitCardView {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly category?: string;
}

export function TraitCard({
  trait,
  selected = false,
  disabled = false,
  onSelect,
  className,
}: Omit<SelectableCardProps, 'onSelect'> & {
  readonly trait: TraitCardView;
  readonly onSelect?: (selected: boolean) => void;
}) {
  return (
    <label
      className={classes(
        'game-card',
        'game-trait-card',
        className,
        selected ? 'is-selected' : undefined,
      )}
    >
      <input
        type="checkbox"
        checked={selected}
        disabled={disabled}
        onChange={(event) => onSelect?.(event.target.checked)}
      />
      {trait.category === undefined ? null : <small>{trait.category}</small>}
      <strong>{trait.name}</strong>
      <span>{trait.description}</span>
    </label>
  );
}

export interface QuestCardView {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly risk: string;
  readonly publisher: string;
  readonly status: string;
}

export function QuestCard({
  quest,
  selected,
  disabled,
  onSelect,
  className,
}: SelectableCardProps & {
  readonly quest: QuestCardView;
}) {
  return (
    <button
      type="button"
      className={classes(
        'game-card',
        'game-quest-card',
        className,
        selected ? 'is-selected' : undefined,
      )}
      aria-pressed={selected}
      disabled={disabled}
      onClick={onSelect}
    >
      <small>
        风险 {quest.risk} · {quest.publisher}
      </small>
      <strong>{quest.title}</strong>
      <span>{quest.summary}</span>
      <em>{quest.status}</em>
    </button>
  );
}

export interface ItemCardView {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly category: string;
  readonly quantity?: number;
  readonly effect?: string;
}

export function ItemCard({
  item,
  action,
}: {
  readonly item: ItemCardView;
  readonly action?: ReactNode;
}) {
  const titleId = useId();
  return (
    <article className="game-card game-item-card" aria-labelledby={titleId}>
      <div>
        <small>{item.category}</small>
        <h3 id={titleId}>{item.name}</h3>
        <p>{item.description}</p>
        {item.effect === undefined ? null : <span>{item.effect}</span>}
      </div>
      {item.quantity === undefined ? null : (
        <strong aria-label={`数量 ${item.quantity}`}>×{item.quantity}</strong>
      )}
      {action}
    </article>
  );
}

export interface DialogueMessageView {
  readonly id: string;
  readonly speaker: string;
  readonly content: string;
  readonly side: 'PLAYER' | 'NPC' | 'SYSTEM';
}

export function DialogueView({
  label,
  messages,
  loading = false,
  error,
  emptyText,
  className,
}: {
  readonly label: string;
  readonly messages: readonly DialogueMessageView[];
  readonly loading?: boolean;
  readonly error?: string;
  readonly emptyText: string;
  readonly className?: string;
}) {
  return (
    <div className={classes('game-dialogue', className)} aria-label={label} aria-live="polite">
      {loading ? (
        <Skeleton label="正在整理对话" lines={3} />
      ) : error !== undefined ? (
        <ErrorState title="对话暂时不可用" description={error} />
      ) : messages.length === 0 ? (
        <EmptyState title="还没有对话" description={emptyText} />
      ) : (
        messages.map((message) => (
          <article
            className={classes(
              'game-dialogue__message',
              `game-dialogue__message--${message.side.toLowerCase()}`,
            )}
            key={message.id}
          >
            <small>{message.speaker}</small>
            <p>{message.content}</p>
          </article>
        ))
      )}
    </div>
  );
}

export interface ActionSuggestion {
  readonly id: string;
  readonly label: string;
}

export function ActionComposer({
  label,
  description,
  value,
  suggestions,
  disabled = false,
  submitting = false,
  submitLabel,
  onChange,
  onSuggestion,
  onSubmit,
}: {
  readonly label: string;
  readonly description: string;
  readonly value: string;
  readonly suggestions: readonly ActionSuggestion[];
  readonly disabled?: boolean;
  readonly submitting?: boolean;
  readonly submitLabel: string;
  readonly onChange: (value: string) => void;
  readonly onSuggestion: (suggestion: ActionSuggestion) => void;
  readonly onSubmit: () => void;
}) {
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!disabled && !submitting && value.trim().length > 0) onSubmit();
  };
  return (
    <form className="game-action-composer" onSubmit={submit}>
      <div className="game-action-composer__suggestions" aria-label="行动建议">
        {suggestions.map((suggestion) => (
          <Button
            key={suggestion.id}
            variant="quiet"
            disabled={disabled || submitting}
            onClick={() => onSuggestion(suggestion)}
          >
            {suggestion.label}
          </Button>
        ))}
      </div>
      <Textarea
        label={label}
        description={description}
        value={value}
        disabled={disabled || submitting}
        maxLength={4_000}
        onChange={(event) => onChange(event.target.value)}
      />
      <Button
        type="submit"
        loading={submitting}
        loadingLabel="正在提交"
        disabled={disabled || value.trim().length === 0}
      >
        {submitLabel}
      </Button>
    </form>
  );
}

export type FieldAssistState = 'IDLE' | 'LOADING' | 'CANDIDATE' | 'ERROR' | 'LOCKED';

export function AIFieldAssist({
  state,
  candidate,
  error,
  onGenerate,
  onApply,
  onCancel,
}: {
  readonly state: FieldAssistState;
  readonly candidate?: string;
  readonly error?: string;
  readonly onGenerate?: () => void;
  readonly onApply?: () => void;
  readonly onCancel?: () => void;
}) {
  return (
    <section className="game-ai-assist" aria-busy={state === 'LOADING'}>
      {state === 'ERROR' ? (
        <ErrorState title="辅助未完成" description={error ?? '请稍后重试。'} />
      ) : null}
      {state === 'CANDIDATE' && candidate !== undefined ? <p>{candidate}</p> : null}
      <div>
        {state === 'IDLE' || state === 'ERROR' ? (
          <Button onClick={onGenerate}>AI 辅助</Button>
        ) : null}
        {state === 'LOADING' ? (
          <Button variant="quiet" onClick={onCancel}>
            取消
          </Button>
        ) : null}
        {state === 'CANDIDATE' ? <Button onClick={onApply}>采用候选</Button> : null}
        {state === 'LOCKED' ? <span>字段已锁定</span> : null}
      </div>
    </section>
  );
}

export type GenerationStageState = 'PENDING' | 'ACTIVE' | 'COMPLETE' | 'ERROR';

export interface GenerationStage {
  readonly id: string;
  readonly label: string;
  readonly state: GenerationStageState;
}

export function GenerationPanel({
  title,
  stages,
  onCancel,
  onRetry,
}: {
  readonly title: string;
  readonly stages: readonly GenerationStage[];
  readonly onCancel?: () => void;
  readonly onRetry?: () => void;
}) {
  if (stages.length === 0) throw new TypeError('Generation panel requires stages');
  const completed = stages.filter(({ state }) => state === 'COMPLETE').length;
  const failed = stages.some(({ state }) => state === 'ERROR');
  return (
    <section className="game-generation-panel" aria-busy={!failed && completed < stages.length}>
      <h2>{title}</h2>
      <Progress label="生成进度" value={completed} max={stages.length} />
      <ol>
        {stages.map((stage) => (
          <li key={stage.id} data-state={stage.state}>
            {stage.label}
          </li>
        ))}
      </ol>
      <div>
        {failed ? (
          <Button variant="secondary" onClick={onRetry}>
            重试
          </Button>
        ) : null}
        {completed < stages.length ? (
          <Button variant="quiet" onClick={onCancel}>
            取消
          </Button>
        ) : null}
      </div>
    </section>
  );
}

export interface StatusItem {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly tone?: 'neutral' | 'positive' | 'warning' | 'danger';
}

export function StatusPanel({
  title,
  items,
}: {
  readonly title: string;
  readonly items: readonly StatusItem[];
}) {
  const titleId = useId();
  return (
    <section className="game-status-panel" aria-labelledby={titleId}>
      <h2 id={titleId}>{title}</h2>
      {items.length === 0 ? (
        <EmptyState title="暂无状态" description="当前没有需要显示的状态。" />
      ) : (
        <dl>
          {items.map((item) => (
            <div key={item.id} data-tone={item.tone ?? 'neutral'}>
              <dt>{item.label}</dt>
              <dd>{item.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

function classes(...values: readonly (string | undefined)[]) {
  return values.filter(Boolean).join(' ');
}

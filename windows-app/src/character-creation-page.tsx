import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

import type { ClassArchetype, PlayerAttributesInput } from '@ember-tavern/contracts';

import {
  windowsCharacterCreationService,
  type CharacterCreationSnapshot,
  type CharacterDraft,
  type WindowsCharacterCreationService,
} from './character-creation-service.js';
import { AIErrorNotice } from './ai-error-notice.js';
import {
  INITIAL_CHARACTER_AI_STATE,
  reduceCharacterAIState,
  type CharacterAIEvent,
  type CharacterAIPhase,
} from './character-ai-state-machine.js';
import { playerText } from './localization/index.js';

type CharacterCreationActions = Pick<
  WindowsCharacterCreationService,
  'load' | 'generateTraits' | 'complete' | 'confirm'
>;

interface CharacterCreationPageProps {
  readonly service?: CharacterCreationActions;
}

const CLASS_NAMES: Readonly<Record<ClassArchetype, string>> = {
  WARRIOR: '盾卫',
  ROGUE: '寻路者',
  SCHOLAR: '秘闻学者',
  DIPLOMAT: '誓约使',
};

const ATTRIBUTE_LABELS = {
  physique: '体魄',
  agility: '敏捷',
  knowledge: '学识',
  charisma: '魅力',
} as const;

const DEFAULT_ATTRIBUTES: PlayerAttributesInput = {
  physique: 3,
  agility: 3,
  knowledge: 2,
  charisma: 2,
};

export function CharacterCreationPage({
  service = windowsCharacterCreationService,
}: CharacterCreationPageProps) {
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const campaignId = search.get('campaignId');
  const [snapshot, setSnapshot] = useState<CharacterCreationSnapshot | null>(null);
  const [draft, setDraft] = useState<CharacterDraft | null>(null);
  const [selectedTraitIds, setSelectedTraitIds] = useState<readonly string[]>([]);
  const [aiState, setAIState] = useState(INITIAL_CHARACTER_AI_STATE);
  const aiStateRef = useRef(INITIAL_CHARACTER_AI_STATE);
  const operationSequence = useRef(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [aiError, setAiError] = useState<unknown | null>(null);
  const [retryAction, setRetryAction] = useState<(() => Promise<void>) | null>(null);

  useEffect(() => {
    if (campaignId === null) return;
    let active = true;
    void service
      .load(campaignId)
      .then((loaded) => {
        if (!active) return;
        setSnapshot(loaded);
        setDraft(loaded.draft ?? newDraft(campaignId));
        if (loaded.character !== null) {
          setSelectedTraitIds(loaded.character.traits.map(({ id }) => id));
        }
        transition({
          type: 'RESTORED',
          phase:
            loaded.character !== null
              ? 'committed'
              : loaded.candidate !== null
                ? 'preview'
                : 'idle',
        });
      })
      .catch(() => {
        if (active) setLoadError('无法读取这个存档的车卡进度。');
      });
    return () => {
      active = false;
    };
  }, [campaignId, service]);

  const attributeTotal = useMemo(
    () =>
      draft === null
        ? 0
        : Object.values(draft.attributes).reduce((total, value) => total + value, 0),
    [draft],
  );

  const busy = ['generating', 'validating', 'confirming'].includes(aiState.phase);

  function transition(event: CharacterAIEvent): boolean {
    const previous = aiStateRef.current;
    const next = reduceCharacterAIState(previous, event);
    aiStateRef.current = next;
    setAIState(next);
    return next !== previous;
  }

  function updateDraft(next: CharacterDraft) {
    transition({ type: 'DRAFT_CHANGED' });
    setDraft(next);
  }

  async function generateTraits() {
    if (draft === null) return;
    const operationId = ++operationSequence.current;
    const revision = aiStateRef.current.revision;
    if (!transition({ type: 'GENERATION_STARTED', operationId })) return;
    setAiError(null);
    setRetryAction(null);
    try {
      const generated = await service.generateTraits(draft, {
        onValidationStarted: () => {
          transition({ type: 'VALIDATION_STARTED', operationId, revision });
        },
      });
      if (!transition({ type: 'PREVIEW_READY', operationId, revision })) return;
      setSnapshot(generated);
      setDraft(generated.draft ?? draft);
      setSelectedTraitIds([]);
    } catch (error) {
      transition({
        type: 'GENERATION_FAILED',
        operationId,
        revision,
        failure:
          aiStateRef.current.phase === 'validating' ? 'validation_failed' : 'generation_failed',
      });
      setAiError(error);
      setRetryAction(() => generateTraits);
    }
  }

  async function completeCharacter() {
    if (
      draft === null ||
      snapshot?.traitGenerationRecordId === null ||
      snapshot?.traitGenerationRecordId === undefined
    ) {
      return;
    }
    const selected = snapshot.traitCandidates.filter(({ id }) => selectedTraitIds.includes(id));
    const operationId = ++operationSequence.current;
    const revision = aiStateRef.current.revision;
    if (!transition({ type: 'GENERATION_STARTED', operationId })) return;
    setAiError(null);
    setRetryAction(null);
    try {
      const completed = await service.complete(draft, snapshot.traitGenerationRecordId, selected, {
        onValidationStarted: () => {
          transition({ type: 'VALIDATION_STARTED', operationId, revision });
        },
      });
      if (!transition({ type: 'PREVIEW_READY', operationId, revision })) return;
      setSnapshot(completed);
    } catch (error) {
      transition({
        type: 'GENERATION_FAILED',
        operationId,
        revision,
        failure:
          aiStateRef.current.phase === 'validating' ? 'validation_failed' : 'generation_failed',
      });
      setAiError(error);
      setRetryAction(() => completeCharacter);
    }
  }

  async function confirmCharacter() {
    if (campaignId === null || snapshot?.candidate?.kind !== 'COMPLETE_CHARACTER') return;
    const operationId = ++operationSequence.current;
    const revision = aiStateRef.current.revision;
    if (!transition({ type: 'CONFIRM_STARTED', operationId })) return;
    setAiError(null);
    setRetryAction(null);
    try {
      const committed = await service.confirm(campaignId, snapshot.candidate.id);
      if (!transition({ type: 'CONFIRM_SUCCEEDED', operationId, revision })) return;
      setSnapshot(committed);
    } catch (error) {
      transition({ type: 'CONFIRM_FAILED', operationId, revision });
      setAiError(error);
      setRetryAction(() => confirmCharacter);
    }
  }

  if (campaignId === null) {
    return <CharacterMessage title="先选择一个存档。" />;
  }
  if (snapshot === null || draft === null) {
    return loadError === null ? (
      <main className="character-studio character-studio--message" aria-busy="true">
        <span className="loading-glyph" aria-hidden="true" />
        <p className="eyebrow">{playerText.coreUi.readingCharacterSheet}</p>
        <h1>正在铺开车卡…</h1>
      </main>
    ) : (
      <CharacterMessage title={loadError} />
    );
  }
  if (snapshot.character !== null) {
    const character = snapshot.character;
    return (
      <main className="character-studio">
        <CharacterTopline step="03 · 背景与装备" />
        <CharacterAIStatus phase={aiState.phase} />
        <div className="character-review character-sheet" aria-label="完整角色卡">
          <section className="character-sheet__summary" data-character-section="summary">
            <p className="eyebrow">{playerText.coreUi.characterReady}</p>
            <h1>{character.name}</h1>
            <p>
              {character.classDisplayName} · {character.concept}
            </p>
          </section>
          <section data-character-section="basics">
            <p className="eyebrow">基础</p>
            <h2>基础信息</h2>
            <Description label="姓名" value={character.name} />
            <Description label="性别" value={character.gender ?? '未填写'} />
            <Description
              label="年龄"
              value={character.age === null ? '未填写' : String(character.age)}
            />
            <Description label="职业" value={character.classDisplayName} />
            <Description label="角色概念" value={character.concept} />
          </section>
          <section data-character-section="attributes">
            <p className="eyebrow">能力</p>
            <h2>属性</h2>
            <dl className="character-sheet__attributes">
              {Object.entries(ATTRIBUTE_LABELS).map(([attribute, label]) => (
                <div key={attribute}>
                  <dt>{label}</dt>
                  <dd>{character.attributes[attribute as keyof PlayerAttributesInput]}</dd>
                </div>
              ))}
            </dl>
          </section>
          <section data-character-section="background">
            <p className="eyebrow">{playerText.coreUi.background}</p>
            <h2>背景</h2>
            <Description label="出生地" value={character.background.birthplace} />
            <Description label="成长经历" value={character.background.formativeExperience} />
            <Description label="冒险动机" value={character.background.adventureMotivation} />
            <Description label="秘密" value={character.background.secret} />
            <Description label="重要人物" value={character.background.importantPerson} />
            <Description label="来到酒馆" value={character.background.tavernArrivalReason} />
          </section>
          <section data-character-section="personality">
            <p className="eyebrow">选择与边界</p>
            <h2>个性与偏好</h2>
            <Description label="个人目标" value={character.personalGoal} />
            <Description
              label="故事偏好"
              value={
                character.storyPreferences.length === 0
                  ? '未填写'
                  : character.storyPreferences.join('、')
              }
            />
            <Description
              label="内容边界"
              value={contentBoundaryLabel(character.contentBoundaries)}
            />
          </section>
          <section data-character-section="traits">
            <p className="eyebrow">特征</p>
            <h2>特质</h2>
            <ul className="character-sheet__traits">
              {character.traits.map((trait) => (
                <li key={trait.id}>
                  <strong>{trait.name}</strong>
                  <p>{trait.description}</p>
                </li>
              ))}
            </ul>
          </section>
          <section data-character-section="equipment">
            <p className="eyebrow">{playerText.coreUi.startingKit}</p>
            <h2>装备</h2>
            <ul className="equipment-list">
              {character.initialEquipment.map((item) => (
                <li key={item.id}>
                  <strong>{item.name}</strong>
                  <p>{item.description}</p>
                  <span>{effectLabel(item.effect)}</span>
                </li>
              ))}
            </ul>
          </section>
          <section className="character-sheet__ai-controls" data-character-section="ai-controls">
            <div>
              <p className="eyebrow">本地确认边界</p>
              <h2>AI 控制</h2>
              <p>角色已经确认并写入本地存档；AI 不会自动覆盖已提交的角色事实。</p>
            </div>
            <button
              className="primary-action character-next"
              type="button"
              onClick={() => navigate(`/tavern?campaignId=${encodeURIComponent(campaignId)}`)}
            >
              进入酒馆生成流程
            </button>
          </section>
        </div>
      </main>
    );
  }
  if (snapshot.campaignState !== 'CREATING_CHARACTER') {
    return <CharacterMessage title="这个存档不在创建角色阶段。" />;
  }
  if (snapshot.candidate?.kind === 'COMPLETE_CHARACTER') {
    const candidate = snapshot.candidate;
    const background = candidate.background;
    if (background === null) return <CharacterMessage title="角色候选数据不完整。" />;
    return (
      <main className="character-studio">
        <CharacterTopline step="03 · 确认完整角色" />
        <CharacterAIStatus phase={aiState.phase} />
        <section className="character-intro">
          <p className="eyebrow">结构化角色候选</p>
          <h1>{candidate.draft.name} 已准备好供你确认。</h1>
          <p>以下内容只是本地候选预览；确认前不会写入角色、装备或推进存档阶段。</p>
        </section>
        {aiError === null ? null : (
          <AIErrorNotice
            error={aiError}
            onRetry={retryAction === null ? undefined : () => void retryAction()}
          />
        )}
        <div className="character-review character-sheet" aria-label="未确认角色候选">
          <section className="character-sheet__summary" data-character-section="summary">
            <p className="eyebrow">未确认候选</p>
            <h2>{candidate.draft.name}</h2>
            <p>
              {candidate.draft.classDisplayName} · {candidate.draft.concept}
            </p>
          </section>
          <section data-character-section="background">
            <h2>背景</h2>
            <Description label="出生地" value={background.birthplace} />
            <Description label="成长经历" value={background.formativeExperience} />
            <Description label="冒险动机" value={background.adventureMotivation} />
            <Description label="秘密" value={background.secret} />
            <Description label="重要人物" value={background.importantPerson} />
            <Description label="来到酒馆" value={background.tavernArrivalReason} />
          </section>
          <section data-character-section="traits">
            <h2>已选特质</h2>
            <ul className="character-sheet__traits">
              {candidate.selectedTraits.map((trait) => (
                <li key={trait.id}>
                  <strong>{trait.name}</strong>
                  <p>{trait.description}</p>
                </li>
              ))}
            </ul>
          </section>
          <section data-character-section="equipment">
            <h2>初始装备</h2>
            <ul className="equipment-list">
              {candidate.initialEquipment.map((item) => (
                <li key={item.id}>
                  <strong>{item.name}</strong>
                  <p>{item.description}</p>
                  <span>{effectLabel(item.effect)}</span>
                </li>
              ))}
            </ul>
          </section>
          <section className="character-sheet__ai-controls" data-character-section="ai-controls">
            <div>
              <p className="eyebrow">原子确认边界</p>
              <h2>写入本地存档</h2>
              <p>确认会在一个事务中写入角色、装备和生成审计；失败不会留下半成品。</p>
            </div>
            <button
              className="primary-action character-next"
              type="button"
              disabled={busy}
              onClick={() => void confirmCharacter()}
            >
              {aiState.phase === 'confirming' ? '正在原子确认…' : '确认角色并写入存档'}
            </button>
          </section>
        </div>
      </main>
    );
  }
  if (snapshot.traitCandidates.length > 0) {
    return (
      <main className="character-studio">
        <CharacterTopline step="02 · 选择特质" />
        <CharacterAIStatus phase={aiState.phase} />
        <section className="character-intro">
          <p className="eyebrow">{playerText.coreUi.chooseTwoTraits}</p>
          <h1>决定角色如何面对世界。</h1>
          <p>从经过验证的六个候选特质中选择两个。重新打开应用后，本地进度仍会保留。</p>
        </section>
        {aiError === null ? null : (
          <AIErrorNotice
            error={aiError}
            onRetry={retryAction === null ? undefined : () => void retryAction()}
          />
        )}
        <section className="trait-grid" aria-label="候选特质">
          {snapshot.traitCandidates.map((trait) => {
            const selected = selectedTraitIds.includes(trait.id);
            return (
              <label
                className={selected ? 'trait-card trait-card--selected' : 'trait-card'}
                key={trait.id}
              >
                <input
                  type="checkbox"
                  checked={selected}
                  disabled={!selected && selectedTraitIds.length === 2}
                  onChange={(event) => {
                    transition({ type: 'PREVIEW_EDITED' });
                    setSelectedTraitIds(
                      event.target.checked
                        ? [...selectedTraitIds, trait.id]
                        : selectedTraitIds.filter((id) => id !== trait.id),
                    );
                  }}
                />
                <span>{trait.name}</span>
                <p>{trait.description}</p>
              </label>
            );
          })}
        </section>
        <button
          className="primary-action character-next"
          type="button"
          disabled={busy || selectedTraitIds.length !== 2}
          onClick={() => void completeCharacter()}
        >
          {['generating', 'validating'].includes(aiState.phase)
            ? '正在生成完整候选…'
            : '确认特质并生成背景候选'}
        </button>
      </main>
    );
  }

  return (
    <main className="character-studio">
      <CharacterTopline step="01 · 基础车卡" />
      <CharacterAIStatus phase={aiState.phase} />
      <section className="character-intro">
        <p className="eyebrow">{playerText.coreUi.buildTraveler}</p>
        <h1>谁会推开酒馆的门？</h1>
        <p>基础事实由你决定；Fake Provider 只负责生成候选特质与背景文本。</p>
      </section>
      {aiError === null ? null : (
        <AIErrorNotice
          error={aiError}
          onRetry={retryAction === null ? undefined : () => void retryAction()}
        />
      )}
      <form
        className="character-form"
        onSubmit={(event) => {
          event.preventDefault();
          void generateTraits();
        }}
      >
        <section className="character-form__identity">
          <h2>人物轮廓</h2>
          <label>
            <span>姓名</span>
            <input
              required
              value={draft.name}
              onChange={(event) => updateDraft({ ...draft, name: event.target.value })}
            />
          </label>
          <label>
            <span>性别（可选）</span>
            <input
              value={draft.gender ?? ''}
              onChange={(event) =>
                updateDraft({ ...draft, gender: emptyToNull(event.target.value) })
              }
            />
          </label>
          <label>
            <span>年龄（可选）</span>
            <input
              min="0"
              type="number"
              value={draft.age ?? ''}
              onChange={(event) =>
                updateDraft({
                  ...draft,
                  age: event.target.value === '' ? null : Number(event.target.value),
                })
              }
            />
          </label>
          <label className="character-form__wide">
            <span>角色概念</span>
            <textarea
              required
              rows={3}
              value={draft.concept}
              onChange={(event) => updateDraft({ ...draft, concept: event.target.value })}
            />
          </label>
          <label>
            <span>职业原型</span>
            <select
              value={draft.classArchetype}
              onChange={(event) => {
                const classArchetype = event.target.value as ClassArchetype;
                updateDraft({
                  ...draft,
                  classArchetype,
                  classDisplayName: CLASS_NAMES[classArchetype],
                });
              }}
            >
              {Object.entries(CLASS_NAMES).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>职业显示名</span>
            <input
              required
              value={draft.classDisplayName}
              onChange={(event) => updateDraft({ ...draft, classDisplayName: event.target.value })}
            />
          </label>
          <label className="character-form__wide">
            <span>个人目标</span>
            <textarea
              required
              rows={2}
              value={draft.personalGoal}
              onChange={(event) => updateDraft({ ...draft, personalGoal: event.target.value })}
            />
          </label>
          <label className="character-form__wide">
            <span>故事偏好（每行一项）</span>
            <textarea
              rows={2}
              value={draft.storyPreferences.join('\n')}
              onChange={(event) =>
                updateDraft({ ...draft, storyPreferences: lines(event.target.value) })
              }
            />
          </label>
        </section>

        <section className="attribute-panel">
          <div>
            <h2>属性分配</h2>
            <p className={attributeTotal === 10 ? 'allocation allocation--valid' : 'allocation'}>
              已分配 {attributeTotal} / 10 点
            </p>
          </div>
          <div className="attribute-grid">
            {Object.entries(ATTRIBUTE_LABELS).map(([attribute, label]) => {
              const name = attribute as keyof PlayerAttributesInput;
              return (
                <label key={name}>
                  <span>{label}</span>
                  <input
                    aria-label={label}
                    min="1"
                    max="5"
                    required
                    type="number"
                    value={draft.attributes[name]}
                    onChange={(event) =>
                      updateDraft({
                        ...draft,
                        attributes: { ...draft.attributes, [name]: Number(event.target.value) },
                      })
                    }
                  />
                </label>
              );
            })}
          </div>
        </section>

        <fieldset className="character-boundaries">
          <legend>内容边界</legend>
          <Boundary
            label="允许恐怖元素"
            checked={draft.contentBoundaries.allowHorror}
            onChange={(allowHorror) =>
              updateDraft({
                ...draft,
                contentBoundaries: { ...draft.contentBoundaries, allowHorror },
              })
            }
          />
          <Boundary
            label="允许永久死亡"
            checked={draft.contentBoundaries.allowPermanentDeath}
            onChange={(allowPermanentDeath) =>
              updateDraft({
                ...draft,
                contentBoundaries: { ...draft.contentBoundaries, allowPermanentDeath },
              })
            }
          />
          <Boundary
            label="允许恋爱剧情"
            checked={draft.contentBoundaries.allowRomance}
            onChange={(allowRomance) =>
              updateDraft({
                ...draft,
                contentBoundaries: { ...draft.contentBoundaries, allowRomance },
              })
            }
          />
          <Boundary
            label="允许背叛剧情"
            checked={draft.contentBoundaries.allowBetrayal}
            onChange={(allowBetrayal) =>
              updateDraft({
                ...draft,
                contentBoundaries: { ...draft.contentBoundaries, allowBetrayal },
              })
            }
          />
          <label className="character-boundaries__wide">
            <span>排除内容（每行一项）</span>
            <textarea
              rows={2}
              value={draft.contentBoundaries.excludedContent.join('\n')}
              onChange={(event) =>
                updateDraft({
                  ...draft,
                  contentBoundaries: {
                    ...draft.contentBoundaries,
                    excludedContent: lines(event.target.value),
                  },
                })
              }
            />
          </label>
        </fieldset>

        <button
          className="primary-action character-next"
          type="submit"
          disabled={busy || attributeTotal !== 10}
        >
          {aiState.phase === 'validating'
            ? '正在验证特质…'
            : aiState.phase === 'generating'
              ? '正在生成特质…'
              : '生成六个候选特质'}
        </button>
      </form>
    </main>
  );
}

function CharacterTopline({ step }: { readonly step: string }) {
  return (
    <header className="character-studio__topline">
      <Link to="/saves">← 存档首页</Link>
      <p>{step} · 本地离线</p>
    </header>
  );
}

function CharacterAIStatus({ phase }: { readonly phase: CharacterAIPhase }) {
  return (
    <p className="character-ai-status" data-testid="character-ai-phase" aria-live="polite">
      AI 状态：{characterAIPhaseLabel(phase)}
    </p>
  );
}

function characterAIPhaseLabel(phase: CharacterAIPhase): string {
  switch (phase) {
    case 'idle':
      return '待命';
    case 'generating':
      return '生成中';
    case 'validating':
      return '验证中';
    case 'preview':
      return '预览';
    case 'editing':
      return '编辑中';
    case 'confirming':
      return '确认中';
    case 'committed':
      return '已提交';
  }
}

function CharacterMessage({ title }: { readonly title: string }) {
  return (
    <main className="character-studio character-studio--message" role="alert">
      <p className="eyebrow">{playerText.coreUi.characterStageUnavailable}</p>
      <h1>{title}</h1>
      <Link className="text-link" to="/saves">
        返回存档首页
      </Link>
    </main>
  );
}

function Boundary({
  label,
  checked,
  onChange,
}: {
  readonly label: string;
  readonly checked: boolean;
  readonly onChange: (value: boolean) => void;
}) {
  return (
    <label>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}

function Description({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="background-entry">
      <span>{label}</span>
      <p>{value}</p>
    </div>
  );
}

function effectLabel(
  effect:
    | { readonly kind: 'NONE' }
    | {
        readonly kind: 'CHECK_MODIFIER';
        readonly attribute: keyof PlayerAttributesInput;
        readonly modifier: number;
      },
): string {
  return effect.kind === 'NONE'
    ? '叙事装备'
    : `${ATTRIBUTE_LABELS[effect.attribute]}检定 ${effect.modifier > 0 ? '+' : ''}${effect.modifier}`;
}

function contentBoundaryLabel(boundaries: CharacterDraft['contentBoundaries']): string {
  const allowed = [
    boundaries.allowHorror ? '恐怖元素' : null,
    boundaries.allowPermanentDeath ? '永久死亡' : null,
    boundaries.allowRomance ? '恋爱剧情' : null,
    boundaries.allowBetrayal ? '背叛剧情' : null,
  ].filter((value): value is string => value !== null);
  const exclusions =
    boundaries.excludedContent.length === 0
      ? '无额外排除内容'
      : `排除：${boundaries.excludedContent.join('、')}`;
  return `${allowed.length === 0 ? '未允许特殊内容' : `允许：${allowed.join('、')}`}；${exclusions}`;
}

function newDraft(campaignId: string): CharacterDraft {
  return {
    id: `character-${crypto.randomUUID()}`,
    campaignId,
    name: '',
    gender: null,
    age: null,
    concept: '',
    storyPreferences: [],
    contentBoundaries: {
      allowHorror: false,
      allowPermanentDeath: false,
      allowRomance: true,
      allowBetrayal: true,
      excludedContent: [],
    },
    classArchetype: 'WARRIOR',
    classDisplayName: CLASS_NAMES.WARRIOR,
    attributes: DEFAULT_ATTRIBUTES,
    personalGoal: '',
  };
}

function emptyToNull(value: string): string | null {
  return value.length === 0 ? null : value;
}

function lines(value: string): readonly string[] {
  return value
    .split(/\r?\n/u)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

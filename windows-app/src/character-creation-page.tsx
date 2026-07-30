import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

import type { ClassArchetype, PlayerAttributesInput } from '@ember-tavern/contracts';

import {
  windowsCharacterCreationService,
  type CharacterCreationSnapshot,
  type CharacterDraft,
  type WindowsCharacterCreationService,
} from './character-creation-service.js';

type CharacterCreationActions = Pick<
  WindowsCharacterCreationService,
  'load' | 'generateTraits' | 'complete'
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      })
      .catch(() => {
        if (active) setError('无法读取这个存档的车卡进度。');
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

  async function generateTraits() {
    if (draft === null) return;
    setBusy(true);
    setError(null);
    try {
      const generated = await service.generateTraits(draft);
      setSnapshot(generated);
      setDraft(generated.draft ?? draft);
      setSelectedTraitIds([]);
    } catch {
      setError('特质没有生成成功，本地车卡仍保持在上一个有效状态。');
    } finally {
      setBusy(false);
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
    setBusy(true);
    setError(null);
    try {
      setSnapshot(await service.complete(draft, snapshot.traitGenerationRecordId, selected));
    } catch {
      setError('背景与装备没有保存成功，本地车卡仍保持在上一个有效状态。');
    } finally {
      setBusy(false);
    }
  }

  if (campaignId === null) {
    return <CharacterMessage title="先选择一个存档。" />;
  }
  if (snapshot === null || draft === null) {
    return error === null ? (
      <main className="character-studio character-studio--message" aria-busy="true">
        <span className="loading-glyph" aria-hidden="true" />
        <p className="eyebrow">Reading the character sheet</p>
        <h1>正在铺开车卡…</h1>
      </main>
    ) : (
      <CharacterMessage title={error} />
    );
  }
  if (snapshot.character !== null) {
    const character = snapshot.character;
    return (
      <main className="character-studio">
        <CharacterTopline step="03 · 背景与装备" />
        <section className="character-intro">
          <p className="eyebrow">Character ready</p>
          <h1>{character.name}</h1>
          <p>
            {character.classDisplayName} · {character.concept}
          </p>
        </section>
        <div className="character-review">
          <section>
            <p className="eyebrow">Background</p>
            <h2>人物背景</h2>
            <Description label="出生地" value={character.background.birthplace} />
            <Description label="成长经历" value={character.background.formativeExperience} />
            <Description label="冒险动机" value={character.background.adventureMotivation} />
            <Description label="秘密" value={character.background.secret} />
            <Description label="重要人物" value={character.background.importantPerson} />
            <Description label="来到酒馆" value={character.background.tavernArrivalReason} />
          </section>
          <section>
            <p className="eyebrow">Starting kit</p>
            <h2>初始装备</h2>
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
        </div>
        <button
          className="primary-action character-next"
          type="button"
          onClick={() => navigate(`/tavern?campaignId=${encodeURIComponent(campaignId)}`)}
        >
          进入酒馆生成流程
        </button>
      </main>
    );
  }
  if (snapshot.campaignState !== 'CREATING_CHARACTER') {
    return <CharacterMessage title="这个存档不在创建角色阶段。" />;
  }
  if (snapshot.traitCandidates.length > 0) {
    return (
      <main className="character-studio">
        <CharacterTopline step="02 · 选择特质" />
        <section className="character-intro">
          <p className="eyebrow">Choose two traits</p>
          <h1>决定角色如何面对世界。</h1>
          <p>从经过验证的六个候选特质中选择两个。重新打开应用后，本地进度仍会保留。</p>
        </section>
        {error === null ? null : (
          <p className="inline-error" role="alert">
            {error}
          </p>
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
                  onChange={(event) =>
                    setSelectedTraitIds(
                      event.target.checked
                        ? [...selectedTraitIds, trait.id]
                        : selectedTraitIds.filter((id) => id !== trait.id),
                    )
                  }
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
          {busy ? '正在生成背景…' : '确认特质并生成背景'}
        </button>
      </main>
    );
  }

  return (
    <main className="character-studio">
      <CharacterTopline step="01 · 基础车卡" />
      <section className="character-intro">
        <p className="eyebrow">Build your traveler</p>
        <h1>谁会推开酒馆的门？</h1>
        <p>基础事实由你决定；Fake Provider 只负责生成候选特质与背景文本。</p>
      </section>
      {error === null ? null : (
        <p className="inline-error" role="alert">
          {error}
        </p>
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
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
          </label>
          <label>
            <span>性别（可选）</span>
            <input
              value={draft.gender ?? ''}
              onChange={(event) => setDraft({ ...draft, gender: emptyToNull(event.target.value) })}
            />
          </label>
          <label>
            <span>年龄（可选）</span>
            <input
              min="0"
              type="number"
              value={draft.age ?? ''}
              onChange={(event) =>
                setDraft({
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
              onChange={(event) => setDraft({ ...draft, concept: event.target.value })}
            />
          </label>
          <label>
            <span>职业原型</span>
            <select
              value={draft.classArchetype}
              onChange={(event) => {
                const classArchetype = event.target.value as ClassArchetype;
                setDraft({
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
              onChange={(event) => setDraft({ ...draft, classDisplayName: event.target.value })}
            />
          </label>
          <label className="character-form__wide">
            <span>个人目标</span>
            <textarea
              required
              rows={2}
              value={draft.personalGoal}
              onChange={(event) => setDraft({ ...draft, personalGoal: event.target.value })}
            />
          </label>
          <label className="character-form__wide">
            <span>故事偏好（每行一项）</span>
            <textarea
              rows={2}
              value={draft.storyPreferences.join('\n')}
              onChange={(event) =>
                setDraft({ ...draft, storyPreferences: lines(event.target.value) })
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
                      setDraft({
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
              setDraft({ ...draft, contentBoundaries: { ...draft.contentBoundaries, allowHorror } })
            }
          />
          <Boundary
            label="允许永久死亡"
            checked={draft.contentBoundaries.allowPermanentDeath}
            onChange={(allowPermanentDeath) =>
              setDraft({
                ...draft,
                contentBoundaries: { ...draft.contentBoundaries, allowPermanentDeath },
              })
            }
          />
          <Boundary
            label="允许恋爱剧情"
            checked={draft.contentBoundaries.allowRomance}
            onChange={(allowRomance) =>
              setDraft({
                ...draft,
                contentBoundaries: { ...draft.contentBoundaries, allowRomance },
              })
            }
          />
          <Boundary
            label="允许背叛剧情"
            checked={draft.contentBoundaries.allowBetrayal}
            onChange={(allowBetrayal) =>
              setDraft({
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
                setDraft({
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
          {busy ? '正在生成特质…' : '生成六个候选特质'}
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

function CharacterMessage({ title }: { readonly title: string }) {
  return (
    <main className="character-studio character-studio--message" role="alert">
      <p className="eyebrow">Character stage unavailable</p>
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

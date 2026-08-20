import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import {
  CHARACTER_TRAIT_TYPES,
  NARRATIVE_TRAIT_POINT_PROFILE,
  TraitPointError,
  characterTraitId,
  createTraitPointProfile,
  type CharacterTrait,
  type CharacterAttributeName,
  type CharacterCreationMode,
  type CharacterTraitType,
  type TraitPointProfile,
  type UniversalCharacterDraft,
} from '@ember-tavern/contracts';
import { evaluateCharacterTraitPoints } from '@ember-tavern/domain';

import { AIErrorNotice } from './ai-error-notice.js';
import { APP_PATHS, campaignRoute } from './navigation.js';
import {
  CharacterAIFieldProvider,
  CharacterAIListField,
  CharacterAITextField,
} from './universal-character-ai-field.js';
import type { CharacterAISection } from './universal-character-ai.js';
import {
  universalCharacterCreationService,
  type UniversalCharacterCreationService,
  type UniversalCharacterCreationSnapshot,
} from './universal-character-creation-service.js';

type CreationActions = Pick<
  UniversalCharacterCreationService,
  | 'load'
  | 'start'
  | 'saveDraft'
  | 'switchMode'
  | 'prepareAdvanced'
  | 'generateQuick'
  | 'cancel'
  | 'resume'
  | 'confirm'
  | 'assistField'
  | 'generateDraftPreview'
>;

interface CharacterCreationPageProps {
  readonly service?: CreationActions;
}

const DEFAULT_BOUNDARIES = {
  allowHorror: true,
  allowPermanentDeath: false,
  allowRomance: true,
  allowBetrayal: true,
  excludedContent: [],
} as const;

const TEXT_FIELDS = [
  ['name', '姓名'],
  ['identity', '身份'],
  ['concept', '角色概念'],
  ['appearance', '外貌'],
  ['personality', '性格'],
] as const;
const OPTIONAL_TEXT_FIELDS = [
  ['nickname', '昵称'],
  ['gender', '性别'],
  ['ancestry', '种族 / 族群'],
  ['birthplace', '出生地'],
  ['socialClass', '阶层'],
  ['faith', '信仰'],
] as const;
const LIST_FIELDS = [
  ['values', '价值观'],
  ['goals', '目标'],
  ['fears', '恐惧'],
  ['secrets', '秘密'],
  ['family', '家庭'],
  ['education', '教育'],
  ['importantPeople', '重要人物'],
  ['enemies', '敌人'],
  ['experiences', '经历'],
  ['storyPreferences', '故事偏好'],
  ['proficiencies', '熟练'],
  ['abilities', '能力'],
  ['languages', '语言'],
] as const;
const BACKGROUND_FIELDS = [
  ['birthplace', '兼容出生地'],
  ['formativeExperience', '成长经历'],
  ['adventureMotivation', '冒险动机'],
  ['secret', '背景秘密'],
  ['importantPerson', '背景重要人物'],
  ['tavernArrivalReason', '来到酒馆的原因'],
] as const;
const ATTRIBUTE_LABELS: Readonly<Record<CharacterAttributeName, string>> = {
  physique: '体魄',
  agility: '敏捷',
  knowledge: '学识',
  charisma: '魅力',
};
const BOUNDARY_FIELDS = [
  ['allowHorror', '允许恐怖'],
  ['allowPermanentDeath', '允许永久死亡'],
  ['allowRomance', '允许浪漫'],
  ['allowBetrayal', '允许背叛'],
] as const;

export function CharacterCreationPage({
  service = universalCharacterCreationService,
}: CharacterCreationPageProps) {
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const campaignId = search.get('campaignId');
  const [snapshot, setSnapshot] = useState<UniversalCharacterCreationSnapshot | null>(null);
  const [draft, setDraft] = useState<UniversalCharacterDraft | null>(null);
  const [startMode, setStartMode] = useState<CharacterCreationMode>('QUICK');
  const [concept, setConcept] = useState('');
  const [lockedFields, setLockedFields] = useState<readonly string[]>([]);
  const [dirty, setDirty] = useState(false);
  const [aiSection, setAISection] = useState<CharacterAISection>('IDENTITY');
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkPreview, setBulkPreview] = useState<{
    readonly before: UniversalCharacterDraft;
    readonly after: UniversalCharacterDraft;
    readonly changedPaths: readonly string[];
  } | null>(null);
  const [bulkUndo, setBulkUndo] = useState<UniversalCharacterDraft | null>(null);
  const bulkAbort = useRef<AbortController | null>(null);
  const draftRef = useRef<UniversalCharacterDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown | null>(null);

  useEffect(() => {
    if (campaignId === null) return;
    let active = true;
    void service
      .load(campaignId)
      .then((loaded) => {
        if (!active) return;
        setSnapshot(loaded);
        setDraft(loaded.session?.draft ?? null);
        setConcept(loaded.session?.conceptInput ?? '');
        setLockedFields(loaded.session?.lockedFields ?? []);
        setDirty(false);
        draftRef.current = loaded.session?.draft ?? null;
      })
      .catch((cause: unknown) => {
        if (active) setError(cause);
      });
    return () => {
      active = false;
    };
  }, [campaignId, service]);

  async function perform(run: () => Promise<UniversalCharacterCreationSnapshot>) {
    setBusy(true);
    setError(null);
    try {
      const next = await run();
      setSnapshot(next);
      setDraft(next.session?.draft ?? null);
      setConcept(next.session?.conceptInput ?? '');
      setLockedFields(next.session?.lockedFields ?? []);
      setDirty(false);
      draftRef.current = next.session?.draft ?? null;
      setBulkPreview(null);
      setBulkUndo(null);
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  }

  function editDraft(next: UniversalCharacterDraft) {
    setDraft(next);
    draftRef.current = next;
    setDirty(true);
    setBulkPreview(null);
  }

  function editLocks(field: string, locks: readonly string[]) {
    setLockedFields(toggleField(field, locks));
    setDirty(true);
    setBulkPreview(null);
  }

  async function generateBulk(
    command:
      | { readonly scope: 'FILL_EMPTY' | 'WHOLE' | 'REGENERATE_UNLOCKED' }
      | { readonly scope: 'SECTION'; readonly section: CharacterAISection },
  ) {
    if (snapshot === null || draft === null) return;
    const base = draft;
    const controller = new AbortController();
    bulkAbort.current?.abort();
    bulkAbort.current = controller;
    setBulkBusy(true);
    setBulkError(null);
    setBulkPreview(null);
    try {
      const preview = await service.generateDraftPreview(
        snapshot,
        base,
        lockedFields,
        command,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      if (draftRef.current !== base) {
        setBulkError('草稿已在生成期间变化，请重新发起命运辅助。');
        return;
      }
      setBulkPreview({ before: base, after: preview.draft, changedPaths: preview.changedPaths });
    } catch (cause) {
      if (!controller.signal.aborted) {
        setBulkError(cause instanceof Error ? '命运辅助未能形成合法候选。' : '命运辅助失败。');
      }
    } finally {
      if (bulkAbort.current === controller) bulkAbort.current = null;
      setBulkBusy(false);
    }
  }

  useEffect(
    () => () => {
      bulkAbort.current?.abort();
    },
    [],
  );

  if (campaignId === null) return <Message title="先选择一个存档。" />;
  if (snapshot === null) {
    return error === null ? (
      <Message title="正在铺开通用车卡…" busy />
    ) : (
      <Message title="无法读取车卡进度。" />
    );
  }
  const session = snapshot.session;
  if (session === null) {
    return (
      <main className="character-studio">
        <Header step="01 · 选择创建方式" />
        <section className="character-intro">
          <p className="eyebrow">角色创建 2.0</p>
          <h1>写下一位会在这个世界里活起来的人。</h1>
          <p>快速创建用一句概念生成完整候选；进阶创建从空白通用车卡开始。确认前都只是本地草稿。</p>
        </section>
        <div className="character-form">
          <section>
            <h2>创建模式</h2>
            <div className="creation-mode-switch" role="group" aria-label="创建模式">
              <ModeButton mode="QUICK" current={startMode} onSelect={setStartMode} />
              <ModeButton mode="ADVANCED" current={startMode} onSelect={setStartMode} />
            </div>
            {startMode === 'QUICK' ? (
              <label>
                一句话角色概念
                <textarea value={concept} onChange={(event) => setConcept(event.target.value)} />
              </label>
            ) : null}
            <button
              className="primary-action character-next"
              disabled={busy || (startMode === 'QUICK' && concept.trim().length === 0)}
              type="button"
              onClick={() =>
                void perform(() =>
                  service.start({
                    campaignId,
                    mode: startMode,
                    conceptInput: startMode === 'QUICK' ? concept.trim() : null,
                    storyPreferences: [],
                    contentBoundaries: DEFAULT_BOUNDARIES,
                  }),
                )
              }
            >
              开始创建
            </button>
          </section>
        </div>
      </main>
    );
  }
  if (session.status === 'CANCELLED') {
    return (
      <main className="character-studio">
        <Header step="已暂停" />
        <section className="character-intro">
          <p className="eyebrow">草稿仍在本地</p>
          <h1>这张车卡没有被丢弃。</h1>
          <p>恢复后会回到取消前的模式、字段和锁定状态。</p>
          <button
            className="primary-action"
            disabled={busy}
            onClick={() => void perform(() => service.resume(snapshot))}
          >
            恢复创建
          </button>
        </section>
      </main>
    );
  }
  if (session.status === 'CONFIRMED') {
    return (
      <main className="character-studio">
        <Header step="03 · 已确认" />
        <section className="character-intro">
          <p className="eyebrow">角色事实已写入 SQLite</p>
          <h1>{session.draft.name}</h1>
          <p>
            {session.draft.career.displayName} · {session.draft.concept}
          </p>
          <button
            className="primary-action"
            onClick={() => navigate(campaignRoute(APP_PATHS.tavern, campaignId))}
          >
            进入酒馆生成流程
          </button>
        </section>
      </main>
    );
  }
  if (draft === null) return <Message title="车卡草稿不完整。" />;

  const locks = lockedFields;
  const ready = session.status === 'READY_TO_CONFIRM';
  const traitBudget = draftTraitBudget(draft.traits);
  return (
    <main className="character-studio">
      <Header step={ready ? '03 · 确认候选' : '02 · 编辑草稿'} />
      <section className="character-intro">
        <p className="eyebrow">{session.mode === 'QUICK' ? '快速创建' : '进阶创建'}</p>
        <h1>{ready ? '角色已通过本地完整性校验。' : '每一项都仍是可恢复的草稿。'}</h1>
        <p>锁定字段会在模式切换和后续生成中保持不变；确认前不会创建正式角色事实。</p>
        <div className="creation-mode-switch" role="group" aria-label="当前创建模式">
          <ModeButton
            mode="QUICK"
            current={session.mode}
            onSelect={() =>
              void perform(() =>
                service.switchMode(
                  snapshot,
                  'QUICK',
                  concept.trim() || draft.concept || '待完善的角色',
                ),
              )
            }
          />
          <ModeButton
            mode="ADVANCED"
            current={session.mode}
            onSelect={() => void perform(() => service.switchMode(snapshot, 'ADVANCED', null))}
          />
        </div>
        {session.mode === 'QUICK' ? (
          <label>
            一句话角色概念
            <textarea
              value={concept}
              onChange={(event) => {
                setConcept(event.target.value);
                setDirty(true);
              }}
            />
          </label>
        ) : null}
      </section>
      {error === null ? null : <AIErrorNotice error={error} />}
      <section className="character-sheet__ai-controls" aria-busy={bulkBusy}>
        <div>
          <p className="eyebrow">命运编织台</p>
          <h2>先预览，再采用；所有锁定字段保持不变。</h2>
          <p>可补全空白、协调一个区域或整张车卡，也可只重生未锁定内容。</p>
        </div>
        <button disabled={bulkBusy} onClick={() => void generateBulk({ scope: 'FILL_EMPTY' })}>
          补全空白
        </button>
        <label>
          区域
          <select
            value={aiSection}
            onChange={(event) => setAISection(event.target.value as CharacterAISection)}
          >
            <option value="IDENTITY">身份与形象</option>
            <option value="INNER_LIFE">经历与内心</option>
            <option value="CAREER">职业表达</option>
            <option value="TRAITS">叙事特质</option>
            <option value="BACKGROUND">背景</option>
            <option value="BOUNDARIES">内容边界</option>
            <option value="EXTENSIONS">世界扩展</option>
          </select>
        </label>
        <button
          disabled={bulkBusy}
          onClick={() => void generateBulk({ scope: 'SECTION', section: aiSection })}
        >
          编织当前区域
        </button>
        <button disabled={bulkBusy} onClick={() => void generateBulk({ scope: 'WHOLE' })}>
          协调整张车卡
        </button>
        <button
          disabled={bulkBusy}
          onClick={() => void generateBulk({ scope: 'REGENERATE_UNLOCKED' })}
        >
          重生未锁内容
        </button>
        {bulkBusy ? (
          <button type="button" onClick={() => bulkAbort.current?.abort()}>
            取消编织
          </button>
        ) : null}
        {bulkError === null ? null : <p role="alert">{bulkError}</p>}
        {bulkPreview === null ? null : (
          <div>
            <p>候选将更新 {bulkPreview.changedPaths.length} 个叙事字段，尚未写入草稿。</p>
            <button
              className="primary-action"
              onClick={() => {
                setBulkUndo(bulkPreview.before);
                editDraft(bulkPreview.after);
              }}
            >
              采用整批候选
            </button>
            <button onClick={() => setBulkPreview(null)}>放弃候选</button>
          </div>
        )}
        {bulkUndo === null ? null : (
          <button
            onClick={() => {
              const previous = bulkUndo;
              setBulkUndo(null);
              editDraft(previous);
            }}
          >
            撤销整批采用
          </button>
        )}
      </section>
      <CharacterAIFieldProvider
        snapshot={snapshot}
        draft={draft}
        lockedFields={lockedFields}
        service={service}
      >
        <div className="character-form" aria-busy={busy || bulkBusy}>
          <section className="character-form__identity">
            <h2>身份与形象</h2>
            {TEXT_FIELDS.map(([key, label]) => (
              <LockedTextField
                key={key}
                field={key}
                label={label}
                value={draft[key]}
                locks={locks}
                onLock={(field) => editLocks(field, locks)}
                onChange={(value) => editDraft({ ...draft, [key]: value })}
              />
            ))}
            {OPTIONAL_TEXT_FIELDS.map(([key, label]) => (
              <LockedTextField
                key={key}
                field={key}
                label={label}
                value={draft[key] ?? ''}
                locks={locks}
                onLock={(field) => editLocks(field, locks)}
                onChange={(value) =>
                  editDraft({ ...draft, [key]: value.trim().length === 0 ? null : value })
                }
              />
            ))}
            <label data-character-field="age">
              年龄
              <input
                type="number"
                min="0"
                max="10000"
                value={draft.age ?? ''}
                onChange={(event) =>
                  editDraft({
                    ...draft,
                    age: event.target.value === '' ? null : Number(event.target.value),
                  })
                }
              />
            </label>
          </section>

          <section>
            <h2>经历、关系与内心</h2>
            {LIST_FIELDS.map(([key, label]) => (
              <LockedListField
                key={key}
                field={key}
                label={label}
                values={draft[key]}
                locks={locks}
                onLock={(field) => editLocks(field, locks)}
                onChange={(values) => editDraft({ ...draft, [key]: values })}
              />
            ))}
          </section>

          <section>
            <h2>职业与本地属性</h2>
            <LockedTextField
              field="career.displayName"
              lockField="career"
              label="职业显示名"
              value={draft.career.displayName}
              locks={locks}
              onLock={(field) => editLocks(field, locks)}
              onChange={(value) =>
                editDraft({ ...draft, career: { ...draft.career, displayName: value } })
              }
            />
            <label data-character-field="career.legacyArchetype">
              当前兼容职业类型
              <select
                value={draft.career.legacyArchetype ?? 'WARRIOR'}
                onChange={(event) =>
                  editDraft({
                    ...draft,
                    career: {
                      ...draft.career,
                      legacyArchetype: event.target.value as NonNullable<
                        typeof draft.career.legacyArchetype
                      >,
                    },
                  })
                }
              >
                <option value="WARRIOR">战士</option>
                <option value="ROGUE">游荡者</option>
                <option value="SCHOLAR">学者</option>
                <option value="DIPLOMAT">交涉者</option>
              </select>
            </label>
            {Object.entries(ATTRIBUTE_LABELS).map(([key, label]) => (
              <label key={key} data-character-field={`attributes.${key}`}>
                {label}
                <input
                  type="number"
                  min="1"
                  max="5"
                  value={draft.attributes[key as CharacterAttributeName]}
                  onChange={(event) =>
                    editDraft({
                      ...draft,
                      attributes: { ...draft.attributes, [key]: Number(event.target.value) },
                    })
                  }
                />
              </label>
            ))}
            <p>
              四项属性必须各为 1–5 且总和严格等于 10。财富、技能数值、派生属性和状态由本地规则引擎
              初始化。
            </p>
            <dl className="character-sheet__attributes" aria-label="规则控制字段">
              <div>
                <dt>财富</dt>
                <dd>{draft.wealth}</dd>
              </div>
              <div>
                <dt>技能</dt>
                <dd>{draft.skills.length}</dd>
              </div>
              <div>
                <dt>状态</dt>
                <dd>{draft.statuses.length}</dd>
              </div>
              <div>
                <dt>装备</dt>
                <dd>{draft.equipmentIds.length}</dd>
              </div>
            </dl>
          </section>

          <section>
            <h2>特质点数</h2>
            <p>
              增益消耗负点，弱点提供正点，混合特质分别记录两者；叙事特质不产生规则收益。无特质合法，开始前净点数必须严格为
              0。
            </p>
            <p role="status">
              本地重算：{traitBudget.valid ? traitBudget.net : '配置不完整'}
              {traitBudget.valid && traitBudget.net === 0 ? '（可开始）' : '（禁止开始）'}
            </p>
            {draft.traits.map((trait, index) => {
              const pointProfile = draftTraitPointProfile(trait);
              return (
                <div key={trait.id} data-character-field={`traits.${index}`}>
                  <LockedTextField
                    field={`traits.${index}.name`}
                    lockField="traits"
                    label={`特质 ${index + 1} 名称`}
                    value={trait.name}
                    locks={locks}
                    onLock={(field) => editLocks(field, locks)}
                    onChange={(name) =>
                      editDraft({
                        ...draft,
                        traits: replaceTrait(draft.traits, index, { ...trait, name }),
                      })
                    }
                  />
                  <LockedTextField
                    field={`traits.${index}.description`}
                    lockField="traits"
                    label={`特质 ${index + 1} 描述`}
                    value={trait.description}
                    locks={locks}
                    onLock={(field) => editLocks(field, locks)}
                    onChange={(description) =>
                      editDraft({
                        ...draft,
                        traits: replaceTrait(draft.traits, index, { ...trait, description }),
                      })
                    }
                  />
                  <label data-character-field={`traits.${index}.pointProfile.type`}>
                    特质类型
                    <select
                      value={pointProfile.type}
                      disabled={isLocked('traits', locks)}
                      onChange={(event) =>
                        editDraft({
                          ...draft,
                          traits: replaceTrait(draft.traits, index, {
                            ...trait,
                            pointProfile: changeTraitPointType(
                              event.target.value as CharacterTraitType,
                              trait,
                            ),
                          }),
                        })
                      }
                    >
                      {CHARACTER_TRAIT_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {traitTypeLabel(type)}
                        </option>
                      ))}
                    </select>
                  </label>
                  {pointProfile.type === 'BUFF' || pointProfile.type === 'MIXED' ? (
                    <>
                      <LockedTextField
                        field={`traits.${index}.pointProfile.positiveEffect`}
                        lockField="traits"
                        label="正面效果"
                        value={pointProfile.positiveEffect ?? ''}
                        locks={locks}
                        onLock={(field) => editLocks(field, locks)}
                        onChange={(positiveEffect) =>
                          editDraft({
                            ...draft,
                            traits: replaceTrait(draft.traits, index, {
                              ...trait,
                              pointProfile: { ...pointProfile, positiveEffect },
                            }),
                          })
                        }
                      />
                      <TraitPointSelect
                        label="增益消耗"
                        value={pointProfile.buffPoints}
                        values={[-1, -2, -3, -4, -5]}
                        disabled={isLocked('traits', locks)}
                        onChange={(buffPoints) =>
                          editDraft({
                            ...draft,
                            traits: replaceTrait(draft.traits, index, {
                              ...trait,
                              pointProfile: { ...pointProfile, buffPoints },
                            }),
                          })
                        }
                      />
                    </>
                  ) : null}
                  {pointProfile.type === 'DEBUFF' || pointProfile.type === 'MIXED' ? (
                    <>
                      <LockedTextField
                        field={`traits.${index}.pointProfile.negativeEffect`}
                        lockField="traits"
                        label="负面效果"
                        value={pointProfile.negativeEffect ?? ''}
                        locks={locks}
                        onLock={(field) => editLocks(field, locks)}
                        onChange={(negativeEffect) =>
                          editDraft({
                            ...draft,
                            traits: replaceTrait(draft.traits, index, {
                              ...trait,
                              pointProfile: { ...pointProfile, negativeEffect },
                            }),
                          })
                        }
                      />
                      <TraitPointSelect
                        label="弱点提供"
                        value={pointProfile.debuffPoints}
                        values={[1, 2, 3, 4, 5]}
                        disabled={isLocked('traits', locks)}
                        onChange={(debuffPoints) =>
                          editDraft({
                            ...draft,
                            traits: replaceTrait(draft.traits, index, {
                              ...trait,
                              pointProfile: { ...pointProfile, debuffPoints },
                            }),
                          })
                        }
                      />
                    </>
                  ) : null}
                  <p>本特质净点数：{pointProfile.buffPoints + pointProfile.debuffPoints}</p>
                  <button
                    type="button"
                    disabled={isLocked('traits', locks)}
                    onClick={() =>
                      editDraft({
                        ...draft,
                        traits: draft.traits.filter(({ id }) => id !== trait.id),
                      })
                    }
                  >
                    移除特质 {index + 1}
                  </button>
                </div>
              );
            })}
            {draft.traits.length >= 2 ? null : (
              <button
                type="button"
                disabled={isLocked('traits', locks)}
                onClick={() =>
                  editDraft({
                    ...draft,
                    traits: [
                      ...draft.traits,
                      {
                        id: characterTraitId(
                          `draft-trait-${session.characterId}-${draft.traits.length + 1}`,
                        ),
                        name: '',
                        description: '',
                        pointProfile: NARRATIVE_TRAIT_POINT_PROFILE,
                      },
                    ],
                  })
                }
              >
                添加特质
              </button>
            )}
          </section>

          <section>
            <h2>兼容背景</h2>
            {BACKGROUND_FIELDS.map(([key, label]) => (
              <LockedTextField
                key={key}
                field={`legacyBackground.${key}`}
                lockField="legacyBackground"
                label={label}
                value={draft.legacyBackground[key]}
                locks={locks}
                onLock={(field) => editLocks(field, locks)}
                onChange={(value) =>
                  editDraft({
                    ...draft,
                    legacyBackground: { ...draft.legacyBackground, [key]: value },
                  })
                }
              />
            ))}
          </section>

          <fieldset className="character-boundaries">
            <legend>内容边界</legend>
            {BOUNDARY_FIELDS.map(([key, label]) => (
              <label key={key}>
                <input
                  type="checkbox"
                  checked={draft.contentBoundaries[key]}
                  onChange={(event) =>
                    editDraft({
                      ...draft,
                      contentBoundaries: {
                        ...draft.contentBoundaries,
                        [key]: event.target.checked,
                      },
                    })
                  }
                />
                {label}
              </label>
            ))}
            <LockedListField
              field="contentBoundaries.excludedContent"
              lockField="contentBoundaries"
              label="排除内容"
              values={draft.contentBoundaries.excludedContent}
              locks={locks}
              onLock={(field) => editLocks(field, locks)}
              onChange={(values) =>
                editDraft({
                  ...draft,
                  contentBoundaries: { ...draft.contentBoundaries, excludedContent: values },
                })
              }
            />
          </fieldset>

          {snapshot.extensionDefinitions.map((definition) => (
            <section key={definition.namespace}>
              <h2>{definition.displayName}</h2>
              {definition.fields.map((field) => (
                <ExtensionEditor
                  key={field.key}
                  definition={definition.namespace}
                  field={field}
                  draft={draft}
                  locks={locks}
                  onLock={(path) => editLocks(path, locks)}
                  onChange={editDraft}
                />
              ))}
            </section>
          ))}

          <section className="character-sheet__ai-controls">
            <div>
              <p className="eyebrow">确认边界</p>
              <h2>{ready ? '候选可以写入正式事实' : '先保存并完成本地验证'}</h2>
              <p>
                关系、声望、装备实体、状态和派生值会在对应业务阶段由本地合同建立，不接受描述反解析。
              </p>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() => void perform(() => service.saveDraft(snapshot, draft, locks))}
            >
              保存草稿
            </button>
            {session.mode === 'QUICK' ? (
              <button
                className="primary-action"
                type="button"
                disabled={busy || concept.trim().length === 0}
                onClick={() =>
                  void perform(async () => {
                    const current =
                      concept.trim() === session.conceptInput
                        ? snapshot
                        : await service.switchMode(snapshot, 'QUICK', concept.trim());
                    return service.generateQuick(current);
                  })
                }
              >
                命运编织完整角色
              </button>
            ) : (
              <button
                className="primary-action"
                type="button"
                disabled={busy || !traitBudget.valid || traitBudget.net !== 0}
                onClick={() =>
                  void perform(async () => {
                    const saved = await service.saveDraft(snapshot, draft, locks);
                    return service.prepareAdvanced(saved);
                  })
                }
              >
                校验完整车卡
              </button>
            )}
            <button
              className="primary-action"
              type="button"
              disabled={busy || !ready || dirty || !traitBudget.valid || traitBudget.net !== 0}
              onClick={() => void perform(() => service.confirm(snapshot))}
            >
              确认角色
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void perform(() => service.cancel(snapshot))}
            >
              暂停并返回
            </button>
          </section>
        </div>
      </CharacterAIFieldProvider>
    </main>
  );
}

function ModeButton({
  mode,
  current,
  onSelect,
}: {
  mode: CharacterCreationMode;
  current: CharacterCreationMode;
  onSelect(mode: CharacterCreationMode): void;
}) {
  return (
    <button type="button" aria-pressed={mode === current} onClick={() => onSelect(mode)}>
      {mode === 'QUICK' ? '快速 · 一句话生成' : '进阶 · 全字段编辑'}
    </button>
  );
}

function LockedTextField({
  field,
  lockField = field,
  label,
  value,
  locks,
  onLock,
  onChange,
}: {
  field: string;
  lockField?: string;
  label: string;
  value: string;
  locks: readonly string[];
  onLock(field: string): void;
  onChange(value: string): void;
}) {
  return (
    <CharacterAITextField
      path={field}
      label={label}
      value={value}
      locked={isLocked(lockField, locks)}
      onChange={onChange}
      onLock={() => onLock(lockField)}
    />
  );
}

function LockedListField({
  field,
  lockField = field,
  label,
  values,
  locks,
  onLock,
  onChange,
}: {
  field: string;
  lockField?: string;
  label: string;
  values: readonly string[];
  locks: readonly string[];
  onLock(field: string): void;
  onChange(values: readonly string[]): void;
}) {
  return (
    <CharacterAIListField
      path={field}
      label={label}
      values={values}
      locked={isLocked(lockField, locks)}
      onChange={onChange}
      onLock={() => onLock(lockField)}
    />
  );
}

function TraitPointSelect({
  label,
  value,
  values,
  disabled,
  onChange,
}: {
  readonly label: string;
  readonly value: number;
  readonly values: readonly number[];
  readonly disabled: boolean;
  readonly onChange: (value: number) => void;
}) {
  return (
    <label>
      {label}
      <select
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
      >
        {values.map((option) => (
          <option key={option} value={option}>
            {option > 0 ? `+${option}` : option}
          </option>
        ))}
      </select>
    </label>
  );
}

function draftTraitPointProfile(trait: CharacterTrait): TraitPointProfile {
  try {
    return createTraitPointProfile(trait.pointProfile);
  } catch (cause) {
    if (!(cause instanceof TraitPointError)) throw cause;
    return trait.pointProfile ?? NARRATIVE_TRAIT_POINT_PROFILE;
  }
}

function draftTraitBudget(traits: readonly CharacterTrait[]): {
  readonly valid: boolean;
  readonly net: number;
} {
  try {
    return { valid: true, net: evaluateCharacterTraitPoints(traits).netPoints };
  } catch (cause) {
    if (!(cause instanceof TraitPointError)) throw cause;
    return { valid: false, net: 0 };
  }
}

function changeTraitPointType(type: CharacterTraitType, trait: CharacterTrait): TraitPointProfile {
  const current = draftTraitPointProfile(trait);
  const description = trait.description.trim();
  const positiveEffect = current.positiveEffect ?? description;
  const negativeEffect = current.negativeEffect ?? description;
  switch (type) {
    case 'BUFF':
      return {
        type,
        positiveEffect,
        negativeEffect: null,
        buffPoints: current.buffPoints < 0 ? current.buffPoints : -1,
        debuffPoints: 0,
      };
    case 'DEBUFF':
      return {
        type,
        positiveEffect: null,
        negativeEffect,
        buffPoints: 0,
        debuffPoints: current.debuffPoints > 0 ? current.debuffPoints : 1,
      };
    case 'MIXED':
      return {
        type,
        positiveEffect,
        negativeEffect,
        buffPoints: current.buffPoints < 0 ? current.buffPoints : -1,
        debuffPoints: current.debuffPoints > 0 ? current.debuffPoints : 1,
      };
    case 'NARRATIVE':
      return NARRATIVE_TRAIT_POINT_PROFILE;
  }
}

function traitTypeLabel(type: CharacterTraitType): string {
  switch (type) {
    case 'BUFF':
      return '增益 · 消耗点数';
    case 'DEBUFF':
      return '弱点 · 提供点数';
    case 'MIXED':
      return '混合 · 正负并存';
    case 'NARRATIVE':
      return '叙事 · 0 点';
  }
}

function ExtensionEditor({
  definition,
  field,
  draft,
  locks,
  onLock,
  onChange,
}: {
  definition: string;
  field: UniversalCharacterCreationSnapshot['extensionDefinitions'][number]['fields'][number];
  draft: UniversalCharacterDraft;
  locks: readonly string[];
  onLock(path: string): void;
  onChange(draft: UniversalCharacterDraft): void;
}) {
  const path = `extensions.${definition}.${field.key}`;
  const set = draft.extensions.find((entry) => entry.namespace === definition);
  const value = set?.values[field.key];
  const update = (next: Value) =>
    onChange({ ...draft, extensions: updateExtension(draft, definition, field.key, next) });
  type Value = string | number | boolean | readonly string[];
  if (field.type === 'TEXT') {
    return (
      <CharacterAITextField
        path={path}
        label={`${field.label}${field.required ? '（必填）' : ''}`}
        value={typeof value === 'string' ? value : ''}
        locked={isLocked(path, locks)}
        onChange={update}
        onLock={onLock}
      />
    );
  }
  if (field.type === 'TEXT_LIST') {
    return (
      <CharacterAIListField
        path={path}
        label={`${field.label}${field.required ? '（必填）' : ''}`}
        values={Array.isArray(value) ? value.filter((entry) => typeof entry === 'string') : []}
        locked={isLocked(path, locks)}
        onChange={update}
        onLock={onLock}
      />
    );
  }
  let control;
  if (field.type === 'BOOLEAN')
    control = (
      <input
        type="checkbox"
        checked={value === true}
        onChange={(event) => update(event.target.checked)}
      />
    );
  else if (field.type === 'ENUM')
    control = (
      <select
        value={typeof value === 'string' ? value : ''}
        onChange={(event) => update(event.target.value)}
      >
        <option value="">请选择</option>
        {field.options.map((option) => (
          <option key={option}>{option}</option>
        ))}
      </select>
    );
  else if (field.type === 'INTEGER' || field.type === 'NUMBER')
    control = (
      <input
        type="number"
        min={field.minimum}
        max={field.maximum}
        value={typeof value === 'number' ? value : ''}
        onChange={(event) => update(Number(event.target.value))}
      />
    );
  else
    control = (
      <textarea
        value={typeof value === 'string' ? value : ''}
        onChange={(event) => update(event.target.value)}
      />
    );
  return (
    <div data-character-field={path}>
      <label>
        {field.label}
        {field.required ? '（必填）' : ''}
        {control}
      </label>
      <label>
        <input type="checkbox" checked={locks.includes(path)} onChange={() => onLock(path)} />
        锁定
      </label>
    </div>
  );
}

function updateExtension(
  draft: UniversalCharacterDraft,
  namespace: string,
  key: string,
  value: string | number | boolean | readonly string[],
) {
  const current = draft.extensions.find((entry) => entry.namespace === namespace);
  const next = {
    namespace,
    schemaVersion: 1 as const,
    values: { ...(current?.values ?? {}), [key]: value },
  };
  return [...draft.extensions.filter((entry) => entry.namespace !== namespace), next];
}

function replaceTrait(
  traits: UniversalCharacterDraft['traits'],
  index: number,
  trait: UniversalCharacterDraft['traits'][number],
) {
  const next = [...traits];
  next[index] = trait;
  return next.slice(0, 2);
}

function toggleField(field: string, locks: readonly string[]) {
  return locks.includes(field) ? locks.filter((entry) => entry !== field) : [...locks, field];
}

function isLocked(field: string, locks: readonly string[]) {
  return locks.some((locked) => field === locked || field.startsWith(`${locked}.`));
}

function Header({ step }: { step: string }) {
  return (
    <header className="character-studio__topline">
      <p>Ember Tavern · {step}</p>
      <strong>通用角色档案</strong>
    </header>
  );
}
function Message({ title, busy = false }: { title: string; busy?: boolean }) {
  return (
    <main className="character-studio character-studio--message" aria-busy={busy}>
      <h1>{title}</h1>
    </main>
  );
}

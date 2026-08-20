import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import {
  CHARACTER_TRAIT_TYPES,
  DEFAULT_TRAIT_EFFECT_BALANCE_DECLARATION,
  NARRATIVE_TRAIT_POINT_PROFILE,
  TRAIT_AVOIDABILITY_LEVELS,
  TRAIT_CONDITION_SCOPES,
  TRAIT_EFFECT_RARITIES,
  TRAIT_ENVIRONMENT_SCOPES,
  TRAIT_FREQUENCIES,
  TRAIT_IMPACT_LEVELS,
  TRAIT_PERMANENCE_LEVELS,
  TraitBalanceError,
  TraitPointError,
  characterTraitId,
  createTraitPointProfile,
  recommendedTraitPoints,
  type CharacterTrait,
  type CharacterAttributeName,
  type CharacterCreationMode,
  type CharacterTraitType,
  type TraitEffectBalanceDeclaration,
  type TraitPointProfile,
  type UniversalCharacterDraft,
} from '@ember-tavern/contracts';
import { evaluateCharacterTraitPoints, traitGenerationFeedback } from '@ember-tavern/domain';

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
  | 'generateInitialCareerPool'
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

type BalanceScalarField =
  | 'frequency'
  | 'environment'
  | 'combat'
  | 'social'
  | 'narrative'
  | 'economy'
  | 'permanence'
  | 'avoidability'
  | 'rarity'
  | 'condition';

const BALANCE_SELECT_FIELDS = [
  {
    key: 'frequency',
    label: '触发频率',
    options: balanceOptions(TRAIT_FREQUENCIES, ['罕见', '偶尔', '常见', '持续']),
  },
  {
    key: 'environment',
    label: '环境范围',
    options: balanceOptions(TRAIT_ENVIRONMENT_SCOPES, [
      '单一场景',
      '有限环境',
      '广泛环境',
      '任何环境',
    ]),
  },
  {
    key: 'combat',
    label: '战斗影响',
    options: balanceOptions(TRAIT_IMPACT_LEVELS, ['无', '轻微', '显著', '主导']),
  },
  {
    key: 'social',
    label: '社交影响',
    options: balanceOptions(TRAIT_IMPACT_LEVELS, ['无', '轻微', '显著', '主导']),
  },
  {
    key: 'narrative',
    label: '剧情影响',
    options: balanceOptions(TRAIT_IMPACT_LEVELS, ['无', '轻微', '显著', '主导']),
  },
  {
    key: 'economy',
    label: '经济影响',
    options: balanceOptions(TRAIT_IMPACT_LEVELS, ['无', '轻微', '显著', '主导']),
  },
  {
    key: 'permanence',
    label: '持续时间',
    options: balanceOptions(TRAIT_PERMANENCE_LEVELS, ['瞬时', '本场景', '持续', '永久']),
  },
  {
    key: 'avoidability',
    label: '可规避性',
    options: balanceOptions(TRAIT_AVOIDABILITY_LEVELS, ['容易', '有代价', '困难', '无法规避']),
  },
  {
    key: 'rarity',
    label: '效果稀有度',
    options: balanceOptions(TRAIT_EFFECT_RARITIES, ['常见', '少见', '稀有', '独特']),
  },
  {
    key: 'condition',
    label: '触发条件',
    options: balanceOptions(TRAIT_CONDITION_SCOPES, ['严格', '特定', '宽泛', '无条件']),
  },
] as const satisfies readonly {
  readonly key: BalanceScalarField;
  readonly label: string;
  readonly options: readonly { readonly value: string; readonly label: string }[];
}[];

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

  useEffect(() => {
    if (snapshot === null || snapshot.careerPool !== null || busy || error !== null) {
      return;
    }
    void perform(() => service.generateInitialCareerPool(snapshot));
  }, [snapshot, busy, error, service]);

  if (campaignId === null) return <Message title="先选择一个存档。" />;
  if (snapshot === null) {
    return error === null ? (
      <Message title="正在铺开通用车卡…" busy />
    ) : (
      <Message title="无法读取车卡进度。" />
    );
  }
  const session = snapshot.session;
  if (snapshot.careerPool === null) {
    return (
      <main className="character-studio">
        <Header step="01 · 构筑职业池" />
        <section className="character-intro" aria-busy={busy}>
          <p className="eyebrow">世界职业</p>
          <h1>{busy ? '命运正在梳理这个世界的生计与身份……' : '职业池尚未形成。'}</h1>
          <p>职业将依照锁定的世界规则生成常见、少见、稀有与特殊层级，并作为持久世界事实保存。</p>
          {error === null ? null : <AIErrorNotice error={error} />}
          <button
            className="primary-action"
            disabled={busy}
            onClick={() => void perform(() => service.generateInitialCareerPool(snapshot))}
          >
            ✦ 重新构筑职业池
          </button>
        </section>
      </main>
    );
  }
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
  const traitRules = draftTraitRules(
    draft.traits,
    session.campaignId,
    session.constitutionRevision,
  );
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
            <label data-character-field="career.id">
              世界职业
              <select
                value={draft.career.id ?? ''}
                onChange={(event) => {
                  const selected = snapshot.careerPool?.careers.find(
                    ({ id }) => id === event.target.value,
                  );
                  if (selected === undefined) return;
                  editDraft({
                    ...draft,
                    career: {
                      id: selected.id,
                      displayName: selected.name,
                      legacyArchetype: selected.legacyArchetype,
                    },
                  });
                }}
              >
                <option value="">选择符合世界规则的职业</option>
                {snapshot.careerPool.careers.map((career) => (
                  <option key={career.id} value={career.id}>
                    {career.name} · {careerRarityLabel(career.rarity)}
                  </option>
                ))}
              </select>
            </label>
            {snapshot.careerPool.careers
              .filter(({ id }) => id === draft.career.id)
              .map((career) => (
                <article className="game-card" key={career.id}>
                  <p className="eyebrow">{careerRarityLabel(career.rarity)}</p>
                  <h3>{career.name}</h3>
                  <p>{career.role}</p>
                  <p>社会位置：{career.socialPosition}</p>
                  <p>入行条件：{career.requirements.join('；')}</p>
                  <p>风险：{career.risks.join('；')}</p>
                </article>
              ))}
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
              本地重算：{traitRules.pointValid ? traitRules.net : '配置不完整'}
              {traitRules.valid ? '（可开始）' : '（禁止开始）'}
            </p>
            <p role="status">十维平衡与协同：{traitRules.valid ? '已通过' : '待完善'}</p>
            {traitRules.messages.length === 0 ? null : (
              <ul>
                {traitRules.messages.map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            )}
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
                      <TraitBalanceEditor
                        label="正面效果十维评估"
                        value={
                          pointProfile.positiveBalance ?? DEFAULT_TRAIT_EFFECT_BALANCE_DECLARATION
                        }
                        missing={pointProfile.positiveBalance == null}
                        disabled={isLocked('traits', locks)}
                        onChange={(positiveBalance) =>
                          editDraft({
                            ...draft,
                            traits: replaceTrait(draft.traits, index, {
                              ...trait,
                              pointProfile: {
                                ...pointProfile,
                                positiveBalance,
                                negativeBalance: pointProfile.negativeBalance ?? null,
                              },
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
                      <TraitBalanceEditor
                        label="负面效果十维评估"
                        value={
                          pointProfile.negativeBalance ?? DEFAULT_TRAIT_EFFECT_BALANCE_DECLARATION
                        }
                        missing={pointProfile.negativeBalance == null}
                        disabled={isLocked('traits', locks)}
                        onChange={(negativeBalance) =>
                          editDraft({
                            ...draft,
                            traits: replaceTrait(draft.traits, index, {
                              ...trait,
                              pointProfile: {
                                ...pointProfile,
                                positiveBalance: pointProfile.positiveBalance ?? null,
                                negativeBalance,
                              },
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
                disabled={busy || !traitRules.valid}
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
              disabled={busy || !ready || dirty || !traitRules.valid}
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

function TraitBalanceEditor({
  label,
  value,
  missing,
  disabled,
  onChange,
}: {
  readonly label: string;
  readonly value: TraitEffectBalanceDeclaration;
  readonly missing: boolean;
  readonly disabled: boolean;
  readonly onChange: (value: TraitEffectBalanceDeclaration) => void;
}) {
  const recommendation = draftBalanceRecommendation(value);
  const updateScalar = (key: BalanceScalarField, next: string) => {
    const conditionPatch =
      key === 'condition'
        ? {
            condition: next as TraitEffectBalanceDeclaration['condition'],
            requiresTags: next === 'UNCONDITIONAL' ? [] : value.requiresTags,
          }
        : {};
    onChange({ ...value, ...conditionPatch, [key]: next } as TraitEffectBalanceDeclaration);
  };
  return (
    <details>
      <summary>
        {label} · 本地建议 {recommendation ?? '配置不完整'} 点
      </summary>
      {missing ? (
        <button type="button" disabled={disabled} onClick={() => onChange(value)}>
          采用当前评估
        </button>
      ) : null}
      {BALANCE_SELECT_FIELDS.map(({ key, label: fieldLabel, options }) => (
        <label key={key}>
          {fieldLabel}
          <select
            value={value[key]}
            disabled={disabled}
            onChange={(event) => updateScalar(key, event.target.value)}
          >
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      ))}
      <BalanceTagField
        label="机制标签"
        value={value.mechanicTags}
        disabled={disabled}
        onChange={(mechanicTags) => onChange({ ...value, mechanicTags })}
      />
      <BalanceTagField
        label="授予标签"
        value={value.grantsTags}
        disabled={disabled}
        onChange={(grantsTags) => onChange({ ...value, grantsTags })}
      />
      {value.condition === 'UNCONDITIONAL' ? null : (
        <BalanceTagField
          label="所需条件标签"
          value={value.requiresTags}
          disabled={disabled}
          onChange={(requiresTags) => onChange({ ...value, requiresTags })}
        />
      )}
      <BalanceTagField
        label="抵消标签"
        value={value.neutralizesTags}
        disabled={disabled}
        onChange={(neutralizesTags) => onChange({ ...value, neutralizesTags })}
      />
    </details>
  );
}

function BalanceTagField({
  label,
  value,
  disabled,
  onChange,
}: {
  readonly label: string;
  readonly value: readonly string[];
  readonly disabled: boolean;
  readonly onChange: (value: readonly string[]) => void;
}) {
  return (
    <label>
      {label}（逗号分隔）
      <input
        value={value.join('，')}
        disabled={disabled}
        onChange={(event) => onChange(parseBalanceTags(event.target.value))}
      />
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

function draftTraitRules(
  traits: readonly CharacterTrait[],
  scope: string,
  revision: number,
): {
  readonly valid: boolean;
  readonly pointValid: boolean;
  readonly net: number;
  readonly messages: readonly string[];
} {
  try {
    const points = evaluateCharacterTraitPoints(traits);
    const worldRules = { scope, revision };
    const feedback = traitGenerationFeedback(traits, worldRules);
    const messages = feedback.issues.map(traitIssueMessage);
    return {
      valid: points.netPoints === 0 && feedback.accepted,
      pointValid: true,
      net: points.netPoints,
      messages: Object.freeze([...new Set(messages)]),
    };
  } catch (cause) {
    if (!(cause instanceof TraitPointError || cause instanceof TraitBalanceError)) throw cause;
    return {
      valid: false,
      pointValid: false,
      net: 0,
      messages: Object.freeze(['特质评估配置不完整或格式无效。']),
    };
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
        positiveBalance: current.positiveBalance ?? DEFAULT_TRAIT_EFFECT_BALANCE_DECLARATION,
        negativeBalance: null,
      };
    case 'DEBUFF':
      return {
        type,
        positiveEffect: null,
        negativeEffect,
        buffPoints: 0,
        debuffPoints: current.debuffPoints > 0 ? current.debuffPoints : 1,
        positiveBalance: null,
        negativeBalance: current.negativeBalance ?? DEFAULT_TRAIT_EFFECT_BALANCE_DECLARATION,
      };
    case 'MIXED':
      return {
        type,
        positiveEffect,
        negativeEffect,
        buffPoints: current.buffPoints < 0 ? current.buffPoints : -1,
        debuffPoints: current.debuffPoints > 0 ? current.debuffPoints : 1,
        positiveBalance: current.positiveBalance ?? DEFAULT_TRAIT_EFFECT_BALANCE_DECLARATION,
        negativeBalance: current.negativeBalance ?? DEFAULT_TRAIT_EFFECT_BALANCE_DECLARATION,
      };
    case 'NARRATIVE':
      return NARRATIVE_TRAIT_POINT_PROFILE;
  }
}

function draftBalanceRecommendation(value: TraitEffectBalanceDeclaration): number | null {
  try {
    return recommendedTraitPoints(value);
  } catch (cause) {
    if (!(cause instanceof TraitBalanceError)) throw cause;
    return null;
  }
}

function traitIssueMessage(issue: { readonly code: string }): string {
  switch (issue.code) {
    case 'BALANCE_DECLARATION_MISSING':
      return '机械特质需要补全十维评估。';
    case 'POINT_TIER_MISMATCH':
      return '点数必须与十维评估计算出的本地建议档位一致。';
    case 'DRAWBACK_NEUTRALIZED':
      return '正面效果不能直接抵消用于换取点数的弱点。';
    case 'CONDITION_BYPASS':
      return '正面效果不能通过自行提供条件来维持较低点数档位。';
    case 'POSITIVE_FEEDBACK_LOOP':
      return '正面效果之间不能形成自我维持的触发循环。';
    default:
      return '特质未通过本地平衡规则。';
  }
}

function parseBalanceTags(value: string): readonly string[] {
  return Object.freeze(
    value
      .split(/[,，]/u)
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
  );
}

function balanceOptions<const Values extends readonly string[]>(
  values: Values,
  labels: { readonly [Index in keyof Values]: string },
): readonly { readonly value: Values[number]; readonly label: string }[] {
  return Object.freeze(
    values.map((value, index) => Object.freeze({ value, label: labels[index] ?? value })),
  );
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

function careerRarityLabel(rarity: 'COMMON' | 'UNCOMMON' | 'RARE' | 'SPECIAL'): string {
  return {
    COMMON: '常见职业',
    UNCOMMON: '少见职业',
    RARE: '稀有职业',
    SPECIAL: '特殊职业',
  }[rarity];
}

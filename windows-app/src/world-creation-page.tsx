import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

import {
  windowsWorldCreationService,
  type WindowsWorldCreationService,
  type WorldBibleView,
  type WorldCreationSnapshot,
  type WorldDraft,
} from './world-creation-service.js';
import { AIErrorNotice } from './ai-error-notice.js';

type WorldCreationActions = Pick<
  WindowsWorldCreationService,
  'load' | 'generate' | 'refine' | 'update' | 'confirm'
>;

interface WorldCreationPageProps {
  readonly service?: WorldCreationActions;
}

const LOCK_FIELDS = [
  ['name', '世界名称'],
  ['currentRegion', '当前地区'],
  ['summary', '世界简介'],
  ['coreConflict', '核心冲突'],
  ['technologyLevel', '技术水平'],
  ['powerRules', '力量规则'],
  ['narrativeStyle', '叙事风格'],
  ['forbiddenElements', '禁止设定'],
  ['tavernReason', '酒馆缘由'],
] as const;

export function WorldCreationPage({
  service = windowsWorldCreationService,
}: WorldCreationPageProps) {
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const campaignId = search.get('campaignId');
  const [snapshot, setSnapshot] = useState<WorldCreationSnapshot | null>(null);
  const [editor, setEditor] = useState<WorldDraft | null>(null);
  const [lockedFields, setLockedFields] = useState<WorldBibleView['lockedFields']>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [aiError, setAiError] = useState<unknown | null>(null);
  const [retryOperation, setRetryOperation] = useState<
    (() => Promise<WorldCreationSnapshot>) | null
  >(null);
  const [revision, setRevision] = useState('');

  useEffect(() => {
    if (campaignId === null) return;
    let active = true;
    void service
      .load(campaignId)
      .then((loaded) => {
        if (active) setSnapshot(loaded);
      })
      .catch(() => {
        if (active) setLoadError('无法读取该存档的世界构筑进度。');
      });
    return () => {
      active = false;
    };
  }, [campaignId, service]);

  useEffect(() => {
    if (snapshot?.world === null || snapshot?.world === undefined) return;
    setEditor(draftOf(snapshot.world));
    setLockedFields(snapshot.world.lockedFields);
  }, [snapshot]);

  async function perform(label: string, action: () => Promise<WorldCreationSnapshot>) {
    setBusy(label);
    setAiError(null);
    setRetryOperation(null);
    try {
      setSnapshot(await action());
    } catch (error) {
      setAiError(error);
      setRetryOperation(() => action);
    } finally {
      setBusy(null);
    }
  }

  if (campaignId === null) {
    return (
      <main className="world-studio world-studio--message">
        <p className="eyebrow">Missing chronicle</p>
        <h1>先选择一个存档。</h1>
        <Link className="text-link" to="/saves">
          返回存档首页
        </Link>
      </main>
    );
  }

  if (snapshot === null && loadError === null) {
    return (
      <main className="world-studio world-studio--message" aria-live="polite" aria-busy="true">
        <span className="loading-glyph" aria-hidden="true" />
        <p className="eyebrow">Reading the atlas</p>
        <h1>正在展开世界地图…</h1>
      </main>
    );
  }
  if (snapshot === null) {
    return <WorldMessage title={loadError ?? '无法读取该存档的世界构筑进度。'} />;
  }

  if (snapshot?.campaignState === 'CREATING_WORLD') {
    return (
      <WorldOptions
        busy={busy !== null}
        error={aiError}
        onRetry={retryOperation === null ? undefined : () => void perform('retry', retryOperation)}
        onGenerate={(options) =>
          void perform('generate', () => service.generate(campaignId, options))
        }
      />
    );
  }

  if (snapshot?.campaignState === 'REVIEWING_WORLD' && snapshot.world !== null && editor !== null) {
    const current = snapshot.world;
    return (
      <main className="world-studio">
        <header className="world-studio__topline">
          <Link to="/saves">← 存档首页</Link>
          <p>Fake Provider · 本地离线预览</p>
        </header>
        <section className="world-hero">
          <div>
            <p className="eyebrow">World bible review</p>
            <input
              aria-label="世界名称"
              className="world-title-input"
              value={editor.name}
              disabled={isLocked('name', current.lockedFields)}
              onChange={(event) => setEditor({ ...editor, name: event.target.value })}
            />
            <p>{editor.currentRegion}</p>
          </div>
          <button
            className="primary-action"
            type="button"
            disabled={busy !== null}
            onClick={() =>
              void perform('confirm', async () => {
                const confirmed = await service.confirm(campaignId);
                navigate(`/character/create?campaignId=${encodeURIComponent(campaignId)}`);
                return confirmed;
              })
            }
          >
            {busy === 'confirm' ? '正在确认…' : '确认世界'}
          </button>
        </section>

        {aiError === null ? null : (
          <AIErrorNotice
            error={aiError}
            onRetry={
              retryOperation === null ? undefined : () => void perform('retry', retryOperation)
            }
          />
        )}

        <div className="world-layout">
          <section className="world-editor" aria-label="世界圣经编辑">
            <WorldTextField
              label="当前地区"
              value={editor.currentRegion}
              locked={isLocked('currentRegion', current.lockedFields)}
              onChange={(value) => setEditor({ ...editor, currentRegion: value })}
            />
            <WorldTextArea
              label="世界简介"
              value={editor.summary}
              locked={isLocked('summary', current.lockedFields)}
              onChange={(value) => setEditor({ ...editor, summary: value })}
            />
            <WorldTextArea
              label="核心冲突"
              value={editor.coreConflict}
              locked={isLocked('coreConflict', current.lockedFields)}
              onChange={(value) => setEditor({ ...editor, coreConflict: value })}
            />
            <WorldTextField
              label="技术水平"
              value={editor.technologyLevel}
              locked={isLocked('technologyLevel', current.lockedFields)}
              onChange={(value) => setEditor({ ...editor, technologyLevel: value })}
            />
            <WorldTextArea
              label="力量规则（每行一条）"
              value={editor.powerRules.join('\n')}
              locked={isLocked('powerRules', current.lockedFields)}
              onChange={(value) => setEditor({ ...editor, powerRules: lines(value) })}
            />
            <WorldTextArea
              label="叙事风格"
              value={editor.narrativeStyle}
              locked={isLocked('narrativeStyle', current.lockedFields)}
              onChange={(value) => setEditor({ ...editor, narrativeStyle: value })}
            />
            <WorldTextArea
              label="禁止设定（每行一条）"
              value={editor.forbiddenElements.join('\n')}
              locked={isLocked('forbiddenElements', current.lockedFields)}
              onChange={(value) => setEditor({ ...editor, forbiddenElements: lines(value) })}
            />
            <WorldTextArea
              label="酒馆存在的原因"
              value={editor.tavernReason}
              locked={isLocked('tavernReason', current.lockedFields)}
              onChange={(value) => setEditor({ ...editor, tavernReason: value })}
            />

            <div className="world-editor__actions">
              <button
                className="primary-action"
                type="button"
                disabled={busy !== null}
                onClick={() =>
                  void perform('save', () => service.update(campaignId, editor, lockedFields))
                }
              >
                {busy === 'save' ? '正在保存…' : '保存手动修改'}
              </button>
            </div>
          </section>

          <aside className="world-tools">
            <section>
              <p className="eyebrow">Field locks</p>
              <h2>锁定字段</h2>
              <p>锁定后，局部重新生成不能改变这些内容。先解锁并保存，才能再次编辑。</p>
              <div className="lock-list">
                {LOCK_FIELDS.map(([field, label]) => (
                  <label key={field}>
                    <input
                      type="checkbox"
                      checked={lockedFields.includes(field)}
                      onChange={(event) =>
                        setLockedFields(
                          event.target.checked
                            ? [...lockedFields, field]
                            : lockedFields.filter((candidate) => candidate !== field),
                        )
                      }
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            </section>

            <section>
              <p className="eyebrow">Refine locally</p>
              <h2>局部修改</h2>
              <textarea
                aria-label="修改要求"
                rows={5}
                maxLength={4_000}
                placeholder="例如：让主要势力的目标更明确，但保留力量规则。"
                value={revision}
                onChange={(event) => setRevision(event.target.value)}
              />
              <button
                className="primary-action primary-action--wide"
                type="button"
                disabled={busy !== null || revision.trim().length === 0}
                onClick={() =>
                  void perform('refine', async () => {
                    const saved = await service.update(campaignId, editor, lockedFields);
                    if (saved.world === null) throw new Error('world missing');
                    const result = await service.refine(campaignId, saved.world, [revision.trim()]);
                    setRevision('');
                    return result;
                  })
                }
              >
                {busy === 'refine' ? '正在重绘…' : '按要求局部生成'}
              </button>
              <button
                className="quiet-action quiet-action--wide"
                type="button"
                disabled={busy !== null}
                onClick={() =>
                  void perform('regenerate', async () => {
                    const unlocked = await service.update(campaignId, editor, []);
                    if (unlocked.world === null) throw new Error('world missing');
                    return service.refine(campaignId, unlocked.world, [
                      '在保留玩家内容边界的前提下，完整重新生成世界圣经。',
                    ]);
                  })
                }
              >
                全部重新生成
              </button>
            </section>
          </aside>
        </div>

        <section className="world-reference">
          <WorldReferenceGroup title="主要势力" entries={current.factions} />
          <WorldReferenceGroup title="重要地点" entries={current.locations} />
          <div>
            <p className="eyebrow">Story hooks</p>
            <h2>剧情线索</h2>
            <ul>
              {current.storyHooks.map((hook) => (
                <li key={hook}>{hook}</li>
              ))}
            </ul>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="world-studio world-studio--message" role="alert">
      <p className="eyebrow">World stage unavailable</p>
      <h1>这个存档不在世界构筑阶段。</h1>
      <Link className="text-link" to="/saves">
        返回存档首页
      </Link>
    </main>
  );
}

function WorldMessage({ title }: { readonly title: string }) {
  return (
    <main className="world-studio world-studio--message" role="alert">
      <p className="eyebrow">World stage unavailable</p>
      <h1>{title}</h1>
      <Link className="text-link" to="/saves">
        返回存档首页
      </Link>
    </main>
  );
}

interface WorldOptionsProps {
  readonly busy: boolean;
  readonly error: unknown | null;
  readonly onRetry?: (() => void) | undefined;
  readonly onGenerate: (options: Parameters<WindowsWorldCreationService['generate']>[1]) => void;
}

function WorldOptions({ busy, error, onGenerate, onRetry }: WorldOptionsProps) {
  const [worldType, setWorldType] = useState('奇幻');
  const [tone, setTone] = useState('冒险');
  const [magic, setMagic] = useState('中');
  const [scale, setScale] = useState('一个地区');
  const [darkness, setDarkness] = useState('2');
  const [prompt, setPrompt] = useState('');
  const [excluded, setExcluded] = useState('');
  const [allowHorror, setAllowHorror] = useState(false);
  const [allowPermanentDeath, setAllowPermanentDeath] = useState(false);
  const [allowRomance, setAllowRomance] = useState(true);
  const [allowBetrayal, setAllowBetrayal] = useState(true);

  return (
    <main className="world-studio world-studio--options">
      <header className="world-studio__topline">
        <Link to="/saves">← 存档首页</Link>
        <p>Step 01 · 世界构筑</p>
      </header>
      <section className="world-options__intro">
        <p className="eyebrow">Shape a new realm</p>
        <h1>给炉火一张地图。</h1>
        <p>基础选项决定边界；自定义构想可以留空。所有结果都会先预览，再由你确认。</p>
      </section>

      {error === null ? null : <AIErrorNotice error={error} onRetry={onRetry} />}

      <form
        className="world-options"
        onSubmit={(event) => {
          event.preventDefault();
          const base = `世界类型：${worldType}；故事氛围：${tone}；魔法程度：${magic}；世界规模：${scale}；黑暗程度：${darkness}/5。`;
          onGenerate({
            concept: prompt.trim().length === 0 ? base : `${base}\n玩家构想：${prompt.trim()}`,
            storyPreferences: [worldType, tone, `魔法${magic}`, scale, `黑暗程度${darkness}/5`],
            contentBoundaries: {
              allowHorror,
              allowPermanentDeath,
              allowRomance,
              allowBetrayal,
              excludedContent: lines(excluded),
            },
          });
        }}
      >
        <div className="option-grid">
          <SelectOption
            label="世界类型"
            value={worldType}
            values={['奇幻', '武侠', '蒸汽朋克', '科幻', '都市怪谈', '随机']}
            onChange={setWorldType}
          />
          <SelectOption
            label="故事氛围"
            value={tone}
            values={['轻松', '冒险', '平衡', '严肃', '黑暗']}
            onChange={setTone}
          />
          <SelectOption
            label="魔法程度"
            value={magic}
            values={['无', '低', '中', '高']}
            onChange={setMagic}
          />
          <SelectOption
            label="世界规模"
            value={scale}
            values={['一座城市', '一个地区', '一个王国']}
            onChange={setScale}
          />
        </div>

        <label className="range-option">
          <span>黑暗程度</span>
          <input
            type="range"
            min="0"
            max="5"
            value={darkness}
            onChange={(event) => setDarkness(event.target.value)}
          />
          <output>{darkness} / 5</output>
        </label>

        <label className="prompt-option">
          <span>
            自定义世界构想 <small>可选</small>
          </span>
          <textarea
            rows={6}
            maxLength={4_000}
            placeholder="例如：这是一个漂浮在云海上的群岛世界……"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
          />
        </label>

        <fieldset className="boundary-options">
          <legend>内容边界</legend>
          <BooleanOption label="允许恐怖元素" checked={allowHorror} onChange={setAllowHorror} />
          <BooleanOption
            label="允许永久死亡"
            checked={allowPermanentDeath}
            onChange={setAllowPermanentDeath}
          />
          <BooleanOption label="允许恋爱剧情" checked={allowRomance} onChange={setAllowRomance} />
          <BooleanOption label="允许背叛" checked={allowBetrayal} onChange={setAllowBetrayal} />
          <label className="boundary-options__excluded">
            <span>不希望出现的内容（每行一项）</span>
            <textarea
              rows={3}
              value={excluded}
              onChange={(event) => setExcluded(event.target.value)}
            />
          </label>
        </fieldset>

        <button className="primary-action world-options__submit" type="submit" disabled={busy}>
          {busy ? '正在生成世界…' : '使用 Fake Provider 生成'}
        </button>
      </form>
    </main>
  );
}

function SelectOption({
  label,
  value,
  values,
  onChange,
}: {
  readonly label: string;
  readonly value: string;
  readonly values: readonly string[];
  readonly onChange: (value: string) => void;
}) {
  return (
    <label>
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {values.map((entry) => (
          <option key={entry}>{entry}</option>
        ))}
      </select>
    </label>
  );
}

function BooleanOption({
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

function WorldTextField({
  label,
  value,
  locked,
  onChange,
}: {
  readonly label: string;
  readonly value: string;
  readonly locked: boolean;
  readonly onChange: (value: string) => void;
}) {
  return (
    <label>
      <span>{label}</span>
      <input value={value} disabled={locked} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function WorldTextArea({
  label,
  value,
  locked,
  onChange,
}: {
  readonly label: string;
  readonly value: string;
  readonly locked: boolean;
  readonly onChange: (value: string) => void;
}) {
  return (
    <label>
      <span>{label}</span>
      <textarea
        rows={4}
        value={value}
        disabled={locked}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function WorldReferenceGroup({
  title,
  entries,
}: {
  readonly title: string;
  readonly entries: readonly { readonly name: string; readonly description: string }[];
}) {
  return (
    <div>
      <p className="eyebrow">World reference</p>
      <h2>{title}</h2>
      <ul>
        {entries.map((entry) => (
          <li key={entry.name}>
            <strong>{entry.name}</strong>
            <span>{entry.description}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function lines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function draftOf(world: WorldBibleView): WorldDraft {
  return {
    name: world.name,
    currentRegion: world.currentRegion,
    summary: world.summary,
    coreConflict: world.coreConflict,
    technologyLevel: world.technologyLevel,
    powerRules: [...world.powerRules],
    factions: world.factions.map((faction) => ({ ...faction, goals: [...faction.goals] })),
    locations: world.locations.map((location) => ({
      ...location,
      factionNames: [...location.factionNames],
    })),
    narrativeStyle: world.narrativeStyle,
    forbiddenElements: [...world.forbiddenElements],
    tavernReason: world.tavernReason,
    storyHooks: [...world.storyHooks],
  };
}

function isLocked(
  field: WorldBibleView['lockedFields'][number],
  locks: WorldBibleView['lockedFields'],
) {
  return locks.includes(field);
}

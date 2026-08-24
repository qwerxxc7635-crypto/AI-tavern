import { useEffect, useState } from 'react';

import {
  MAX_PROMPT_BLOCKS,
  type PromptManagerSnapshot,
  type PromptUserBlock,
} from '@ember-tavern/prompts';
import { tauriPromptManagerGateway, type PromptManagerGateway } from './prompt-manager-service.js';

interface EditablePreset {
  readonly id: string | null;
  readonly version: number | null;
  readonly name: string;
  readonly blocks: readonly PromptUserBlock[];
}

const emptyDraft: EditablePreset = Object.freeze({
  id: null,
  version: null,
  name: '',
  blocks: Object.freeze([]),
});

export function PromptManagerPanel({
  gateway = tauriPromptManagerGateway,
}: {
  readonly gateway?: PromptManagerGateway;
}) {
  const [snapshot, setSnapshot] = useState<PromptManagerSnapshot | null>(null);
  const [draft, setDraft] = useState<EditablePreset>(emptyDraft);
  const [bundle, setBundle] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let active = true;
    void gateway
      .load()
      .then((loaded) => {
        if (!active) return;
        setSnapshot(loaded);
        setDraft(draftFromSnapshot(loaded));
        setLoadFailed(false);
      })
      .catch(() => {
        if (active) {
          setLoadFailed(true);
          setStatus('提示词设置已损坏或无法读取。');
        }
      });
    return () => {
      active = false;
    };
  }, [gateway]);

  async function run(operation: () => Promise<PromptManagerSnapshot>, message: string) {
    setBusy(true);
    setStatus(null);
    try {
      const updated = await operation();
      setSnapshot(updated);
      setDraft(draftFromSnapshot(updated, draft.id));
      setStatus(message);
    } catch {
      setStatus('操作未完成；本地设置未被覆盖，请刷新后重试。');
    } finally {
      setBusy(false);
    }
  }

  function selectDraft(id: string) {
    if (snapshot === null) return;
    const preset = snapshot.presets.find((candidate) => candidate.id === id);
    if (preset !== undefined) setDraft(copyPreset(preset));
  }

  function updateBlock(index: number, patch: Partial<PromptUserBlock>) {
    setDraft((current) => ({
      ...current,
      blocks: current.blocks.map((block, blockIndex) =>
        blockIndex === index ? { ...block, ...patch } : block,
      ),
    }));
  }

  function moveBlock(index: number, direction: -1 | 1) {
    setDraft((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.blocks.length) return current;
      const blocks = [...current.blocks];
      const currentBlock = blocks[index];
      const targetBlock = blocks[target];
      if (currentBlock === undefined || targetBlock === undefined) return current;
      blocks[index] = targetBlock;
      blocks[target] = currentBlock;
      return { ...current, blocks };
    });
  }

  const canSave =
    snapshot !== null &&
    draft.name.trim().length > 0 &&
    draft.blocks.every(({ name, content }) => name.trim().length > 0 && content.trim().length > 0);

  return (
    <div className="prompt-manager" aria-label="提示词管理器">
      <div className="prompt-manager__core" aria-label="不可编辑核心规则">
        <strong>核心规则提示词（只读）</strong>
        <p>系统合同、游戏规则、知识边界与输出结构由应用维护，预设无法覆盖。</p>
      </div>

      {loadFailed ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void gateway
              .recover(null)
              .then((recovered) => {
                setSnapshot(recovered);
                setDraft(emptyDraft);
                setLoadFailed(false);
                setStatus('损坏设置已清除，当前使用默认提示词。');
              })
              .catch(() => setStatus('无法安全重置；若设置已被其他窗口更新，请刷新页面。'))
              .finally(() => setBusy(false));
          }}
        >
          安全恢复默认提示词
        </button>
      ) : null}

      <label>
        当前启用预设
        <select
          aria-label="当前启用预设"
          disabled={snapshot === null || busy}
          value={snapshot?.activePresetId ?? ''}
          onChange={(event) => {
            if (snapshot === null) return;
            const id = event.currentTarget.value || null;
            void run(
              () => gateway.activate(snapshot.revision, id),
              id === null ? '已恢复默认提示词。' : '已启用提示词预设。',
            );
          }}
        >
          <option value="">默认（不附加用户风格）</option>
          {snapshot?.presets.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.name} · v{preset.version}
            </option>
          ))}
        </select>
      </label>

      <div>
        <label>
          编辑预设
          <select
            aria-label="编辑预设"
            disabled={snapshot === null || snapshot.presets.length === 0}
            value={draft.id ?? ''}
            onChange={(event) => selectDraft(event.currentTarget.value)}
          >
            {snapshot?.presets.length === 0 ? <option value="">尚无预设</option> : null}
            {snapshot?.presets.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.name} · v{preset.version}
              </option>
            ))}
          </select>
        </label>
        <button type="button" disabled={busy} onClick={() => setDraft(emptyDraft)}>
          新建预设
        </button>
      </div>

      <label>
        预设名称
        <input
          aria-label="预设名称"
          maxLength={80}
          value={draft.name}
          onChange={(event) =>
            setDraft((current) => ({ ...current, name: event.currentTarget.value }))
          }
        />
      </label>
      <p>
        管理器修订：{snapshot?.revision ?? '读取中…'} · 预设版本：{draft.version ?? '新建'}
      </p>

      <div aria-label="用户风格块">
        {draft.blocks.map((block, index) => (
          <fieldset key={block.id}>
            <legend>风格块 {index + 1}</legend>
            <label>
              名称
              <input
                aria-label={`风格块 ${index + 1} 名称`}
                maxLength={80}
                value={block.name}
                onChange={(event) => updateBlock(index, { name: event.currentTarget.value })}
              />
            </label>
            <label>
              内容
              <textarea
                aria-label={`风格块 ${index + 1} 内容`}
                maxLength={4_000}
                value={block.content}
                onChange={(event) => updateBlock(index, { content: event.currentTarget.value })}
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={block.enabled}
                onChange={(event) => updateBlock(index, { enabled: event.currentTarget.checked })}
              />
              启用此风格块
            </label>
            <button type="button" disabled={index === 0} onClick={() => moveBlock(index, -1)}>
              上移
            </button>
            <button
              type="button"
              disabled={index === draft.blocks.length - 1}
              onClick={() => moveBlock(index, 1)}
            >
              下移
            </button>
            <button
              type="button"
              onClick={() =>
                setDraft((current) => ({
                  ...current,
                  blocks: current.blocks.filter((_, blockIndex) => blockIndex !== index),
                }))
              }
            >
              删除风格块
            </button>
          </fieldset>
        ))}
      </div>

      <button
        type="button"
        disabled={busy || draft.blocks.length >= MAX_PROMPT_BLOCKS}
        onClick={() =>
          setDraft((current) => ({
            ...current,
            blocks: [
              ...current.blocks,
              {
                id: newId('prompt-block'),
                name: `风格块 ${current.blocks.length + 1}`,
                content: '请在此描述叙事风格。',
                enabled: true,
                tasks: [],
              },
            ],
          }))
        }
      >
        添加风格块
      </button>
      <button
        type="button"
        disabled={busy || !canSave}
        onClick={() => {
          if (snapshot === null) return;
          void run(
            () =>
              gateway.save(snapshot.revision, {
                id: draft.id ?? newId('prompt-preset'),
                name: draft.name.trim(),
                expectedVersion: draft.version,
                blocks: draft.blocks.map((block) => ({
                  ...block,
                  name: block.name.trim(),
                  content: block.content.trim(),
                })),
              }),
            '提示词预设已保存。',
          );
        }}
      >
        保存预设
      </button>

      <label>
        预设导入 / 导出（不含核心规则与秘密）
        <textarea
          aria-label="预设导入导出数据"
          value={bundle}
          onChange={(event) => setBundle(event.currentTarget.value)}
        />
      </label>
      <button
        type="button"
        disabled={busy || draft.id === null}
        onClick={() => {
          if (draft.id === null) return;
          setBusy(true);
          void gateway
            .export(draft.id)
            .then((value) => {
              setBundle(value);
              setStatus('预设已导出到文本框。');
            })
            .catch(() => setStatus('导出失败；没有写入秘密或核心规则。'))
            .finally(() => setBusy(false));
        }}
      >
        导出预设
      </button>
      <button
        type="button"
        disabled={busy || snapshot === null || bundle.trim().length === 0}
        onClick={() => {
          if (snapshot === null) return;
          void run(
            () => gateway.import(snapshot.revision, newId('prompt-preset'), bundle),
            '预设已作为新副本导入。',
          );
        }}
      >
        导入为新预设
      </button>
      {status === null ? null : <p aria-live="polite">{status}</p>}
    </div>
  );
}

function draftFromSnapshot(snapshot: PromptManagerSnapshot, preferredId?: string | null) {
  const preset =
    snapshot.presets.find(({ id }) => id === preferredId) ??
    snapshot.presets.find(({ id }) => id === snapshot.activePresetId) ??
    snapshot.presets[0];
  return preset === undefined ? emptyDraft : copyPreset(preset);
}

function copyPreset(preset: PromptManagerSnapshot['presets'][number]): EditablePreset {
  return {
    id: preset.id,
    version: preset.version,
    name: preset.name,
    blocks: preset.blocks.map((block) => ({ ...block, tasks: [...block.tasks] })),
  };
}

function newId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

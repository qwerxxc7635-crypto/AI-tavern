import { useEffect, useState } from 'react';

import {
  tauriModelSettingsGateway,
  type ModelSettingsGateway,
  type ModelSettingsSnapshot,
  type PresetKey,
  type ProbeModel,
} from './model-settings-service.js';

const PRESETS: Readonly<Record<PresetKey, { name: string; baseUrl: string; model: string }>> = {
  deepseek: { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/', model: 'deepseek-v4-flash' },
  qwen: {
    name: 'Qwen',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1/',
    model: 'qwen3.7-plus',
  },
  openrouter: {
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1/',
    model: '',
  },
  ollama: { name: 'Ollama（本地）', baseUrl: 'http://localhost:11434/v1/', model: '' },
  custom: { name: '自定义兼容服务', baseUrl: '', model: '' },
};

export function ModelSettingsPage({
  gateway = tauriModelSettingsGateway,
}: {
  readonly gateway?: ModelSettingsGateway;
}) {
  const [snapshot, setSnapshot] = useState<ModelSettingsSnapshot | null>(null);
  const [presetKey, setPresetKey] = useState<PresetKey>('deepseek');
  const [displayName, setDisplayName] = useState(PRESETS.deepseek.name);
  const [baseUrl, setBaseUrl] = useState(PRESETS.deepseek.baseUrl);
  const [modelName, setModelName] = useState(PRESETS.deepseek.model);
  const [apiKey, setApiKey] = useState('');
  const [models, setModels] = useState<readonly ProbeModel[]>([]);
  const [useAsDefault, setUseAsDefault] = useState(true);
  const [useAsFallback, setUseAsFallback] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void gateway
      .load()
      .then((loaded) => {
        if (active) setSnapshot(loaded);
      })
      .catch(() => {
        if (active) setStatus('无法读取本地模型设置。');
      });
    return () => {
      active = false;
    };
  }, [gateway]);

  function choosePreset(next: PresetKey) {
    const selected = PRESETS[next];
    setPresetKey(next);
    setDisplayName(selected.name);
    setBaseUrl(selected.baseUrl);
    setModelName(selected.model);
    setModels([]);
    setStatus(null);
  }

  async function withCredential<T>(operation: (credentialRef: string | null) => Promise<T>) {
    if (presetKey === 'ollama' || apiKey.length === 0) return operation(null);
    const reference = await gateway.saveSecret(apiKey);
    try {
      return await operation(reference);
    } catch (error) {
      await gateway.deleteSecret(reference);
      throw error;
    }
  }

  async function probe() {
    setBusy(true);
    setStatus(null);
    let transientRef: string | null = null;
    try {
      if (presetKey !== 'ollama' && apiKey.length > 0) {
        transientRef = await gateway.saveSecret(apiKey);
      }
      const listed = await gateway.probe({
        presetKey,
        baseUrl: baseUrl || null,
        credentialRef: transientRef,
      });
      setModels(listed);
      if (modelName.length === 0 && listed[0] !== undefined) setModelName(listed[0].name);
      setStatus(`连接成功，发现 ${listed.length} 个模型。`);
    } catch {
      setStatus('连接失败，请检查服务地址、密钥和本地服务状态。');
    } finally {
      if (transientRef !== null) {
        try {
          await gateway.deleteSecret(transientRef);
        } catch {
          setStatus('连接测试已结束，但临时密钥清理失败，请检查系统凭据。');
        }
      }
      setBusy(false);
    }
  }

  async function save() {
    if (!displayName.trim() || !modelName.trim() || !baseUrl.trim()) {
      setStatus('请填写服务名称、Base URL和模型名。');
      return;
    }
    if (presetKey !== 'ollama' && presetKey !== 'custom' && apiKey.length === 0) {
      setStatus('云模型需要API Key；密钥只会保存到系统凭据库。');
      return;
    }
    const selectedModel = models.find((model) => model.name === modelName.trim());
    if (selectedModel === undefined) {
      setStatus('请先测试连接，并从服务返回的模型中选择。');
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      const saved = await withCredential((credentialRef) =>
        gateway.save({
          presetKey,
          providerDisplayName: displayName.trim(),
          baseUrl: baseUrl.trim(),
          credentialRef,
          modelName: modelName.trim(),
          modelDisplayName: selectedModel.displayName,
          capabilities: selectedModel.capabilities,
          useAsDefault,
          useAsFallback,
        }),
      );
      setSnapshot(saved);
      setApiKey('');
      setStatus('模型设置已保存；现有存档事实未被修改。');
    } catch {
      setStatus('模型设置未保存，请检查输入后重试。');
    } finally {
      setBusy(false);
    }
  }

  async function forgetCredential(profileId: string) {
    const accepted = window.confirm(
      '删除后，该Provider的已保存API Key会从Windows系统凭据库移除；模型配置仍会保留。确定继续吗？',
    );
    if (!accepted) return;
    setBusy(true);
    setStatus(null);
    try {
      setSnapshot(await gateway.forgetCredential(profileId));
      setStatus('已删除该Provider的系统凭据；模型配置仍保留。');
    } catch {
      setStatus('凭据没有完全删除，请重试或在Windows凭据管理器中手工清理。');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="model-settings">
      <header>
        <p className="eyebrow">Model workshop</p>
        <h1>设置</h1>
        <p>配置模型服务、默认模型与备用模型。API Key只保存到系统凭据库。</p>
      </header>
      <section className="model-settings__privacy" aria-label="隐私与联网说明">
        <h2>隐私与联网</h2>
        <p>当前0.1候选的游戏内容由本地演示模型生成；保存默认或备用模型不会发送Campaign内容。</p>
        <p>
          “测试连接”会向所选Base URL发送API
          Key（若填写）并读取模型列表；自定义地址就是本次连接的数据接收方。远程地址只允许HTTPS，本机回环服务可使用HTTP。
        </p>
        <p>
          当前候选尚未启用云端游戏生成。未来启用云生成或跨服务商切换时，发送必要游戏上下文前必须另行确认。
        </p>
      </section>
      <section className="model-settings__panel" aria-label="模型配置">
        <label>
          Provider
          <select
            value={presetKey}
            onChange={(event) => choosePreset(event.target.value as PresetKey)}
          >
            {Object.entries(PRESETS).map(([key, value]) => (
              <option key={key} value={key}>
                {value.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          配置名称
          <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
        </label>
        <label>
          Base URL
          <input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} />
        </label>
        <label>
          API Key
          <input
            type="password"
            autoComplete="off"
            value={apiKey}
            disabled={presetKey === 'ollama'}
            onChange={(event) => setApiKey(event.target.value)}
          />
        </label>
        <label>
          模型
          <input
            list="provider-models"
            value={modelName}
            onChange={(event) => setModelName(event.target.value)}
          />
          <datalist id="provider-models">
            {models.map((model) => (
              <option key={model.name} value={model.name}>
                {model.displayName}
              </option>
            ))}
          </datalist>
        </label>
        <div className="model-settings__checks">
          <label>
            <input
              type="checkbox"
              checked={useAsDefault}
              onChange={(event) => setUseAsDefault(event.target.checked)}
            />
            默认模型
          </label>
          <label>
            <input
              type="checkbox"
              checked={useAsFallback}
              onChange={(event) => setUseAsFallback(event.target.checked)}
            />
            备用模型
          </label>
        </div>
        <div className="model-settings__actions">
          <button type="button" disabled={busy} onClick={() => void probe()}>
            测试连接并列出模型
          </button>
          <button
            type="button"
            className="primary-action"
            disabled={busy}
            onClick={() => void save()}
          >
            保存设置
          </button>
        </div>
        {status === null ? null : <p role="status">{status}</p>}
      </section>
      <section className="model-settings__saved" aria-label="已保存模型">
        <h2>已保存模型</h2>
        {snapshot === null ? (
          <p>正在读取…</p>
        ) : snapshot.profiles.length === 0 ? (
          <p>尚未配置模型。</p>
        ) : (
          <ul>
            {snapshot.profiles.map((profile) => (
              <li key={profile.id}>
                <strong>{profile.modelDisplayName}</strong>
                <span>{profile.providerDisplayName}</span>
                {snapshot.defaultModelProfileId === profile.id ? <em>默认</em> : null}
                {snapshot.fallbackModelProfileId === profile.id ? <em>备用</em> : null}
                {profile.hasCredential ? (
                  <button
                    className="danger-action danger-action--small"
                    type="button"
                    disabled={busy}
                    onClick={() => void forgetCredential(profile.id)}
                  >
                    删除凭据
                  </button>
                ) : (
                  <span>无已保存凭据</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

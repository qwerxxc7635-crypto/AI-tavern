import { useEffect, useReducer, useRef, useState } from 'react';

import {
  ApiBindingTimeoutError,
  INITIAL_API_BINDING_STATE,
  reduceApiBindingState,
  withApiBindingTimeout,
} from './api-binding-state-machine.js';

import {
  CONNECTION_PROFILES,
  getConnectionProfile,
  tauriModelSettingsGateway,
  type ModelSettingsGateway,
  type ModelSettingsSnapshot,
  type ProbeResult,
  type PresetKey,
  type ProbeModel,
} from './model-settings-service.js';
import { playerText } from './localization/index.js';

const DEFAULT_PROFILE = getConnectionProfile('deepseek');

export function ModelSettingsPage({
  gateway = tauriModelSettingsGateway,
  probeTimeoutMs = 30_000,
}: {
  readonly gateway?: ModelSettingsGateway;
  readonly probeTimeoutMs?: number;
}) {
  const [snapshot, setSnapshot] = useState<ModelSettingsSnapshot | null>(null);
  const [presetKey, setPresetKey] = useState<PresetKey>('deepseek');
  const [displayName, setDisplayName] = useState(DEFAULT_PROFILE.name);
  const [baseUrl, setBaseUrl] = useState(DEFAULT_PROFILE.baseUrl);
  const [modelName, setModelName] = useState(DEFAULT_PROFILE.defaultModel);
  const [apiKey, setApiKey] = useState('');
  const [models, setModels] = useState<readonly ProbeModel[]>([]);
  const [probeResult, setProbeResult] = useState<ProbeResult | null>(null);
  const [useAsDefault, setUseAsDefault] = useState(true);
  const [useAsFallback, setUseAsFallback] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [credentialBusy, setCredentialBusy] = useState(false);
  const [binding, dispatchBinding] = useReducer(reduceApiBindingState, INITIAL_API_BINDING_STATE);
  const operationSequence = useRef(0);
  const activeOperation = useRef<number | null>(null);

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
    const selected = getConnectionProfile(next);
    setPresetKey(next);
    setDisplayName(selected.name);
    setBaseUrl(selected.baseUrl);
    setModelName(selected.defaultModel);
    setApiKey('');
    setModels([]);
    setProbeResult(null);
    setStatus(null);
    activeOperation.current = null;
    dispatchBinding({ type: 'CONFIG_CHANGED' });
  }

  const selectedProfile = getConnectionProfile(presetKey);
  const hasMatchingStoredCredential =
    snapshot?.profiles.some(
      (profile) =>
        profile.presetKey === presetKey &&
        profile.providerDisplayName === displayName.trim() &&
        profile.baseUrl === baseUrl.trim() &&
        profile.hasCredential,
    ) ?? false;

  function configurationChanged() {
    activeOperation.current = null;
    setModels([]);
    setProbeResult(null);
    setStatus(null);
    dispatchBinding({ type: 'CONFIG_CHANGED' });
  }

  async function withCredential<T>(
    operation: (credentialRef: string | null, credentialAction: 'KEEP' | 'REPLACE') => Promise<T>,
  ) {
    if (presetKey === 'ollama' || apiKey.length === 0) return operation(null, 'KEEP');
    const reference = await gateway.saveSecret(apiKey);
    try {
      return await operation(reference, 'REPLACE');
    } catch (error) {
      try {
        await gateway.deleteSecret(reference);
      } catch {
        // Native code has durably queued the opaque reference for a later retry.
      }
      throw error;
    }
  }

  async function probe() {
    const operationId = ++operationSequence.current;
    const revision = binding.revision;
    activeOperation.current = operationId;
    dispatchBinding({ type: 'TEST_STARTED', operationId });
    setStatus(null);
    try {
      const operation = (async () => {
        let transientRef: string | null = null;
        try {
          if (presetKey !== 'ollama' && apiKey.length > 0) {
            transientRef = await gateway.saveSecret(apiKey);
          }
          return await gateway.probe({
            presetKey,
            baseUrl: baseUrl || null,
            credentialRef: transientRef,
          });
        } finally {
          if (transientRef !== null) await gateway.deleteSecret(transientRef);
        }
      })();
      const result = await withApiBindingTimeout(operation, probeTimeoutMs);
      if (activeOperation.current !== operationId) return;
      setProbeResult(result);
      setBaseUrl(result.normalizedBaseUrl);
      setModels(result.models);
      if (modelName.length === 0 && result.models[0] !== undefined)
        setModelName(result.models[0].name);
      setStatus(`连接成功，发现 ${result.models.length} 个模型。`);
      dispatchBinding({ type: 'TEST_SUCCEEDED', operationId, revision });
    } catch (error) {
      if (activeOperation.current !== operationId) return;
      const timeout = error instanceof ApiBindingTimeoutError;
      setStatus(
        timeout
          ? '连接测试超时；配置仍可编辑，请检查服务后重试。'
          : '连接失败，请检查服务地址、密钥和本地服务状态。',
      );
      dispatchBinding({
        type: 'TEST_FAILED',
        operationId,
        revision,
        failure: timeout ? 'timeout' : 'test_failed',
      });
    } finally {
      if (activeOperation.current === operationId) activeOperation.current = null;
    }
  }

  function cancelProbe() {
    const operationId = activeOperation.current;
    if (binding.phase !== 'testing' || operationId === null) return;
    activeOperation.current = null;
    setStatus('已取消等待连接测试；迟到的结果不会用于保存。');
    dispatchBinding({ type: 'CANCELLED', operationId });
  }

  async function save() {
    if (!displayName.trim() || !modelName.trim() || !baseUrl.trim()) {
      setStatus('请填写服务名称、Base URL和模型名。');
      return;
    }
    if (
      presetKey !== 'ollama' &&
      presetKey !== 'custom' &&
      apiKey.length === 0 &&
      !hasMatchingStoredCredential
    ) {
      setStatus('云模型需要API Key；密钥只会保存到系统凭据库。');
      return;
    }
    const selectedModel = probeResult?.models.find((model) => model.name === modelName.trim());
    if (selectedModel === undefined || probeResult === null) {
      setStatus('请先测试连接，并从服务返回的模型中选择。');
      return;
    }
    if (binding.testedRevision !== binding.revision) {
      setStatus('连接配置已变化，请重新测试后保存。');
      return;
    }
    const operationId = ++operationSequence.current;
    const revision = binding.revision;
    activeOperation.current = operationId;
    dispatchBinding({ type: 'SAVE_STARTED', operationId });
    setStatus(null);
    try {
      const saved = await withCredential((credentialRef, credentialAction) =>
        gateway.save({
          presetKey,
          providerDisplayName: displayName.trim(),
          baseUrl: baseUrl.trim(),
          endpointFingerprint: probeResult.endpointFingerprint,
          credentialRef,
          credentialAction,
          modelName: modelName.trim(),
          modelDisplayName: selectedModel.displayName,
          capabilities: selectedModel.capabilities,
          capabilitySource: selectedModel.capabilitySource,
          probeFingerprint: selectedModel.probeFingerprint,
          probeReceiptId: probeResult.receiptId,
          useAsDefault,
          useAsFallback,
        }),
      );
      if (activeOperation.current !== operationId) return;
      setSnapshot(saved);
      setApiKey('');
      setStatus(
        saved.pendingCredentialCleanupCount === 0
          ? '模型设置已保存；现有存档事实未被修改。'
          : '模型设置已保存；旧凭据已停止使用，系统凭据清理将在稍后自动重试。',
      );
      dispatchBinding({ type: 'SAVE_SUCCEEDED', operationId, revision });
    } catch {
      if (activeOperation.current !== operationId) return;
      setStatus('模型设置未保存，请检查输入后重试。');
      dispatchBinding({ type: 'SAVE_FAILED', operationId, revision });
    } finally {
      if (activeOperation.current === operationId) activeOperation.current = null;
    }
  }

  async function forgetCredential(profileId: string) {
    const accepted = window.confirm(
      '删除后，该Provider的已保存API Key会从系统安全凭据库移除；模型配置仍会保留。确定继续吗？',
    );
    if (!accepted) return;
    setCredentialBusy(true);
    setStatus(null);
    try {
      const updated = await gateway.forgetCredential(profileId);
      setSnapshot(updated);
      setStatus(
        updated.pendingCredentialCleanupCount === 0
          ? '已删除该Provider的系统凭据；模型配置仍保留。'
          : '该Provider已停止使用原凭据；系统安全凭据清理将在稍后自动重试。',
      );
    } catch {
      setStatus('无法更新本地凭据状态，请稍后重试。');
    } finally {
      setCredentialBusy(false);
    }
  }

  async function refreshCredentialHealth() {
    setCredentialBusy(true);
    setStatus(null);
    try {
      const updated = await gateway.load();
      setSnapshot(updated);
      setStatus(
        updated.pendingCredentialCleanupCount === 0
          ? '系统凭据清理队列已恢复健康。'
          : `系统凭据库仍不可完成清理，${updated.pendingCredentialCleanupCount} 项将在稍后重试。`,
      );
    } catch {
      setStatus('无法检查系统凭据健康状态，请稍后重试。');
    } finally {
      setCredentialBusy(false);
    }
  }

  return (
    <main className="model-settings">
      <header>
        <p className="eyebrow">{playerText.coreUi.modelWorkshop}</p>
        <h1>设置</h1>
        <p>配置模型服务、默认模型与备用模型。API Key只保存到系统凭据库。</p>
      </header>
      <section className="model-settings__privacy" aria-label="隐私与联网说明">
        <h2>隐私与联网</h2>
        <p>{playerText.coreUi.modelPrivacySummary}</p>
        <p>
          “测试连接”会向所选Base URL发送API
          Key（若填写）并读取模型列表；自定义地址就是本次连接的数据接收方。远程地址只允许HTTPS，本机回环服务可使用HTTP。
        </p>
        <p>
          当前候选尚未启用云端游戏生成。未来启用云生成或跨服务商切换时，发送必要游戏上下文前必须另行确认。
        </p>
      </section>
      <section className="model-settings__panel" aria-label="模型配置">
        <p data-testid="api-binding-phase">
          连接状态：{playerText.coreUi.apiBindingPhase(binding.phase)}
        </p>
        <label>
          {playerText.coreUi.connectionProfileLabel}
          <select
            value={presetKey}
            disabled={binding.phase === 'saving'}
            onChange={(event) => choosePreset(event.target.value as PresetKey)}
          >
            {CONNECTION_PROFILES.map((profile) => (
              <option key={profile.key} value={profile.key}>
                {profile.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          配置名称
          <input
            value={displayName}
            disabled={binding.phase === 'saving'}
            onChange={(event) => {
              setDisplayName(event.target.value);
              configurationChanged();
            }}
          />
        </label>
        <label>
          Base URL
          <input
            value={baseUrl}
            disabled={binding.phase === 'saving'}
            readOnly={selectedProfile.endpointMode === 'FIXED'}
            onChange={(event) => {
              setBaseUrl(event.target.value);
              configurationChanged();
            }}
          />
        </label>
        <label>
          {hasMatchingStoredCredential ? '替换 API Key（留空则保留）' : 'API Key'}
          <input
            type="password"
            autoComplete="off"
            value={apiKey}
            disabled={selectedProfile.credentialMode === 'NONE' || binding.phase === 'saving'}
            onChange={(event) => {
              setApiKey(event.target.value);
              configurationChanged();
            }}
          />
        </label>
        <div className="model-settings__credential-tools">
          <button
            type="button"
            disabled={apiKey.length === 0 || binding.phase === 'saving'}
            onClick={() => {
              setApiKey('');
              configurationChanged();
            }}
          >
            清空未保存的 Key
          </button>
          <span>Key仅作为临时输入；保存后界面不会回显。</span>
        </div>
        <label>
          模型
          <input
            list="provider-models"
            value={modelName}
            disabled={binding.phase === 'saving'}
            onChange={(event) => {
              setModelName(event.target.value);
              dispatchBinding({ type: 'MODEL_CHOSEN' });
            }}
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
              disabled={binding.phase === 'saving'}
              onChange={(event) => setUseAsDefault(event.target.checked)}
            />
            默认模型
          </label>
          <label>
            <input
              type="checkbox"
              checked={useAsFallback}
              disabled={binding.phase === 'saving'}
              onChange={(event) => setUseAsFallback(event.target.checked)}
            />
            备用模型
          </label>
        </div>
        <div className="model-settings__actions">
          <button
            type="button"
            disabled={binding.phase === 'testing' || binding.phase === 'saving'}
            onClick={() => void probe()}
          >
            测试连接并列出模型
          </button>
          {binding.phase === 'testing' ? (
            <button type="button" onClick={cancelProbe}>
              取消测试
            </button>
          ) : null}
          <button
            type="button"
            className="primary-action"
            disabled={binding.phase === 'testing' || binding.phase === 'saving'}
            onClick={() => void save()}
          >
            保存设置
          </button>
        </div>
        {status === null ? null : <p role="status">{status}</p>}
      </section>
      <section className="model-settings__saved" aria-label="已保存模型">
        <h2>已保存模型</h2>
        {snapshot !== null && snapshot.pendingCredentialCleanupCount > 0 ? (
          <div className="model-settings__credential-warning" role="alert">
            <strong>凭据清理待重试：{snapshot.pendingCredentialCleanupCount} 项</strong>
            <span>旧引用已停止使用；系统将在读取设置时继续尝试从安全凭据库删除。</span>
            <button
              type="button"
              disabled={credentialBusy || binding.phase === 'saving'}
              onClick={() => void refreshCredentialHealth()}
            >
              重试并检查凭据健康
            </button>
          </div>
        ) : snapshot === null ? null : (
          <p className="model-settings__credential-health">凭据清理健康：无待处理项</p>
        )}
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
                <span>{getConnectionProfile(profile.presetKey).name}</span>
                {profile.baseUrl === null ? null : <span>{profile.baseUrl}</span>}
                <span>
                  {profile.presetKey === 'ollama'
                    ? '凭据状态：本地服务无需 Key'
                    : profile.hasCredential
                      ? '凭据状态：已保存引用，需连接测试确认当前可用性'
                      : '凭据状态：未保存'}
                </span>
                {profile.capabilities === null ? null : (
                  <span>最近连接测试：{profile.capabilities.checkedAt}</span>
                )}
                {snapshot.defaultModelProfileId === profile.id ? <em>默认</em> : null}
                {snapshot.fallbackModelProfileId === profile.id ? <em>备用</em> : null}
                {profile.hasCredential ? (
                  <button
                    className="danger-action danger-action--small"
                    type="button"
                    disabled={credentialBusy || binding.phase === 'saving'}
                    onClick={() => void forgetCredential(profile.id)}
                  >
                    删除已保存凭据
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

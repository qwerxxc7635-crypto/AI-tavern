import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';

import {
  sessionContextInspectorGateway,
  type ContextInspectorGateway,
  type ContextInspectorSnapshot,
} from './context-inspector-service.js';
import { tauriVersionGateway, type VersionGateway } from './version-service.js';
import { RELEASE_INFO } from './generated-release-info.js';
import { playerText } from './localization/index.js';
import {
  tauriRandomnessSettingsGateway,
  type RandomnessProfile,
  type RandomnessSettingsGateway,
  type RandomnessSettingsSnapshot,
} from './randomness-settings-service.js';

export const MY_SECTIONS = [
  { id: 'api', label: 'API', description: '连接与模型档案' },
  { id: 'routing', label: '默认与备用', description: '任务路由与切换策略' },
  { id: 'generation', label: '生成参数', description: '采样、长度与超时' },
  { id: 'deepseek-cache', label: 'DeepSeek 缓存', description: '稳定前缀与缓存观测' },
  { id: 'context', label: '上下文', description: '预算、来源与装配清单' },
  { id: 'privacy', label: '隐私', description: '联网、凭据与诊断边界' },
  { id: 'version', label: '版本与更新记录', description: '版本、渠道与变更说明' },
] as const;

export function MyPage({
  versionGateway = tauriVersionGateway,
  randomnessGateway = tauriRandomnessSettingsGateway,
  contextInspectorGateway = sessionContextInspectorGateway,
}: {
  readonly versionGateway?: VersionGateway;
  readonly randomnessGateway?: RandomnessSettingsGateway;
  readonly contextInspectorGateway?: ContextInspectorGateway;
}) {
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void versionGateway
      .getVersion()
      .then((value) => {
        if (active) setVersion(value);
      })
      .catch(() => {
        if (active) setVersion('不可用');
      });
    return () => {
      active = false;
    };
  }, [versionGateway]);

  return (
    <main className="my-hub">
      <header className="my-hub__header">
        <p className="eyebrow">{playerText.coreUi.localProfile}</p>
        <h1>我的</h1>
        <p>管理只属于这台设备的模型连接与应用偏好；游戏事实仍保存在各自的 SQLite 存档中。</p>
      </header>

      <div className="my-hub__layout">
        <nav className="my-hub__sections" aria-label="我的页面分区">
          {MY_SECTIONS.map(({ id, label, description }) => (
            <a key={id} href={`#${id}`}>
              <strong>{label}</strong>
              <span>{description}</span>
            </a>
          ))}
        </nav>

        <div className="my-hub__content">
          <section id="api" className="my-hub__entry">
            <SectionCopy eyebrow={playerText.coreUi.connectionProfiles} title="API">
              管理本机Provider连接与模型能力登记。API Key只进入系统凭据库，不进入SQLite存档。
            </SectionCopy>
            <NavLink className="quiet-action" to="/settings">
              打开模型设置
            </NavLink>
          </section>

          <section id="routing" className="my-hub__entry">
            <SectionCopy eyebrow={playerText.coreUi.modelRouting} title="默认与备用">
              查看默认模型、任务覆盖和备用模型；跨Provider备用只按模型设置中的明确授权执行。
            </SectionCopy>
          </section>

          <section id="generation" className="my-hub__entry">
            <SectionCopy eyebrow={playerText.coreUi.generationProfile} title="生成参数">
              选择设备级随机性档位；每次请求会读取并冻结对应温度，不影响本地D20结果。
            </SectionCopy>
            <RandomnessSettingsPanel gateway={randomnessGateway} />
          </section>

          <section id="deepseek-cache" className="my-hub__entry">
            <SectionCopy eyebrow={playerText.coreUi.promptCache} title="DeepSeek 缓存">
              查看稳定Prompt前缀、半稳定上下文和缓存观测；缓存不会成为游戏状态真相源。
            </SectionCopy>
          </section>

          <section id="context" className="my-hub__entry">
            <SectionCopy eyebrow={playerText.coreUi.contextAssembly} title="上下文">
              查看ContextBlock预算、来源、版本与纳入原因；秘密内容默认不在检查器中展示。
            </SectionCopy>
            <ContextInspectorPanel gateway={contextInspectorGateway} />
          </section>

          <section id="privacy" className="my-hub__entry">
            <SectionCopy eyebrow={playerText.coreUi.localFirstBoundaries} title="隐私">
              明确哪些操作会联网、哪些数据会发送，以及存档导出、诊断和凭据的隔离规则。
            </SectionCopy>
          </section>

          <section id="version" className="my-hub__entry">
            <SectionCopy eyebrow={playerText.coreUi.releaseMetadata} title="版本与更新记录">
              查看应用版本、发布渠道、构建信息与本轮变更；版本值由统一发布信息提供。
            </SectionCopy>
            <strong>当前版本：{version ?? '读取中…'}</strong>
            <span>
              发布状态：
              {playerText.coreUi.releaseState(RELEASE_INFO.channel, RELEASE_INFO.status)}
            </span>
            <ul aria-label="当前版本更新记录">
              {RELEASE_INFO.highlights.map((highlight) => (
                <li key={highlight}>{highlight}</li>
              ))}
            </ul>
          </section>
        </div>
      </div>

      <NavLink className="text-link" to="/saves">
        返回存档首页
      </NavLink>
    </main>
  );
}

function ContextInspectorPanel({ gateway }: { readonly gateway: ContextInspectorGateway }) {
  const [snapshot, setSnapshot] = useState<ContextInspectorSnapshot | null>(null);
  const [loaded, setLoaded] = useState(false);

  async function load() {
    try {
      setSnapshot(await gateway.load());
    } finally {
      setLoaded(true);
    }
  }

  useEffect(() => {
    void load();
  }, [gateway]);

  return (
    <div className="context-inspector" aria-label="上下文检查器">
      <div>
        <strong>最近一次实际请求</strong>
        <button type="button" className="quiet-action" onClick={() => void load()}>
          刷新检查器
        </button>
      </div>
      {!loaded ? (
        <p>读取中…</p>
      ) : snapshot === null ? (
        <p>本次会话尚无可检查的 AI 上下文。</p>
      ) : (
        <>
          <p>
            任务：{snapshot.task} · 估算令牌 {snapshot.estimatedTokens} / {snapshot.maxTokens}
          </p>
          <div className="context-inspector__table-wrap">
            <table>
              <thead>
                <tr>
                  <th>块</th>
                  <th>估算令牌</th>
                  <th>来源</th>
                  <th>修订</th>
                  <th>稳定性</th>
                  <th>纳入/省略</th>
                  <th>哈希</th>
                  <th>缓存</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.entries.map((entry) => (
                  <tr key={`${entry.block}:${entry.source}:${entry.revision}:${entry.hash}`}>
                    <td>{entry.block}</td>
                    <td>{entry.token}</td>
                    <td>{entry.source}</td>
                    <td>{entry.revision}</td>
                    <td>{entry.stability}</td>
                    <td>
                      {entry.decision} · {entry.reason}
                    </td>
                    <td>{entry.hash}</td>
                    <td>{entry.cache}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>仅显示清单元数据；秘密内容、完整系统提示与凭据不会在此展示。</p>
        </>
      )}
    </div>
  );
}

const RANDOMNESS_CHOICES: ReadonlyArray<{
  readonly profile: RandomnessProfile;
  readonly label: string;
  readonly description: string;
}> = [
  { profile: 'CONSERVATIVE', label: '稳健', description: '更一致，温度 0.2' },
  { profile: 'BALANCED', label: '平衡', description: '默认档，温度 0.7' },
  { profile: 'HIGH', label: '高随机', description: '更多变化，温度 1.1' },
  { profile: 'CUSTOM', label: '自定义', description: '自行设置 0 至 2' },
];

function RandomnessSettingsPanel({ gateway }: { readonly gateway: RandomnessSettingsGateway }) {
  const [settings, setSettings] = useState<RandomnessSettingsSnapshot | null>(null);
  const [profile, setProfile] = useState<RandomnessProfile>('BALANCED');
  const [customTemperature, setCustomTemperature] = useState(0.9);
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const customTemperatureIsValid =
    Number.isFinite(customTemperature) && customTemperature >= 0 && customTemperature <= 2;

  useEffect(() => {
    let active = true;
    void gateway
      .load()
      .then((loaded) => {
        if (!active) return;
        setSettings(loaded);
        setProfile(loaded.profile);
        if (loaded.customTemperature !== null) setCustomTemperature(loaded.customTemperature);
      })
      .catch(() => {
        if (active) setStatus('无法读取随机性设置。');
      });
    return () => {
      active = false;
    };
  }, [gateway]);

  async function save() {
    setSaving(true);
    setStatus(null);
    try {
      const saved = await gateway.save({
        profile,
        customTemperature: profile === 'CUSTOM' ? customTemperature : null,
      });
      setSettings(saved);
      setStatus(
        `已保存${RANDOMNESS_CHOICES.find((choice) => choice.profile === saved.profile)?.label ?? ''}档。`,
      );
    } catch {
      setStatus('无法保存随机性设置，请重试。');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="generation-profile" aria-label="随机性档位">
      <div className="generation-profile__choices">
        {RANDOMNESS_CHOICES.map((choice) => (
          <label key={choice.profile}>
            <input
              type="radio"
              name="randomness-profile"
              value={choice.profile}
              checked={profile === choice.profile}
              onChange={() => setProfile(choice.profile)}
            />
            <strong>{choice.label}</strong>
            <span>{choice.description}</span>
          </label>
        ))}
      </div>
      {profile === 'CUSTOM' ? (
        <label>
          自定义温度
          <input
            aria-label="自定义温度"
            type="number"
            min="0"
            max="2"
            step="0.1"
            value={customTemperature}
            onChange={(event) => setCustomTemperature(event.currentTarget.valueAsNumber)}
          />
        </label>
      ) : null}
      <p>当前实际温度：{settings?.temperature ?? '读取中…'}</p>
      <button
        type="button"
        disabled={saving || (profile === 'CUSTOM' && !customTemperatureIsValid)}
        onClick={() => void save()}
      >
        {saving ? '保存中…' : '保存随机性设置'}
      </button>
      {status === null ? null : <p role="status">{status}</p>}
    </div>
  );
}

function SectionCopy({
  eyebrow,
  title,
  children,
}: Readonly<{ eyebrow: string; title: string; children: string }>) {
  return (
    <div>
      <p className="eyebrow">{eyebrow}</p>
      <h2>{title}</h2>
      <p>{children}</p>
    </div>
  );
}

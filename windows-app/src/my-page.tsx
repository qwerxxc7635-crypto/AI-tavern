import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';

import { tauriVersionGateway, type VersionGateway } from './version-service.js';
import { RELEASE_INFO } from './generated-release-info.js';
import { playerText } from './localization/index.js';

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
}: {
  readonly versionGateway?: VersionGateway;
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
              查看默认模型、任务覆盖和备用模型；跨Provider切换仍需显式披露与确认。
            </SectionCopy>
          </section>

          <section id="generation" className="my-hub__entry">
            <SectionCopy eyebrow={playerText.coreUi.generationProfile} title="生成参数">
              管理temperature、最大输出和超时等设备级默认值；每次请求会冻结实际配置。
            </SectionCopy>
          </section>

          <section id="deepseek-cache" className="my-hub__entry">
            <SectionCopy eyebrow={playerText.coreUi.promptCache} title="DeepSeek 缓存">
              查看稳定Prompt前缀、半稳定上下文和缓存观测；缓存不会成为游戏状态真相源。
            </SectionCopy>
          </section>

          <section id="context" className="my-hub__entry">
            <SectionCopy eyebrow={playerText.coreUi.contextAssembly} title="上下文">
              查看ContextBlock预算、来源、版本与纳入原因；秘密内容默认不在Inspector中展示。
            </SectionCopy>
          </section>

          <section id="privacy" className="my-hub__entry">
            <SectionCopy eyebrow={playerText.coreUi.localFirstBoundaries} title="隐私">
              明确哪些操作会联网、哪些数据会发送，以及存档导出、诊断和凭据的隔离规则。
            </SectionCopy>
          </section>

          <section id="version" className="my-hub__entry">
            <SectionCopy eyebrow={playerText.coreUi.releaseMetadata} title="版本与更新记录">
              查看应用版本、发布渠道、构建信息与本轮变更；版本值由统一ReleaseMetadata提供。
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

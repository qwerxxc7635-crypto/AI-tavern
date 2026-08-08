import { useCallback, useEffect, useRef, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';

import {
  tauriCampaignGateway,
  type CampaignGateway,
  type CampaignSummary,
} from './campaign-gateway.js';
import { tauriSaveTransferGateway, type SaveTransferGateway } from './save-transfer-gateway.js';
import { playerText } from './localization/index.js';

const STATE_LABELS: Readonly<Record<CampaignSummary['state'], string>> = {
  CREATING_WORLD: '构筑世界',
  REVIEWING_WORLD: '确认世界',
  CREATING_CHARACTER: '创建角色',
  GENERATING_TAVERN: '点亮酒馆',
  TAVERN: '酒馆',
  ADVENTURE: '冒险途中',
  SETTLEMENT: '冒险结算',
  GENERATION_FAILED: '等待恢复',
  WAITING_FOR_MODEL: '等待模型',
  RECOVERY_REQUIRED: '需要恢复',
};

interface SaveHomePageProps {
  readonly gateway?: CampaignGateway;
  readonly transferGateway?: SaveTransferGateway;
}

export function SaveHomePage({
  gateway = tauriCampaignGateway,
  transferGateway = tauriSaveTransferGateway,
}: SaveHomePageProps) {
  const navigate = useNavigate();
  const [campaigns, setCampaigns] = useState<readonly CampaignSummary[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const busyIdRef = useRef<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [transferNotice, setTransferNotice] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setError(null);
    const loaded = await gateway.list();
    setCampaigns(loaded);
  }, [gateway]);

  function markBusy(value: string | null) {
    busyIdRef.current = value;
    setBusyId(value);
  }

  useEffect(() => {
    let active = true;
    void gateway
      .list()
      .then((loaded) => {
        if (active) setCampaigns(loaded);
      })
      .catch(() => {
        if (active) setError('暂时无法读取本地存档。请重新启动应用后再试。');
      });
    return () => {
      active = false;
    };
  }, [gateway]);

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | null = null;
    void transferGateway
      .subscribeToArchiveDrops((paths) => {
        if (active) void importDroppedPaths(paths);
      })
      .then((stop) => {
        if (active) unlisten = stop;
        else stop();
      })
      .catch(() => {
        if (active) setError('无法启用文件拖放；仍可使用“导入存档”选择文件。');
      });
    return () => {
      active = false;
      unlisten?.();
    };
  }, [transferGateway]);

  async function createCampaign() {
    markBusy('new');
    try {
      await gateway.create();
      await reload();
    } catch {
      setError('新存档没有创建成功，本地数据未被修改。');
    } finally {
      markBusy(null);
    }
  }

  async function continueCampaign(campaign: CampaignSummary) {
    markBusy(campaign.id);
    try {
      const continued = await gateway.continueCampaign(campaign.id);
      const destination =
        continued.state === 'GENERATION_FAILED' ||
        continued.state === 'WAITING_FOR_MODEL' ||
        continued.state === 'RECOVERY_REQUIRED'
          ? '/recovery'
          : continued.state === 'CREATING_WORLD' || continued.state === 'REVIEWING_WORLD'
            ? '/world'
            : continued.state === 'CREATING_CHARACTER'
              ? '/character/create'
              : continued.state === 'ADVENTURE'
                ? '/adventure'
                : '/tavern';
      navigate(`${destination}?campaignId=${encodeURIComponent(continued.id)}`);
    } catch {
      setError('无法继续该存档。请返回列表后重试。');
      markBusy(null);
    }
  }

  async function archiveCampaign(campaign: CampaignSummary) {
    const accepted = window.confirm('归档后，该存档会从当前列表中移除。确定继续吗？');
    if (!accepted) return;
    markBusy(campaign.id);
    try {
      await gateway.archive(campaign.id);
      await reload();
    } catch {
      setError('存档没有归档成功，本地数据未被修改。');
    } finally {
      markBusy(null);
    }
  }

  async function deleteCampaign(campaign: CampaignSummary) {
    const accepted = window.confirm(
      '永久删除会移除该存档的全部本地数据。应用会先创建完整数据库备份，但请确认已经导出需要保留的 .emtavern 文件。确定继续吗？',
    );
    if (!accepted) return;
    markBusy(`delete:${campaign.id}`);
    try {
      await gateway.deleteCampaign(campaign.id);
      await reload();
      setTransferNotice(`本地存档 ${campaign.id.slice(0, 8)} 已永久删除。`);
    } catch {
      setError('存档没有删除成功，本地数据保持原状。');
    } finally {
      markBusy(null);
    }
  }

  async function chooseImportArchive() {
    setError(null);
    setTransferNotice(null);
    try {
      const path = await transferGateway.chooseImportPath();
      if (path !== null) await importArchive(path);
    } catch {
      setError('无法打开该存档文件；本地数据未被修改。');
    }
  }

  async function importDroppedPaths(paths: readonly string[]) {
    if (busyIdRef.current !== null) return;
    if (paths.length !== 1 || !paths[0]?.toLowerCase().endsWith('.emtavern')) {
      setError('请一次拖入一个 .emtavern 存档文件。');
      return;
    }
    await importArchive(paths[0]);
  }

  async function importArchive(path: string) {
    if (busyIdRef.current !== null) return;
    markBusy('import');
    setError(null);
    setTransferNotice(null);
    try {
      const inspection = await transferGateway.inspect(path);
      let mode: 'CREATE' | 'OVERWRITE' = 'CREATE';
      if (inspection.campaignExists) {
        const accepted = window.confirm(
          `本地已存在存档 ${inspection.campaignId.slice(0, 8)}。覆盖前会创建完整数据库备份，确定继续吗？`,
        );
        if (!accepted) return;
        mode = 'OVERWRITE';
      }
      const imported = await transferGateway.importArchive(path, mode);
      await reload();
      setTransferNotice(
        imported.state === 'ARCHIVED'
          ? `已导入归档存档 ${imported.id.slice(0, 8)}；它仍保留归档状态。`
          : `已导入存档 ${imported.id.slice(0, 8)}，现在可以继续游玩。`,
      );
    } catch {
      setError('导入失败：文件未通过校验或无法写入；本地存档保持原状。');
    } finally {
      markBusy(null);
    }
  }

  async function exportCampaign(campaign: CampaignSummary) {
    if (busyIdRef.current !== null) return;
    markBusy(`export:${campaign.id}`);
    setError(null);
    setTransferNotice(null);
    try {
      const path = await transferGateway.chooseExportPath(`${campaign.id}.emtavern`);
      if (path === null) return;
      await transferGateway.exportArchive(campaign.id, path);
      setTransferNotice(`存档 ${campaign.id.slice(0, 8)} 已导出到所选位置。`);
    } catch {
      setError('导出失败：没有生成正式存档文件，本地游戏数据未被修改。');
    } finally {
      markBusy(null);
    }
  }

  return (
    <main className="save-home">
      <header className="save-home__header">
        <div className="save-home__brand" aria-hidden="true">
          <span />
        </div>
        <div>
          <p className="eyebrow">{playerText.coreUi.localChronicles}</p>
          <h1>选择一段旅程</h1>
          <p>每一页都保存在这台设备的 SQLite 存档中。</p>
        </div>
        <div className="save-home__header-actions">
          <NavLink className="quiet-action" to="/my">
            我的
          </NavLink>
          <button
            className="primary-action"
            type="button"
            disabled={busyId !== null}
            onClick={() => void createCampaign()}
          >
            {busyId === 'new' ? '正在落笔…' : '新建存档'}
          </button>
        </div>
      </header>

      {error === null ? null : (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}

      {transferNotice === null ? null : (
        <p className="transfer-notice" role="status">
          {transferNotice}
        </p>
      )}

      <section className="save-transfer" aria-label="存档导入与导出">
        <div>
          <p className="eyebrow">{playerText.coreUi.portableArchive}</p>
          <h2>迁移你的旅程</h2>
          <p>选择或拖入一个 .emtavern 文件。设备模型与 API Key 不会随存档迁移。</p>
        </div>
        <button
          className="quiet-action"
          type="button"
          disabled={busyId !== null}
          onClick={() => void chooseImportArchive()}
        >
          {busyId === 'import' ? '正在校验…' : '导入存档'}
        </button>
      </section>

      {campaigns === null && error === null ? (
        <section className="save-home__loading" aria-live="polite" aria-busy="true">
          <span className="loading-glyph" aria-hidden="true" />
          <p>正在翻阅本地账册…</p>
        </section>
      ) : null}

      {campaigns?.length === 0 ? (
        <section className="save-home__empty">
          <p className="eyebrow">{playerText.coreUi.noChroniclesYet}</p>
          <h2>炉边还没有你的故事。</h2>
          <p>新建存档后，世界构筑会从这里开始。归档内容仍保留在本地数据库中。</p>
        </section>
      ) : null}

      {campaigns !== null && campaigns.length > 0 ? (
        <section className="save-list" aria-label="本地存档">
          <div className="save-list__heading">
            <p>当前存档</p>
            <span>{campaigns.length.toString().padStart(2, '0')}</span>
          </div>
          {campaigns.map((campaign, index) => (
            <article className="save-card" key={campaign.id}>
              <div className="save-card__number" aria-hidden="true">
                {(index + 1).toString().padStart(2, '0')}
              </div>
              <div className="save-card__copy">
                <p className="save-card__state">{STATE_LABELS[campaign.state]}</p>
                <h2>存档 {campaign.id.slice(0, 8)}</h2>
                <p>
                  最后游玩：
                  <time dateTime={campaign.updatedAt}>{formatLastPlayed(campaign.updatedAt)}</time>
                </p>
              </div>
              <div className="save-card__actions">
                <button
                  className="primary-action primary-action--small"
                  type="button"
                  disabled={busyId !== null}
                  onClick={() => void continueCampaign(campaign)}
                >
                  {busyId === campaign.id ? '正在打开…' : '继续'}
                </button>
                <button
                  className="quiet-action"
                  type="button"
                  disabled={busyId !== null}
                  onClick={() => void exportCampaign(campaign)}
                >
                  {busyId === `export:${campaign.id}` ? '正在导出…' : '导出'}
                </button>
                <button
                  className="quiet-action"
                  type="button"
                  disabled={busyId !== null}
                  onClick={() => void archiveCampaign(campaign)}
                >
                  归档
                </button>
                <button
                  className="danger-action"
                  type="button"
                  disabled={busyId !== null}
                  onClick={() => void deleteCampaign(campaign)}
                >
                  {busyId === `delete:${campaign.id}` ? '正在删除…' : '永久删除'}
                </button>
              </div>
            </article>
          ))}
        </section>
      ) : null}

      <footer className="save-home__footer">
        <span aria-hidden="true" />
        本地离线 · 存档不会发送到模型服务
      </footer>
    </main>
  );
}

function formatLastPlayed(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

import type { CombatCommandEnvelope } from '@ember-tavern/contracts';

import { CombatScreen, type CombatCommandPort } from './combat-screen.js';
import {
  createCombatCommand,
  parseCombatWorld,
  tauriCombatSessionGateway,
  type CombatSessionGateway,
  type CombatSessionSnapshot,
  type CombatWorld,
} from './combat-service.js';
import { loadCombatThemeForWorld, type CombatThemeBinding } from './combat-theme-binding.js';
import { APP_PATHS, campaignRoute } from './navigation.js';

export function CombatPage({
  gateway = tauriCombatSessionGateway,
  loadTheme = loadCombatThemeForWorld,
}: {
  readonly gateway?: CombatSessionGateway;
  readonly loadTheme?: (world: CombatWorld) => Promise<CombatThemeBinding>;
}) {
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const campaignId = search.get('campaignId');
  const world = parseCombatWorld(search.get('world'));
  const [snapshot, setSnapshot] = useState<CombatSessionSnapshot | null>(null);
  const [theme, setTheme] = useState<CombatThemeBinding | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (campaignId === null || world === null) return;
    let active = true;
    setError(null);
    void Promise.all([gateway.start(campaignId, world), loadTheme(world)])
      .then(([loaded, binding]) => {
        if (active) {
          setSnapshot(loaded);
          setTheme(binding);
        }
      })
      .catch(() => {
        if (active) setError('无法载入本地战斗检查点。游戏事实没有被修改。');
      });
    return () => {
      active = false;
    };
  }, [campaignId, gateway, loadTheme, world]);

  const submit = useCallback(
    (command: CombatCommandEnvelope) => {
      if (campaignId === null || world === null || busy) return;
      setBusy(true);
      setError(null);
      void gateway
        .submit(campaignId, world, command)
        .then(setSnapshot)
        .catch(() => {
          setError('战斗指令未能通过本地规则校验，请重试。');
        })
        .finally(() => {
          setBusy(false);
        });
    },
    [busy, campaignId, gateway, world],
  );

  async function finish(destination: string) {
    if (busy || campaignId === null || world === null) return;
    setBusy(true);
    setError(null);
    try {
      await gateway.complete(campaignId, world);
      navigate(destination);
    } catch {
      setError('战斗结果尚未完成本地提交，请重试。');
      setBusy(false);
    }
  }

  if (campaignId === null || world === null) {
    return (
      <main className="system-state" role="alert">
        <p className="eyebrow">战斗链接无效</p>
        <h1>缺少存档或世界类型。</h1>
        <Link className="text-link" to={APP_PATHS.saves}>
          返回存档首页
        </Link>
      </main>
    );
  }
  if (snapshot === null || theme === null) {
    return (
      <main
        className="system-state"
        aria-busy={error === null}
        role={error === null ? undefined : 'alert'}
      >
        <p className="eyebrow">本地战斗</p>
        <h1>{error ?? '正在恢复战斗检查点…'}</h1>
        {error === null ? null : (
          <Link className="text-link" to={campaignRoute(APP_PATHS.adventure, campaignId)}>
            返回冒险
          </Link>
        )}
      </main>
    );
  }

  const commandPort: CombatCommandPort = {
    createCommand: (payload) => createCombatCommand(snapshot, payload),
    submitCommand: submit,
    onAbilitySelected: () => undefined,
  };
  return (
    <div aria-busy={busy}>
      {error === null ? null : (
        <p className="combat-page__error" role="alert">
          {error}
        </p>
      )}
      <CombatScreen viewModel={snapshot.viewModel} commandPort={commandPort} theme={theme} />
      {snapshot.viewModel.result === null ? null : (
        <nav className="combat-page__return" aria-label="战斗后续">
          <button
            className="primary-action"
            type="button"
            disabled={busy}
            onClick={() => void finish(campaignRoute(APP_PATHS.adventure, campaignId))}
          >
            返回冒险
          </button>
          <button
            className="secondary-action"
            type="button"
            disabled={busy}
            onClick={() => void finish(campaignRoute(APP_PATHS.tavern, campaignId))}
          >
            返回酒馆
          </button>
        </nav>
      )}
    </div>
  );
}

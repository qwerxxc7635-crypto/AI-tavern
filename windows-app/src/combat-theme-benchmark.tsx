import { createRoot } from 'react-dom/client';

import { CURRENT_COMBAT_VERSION_SET } from '@ember-tavern/contracts';

import { CombatScreen } from './combat-screen.js';
import type { CombatScreenShellViewModel } from './combat-screen.js';
import { cssVariableForSlot } from './combat-theme-binding.js';

const SUPPORTED_THEMES = new Set([
  'cultivation-default',
  'fantasy-default',
  'scifi-default',
  'urban-default',
]);
const FRAME_ITERATIONS = 30;

declare global {
  interface Window {
    __EMBER_COMBAT_THEME_BENCHMARK__?: CombatThemeBrowserMeasurement;
    __EMBER_COMBAT_THEME_BENCHMARK_ERROR__?: string;
  }
}

interface PublicThemeManifest {
  readonly themeId: string;
  readonly layoutPreset: string;
  readonly assets: Readonly<Record<string, string>>;
}

interface CommonManifest {
  readonly themeId: 'common';
  readonly assets: Readonly<Record<string, string>>;
}

interface AssetManifestEntry {
  readonly theme: string;
  readonly file: string;
  readonly dimensions: readonly [number, number];
}

interface AggregateManifest {
  readonly assets: readonly AssetManifestEntry[];
}

export interface CombatThemeBrowserMeasurement {
  readonly themeId: string;
  readonly themeAssetCount: number;
  readonly commonAssetCount: number;
  readonly loadedAssetCount: number;
  readonly sourceBytes: number;
  readonly decodedRgbaBytes: number;
  readonly themeLoadMs: number;
  readonly renderFrame: {
    readonly iterations: number;
    readonly medianMs: number;
    readonly p95Ms: number;
    readonly maximumMs: number;
  };
  readonly userAgent: string;
  readonly viewport: { readonly width: number; readonly height: number };
}

void runBenchmark().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  window.__EMBER_COMBAT_THEME_BENCHMARK_ERROR__ = message;
  document.body.textContent = `测量失败：${message}`;
});

async function runBenchmark(): Promise<void> {
  const themeId = new URLSearchParams(window.location.search).get('theme') ?? '';
  if (!SUPPORTED_THEMES.has(themeId)) throw new Error('主题标识无效');
  const sourceTheme = themeId.replace(/-default$/u, '');
  const rootPath = '/assets/combat-themes';
  const startedAt = performance.now();
  const [themeManifest, commonManifest, aggregate] = await Promise.all([
    fetchJson<PublicThemeManifest>(`${rootPath}/${themeId}/manifest.json`),
    fetchJson<CommonManifest>(`${rootPath}/common/manifest.json`),
    fetchJson<AggregateManifest>(`${rootPath}/asset-manifest.json`),
  ]);
  if (themeManifest.themeId !== themeId || commonManifest.themeId !== 'common') {
    throw new Error('主题清单身份不一致');
  }

  const assetUrls = [
    ...Object.values(themeManifest.assets).map((path) => `${rootPath}/${themeId}/${path}`),
    ...Object.values(commonManifest.assets).map((path) => `${rootPath}/common/${path}`),
  ];
  const decodedAssets = await Promise.all(
    assetUrls.map(async (url) => {
      const response = await fetch(url, { cache: 'reload' });
      if (!response.ok) throw new Error(`素材加载失败：${response.status}`);
      const blob = await response.blob();
      const bitmap = await createImageBitmap(blob);
      return { bitmap, sourceBytes: blob.size };
    }),
  );
  const themeLoadMs = performance.now() - startedAt;
  const relevantEntries = aggregate.assets.filter(
    (asset) => asset.theme === sourceTheme || asset.theme === 'common',
  );
  const decodedRgbaBytes = relevantEntries.reduce(
    (total, asset) => total + asset.dimensions[0] * asset.dimensions[1] * 4,
    0,
  );
  const sourceBytes = decodedAssets.reduce((total, asset) => total + asset.sourceBytes, 0);

  const mount = document.getElementById('root');
  if (mount === null) throw new Error('测量容器不存在');
  const root = createRoot(mount);
  const binding = {
    themeId,
    layoutPreset: themeManifest.layoutPreset,
    warnings: [],
    cssVariables: Object.fromEntries(
      Object.entries(themeManifest.assets).map(([slot, path]) => [
        cssVariableForSlot(slot as never),
        `url("${rootPath}/${themeId}/${path}")`,
      ]),
    ),
  };
  root.render(
    <CombatScreen
      viewModel={representativeViewModel(0)}
      commandPort={COMMAND_PORT}
      theme={binding}
    />,
  );
  await nextFrame();
  const frameSamples: number[] = [];
  for (let index = 1; index <= FRAME_ITERATIONS; index += 1) {
    const frameStartedAt = performance.now();
    root.render(
      <CombatScreen
        viewModel={representativeViewModel(index)}
        commandPort={COMMAND_PORT}
        theme={binding}
      />,
    );
    await nextFrame();
    frameSamples.push(performance.now() - frameStartedAt);
  }
  frameSamples.sort((left, right) => left - right);

  window.__EMBER_COMBAT_THEME_BENCHMARK__ = Object.freeze({
    themeId,
    themeAssetCount: Object.keys(themeManifest.assets).length,
    commonAssetCount: Object.keys(commonManifest.assets).length,
    loadedAssetCount: decodedAssets.length,
    sourceBytes,
    decodedRgbaBytes,
    themeLoadMs: round(themeLoadMs),
    renderFrame: Object.freeze({
      iterations: FRAME_ITERATIONS,
      medianMs: round(percentile(frameSamples, 0.5)),
      p95Ms: round(percentile(frameSamples, 0.95)),
      maximumMs: round(frameSamples.at(-1) ?? 0),
    }),
    userAgent: navigator.userAgent,
    viewport: Object.freeze({ width: window.innerWidth, height: window.innerHeight }),
  });
  document.body.dataset['benchmarkComplete'] = 'true';

  // Keep decoded bitmaps reachable until the collector has read the measurement.
  window.addEventListener('pagehide', () => {
    for (const asset of decodedAssets) asset.bitmap.close();
  });
}

const COMMAND_PORT = Object.freeze({
  createCommand: () => {
    throw new Error('性能测量不会创建战斗指令');
  },
  submitCommand: () => undefined,
  onAbilitySelected: () => undefined,
});

function representativeViewModel(stateRevision: number): CombatScreenShellViewModel {
  const meter = { current: 72, maximum: 100, textZhCn: '72 / 100' };
  return {
    combatInstanceId: 'theme-performance',
    versions: CURRENT_COMBAT_VERSION_SET,
    stateRevision,
    phaseLabelZhCn: '行动阶段',
    roundLabelZhCn: '第 3 轮',
    activeCombatantId: 'hero',
    timeline: [
      {
        combatantId: 'hero',
        displayNameZhCn: '旅者',
        side: 'PLAYER',
        isExtraTurn: false,
        isCurrent: true,
      },
      {
        combatantId: 'ally',
        displayNameZhCn: '同伴',
        side: 'COMPANION',
        isExtraTurn: false,
        isCurrent: false,
      },
      {
        combatantId: 'enemy',
        displayNameZhCn: '灰烬守卫',
        side: 'HOSTILE',
        isExtraTurn: false,
        isCurrent: false,
      },
    ],
    combatants: [
      combatant('hero', '旅者', 'PLAYER', true, meter),
      combatant('ally', '同伴', 'COMPANION', false, meter),
      combatant('enemy', '灰烬守卫', 'HOSTILE', false, meter),
    ],
    enemyIntents: [
      {
        enemyId: 'enemy',
        enemyDisplayNameZhCn: '灰烬守卫',
        intentLabelZhCn: '攻击',
        targetHintId: 'hero',
        targetHintNameZhCn: '旅者',
      },
    ],
    actions: [
      {
        actionId: 'ability.ember-slash',
        displayNameZhCn: '余烬斩',
        kind: 'ABILITY',
        requiresTarget: true,
        enabled: true,
        legalTargetIds: ['enemy'],
        disabledReasonsZhCn: [],
        abilityUsage: null,
        costPreview: null,
        tooltip: null,
      },
      {
        actionId: 'command.end-turn',
        displayNameZhCn: '结束回合',
        kind: 'END_TURN',
        requiresTarget: false,
        enabled: true,
        legalTargetIds: [],
        disabledReasonsZhCn: [],
        abilityUsage: null,
        costPreview: null,
        tooltip: null,
      },
    ],
    reactionModes: [],
    pendingReaction: null,
    tacticalSettings: [],
    combatLog: [
      {
        eventId: `event-${stateRevision}`,
        sequence: stateRevision,
        kind: 'DAMAGE',
        titleZhCn: '命中',
        detailZhCn: '灰烬守卫受到 18 点伤害。',
      },
    ],
    result: null,
  };
}

function combatant(
  combatantId: string,
  displayNameZhCn: string,
  side: 'PLAYER' | 'COMPANION' | 'HOSTILE',
  isActiveTurn: boolean,
  meter: { readonly current: number; readonly maximum: number; readonly textZhCn: string },
) {
  return {
    combatantId,
    displayNameZhCn,
    side,
    sideLabelZhCn: side === 'HOSTILE' ? '敌方' : '我方',
    stateLabelZhCn: '可行动',
    isActiveTurn,
    health: meter,
    shield: { current: 12, maximum: 30, textZhCn: '12 / 30' },
    actionPoints: { current: 2, maximum: 3, textZhCn: '2 / 3' },
    reactionCharges: { current: 1, maximum: 1, textZhCn: '1 / 1' },
    resources: [],
    statuses: [],
  } as const;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`清单加载失败：${response.status}`);
  return (await response.json()) as T;
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function percentile(sorted: readonly number[], fraction: number): number {
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

import { lazy, Suspense, type ReactNode } from 'react';
import {
  Link,
  Navigate,
  NavLink,
  Outlet,
  Route,
  Routes,
  useLocation,
  useSearchParams,
} from 'react-router-dom';

import { playerText } from './localization/index.js';
import { APP_PATHS, campaignRoute, readRouteContext, type RouteContextKey } from './navigation.js';
import { AppErrorBoundary } from './ui-states.js';

const sectionPages = () => import('./section-pages.js');
const SaveHomePage = lazy(() =>
  import('./save-home-page.js').then(({ SaveHomePage: page }) => ({ default: page })),
);
const WorldCreationPage = lazy(() =>
  import('./world-creation-page.js').then(({ WorldCreationPage: page }) => ({ default: page })),
);
const CharacterCreationPage = lazy(() =>
  import('./character-creation-page.js').then(({ CharacterCreationPage: page }) => ({
    default: page,
  })),
);
const TavernPage = lazy(() =>
  import('./tavern-page.js').then(({ TavernPage: page }) => ({ default: page })),
);
const NpcDialoguePage = lazy(() =>
  import('./npc-dialogue-page.js').then(({ NpcDialoguePage: page }) => ({ default: page })),
);
const QuestsPage = lazy(() =>
  import('./quest-board-page.js').then(({ QuestBoardPage: page }) => ({ default: page })),
);
const AdventurePage = lazy(() =>
  import('./adventure-page.js').then(({ AdventurePage: page }) => ({ default: page })),
);
const CharacterPage = lazy(() =>
  sectionPages().then(({ CharacterPage: page }) => ({ default: page })),
);
const ArchivesPage = lazy(() =>
  import('./archives-page.js').then(({ ArchivesPage: page }) => ({ default: page })),
);
const SettingsPage = lazy(() =>
  import('./model-settings-page.js').then(({ ModelSettingsPage: page }) => ({ default: page })),
);
const MyPage = lazy(() => import('./my-page.js').then(({ MyPage: page }) => ({ default: page })));
const RecoveryPage = lazy(() =>
  import('./recovery-page.js').then(({ RecoveryPage: page }) => ({ default: page })),
);

export const WINDOWS_NAVIGATION = [
  { path: APP_PATHS.tavern, label: playerText.navigation.tavern, marker: 'T' },
  { path: APP_PATHS.quests, label: playerText.navigation.quests, marker: 'Q' },
  { path: APP_PATHS.adventure, label: playerText.navigation.adventure, marker: 'A' },
  { path: APP_PATHS.character, label: playerText.navigation.character, marker: 'C' },
  { path: APP_PATHS.archives, label: playerText.navigation.archives, marker: 'R' },
  { path: APP_PATHS.my, label: playerText.navigation.my, marker: 'M' },
] as const;

export function AppRoutes() {
  return (
    <Routes>
      <Route index element={<Navigate to={APP_PATHS.saves} replace />} />
      <Route
        path="saves"
        element={
          <AppErrorBoundary>
            <Suspense fallback={<AppLoading />}>
              <SaveHomePage />
            </Suspense>
          </AppErrorBoundary>
        }
      />
      <Route element={<RequiredRouteContext required={['campaignId']} />}>
        <Route path="recovery" element={<StandalonePage page={<RecoveryPage />} />} />
        <Route path="world" element={<StandalonePage page={<WorldCreationPage />} />} />
        <Route
          path="character/create"
          element={<StandalonePage page={<CharacterCreationPage />} />}
        />
      </Route>
      <Route element={<AppShell />}>
        <Route element={<RequiredRouteContext required={['campaignId']} />}>
          <Route path="tavern" element={<TavernPage />} />
          <Route path="quests" element={<QuestsPage />} />
          <Route path="adventure" element={<AdventurePage />} />
          <Route path="character" element={<CharacterPage />} />
          <Route path="archives" element={<ArchivesPage />} />
        </Route>
        <Route element={<RequiredRouteContext required={['campaignId', 'npcId']} />}>
          <Route path="npc" element={<NpcDialoguePage />} />
        </Route>
        <Route path="my" element={<MyPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<RouteNotFound />} />
      </Route>
    </Routes>
  );
}

export function AppShell() {
  const location = useLocation();
  const routeContext = readRouteContext(new URLSearchParams(location.search), []);
  const current =
    WINDOWS_NAVIGATION.find(({ path }) => path === location.pathname) ??
    (location.pathname === APP_PATHS.npc
      ? { label: playerText.navigation.npcDialogue }
      : location.pathname === APP_PATHS.settings
        ? { label: playerText.navigation.modelSettings }
        : undefined);
  const campaignId = routeContext.ok ? (routeContext.context.campaignId ?? null) : null;
  const breadcrumbs = breadcrumbsFor(location.pathname, campaignId);

  return (
    <div className="app-frame">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand__mark" aria-hidden="true">
            <span />
          </span>
          <div>
            <p>{playerText.common.brandName}</p>
            <span>{playerText.common.brandSubtitle}</span>
          </div>
        </div>
        <nav className="navigation" aria-label={playerText.navigation.ariaLabel}>
          {WINDOWS_NAVIGATION.map(({ path, label, marker }) => (
            <NavLink key={path} to={campaignId === null ? path : campaignRoute(path, campaignId)}>
              <span className="navigation__marker" aria-hidden="true">
                {marker}
              </span>
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <p className="sidebar__status">
          <span aria-hidden="true" />
          {playerText.common.localOffline}
        </p>
      </aside>

      <div className="workspace">
        <header className="titlebar">
          <div>
            <nav className="breadcrumbs" aria-label="当前位置">
              {breadcrumbs.map((breadcrumb, index) => (
                <span key={breadcrumb.path ?? breadcrumb.label}>
                  {index === 0 ? null : <span aria-hidden="true">/</span>}
                  {breadcrumb.path === undefined ? (
                    <span aria-current="page">{breadcrumb.label}</span>
                  ) : (
                    <Link to={breadcrumb.path}>{breadcrumb.label}</Link>
                  )}
                </span>
              ))}
            </nav>
            <p className="titlebar__title">{current?.label ?? playerText.titlebar.unknownRoute}</p>
          </div>
          <p className="titlebar__mode">
            {campaignId === null
              ? playerText.titlebar.localSession
              : playerText.titlebar.campaign(campaignId.slice(0, 8))}
          </p>
        </header>
        <AppErrorBoundary key={location.pathname}>
          <Suspense fallback={<AppLoading />}>
            <Outlet />
          </Suspense>
        </AppErrorBoundary>
      </div>
    </div>
  );
}

function StandalonePage({ page }: { readonly page: ReactNode }) {
  return (
    <AppErrorBoundary>
      <Suspense fallback={<AppLoading />}>{page}</Suspense>
    </AppErrorBoundary>
  );
}

export function RequiredRouteContext({
  required,
}: {
  readonly required: readonly RouteContextKey[];
}) {
  const [search] = useSearchParams();
  const result = readRouteContext(search, required);
  if (result.ok) return <Outlet />;
  const entity = result.key === 'campaignId' ? '存档' : result.key === 'npcId' ? 'NPC' : '任务';
  return (
    <main className="system-state" role="alert">
      <p className="eyebrow">无法定位页面</p>
      <h1>{result.reason === 'MISSING' ? `链接缺少${entity}信息。` : `${entity}链接无效。`}</h1>
      <p>游戏事实没有被修改。请从存档首页重新进入。</p>
      <Link className="text-link" to={APP_PATHS.saves}>
        返回存档首页
      </Link>
    </main>
  );
}

export function AppLoading() {
  return (
    <main className="system-state" aria-live="polite" aria-busy="true">
      <span className="loading-glyph" aria-hidden="true" />
      <p className="eyebrow">{playerText.loading.eyebrow}</p>
      <h1>{playerText.loading.title}</h1>
      <p>{playerText.loading.description}</p>
    </main>
  );
}

function RouteNotFound() {
  const [search] = useSearchParams();
  const context = readRouteContext(search, []);
  const destination =
    context.ok && context.context.campaignId !== undefined
      ? campaignRoute(APP_PATHS.tavern, context.context.campaignId)
      : APP_PATHS.saves;
  return (
    <main className="system-state">
      <p className="eyebrow">{playerText.routeUnavailable.eyebrow}</p>
      <h1>{playerText.routeUnavailable.title}</h1>
      <p>{playerText.routeUnavailable.description}</p>
      <NavLink className="text-link" to={destination}>
        {destination === APP_PATHS.saves ? '返回存档首页' : playerText.common.backToTavern}
      </NavLink>
    </main>
  );
}

interface Breadcrumb {
  readonly label: string;
  readonly path?: string;
}

function breadcrumbsFor(pathname: string, campaignId: string | null): readonly Breadcrumb[] {
  const withCampaign = (path: string) =>
    campaignId === null ? APP_PATHS.saves : campaignRoute(path, campaignId);
  if (pathname === APP_PATHS.npc) {
    return [
      { label: playerText.navigation.tavern, path: withCampaign(APP_PATHS.tavern) },
      { label: playerText.navigation.npcDialogue },
    ];
  }
  if (pathname === APP_PATHS.adventure) {
    return [
      { label: playerText.navigation.quests, path: withCampaign(APP_PATHS.quests) },
      { label: playerText.navigation.adventure },
    ];
  }
  if (pathname === APP_PATHS.settings) {
    return [
      { label: playerText.navigation.my, path: withCampaign(APP_PATHS.my) },
      { label: playerText.navigation.modelSettings },
    ];
  }
  const current = WINDOWS_NAVIGATION.find(({ path }) => path === pathname);
  return [{ label: current?.label ?? playerText.titlebar.unknownRoute }];
}

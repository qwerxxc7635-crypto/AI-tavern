import { lazy, Suspense } from 'react';
import { Navigate, NavLink, Outlet, Route, Routes, useLocation } from 'react-router-dom';

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
  sectionPages().then(({ ArchivesPage: page }) => ({ default: page })),
);
const SettingsPage = lazy(() =>
  sectionPages().then(({ SettingsPage: page }) => ({ default: page })),
);

export const WINDOWS_NAVIGATION = [
  { path: '/tavern', label: '酒馆', marker: 'T' },
  { path: '/quests', label: '任务', marker: 'Q' },
  { path: '/adventure', label: '冒险', marker: 'A' },
  { path: '/character', label: '角色', marker: 'C' },
  { path: '/archives', label: '档案', marker: 'R' },
  { path: '/settings', label: '设置', marker: 'S' },
] as const;

export function AppRoutes() {
  return (
    <Routes>
      <Route index element={<Navigate to="/saves" replace />} />
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
      <Route
        path="world"
        element={
          <AppErrorBoundary>
            <Suspense fallback={<AppLoading />}>
              <WorldCreationPage />
            </Suspense>
          </AppErrorBoundary>
        }
      />
      <Route
        path="character/create"
        element={
          <AppErrorBoundary>
            <Suspense fallback={<AppLoading />}>
              <CharacterCreationPage />
            </Suspense>
          </AppErrorBoundary>
        }
      />
      <Route element={<AppShell />}>
        <Route path="tavern" element={<TavernPage />} />
        <Route path="npc" element={<NpcDialoguePage />} />
        <Route path="quests" element={<QuestsPage />} />
        <Route path="adventure" element={<AdventurePage />} />
        <Route path="character" element={<CharacterPage />} />
        <Route path="archives" element={<ArchivesPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<RouteNotFound />} />
      </Route>
    </Routes>
  );
}

export function AppShell() {
  const location = useLocation();
  const current =
    WINDOWS_NAVIGATION.find(({ path }) => path === location.pathname) ??
    (location.pathname === '/npc' ? { label: 'NPC 对话' } : undefined);
  const campaignId = new URLSearchParams(location.search).get('campaignId');

  return (
    <div className="app-frame">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand__mark" aria-hidden="true">
            <span />
          </span>
          <div>
            <p>Ember Tavern</p>
            <span>炉火酒馆</span>
          </div>
        </div>
        <nav className="navigation" aria-label="主导航">
          {WINDOWS_NAVIGATION.map(({ path, label, marker }) => (
            <NavLink key={path} to={{ pathname: path, search: location.search }}>
              <span className="navigation__marker" aria-hidden="true">
                {marker}
              </span>
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <p className="sidebar__status">
          <span aria-hidden="true" />
          本地离线
        </p>
      </aside>

      <div className="workspace">
        <header className="titlebar">
          <div>
            <p className="eyebrow">Current room</p>
            <p className="titlebar__title">{current?.label ?? '未知路径'}</p>
          </div>
          <p className="titlebar__mode">
            {campaignId === null ? 'Local session' : `存档 ${campaignId.slice(0, 8)}`}
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

export function AppLoading() {
  return (
    <main className="system-state" aria-live="polite" aria-busy="true">
      <span className="loading-glyph" aria-hidden="true" />
      <p className="eyebrow">Preparing room</p>
      <h1>正在整理桌面…</h1>
      <p>本地内容加载完成后会自动继续。</p>
    </main>
  );
}

function RouteNotFound() {
  return (
    <main className="system-state">
      <p className="eyebrow">Route unavailable</p>
      <h1>这条路还没有点灯。</h1>
      <p>返回酒馆，继续查看当前可用内容。</p>
      <NavLink className="text-link" to="/tavern">
        返回酒馆
      </NavLink>
    </main>
  );
}

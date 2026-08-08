import { lazy, Suspense } from 'react';
import { Navigate, NavLink, Outlet, Route, Routes, useLocation } from 'react-router-dom';

import { playerText } from './localization/index.js';
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
  { path: '/tavern', label: playerText.navigation.tavern, marker: 'T' },
  { path: '/quests', label: playerText.navigation.quests, marker: 'Q' },
  { path: '/adventure', label: playerText.navigation.adventure, marker: 'A' },
  { path: '/character', label: playerText.navigation.character, marker: 'C' },
  { path: '/archives', label: playerText.navigation.archives, marker: 'R' },
  { path: '/my', label: playerText.navigation.my, marker: 'M' },
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
        path="recovery"
        element={
          <AppErrorBoundary>
            <Suspense fallback={<AppLoading />}>
              <RecoveryPage />
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
        <Route path="my" element={<MyPage />} />
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
    (location.pathname === '/npc' ? { label: playerText.navigation.npcDialogue } : undefined);
  const campaignId = new URLSearchParams(location.search).get('campaignId');

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
          {playerText.common.localOffline}
        </p>
      </aside>

      <div className="workspace">
        <header className="titlebar">
          <div>
            <p className="eyebrow">{playerText.titlebar.eyebrow}</p>
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
  return (
    <main className="system-state">
      <p className="eyebrow">{playerText.routeUnavailable.eyebrow}</p>
      <h1>{playerText.routeUnavailable.title}</h1>
      <p>{playerText.routeUnavailable.description}</p>
      <NavLink className="text-link" to="/tavern">
        {playerText.common.backToTavern}
      </NavLink>
    </main>
  );
}

import { schemaVersion } from '@ember-tavern/contracts';
import { Route, Routes } from 'react-router-dom';

const sharedSchema = schemaVersion(1);

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<LaunchScreen />} />
      <Route path="*" element={<RouteNotFound />} />
    </Routes>
  );
}

function LaunchScreen() {
  return (
    <main className="launch-screen">
      <section className="hearth" aria-labelledby="app-title">
        <div className="hearth__glow" aria-hidden="true" />
        <p className="eyebrow">Windows offline client</p>
        <h1 id="app-title">Ember Tavern</h1>
        <p className="subtitle">炉火已点燃，故事正在本地等候。</p>
        <dl className="readiness" aria-label="应用启动状态">
          <div>
            <dt>桌面运行时</dt>
            <dd>Ready</dd>
          </div>
          <div>
            <dt>共享协议</dt>
            <dd>Schema v{sharedSchema}</dd>
          </div>
        </dl>
      </section>
    </main>
  );
}

function RouteNotFound() {
  return (
    <main className="route-message">
      <p className="eyebrow">Route unavailable</p>
      <h1>这条路还没有点灯。</h1>
      <a href="#/">返回炉火旁</a>
    </main>
  );
}

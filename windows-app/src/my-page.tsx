import { NavLink } from 'react-router-dom';

export function MyPage() {
  return (
    <main className="my-hub">
      <header>
        <p className="eyebrow">Local profile</p>
        <h1>我的</h1>
        <p>管理只属于这台设备的模型连接与应用偏好；游戏事实仍保存在各自的 SQLite 存档中。</p>
      </header>
      <section className="my-hub__entry" aria-label="本机设置入口">
        <div>
          <p className="eyebrow">Device settings</p>
          <h2>API 与模型</h2>
          <p>查看当前模型连接、默认模型与备用模型。API Key 不会写入游戏存档。</p>
        </div>
        <NavLink className="quiet-action" to="/settings">
          打开模型设置
        </NavLink>
      </section>
      <NavLink className="text-link" to="/saves">
        返回存档首页
      </NavLink>
    </main>
  );
}

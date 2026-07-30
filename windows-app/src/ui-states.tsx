import { Component, type ReactNode } from 'react';

interface AppErrorBoundaryProps {
  readonly children: ReactNode;
}

interface AppErrorBoundaryState {
  readonly failed: boolean;
}

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  public override state: AppErrorBoundaryState = { failed: false };

  public static getDerivedStateFromError(): AppErrorBoundaryState {
    return { failed: true };
  }

  public override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="system-state" role="alert">
        <p className="eyebrow">Room unavailable</p>
        <h1>这个页面暂时无法打开。</h1>
        <p>游戏数据没有被修改。切换到其他页面后可以再次尝试。</p>
        <a className="text-link" href="#/tavern">
          返回酒馆
        </a>
      </main>
    );
  }
}

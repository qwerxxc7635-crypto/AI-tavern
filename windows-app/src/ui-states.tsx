import { Component, type ReactNode } from 'react';

import { playerText } from './localization/index.js';

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
        <p className="eyebrow">{playerText.pageUnavailable.eyebrow}</p>
        <h1>{playerText.pageUnavailable.title}</h1>
        <p>{playerText.pageUnavailable.description}</p>
        <a className="text-link" href="#/tavern">
          {playerText.common.backToTavern}
        </a>
      </main>
    );
  }
}

import { Component, type ReactNode } from 'react';

import { playerText } from './localization/index.js';
import { ErrorState } from './ui/primitives.js';

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
      <main className="system-state">
        <p className="eyebrow">{playerText.pageUnavailable.eyebrow}</p>
        <ErrorState
          title={playerText.pageUnavailable.title}
          description={playerText.pageUnavailable.description}
          action={
            <a className="text-link" href="#/tavern">
              {playerText.common.backToTavern}
            </a>
          }
        />
      </main>
    );
  }
}

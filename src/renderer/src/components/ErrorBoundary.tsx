import { Component, type ErrorInfo, type ReactNode } from 'react';
import { serializeProject } from '@core/project-io';
import { api } from '../platform';
import { useProject } from '../state/project';

interface State {
  error: Error | null;
}

/** Keeps a UI fault from losing work: shows the error and offers to save a rescue copy. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(error, info.componentStack);
    void api.writeAutosave(serializeProject(useProject.getState().project));
  }

  override render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div className="dialog-backdrop">
        <div className="dialog">
          <div className="dialog-title">Something went wrong</div>
          <div className="dialog-body">
            <p>
              The interface hit an unexpected error. Your project was saved to the recovery file and will be
              offered when the app restarts.
            </p>
            <pre className="monitor" style={{ height: 'auto', maxHeight: 200, whiteSpace: 'pre-wrap' }}>
              {this.state.error.message}
            </pre>
          </div>
          <div className="dialog-footer">
            <button
              className="btn"
              onClick={() =>
                void api.saveFile({
                  suggestedName: 'rescued-project.synthpiano',
                  kind: 'project',
                  data: serializeProject(useProject.getState().project),
                })
              }
            >
              Save a copy…
            </button>
            <button className="btn primary" onClick={() => location.reload()}>
              Reload
            </button>
          </div>
        </div>
      </div>
    );
  }
}

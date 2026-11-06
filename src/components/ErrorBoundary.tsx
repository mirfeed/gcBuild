import { Component, type ErrorInfo, type ReactNode } from 'react';

const PROJECT_KEY = 'gcbuild.project.v1';

interface State {
  error: Error | null;
  stack: string;
}

/** Shows the error instead of a blank page, with a way out if the saved project is what breaks the app. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null, stack: '' };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack);
    this.setState({ stack: info.componentStack ?? '' });
  }

  render() {
    const { error, stack } = this.state;
    if (!error) return this.props.children;
    const report = `${error.name}: ${error.message}\n\n${error.stack ?? ''}\n\nComponent stack:${stack}\n\n${navigator.userAgent}`;
    const resetTeam = () => {
      try {
        const raw = localStorage.getItem(PROJECT_KEY);
        if (raw) localStorage.setItem(`${PROJECT_KEY}.crashed`, raw);
        localStorage.removeItem(PROJECT_KEY);
      } catch {
        // storage unavailable
      }
      location.reload();
    };
    return (
      <div className="crash">
        <h1>Something broke</h1>
        <p>
          <b>{error.name}: {error.message}</b>
        </p>
        <p className="muted">
          Copy the error and send it to whoever maintains the builder. If it happens on every load, reset the current
          team: artifacts, My builds and the teams folder are kept (the old team is saved as <code>{PROJECT_KEY}.crashed</code>).
        </p>
        <div className="row tight">
          <button type="button" className="btn primary" onClick={() => navigator.clipboard?.writeText(report)}>Copy error</button>
          <button type="button" className="btn" onClick={() => location.reload()}>Reload</button>
          <button type="button" className="btn ghost danger" onClick={() => confirm('Reset the current team?') && resetTeam()}>Reset current team</button>
        </div>
        <pre>{report}</pre>
      </div>
    );
  }
}

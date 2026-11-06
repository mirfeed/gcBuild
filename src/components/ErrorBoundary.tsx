import { Component, type ErrorInfo, type ReactNode } from 'react';
import { generateConfig } from '../lib/config';
import { openReport, reportText, type ReportInput } from '../lib/report';
import { normalizeProject } from '../lib/rotation';
import type { Project } from '../lib/types';

const PROJECT_KEY = 'gcbuild.project.v1';

interface State {
  error: Error | null;
  stack: string;
  copied: boolean;
}

/** The saved team as a gcsim config (or the raw saved JSON if that is what breaks). */
function savedConfig(): string | undefined {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(PROJECT_KEY);
    return raw ? generateConfig(normalizeProject(JSON.parse(raw) as Project)) : undefined;
  } catch {
    return raw ? `# could not generate the config, saved project:\n${raw}` : undefined;
  }
}

/** Shows the error instead of a blank page, with a bug report and a way out if the saved project is what breaks. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null, stack: '', copied: false };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack);
    this.setState({ stack: info.componentStack ?? '' });
  }

  render() {
    const { error, stack, copied } = this.state;
    if (!error) return this.props.children;
    const report: ReportInput = {
      error: `${error.name}: ${error.message}`,
      details: `${error.stack ?? ''}\n\nComponent stack:${stack}`,
      config: savedConfig(),
    };
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
    const copy = async () => {
      await navigator.clipboard?.writeText(await reportText(report));
      this.setState({ copied: true });
    };
    return (
      <div className="crash">
        <h1>Something broke</h1>
        <p>
          <b>{report.error}</b>
        </p>
        <p className="muted">
          <b>Report on GitHub</b> opens a new issue with the error, versions and your current team&apos;s config already
          filled in: add a line about what you clicked and submit. No GitHub account? <b>Copy report</b> and send the
          text to the author.
        </p>
        <p className="muted">
          If it happens on every load, reset the current team: artifacts, My builds and the teams folder are kept (the
          old team is saved as <code>{PROJECT_KEY}.crashed</code>).
        </p>
        <div className="row tight">
          <button type="button" className="btn primary" onClick={() => openReport(`Crash: ${report.error}`.slice(0, 120), report)}>Report on GitHub</button>
          <button type="button" className="btn" onClick={copy}>{copied ? 'Copied ✓' : 'Copy report'}</button>
          <button type="button" className="btn" onClick={() => location.reload()}>Reload</button>
          <button type="button" className="btn ghost danger" onClick={() => confirm('Reset the current team?') && resetTeam()}>Reset current team</button>
        </div>
        <pre>{`${report.error}\n\n${report.details}`}</pre>
      </div>
    );
  }
}

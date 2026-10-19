import { useEffect, useState } from 'react';
import { generateConfig } from '../lib/config';
import type { Project } from '../lib/types';

interface TeamFile {
  name: string;
  modified: number;
}

async function call<T>(route: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/teams/${route}`, body === undefined
    ? undefined
    : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({ error: `error ${res.status}` }));
  if (!res.ok) throw new Error(data.error ?? `error ${res.status}`);
  return data as T;
}

/** Teams saved to the project's teams/ folder (project JSON + gcsim config .txt). */
export function TeamsPanel({ project, onLoad, onClose }: { project: Project; onLoad: (p: Project) => void; onClose: () => void }) {
  const [teams, setTeams] = useState<TeamFile[]>([]);
  const [dir, setDir] = useState('');
  const [name, setName] = useState(project.name);
  const [msg, setMsg] = useState<string | null>(null);

  const refresh = () =>
    call<{ dir: string; teams: TeamFile[] }>('list').then(
      (r) => { setTeams(r.teams); setDir(r.dir); },
      (e) => setMsg(`Could not read the teams folder: ${(e as Error).message}. Run the app with npm run dev.`),
    );

  useEffect(() => { refresh(); }, []);

  const save = async () => {
    const n = name.trim() || 'team';
    if (teams.some((t) => t.name === n) && !confirm(`Overwrite "${n}"?`)) return;
    try {
      const r = await call<{ name: string; path: string }>('save', { name: n, project: { ...project, name: n }, config: generateConfig({ ...project, name: n }) });
      setMsg(`Saved to ${r.path}`);
      refresh();
    } catch (e) {
      setMsg(`Could not save: ${(e as Error).message}`);
    }
  };

  return (
    <section className="panel library">
      <div className="panel-head">
        <h2>Teams</h2>
        <span className="muted small">{dir ? <>saved in <code>{dir}</code> (project .gcbuild.json + gcsim config .txt)</> : 'teams/ folder of the project'}</span>
        <span className="grow" />
        <input className="lib-search" value={name} onChange={(e) => setName(e.target.value)} placeholder="team name" />
        <button type="button" className="btn primary small" onClick={save}>Save current team</button>
        <button type="button" className="icon-btn" onClick={onClose} title="Close">✕</button>
      </div>
      {msg && <div className="hint small lib-result">{msg}</div>}
      {teams.length ? (
        <table className="sim-table small">
          <tbody>
            {teams.map((t) => (
              <tr key={t.name}>
                <td><b>{t.name}</b></td>
                <td className="muted">{new Date(t.modified).toLocaleString()}</td>
                <td style={{ textAlign: 'right' }}>
                  <button
                    type="button"
                    className="btn ghost small"
                    onClick={async () => {
                      try {
                        onLoad(await call<Project>('load', { name: t.name }));
                        setMsg(`Loaded "${t.name}".`);
                      } catch (e) {
                        setMsg(`Could not load: ${(e as Error).message}`);
                      }
                    }}
                  >
                    Load
                  </button>{' '}
                  <button
                    type="button"
                    className="btn ghost small danger"
                    onClick={async () => {
                      if (!confirm(`Delete "${t.name}" from the teams folder?`)) return;
                      await call('delete', { name: t.name }).catch(() => {});
                      refresh();
                    }}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="muted small">No saved teams yet.</div>
      )}
    </section>
  );
}

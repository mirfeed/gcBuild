import { useEffect, useState } from 'react';
import { generateConfig } from '../lib/config';
import type { Project } from '../lib/types';
import { t } from '../i18n';

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
      (e) => setMsg(t('Could not read the teams folder: {error}. Run the app with start.bat.', { error: (e as Error).message })),
    );

  useEffect(() => { refresh(); }, []);

  const save = async () => {
    const n = name.trim() || 'team';
    if (teams.some((tm) => tm.name === n) && !confirm(t('Overwrite "{name}"?', { name: n }))) return;
    try {
      const r = await call<{ name: string; path: string }>('save', { name: n, project: { ...project, name: n }, config: generateConfig({ ...project, name: n }) });
      setMsg(t('Saved to {path}', { path: r.path }));
      refresh();
    } catch (e) {
      setMsg(t('Could not save: {error}', { error: (e as Error).message }));
    }
  };

  return (
    <section className="panel library">
      <div className="panel-head">
        <h2>{t('Teams')}</h2>
        <span className="muted small">{dir ? <>{t('saved in')} <code>{dir}</code> {t('(project .gcbuild.json + gcsim config .txt)')}</> : t('teams/ folder of the project')}</span>
        <span className="grow" />
        <input className="lib-search" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('team name')} />
        <button type="button" className="btn primary small" onClick={save}>{t('Save current team')}</button>
        <button type="button" className="icon-btn" onClick={onClose} title={t('Close')}>✕</button>
      </div>
      {msg && <div className="hint small lib-result">{msg}</div>}
      {teams.length ? (
        <table className="sim-table small">
          <tbody>
            {teams.map((tm) => (
              <tr key={tm.name}>
                <td><b>{tm.name}</b></td>
                <td className="muted">{new Date(tm.modified).toLocaleString()}</td>
                <td style={{ textAlign: 'right' }}>
                  <button
                    type="button"
                    className="btn ghost small"
                    onClick={async () => {
                      try {
                        onLoad(await call<Project>('load', { name: tm.name }));
                        setMsg(t('Loaded "{name}".', { name: tm.name }));
                      } catch (e) {
                        setMsg(t('Could not load: {error}', { error: (e as Error).message }));
                      }
                    }}
                  >
                    {t('Load')}
                  </button>{' '}
                  <button
                    type="button"
                    className="btn ghost small danger"
                    onClick={async () => {
                      if (!confirm(t('Delete "{name}" from the teams folder?', { name: tm.name }))) return;
                      await call('delete', { name: tm.name }).catch(() => {});
                      refresh();
                    }}
                  >
                    {t('Delete')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="muted small">{t('No saved teams yet.')}</div>
      )}
    </section>
  );
}

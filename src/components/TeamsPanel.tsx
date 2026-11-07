import { useEffect, useState } from 'react';
import { t } from '../i18n';
import { generateConfig } from '../lib/config';
import { toGroup, type Group } from '../lib/store';
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

interface Props {
  group: Group;
  /** replace the whole group with a saved one */
  onLoadGroup: (g: Group) => void;
  /** add saved team(s) to the current group as new tabs */
  onAddTeams: (teams: Project[]) => void;
  onRenameGroup: (name: string) => void;
  onClose: () => void;
}

/**
 * Teams folder: one file per saved group (<name>.gcbuild.json; a single team is saved as a plain project, as
 * before) plus one gcsim config .txt per team.
 */
export function TeamsPanel({ group, onLoadGroup, onAddTeams, onRenameGroup, onClose }: Props) {
  const multi = group.teams.length > 1;
  const [teams, setTeams] = useState<TeamFile[]>([]);
  const [dir, setDir] = useState('');
  const [name, setName] = useState(multi ? group.name : group.teams[0].name);
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
      const data = multi ? { ...group, format: 'gcbuild-group', name: n } : { ...group.teams[0], name: n };
      const configs = (multi ? group.teams : [{ ...group.teams[0], name: n }]).map((p, i) => ({
        label: multi ? `${i + 1}. ${p.name || t('Team {n}', { n: i + 1 })}` : '',
        text: generateConfig(p),
      }));
      const r = await call<{ name: string; path: string }>('save', { name: n, project: data, config: configs[0].text, configs: multi ? configs : undefined });
      if (multi) onRenameGroup(n);
      setMsg(t('Saved to {path}', { path: r.path }));
      refresh();
    } catch (e) {
      setMsg(t('Could not save: {error}', { error: (e as Error).message }));
    }
  };

  const fetchGroup = async (fileName: string) => {
    const g = toGroup(await call<unknown>('load', { name: fileName }), fileName);
    if (!g) throw new Error(t('not a gcBuild project'));
    return g;
  };

  return (
    <section className="panel library">
      <div className="panel-head">
        <h2>{t('Teams')}</h2>
        <span className="muted small">{dir ? <>{t('saved in')} <code>{dir}</code></> : t('teams/ folder of the project')}</span>
        <span className="grow" />
        <input className="lib-search" value={name} onChange={(e) => setName(e.target.value)} placeholder={multi ? t('group name') : t('team name')} />
        <button type="button" className="btn primary small" onClick={save}>
          {multi ? t('Save the group ({n} teams)', { n: group.teams.length }) : t('Save current team')}
        </button>
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
                    title={t('Replace the open teams with this save')}
                    onClick={async () => {
                      try {
                        onLoadGroup(await fetchGroup(tm.name));
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
                    className="btn ghost small"
                    title={t('Add the saved team(s) to the open group as new tabs')}
                    onClick={async () => {
                      try {
                        const g = await fetchGroup(tm.name);
                        onAddTeams(g.teams);
                        setMsg(t('Added {n} team(s) from "{name}".', { n: g.teams.length, name: tm.name }));
                      } catch (e) {
                        setMsg(t('Could not load: {error}', { error: (e as Error).message }));
                      }
                    }}
                  >
                    {t('+ as tab')}
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

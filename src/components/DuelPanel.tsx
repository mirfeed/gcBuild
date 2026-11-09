import { useState } from 'react';
import { getChar, weaponByKey } from '../data';
import { charIcon } from '../data/icons';
import { t } from '../i18n';
import { gcsim } from '../lib/api';
import { codeFromProject, duelApi, DUEL_ITERATIONS, infoFromView, projectFromDuel } from '../lib/duel';
import type { CharBuild, Project } from '../lib/types';
import { Icon } from './Combobox';

interface Props {
  project: Project;
  /** a duel was joined: open its team (a new tab, or the existing one) */
  onJoined: (p: Project) => void;
  onClose: () => void;
}

/**
 * Duels: create a duel code from the open team (squad + conditions), or join a duel with the key the bot gave.
 * The challenge itself is posted in Discord: /duel code:<code>.
 */
export function DuelPanel({ project, onJoined, onClose }: Props) {
  const [mode, setMode] = useState<'base' | 'blind'>('base');
  const [duration, setDuration] = useState(project.options.duration || 90);
  const [code, setCode] = useState('');
  const [copied, setCopied] = useState(false);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [needGcsim, setNeedGcsim] = useState<{ want: string; have: string } | null>(null);

  const team = project.team.filter((b): b is CharBuild => !!b);

  const create = () => {
    setMsg(null);
    setCopied(false);
    try {
      setCode(codeFromProject(project, mode, duration));
    } catch (e) {
      setCode('');
      setMsg(t('Could not create the code: {error}', { error: (e as Error).message }));
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const join = async () => {
    setBusy(true);
    setMsg(null);
    setNeedGcsim(null);
    try {
      const k = key.trim();
      const view = await duelApi.join(k);
      const st = await gcsim.status();
      if (!st.installed || st.release.tag !== view.gcsimVersion) {
        setNeedGcsim({ want: view.gcsimVersion, have: st.installed ? st.release.tag ?? '?' : t('not installed') });
        return;
      }
      onJoined(projectFromDuel(infoFromView(view, k)));
      setKey('');
      onClose();
    } catch (e) {
      setMsg(t('Could not join: {error}', { error: (e as Error).message }));
    } finally {
      setBusy(false);
    }
  };

  const updateGcsim = async () => {
    setBusy(true);
    try {
      await gcsim.download();
    } catch (e) {
      setMsg(t('Could not update gcsim: {error}', { error: (e as Error).message }));
      setBusy(false);
      return;
    }
    setBusy(false);
    await join();
  };

  return (
    <section className="panel library duel-panel">
      <div className="panel-head">
        <h2>⚔ {t('Duels')}</h2>
        <span className="muted small">{t('Same squad for both players: only artifacts and the rotation change. The challenge is posted in Discord.')}</span>
        <span className="grow" />
        <button type="button" className="icon-btn" onClick={onClose} title={t('Close')}>✕</button>
      </div>

      <div className="duel-cols">
        <div className="duel-col">
          <h3>{t('Create a duel')}</h3>
          {project.duel ? (
            <div className="muted small">{t('This tab is a duel. Open a normal team to create a duel code from it.')}</div>
          ) : (
            <>
              <div className="muted small">{t('Squad: the open team (characters, levels, constellations, talents, weapons). Edit it in Team above.')}</div>
              <div className="duel-squad">
                {team.length ? team.map((b) => {
                  const c = getChar(b.key);
                  const w = weaponByKey.get(b.weapon.key);
                  return (
                    <span key={b.uid} className="duel-member small">
                      {c && <Icon src={charIcon(c.id)} size={28} className="avatar" />}
                      <span>
                        <b>{c?.name ?? b.key}</b> C{b.cons} · {b.level}
                        <br />
                        <span className="muted">{w?.name ?? b.weapon.key} R{b.weapon.refine}</span>
                      </span>
                    </span>
                  );
                }) : <span className="muted small">{t('the team is empty')}</span>}
              </div>
              <div className="row">
                <span className="seg">
                  <button type="button" className={mode === 'base' ? 'on' : ''} onClick={() => setMode('base')} title={t('Any number of test sims, then submit')}>{t('Base')}</button>
                  <button type="button" className={mode === 'blind' ? 'on' : ''} onClick={() => setMode('blind')} title={t('No test sims: one final sim is the result')}>Blind</button>
                </span>
                <label className="field narrow">
                  <span>{t('Duration, s')}</span>
                  <input type="number" min={10} max={500} value={duration} onChange={(e) => setDuration(Math.max(10, Math.min(500, +e.target.value || 90)))} />
                </label>
                <span className="muted small">{t('Target: DPS dummy (lvl 100, 10% RES)')}</span>
              </div>
              <div className="muted small">
                {mode === 'base' ? t('Base: any number of test sims, then submit.') : t('Blind: no test sims, one final sim is the result.')}{' '}
                {t('15 minutes to submit, {n} iterations.', { n: DUEL_ITERATIONS })}
              </div>
              <div className="row">
                <button type="button" className="btn primary" disabled={!team.length} onClick={create}>{t('Create code')}</button>
              </div>
              {code && (
                <>
                  <div className="row tight">
                    <input className="duel-code grow" readOnly value={code} onFocus={(e) => e.target.select()} />
                    <button type="button" className="btn small" onClick={copy}>{copied ? `✓ ${t('Copied')}` : t('Copy')}</button>
                  </div>
                  <div className="hint small">
                    {t('In the gcBuild Discord:')} <code>/duel code:{code}</code>
                    <br />
                    {t('Add opponent: to challenge someone specific; without it anyone can accept.')}
                  </div>
                </>
              )}
            </>
          )}
        </div>

        <div className="duel-col">
          <h3>{t('Join a duel')}</h3>
          <div className="muted small">{t('After the challenge is accepted the bot gives each player a personal key (button 🔑 under the challenge).')}</div>
          <div className="row tight">
            <input className="duel-code grow" value={key} onChange={(e) => setKey(e.target.value)} placeholder="gcd_…" spellCheck={false} />
            <button type="button" className="btn primary" disabled={busy || !key.trim()} onClick={join}>{busy ? <span className="spinner" /> : t('Join')}</button>
          </div>
          {needGcsim && (
            <div className="hint warn small">
              {t('This duel runs on gcsim {want}, you have {have}.', needGcsim)}{' '}
              <button type="button" className="btn small" disabled={busy} onClick={updateGcsim}>{t('Update gcsim and join')}</button>
            </div>
          )}
        </div>
      </div>
      {msg && <div className="hint warn small lib-result">{msg}</div>}
    </section>
  );
}

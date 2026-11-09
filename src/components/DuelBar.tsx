import { useCallback, useEffect, useRef, useState } from 'react';
import { t } from '../i18n';
import { gcsim } from '../lib/api';
import { duelApi, duelProblems, type DuelView } from '../lib/duel';
import { DUEL_GRACE_SECONDS, DUEL_ITERATIONS } from '../lib/duelCode';
import { needsVerify, verifyDuel } from '../lib/duelWatch';
import type { Artifact, Project } from '../lib/types';

interface Props {
  project: Project;
  /** the duel config (duelConfig(project)) */
  config: string;
  /** every account's artifacts (the team must come from one account, see duelProblems) */
  inventory: Artifact[];
}

const fmtInt = (n: number) => Math.round(n).toLocaleString('en-US');

function clock(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * The duel strip above the team of a duel tab: who against whom, the 15-minute timer (server clock), the submit
 * button, and the result. After both submitted, it re-runs the opponent's config on its own (server/duel.ts); the
 * same re-run also happens in the background when this tab is closed (lib/duelWatch.ts).
 */
export function DuelBar({ project, config, inventory }: Props) {
  const duel = project.duel!;
  const [view, setView] = useState<DuelView | null>(null);
  const [offset, setOffset] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const verifying = useRef(false);
  const autoSubmitted = useRef(false);

  const apply = useCallback((v: DuelView) => {
    setView(v);
    setOffset(v.now - Date.now());
  }, []);

  const refresh = useCallback(async () => {
    try {
      apply(await duelApi.state(duel.key));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [apply, duel.key]);

  // poll the server until the duel is over
  const over = !!view && ['done', 'cancelled', 'expired'].includes(view.state);
  useEffect(() => {
    void refresh();
    if (over) return;
    const id = setInterval(() => void refresh(), 5000);
    return () => clearInterval(id);
  }, [refresh, over]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);

  const serverNow = now + offset;
  const left = view?.deadline ? view.deadline - serverNow : null;
  const canSubmit = !!view && view.state === 'running' && !view.you.submitted && left !== null && left > -DUEL_GRACE_SECONDS * 1000;

  const submit = useCallback(async (auto = false) => {
    setError(null);
    const found = duelProblems(project, config, inventory);
    setProblems(found);
    if (found.length) return;
    if (!auto) {
      const ask = duel.mode === 'blind'
        ? t('Blind duel: this one sim is your result. Run it and submit?')
        : t('Submit this team? After that the artifacts and the rotation are locked.');
      if (!confirm(ask)) return;
    }
    setBusy(t('Final sim ({n} iterations)…', { n: DUEL_ITERATIONS }));
    try {
      const r = await gcsim.run(config);
      const s = r.result.statistics;
      const chars = r.result.character_details.map((c, i) => ({ name: c.name, dps: s.character_dps[i]?.mean ?? 0 }));
      setBusy(t('Sending the result…'));
      apply(await duelApi.submit(duel.key, config, s.dps.mean, s.dps.sd, chars));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }, [apply, config, duel.key, duel.mode, project, inventory]);

  // base mode: time's up and nothing submitted → submit what's there
  useEffect(() => {
    if (duel.mode !== 'base' || autoSubmitted.current || !canSubmit || left === null || left > 0 || busy) return;
    autoSubmitted.current = true;
    void submit(true);
  }, [duel.mode, canSubmit, left, busy, submit]);

  // both submitted: re-run the opponent's config (once)
  useEffect(() => {
    if (!view || verifying.current || busy) return;
    if (!needsVerify(view)) return;
    verifying.current = true;
    setBusy(t("Checking the opponent's result (re-running their config)…"));
    verifyDuel(duel.key).then(apply, (e) => {
      setError((e as Error).message);
      verifying.current = false;
    }).finally(() => setBusy(null));
  }, [view, busy, duel.key, apply]);

  const outcome = view?.outcome;
  const outcomeText = outcome && ({
    win: `🏆 ${t('You won')}`,
    loss: t('You lost'),
    draw: t('Draw'),
    void: t('Not counted'),
    unverified: t('Results not verified'),
  } as const)[outcome.kind];

  const who = (p: DuelView['you'], label: string) => (
    <span className="duel-who">
      <b>{label}</b>{' '}
      {p.dps !== undefined ? <span className="duel-dps">{fmtInt(p.dps)} DPS</span> : p.submitted ? '✓' : view?.state === 'running' ? <span className="muted">{p.joined ? t('working…') : t('not joined')}</span> : null}
      {p.verified === false && <span className="warn"> ✗ {t("re-run didn't match")}</span>}
    </span>
  );

  return (
    <section className={`panel duel-bar ${over ? 'over' : ''}`}>
      <div className="panel-head">
        <h2>⚔ {duel.you} <span className="muted">vs</span> {duel.opponent}</h2>
        <span className="pill small">{duel.mode === 'blind' ? 'Blind' : t('Base')}</span>
        <span className="muted small">{t('{s}s fight, DPS dummy, {n} iterations, gcsim {v}', { s: duel.duration, n: DUEL_ITERATIONS, v: duel.gcsimVersion })}</span>
        <span className="grow" />
        {view?.state === 'running' && left !== null && (
          <span className={`duel-timer ${left < 60_000 ? 'warn' : ''}`}>{left > 0 ? clock(left) : t('time is up')}</span>
        )}
        <button type="button" className="btn primary" disabled={!canSubmit || !!busy} onClick={() => void submit()}>
          {duel.mode === 'blind' ? t('Run the final sim and submit') : t('Submit')}
        </button>
      </div>

      <div className="duel-status small">
        {!view && !error && <span className="muted"><span className="spinner" /> {t('Connecting…')}</span>}
        {view?.state === 'accepted' && <span>{t('Waiting for {name} to join with their key.', { name: duel.opponent })}</span>}
        {view && view.state !== 'accepted' && (
          <>
            {who(view.you, t('You'))}
            {who(view.opponent, duel.opponent)}
          </>
        )}
        {view?.state === 'running' && duel.mode === 'blind' && <span className="muted">{t('Blind: test sims are off. Build the rotation from the estimate timeline.')}</span>}
        {view?.state === 'verifying' && !busy && <span className="muted">{t("Checking: each app re-runs the other's config.")}</span>}
        {outcomeText && <span className="duel-outcome">{outcomeText}{outcome?.reason ? ` · ${outcome.reason}` : ''}</span>}
        {view?.state === 'cancelled' && <span className="muted">{t('The duel was cancelled.')}</span>}
        {view?.state === 'expired' && <span className="muted">{t('The duel expired.')}</span>}
      </div>
      {busy && <div className="hint small"><span className="spinner" /> {busy}</div>}
      {error && <div className="sim-error small">{error}</div>}
      {problems.length > 0 && (
        <div className="hint warn small">
          {t('Not allowed in a duel:')}
          <ul>{problems.map((p) => <li key={p}>{p}</li>)}</ul>
        </div>
      )}
    </section>
  );
}

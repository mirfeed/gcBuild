import { useEffect, useMemo, useState } from 'react';
import { ELEMENT_COLORS, getChar } from '../data';
import { charIcon } from '../data/icons';
import { gcsim, type ErStats, type GcsimStatus, type SimResult } from '../lib/api';
import { applyErFix, applyOptimizedSubs, erVerdicts, teamKeyOf } from '../lib/simfix';
import type { Updater } from '../lib/store';
import type { Project } from '../lib/types';
import { Icon } from './Combobox';

interface Props {
  project: Project;
  update: (fn: Updater) => void;
  config: string;
  result: SimResult | null;
  resultConfig: string | null;
  onResult: (r: Awaited<ReturnType<typeof gcsim.run>>, config: string) => void;
  er: ErStats[] | null;
  setEr: (e: ErStats[] | null) => void;
}

const fmtInt = (n: number) => Math.round(n).toLocaleString('en-US');
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

const FAIL_LABEL: Record<string, string> = {
  insufficient_energy: 'waiting for energy',
  insufficient_stamina: 'waiting for stamina',
  swap_cd: 'waiting for swap',
  skill_cd: 'waiting for E cooldown',
  burst_cd: 'waiting for Q cooldown',
  dash_cd: 'waiting for dash',
};

export function SimPanel({ project, update, config, result, resultConfig, onResult, er, setEr }: Props) {
  const [status, setStatus] = useState<GcsimStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [showSources, setShowSources] = useState(false);

  useEffect(() => {
    gcsim.status().then(setStatus, (e) => setError((e as Error).message));
  }, []);

  const task = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    setNotes([]);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const run = () => task('Running sim…', async () => onResult(await gcsim.run(config), config));
  const checkEr = () => task('Checking energy (24 runs, bursts on cooldown)…', async () => setEr(await gcsim.erCalc(config)));
  const optimize = () => task('gcsim optimizer running…', async () => {
    const out = await gcsim.optimize(config);
    let msgs: string[] = [];
    update((p) => { msgs = applyOptimizedSubs(p, out.config); });
    setNotes(msgs.length ? ['Applied gcsim-optimized substats:', ...msgs] : ['The optimizer returned no substat lines for KQMS characters.']);
  });

  // Ctrl+Enter runs the sim
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && status?.installed && !busy) {
        e.preventDefault();
        run();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const verdicts = useMemo(() => (er ? erVerdicts(project, er) : []), [er, project]);
  const stale = !!result && resultConfig !== config;
  const kqmsCount = project.team.filter((b) => b && b.statsMode !== 'custom').length;

  return (
    <div className="sim-panel">
      <div className="sim-bar">
        <span className={`cli ${status?.installed ? 'ok' : ''}`}>
          {status === null ? 'gcsim: checking…' : status.installed ? (
            <>gcsim <b>{status.release.tag ?? 'CLI'}</b> <code className="muted">{status.version.slice(0, 8)}</code></>
          ) : 'gcsim CLI not installed'}
        </span>
        {status && (
          <button type="button" className="btn ghost small" disabled={!!busy} onClick={() => task('Downloading gcsim…', async () => setStatus(await gcsim.download()))}>
            {status.installed ? 'Update gcsim' : 'Download gcsim'}
          </button>
        )}
        <span className="grow" />
        <button type="button" className="btn primary" disabled={!status?.installed || !!busy} onClick={run} title="Ctrl+Enter">
          ▶ Run sim
        </button>
        <button type="button" className="btn" disabled={!status?.installed || !!busy} onClick={checkEr} title="Runs the rotation with bursts on cooldown and measures how much ER each character needs (gcsim optimizer method)">
          ⚡ Check ER
        </button>
        <button
          type="button"
          className="btn"
          disabled={!status?.installed || !!busy || !kqmsCount}
          onClick={optimize}
          title="gcsim -substatOptim: sim-driven KQMS substats for KQMS characters (overrides the quick heuristic)"
        >
          gcsim substat optimizer
        </button>
      </div>
      {busy && <div className="hint small"><span className="spinner" /> {busy}</div>}
      {error && <div className="sim-error small">{error}</div>}
      {notes.length > 0 && <div className="hint small">{notes.map((n) => <div key={n}>{n}</div>)}</div>}

      {result && (
        <div className={`sim-results ${stale ? 'stale' : ''}`}>
          {stale && <div className="hint warn small">These results are from an earlier version of the config. Run the sim again to refresh.</div>}
          <div className="dps-line">
            <span className="dps-big">{fmtInt(result.statistics.dps.mean)}</span>
            <span className="muted">DPS</span>
            <span className="small muted">
              ± {fmtInt(result.statistics.dps.sd)} · min {fmtInt(result.statistics.dps.min)} · max {fmtInt(result.statistics.dps.max)} ·{' '}
              {result.statistics.duration.mean.toFixed(1)}s · {result.statistics.iterations} iterations
            </span>
          </div>
          {Object.entries(result.statistics.warnings ?? {}).filter(([, v]) => v).length > 0 && (
            <div className="hint warn small">
              gcsim warnings: {Object.entries(result.statistics.warnings).filter(([, v]) => v).map(([k]) => FAIL_LABEL[k] ?? k.replace(/_/g, ' ')).join(', ')}
            </div>
          )}
          <table className="sim-table small">
            <thead>
              <tr>
                <th>Character</th>
                <th>DPS</th>
                <th className="share-col">Share</th>
                <th>Field time</th>
                <th title="Bursts per iteration: mean (min-max). Fewer than planned usually means not enough energy for an 'if burst ready' check.">Q casts</th>
                <th title="Average time per iteration gcsim spent waiting because an action wasn't ready">Waiting</th>
                <th>End energy</th>
                <th>Reactions</th>
              </tr>
            </thead>
            <tbody>
              {result.character_details.map((c, i) => {
                const key = teamKeyOf(c.name);
                const data = getChar(key);
                const dps = result.statistics.character_dps[i]?.mean ?? 0;
                const share = dps / Math.max(1, result.statistics.dps.mean);
                const fails = Object.entries(result.statistics.failed_actions[i] ?? {}).filter(([, v]) => v.mean >= 0.05);
                const rx = Object.entries(result.statistics.source_reactions[i]?.sources ?? {});
                return (
                  <tr key={c.name} style={{ ['--el' as string]: ELEMENT_COLORS[c.element] ?? 'var(--accent)' }}>
                    <td>
                      <span className="who">
                        {data && <Icon src={charIcon(data.id)} size={22} className="avatar" />}
                        {data?.name ?? c.name}
                      </span>
                    </td>
                    <td>{fmtInt(dps)}</td>
                    <td className="share-col"><span className="share"><span style={{ width: pct(share) }} /></span> {pct(share)}</td>
                    <td>{result.statistics.field_time[i]?.mean.toFixed(1)}s</td>
                    <td>
                      {(() => {
                        const q = result.statistics.character_actions?.[i]?.sources.burst;
                        if (!q) return <span className="muted">0</span>;
                        return <>{q.mean.toFixed(2)} <span className="muted">({q.min}-{q.max})</span></>;
                      })()}
                    </td>
                    <td className={fails.length ? 'warn' : 'muted'}>
                      {fails.length ? fails.map(([k, v]) => `${v.mean.toFixed(2)}s ${FAIL_LABEL[k] ?? k}`).join(', ') : '-'}
                    </td>
                    <td>{result.statistics.end_stats[i]?.ending_energy.mean.toFixed(0)}</td>
                    <td>{rx.length ? rx.map(([k, v]) => `${k} ×${v.mean.toFixed(0)}`).join(', ') : <span className="muted">-</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <button type="button" className="btn ghost small" onClick={() => setShowSources((v) => !v)}>
            {showSources ? '▾' : '▸'} damage by source
          </button>
          {showSources && (
            <div className="sources">
              {result.character_details.map((c, i) => {
                const src = Object.entries(result.statistics.source_dps[i]?.sources ?? {}).sort((a, b) => b[1].mean - a[1].mean);
                const total = src.reduce((a, [, v]) => a + v.mean, 0) || 1;
                return (
                  <div key={c.name} className="src-col">
                    <b>{getChar(teamKeyOf(c.name))?.name ?? c.name}</b>
                    {src.slice(0, 10).map(([k, v]) => (
                      <div key={k} className="src-row small">
                        <span className="src-name" title={k}>{k}</span>
                        <span>{fmtInt(v.mean)}</span>
                        <span className="muted">{pct(v.mean / total)}</span>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {er && (
        <div className="er-box">
          <div className="er-head">
            <strong>Energy check</strong>
            <span className="muted small">24 runs with bursts on cooldown. "Needed" is the ER required to have every burst ready (80th percentile, like gcsim's optimizer).</span>
            <span className="grow" />
            <button
              type="button"
              className="btn primary small"
              disabled={!verdicts.some((v) => v.status === 'short' || (v.status === 'surplus' && v.build?.statsMode !== 'custom'))}
              onClick={() => {
                let msgs: string[] = [];
                update((p) => { msgs = applyErFix(p, erVerdicts(p, er)); });
                setNotes(msgs.length ? ['ER fixed:', ...msgs, 'Run the sim again to confirm.'] : ['Nothing to change.']);
              }}
            >
              Fix ER for all
            </button>
            <button type="button" className="icon-btn" onClick={() => setEr(null)} title="Close">✕</button>
          </div>
          <table className="sim-table small">
            <thead>
              <tr><th>Character</th><th>ER now</th><th>Needed (p50 / p80 / max)</th><th>Verdict</th><th /></tr>
            </thead>
            <tbody>
              {verdicts.map((v) => {
                const data = getChar(v.key);
                const subs = Math.abs(v.delta) / 0.0551;
                return (
                  <tr key={v.key}>
                    <td><span className="who">{data && <Icon src={charIcon(data.id)} size={22} className="avatar" />}{data?.name ?? v.key}</span></td>
                    <td>{v.stats.current ? pct(v.stats.current) : v.staticEr ? pct(v.staticEr) : '-'}</td>
                    <td>{v.status === 'no-burst' ? <span className="muted">bursts &lt; 2 in rotation</span> : `${pct(v.stats.needed.p50)} / ${pct(v.stats.needed.p80)} / ${pct(v.stats.needed.max)}`}</td>
                    <td className={v.status === 'short' ? 'warn' : v.status === 'ok' ? 'ok-text' : 'muted'}>
                      {v.status === 'short' && `short ${pct(v.delta)} (≈${Math.ceil(subs)} ER subs)`}
                      {v.status === 'ok' && 'ok'}
                      {v.status === 'surplus' && `surplus ${pct(-v.delta)} (≈${Math.floor(subs)} subs to free)`}
                      {v.status === 'no-burst' && '-'}
                    </td>
                    <td>
                      {(v.status === 'short' || (v.status === 'surplus' && v.build?.statsMode !== 'custom')) && (
                        <button
                          type="button"
                          className="btn ghost small"
                          onClick={() => {
                            let msgs: string[] = [];
                            update((p) => { msgs = applyErFix(p, erVerdicts(p, er), v.key); });
                            setNotes(msgs);
                          }}
                        >
                          {v.build?.statsMode === 'custom' ? 'Add ER to stats' : v.status === 'short' ? 'Raise ER target' : 'Lower ER target'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

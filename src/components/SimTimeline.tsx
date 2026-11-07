import { useMemo, useRef, useState } from 'react';
import { ELEMENT_COLORS } from '../data';
import { charIcon } from '../data/icons';
import { getChar } from '../data';
import type { SampleTimeline, SBar } from '../lib/sample';
import { describeStatus, type StatusInfo } from '../lib/statusNames';
import { useAdvanced } from '../lib/ui';
import { useTimelineNav } from '../lib/useTimelineNav';
import { Icon } from './Combobox';
import { t } from '../i18n';

interface Props {
  tl: SampleTimeline;
}

/** a status bar; team buffs merged from several holders carry how many (n) */
type VBar = SBar & { n?: number };

const STATE_LABEL: Record<string, string> = {
  skill: 'E', burst: 'Q', normal: 'N', charge: 'CA', aim: 'Aim', dash: 'Dash', jump: 'Jump', swap: 'Swap',
  walk: 'Walk', plunge: 'Plunge', idle: 'idle',
};

const REACTION_COLOR: Record<string, string> = {
  vaporize: '#4fb3ff', melt: '#ff9c45', spread: '#9bd441', aggravate: '#c48cff',
};

function rxColor(r: string) {
  if (REACTION_COLOR[r]) return REACTION_COLOR[r];
  if (r.startsWith('swirl')) return '#66d9b8';
  if (r.startsWith('overload')) return '#ff6a6a';
  if (r.startsWith('superconduct')) return '#b4a5ff';
  if (r.startsWith('electro')) return '#c48cff';
  if (r.startsWith('burning')) return '#ff8a3d';
  if (r.includes('bloom') || r.startsWith('burgeon')) return '#7fe08a';
  return '#ffd166';
}

function pack<T extends { start: number; end: number }>(items: T[]): T[][] {
  const rows: T[][] = [];
  const ends: number[] = [];
  for (const b of [...items].sort((x, y) => x.start - y.start || y.end - x.end)) {
    let r = ends.findIndex((e) => e <= b.start);
    if (r < 0) {
      r = rows.length;
      rows.push([]);
      ends.push(0);
    }
    rows[r].push(b);
    ends[r] = b.end;
  }
  return rows;
}

const sec = (f: number) => (f / 60).toFixed(2);
const SHARED = -2;
const ICD_RE = /icd|-cd$|_cd$|cd$/i;
const fmtInt = (n: number) => Math.round(n).toLocaleString('en-US');

export function SimTimeline({ tl }: Props) {
  const [pxPerSec, setPx] = useState(40);
  const [minDur, setMinDur] = useState(0.5);
  const [filter, setFilter] = useState('');
  const [showSel, setShow] = useState({ damage: true, energy: true, hp: true, statuses: true, cooldowns: true, icds: false });
  // simple mode: like the estimate (named effects, E/Q cooldowns), without HP, ICDs and other bookkeeping
  const advanced = useAdvanced();
  const show = advanced ? showSel : { damage: true, energy: true, hp: false, statuses: true, cooldowns: true, icds: false };
  const teamStatuses = show.statuses;
  const effMinDur = advanced ? minDur : 1;
  const teamKeys = useMemo(() => tl.chars.map((c) => c.key), [tl]);
  /** readable name, kind and owner per status key */
  const infos = useMemo(() => {
    const m = new Map<string, StatusInfo>();
    for (const b of tl.bars) if (!m.has(b.key)) m.set(b.key, describeStatus(b.key, teamKeys));
    return m;
  }, [tl, teamKeys]);
  const info = (key: string): StatusInfo => infos.get(key) ?? { label: key, kind: key.startsWith('🛡') ? 'shield' : 'buff', internal: false };
  const [hover, setHover] = useState<{ x: number; frame: number } | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const fit = useTimelineNav(scroller, pxPerSec, setPx, 3, 300);
  const x = (f: number) => (f / 60) * pxPerSec;
  const width = Math.ceil((tl.end / 60 + 1) * pxPerSec);
  const tickEvery = pxPerSec >= 40 ? 1 : pxPerSec >= 20 ? 2 : 5;
  const maxDmg = useMemo(() => Math.max(1, ...tl.damage.map((d) => d.damage)), [tl]);

  /** statuses that land on several characters at once (team buffs) are shown once, on a shared lane */
  const { visibleBars, sharedBars } = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const bars = tl.bars.filter((b) =>
      b.end - b.start >= effMinDur * 60
      && (!q || b.key.toLowerCase().includes(q) || info(b.key).label.toLowerCase().includes(q))
      && (show.icds || !(ICD_RE.test(b.key) || info(b.key).internal)));
    // same key starting together on several characters = one team buff; ends differ by each holder's hitlag
    const sig = (b: SBar) => `${b.key}@${Math.round(b.start / 10)}`;
    const holders = new Map<string, Set<number>>();
    const lastEnd = new Map<string, number>();
    for (const b of bars) {
      if (b.char < 0) continue;
      holders.set(sig(b), (holders.get(sig(b)) ?? new Set()).add(b.char));
      lastEnd.set(sig(b), Math.max(lastEnd.get(sig(b)) ?? 0, b.end));
    }
    const shared: VBar[] = [];
    const seen = new Set<string>();
    let own: VBar[] = [];
    for (const b of bars) {
      if (b.char >= 0 && (holders.get(sig(b))?.size ?? 0) >= 2) {
        if (!seen.has(sig(b))) {
          seen.add(sig(b));
          shared.push({ ...b, char: SHARED, end: lastEnd.get(sig(b))!, n: holders.get(sig(b))!.size });
        }
      } else own.push(b);
    }
    if (!advanced) {
      // the same effect is often tracked twice (a field on the enemy lane + its buff on whoever stands in it): keep one
      const sharedLabels = new Set(shared.map((b) => info(b.key).label));
      own = own.filter((b) => !(b.char < 0 && sharedLabels.has(info(b.key).label)));
      const teamLabels = new Set([...sharedLabels, ...own.filter((b) => b.char < 0).map((b) => info(b.key).label)]);
      own = own.filter((b) => b.char < 0 || !teamLabels.has(info(b.key).label));
    }
    return { visibleBars: own, sharedBars: shared };
  }, [tl, effMinDur, filter, show.icds, advanced, infos]);

  const lanes = useMemo(() => tl.chars.map((c, i) => ({
    i,
    c,
    color: ELEMENT_COLORS[c.element] ?? 'var(--accent)',
    rows: pack(visibleBars.filter((b) => b.char === i)),
    cds: tl.cooldowns.filter((cd) => cd.char === i && cd.end > cd.start),
    dmg: tl.damage.filter((d) => d.char === i),
    energy: tl.energy[i],
    hp: tl.hp[i]?.points.some((p) => p.ratio < 0.999) ? tl.hp[i] : null,
  })), [tl, visibleBars]);

  const teamRows = useMemo(() => pack([
    ...visibleBars.filter((b) => b.char < 0 || b.char >= tl.chars.length),
    ...tl.shields.map((s) => ({ char: -1, key: `🛡 ${s.name}`, start: s.start, end: s.end })),
  ]), [visibleBars, tl]);
  const sharedRows = useMemo(() => pack(sharedBars), [sharedBars]);

  const reactions = useMemo(() => tl.damage.filter((d) => d.reaction), [tl]);

  const hoverInfo = useMemo(() => {
    if (!hover) return null;
    const f = hover.frame;
    return {
      actions: tl.actions.filter((a) => a.start <= f && a.end > f),
      bars: [...sharedBars, ...visibleBars].filter((b) => b.start <= f && b.end > f),
      dmg: tl.damage.filter((d) => Math.abs(d.frame - f) <= Math.max(3, 6 * (60 / pxPerSec))),
      fails: tl.fails.filter((w) => w.start <= f && w.end > f),
      energy: tl.energy.map((e) => {
        let v = e.points[0]?.value ?? 0;
        for (const p of e.points) {
          if (p.frame > f) break;
          v = p.value;
        }
        return { char: e.char, v, max: e.max };
      }),
    };
  }, [hover, tl, visibleBars, sharedBars, pxPerSec]);

  const charColor = (i: number) => (i >= 0 && tl.chars[i] ? ELEMENT_COLORS[tl.chars[i].element] ?? 'var(--accent)' : i === SHARED ? 'var(--buff)' : 'var(--debuff)');
  const charName = (i: number) => (i >= 0 && tl.chars[i] ? tl.chars[i].name : i === SHARED ? t('team') : t('enemy'));

  const barEl = (b: VBar, k: number) => {
    const inf = info(b.key);
    const ownerIdx = inf.owner ? teamKeys.indexOf(inf.owner) : -1;
    const label = `${inf.label}${advanced && b.n ? ` ×${b.n}` : ''}`;
    // a generic "buff" that sits on the enemy is a debuff (RES shred from constellations etc.)
    const kind = b.char === -1 && inf.kind === 'buff' ? 'debuff' : inf.kind;
    return (
      <span
        key={k}
        className={`bar sbar kind-${kind}`}
        style={{ left: x(b.start), width: Math.max(2, x(b.end - b.start)), ['--el' as string]: charColor(ownerIdx >= 0 ? ownerIdx : b.char) }}
        title={`${label}\n${b.key}${b.n ? ` (×${b.n})` : ''} · ${charName(b.char)}\n${sec(b.start)}s → ${sec(b.end)}s (${sec(b.end - b.start)}s)`}
      >
        <span className="bar-label">{label}</span>
      </span>
    );
  };

  const ROW = 20;
  const laneHeight = (l: (typeof lanes)[number]) =>
    (show.damage ? 26 : 0) + (show.energy && l.energy?.points.length ? 22 : 0) + (show.hp && l.hp ? 22 : 0) +
    (show.cooldowns ? 24 : 0) + (show.statuses ? l.rows.length * ROW : 0) + 8;

  return (
    <div className="timeline sim-tl">
      <div className="tl-controls">
        <label className="field inline">
          <span>{t('Zoom')}</span>
          <input type="range" min={3} max={300} value={pxPerSec} onChange={(e) => setPx(+e.target.value)} />
        </label>
        <button type="button" className="btn ghost small" onClick={() => fit(tl.end / 60 + 1)} title={t('Fit the whole sample in view')}>{t('Fit')}</button>
        <span className="muted small">{t('drag to pan · Ctrl+wheel to zoom')}</span>
        <label className="field inline adv" title={t('Hide statuses shorter than this')}>
          <span>{t('Min status')}</span>
          <select value={minDur} onChange={(e) => setMinDur(+e.target.value)}>
            {[0, 0.5, 1, 2, 5].map((v) => <option key={v} value={v}>{v ? `${v}s` : t('all')}</option>)}
          </select>
        </label>
        <input className="tl-filter adv" placeholder={t('filter statuses…')} value={filter} onChange={(e) => setFilter(e.target.value)} />
        {(Object.keys(showSel) as (keyof typeof showSel)[]).map((k) => (
          <label key={k} className="check adv">
            <input type="checkbox" checked={showSel[k]} onChange={(e) => setShow((s) => ({ ...s, [k]: e.target.checked }))} /> {t(k)}
          </label>
        ))}
        <span className="tl-stat small muted">{t('sample: {s}s · {h} hits · {r} reactions', { s: sec(tl.end), h: tl.damage.length, r: reactions.length })}</span>
      </div>

      <div className="tl-body">
        <div className="tl-labels">
          <div className="tl-label ruler-label">{t('time (s)')}</div>
          <div className="tl-label actions-label">{t('Actions')}</div>
          <div className="tl-label lane-label" style={{ ['--el' as string]: 'var(--accent)', height: 34 }}>
            <span className="lane-text"><span className="lane-name">{t('Enemy')}</span><span className="muted small lane-sub">{t('elements · reactions')}</span></span>
          </div>
          {lanes.map((l) => (
            <div key={l.i} className="tl-label lane-label" style={{ ['--el' as string]: l.color, height: laneHeight(l) }}>
              {getChar(l.c.key) && <Icon src={charIcon(getChar(l.c.key)!.id)} size={28} className="avatar" />}
              <span className="lane-text">
                <span className="lane-name">{l.c.name}</span>
                <span className="muted small lane-sub">
                  {[show.damage && t('damage'), show.energy && l.energy?.points.length && t('energy'), show.hp && l.hp && 'HP', show.cooldowns && 'E/Q CD'].filter(Boolean).join(' · ')}
                </span>
              </span>
            </div>
          ))}
          {teamStatuses && sharedRows.length > 0 && (
            <div className="tl-label lane-label" style={{ ['--el' as string]: 'var(--buff)', height: sharedRows.length * ROW + 8 }}>
              <span className="lane-text"><span className="lane-name">{t('Team buffs')}</span><span className="muted small lane-sub">{t('on several characters (×N)')}</span></span>
            </div>
          )}
          {show.statuses && teamRows.length > 0 && (
            <div className="tl-label lane-label" style={{ ['--el' as string]: 'var(--debuff)', height: teamRows.length * ROW + 8 }}>
              <span className="lane-text"><span className="lane-name">{t('Team / enemy')}</span><span className="muted small lane-sub">{t('debuffs · shields · core')}</span></span>
            </div>
          )}
        </div>

        <div
          className="tl-scroll"
          ref={scroller}
          onMouseMove={(e) => {
            const rect = scroller.current!.getBoundingClientRect();
            const px = e.clientX - rect.left + scroller.current!.scrollLeft;
            setHover({ x: px, frame: Math.max(0, Math.round((px / pxPerSec) * 60)) });
          }}
          onMouseLeave={() => setHover(null)}
        >
          <div className="tl-content" style={{ width }}>
            <div className="tl-ruler">
              {Array.from({ length: Math.ceil(tl.end / 60 / tickEvery) + 1 }, (_, i) => (
                <span key={i} className="tick" style={{ left: x(i * tickEvery * 60) }}>{i * tickEvery}</span>
              ))}
            </div>

            <div className="tl-lane actions">
              {tl.actions.map((a, k) => (
                <span
                  key={k}
                  className="step"
                  style={{ left: x(a.start), width: Math.max(2, x(a.end - a.start)), ['--el' as string]: charColor(a.char) }}
                  title={`${charName(a.char)} ${a.state}\n${sec(a.start)}s → ${sec(a.end)}s (${t('{n}f incl. hitlag', { n: a.end - a.start })})`}
                >
                  <span className="step-label">{STATE_LABEL[a.state] ?? a.state}</span>
                </span>
              ))}
              {tl.fails.map((w, k) => (
                <span
                  key={`f${k}`}
                  className="fail-block"
                  style={{ left: x(w.start), width: Math.max(2, x(w.end - w.start)) }}
                  title={t('{what} not ready: waited {s}s', { what: w.what, s: sec(w.end - w.start) })}
                />
              ))}
            </div>

            <div className="tl-lane enemy-lane" style={{ height: 34 }}>
              {tl.applications.map((a, k) => (
                <span
                  key={k}
                  className="app-dot"
                  style={{ left: x(a.frame), background: ELEMENT_COLORS[a.ele] ?? 'var(--muted)' }}
                  title={`${t('{t}s {ele} applied by {who} ({abil})', { t: sec(a.frame), ele: a.ele, who: charName(a.char), abil: a.abil })}\n${t('aura after: {aura}', { aura: a.aura.join(', ') || t('none') })}`}
                />
              ))}
              {reactions.map((d, k) => (
                <span
                  key={`r${k}`}
                  className="rx-badge"
                  style={{ left: x(d.frame), ['--rx' as string]: rxColor(d.reaction) }}
                  title={`${sec(d.frame)}s ${d.reaction}\n${charName(d.char)} · ${d.abil}\n${fmtInt(d.damage)} dmg${d.crit ? ' (crit)' : ''}`}
                >
                  {pxPerSec >= 90 ? d.reaction.slice(0, 3) : ''}
                </span>
              ))}
            </div>

            {lanes.map((l) => (
              <div key={l.i} className="tl-lane-group sim-group" style={{ ['--el' as string]: l.color, height: laneHeight(l) }}>
                {show.damage && (
                  <div className="dmg-strip">
                    {l.dmg.map((d, k) => {
                      const h = 4 + 20 * (Math.log10(d.damage + 1) / Math.log10(maxDmg + 1));
                      return (
                        <span
                          key={k}
                          className={`dmg-tick ${d.reaction ? 'rx' : ''} ${d.crit ? 'crit' : ''}`}
                          style={{ left: x(d.frame), height: h, background: ELEMENT_COLORS[d.ele] ?? 'var(--muted)', ['--rx' as string]: d.reaction ? rxColor(d.reaction) : 'transparent' }}
                          title={`${sec(d.frame)}s ${d.abil}\n${fmtInt(d.damage)} ${d.ele}${d.crit ? ' crit' : ''}${d.reaction ? ` · ${d.reaction}` : ''}`}
                        />
                      );
                    })}
                  </div>
                )}
                {show.energy && l.energy?.points.length ? (
                  <svg className="line-strip" width={width} height={22} preserveAspectRatio="none">
                    <polyline
                      fill="none"
                      stroke="var(--el)"
                      strokeWidth={1.5}
                      points={l.energy.points.map((p, k) => {
                        const prev = l.energy!.points[k - 1];
                        const y = (v: number) => 20 - (18 * v) / Math.max(1, l.energy!.max);
                        return `${prev ? `${x(p.frame)},${y(prev.value)} ` : ''}${x(p.frame)},${y(p.value)}`;
                      }).join(' ')}
                    />
                    <text x={4} y={9} className="line-label">{t('energy')}</text>
                  </svg>
                ) : null}
                {show.hp && l.hp && (
                  <svg className="line-strip" width={width} height={22} preserveAspectRatio="none">
                    <polyline
                      fill="none"
                      stroke="var(--danger)"
                      strokeWidth={1.5}
                      points={l.hp.points.map((p, k) => {
                        const prev = l.hp!.points[k - 1];
                        const y = (v: number) => 20 - 18 * Math.min(1, v);
                        return `${prev ? `${x(p.frame)},${y(prev.ratio)} ` : ''}${x(p.frame)},${y(p.ratio)}`;
                      }).join(' ')}
                    />
                    <text x={4} y={9} className="line-label">HP</text>
                  </svg>
                )}
                {show.cooldowns && (
                  <>
                    {(['skill', 'burst'] as const).map((type) => (
                      <div key={type} className="tl-lane thin">
                        {l.cds.filter((c) => c.type === type).map((c, k) => (
                          <span key={k} className="bar kind-cd" style={{ left: x(c.start), width: Math.max(2, x(c.end - c.start)) }} title={`${type === 'skill' ? 'E' : 'Q'} ${t('cooldown')} ${sec(c.start)}s → ${sec(c.end)}s`}>
                            <span className="bar-label">{type === 'skill' ? 'E CD' : 'Q CD'}</span>
                          </span>
                        ))}
                      </div>
                    ))}
                  </>
                )}
                {show.statuses && l.rows.map((r, k) => (
                  <div key={k} className="tl-lane">{r.map(barEl)}</div>
                ))}
              </div>
            ))}

            {teamStatuses && sharedRows.length > 0 && (
              <div className="tl-lane-group sim-group" style={{ ['--el' as string]: 'var(--buff)', height: sharedRows.length * ROW + 8 }}>
                {sharedRows.map((r, k) => <div key={k} className="tl-lane">{r.map(barEl)}</div>)}
              </div>
            )}
            {show.statuses && teamRows.length > 0 && (
              <div className="tl-lane-group sim-group" style={{ ['--el' as string]: 'var(--debuff)', height: teamRows.length * ROW + 8 }}>
                {teamRows.map((r, k) => <div key={k} className="tl-lane">{r.map(barEl)}</div>)}
              </div>
            )}
            {hover && <span className="cursor-line" style={{ left: hover.x }} />}
          </div>
        </div>
      </div>

      <div className="tl-inspector small">
        {hoverInfo ? (
          <>
            <b>{sec(hover!.frame)}s</b> ({t('frame')} {hover!.frame})
            {hoverInfo.actions.map((a, k) => (
              <span key={k}> · <b style={{ color: charColor(a.char) }}>{charName(a.char)} {a.state}</b></span>
            ))}
            {hoverInfo.fails.map((w, k) => <span key={`f${k}`} className="warn"> · {t('waiting: {what} not ready', { what: w.what })}</span>)}
            <div className="insp-list">
              {hoverInfo.energy.filter((e) => e.max).map((e) => (
                <span key={`e${e.char}`} className="insp" style={{ ['--el' as string]: charColor(e.char) }}>
                  <span className="insp-who">{charName(e.char).split(' ')[0]}</span> {e.v.toFixed(1)}/{e.max} {t('energy')}
                </span>
              ))}
            </div>
            {hoverInfo.dmg.length > 0 && (
              <div className="insp-list">
                {hoverInfo.dmg.slice(0, 8).map((d, k) => (
                  <span key={k} className="insp" style={{ ['--el' as string]: charColor(d.char) }}>
                    <span className="insp-who">{charName(d.char).split(' ')[0]}</span> {d.abil} {fmtInt(d.damage)}{d.crit ? '!' : ''}
                    {d.reaction && <b style={{ color: rxColor(d.reaction) }}> {d.reaction}</b>}
                  </span>
                ))}
              </div>
            )}
            <div className="insp-list">
              {hoverInfo.bars.slice(0, 30).map((b, k) => (
                <span key={k} className="insp kind-buff" style={{ ['--el' as string]: charColor(b.char) }}>
                  <span className="insp-who">{charName(b.char).split(' ')[0]}</span> {info(b.key).label} <span className="muted">{t('{s}s left', { s: sec(b.end - hover!.frame) })}</span>
                </span>
              ))}
            </div>
          </>
        ) : (
          <span className="muted">
            {t('Real timeline from one gcsim iteration (hitlag included). Hover to see actions, energy, damage and reactions at that moment. Coloured ticks are hits; outlined ticks reacted.')}
          </span>
        )}
      </div>
    </div>
  );
}

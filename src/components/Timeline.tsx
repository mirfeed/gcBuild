import { useMemo, useRef, useState } from 'react';
import { ELEMENT_COLORS, getChar } from '../data';
import { charIcon } from '../data/icons';
import { Icon } from './Combobox';
import type { TimelineResult, TLBar, TLStep } from '../lib/timeline';
import { useTimelineNav } from '../lib/useTimelineNav';
import type { Project } from '../lib/types';
import { t } from '../i18n';

interface Props {
  project: Project;
  timeline: TimelineResult;
  selected: string | null;
  onSelect: (id: string) => void;
  loops: number;
  setLoops: (n: number) => void;
}

interface Lane {
  id: string;
  label: string;
  icon?: string;
  color: string;
  rows: { bars: TLBar[]; thin: boolean }[];
}

const KIND_LABEL: Record<string, string> = {
  field: 'Field', buff: 'Buff', debuff: 'Debuff', shield: 'Shield', state: 'State', summon: 'Summon', cd: 'Cooldown',
};

function pack(bars: TLBar[]): TLBar[][] {
  const rows: TLBar[][] = [];
  const ends: number[] = [];
  for (const b of [...bars].sort((x, y) => x.start - y.start || y.end - x.end)) {
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

const ROW_H = 22;
const THIN_H = 12;
const LANE_PAD = 6;
const laneHeight = (l: Lane) => Math.max(ROW_H, l.rows.reduce((h, r) => h + (r.thin ? THIN_H : ROW_H), 0)) + LANE_PAD;

export function Timeline({ project, timeline, selected, onSelect, loops, setLoops }: Props) {
  const [pxPerSec, setPx] = useState(60);
  const [hover, setHover] = useState<{ x: number; frame: number } | null>(null);
  const [showCd, setShowCd] = useState(true);
  const scroller = useRef<HTMLDivElement>(null);
  const fit = useTimelineNav(scroller, pxPerSec, setPx, 5, 300);

  const team = project.team.filter((b) => b && getChar(b.key));
  const lanes = useMemo<Lane[]>(() => {
    const out: Lane[] = [];
    for (const b of team) {
      const c = getChar(b!.key)!;
      const mine = timeline.bars.filter((x) => x.lane === b!.key);
      const eCd = mine.filter((x) => x.kind === 'cd' && x.label === 'E CD');
      const qCd = mine.filter((x) => x.kind === 'cd' && x.label === 'Q CD');
      const rest = mine.filter((x) => !(x.kind === 'cd' && (x.label === 'E CD' || x.label === 'Q CD')));
      const rows: Lane['rows'] = [];
      if (showCd) {
        rows.push({ bars: eCd, thin: true });
        rows.push({ bars: qCd, thin: true });
      }
      for (const r of pack(showCd ? rest : rest.filter((x) => x.kind !== 'cd'))) rows.push({ bars: r, thin: false });
      out.push({ id: b!.key, label: c.name, icon: charIcon(c.id), color: ELEMENT_COLORS[c.element], rows });
    }
    const teamBars = timeline.bars.filter((x) => x.lane === 'team');
    out.push({ id: 'team', label: t('Team / enemy'), color: 'var(--accent)', rows: pack(teamBars).map((r) => ({ bars: r, thin: false })) });
    return out;
  }, [timeline, team, showCd]);

  const endFrame = Math.max(timeline.end, ...timeline.bars.map((b) => b.end), 60);
  const width = Math.ceil((endFrame / 60 + 1) * pxPerSec);
  const x = (f: number) => (f / 60) * pxPerSec;
  const tickEvery = pxPerSec >= 40 ? 1 : pxPerSec >= 20 ? 2 : 5;

  const hoverInfo = useMemo(() => {
    if (!hover) return null;
    const f = hover.frame;
    const step = timeline.steps.find((s) => s.start <= f && s.end > f && !s.skipped);
    const active = timeline.bars.filter((b) => b.start <= f && b.end > f);
    return { step, active };
  }, [hover, timeline]);

  const charColor = (key: string) => {
    const c = getChar(key);
    return c ? ELEMENT_COLORS[c.element] : 'var(--muted)';
  };

  const stepTitle = (s: TLStep) => {
    const c = getChar(s.char);
    return [
      `${c ? c.name + ' · ' : ''}${s.label}`,
      `${sec(s.start)}s → ${sec(s.end)}s (${s.end - s.start}f)`,
      s.waited ? t('waited {s}s before', { s: sec(s.waited) }) : '',
      s.generic ? t('approximate frames (not extracted from gcsim)') : '',
      ...s.warnings,
    ].filter(Boolean).join('\n');
  };

  return (
    <div className="timeline">
      <div className="tl-controls">
        <label className="field inline">
          <span>{t('Zoom')}</span>
          <input type="range" min={5} max={300} value={pxPerSec} onChange={(e) => setPx(+e.target.value)} />
        </label>
        <button type="button" className="btn ghost small" onClick={() => fit(endFrame / 60 + 1)} title={t('Fit the whole timeline in view')}>{t('Fit')}</button>
        <span className="muted small">{t('drag to pan · Ctrl+wheel to zoom')}</span>
        <label className="field inline adv">
          <span>{t('Loops shown')}</span>
          <select value={loops} onChange={(e) => setLoops(+e.target.value)}>
            {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <label className="check adv">
          <input type="checkbox" checked={showCd} onChange={(e) => setShowCd(e.target.checked)} /> {t('cooldowns')}
        </label>
        <span className="tl-stat">
          {timeline.loopLength !== null && <>{t('Loop length')} <b>{sec(timeline.loopLength)}s</b></>}
          <span className="muted"> · {t('total')} {sec(timeline.end)}s</span>
        </span>
        <span className="legend small">
          {['field', 'buff', 'debuff', 'shield', 'state', 'summon', 'cd'].map((k) => (
            <span key={k} className={`lg kind-${k}`}>{t(KIND_LABEL[k])}</span>
          ))}
        </span>
      </div>
      {timeline.warnings.map((w) => <div key={w} className="hint warn small">{w}</div>)}

      <div className="tl-body">
        <div className="tl-labels">
          <div className="tl-label ruler-label">{t('time (s)')}</div>
          <div className="tl-label actions-label">{t('Actions')}</div>
          {lanes.map((l) => (
            <div key={l.id} className="tl-label lane-label" style={{ ['--el' as string]: l.color, height: laneHeight(l) }}>
              {l.icon && <Icon src={l.icon} size={28} className="avatar" />}
              <span className="lane-text">
                <span className="lane-name">{l.label}</span>
                {l.rows[0]?.thin && <span className="muted small lane-sub">{t('E / Q cooldown')}</span>}
              </span>
            </div>
          ))}
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
              {Array.from({ length: Math.ceil(endFrame / 60 / tickEvery) + 1 }, (_, i) => (
                <span key={i} className="tick" style={{ left: x(i * tickEvery * 60) }}>{i * tickEvery}</span>
              ))}
            </div>

            <div className="tl-lane actions">
              {timeline.steps.map((s) => {
                if (s.skipped) {
                  return <span key={s.key} className="skip-mark" style={{ left: x(s.start) }} title={stepTitle(s)}>⤼</span>;
                }
                const waitStart = s.start - s.waited;
                return (
                  <span key={s.key}>
                    {s.waited > 0 && (
                      <span className="wait-block" style={{ left: x(waitStart), width: Math.max(2, x(s.waited)) }} title={t('waiting {s}s', { s: sec(s.waited) })} />
                    )}
                    <span
                      className={`step ${s.char ? '' : 'idle'} ${selected === s.actionId ? 'sel' : ''} ${s.warnings.length ? 'has-warn' : ''} ${s.loop > 0 ? 'later-loop' : ''}`}
                      style={{ left: x(s.start), width: Math.max(3, x(s.end - s.start)), ['--el' as string]: s.char ? charColor(s.char) : 'var(--muted)' }}
                      title={stepTitle(s)}
                      onClick={() => onSelect(s.actionId)}
                    >
                      <span className="step-label">{s.label}</span>
                      {s.hits.length > 1 && s.hits.slice(0, -1).map((h, i) => (
                        <span key={i} className="hit" style={{ left: x(h - s.start) }} />
                      ))}
                    </span>
                  </span>
                );
              })}
            </div>

            {lanes.map((l) => (
              <div key={l.id} className="tl-lane-group" style={{ ['--el' as string]: l.color, height: laneHeight(l) }}>
                {l.rows.map((r, i) => (
                  <div key={i} className={`tl-lane ${r.thin ? 'thin' : ''}`}>
                    {r.bars.map((b, j) => (
                      <span
                        key={j}
                        className={`bar kind-${b.kind}`}
                        style={{ left: x(b.start), width: Math.max(2, x(b.end - b.start)), ['--el' as string]: charColor(b.char) }}
                        title={`${b.label}\n${t(KIND_LABEL[b.kind])} · ${b.source}\n${sec(b.start)}s → ${sec(b.end)}s (${sec(b.end - b.start)}s)`}
                      >
                        <span className="bar-label">{b.label}</span>
                      </span>
                    ))}
                  </div>
                ))}
              </div>
            ))}

            {timeline.loopStarts.map((ls) => (
              <span key={ls.label} className="loop-line" style={{ left: x(ls.frame) }}>
                <span>{ls.label}</span>
              </span>
            ))}
            {hover && <span className="cursor-line" style={{ left: hover.x }} />}
          </div>
        </div>
      </div>

      <div className="tl-inspector small">
        {hoverInfo ? (
          <>
            <b>{sec(hover!.frame)}s</b> ({t('frame')} {hover!.frame})
            {hoverInfo.step && (
              <span> · {t('doing:')} <b style={{ color: charColor(hoverInfo.step.char) }}>{getChar(hoverInfo.step.char)?.name ?? ''} {hoverInfo.step.label}</b></span>
            )}
            {hoverInfo.active.length > 0 ? (
              <div className="insp-list">
                {[...hoverInfo.active].sort((p, q) => Number(p.kind === 'cd') - Number(q.kind === 'cd')).map((b, i) => (
                  <span key={i} className={`insp kind-${b.kind}`} style={{ ['--el' as string]: charColor(b.char) }}>
                    <span className="insp-who">{getChar(b.char)?.name.split(' ')[0]}</span> {b.label} <span className="muted">{t('{s}s left', { s: sec(b.end - hover!.frame) })}</span>
                  </span>
                ))}
              </div>
            ) : <span className="muted"> · {t('nothing active')}</span>}
          </>
        ) : (
          <span className="muted">{t('Hover the timeline to see which buffs, fields and cooldowns are up at that moment. Click an action to edit it.')}</span>
        )}
      </div>
    </div>
  );
}

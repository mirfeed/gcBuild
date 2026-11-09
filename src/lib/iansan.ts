/**
 * Iansan's burst buff depends on movement, which gcsim doesn't model: her Kinetic Energy Scale turns the distance the
 * active character (not Iansan) moved into Nightsoul points once a second, while her Nightsoul's Blessing drains
 * 6 points a second. Standing still lets the points (and the ATK bonus) run out; at 0 the burst ends early.
 *
 * gcsim takes the distance from a `movement=` action param (or the movement() function). The usual estimate is
 * that mobile on-field characters (Varesa, Mavuika, Kinich, Chasca, Ifa…) keep her at 42+ points and the others
 * don't, so each teammate has a "mobile" switch: actions of a mobile one get enough movement to keep the points at
 * the top, the rest get none. The numbers below follow gcsim's Iansan (internal/characters/iansan).
 */
import { getChar } from '../data';
import { frameSlice } from './frames';
import { isAction, isBlock } from './rotation';
import type { ActionType, CharBuild, CharData, Project, RotationAction, RotItem } from './types';

export const IANSAN = 'iansan';

/** on-field characters that keep Iansan's points up (KQM / community guides) */
export const MOBILE_DEFAULT = new Set(['varesa', 'mavuika', 'kinich', 'chasca', 'ifa']);

export const hasIansan = (p: Project) => p.team.some((b) => b?.key === IANSAN);
export const isMobile = (b: CharBuild) => b.key !== IANSAN && (b.mobile ?? MOBILE_DEFAULT.has(b.key));

/** gcsim movement units per second given to a mobile character: 15 × 0.67 = 10 points/s against a 6/s drain */
export const MOVE_PER_SECOND = 15;

const NS = {
  max: 54,
  /** points per 1 movement unit */
  ratio: 0.67,
  /** drain: 0.6 every 6 frames while blessed */
  drainEvery: 6,
  drainAmount: 0.6,
  /** the buff's high tier */
  full: 42,
  lowRate: 0.005,
  highRate: 0.27,
  burstPoints: 15,
  burstPointsDelay: 40,
  burstDuration: 12 * 60,
  c6Bonus: 3 * 60,
  skillDelay: 3,
  blessing: 16 * 60,
  a1Duration: 15 * 60,
  dashCost: 10,
  jumpCost: 6,
};

/** movement for one use of an action of a mobile character: its animation length × MOVE_PER_SECOND */
export function movementFor(data: CharData, action: ActionType, params: Record<string, number>): number {
  const { slice } = frameSlice(data, action, params, 0);
  return Math.max(1, Math.ceil((slice._ / 60) * MOVE_PER_SECOND));
}

/** The rotation with `movement=` added to the actions of mobile characters (only when Iansan is in the team). */
export function withMovement(list: RotItem[], p: Project): RotItem[] {
  if (!hasIansan(p)) return list;
  const mobile = new Map<string, CharData>();
  for (const b of p.team) {
    const data = b && isMobile(b) ? getChar(b.key) : undefined;
    if (b && data) mobile.set(b.key, data);
  }
  if (!mobile.size) return list;
  const walk = (items: RotItem[]): RotItem[] =>
    items.map((x) => {
      if (isAction(x)) {
        const data = mobile.get(x.char);
        if (!data || x.action === 'wait' || x.action === 'delay' || x.action === 'swap' || x.params?.movement !== undefined) return x;
        return { ...x, params: { ...x.params, movement: movementFor(data, x.action as ActionType, x.params ?? {}) } };
      }
      if (!isBlock(x)) return x;
      if (x.kind === 'if') return { ...x, then: walk(x.then), else: walk(x.else) };
      if (x.kind === 'repeat') return { ...x, body: walk(x.body) };
      return x;
    });
  return walk(list);
}

/** Undo withMovement on an imported config: drop `movement` params that equal what gcBuild adds by itself. */
export function stripAutoMovement(p: Project): Project {
  if (!hasIansan(p)) return p;
  const mobile = new Map<string, CharData>();
  for (const b of p.team) {
    const data = b && isMobile(b) ? getChar(b.key) : undefined;
    if (b && data) mobile.set(b.key, data);
  }
  if (!mobile.size) return p;
  const walk = (items: RotItem[]): RotItem[] =>
    items.map((x) => {
      if (isAction(x)) {
        const data = mobile.get(x.char);
        if (!data || x.params?.movement === undefined || x.action === 'wait' || x.action === 'delay') return x;
        const { movement, ...rest } = x.params;
        return movement === movementFor(data, x.action as ActionType, rest) ? { ...x, params: rest } : x;
      }
      if (!isBlock(x)) return x;
      if (x.kind === 'if') return { ...x, then: walk(x.then), else: walk(x.else) };
      if (x.kind === 'repeat') return { ...x, body: walk(x.body) };
      return x;
    });
  return { ...p, rotation: { ...p.rotation, opener: walk(p.rotation.opener), loop: walk(p.rotation.loop) } };
}

/** what the timeline estimate needs from its steps */
export interface IansanStep {
  char: string;
  action: RotationAction['action'];
  params: Record<string, number>;
  /** frame of each use (repeats included) */
  uses: number[];
  skipped: boolean;
}

export interface IansanTrack {
  /** buff segments while the burst is up: share of the full bonus (0..1, rounded to 10%) */
  segments: { start: number; end: number; share: number }[];
  /** bursts that ended before their duration because the points ran out: [cast frame, end frame] */
  early: [number, number][];
}

/**
 * Nightsoul points over the estimated timeline, frame by frame, the way gcsim's Iansan counts them. Movement comes
 * from the actions' `movement` params (explicit, or the mobile default), counted only during her burst and only
 * while someone other than Iansan is on the field.
 */
export function iansanTrack(p: Project, steps: IansanStep[], end: number): IansanTrack | null {
  const ians = p.team.find((b) => b?.key === IANSAN);
  if (!ians) return null;
  const mobile = new Map<string, CharData>();
  for (const b of p.team) {
    const data = b && isMobile(b) ? getChar(b.key) : undefined;
    if (b && data) mobile.set(b.key, data);
  }
  const a1 = !ians.level.includes('/') || +ians.level.split('/')[1] >= 40;
  const burstDur = NS.burstDuration + (ians.cons >= 6 ? NS.c6Bonus : 0);

  // per-frame events
  type Ev = { f: number; char: string; action: string; params: Record<string, number> };
  const evs: Ev[] = [];
  for (const s of steps) {
    if (s.skipped || !s.char) continue;
    for (const f of s.uses) evs.push({ f, char: s.char, action: s.action, params: s.params });
  }
  evs.sort((a, b) => a.f - b.f);
  if (!evs.some((e) => e.char === IANSAN && e.action === 'burst')) return null;

  let pts = 0;
  let blessed = false;
  let blessEnd = 0;
  let drainAt = 0;
  let burstEnd = -1;
  let burstStart = -1;
  let nextTick = -1;
  let moved = 0;
  let a1Until = -1;
  const queued: { f: number; run: () => void }[] = [];
  const segments: IansanTrack['segments'] = [];
  const early: IansanTrack['early'] = [];

  const exit = (f: number) => {
    blessed = false;
    pts = 0;
    if (burstEnd > f) {
      if (burstEnd - f > 30) early.push([burstStart, f]);
      burstEnd = f;
    }
  };
  const enter = (f: number, points: number) => {
    blessed = true;
    pts = points;
    blessEnd = f + NS.blessing;
    drainAt = f + NS.drainEvery;
  };
  const spend = (f: number, n: number) => {
    if (!blessed) return;
    pts -= n;
    if (pts <= 0.2) exit(f);
  };

  let ei = 0;
  // the bonus averaged over each second of the burst (points jump up once a second and drain in between)
  let winStart = -1;
  let winSum = 0;
  const close = (f: number) => {
    if (winStart < 0 || f <= winStart) return;
    const share = Math.round((winSum / (f - winStart)) * 10) / 10;
    const prev = segments[segments.length - 1];
    if (prev && prev.end === winStart && prev.share === share) prev.end = f;
    else segments.push({ start: winStart, end: f, share });
    winStart = -1;
    winSum = 0;
  };
  const last = end + burstDur;
  for (let f = 0; f <= last; f++) {
    for (; ei < evs.length && evs[ei].f === f; ei++) {
      const e = evs[ei];
      if (burstEnd > f && e.char !== IANSAN) {
        const m = e.params.movement ?? (mobile.has(e.char) && e.action !== 'swap' ? movementFor(mobile.get(e.char)!, e.action as ActionType, e.params) : 0);
        moved += m;
      }
      if (e.char !== IANSAN) continue;
      if (e.action === 'skill') queued.push({ f: f + NS.skillDelay, run: () => enter(f + NS.skillDelay, NS.max) });
      else if (e.action === 'burst') {
        close(f);
        burstStart = f;
        burstEnd = f + burstDur;
        nextTick = f + 60;
        moved = 0;
        queued.push({ f: f + NS.burstPointsDelay, run: () => (blessed ? (pts = Math.min(NS.max, pts + NS.burstPoints)) : enter(f + NS.burstPointsDelay, NS.burstPoints)) });
      } else if (e.action === 'charge' && blessed && a1) a1Until = f + NS.a1Duration;
      else if (e.action === 'dash') spend(f, NS.dashCost);
      else if (e.action === 'jump') spend(f, NS.jumpCost);
    }
    for (let i = queued.length - 1; i >= 0; i--) {
      if (queued[i].f === f) {
        const q = queued.splice(i, 1)[0];
        q.run();
      }
    }
    if (blessed && f >= blessEnd) exit(f);
    if (blessed && f >= drainAt) {
      drainAt = f + NS.drainEvery;
      spend(f, NS.drainAmount);
    }
    if (burstEnd > f && f === nextTick) {
      close(f);
      nextTick = f + 60;
      const gain = moved * NS.ratio + (a1Until > f ? 1 : 0);
      moved = 0;
      if (blessed && gain > 0) pts = Math.min(NS.max, pts + gain);
    }
    const up = burstEnd > f;
    if (up) {
      if (winStart < 0) winStart = f;
      winSum += pts >= NS.full ? 1 : (pts * NS.lowRate) / NS.highRate;
    } else close(f);
    if (f > end && !up && !blessed) break;
  }
  close(Math.min(last, burstEnd));
  return { segments, early };
}

/**
 * Lightweight rotation timeline estimator. It walks the clicked action list with
 * gcsim's cancel frames, swap delay / swap cooldown, skill & burst cooldowns,
 * and lays out effect durations. It ignores hitlag, attack speed and energy, so
 * treat it as a planning aid: gcsim is the source of truth.
 */
import { CHAR_META, SACRIFICIAL_CD, SET_EFFECTS, WEAPON_EFFECTS, type EffectDef, type EffectKind, type Trigger } from '../data/curated';
import { getChar } from '../data';
import { attackHitCount, frameSlice, framesUntil, type FrameState } from './frames';
import { isAction, type ListId } from './rotation';
import type { ActionType, CharBuild, CharData, Clause, Condition, FrameSlice, Project, RotationAction, RotItem, Section } from './types';

export const SWAP_CD = 60;

export interface TLStep {
  key: string;
  /** set for markers that aren't actions (raw script blocks) */
  marker?: boolean;
  actionId: string;
  section: Section;
  loop: number;
  char: string;
  action: RotationAction['action'];
  label: string;
  start: number;
  end: number;
  /** frames waited right before the step (swap cooldown + cooldown of the first use) */
  waited: number;
  skipped: boolean;
  generic: boolean;
  hits: number[];
  warnings: string[];
}

export interface TLBar {
  lane: string;
  label: string;
  start: number;
  end: number;
  kind: EffectKind;
  source: string;
  char: string;
}

export interface Readiness {
  char: string;
  skillIn: number;
  skillCharges: number;
  skillMaxCharges: number;
  burstIn: number;
}

export interface TimelineResult {
  steps: TLStep[];
  bars: TLBar[];
  loopStarts: { frame: number; label: string }[];
  end: number;
  /** frames per loop iteration (last fully simulated one) */
  loopLength: number | null;
  readiness: Readiness[];
  warnings: string[];
}

export function actionLabel(a: RotationAction, _char?: CharData): string {
  const p = a.params ?? {};
  switch (a.action) {
    case 'skill': {
      const v = CHAR_META[a.char]?.skillVariants?.find((x) => Object.entries(x.params).every(([k, n]) => p[k] === n));
      if (v) return v.label;
      return p.hold ? 'E hold' : 'E';
    }
    case 'burst': return 'Q';
    case 'attack': return `N${a.repeat > 1 ? a.repeat : 1}`;
    case 'charge': return 'CA';
    case 'aim': return 'Aim';
    case 'high_plunge': return 'Plunge';
    case 'low_plunge': return 'Low plunge';
    case 'dash': return 'Dash';
    case 'jump': return 'Jump';
    case 'walk': return 'Walk';
    case 'swap': return 'Swap';
    case 'wait': return `Wait ${a.frames ?? 0}f`;
    case 'delay': return `Delay ${a.frames ?? 0}f`;
  }
}

/** Skill / burst cooldown in seconds for a given action. */
export function cooldowns(char: CharData, params: Record<string, number>) {
  const meta = CHAR_META[char.key];
  const hasHold = !!char.params.skill?.hold;
  const ext = char.skillCD;
  let skill: number;
  if (params.hold && hasHold) skill = meta?.skillHoldCD ?? (ext.length ? Math.max(...ext) : 10);
  else if (hasHold) skill = meta?.skillCD ?? (ext.length ? Math.min(...ext) : 10);
  else skill = meta?.skillCD ?? (ext.length ? Math.max(...ext) : 10);
  const burst = meta?.burstCD ?? (char.burstCD.length ? Math.max(...char.burstCD) : 15);
  return { skill, burst };
}

/** All timing effects a character brings: curated, or extracted statuses as a fallback. */
export function charEffects(char: CharData): { defs: EffectDef[]; curated: boolean } {
  const meta = CHAR_META[char.key];
  if (meta?.effects?.length) return { defs: meta.effects, curated: true };
  return {
    defs: char.statuses.map((s) => ({ label: s.name, on: s.on, dur: s.dur, kind: 'state' as EffectKind })),
    curated: false,
  };
}

function gearEffects(b: CharBuild): { defs: EffectDef[]; source: string }[] {
  const out: { defs: EffectDef[]; source: string }[] = [];
  const w = WEAPON_EFFECTS[b.weapon.key];
  if (w) out.push({ defs: w, source: 'weapon' });
  if (b.weapon.key.startsWith('sacrificial')) {
    const cd = SACRIFICIAL_CD[Math.min(Math.max(b.weapon.refine, 1), 5) - 1];
    out.push({ defs: [{ label: 'Sacrificial ICD', on: 'skill', dur: cd, kind: 'cd', icd: cd }], source: 'weapon' });
  }
  for (const s of b.sets) {
    if (s.count >= 4 && SET_EFFECTS[s.key]) out.push({ defs: SET_EFFECTS[s.key], source: 'set' });
  }
  return out;
}

function triggersFor(action: ActionType, params: Record<string, number>): Trigger[] {
  switch (action) {
    case 'skill': return ['skill', params.hold ? 'skillHold' : 'skillPress'];
    case 'burst': return ['burst'];
    case 'attack': return ['attack'];
    case 'charge':
    case 'aim': return ['charge'];
    case 'high_plunge':
    case 'low_plunge': return ['plunge'];
    default: return [];
  }
}

function effectDuration(e: EffectDef, cons: number): number {
  let d = e.dur;
  for (const [c, dur] of e.cons ?? []) if (cons >= c) d = dur;
  return d;
}

interface CharState {
  build: CharBuild;
  data: CharData;
  skillReady: number[];
  burstReady: number;
  counter: number;
}

/** The last executed action: its final duration depends on what comes next. */
interface Pending {
  step: TLStep;
  char: string;
  slice: FrameSlice;
  lastStart: number;
}

class Stop extends Error {}

type NextInfo = { type: ActionType | null; char: string } | null;

const nextTypeOf = (x: RotItem | undefined): NextInfo => {
  if (!x) return null;
  if (isAction(x)) return x.action === 'wait' || x.action === 'delay' ? { type: null, char: '' } : { type: x.action as ActionType, char: x.char };
  if (x.kind === 'if') return nextTypeOf(x.then[0]) ?? nextTypeOf(x.else[0]);
  if (x.kind === 'repeat') return nextTypeOf(x.body[0]);
  return null;
};

export interface SimOpts {
  /** stop once the cursor position is reached (for "ready at cursor" readouts) */
  stopAt?: { listId: ListId; afterId: string | null };
}

export function simulate(project: Project, loopsToShow: number, opts: SimOpts = {}): TimelineResult {
  const team = project.team.filter((b): b is CharBuild => !!b && !!getChar(b.key));
  const states = new Map<string, CharState>();
  for (const b of team) {
    const data = getChar(b.key)!;
    states.set(b.key, { build: b, data, skillReady: Array(data.skillCharges || 1).fill(0), burstReady: 0, counter: 0 });
  }
  const rot = project.rotation;
  const loops = rot.loop.length === 0 ? 0 : rot.loopMode === 'for' ? Math.min(rot.loopCount, loopsToShow) : loopsToShow;

  const steps: TLStep[] = [];
  const bars: TLBar[] = [];
  const warnings: string[] = [];
  const loopStarts: { frame: number; label: string }[] = [];
  const lastTrigger = new Map<string, number>();
  const openBars = new Map<string, TLBar>();
  const swapDelay = Math.max(0, project.options.swapDelay);

  let t = 0;
  let active = states.has(project.active) ? project.active : team[0]?.key ?? '';
  let swapReady = 0;
  let pending: Pending | null = null;
  let pendingLoopLabel: string | null = null;
  let unknownConds = 0;
  let guard = 0;
  let curLoop = -1;

  const addEffect = (owner: CharState, e: EffectDef, at: number, source: string) => {
    if (e.minCons && owner.build.cons < e.minCons) return;
    const id = `${owner.build.key}|${source}|${e.label}`;
    if (e.icd) {
      const last = lastTrigger.get(id);
      if (last !== undefined && at - last < e.icd * 60) return;
    }
    lastTrigger.set(id, at);
    const start = at + Math.round((e.delay ?? 0) * 60);
    const bar: TLBar = {
      lane: e.team ? 'team' : owner.build.key,
      label: e.label,
      start,
      end: start + Math.round(effectDuration(e, owner.build.cons) * 60),
      kind: e.kind ?? 'buff',
      source,
      char: owner.build.key,
    };
    // re-triggering refreshes: cut the previous bar short
    const prev = openBars.get(id);
    if (prev && prev.end > start && e.kind !== 'cd') prev.end = start;
    openBars.set(id, bar);
    bars.push(bar);
  };

  const fire = (cs: CharState, trig: Trigger[], at: number) => {
    const { defs } = charEffects(cs.data);
    for (const e of defs) {
      const on = Array.isArray(e.on) ? e.on : [e.on];
      if (on.some((x) => trig.includes(x))) addEffect(cs, e, at, cs.data.name);
    }
    for (const g of gearEffects(cs.build)) {
      for (const e of g.defs) {
        const on = Array.isArray(e.on) ? e.on : [e.on];
        if (on.some((x) => trig.includes(x))) addEffect(cs, e, at, g.source);
      }
    }
  };

  /** Settle the pending action now that the next action is known. */
  const settle = (next: NextInfo) => {
    if (!pending) return;
    const nextType: ActionType | null = next && next.type && next.char !== pending.char ? 'swap' : next?.type ?? null;
    const end = pending.lastStart + framesUntil(pending.slice, nextType);
    pending.step.end = end;
    pending.step.hits.push(end);
    t = end;
    pending = null;
  };

  /** Current time for condition checks (the pending action is assumed to play its full animation). */
  const now = () => (pending ? pending.lastStart + pending.slice._ : t);

  const flushLoopLabel = () => {
    if (pendingLoopLabel) {
      loopStarts.push({ frame: t, label: pendingLoopLabel });
      pendingLoopLabel = null;
    }
  };

  // conditions: evaluate what the estimate knows, otherwise fall back to `assume`
  const num = (s: string): number | null => {
    const at = now();
    s = s.trim();
    if (/^-?\d+(\.\d+)?$/.test(s)) return +s;
    const m = /^\.(\w+)\.(skill|burst)\.(ready|cd|charge)$/.exec(s);
    if (m) {
      const cs = states.get(m[1]);
      if (!cs) return null;
      if (m[2] === 'skill') {
        if (m[3] === 'ready') return Math.min(...cs.skillReady) <= at ? 1 : 0;
        if (m[3] === 'charge') return cs.skillReady.filter((x) => x <= at).length;
        return Math.max(0, Math.min(...cs.skillReady) - at);
      }
      if (m[3] === 'ready') return cs.burstReady <= at ? 1 : 0;
      if (m[3] === 'cd') return Math.max(0, cs.burstReady - at);
      return null;
    }
    const o = /^\.(\w+)\.onfield$/.exec(s);
    if (o && states.has(o[1])) return active === o[1] ? 1 : 0;
    const n = /^\.(\w+)\.normal$/.exec(s);
    if (n && states.has(n[1])) return states.get(n[1])!.counter + 1;
    const cons = /^\.(\w+)\.cons$/.exec(s);
    if (cons && states.has(cons[1])) return states.get(cons[1])!.build.cons;
    if (s === 'f()') return at;
    if (s === 'rot') return Math.max(0, curLoop);
    return null;
  };

  const evalClause = (c: Clause): boolean | null => {
    const a = num(c.field);
    const b = num(c.value);
    if (a === null || b === null) return null;
    switch (c.op) {
      case '<': return a < b;
      case '<=': return a <= b;
      case '>': return a > b;
      case '>=': return a >= b;
      case '==': return a === b;
      case '!=': return a !== b;
    }
  };

  const evalCond = (cond: Condition): { value: boolean; known: boolean } => {
    const rs = cond.clauses.filter((c) => c.field.trim()).map(evalClause);
    if (!rs.length) return { value: true, known: true };
    if (cond.join === 'or') {
      if (rs.some((r) => r === true)) return { value: true, known: true };
      if (rs.every((r) => r === false)) return { value: false, known: true };
    } else {
      if (rs.some((r) => r === false)) return { value: false, known: true };
      if (rs.every((r) => r === true)) return { value: true, known: true };
    }
    unknownConds++;
    return { value: cond.assume ?? true, known: false };
  };

  const pushSkipped = (a: RotationAction, section: Section, li: number, why: string) => {
    settle(nextTypeOf(a));
    flushLoopLabel();
    const cs = states.get(a.char);
    steps.push({
      key: `${a.id}#${li}#${steps.length}`, actionId: a.id, section, loop: li, char: a.char, action: a.action,
      label: actionLabel(a, cs?.data), start: t, end: t, waited: 0, skipped: true, generic: false, hits: [], warnings: [why],
    });
  };

  const runAction = (a: RotationAction, section: Section, li: number) => {
    if (++guard > 4000) throw new Stop();
    const key = `${a.id}#${li}#${steps.length}`;

    if (a.action === 'wait' || a.action === 'delay') {
      settle(null);
      flushLoopLabel();
      const f = Math.max(0, a.frames ?? 0);
      steps.push({ key, actionId: a.id, section, loop: li, char: '', action: a.action, label: actionLabel(a), start: t, end: t + f, waited: 0, skipped: false, generic: false, hits: [], warnings: [] });
      t += f;
      return;
    }

    const cs = states.get(a.char);
    if (!cs) return;
    const params = a.params ?? {};

    settle({ type: a.action as ActionType, char: a.char });
    flushLoopLabel();

    const cds = cooldowns(cs.data, params);
    const stepWarnings: string[] = [];
    let waited = 0;

    if (a.char !== active) {
      const prev = states.get(active);
      if (swapReady > t) {
        waited += swapReady - t;
        t = swapReady;
      }
      t += swapDelay;
      if (prev) fire(prev, ['swapOut'], t);
      active = a.char;
      swapReady = t + SWAP_CD;
      for (const s of states.values()) s.counter = 0;
    }

    const repeat = Math.max(1, a.repeat || 1);
    let start = t;
    let waitedBefore = waited;
    let generic = false;
    const step: TLStep = {
      key, actionId: a.id, section, loop: li, char: a.char, action: a.action, label: actionLabel(a, cs.data),
      start, end: t, waited: 0, skipped: false, generic: false, hits: [], warnings: stepWarnings,
    };

    for (let r = 0; r < repeat; r++) {
      let cdEnd = 0;
      if (a.action === 'skill') {
        const idx = cs.skillReady.indexOf(Math.min(...cs.skillReady));
        const readyAt = cs.skillReady[idx];
        if (readyAt > t) {
          stepWarnings.push(`E on cooldown: gcsim waits ${((readyAt - t) / 60).toFixed(2)}s`);
          waited += readyAt - t;
          t = readyAt;
        }
        const pendingCharge = Math.max(t, ...cs.skillReady.filter((x, j) => j !== idx && x > t));
        cs.skillReady[idx] = pendingCharge + Math.round(cds.skill * 60);
        cdEnd = cs.skillReady[idx];
      } else if (a.action === 'burst') {
        if (cs.burstReady > t) {
          stepWarnings.push(`Q on cooldown: gcsim waits ${((cs.burstReady - t) / 60).toFixed(2)}s`);
          waited += cs.burstReady - t;
          t = cs.burstReady;
        }
        cs.burstReady = t + Math.round(cds.burst * 60);
        cdEnd = cs.burstReady;
      }
      // the step starts once the first use is off cooldown; later repeats wait inside the step
      if (r === 0) {
        start = t;
        waitedBefore = waited;
      }

      let state: FrameState | undefined;
      for (const s of CHAR_META[a.char]?.states ?? []) {
        if (bars.some((b) => b.char === a.char && b.label === s.effect && b.start <= t + 1 && b.end > t)) state = s;
      }
      const counter = cs.counter;
      const override = CHAR_META[a.char]?.frames?.[a.action as ActionType];
      const fs = override ? { slice: override, generic: true } : frameSlice(cs.data, a.action as ActionType, params, counter, state);
      generic ||= fs.generic;

      fire(cs, triggersFor(a.action as ActionType, params), t);
      if (a.action === 'skill' || a.action === 'burst') {
        bars.push({ lane: a.char, label: `${a.action === 'skill' ? 'E' : 'Q'} CD`, start: t, end: cdEnd, kind: 'cd', source: 'cooldown', char: a.char });
      }

      cs.counter = a.action === 'attack' ? (counter + 1) % attackHitCount(cs.data, state) : 0;

      if (r < repeat - 1) {
        t += framesUntil(fs.slice, a.action as ActionType);
        step.hits.push(t);
      } else {
        pending = { step, char: a.char, slice: fs.slice, lastStart: t };
      }
    }
    step.start = start;
    step.waited = waitedBefore;
    step.generic = generic;
    steps.push(step);
  };

  const exec = (items: RotItem[], listId: ListId, section: Section, li: number) => {
    const stop = opts.stopAt;
    if (stop && stop.listId === listId && stop.afterId === null) throw new Stop();
    for (const x of items) {
      if (isAction(x)) {
        if (x.char && !states.has(x.char) && x.action !== 'wait' && x.action !== 'delay') continue;
        if (x.cond && x.cond.clauses.length) {
          const r = evalCond(x.cond);
          if (!r.value) pushSkipped(x, section, li, r.known ? 'skipped: condition is false here' : 'skipped: condition assumed false');
          else runAction(x, section, li);
        } else runAction(x, section, li);
      } else if (x.kind === 'if') {
        const r = evalCond(x.cond);
        exec(r.value ? x.then : x.else, `${x.id}/${r.value ? 'then' : 'else'}`, section, li);
      } else if (x.kind === 'repeat') {
        for (let n = 0; n < Math.max(1, x.count); n++) exec(x.body, `${x.id}/body`, section, li);
      } else {
        settle(null);
        flushLoopLabel();
        steps.push({
          key: `${x.id}#${li}#${steps.length}`, marker: true, actionId: x.id, section, loop: li, char: '', action: 'wait',
          label: 'script', start: t, end: t, waited: 0, skipped: false, generic: false, hits: [], warnings: ['raw script: not simulated in the estimate'],
        });
      }
      if (stop && stop.listId === listId && stop.afterId === x.id) throw new Stop();
    }
  };

  let stopped = false;
  try {
    exec(rot.opener, 'opener', 'opener', -1);
    for (let i = 0; i < loops; i++) {
      pendingLoopLabel = `Loop ${i + 1}`;
      curLoop = i;
      exec(rot.loop, 'loop', 'loop', i);
    }
  } catch (e) {
    if (!(e instanceof Stop)) throw e;
    stopped = true;
  }
  // a `while` loop wraps around, so its last action cancels into the loop's first one
  settle(!stopped && loops > 0 && rot.loopMode === 'while' ? nextTypeOf(rot.loop[0]) : null);
  flushLoopLabel();
  if (guard > 4000) warnings.push('Rotation too long to estimate fully (stopped after 4000 actions).');

  let loopLength: number | null = null;
  if (loopStarts.length >= 2) loopLength = loopStarts[loopStarts.length - 1].frame - loopStarts[loopStarts.length - 2].frame;
  else if (loopStarts.length === 1) loopLength = t - loopStarts[0].frame;

  const readiness: Readiness[] = team.map((b) => {
    const cs = states.get(b.key)!;
    return {
      char: b.key,
      skillIn: Math.max(0, Math.min(...cs.skillReady) - t),
      skillCharges: cs.skillReady.filter((x) => x <= t).length,
      skillMaxCharges: cs.skillReady.length,
      burstIn: Math.max(0, cs.burstReady - t),
    };
  });

  const waitedSteps = steps.filter((s) => s.waited > 0 && s.warnings.some((w) => w.includes('cooldown')));
  if (waitedSteps.length) warnings.push(`${waitedSteps.length} action(s) wait for a cooldown. gcsim stalls on those.`);
  if (unknownConds) {
    warnings.push(`${unknownConds} condition check(s) can't be predicted by the estimate (HP, statuses, auras…) and use their "estimate assumes" value. Run the sim to see what really happens.`);
  }

  return { steps, bars, loopStarts, end: t, loopLength, readiness, warnings };
}

/** Readiness at the insertion cursor (for the action palette). */
export function readinessAt(project: Project, listId: ListId, afterId: string | null): TimelineResult {
  return simulate(project, 1, { stopAt: { listId, afterId } });
}

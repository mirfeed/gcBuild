/**
 * Turns a gcsim sample (debug log of one iteration) into timeline data. All
 * times are real sim frames, so hitlag extensions, reaction timing and
 * energy are exactly what gcsim did.
 */
import { characters } from '../data';
import type { Sample, SampleLog } from './api';

export interface SBar {
  char: number; // -1 = team / enemy / core
  key: string;
  start: number;
  end: number;
}

export interface SAction {
  char: number;
  state: string;
  start: number;
  end: number;
}

export interface SDamage {
  char: number;
  frame: number;
  abil: string;
  damage: number;
  crit: boolean;
  ele: string;
  reaction: string;
  target: number;
}

export interface SFail {
  char: number;
  what: string;
  start: number;
  end: number;
}

export interface SampleTimeline {
  chars: { key: string; name: string; element: string }[];
  end: number;
  actions: SAction[];
  bars: SBar[];
  cooldowns: { char: number; type: string; start: number; end: number }[];
  damage: SDamage[];
  applications: { char: number; frame: number; ele: string; abil: string; aura: string[] }[];
  energy: { char: number; max: number; points: { frame: number; value: number }[] }[];
  hp: { char: number; points: { frame: number; ratio: number }[] }[];
  fails: SFail[];
  shields: { name: string; start: number; end: number }[];
  /** status / modifier keys seen per character key ('' = core / enemy), for condition hints */
  statusKeys: Record<string, string[]>;
}

const TRANSFORMATIVE = /^(overload|superconduct|electro-?charged|shatter|swirl|burning|bloom|burgeon|hyperbloom|lunar[\w-]*|rupture)/i;

export function reactionOf(d: { abil: string; amp?: string; cata?: string }): string {
  if (d.amp) return d.amp;
  if (d.cata) return d.cata;
  const m = TRANSFORMATIVE.exec(d.abil);
  if (m && !/self damage/i.test(d.abil)) return d.abil.toLowerCase();
  return '';
}

function ourKey(name: string): string {
  const c = characters.find((x) => x.id === name || x.key === name || x.aliases.includes(name));
  return c?.key ?? name;
}

const num = (v: unknown) => (typeof v === 'number' ? v : Number(v) || 0);

export function parseSample(s: Sample): SampleTimeline {
  const chars = s.character_details.map((c) => {
    const key = ourKey(c.name);
    return { key, name: characters.find((x) => x.key === key)?.name ?? c.name, element: c.element };
  });
  const n = chars.length;
  let end = 0;
  const actions: SAction[] = [];
  const raw: SBar[] = [];
  const cooldowns: SampleTimeline['cooldowns'] = [];
  const damage: SDamage[] = [];
  const applications: SampleTimeline['applications'] = [];
  const energy = Array.from({ length: n }, (_, i) => ({ char: i, max: 0, points: [] as { frame: number; value: number }[] }));
  const hp = Array.from({ length: n }, (_, i) => ({ char: i, points: [] as { frame: number; ratio: number }[] }));
  const failFrames: { char: number; what: string; frame: number }[] = [];
  const shields: SampleTimeline['shields'] = [];
  const keys = new Map<string, Set<string>>();

  const addKey = (char: number, key: string) => {
    const k = char >= 0 ? chars[char]?.key ?? '' : '';
    if (!keys.has(k)) keys.set(k, new Set());
    keys.get(k)!.add(key);
  };

  for (const l of s.logs as SampleLog[]) {
    end = Math.max(end, l.frame);
    const g = l.logs ?? {};
    switch (l.event) {
      case 'hitlag': {
        const m = /^(\w+) started$/.exec(l.msg);
        if (m && l.ended >= l.frame) actions.push({ char: l.char_index, state: String(g.State ?? m[1]), start: l.frame, end: l.ended });
        break;
      }
      case 'damage': {
        const d = {
          char: l.char_index,
          frame: l.frame,
          abil: String(g.abil ?? ''),
          damage: num(g.damage),
          crit: !!g.crit,
          ele: String(g.ele ?? ''),
          amp: String(g.amp ?? ''),
          cata: String(g.cata ?? ''),
          target: num(g.target),
        };
        damage.push({ char: d.char, frame: d.frame, abil: d.abil, damage: d.damage, crit: d.crit, ele: d.ele, reaction: reactionOf(d), target: d.target });
        break;
      }
      case 'element':
        applications.push({
          char: l.char_index,
          frame: l.frame,
          ele: String(g.applied_ele ?? ''),
          abil: String(g.abil ?? ''),
          aura: Array.isArray(g.after) ? (g.after as string[]) : [],
        });
        break;
      case 'status': {
        const key = String(g.key ?? '');
        if (!key) break;
        addKey(l.char_index, key);
        const expiry = num(g.expiry);
        if (expiry < 0 || l.ended < 0) break; // permanent modifiers (set bonuses etc.)
        if (l.ended > l.frame) raw.push({ char: l.char_index, key, start: l.frame, end: l.ended });
        break;
      }
      case 'cooldown':
        // cooldown `expiry` is a duration (unlike status / shield expiry, which are absolute frames)
        if (/triggered/.test(l.msg)) cooldowns.push({ char: l.char_index, type: String(g.type ?? ''), start: l.frame, end: l.frame + num(g.expiry) });
        break;
      case 'energy': {
        if (l.char_index < 0 || l.char_index >= n) break;
        const e = energy[l.char_index];
        e.max = Math.max(e.max, num(g.max_energy));
        if (!e.points.length) e.points.push({ frame: 0, value: num(g.pre_recovery ?? g.pre_drain ?? g.max_energy) });
        const v = l.msg === 'draining energy' ? num(g.post_drain) : num(g.post_recovery);
        e.points.push({ frame: l.frame, value: v });
        break;
      }
      case 'character':
        if (l.msg === 'starting hp set' && l.char_index >= 0) hp[l.char_index].points.push({ frame: l.frame, ratio: num(g.starting_hp_ratio) });
        break;
      case 'hurt':
      case 'heal':
        if (l.char_index >= 0 && l.char_index < n) hp[l.char_index].points.push({ frame: l.frame, ratio: num(g.current_hp_ratio) });
        break;
      case 'shield':
        if (/added|overridden/.test(l.msg)) shields.push({ name: String(g.name ?? 'shield'), start: l.frame, end: num(g.expiry) });
        break;
      case 'sim': {
        const m = /could not execute (\w+)/.exec(l.msg);
        if (m) failFrames.push({ char: l.char_index, what: m[1], frame: l.frame });
        break;
      }
    }
  }

  // merge overlapping intervals of the same status
  raw.sort((a, b) => a.char - b.char || a.key.localeCompare(b.key) || a.start - b.start);
  const bars: SBar[] = [];
  for (const b of raw) {
    const last = bars[bars.length - 1];
    if (last && last.char === b.char && last.key === b.key && b.start <= last.end + 1) last.end = Math.max(last.end, b.end);
    else bars.push({ ...b });
  }

  // consecutive per-frame failures -> waiting intervals
  const fails: SFail[] = [];
  for (const f of failFrames) {
    const last = fails[fails.length - 1];
    if (last && last.what === f.what && f.frame <= last.end + 2) last.end = f.frame + 1;
    else fails.push({ char: f.char, what: f.what, start: f.frame, end: f.frame + 1 });
  }

  for (const e of energy) {
    const lastV = e.points[e.points.length - 1];
    if (lastV) e.points.push({ frame: end, value: lastV.value });
  }
  for (const h of hp) {
    const lastV = h.points[h.points.length - 1];
    if (lastV) h.points.push({ frame: end, ratio: lastV.ratio });
  }

  const statusKeys: Record<string, string[]> = {};
  for (const [k, set] of keys) statusKeys[k] = [...set].sort();

  return { chars, end, actions, bars, cooldowns, damage, applications, energy, hp, fails, shields, statusKeys };
}

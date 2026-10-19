/**
 * KQM Standards substat generation, matching the constants used by gcsim's
 * substat optimizer (pkg/optimization/substats.go):
 *  - 5* artifacts, main stats at +20
 *  - 2 fixed rolls of every substat, 20 liquid rolls
 *  - at most 10 liquid rolls per substat, minus 2 per piece with that main stat
 *
 * Liquid rolls go to ER first (to hit the ER target), then greedily to
 * whichever substat raises a simple damage proxy the most. It is a heuristic,
 * not gcsim's sim-driven optimizer (`gcsim -substatOptimFull`).
 */
import { SET_STATS } from '../data/curated';
import { gearSets, gearStats } from './artifacts';
import type { CharBuild, CharData, Profile, Stat, SubStat, WeaponData } from './types';

export const SUB_VALUES: Record<SubStat, number> = {
  'atk%': 0.0496,
  cr: 0.0331,
  cd: 0.0662,
  em: 19.82,
  er: 0.0551,
  'hp%': 0.0496,
  'def%': 0.062,
  atk: 16.54,
  def: 19.68,
  hp: 253.94,
};

export const MAIN_VALUES: Partial<Record<Stat, number>> = {
  hp: 4780,
  atk: 311,
  'atk%': 0.466,
  'hp%': 0.466,
  'def%': 0.583,
  cr: 0.311,
  cd: 0.622,
  em: 186.5,
  er: 0.518,
  heal: 0.359,
  'pyro%': 0.466,
  'hydro%': 0.466,
  'anemo%': 0.466,
  'electro%': 0.466,
  'dendro%': 0.466,
  'cryo%': 0.466,
  'geo%': 0.466,
  'phys%': 0.583,
};

export const SUB_ORDER: SubStat[] = ['hp%', 'hp', 'atk%', 'atk', 'def%', 'def', 'em', 'er', 'cr', 'cd'];
export const FIXED_ROLLS = 2;
export const TOTAL_LIQUID = 20;
export const LIQUID_CAP = 10;

export const SANDS_STATS: Stat[] = ['atk%', 'hp%', 'def%', 'er', 'em'];
export const GOBLET_STATS: Stat[] = ['pyro%', 'hydro%', 'anemo%', 'electro%', 'dendro%', 'cryo%', 'geo%', 'phys%', 'atk%', 'hp%', 'def%', 'em'];
export const CIRCLET_STATS: Stat[] = ['cr', 'cd', 'atk%', 'hp%', 'def%', 'em', 'heal'];

export type StatTotals = Record<Stat, number> & { baseAtk: number; baseHp: number; baseDef: number };

function emptyTotals(): Record<Stat, number> {
  return {
    hp: 0, 'hp%': 0, atk: 0, 'atk%': 0, def: 0, 'def%': 0, er: 0, em: 0, cr: 0, cd: 0, heal: 0,
    'pyro%': 0, 'hydro%': 0, 'anemo%': 0, 'electro%': 0, 'dendro%': 0, 'cryo%': 0, 'geo%': 0, 'phys%': 0,
  };
}

export function mainStatList(b: CharBuild): Stat[] {
  return ['hp', 'atk', b.main.sands, b.main.goblet, b.main.circlet];
}

/** Liquid cap for a substat given the build's main stats. */
export function liquidCap(b: CharBuild, s: SubStat): number {
  const mains = mainStatList(b).filter((m) => m === s).length;
  return Math.max(0, LIQUID_CAP - FIXED_ROLLS * mains);
}

/** Stats from everything except artifact substats. */
function baseTotals(b: CharBuild, char: CharData, weapon: WeaponData | undefined): StatTotals {
  const t = emptyTotals();
  t.cr = 0.05;
  t.cd = 0.5;
  t.er = 1;
  for (const [k, v] of Object.entries(char.asc)) t[k as Stat] += v ?? 0;
  if (weapon) {
    for (const [k, v] of Object.entries(weapon.stats)) {
      if (k !== 'atk') t[k as Stat] += v ?? 0;
    }
  }
  for (const m of mainStatList(b)) t[m] += MAIN_VALUES[m] ?? 0;
  for (const s of b.sets) {
    const bonus = SET_STATS[s.key];
    if (!bonus) continue;
    if (s.count >= 2) for (const [k, v] of Object.entries(bonus[2] ?? {})) t[k as Stat] += v ?? 0;
    if (s.count >= 4) for (const [k, v] of Object.entries(bonus[4] ?? {})) t[k as Stat] += v ?? 0;
  }
  return {
    ...t,
    baseAtk: char.base.atk + (weapon?.stats.atk ?? 0),
    baseHp: char.base.hp,
    baseDef: char.base.def,
  };
}

export function totalsWithSubs(base: StatTotals, liquid: Partial<Record<SubStat, number>>): StatTotals {
  const t = { ...base };
  for (const s of SUB_ORDER) t[s] += SUB_VALUES[s] * (FIXED_ROLLS + (liquid[s] ?? 0));
  return t;
}

export function finalStats(t: StatTotals) {
  return {
    atk: t.baseAtk * (1 + t['atk%']) + t.atk,
    hp: t.baseHp * (1 + t['hp%']) + t.hp,
    def: t.baseDef * (1 + t['def%']) + t.def,
    em: t.em,
    er: t.er,
    cr: t.cr,
    cd: t.cd,
  };
}

function dmgBonus(t: StatTotals, char: CharData): number {
  const key = (char.element === 'physical' ? 'phys%' : `${char.element}%`) as Stat;
  // physical carries (Eula, Razor) use a phys goblet; count whichever is larger
  return Math.max(t[key] ?? 0, t['phys%'] ?? 0);
}

/**
 * ATK% worth of buffs a carry usually gets from teammates (Bennett, Noblesse,
 * Shenhe, ...). Without it the proxy overrates ATK% substats relative to crit.
 */
export const ASSUMED_TEAM_ATK = 0.5;

export function profileValue(p: Profile, t: StatTotals, char: CharData): number {
  const f = finalStats(t);
  let v: number;
  switch (p.stat) {
    case 'atk': v = f.atk + t.baseAtk * ASSUMED_TEAM_ATK; break;
    case 'hp': v = f.hp; break;
    case 'def': v = f.def; break;
    case 'em': v = f.em; break;
    default: v = 1;
  }
  if (p.hpToAtk && p.stat === 'atk') v += p.hpToAtk * f.hp;
  if (p.emWeight && p.stat !== 'em') v += p.emWeight * f.em;
  if (p.crit) v *= 1 + Math.min(Math.max(f.cr, 0), 1) * f.cd;
  if (p.amp) v *= 1 + (2.78 * f.em) / (f.em + 1400);
  if (p.crit || p.amp) v *= 1 + dmgBonus(t, char);
  return v;
}

export interface KqmsResult {
  liquid: Partial<Record<SubStat, number>>;
  erMet: boolean;
  value: number;
  er: number;
}

/** Allocate liquid substats for fixed main stats. */
export function allocate(b: CharBuild, char: CharData, weapon: WeaponData | undefined): KqmsResult {
  const base = baseTotals(b, char, weapon);
  const liquid: Partial<Record<SubStat, number>> = {};
  let remaining = TOTAL_LIQUID;

  // 1. ER to target
  const erNoLiquid = base.er + SUB_VALUES.er * FIXED_ROLLS;
  const needEr = Math.max(0, Math.ceil((b.erTarget - erNoLiquid) / SUB_VALUES.er - 1e-9));
  const erRolls = Math.min(needEr, liquidCap(b, 'er'), remaining);
  if (erRolls > 0) liquid.er = erRolls;
  remaining -= erRolls;
  const erMet = erRolls >= needEr;

  // 2. greedy on the damage proxy
  const candidates: SubStat[] = ['cr', 'cd', 'atk%', 'hp%', 'def%', 'em', 'atk', 'hp', 'def'];
  while (remaining > 0) {
    const cur = profileValue(b.profile, totalsWithSubs(base, liquid), char);
    let best: SubStat | null = null;
    let bestGain = 0;
    for (const s of candidates) {
      if ((liquid[s] ?? 0) >= liquidCap(b, s)) continue;
      const next = { ...liquid, [s]: (liquid[s] ?? 0) + 1 };
      const gain = profileValue(b.profile, totalsWithSubs(base, next), char) - cur;
      if (gain > bestGain + 1e-9) {
        bestGain = gain;
        best = s;
      }
    }
    if (!best) {
      // the scaling stat is capped (e.g. EM/EM/EM supports): spend the rest on personal damage
      const fallback: Profile = { stat: 'atk', crit: true, amp: false };
      const base0 = profileValue(fallback, totalsWithSubs(base, liquid), char);
      for (const s of candidates) {
        if ((liquid[s] ?? 0) >= liquidCap(b, s)) continue;
        const gain = profileValue(fallback, totalsWithSubs(base, { ...liquid, [s]: (liquid[s] ?? 0) + 1 }), char) - base0;
        if (gain > bestGain + 1e-9) {
          bestGain = gain;
          best = s;
        }
      }
      best ??= (['er', 'hp%', 'def%'] as SubStat[]).find((s) => (liquid[s] ?? 0) < liquidCap(b, s)) ?? null;
      if (!best) break;
    }
    liquid[best] = (liquid[best] ?? 0) + 1;
    remaining--;
  }

  const final = totalsWithSubs(base, liquid);
  return { liquid, erMet, value: profileValue(b.profile, final, char), er: final.er };
}

function elementGoblet(char: CharData): Stat {
  return (char.element === 'physical' ? 'phys%' : `${char.element}%`) as Stat;
}

/** Try main stat combinations and keep the best one that meets the ER target. */
export function optimizeMains(b: CharBuild, char: CharData, weapon: WeaponData | undefined): CharBuild['main'] {
  const scaling: Stat = b.profile.stat === 'hp' ? 'hp%' : b.profile.stat === 'def' ? 'def%' : b.profile.stat === 'em' ? 'em' : 'atk%';
  const uniq = (xs: Stat[]) => [...new Set(xs)];
  const extra: Stat[] = b.profile.hpToAtk ? ['hp%'] : [];
  const sands = uniq([scaling, ...extra, 'er', 'em', 'atk%']);
  const goblet = uniq(b.profile.crit || b.profile.amp ? [elementGoblet(char), b.main.goblet, scaling, ...extra, 'em'] : [scaling, 'em', elementGoblet(char)]);
  // crit carries always run a crit circlet: the proxy ignores team ATK buffs, which would overrate ATK% circlets
  const circlet = uniq(b.profile.crit ? ['cr', 'cd'] : [scaling, 'em', 'heal']);

  let best: { main: CharBuild['main']; r: KqmsResult } | null = null;
  for (const s of sands) {
    for (const g of goblet) {
      for (const c of circlet) {
        const trial: CharBuild = { ...b, main: { sands: s, goblet: g, circlet: c } };
        const r = allocate(trial, char, weapon);
        if (
          !best ||
          (r.erMet && !best.r.erMet) ||
          (r.erMet === best.r.erMet && (r.erMet ? r.value > best.r.value * 1.0001 : r.er > best.r.er + 1e-6))
        ) {
          best = { main: trial.main, r };
        }
      }
    }
  }
  return best ? best.main : b.main;
}

/** Full KQMS pass: optional main stat search, then liquid allocation. */
export function generateKqms(b: CharBuild, char: CharData, weapon: WeaponData | undefined): CharBuild {
  const main = b.autoMain ? optimizeMains(b, char, weapon) : b.main;
  const withMain = { ...b, main };
  const r = allocate(withMain, char, weapon);
  return { ...withMain, liquid: r.liquid };
}

export function buildSummary(b: CharBuild, char: CharData, weapon: WeaponData | undefined) {
  if (b.statsMode === 'artifacts') return buildSummary({ ...b, statsMode: 'custom', customStats: gearStats(b.gear), sets: gearSets(b.gear) }, char, weapon);
  if (b.statsMode === 'custom') {
    // custom stats replace artifact main + sub stats entirely
    const t = baseTotals({ ...b, main: { sands: 'heal', goblet: 'heal', circlet: 'heal' } }, char, weapon);
    t.hp -= MAIN_VALUES.hp ?? 0;
    t.atk -= MAIN_VALUES.atk ?? 0;
    t.heal -= 3 * (MAIN_VALUES.heal ?? 0);
    for (const [k, v] of Object.entries(b.customStats ?? {})) t[k as Stat] += v ?? 0;
    return { ...finalStats(t), liquidUsed: 0 };
  }
  const base = baseTotals(b, char, weapon);
  const t = totalsWithSubs(base, b.liquid);
  const liquidUsed = SUB_ORDER.reduce((n, s) => n + (b.liquid[s] ?? 0), 0);
  return { ...finalStats(t), liquidUsed };
}

export function fmt(n: number): string {
  return String(Math.round(n * 10000) / 10000);
}

export function mainStatsLine(b: CharBuild): string {
  const acc = new Map<Stat, number>();
  for (const m of mainStatList(b)) acc.set(m, (acc.get(m) ?? 0) + (MAIN_VALUES[m] ?? 0));
  return [...acc].map(([k, v]) => `${k}=${fmt(v)}`).join(' ');
}

export function subStatsLine(b: CharBuild): string {
  return SUB_ORDER.map((s) => `${s}=${fmt(SUB_VALUES[s] * (FIXED_ROLLS + (b.liquid[s] ?? 0)))}`).join(' ');
}

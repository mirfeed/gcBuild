/** Apply sim-driven fixes back onto the project: ER requirements and gcsim-optimized substats. */
import { characters, getChar, weaponByKey } from '../data';
import type { ErStats } from './api';
import { buildSummary, generateKqms, SUB_ORDER } from './kqms';
import type { CharBuild, Project, SubStat } from './types';

export function teamKeyOf(gcsimName: string): string {
  const n = gcsimName.toLowerCase();
  return characters.find((x) => x.key === n || x.id === n || x.aliases.includes(n))?.key ?? n;
}

export interface ErVerdict {
  key: string;
  stats: ErStats;
  build: CharBuild | null;
  /** ER the builder assigns from static stats (what the KQMS target compares against) */
  staticEr: number | null;
  /** extra ER needed (negative = surplus) at the 80th percentile */
  delta: number;
  status: 'short' | 'ok' | 'surplus' | 'no-burst';
}

export function erVerdicts(p: Project, stats: ErStats[]): ErVerdict[] {
  return stats.map((s) => {
    const key = teamKeyOf(s.char);
    const build = p.team.find((b) => b?.key === key) ?? null;
    const char = getChar(key);
    const staticEr = build && char ? buildSummary(build, char, weaponByKey.get(build.weapon.key)).er : null;
    const delta = s.additional;
    let status: ErVerdict['status'] = 'ok';
    if (s.bursts < 2) status = 'no-burst';
    else if (delta > 0.005) status = 'short';
    else if (delta < -0.15) status = 'surplus';
    return { key, stats: s, build, staticEr, delta, status };
  });
}

/**
 * KQMS builds: move the ER target so the substats cover the requirement (also
 * releasing surplus ER into damage stats), then reallocate.
 * Custom builds: add the missing ER to their stats.
 */
export function applyErFix(p: Project, verdicts: ErVerdict[], onlyKey?: string): string[] {
  const msgs: string[] = [];
  for (const v of verdicts) {
    if (onlyKey && v.key !== onlyKey) continue;
    if (v.status === 'no-burst') continue;
    const i = p.team.findIndex((b) => b?.key === v.key);
    const b = p.team[i];
    const char = getChar(v.key);
    if (!b || !char) continue;
    const weapon = weaponByKey.get(b.weapon.key);
    if (b.statsMode === 'custom') {
      if (v.delta <= 0.005) continue;
      const add = Math.ceil(v.delta * 1000) / 1000;
      b.customStats = { ...b.customStats, er: Math.round(((b.customStats?.er ?? 0) + add) * 1000) / 1000 };
      msgs.push(`${char.name}: +${(add * 100).toFixed(1)}% ER added to stats`);
    } else {
      const staticEr = buildSummary(b, char, weapon).er;
      const target = Math.max(1, Math.ceil((staticEr + v.delta) * 1000) / 1000);
      const next = generateKqms({ ...b, erTarget: target }, char, weapon);
      next.subsFrom = 'heuristic';
      p.team[i] = next;
      msgs.push(`${char.name}: ER target ${(b.erTarget * 100).toFixed(0)}% → ${(target * 100).toFixed(1)}%`);
    }
  }
  return msgs;
}

/** Read `stat=value*count` substat lines written by `gcsim -substatOptim` into KQMS builds. */
export function applyOptimizedSubs(p: Project, optimized: string): string[] {
  const msgs: string[] = [];
  for (const line of optimized.split('\n')) {
    const m = /^\s*(\w+)\s+add\s+stats\s+([^;#]*\*[^;#]*);/.exec(line);
    if (!m) continue;
    const key = teamKeyOf(m[1]);
    const b = p.team.find((x) => x?.key === key);
    if (!b || b.statsMode === 'custom') continue;
    const liquid: Partial<Record<SubStat, number>> = {};
    for (const [, stat, count] of m[2].matchAll(/([\w%]+)=[\d.]+\*(\d+)/g)) {
      if ((SUB_ORDER as string[]).includes(stat)) liquid[stat as SubStat] = Math.max(0, +count - 2);
    }
    b.liquid = liquid;
    b.subsFrom = 'gcsim';
    const used = SUB_ORDER.reduce((n, s) => n + (liquid[s] ?? 0), 0);
    msgs.push(`${getChar(key)?.name ?? key}: ${SUB_ORDER.filter((s) => liquid[s]).map((s) => `${s} ${liquid[s]}`).join(', ')} (${used} liquid)`);
  }
  return msgs;
}

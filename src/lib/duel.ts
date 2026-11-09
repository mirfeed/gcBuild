/**
 * Duels: two players get the same squad and conditions (a duel code), change only their artifacts and the
 * rotation, and compete for DPS. Everything is simulated locally; the server (gcB-Bot) only coordinates and
 * compares numbers, each player's gcBuild re-runs the opponent's config to check it (server/duel.ts).
 */
import { characters, getChar, weapons } from '../data';
import { accountOf } from './artifacts';
import { generateConfig } from './config';
import { artifactSignature } from './enka';
import {
  checkDuelConfig, decodeDuel, DUEL_ITERATIONS, encodeDuel, variantOf,
  type DuelMode, type DuelSettings, type ResolvedChar,
} from './duelCode';
import { createBuild, DEFAULT_OPTIONS, emptyProject } from './project';
import { SLOTS, type Artifact, type CharBuild, type DuelInfo, type Project, type SimOptions } from './types';

export { decodeDuel, DUEL_ITERATIONS } from './duelCode';
export type { DuelSettings } from './duelCode';

/** The duel code for the open team (its characters, levels, constellations, talents and weapons). */
export function codeFromProject(p: Project, mode: DuelMode, duration: number): string {
  const team = p.team.filter((b): b is CharBuild => !!b);
  if (!team.length) throw new Error('the team is empty');
  const chars = team.map((b) => {
    const c = getChar(b.key);
    if (!c) throw new Error(`unknown character ${b.key}`);
    const w = weapons.find((x) => x.key === b.weapon.key);
    if (!w) throw new Error(`${c.name}: pick a weapon`);
    return {
      id: c.gameId,
      variant: variantOf(c.gameId, c.depot),
      level: b.level,
      cons: b.cons,
      talents: [...b.talents] as [number, number, number],
      weapon: w.gameId,
      weaponLevel: b.weapon.level,
      refine: b.weapon.refine,
    };
  });
  return encodeDuel({ mode, target: 'dummy', duration: Math.round(duration), chars });
}

/** gcsim keys for the duel's game ids (throws if this gcBuild doesn't know a character or weapon yet). */
export function resolveDuel(s: DuelSettings): ResolvedChar[] {
  return s.chars.map((d) => {
    const c = characters.find((x) => x.gameId === d.id && variantOf(x.gameId, x.depot) === d.variant);
    const w = weapons.find((x) => x.gameId === d.weapon);
    if (!c || !w) throw new Error('this duel has a character or weapon this gcBuild version does not know: update gcBuild');
    return { key: c.key, level: d.level, cons: d.cons, talents: d.talents, weaponKey: w.key, weaponLevel: d.weaponLevel, refine: d.refine };
  });
}

/** Fixed sim options of a duel: the same for both players, whatever the team's own settings say. */
function duelOptions(s: DuelSettings): SimOptions {
  return { ...DEFAULT_OPTIONS, iteration: DUEL_ITERATIONS, duration: s.duration, swapDelay: 12, hitlag: true, targetLvl: 100, targetResist: 0.1, targetCount: 1 };
}

/** Puts the duel's fixed values back onto a build (level, constellation, talents, weapon); artifacts stay. */
function lockBuild(b: CharBuild, r: ResolvedChar): CharBuild {
  return {
    ...b,
    key: r.key,
    level: r.level,
    cons: r.cons,
    talents: [...r.talents] as [number, number, number],
    weapon: { key: r.weaponKey, refine: r.refine, level: r.weaponLevel, params: {} },
    charParams: {},
    statsMode: 'artifacts',
    gear: b.gear ?? {},
  };
}

/** A new team tab for a duel the player just joined. */
export function projectFromDuel(info: DuelInfo): Project {
  const s = decodeDuel(info.code);
  const team = resolveDuel(s).map((r) => lockBuild(createBuild(r.key), r));
  const p = emptyProject();
  return {
    ...p,
    name: `⚔ ${info.opponent}`,
    team: [...team, ...Array(4 - team.length).fill(null)],
    active: team[0].key,
    options: duelOptions(s),
    duel: info,
  };
}

/** The config that is tested and submitted: the duel's fixed parts are enforced, whatever was edited. */
export function duelConfig(p: Project): string {
  if (!p.duel) return generateConfig(p);
  const s = decodeDuel(p.duel.code);
  const resolved = resolveDuel(s);
  const team = p.team.map((b) => {
    if (!b) return null;
    const r = resolved.find((x) => x.key === b.key);
    return r ? lockBuild(b, r) : null;
  });
  return generateConfig({ ...p, team, options: duelOptions(s) });
}

/** Problems that would make the server reject the config (shown before submitting). */
/**
 * Everything that keeps this duel team from being submitted. `inventory` = every account's artifacts: the whole
 * team must wear artifacts of one account (one GOOD import / Enka profile), each piece must still be in that
 * account's current inventory (not a copy kept from an older import or a saved build), and no piece twice.
 * Honour-based in the end (a GOOD file can be edited), but it rules out mixing several accounts.
 */
export function duelProblems(p: Project, config: string, inventory: Artifact[]): string[] {
  if (!p.duel) return [];
  const s = decodeDuel(p.duel.code);
  const problems = checkDuelConfig(config, s, resolveDuel(s));
  const worn: { who: string; slot: string; a: Artifact }[] = [];
  for (const b of p.team) {
    if (!b) continue;
    const who = getChar(b.key)?.name ?? b.key;
    if (!Object.values(b.gear ?? {}).some(Boolean)) problems.push(`${who}: no artifacts picked`);
    for (const slot of SLOTS) {
      const a = b.gear?.[slot];
      if (a) worn.push({ who, slot, a });
    }
  }
  const accounts = new Set(worn.map((w) => accountOf(w.a)));
  if (accounts.size > 1) problems.push('Artifacts from different accounts: in a duel the whole team uses one account (Artifacts → Account)');
  // pieces of each account still in its inventory, by content (ids change on every re-import)
  const left = new Map<string, number>();
  for (const a of inventory) {
    const k = `${accountOf(a)}#${artifactSignature(a)}`;
    left.set(k, (left.get(k) ?? 0) + 1);
  }
  for (const w of worn) {
    const k = `${accountOf(w.a)}#${artifactSignature(w.a)}`;
    const n = left.get(k) ?? 0;
    if (n > 0) left.set(k, n - 1);
    else problems.push(`${w.who}, ${w.slot}: this artifact isn't in the account's current inventory (or is worn twice): pick it again`);
  }
  return problems;
}

// ------------------------------------------------------------------ server API (through server/duel.ts)

export interface DuelPlayerView {
  tag: string;
  joined: boolean;
  submitted: boolean;
  /** this player's result was re-run by the other player: true = matched, false = didn't, null = not yet */
  verified: boolean | null;
  dps?: number;
}

export interface DuelView {
  id: string;
  code: string;
  mode: DuelMode;
  duration: number;
  gcsimVersion: string;
  state: 'accepted' | 'running' | 'verifying' | 'done' | 'cancelled' | 'expired';
  /** ms since epoch, server clock */
  startedAt?: number;
  deadline?: number;
  now: number;
  you: DuelPlayerView;
  opponent: DuelPlayerView;
  /** set when done */
  outcome?: { kind: 'win' | 'loss' | 'draw' | 'void' | 'unverified'; reason?: string };
}

async function call<T>(route: string, body: Record<string, unknown>): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/duel/${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    throw new Error('Local bridge unreachable.');
  }
  const data = await res.json().catch(() => ({ error: `error ${res.status}` }));
  if (!res.ok) throw Object.assign(new Error((data as { error?: string }).error ?? `error ${res.status}`), { status: res.status });
  return data as T;
}

export const duelApi = {
  join: (key: string) => call<DuelView>('join', { key }),
  state: (key: string) => call<DuelView>('state', { key }),
  submit: (key: string, config: string, dps: number, sd: number, chars: { name: string; dps: number }[]) =>
    call<DuelView>('submit', { key, config, dps, sd, chars }),
  verify: (key: string) => call<DuelView>('verify', { key }),
};

export function infoFromView(v: DuelView, key: string): DuelInfo {
  return { id: v.id, key, code: v.code, mode: v.mode, duration: v.duration, gcsimVersion: v.gcsimVersion, you: v.you.tag, opponent: v.opponent.tag };
}

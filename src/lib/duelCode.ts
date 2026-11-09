/**
 * Duel code and duel rules. Dependency-free: the same file lives in gcBuild (src/lib/duelCode.ts) and in
 * gcB-Bot (src/duel/code.ts). Keep them identical.
 *
 * A duel code holds only the fixed part of a duel: the squad (character, level, constellation, talents, weapon,
 * weapon level, refinement) and the conditions (mode, target preset, fight duration). Characters and weapons are
 * stored by their game ids, which never change, so a code stays readable across versions.
 *
 * Layout (bits, MSB first), then one CRC-8 byte, as base64url with a "GD-" prefix:
 *   version 4 | mode 1 | target 3 | duration 9 | count 3
 *   per character: id 8 (avatar id - 10000000) | variant 3 (traveler element) | level 8 | cons 3 |
 *                  talents 4+4+4 | weapon id 14 | weapon level 8 | refine 3
 * A level is 7 bits of level plus 1 "ascended" bit: 20/20 vs 20/40, 90/90 vs 90/95.
 */

export type DuelMode = 'base' | 'blind';
export const DUEL_TARGETS = ['dummy'] as const;
export type DuelTarget = (typeof DUEL_TARGETS)[number];

export interface DuelChar {
  /** game avatar id, e.g. 10000046 */
  id: number;
  /** traveler element (skill depot % 10), 0 for everyone else */
  variant: number;
  level: string;
  cons: number;
  talents: [number, number, number];
  /** game weapon id, e.g. 13501 */
  weapon: number;
  weaponLevel: string;
  refine: number;
}

export interface DuelSettings {
  mode: DuelMode;
  target: DuelTarget;
  /** fight duration, seconds */
  duration: number;
  chars: DuelChar[];
}

export const DUEL_PREFIX = 'GD-';
const VERSION = 1;
const CAPS = [20, 40, 50, 60, 70, 80, 90, 95, 100];
const TRAVELERS = new Set([10000005, 10000007]);

/** Traveler variant from the game's skill depot (502 = pyro aether → 2). */
export const variantOf = (gameId: number, depot: number) => (TRAVELERS.has(gameId) ? depot % 10 : 0);

// ------------------------------------------------------------------ levels

function encodeLevel(s: string): number {
  const m = /^\s*(\d+)\s*(?:\/\s*(\d+))?\s*$/.exec(s);
  if (!m) throw new Error(`unsupported level "${s}"`);
  const lvl = +m[1];
  const max = m[2] ? +m[2] : CAPS.find((c) => c >= lvl);
  if (lvl < 1 || lvl > 100 || max === undefined) throw new Error(`unsupported level "${s}"`);
  const base = CAPS.find((c) => c >= lvl);
  if (max === base) return lvl << 1;
  const next = CAPS[CAPS.indexOf(lvl) + 1];
  if (CAPS.includes(lvl) && max === next) return (lvl << 1) | 1;
  throw new Error(`unsupported level "${s}"`);
}

function decodeLevel(v: number): string {
  const lvl = v >> 1;
  if (lvl < 1 || lvl > 100) throw new Error('bad level');
  const max = v & 1 && CAPS.includes(lvl) ? CAPS[CAPS.indexOf(lvl) + 1] : CAPS.find((c) => c >= lvl);
  if (max === undefined) throw new Error('bad level');
  return `${lvl}/${max}`;
}

// ------------------------------------------------------------------ bits, crc, base64url

class BitWriter {
  private bits: number[] = [];
  put(value: number, width: number) {
    if (!Number.isInteger(value) || value < 0 || value >= 2 ** width) throw new Error(`value ${value} does not fit ${width} bits`);
    for (let i = width - 1; i >= 0; i--) this.bits.push((value >> i) & 1);
  }
  bytes(): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.bits.length; i += 8) {
      let b = 0;
      for (let j = 0; j < 8; j++) b = (b << 1) | (this.bits[i + j] ?? 0);
      out.push(b);
    }
    return out;
  }
}

class BitReader {
  private pos = 0;
  constructor(private data: number[]) {}
  get(width: number): number {
    let v = 0;
    for (let i = 0; i < width; i++) {
      const byte = this.data[this.pos >> 3];
      if (byte === undefined) throw new Error('code too short');
      v = v * 2 + ((byte >> (7 - (this.pos & 7))) & 1);
      this.pos++;
    }
    return v;
  }
}

function crc8(data: number[]): number {
  let c = 0;
  for (const b of data) {
    c ^= b;
    for (let i = 0; i < 8; i++) c = c & 0x80 ? ((c << 1) ^ 0x07) & 0xff : (c << 1) & 0xff;
  }
  return c;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function toB64(data: number[]): string {
  let out = '';
  for (let i = 0; i < data.length; i += 3) {
    const n = (data[i] << 16) | ((data[i + 1] ?? 0) << 8) | (data[i + 2] ?? 0);
    const chars = [n >> 18, (n >> 12) & 63, (n >> 6) & 63, n & 63].map((x) => B64[x]);
    out += chars.slice(0, Math.ceil(((Math.min(3, data.length - i)) * 8) / 6)).join('');
  }
  return out;
}

function fromB64(s: string): number[] {
  const vals = [...s].map((ch) => {
    const v = B64.indexOf(ch);
    if (v < 0) throw new Error('invalid character in code');
    return v;
  });
  const out: number[] = [];
  let acc = 0;
  let n = 0;
  for (const v of vals) {
    acc = (acc << 6) | v;
    n += 6;
    if (n >= 8) {
      n -= 8;
      out.push((acc >> n) & 0xff);
    }
  }
  return out;
}

// ------------------------------------------------------------------ code

export function encodeDuel(s: DuelSettings): string {
  if (!s.chars.length || s.chars.length > 4) throw new Error('a duel needs 1 to 4 characters');
  const w = new BitWriter();
  w.put(VERSION, 4);
  w.put(s.mode === 'blind' ? 1 : 0, 1);
  w.put(DUEL_TARGETS.indexOf(s.target), 3);
  w.put(Math.round(s.duration), 9);
  w.put(s.chars.length, 3);
  for (const c of s.chars) {
    w.put(c.id - 10000000, 8);
    w.put(c.variant, 3);
    w.put(encodeLevel(c.level), 8);
    w.put(c.cons, 3);
    for (const tv of c.talents) w.put(tv, 4);
    w.put(c.weapon, 14);
    w.put(encodeLevel(c.weaponLevel), 8);
    w.put(c.refine, 3);
  }
  const bytes = w.bytes();
  return DUEL_PREFIX + toB64([...bytes, crc8(bytes)]);
}

export function decodeDuel(code: string): DuelSettings {
  const body = code.trim().replace(/^GD-/i, '');
  if (!body) throw new Error('empty code');
  const all = fromB64(body);
  if (all.length < 3) throw new Error('code too short');
  const bytes = all.slice(0, -1);
  if (crc8(bytes) !== all[all.length - 1]) throw new Error('the code is damaged (copy it again)');
  const r = new BitReader(bytes);
  const version = r.get(4);
  if (version !== VERSION) throw new Error(`unsupported duel code version ${version}: update gcBuild`);
  const mode: DuelMode = r.get(1) ? 'blind' : 'base';
  const target = DUEL_TARGETS[r.get(3)];
  if (!target) throw new Error('unknown target preset: update gcBuild');
  const duration = r.get(9);
  const count = r.get(3);
  if (count < 1 || count > 4) throw new Error('bad character count');
  if (duration < 10) throw new Error('bad duration');
  const chars: DuelChar[] = [];
  for (let i = 0; i < count; i++) {
    const id = 10000000 + r.get(8);
    const variant = r.get(3);
    const level = decodeLevel(r.get(8));
    const cons = r.get(3);
    const talents: [number, number, number] = [r.get(4), r.get(4), r.get(4)];
    const weapon = r.get(14);
    const weaponLevel = decodeLevel(r.get(8));
    const refine = r.get(3);
    if (cons > 6 || refine < 1 || refine > 5 || talents.some((x) => x < 1 || x > 15)) throw new Error('bad character data in code');
    chars.push({ id, variant, level, cons, talents, weapon, weaponLevel, refine });
  }
  return { mode, target, duration, chars };
}

// ------------------------------------------------------------------ config rules

export const DUEL_ITERATIONS = 5000;
export const DUEL_MINUTES = 15;
/** extra time the server accepts after the deadline (network, the final sim run) */
export const DUEL_GRACE_SECONDS = 90;

/*
 * gcsim can't take a seed, so two runs of the same config differ. How much depends on the team (crit-heavy or
 * energy-starved teams are noisier): measured at 1000 iterations, Hu Tao NiMona ±0.03%, Raiden National ±0.3%.
 * Both limits below are therefore in standard errors, from the runs' own spread, with a fixed minimum.
 */

/** Largest allowed gap between a submitted DPS and the opponent's re-run, as a fraction of the DPS. */
export function rerunTolerance(sd: number, mean: number): number {
  const se = (Math.SQRT2 * sd) / Math.sqrt(DUEL_ITERATIONS) / mean; // difference of two independent runs
  return Math.max(0.003, 4 * (Number.isFinite(se) ? se : 0));
}

/** Gap between the two players' final DPS (each the average of two runs) under which it's a draw. */
export function drawBand(a: { sd: number; mean: number }, b: { sd: number; mean: number }): number {
  const n = 2 * DUEL_ITERATIONS;
  const se = Math.sqrt(a.sd ** 2 / n + b.sd ** 2 / n) / Math.max(a.mean, b.mean);
  return Math.max(0.001, 2 * (Number.isFinite(se) ? se : 0));
}

/** The fixed lines of a duel config, in gcBuild's generator format. */
export function duelHeader(s: Pick<DuelSettings, 'duration' | 'target'>) {
  return {
    options: `options iteration=${DUEL_ITERATIONS} duration=${s.duration} swap_delay=12`,
    target: 'target lvl=100 resist=0.1',
    energy: 'energy every interval=480,720 amount=1',
  };
}

/** A duel character with gcsim keys resolved (gcBuild's data in the app, gcBuild's gcsim.json on the bot). */
export interface ResolvedChar {
  key: string;
  level: string;
  cons: number;
  talents: [number, number, number];
  weaponKey: string;
  weaponLevel: string;
  refine: number;
}

/** gcsim script calls that would change the fight itself (end it early, move targets, fake energy, …) */
const FORBIDDEN_CALLS = ['kill_target', 'set_particle_delay', 'set_on_tick', 'set_target_pos', 'set_player_pos', 'set_default_target'];

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

/**
 * Checks a submitted config against the duel: the fixed lines and the squad must be exactly the duel's,
 * only sets, one artifact stats line per character and the rotation are free. Returns the problems (empty = ok).
 */
export function checkDuelConfig(config: string, s: DuelSettings, chars: ResolvedChar[]): string[] {
  const problems: string[] = [];
  const text = config.replace(/(#|\/\/).*$/gm, '');
  const statements = text.split(/[;{}]/).map(clean).filter(Boolean);
  const head = duelHeader(s);
  const keys = new Set(chars.map((c) => c.key));
  const seen = { options: 0, target: 0, energy: 0, char: new Map<string, number>(), weapon: new Map<string, number>(), stats: new Map<string, number>() };

  for (const st of statements) {
    const word = st.split(' ')[0];
    if (word === 'options') {
      seen.options++;
      if (st !== head.options) problems.push(`options changed: "${st}"`);
      continue;
    }
    if (word === 'target') {
      seen.target++;
      if (st !== head.target) problems.push(`target changed: "${st}"`);
      continue;
    }
    if (word === 'energy') {
      seen.energy++;
      if (st !== head.energy) problems.push(`energy changed: "${st}"`);
      continue;
    }
    if (word === 'hurt') {
      problems.push('hurt is not allowed');
      continue;
    }
    const m = /^(\w+) (char|add) ?(.*)$/.exec(st);
    if (!m) continue;
    const [, key, kind, rest] = m;
    if (!keys.has(key)) {
      problems.push(`character "${key}" is not in the duel`);
      continue;
    }
    const c = chars.find((x) => x.key === key)!;
    if (kind === 'char') {
      seen.char.set(key, (seen.char.get(key) ?? 0) + 1);
      const want = `lvl=${c.level} cons=${c.cons} talent=${c.talents.join(',')}`;
      if (rest !== want) problems.push(`${key}: level / constellation / talents changed`);
      continue;
    }
    const add = /^(\w+)/.exec(rest)?.[1];
    if (add === 'weapon' || rest.startsWith('weapon=')) {
      seen.weapon.set(key, (seen.weapon.get(key) ?? 0) + 1);
      const want = `weapon="${c.weaponKey}" refine=${c.refine} lvl=${c.weaponLevel}`;
      if (rest !== want) problems.push(`${key}: weapon changed`);
    } else if (rest.startsWith('set=')) {
      // own artifacts: any sets
    } else if (rest.startsWith('stats ')) {
      seen.stats.set(key, (seen.stats.get(key) ?? 0) + 1);
    } else {
      problems.push(`${key}: "add ${rest.split(' ')[0]}" is not allowed`);
    }
  }

  if (seen.options !== 1) problems.push('exactly one options line is needed');
  if (seen.target !== 1) problems.push('exactly one target line is needed');
  if (seen.energy !== 1) problems.push('exactly one energy line is needed');
  for (const c of chars) {
    if (seen.char.get(c.key) !== 1) problems.push(`${c.key}: exactly one char line is needed`);
    if (seen.weapon.get(c.key) !== 1) problems.push(`${c.key}: exactly one weapon line is needed`);
    if ((seen.stats.get(c.key) ?? 0) > 1) problems.push(`${c.key}: more than one stats line`);
  }
  for (const f of FORBIDDEN_CALLS) if (new RegExp(`\\b${f}\\s*\\(`).test(text)) problems.push(`${f}() is not allowed in a duel`);
  return problems;
}

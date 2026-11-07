/**
 * Readable names for gcsim status / modifier keys in the sample timeline, so it reads like the estimate:
 *   nob-4pc        -> Noblesse (+20% ATK)       (curated set effect, or "<set> 4pc")
 *   raiden-e       -> Eye of Stormy Judgment    (extracted skill status -> curated skill effect)
 *   bennett-field  -> Inspiration Field         (word match against the character's curated effects)
 *   fischl-c6-...  -> Fischl C6 …               (generic: character name + tidied rest)
 *   vvhydro        -> VV shred (Hydro)
 * Internal bookkeeping (ICDs, particle ICDs, weapon cooldowns, debounces) is flagged so the simple view
 * can hide it.
 */
import { characters, sets, weapons } from '../data';
import { CHAR_META, SET_EFFECTS, type EffectDef, type EffectKind } from '../data/curated';

export interface StatusInfo {
  label: string;
  kind: EffectKind;
  /** character the status comes from (its key), when known */
  owner?: string;
  /** cooldown / ICD / debounce bookkeeping */
  internal: boolean;
}

const INTERNAL = /icd|debounce|particle|recast|-limit$|-lock$|-cd$|_cd$|^.*cd$/i;
const ELEMENTS = ['pyro', 'hydro', 'electro', 'cryo', 'anemo', 'geo', 'dendro'];
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

const TOKEN: Record<string, string> = {
  e: 'E', q: 'Q', skill: 'E', burst: 'Q', atkp: 'ATK%', atk: 'ATK', em: 'EM', hp: 'HP', hpp: 'HP%', def: 'DEF', defp: 'DEF%',
  er: 'ER', cr: 'CR', cd: 'CD', na: 'NA', ca: 'CA', dmg: 'DMG', res: 'RES', buff: 'buff', field: 'field',
};

/** "c6-hexerei-atkp" -> "C6 hexerei ATK%" */
function tidy(rest: string): string {
  return rest
    .split(/[-_]+/)
    .filter(Boolean)
    .map((w) => {
      const l = w.toLowerCase();
      if (/^[ac]\d$/.test(l)) return l.toUpperCase();
      if (TOKEN[l]) return TOKEN[l];
      if (ELEMENTS.includes(l)) return cap(l);
      return l;
    })
    .join(' ');
}

const triggers = (e: EffectDef) => (Array.isArray(e.on) ? e.on : [e.on]);
const isSkill = (t: string) => t === 'skill' || t === 'skillPress' || t === 'skillHold';

/** Best curated effect of a character for a status (by trigger, then by a shared word). */
function curatedFor(charKey: string, statusKey: string, rest: string): EffectDef | undefined {
  const effects = CHAR_META[charKey]?.effects ?? [];
  // constellation / ascension statuses are their own thing, not the skill or burst effect
  if (!effects.length || /^[ac]\d/.test(rest.toLowerCase())) return undefined;
  const words = rest.toLowerCase().split(/[-_]+/).filter((w) => w.length >= 4 && !['burst', 'skill', 'buff'].includes(w));
  const byWord = effects.find((e) => words.some((w) => e.label.toLowerCase().includes(w)));
  if (byWord) return byWord;
  const extracted = characters.find((c) => c.key === charKey)?.statuses.find((s) => s.name === statusKey);
  const r = rest.toLowerCase();
  const on = extracted?.on ?? (r === 'burst' || r === 'q' ? 'burst' : r === 'skill' || r === 'e' ? 'skill' : '');
  if (!on) return undefined;
  const cands = effects.filter((e) => triggers(e).some((t) => (on === 'skill' ? isSkill(t) : t === on)) && !e.minCons);
  if (!cands.length) return undefined;
  const dur = extracted?.dur ?? 0;
  return [...cands].sort((a, b) => Math.abs(a.dur - dur) - Math.abs(b.dur - dur))[0];
}

/** Character whose key / alias starts the status key (team members first; short aliases only for them). */
function charPrefix(key: string, team: string[]): { key: string; rest: string } | undefined {
  const k = key.toLowerCase();
  let best: { key: string; rest: string; len: number } | undefined;
  for (const c of characters) {
    const inTeam = team.includes(c.key);
    for (const a of [c.key, ...c.aliases]) {
      if (a.length < (inTeam ? 2 : 4) || !k.startsWith(a)) continue;
      const rest = k.slice(a.length);
      // the alias has to end at a word boundary ("xl" + "c6" is fine: "c6" is a token)
      if (rest && !/^[-_]/.test(rest) && !/^(c\d|a\d|e|q|burst|skill)/.test(rest) && a.length < 5) continue;
      const score = a.length + (inTeam ? 100 : 0);
      if (!best || score > best.len) best = { key: c.key, rest: rest.replace(/^[-_]+/, ''), len: score };
    }
  }
  return best;
}

function kindOf(rest: string, curated?: EffectDef): EffectKind {
  if (curated?.kind) return curated.kind;
  const r = rest.toLowerCase();
  if (/debuff|shred|res\b|-res/.test(r)) return 'debuff';
  if (/field/.test(r)) return 'field';
  if (/shield/.test(r)) return 'shield';
  if (/^(burst|q|skill|e)$/.test(r) || /stance|state|mode/.test(r)) return 'state';
  return 'buff';
}

export function describeStatus(key: string, team: string[]): StatusInfo {
  const k = key.toLowerCase();
  const internal = INTERNAL.test(k);

  // VV shred: vvhydro / vv-pyro …
  const vv = /^vv-?(pyro|hydro|electro|cryo)$/.exec(k);
  if (vv) return { label: `VV shred (${cap(vv[1])})`, kind: 'debuff', internal: false };

  // artifact sets: nob-4pc, tom-4pc, celestialgift-4pc-active-buff
  const set = /^([a-z]+)-(2|4)pc(?:[-_](.*))?$/.exec(k);
  if (set) {
    const s = sets.find((x) => x.key === set[1] || x.aliases.includes(set[1]))
      ?? (set[1].length >= 3 ? sets.find((x) => x.key.startsWith(set[1]) || x.aliases.some((a) => a.startsWith(set[1]))) : undefined);
    const curated = s && set[2] === '4' && !set[3] ? SET_EFFECTS[s.key]?.[0] : undefined;
    const label = curated?.label ?? `${s?.name ?? cap(set[1])} ${set[2]}pc${set[3] ? ` (${tidy(set[3])})` : ''}`;
    return { label, kind: curated?.kind ?? kindOf(set[3] ?? ''), internal };
  }

  // a status gcsim lists for a team member's skill / burst (paramita, directive, oz-active, …)
  for (const tk of team) {
    const c = characters.find((x) => x.key === tk);
    if (!c?.statuses.some((st) => st.name === key)) continue;
    const rest = charPrefix(k, [tk])?.rest ?? k;
    const curated = internal ? undefined : curatedFor(tk, key, rest);
    return { label: curated?.label ?? `${c.name} ${tidy(rest)}`, kind: curated?.kind ?? (/^[ac]\d/.test(rest) ? 'buff' : 'state'), owner: tk, internal };
  }

  // character statuses
  const ch = charPrefix(k, team);
  if (ch) {
    const c = characters.find((x) => x.key === ch.key)!;
    const curated = internal ? undefined : curatedFor(ch.key, key, ch.rest);
    const label = curated?.label ?? (ch.rest ? `${c.name} ${tidy(ch.rest)}` : c.name);
    return { label, kind: kindOf(ch.rest, curated), owner: ch.key, internal };
  }

  // weapons: favonius-cd, sacrificial-cd, …
  const w = weapons.find((x) => k.startsWith(x.key) || x.aliases.some((a) => a.length >= 4 && k.startsWith(a)))
    ?? weapons.find((x) => k.split(/[-_]/)[0].length >= 5 && x.key.startsWith(k.split(/[-_]/)[0]));
  if (w) {
    const first = k.split(/[-_]/)[0];
    const rest = k.slice(first.length).replace(/^[-_]+/, '');
    const name = w.key.startsWith(first) && first !== w.key ? cap(first) : w.name;
    return { label: `${name}${rest ? ` ${tidy(rest)}` : ''}`, kind: 'buff', internal };
  }

  return { label: cap(tidy(k)), kind: kindOf(k), internal };
}

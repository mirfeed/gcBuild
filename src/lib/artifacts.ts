/**
 * Artifact inventory imported from a GOOD export (Genshin Optimizer, Inventory
 * Kamera, Irminsul, …). Only artifacts are imported; characters are put
 * together in the builder by picking an artifact per slot.
 *
 * Main stat values come from gcsim's table (rarity / level), substats are taken
 * as rolled; percent stats are converted to gcsim's fractions.
 */
import { useCallback, useState } from 'react';
import { artifactMain, characters, sets } from '../data';
import { SLOTS, type Artifact, type CharBuild, type Slot, type Stat } from './types';

const STAT: Record<string, Stat> = {
  hp: 'hp', hp_: 'hp%', atk: 'atk', atk_: 'atk%', def: 'def', def_: 'def%', eleMas: 'em', enerRech_: 'er',
  heal_: 'heal', critRate_: 'cr', critDMG_: 'cd', physical_dmg_: 'phys%', anemo_dmg_: 'anemo%', geo_dmg_: 'geo%',
  electro_dmg_: 'electro%', hydro_dmg_: 'hydro%', pyro_dmg_: 'pyro%', cryo_dmg_: 'cryo%', dendro_dmg_: 'dendro%',
};

const uid = () => Math.random().toString(36).slice(2, 10);
const norm = (k: string) => k.replace(/[^0-9a-z]/gi, '').toLowerCase();
const round = (v: number) => Math.round(v * 10000) / 10000;

interface GoodArtifact {
  setKey: string;
  slotKey: string;
  level: number;
  rarity: number;
  mainStatKey: string;
  location?: string;
  substats?: { key: string; value: number }[];
}

export interface ArtifactImport {
  artifacts: Artifact[];
  warnings: string[];
  source: string;
}

/** Parse the artifacts of a GOOD export (characters and weapons are ignored). */
export function parseGoodArtifacts(text: string): ArtifactImport {
  let data: { format?: string; source?: string; artifacts?: GoodArtifact[] };
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('not valid JSON');
  }
  if (!data || !Array.isArray(data.artifacts)) throw new Error('no "artifacts" in this file (is it a GOOD export?)');
  const warnings: string[] = [];
  const unknownSets = new Set<string>();
  const artifacts: Artifact[] = [];
  for (const a of data.artifacts) {
    const slot = a.slotKey as Slot;
    if (!SLOTS.includes(slot)) continue;
    const setKey = norm(a.setKey ?? '');
    const set = sets.find((s) => s.key === setKey || s.aliases.includes(setKey));
    if (!set) {
      unknownSets.add(a.setKey);
      continue;
    }
    const main = STAT[a.mainStatKey];
    const mainValue = artifactMain[String(a.rarity)]?.[a.mainStatKey]?.[a.level];
    if (!main || mainValue === undefined) {
      warnings.push(`skipped ${set.name} ${slot}: main stat ${a.mainStatKey} at ${a.rarity}★ +${a.level}`);
      continue;
    }
    const subs = (a.substats ?? [])
      .filter((s) => s.key && STAT[s.key])
      .map((s) => ({ stat: STAT[s.key], value: round(s.key.endsWith('_') ? s.value / 100 : s.value) }));
    const loc = a.location ? norm(a.location) : '';
    const locChar = loc
      ? characters.find((c) => c.id === loc || c.key === loc || c.aliases.includes(loc) || (loc === 'traveler' && c.id.startsWith('aether')))
      : undefined;
    artifacts.push({
      id: uid(),
      set: set.key,
      slot,
      rarity: a.rarity,
      level: a.level,
      main,
      mainValue: round(mainValue),
      subs,
      location: locChar?.key ?? (a.location || undefined),
    });
  }
  if (unknownSets.size) warnings.push(`unknown sets skipped: ${[...unknownSets].join(', ')}`);
  return { artifacts, warnings, source: data.source ?? 'GOOD' };
}

// ------------------------------------------------------------------ stats from gear

export function gearStats(gear: CharBuild['gear']): Partial<Record<Stat, number>> {
  const out: Partial<Record<Stat, number>> = {};
  const add = (s: Stat, v: number) => { out[s] = round((out[s] ?? 0) + v); };
  for (const slot of SLOTS) {
    const a = gear?.[slot];
    if (!a) continue;
    add(a.main, a.mainValue);
    for (const s of a.subs) add(s.stat, s.value);
  }
  return out;
}

/** Set bonuses from the equipped pieces, as gcsim counts them (2 / 4). */
export function gearSets(gear: CharBuild['gear']): CharBuild['sets'] {
  const tally = new Map<string, number>();
  for (const slot of SLOTS) {
    const a = gear?.[slot];
    if (a) tally.set(a.set, (tally.get(a.set) ?? 0) + 1);
  }
  return [...tally].filter(([, n]) => n >= 2).map(([key, n]) => ({ key, count: n >= 4 ? 4 : 2 }));
}

/** Crit value of the substats (2×CR + CD, in %). */
export function critValue(a: Artifact): number {
  let cv = 0;
  for (const s of a.subs) {
    if (s.stat === 'cr') cv += 200 * s.value;
    if (s.stat === 'cd') cv += 100 * s.value;
  }
  return Math.round(cv * 10) / 10;
}

export function subValue(a: Artifact, stat: Stat): number {
  return a.subs.find((s) => s.stat === stat)?.value ?? 0;
}

// ------------------------------------------------------------------ inventory store

const KEY = 'gcbuild.artifacts.v1';

function read(): Artifact[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as Artifact[]) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function useInventory() {
  const [items, setItems] = useState<Artifact[]>(read);
  const [error, setError] = useState<string | null>(null);

  const replace = useCallback((list: Artifact[]) => {
    setItems(list);
    try {
      localStorage.setItem(KEY, JSON.stringify(list));
      setError(null);
    } catch {
      setError('Browser storage is full: the inventory works for this session but will not be remembered.');
    }
  }, []);

  return { items, replace, clear: () => replace([]), error };
}

export type Inventory = ReturnType<typeof useInventory>;

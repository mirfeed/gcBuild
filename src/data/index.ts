import raw from './gcsim.json';
import type { CharData, SetData, WeaponData } from '../lib/types';

const data = raw as unknown as {
  characters: CharData[];
  weapons: WeaponData[];
  sets: SetData[];
  /** artifact main stat value by rarity ("1".."5") -> GOOD stat key -> level */
  artifactMain: Record<string, Record<string, number[]>>;
};

export const characters: CharData[] = data.characters;
export const weapons: WeaponData[] = data.weapons;
export const sets: SetData[] = data.sets;
export const artifactMain = data.artifactMain;

export const charByKey = new Map(characters.map((c) => [c.key, c]));
export const weaponByKey = new Map(weapons.map((w) => [w.key, w]));
export const setByKey = new Map(sets.map((s) => [s.key, s]));

export function getChar(key: string): CharData | undefined {
  return charByKey.get(key);
}

export const ELEMENT_COLORS: Record<string, string> = {
  pyro: '#ef7a35',
  hydro: '#33ccff',
  anemo: '#66d9b8',
  electro: '#c48cff',
  dendro: '#9bd441',
  cryo: '#9fe2f0',
  geo: '#f5b941',
  physical: '#c8c8c8',
};

import { CHAR_META } from '../data/curated';
import { getChar, weaponByKey, weapons } from '../data';
import { generateKqms } from './kqms';
import type { CharBuild, Profile, Project, RotationAction, SimOptions, Stat, WeaponType } from './types';

export const uid = () => Math.random().toString(36).slice(2, 10);

export const DEFAULT_OPTIONS: SimOptions = {
  iteration: 1000,
  duration: 90,
  swapDelay: 12,
  hitlag: true,
  targetLvl: 100,
  targetResist: 0.1,
  targetCount: 1,
  energyMode: 'every',
  energyMin: 480,
  energyMax: 720,
  energyAmount: 1,
};

const DEFAULT_WEAPON: Record<WeaponType, string> = {
  sword: 'favoniussword',
  claymore: 'favoniusgreatsword',
  polearm: 'favoniuslance',
  bow: 'favoniuswarbow',
  catalyst: 'favoniuscodex',
};

export function defaultRefine(weaponKey: string): number {
  const w = weaponByKey.get(weaponKey);
  return w && w.rarity >= 5 ? 1 : 5;
}

/** A fresh KQMS-style build: lvl 90, 9/9/9, 5* C0 / 4* C6, 5* R1 / 4* R5. */
export function createBuild(key: string): CharBuild {
  const char = getChar(key)!;
  const meta = CHAR_META[key]?.kqms;
  const profile: Profile = meta?.profile ?? { stat: 'atk', crit: true, amp: false };
  const element = (char.element === 'physical' ? 'phys%' : `${char.element}%`) as Stat;
  const scaling: Stat = profile.stat === 'hp' || profile.hpToAtk ? 'hp%' : profile.stat === 'def' ? 'def%' : profile.stat === 'em' ? 'em' : 'atk%';
  const weaponKey = weaponByKey.has(DEFAULT_WEAPON[char.weapon])
    ? DEFAULT_WEAPON[char.weapon]
    : weapons.find((w) => w.type === char.weapon)?.key ?? '';
  const setKey = char.element === 'anemo' ? 'viridescentvenerer' : profile.crit ? 'emblemofseveredfate' : 'noblesseoblige';
  const explicitMains = !!(meta?.sands && meta?.goblet && meta?.circlet);
  const b: CharBuild = {
    uid: uid(),
    key,
    level: '90/90',
    cons: char.rarity === 5 ? 0 : 6,
    talents: [9, 9, 9],
    weapon: { key: weaponKey, refine: defaultRefine(weaponKey), level: '90/90', params: {} },
    sets: [{ key: setKey, count: 4 }],
    main: {
      sands: meta?.sands ?? scaling,
      goblet: meta?.goblet ?? (profile.crit || profile.amp ? element : scaling),
      circlet: meta?.circlet ?? (profile.crit ? 'cr' : scaling),
    },
    liquid: {},
    erTarget: meta?.er ?? 1.2,
    profile,
    autoMain: !explicitMains,
    charParams: {},
  };
  return generateKqms(b, char, weaponByKey.get(weaponKey));
}

export function act(char: string, action: RotationAction['action'], extra: Partial<RotationAction> = {}): RotationAction {
  return { id: uid(), char, action, params: {}, repeat: 1, ...extra };
}

export function emptyProject(): Project {
  return {
    name: 'New team',
    team: [null, null, null, null],
    active: '',
    options: { ...DEFAULT_OPTIONS },
    rotation: { opener: [], loop: [], loopMode: 'while', loopCount: 5 },
  };
}

/** Raiden national, the classic example team. */
export function exampleProject(): Project {
  const team = ['raiden', 'xingqiu', 'xiangling', 'bennett'].map((k) => createBuild(k));
  const [raiden, xq, xl, ben] = team;
  raiden.weapon = { key: 'thecatch', refine: 5, level: '90/90', params: {} };
  xq.weapon = { key: 'sacrificialsword', refine: 5, level: '90/90', params: {} };
  xl.weapon = { key: 'thecatch', refine: 5, level: '90/90', params: {} };
  ben.weapon = { key: 'thealleyflash', refine: 5, level: '90/90', params: {} };
  ben.sets = [{ key: 'noblesseoblige', count: 4 }];
  const built = team.map((b) => generateKqms(b, getChar(b.key)!, weaponByKey.get(b.weapon.key)));
  return {
    name: 'Raiden National',
    team: built,
    active: 'raiden',
    options: { ...DEFAULT_OPTIONS },
    rotation: {
      opener: [],
      loop: [
        act('raiden', 'skill'),
        act('xingqiu', 'skill'),
        act('xingqiu', 'burst'),
        act('xingqiu', 'attack'),
        act('bennett', 'burst'),
        act('bennett', 'skill'),
        act('xiangling', 'burst'),
        act('xiangling', 'skill'),
        act('raiden', 'burst'),
        act('raiden', 'attack', { repeat: 3 }),
        act('raiden', 'charge'),
        act('raiden', 'attack', { repeat: 3 }),
        act('raiden', 'charge'),
        act('raiden', 'attack', { repeat: 3 }),
        act('raiden', 'charge'),
        act('bennett', 'attack', { repeat: 2 }),
        act('bennett', 'skill'),
        act('xingqiu', 'attack', { repeat: 5 }),
        act('xiangling', 'attack', { repeat: 5 }),
      ],
      loopMode: 'while',
      loopCount: 5,
    },
  };
}

export type Element = 'pyro' | 'hydro' | 'anemo' | 'electro' | 'dendro' | 'cryo' | 'geo' | 'physical';
export type WeaponType = 'sword' | 'claymore' | 'polearm' | 'bow' | 'catalyst';

/** gcsim stat keys as used in `add stats` lines. */
export type Stat =
  | 'hp' | 'hp%' | 'atk' | 'atk%' | 'def' | 'def%' | 'er' | 'em' | 'cr' | 'cd' | 'heal'
  | 'pyro%' | 'hydro%' | 'anemo%' | 'electro%' | 'dendro%' | 'cryo%' | 'geo%' | 'phys%';

export type SubStat = 'hp' | 'hp%' | 'atk' | 'atk%' | 'def' | 'def%' | 'er' | 'em' | 'cr' | 'cd';

/** Frame cancel table: `_` is the default, other keys are the next action. */
export type FrameSlice = { _: number } & Partial<Record<ActionType, number>>;

export interface CharData {
  key: string;
  id: string;
  name: string;
  element: Element;
  weapon: WeaponType;
  rarity: 4 | 5;
  energy: number;
  aliases: string[];
  base: { hp: number; atk: number; def: number };
  asc: Partial<Record<Stat, number>>;
  skillCD: number[];
  burstCD: number[];
  skillCharges: number;
  params: Record<string, Record<string, string>>;
  notes: Record<string, string>;
  frames: Record<string, FrameSlice>;
  statuses: { name: string; on: 'skill' | 'burst'; dur: number }[];
  /** game avatar id / skill depot (travelers) / talent skill ids, for Enka.Network imports */
  gameId: number;
  depot: number;
  skillIds: { attack: number; skill: number; burst: number };
}

export interface WeaponData {
  key: string;
  name: string;
  type: WeaponType;
  rarity: number;
  stats: Partial<Record<Stat, number>>;
  params: Record<string, string>;
  aliases: string[];
  gameId: number;
}

export interface SetData {
  key: string;
  name: string;
  params: Record<string, string>;
  aliases: string[];
  /** set name text hash (Enka's setNameTextMapHash) */
  textMapId: string;
}

export type ActionType =
  | 'skill' | 'burst' | 'attack' | 'charge' | 'high_plunge' | 'low_plunge'
  | 'aim' | 'dash' | 'jump' | 'swap' | 'walk';

export type ScalingStat = 'atk' | 'hp' | 'def' | 'em' | 'none';

export interface Profile {
  /** stat the damage scales on */
  stat: ScalingStat;
  /** include crit in the value function */
  crit: boolean;
  /** vaporize / melt multiplier from EM */
  amp: boolean;
  /** additive EM weight (e.g. Nahida's skill scales ATK + EM) */
  emWeight?: number;
  /** flat ATK gained per point of max HP (Hu Tao's Paramita: 0.0626) */
  hpToAtk?: number;
}

export type Slot = 'flower' | 'plume' | 'sands' | 'goblet' | 'circlet';
export const SLOTS: Slot[] = ['flower', 'plume', 'sands', 'goblet', 'circlet'];

/** One artifact from the imported inventory (values in gcsim units: 0.466 = 46.6%). */
export interface Artifact {
  id: string;
  set: string;
  slot: Slot;
  rarity: number;
  level: number;
  main: Stat;
  mainValue: number;
  subs: { stat: Stat; value: number }[];
  /** character wearing it in game, per the GOOD export (informational) */
  location?: string;
}

export interface CharBuild {
  uid: string;
  key: string;
  level: string;
  cons: number;
  talents: [number, number, number];
  weapon: { key: string; refine: number; level: string; params: Record<string, number> };
  sets: { key: string; count: number }[];
  main: { sands: Stat; goblet: Stat; circlet: Stat };
  /** liquid substat rolls (on top of the 2 fixed rolls per stat) */
  liquid: Partial<Record<SubStat, number>>;
  erTarget: number;
  profile: Profile;
  autoMain: boolean;
  /** free-form extra char params, e.g. start_energy */
  charParams: Record<string, number>;
  /**
   * 'kqms' = main + generated substats, 'artifacts' = picked from the artifact inventory,
   * 'custom' = raw stats (e.g. imported from a config)
   */
  statsMode?: 'kqms' | 'artifacts' | 'custom';
  customStats?: Partial<Record<Stat, number>>;
  /** artifacts mode: a copy of each equipped artifact (so saved builds survive re-imports) */
  gear?: Partial<Record<Slot, Artifact>>;
  /** where the current liquid substats came from (manual edits / gcsim optimizer aren't flagged as stale) */
  subsFrom?: 'heuristic' | 'gcsim' | 'manual';
}

export type CmpOp = '<' | '<=' | '>' | '>=' | '==' | '!=';

/** One comparison in a condition. `field` and `value` are gcsim script expressions. */
export interface Clause {
  field: string;
  op: CmpOp;
  value: string;
}

export interface Condition {
  join: 'and' | 'or';
  clauses: Clause[];
  /** what the timeline estimate assumes when it can't evaluate the condition */
  assume?: boolean;
}

export interface RotationAction {
  kind?: 'action';
  id: string;
  /** character key, or '' for wait/delay */
  char: string;
  action: ActionType | 'wait' | 'delay';
  params: Record<string, number>;
  repeat: number;
  /** legacy: wrap in `if .char.<action>.ready { ... }` (migrated to `cond`) */
  ifReady?: boolean;
  /** only run when this holds: `if <cond> { char action; }` */
  cond?: Condition;
  /** frames for wait / delay */
  frames?: number;
}

export interface IfBlock {
  kind: 'if';
  id: string;
  cond: Condition;
  then: RotItem[];
  else: RotItem[];
  /** UI only: shown as a one-line summary */
  collapsed?: boolean;
}

export interface RepeatBlock {
  kind: 'repeat';
  id: string;
  count: number;
  body: RotItem[];
  /** UI only: shown as a one-line summary */
  collapsed?: boolean;
}

/** verbatim gcsim script the builder doesn't model (functions, switch, ...) */
export interface RawBlock {
  kind: 'raw';
  id: string;
  text: string;
}

export type RotItem = RotationAction | IfBlock | RepeatBlock | RawBlock;
export type Block = IfBlock | RepeatBlock | RawBlock;

export type Section = 'opener' | 'loop';

export interface Rotation {
  opener: RotItem[];
  loop: RotItem[];
  loopMode: 'while' | 'for';
  loopCount: number;
}

export interface SimOptions {
  iteration: number;
  duration: number;
  swapDelay: number;
  hitlag: boolean;
  targetLvl: number;
  targetResist: number;
  targetCount: number;
  energyMode: 'every' | 'none';
  energyMin: number;
  energyMax: number;
  energyAmount: number;
  /** extra `key=value` tokens appended to the options line (e.g. imported ones) */
  extraOptions?: string;
  /** verbatim target / energy lines; when set they replace the generated ones */
  rawTargets?: string;
  rawEnergy?: string;
  /** every character starts with 0 energy (start_energy=0), e.g. Stygian Onslaught dummies */
  startEnergyZero?: boolean;
}

export interface Project {
  name: string;
  team: (CharBuild | null)[];
  active: string;
  options: SimOptions;
  rotation: Rotation;
}

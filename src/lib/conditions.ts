/**
 * Catalog of gcsim fields offered in the condition editor. Each entry knows how
 * to build its script expression and how to recognise it again when editing.
 * Values are stored as script expressions; units only affect how the editor
 * displays them (seconds for frames, % for ratios).
 */
import type { Clause, CmpOp } from './types';

export type Unit = 'bool' | 'frames' | 'ratio' | 'number' | 'char';
export type ArgKind = 'status' | 'mods' | 'infusion' | 'stat' | 'element' | 'coreStatus';

export interface FieldDef {
  id: string;
  label: string;
  scope: 'char' | 'global' | 'custom';
  unit: Unit;
  arg?: ArgKind;
  build: (char: string, arg: string) => string;
  match: (field: string) => { char: string; arg: string } | null;
  /** the timeline estimate can evaluate this field */
  estimable?: boolean;
  hint?: string;
}

const charField = (id: string, label: string, path: string, unit: Unit, extra: Partial<FieldDef> = {}): FieldDef => ({
  id,
  label,
  scope: 'char',
  unit,
  build: (c) => `.${c}.${path}`,
  match: (f) => {
    const m = new RegExp(`^\\.(\\w+)\\.${path.replace(/\./g, '\\.')}$`).exec(f.trim());
    return m ? { char: m[1], arg: '' } : null;
  },
  ...extra,
});

const charArgField = (id: string, label: string, prefix: string, unit: Unit, arg: ArgKind, hint?: string): FieldDef => ({
  id,
  label,
  scope: 'char',
  unit,
  arg,
  hint,
  build: (c, a) => `.${c}.${prefix}.${a || 'name'}`,
  match: (f) => {
    const m = new RegExp(`^\\.(\\w+)\\.${prefix}\\.(\\S+)$`).exec(f.trim());
    return m ? { char: m[1], arg: m[2] } : null;
  },
});

export const FIELDS: FieldDef[] = [
  charField('burst_ready', 'Burst ready', 'burst.ready', 'bool', { estimable: true }),
  charField('skill_ready', 'Skill ready', 'skill.ready', 'bool', { estimable: true }),
  charField('burst_cd', 'Burst cooldown left', 'burst.cd', 'frames', { estimable: true }),
  charField('skill_cd', 'Skill cooldown left', 'skill.cd', 'frames', { estimable: true }),
  charField('skill_charge', 'Skill charges', 'skill.charge', 'number', { estimable: true }),
  charField('hpratio', 'HP %', 'hpratio', 'ratio'),
  charField('hp', 'HP', 'hp', 'number'),
  charField('energy', 'Energy', 'energy', 'number'),
  {
    id: 'energy_ratio',
    label: 'Energy %',
    scope: 'char',
    unit: 'ratio',
    build: (c) => `.${c}.energy / .${c}.energymax`,
    match: (f) => {
      const m = /^\.(\w+)\.energy\s*\/\s*\.(\w+)\.energymax$/.exec(f.trim());
      return m && m[1] === m[2] ? { char: m[1], arg: '' } : null;
    },
  },
  charField('onfield', 'Is on field', 'onfield', 'bool', { estimable: true }),
  charField('normal', 'Next normal attack (N#)', 'normal', 'number', { estimable: true }),
  charArgField('status', 'Status time left', 'status', 'frames', 'status', 'status key, e.g. paramita'),
  charArgField('mods', 'Modifier time left', 'mods', 'frames', 'mods', 'modifier key, e.g. paramita'),
  charArgField('infusion', 'Infusion time left', 'infusion', 'frames', 'infusion'),
  charArgField('stat', 'Stat value', 'stats', 'number', 'stat'),
  charField('bolratio', 'Bond of Life %', 'bolratio', 'ratio'),
  charField('ns_state', 'Nightsoul state', 'nightsoul.state', 'bool'),
  charField('ns_points', 'Nightsoul points', 'nightsoul.points', 'number'),
  charField('cons', 'Constellation', 'cons', 'number', { estimable: true }),
  {
    id: 'element',
    label: 'Aura on target',
    scope: 'global',
    unit: 'number',
    arg: 'element',
    hint: 'remaining aura durability (0 = none)',
    build: (_c, a) => `.element.t1.${a || 'pyro'}`,
    match: (f) => {
      const m = /^\.element\.t\d+\.(\w+)$/.exec(f.trim());
      return m ? { char: '', arg: m[1] } : null;
    },
  },
  {
    id: 'rotation',
    label: 'Rotation # (0 = first loop)',
    scope: 'global',
    unit: 'number',
    estimable: true,
    hint: 'counts loop iterations: 0 on the first pass',
    build: () => 'rot',
    match: (f) => (f.trim() === 'rot' ? { char: '', arg: '' } : null),
  },
  {
    id: 'time',
    label: 'Sim time',
    scope: 'global',
    unit: 'frames',
    estimable: true,
    build: () => 'f()',
    match: (f) => (f.trim() === 'f()' ? { char: '', arg: '' } : null),
  },
  {
    id: 'core_status',
    label: 'Core status time left',
    scope: 'global',
    unit: 'frames',
    arg: 'coreStatus',
    build: (_c, a) => `.status.${a || 'name'}`,
    match: (f) => {
      const m = /^\.status\.(\S+)$/.exec(f.trim());
      return m ? { char: '', arg: m[1] } : null;
    },
  },
  {
    id: 'prev_char',
    label: 'Previous character',
    scope: 'global',
    unit: 'char',
    build: () => '.previous-char',
    match: (f) => (f.trim() === '.previous-char' ? { char: '', arg: '' } : null),
  },
  {
    id: 'stam',
    label: 'Stamina',
    scope: 'global',
    unit: 'number',
    build: () => '.stam',
    match: (f) => (f.trim() === '.stam' ? { char: '', arg: '' } : null),
  },
  {
    id: 'custom',
    label: 'Custom expression',
    scope: 'custom',
    unit: 'number',
    build: (_c, a) => a,
    match: () => null,
  },
];

export const ELEMENTS = ['pyro', 'hydro', 'anemo', 'electro', 'dendro', 'cryo', 'geo', 'frozen', 'quicken', 'burning'];
export const STAT_KEYS = ['hp', 'hp%', 'atk', 'atk%', 'def', 'def%', 'er', 'em', 'cr', 'cd', 'heal', 'pyro%', 'hydro%', 'cryo%', 'electro%', 'anemo%', 'geo%', 'dendro%', 'phys%', 'atkspd%', 'dmg%'];
export const OPS: CmpOp[] = ['<', '<=', '>', '>=', '==', '!='];

export function fieldOf(clause: Clause): { def: FieldDef; char: string; arg: string } {
  for (const def of FIELDS) {
    const m = def.match(clause.field);
    if (m) return { def, ...m };
  }
  return { def: FIELDS.find((f) => f.id === 'custom')!, char: '', arg: clause.field };
}

/** Script value -> number shown in the editor. */
export function displayValue(unit: Unit, value: string): string {
  const n = Number(value);
  if (value.trim() === '' || Number.isNaN(n)) return value;
  if (unit === 'frames') return String(Math.round((n / 60) * 100) / 100);
  if (unit === 'ratio') return String(Math.round(n * 10000) / 100);
  return value;
}

/** Number typed in the editor -> script value. */
export function scriptValue(unit: Unit, shown: string): string {
  const n = Number(shown);
  if (shown.trim() === '' || Number.isNaN(n)) return shown;
  if (unit === 'frames') return String(Math.round(n * 60));
  if (unit === 'ratio') return String(Math.round(n * 100) / 10000);
  return shown;
}

export const unitSuffix = (u: Unit) => (u === 'frames' ? 's' : u === 'ratio' ? '%' : '');

export function isEstimable(clause: Clause): boolean {
  const { def } = fieldOf(clause);
  return !!def.estimable && /^-?\d+(\.\d+)?$/.test(clause.value.trim());
}

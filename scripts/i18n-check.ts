/**
 * Lists UI strings without a Russian translation and translations nobody uses.
 *   npm run i18n-check
 * Literal keys are found as t('…') / t("…") calls in src/; keys passed through variables
 * (stat names, slots, presets, condition fields…) are listed in DYNAMIC below.
 */
import fs from 'node:fs';
import path from 'node:path';
import { RU } from '../src/i18n/ru';
import { FIELDS } from '../src/lib/conditions';
import { TARGET_PRESETS } from '../src/components/ConfigPanel';

const DYNAMIC = [
  // elements, weapon types
  'Pyro', 'Hydro', 'Anemo', 'Electro', 'Dendro', 'Cryo', 'Geo', 'sword', 'claymore', 'polearm', 'bow', 'catalyst',
  // stat names (CharCard STAT_LABEL)
  'ATK%', 'HP%', 'DEF%', 'ER', 'EM', 'Crit Rate', 'Crit DMG', 'Healing', 'Pyro DMG', 'Hydro DMG', 'Anemo DMG', 'Electro DMG',
  'Dendro DMG', 'Cryo DMG', 'Geo DMG', 'Phys DMG', 'ATK', 'HP', 'DEF',
  // slots, artifact sorts
  'Flower', 'Plume', 'Sands', 'Goblet', 'Circlet', 'Crit value', 'CR', 'CD', 'Level',
  // timeline kinds, wait reasons
  'Field', 'Buff', 'Debuff', 'Shield', 'State', 'Summon', 'Cooldown',
  'waiting for energy', 'waiting for stamina', 'waiting for swap', 'waiting for E cooldown', 'waiting for Q cooldown', 'waiting for dash',
  // sample timeline toggles, if branches, palette buttons
  'damage', 'energy', 'hp', 'statuses', 'cooldowns', 'icds', 'then', 'else', 'body',
  'E hold', 'Aim', 'Plunge', 'Dash', 'Jump',
  ...TARGET_PRESETS.flatMap((p) => [p.label, p.note]),
  ...FIELDS.flatMap((f) => [f.label, ...(f.hint ? [f.hint] : [])]),
];

const root = path.resolve(import.meta.dirname, '..', 'src');
const files: string[] = [];
const walk = (d: string) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.tsx?$/.test(e.name) && !p.includes(`${path.sep}i18n${path.sep}`)) files.push(p);
  }
};
walk(root);

const used = new Set<string>(DYNAMIC);
const re = /\bt\(\s*(['"])((?:\\.|(?!\1).)*)\1/g;
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  for (const m of src.matchAll(re)) used.add(m[2].replace(/\\(['"\\])/g, '$1'));
}

// strings that are the same in Russian (codes, abbreviations) don't need an entry
const SAME = new Set(['ER', 'EM', 'ATK', 'HP', 'DEF', 'ATK%', 'HP%', 'DEF%', 'CR', 'CD']);
const missing = [...used].filter((k) => !(k in RU) && !SAME.has(k)).sort();
const unused = Object.keys(RU).filter((k) => !used.has(k)).sort();

console.log(`${used.size} keys used, ${Object.keys(RU).length} translated`);
if (missing.length) console.log(`\nmissing (${missing.length}):\n${missing.map((k) => `  ${JSON.stringify(k)}`).join('\n')}`);
if (unused.length) console.log(`\nunused (${unused.length}):\n${unused.map((k) => `  ${JSON.stringify(k)}`).join('\n')}`);
process.exitCode = missing.length ? 1 : 0;

// Headless smoke test: builds the example project, prints the config and a timeline summary.
import { exampleProject, createBuild } from '../src/lib/project';
import { generateConfig } from '../src/lib/config';
import { simulate } from '../src/lib/timeline';
import { buildSummary } from '../src/lib/kqms';
import { getChar, weaponByKey } from '../src/data';

const p = exampleProject();
console.log(generateConfig(p));
const tl = simulate(p, 2);
console.log('loop length (s):', tl.loopLength && (tl.loopLength / 60).toFixed(2), 'end', (tl.end / 60).toFixed(2));
for (const s of tl.steps.slice(0, 20)) console.log(s.loop, s.char.padEnd(10), s.label.padEnd(8), (s.start / 60).toFixed(2), (s.end / 60).toFixed(2), s.waited, s.warnings.join('; '));
console.log('bars:', tl.bars.length);
for (const b of tl.bars.filter((b) => b.kind !== 'cd').slice(0, 25)) console.log('  ', b.lane.padEnd(10), b.label.padEnd(34), (b.start / 60).toFixed(2), (b.end / 60).toFixed(2));
console.log('warnings', tl.warnings);
for (const k of ['hutao', 'nahida', 'kazuha', 'furina', 'zhongli', 'eula', 'neuvillette', 'ganyu']) {
  const b = createBuild(k);
  const s = buildSummary(b, getChar(k)!, weaponByKey.get(b.weapon.key));
  console.log(k.padEnd(12), JSON.stringify(b.main), JSON.stringify(b.liquid), 'ER', (s.er * 100).toFixed(1), 'CR', (s.cr * 100).toFixed(1), 'CD', (s.cd * 100).toFixed(1), 'used', s.liquidUsed);
}

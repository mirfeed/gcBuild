/**
 * Round trip of the text notation: rotation -> text -> rotation must keep actions, blocks and conditions.
 *   npm run notation-check
 */
import { getChar } from '../src/data';
import { parseCondition } from '../src/lib/importConfig';
import { parseNotation } from '../src/lib/notationImport';
import { act, uid } from '../src/lib/project';
import { condToScript, isAction, notation, readyCond } from '../src/lib/rotation';
import type { RotItem } from '../src/lib/types';

const name = (k: string) => (getChar(k)?.name ?? k).replace(/[^0-9A-Za-z]/g, '');
const text = (items: RotItem[]) => notation(items, true, { name, sep: ' ' });
const team = ['ineffa', 'columbina', 'sucrose', 'flins'];
const iff = (cond: string | ReturnType<typeof readyCond>, then: RotItem[], els: RotItem[] = []): RotItem => ({
  kind: 'if', id: uid(), cond: typeof cond === 'string' ? parseCondition(cond) : cond, then, else: els,
});

// the rotation from the bug report (conditions on rotation parity, burst / skill readiness)
const loop: RotItem[] = [
  iff('(is_even(rot) != 0) && (.ineffa.burst.ready == 1)', [act('ineffa', 'burst')], [act('ineffa', 'skill'), act('ineffa', 'attack', { repeat: 1 })]),
  act('columbina', 'skill'),
  iff('(is_even(rot) == 0) && (.columbina.burst.ready == 1)', [act('columbina', 'burst')], [act('columbina', 'attack', { repeat: 1 })]),
  act('sucrose', 'attack', { repeat: 1 }), act('sucrose', 'skill'), act('sucrose', 'dash'),
  iff(readyCond('sucrose', 'burst'), [act('sucrose', 'burst')]),
  act('flins', 'skill'), act('flins', 'attack', { repeat: 4 }), act('flins', 'dash'),
  { ...act('flins', 'burst'), cond: parseCondition('.flins.hpratio < 0.5') },
  { ...act('flins', 'skill'), cond: readyCond('flins', 'skill') },
  iff('.sucrose.skill.ready == 1', [act('sucrose', 'attack', { repeat: 1 }), act('sucrose', 'skill'), act('sucrose', 'dash')],
    [act('sucrose', 'attack', { repeat: 2 }), act('sucrose', 'charge'), act('', 'wait', { frames: 8 })]),
];

/** structure + conditions, ids left out */
const shape = (items: RotItem[]): unknown => items.map((x) => {
  if (isAction(x)) return [x.char, x.action, x.repeat, x.frames ?? null, x.cond ? condToScript(x.cond) : null];
  if (x.kind === 'if') return ['if', condToScript(x.cond), shape(x.then), shape(x.else)];
  if (x.kind === 'repeat') return ['repeat', x.count, shape(x.body)];
  return ['raw', x.text];
});

const t1 = text(loop);
const back = parseNotation(t1, team);
const t2 = text(back.items);
const same = JSON.stringify(shape(loop)) === JSON.stringify(shape(back.items));
console.log(`text:   ${t1}`);
if (back.errors.length) console.log(`errors: ${back.errors.join('; ')}`);
console.log(same && t1 === t2 ? 'round trip OK' : `MISMATCH\nback:   ${t2}\n${JSON.stringify(shape(loop))}\n${JSON.stringify(shape(back.items))}`);
process.exitCode = same && t1 === t2 && !back.errors.length ? 0 : 1;

/**
 * Parse a rotation written in community notation, e.g.
 *   "Nicole QE Citlali E Yelan Q N1 E N1 E N1 HuTao E 10N2CD Q"
 * into rotation items. Grammar (case-insensitive):
 *   name          switches the acting character (HuTao, "Hu Tao", gcsim keys / shortcuts)
 *   N2 C|CA D J E hE Q A P LP   attack:2, charge, dash, jump, skill, hold skill, burst, aim, plunges
 *   X?            the action only runs if ready (skill / burst)
 *   10N2CD | 10(…) repeat; groups may contain spaces and other characters
 *   [then | else]? if block: "?" = the first action's skill / burst is ready (or burst ready)
 *   X?{expr} / [..]?{expr}  any other condition, as gcsim script: Q?{.hutao.hpratio < 0.5}
 *   wait30 / delay30
 */
import { characters } from '../data';
import { uid } from './project';
import { parseCondition } from './importConfig';
import { readyCond } from './rotation';
import type { ActionType, RotationAction, RotItem } from './types';

export interface NotationParse {
  items: RotItem[];
  errors: string[];
  /** characters used by the text, in order of first appearance */
  chars: string[];
}

const norm = (s: string) => s.toLowerCase().replace(/[^0-9a-z]/g, '');

function charCandidates(c: (typeof characters)[number]): string[] {
  return [c.key, c.id, ...c.aliases, norm(c.name), norm(c.name.split(' ')[0])].map(norm);
}

/** Resolve a name; characters already in the team win ties (e.g. travelers). */
export function resolveChar(word: string, team: string[]): string | undefined {
  const w = norm(word);
  if (!w) return undefined;
  const pool = [...characters].sort((a, b) => Number(team.includes(b.key)) - Number(team.includes(a.key)));
  return pool.find((c) => charCandidates(c).includes(w))?.key;
}

const SEPARATORS = new Set([' ', '\t', '\n', '\r', ',', '·', '>', '→', '-']);

export function parseNotation(text: string, team: string[]): NotationParse {
  const errors: string[] = [];
  const chars: string[] = [];
  let i = 0;
  let cur = '';

  const use = (k: string) => {
    cur = k;
    if (!chars.includes(k)) chars.push(k);
  };
  const act = (action: RotationAction['action'], extra: Partial<RotationAction> = {}): RotationAction => ({
    id: uid(), char: action === 'wait' || action === 'delay' ? '' : cur, action, params: {}, repeat: 1, ...extra,
  });

  /** "{…}" right after "?": a gcsim condition (balanced braces / parentheses allowed inside) */
  const readCond = (): string | null => {
    if (text[i] !== '{') return null;
    let depth = 0;
    const start = i + 1;
    for (; i < text.length; i++) {
      if (text[i] === '{') depth++;
      else if (text[i] === '}' && --depth === 0) {
        const expr = text.slice(start, i).trim();
        i++;
        return expr;
      }
    }
    errors.push('missing "}"');
    return text.slice(start).trim();
  };

  const skipSep = () => {
    while (i < text.length && SEPARATORS.has(text[i])) i++;
  };
  const readWord = () => {
    const start = i;
    while (i < text.length && !SEPARATORS.has(text[i]) && !'()[]|{}'.includes(text[i])) i++;
    return text.slice(start, i);
  };

  /** Actions inside one word, e.g. "QE", "N2CD", "10N2CD", "hE?". */
  const parseWord = (w: string): RotItem[] => {
    const out: RotItem[] = [];
    const s = w.toLowerCase();
    let j = 0;
    while (j < s.length) {
      const rest = s.slice(j);
      let m: RegExpExecArray | null;
      if ((m = /^(\d+)/.exec(rest))) {
        // "10N2CD": the rest of the word repeats
        const body = parseWord(w.slice(j + m[1].length));
        if (body.length) out.push({ kind: 'repeat', id: uid(), count: Math.max(1, +m[1]), body });
        else errors.push(`"${w}": nothing to repeat after ${m[1]}`);
        return out;
      }
      if (!cur) {
        errors.push(`"${w}": no character before this action`);
        return out;
      }
      let a: RotationAction | null = null;
      let len = 1;
      if ((m = /^n(\d*)/.exec(rest))) {
        a = act('attack', { repeat: Math.max(1, +(m[1] || 1)) });
        len = m[0].length;
      } else if (rest.startsWith('ca')) {
        a = act('charge');
        len = 2;
      } else if (rest.startsWith('he')) {
        a = act('skill', { params: { hold: 1 } });
        len = 2;
      } else if (rest.startsWith('te')) {
        a = act('skill');
        len = 2;
      } else if (rest.startsWith('lp')) {
        a = act('low_plunge');
        len = 2;
      } else {
        const one: Record<string, ActionType> = { e: 'skill', q: 'burst', c: 'charge', d: 'dash', j: 'jump', a: 'aim', p: 'high_plunge' };
        if (one[rest[0]]) a = act(one[rest[0]]);
        else if (rest[0] === '?') {
          const last = out[out.length - 1];
          if (last && !('kind' in last && last.kind !== 'action')) {
            const l = last as RotationAction;
            l.cond = readyCond(l.char, l.action === 'skill' ? 'skill' : 'burst');
          }
          j++;
          continue;
        } else {
          errors.push(`"${w}": unknown symbol "${w[j]}"`);
          return out;
        }
      }
      out.push(a!);
      j += len;
    }
    return out;
  };

  /** A sequence until `stop` (")" / "]" / "|") or the end. */
  const parseSeq = (stops: string): RotItem[] => {
    const out: RotItem[] = [];
    while (true) {
      skipSep();
      if (i >= text.length || stops.includes(text[i])) return out;
      const ch = text[i];
      if (ch === '[') {
        i++;
        const then = parseSeq('|]');
        let els: RotItem[] = [];
        if (text[i] === '|') {
          i++;
          els = parseSeq(']');
        }
        if (text[i] === ']') i++;
        else errors.push('missing "]"');
        if (text[i] === '?') i++;
        const expr = readCond();
        const first = then.find((x): x is RotationAction => !('kind' in x) || x.kind === 'action');
        const cond = expr
          ? parseCondition(expr)
          : first && (first.action === 'skill' || first.action === 'burst')
            ? readyCond(first.char, first.action)
            : readyCond(cur || team[0] || 'char', 'burst');
        out.push({ kind: 'if', id: uid(), cond, then, else: els });
        continue;
      }
      if (ch === '{') {
        errors.push(`"{${readCond()}}" needs an action or [block] before it`);
        continue;
      }
      if (ch === '(' || ch === ')' || ch === ']' || ch === '|' || ch === '}') {
        errors.push(`unexpected "${ch}"`);
        i++;
        continue;
      }
      const word = readWord();
      // "10(...)": a repeated group
      if (/^\d+$/.test(word) && text[i] === '(') {
        i++;
        const body = parseSeq(')');
        if (text[i] === ')') i++;
        else errors.push('missing ")"');
        if (body.length) out.push({ kind: 'repeat', id: uid(), count: Math.max(1, +word), body });
        continue;
      }
      const wl = word.toLowerCase();
      const wait = /^(wait|delay|w)(\d+)$/.exec(wl);
      if (wait) {
        out.push(act(wait[1] === 'delay' ? 'delay' : 'wait', { frames: +wait[2] }));
        continue;
      }
      // a character name; two words first ("Hu Tao", "Raiden Shogun"), then one
      const save = i;
      skipSep();
      const next = readWord();
      let k = next ? resolveChar(word + next, team) : undefined;
      if (!k) {
        i = save;
        k = resolveChar(word, team);
      }
      if (k) {
        use(k);
        continue;
      }
      out.push(...parseWord(word));
      // "Q?{expr}": the condition of the action just read
      const expr = readCond();
      if (expr !== null) {
        const last = out[out.length - 1];
        if (last && (!('kind' in last) || last.kind === 'action')) (last as RotationAction).cond = parseCondition(expr);
        else errors.push(`"{${expr}}" needs an action before it`);
      }
    }
  };

  const items = parseSeq('');
  while (i < text.length) {
    errors.push(`unexpected "${text[i]}"`);
    i++;
    items.push(...parseSeq(''));
  }
  return { items, errors, chars };
}

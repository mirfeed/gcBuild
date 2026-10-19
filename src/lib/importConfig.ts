/**
 * Import an existing gcsim config into a project. Character builds keep their
 * exact stats ('custom' stats mode). The script becomes rotation items where
 * it maps cleanly (actions, wait/delay, if/else, counted for loops, a final
 * while/for loop); everything else is kept verbatim as script blocks.
 */
import { characters, sets, weapons } from '../data';
import { DEFAULT_OPTIONS, uid } from './project';
import { isAction } from './rotation';
import type { ActionType, CharBuild, Clause, CmpOp, Condition, Project, RotItem, Stat } from './types';

const ACTIONS = new Set(['skill', 'burst', 'attack', 'charge', 'high_plunge', 'low_plunge', 'aim', 'dash', 'jump', 'swap', 'walk']);
const HEADER_KEYWORDS = new Set(['options', 'target', 'energy', 'hurt', 'active']);
const STATS = new Set<Stat>(['hp', 'hp%', 'atk', 'atk%', 'def', 'def%', 'er', 'em', 'cr', 'cd', 'heal', 'pyro%', 'hydro%', 'anemo%', 'electro%', 'dendro%', 'cryo%', 'geo%', 'phys%']);

function lookup<T extends { key: string; aliases: string[] }>(list: T[], name: string): T | undefined {
  const n = name.toLowerCase();
  return list.find((x) => x.key === n) ?? list.find((x) => x.aliases.includes(n));
}

function charKey(name: string): string | undefined {
  const n = name.toLowerCase();
  const c = characters.find((x) => x.key === n) ?? characters.find((x) => x.id === n || x.aliases.includes(n));
  return c?.key;
}

// ------------------------------------------------------------------ statement scanner

/** Remove `#` / `//` comments (outside strings) and keep line structure. */
function stripComments(src: string): string {
  return src
    .split('\n')
    .map((line) => {
      let inStr = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') inStr = !inStr;
        if (!inStr && (ch === '#' || (ch === '/' && line[i + 1] === '/'))) return line.slice(0, i);
      }
      return line;
    })
    .join('\n');
}

/** Split source into top-level statements: `...;` or `keyword ... { ... }` (+ else chains). */
function statements(src: string): string[] {
  const out: string[] = [];
  let i = 0;
  const n = src.length;
  const skipWs = () => {
    while (i < n && /\s/.test(src[i])) i++;
  };
  const readBlock = (from: number) => {
    // from points at '{'
    let depth = 0;
    let j = from;
    for (; j < n; j++) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}') {
        depth--;
        if (depth === 0) return j + 1;
      }
    }
    return n;
  };
  while (true) {
    skipWs();
    if (i >= n) break;
    const start = i;
    const word = /^[A-Za-z_]\w*/.exec(src.slice(i))?.[0] ?? '';
    if (['for', 'while', 'if', 'fn', 'switch'].includes(word)) {
      let j = src.indexOf('{', i);
      if (j < 0) {
        out.push(src.slice(start).trim());
        break;
      }
      i = readBlock(j);
      // else / else if chains
      while (true) {
        const rest = src.slice(i);
        const m = /^\s*else\b/.exec(rest);
        if (!m) break;
        j = src.indexOf('{', i + m[0].length);
        if (j < 0) break;
        i = readBlock(j);
      }
      out.push(src.slice(start, i).trim());
      continue;
    }
    let depth = 0;
    let j = i;
    for (; j < n; j++) {
      const ch = src[j];
      if (ch === '{' || ch === '(' || ch === '[') depth++;
      else if (ch === '}' || ch === ')' || ch === ']') depth--;
      else if (ch === ';' && depth <= 0) break;
    }
    out.push(src.slice(start, j).trim());
    i = j + 1;
  }
  return out.filter(Boolean);
}

function blockBody(stmt: string, from = 0): { body: string; end: number } {
  const open = stmt.indexOf('{', from);
  let depth = 0;
  for (let j = open; j < stmt.length; j++) {
    if (stmt[j] === '{') depth++;
    else if (stmt[j] === '}') {
      depth--;
      if (depth === 0) return { body: stmt.slice(open + 1, j), end: j + 1 };
    }
  }
  return { body: stmt.slice(open + 1), end: stmt.length };
}

// ------------------------------------------------------------------ key=value lists

function kvPairs(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /(\+?[\w%]+)\s*=\s*(\[[^\]]*\]|"[^"]*"|[^\s]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out[m[1]] = m[2].replace(/^"|"$/g, '');
  return out;
}

function paramList(text: string | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  if (!text) return out;
  for (const part of text.replace(/^\[|\]$/g, '').split(',')) {
    const [k, v] = part.split('=').map((s) => s.trim());
    if (k && v !== undefined && !Number.isNaN(+v)) out[k] = +v;
  }
  return out;
}

// ------------------------------------------------------------------ conditions

function splitTop(expr: string, sep: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i];
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (depth === 0 && expr.startsWith(sep, i)) {
      parts.push(cur);
      cur = '';
      i += sep.length - 1;
      continue;
    }
    cur += ch;
  }
  parts.push(cur);
  return parts.map((s) => s.trim()).filter(Boolean);
}

function unwrap(s: string): string {
  s = s.trim();
  while (s.startsWith('(') && s.endsWith(')')) {
    let depth = 0;
    let wraps = true;
    for (let i = 0; i < s.length - 1; i++) {
      if (s[i] === '(') depth++;
      if (s[i] === ')') depth--;
      if (depth === 0) {
        wraps = false;
        break;
      }
    }
    if (!wraps) break;
    s = s.slice(1, -1).trim();
  }
  return s;
}

function parseClause(s: string): Clause {
  s = unwrap(s);
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (depth) continue;
    for (const op of ['<=', '>=', '==', '!=', '<', '>'] as CmpOp[]) {
      if (s.startsWith(op, i)) return { field: unwrap(s.slice(0, i)), op, value: s.slice(i + op.length).trim() };
    }
  }
  if (s.startsWith('!')) return { field: unwrap(s.slice(1)), op: '==', value: '0' };
  const boolish = /\.(ready|onfield|airborne)$/.test(s);
  return { field: s, op: boolish ? '==' : '!=', value: boolish ? '1' : '0' };
}

export function parseCondition(expr: string): Condition {
  expr = unwrap(expr);
  const ors = splitTop(expr, '||');
  const ands = splitTop(expr, '&&');
  if (ors.length > 1 && ands.length > 1 && ors.some((p) => splitTop(p, '&&').length > 1)) {
    // mixed && / || : keep it as one custom expression
    return { join: 'and', clauses: [{ field: expr, op: '!=', value: '0' }] };
  }
  if (ors.length > 1) return { join: 'or', clauses: ors.map(parseClause) };
  return { join: 'and', clauses: ands.map(parseClause) };
}

// ------------------------------------------------------------------ script -> items

function parseActions(char: string, text: string): RotItem[] {
  const items: RotItem[] = [];
  let depth = 0;
  let cur = '';
  const tokens: string[] = [];
  for (const ch of text) {
    if (ch === '[') depth++;
    if (ch === ']') depth--;
    if (ch === ',' && depth === 0) {
      tokens.push(cur);
      cur = '';
    } else cur += ch;
  }
  tokens.push(cur);
  for (const t of tokens.map((s) => s.trim()).filter(Boolean)) {
    const m = /^(\w+)\s*(\[[^\]]*\])?\s*(?::\s*(\d+))?$/.exec(t);
    if (!m || !ACTIONS.has(m[1])) return [];
    items.push({ id: uid(), char, action: m[1] as ActionType, params: paramList(m[2]), repeat: m[3] ? +m[3] : 1 });
  }
  return items;
}

function forHeader(header: string): { name: string; count: number } | null {
  const m = /^for\s+let\s+(\w+)\s*=\s*(\d+)\s*;\s*\1\s*(<=|<)\s*(\d+)\s*;\s*\1\s*=\s*\1\s*\+\s*1\s*$/.exec(header.trim());
  if (!m) return null;
  return { name: m[1], count: +m[4] - +m[2] + (m[3] === '<=' ? 1 : 0) };
}

function forCount(header: string): number | null {
  return forHeader(header)?.count ?? null;
}

/** Rename a loop variable inside conditions / raw script (the builder's loop counter is `rot`). */
function renameVar(items: RotItem[], from: string, to: string): RotItem[] {
  if (from === to) return items;
  const re = new RegExp(`\\b${from}\\b`, 'g');
  const fixCond = (c: Condition): Condition => ({ ...c, clauses: c.clauses.map((cl) => ({ ...cl, field: cl.field.replace(re, to), value: cl.value.replace(re, to) })) });
  return items.map((x) => {
    if (isAction(x)) return x.cond ? { ...x, cond: fixCond(x.cond) } : x;
    if (x.kind === 'if') return { ...x, cond: fixCond(x.cond), then: renameVar(x.then, from, to), else: renameVar(x.else, from, to) };
    if (x.kind === 'repeat') return { ...x, body: renameVar(x.body, from, to) };
    return { ...x, text: x.text.replace(re, to) };
  });
}

function parseIf(stmt: string, team: Set<string>): RotItem {
  const head = stmt.slice(0, stmt.indexOf('{')).replace(/^if\b/, '').trim();
  const { body, end } = blockBody(stmt);
  const rest = stmt.slice(end).trim();
  let elseItems: RotItem[] = [];
  if (rest.startsWith('else')) {
    const after = rest.slice(4).trim();
    if (after.startsWith('if')) elseItems = [parseIf(after, team)];
    else elseItems = parseScript(blockBody(after).body, team);
  }
  return { kind: 'if', id: uid(), cond: parseCondition(head), then: parseScript(body, team), else: elseItems };
}

function raw(text: string): RotItem {
  return { kind: 'raw', id: uid(), text: text.trim().endsWith('}') ? text.trim() : `${text.trim()};` };
}

export function parseScript(src: string, team: Set<string>): RotItem[] {
  const items: RotItem[] = [];
  for (const st of statements(src)) {
    const word = /^[A-Za-z_]\w*/.exec(st)?.[0] ?? '';
    if (word === 'if') {
      items.push(parseIf(st, team));
    } else if (word === 'for') {
      const count = forCount(st.slice(0, st.indexOf('{')));
      if (count === null) items.push(raw(st));
      else items.push({ kind: 'repeat', id: uid(), count, body: parseScript(blockBody(st).body, team) });
    } else if ((word === 'wait' || word === 'delay') && /^\w+\s*\(\s*\d+\s*\)$/.test(st)) {
      items.push({ id: uid(), char: '', action: word, params: {}, repeat: 1, frames: +/\d+/.exec(st)![0] });
    } else if (word && team.has(charKey(word) ?? '') && !/^\w+\s+(char|add)\b/.test(st)) {
      const acts = parseActions(charKey(word)!, st.slice(word.length));
      if (acts.length) items.push(...acts);
      else items.push(raw(st));
    } else {
      items.push(raw(st));
    }
  }
  return items;
}

// ------------------------------------------------------------------ whole config

export interface ImportResult {
  project: Project;
  warnings: string[];
}

export function importConfig(text: string, name = 'Imported team'): ImportResult {
  const warnings: string[] = [];
  const src = stripComments(text);
  // a leading comment line names the project (as written by gcBuild); commented-out code doesn't count
  const head = /^\s*#\s*(.+)$/.exec(text.trimStart().split('\n')[0] ?? '')?.[1] ?? '';
  const firstComment = /[=;]/.test(head) ? '' : head.replace(/\s*-\s*generated by gcBuild\s*$/, '').trim();
  const builds = new Map<string, CharBuild>();
  const order: string[] = [];
  const options = { ...DEFAULT_OPTIONS, extraOptions: '', rawTargets: '', rawEnergy: '' };
  const targets: string[] = [];
  const env: string[] = [];
  let active = '';
  const scriptParts: string[] = [];

  const ensure = (key: string): CharBuild => {
    let b = builds.get(key);
    if (!b) {
      b = {
        uid: uid(), key, level: '90/90', cons: 0, talents: [9, 9, 9],
        weapon: { key: '', refine: 1, level: '90/90', params: {} }, sets: [],
        main: { sands: 'atk%', goblet: 'atk%', circlet: 'cr' }, liquid: {}, erTarget: 1, autoMain: false,
        profile: { stat: 'atk', crit: true, amp: false }, charParams: {}, statsMode: 'custom', customStats: {},
      };
      builds.set(key, b);
      order.push(key);
    }
    return b;
  };

  for (const st of statements(src)) {
    const word = /^[A-Za-z_]\w*/.exec(st)?.[0] ?? '';
    const charMatch = /^(\w+)\s+(char|add)\b([\s\S]*)$/.exec(st);
    if (charMatch && charKey(charMatch[1])) {
      const key = charKey(charMatch[1])!;
      const b = ensure(key);
      const rest = charMatch[3];
      if (charMatch[2] === 'char') {
        const kv = kvPairs(rest);
        if (kv.lvl) b.level = kv.lvl;
        if (kv.cons) b.cons = +kv.cons;
        if (kv.talent) {
          const t = kv.talent.split(',').map(Number);
          b.talents = [t[0] || 1, t[1] || 1, t[2] || 1];
        }
        b.charParams = paramList(kv['+params']);
      } else {
        const sub = /^\s*(weapon|set|stats)\b([\s\S]*)$/.exec(rest);
        if (!sub) {
          warnings.push(`skipped: ${st}`);
          continue;
        }
        const kv = kvPairs(sub[2]);
        if (sub[1] === 'weapon') {
          const name = /weapon\s*=\s*"([^"]+)"/.exec(rest)?.[1] ?? kv.weapon ?? '';
          const w = lookup(weapons, name);
          if (!w) warnings.push(`unknown weapon "${name}" for ${key}`);
          b.weapon = { key: w?.key ?? name, refine: +(kv.refine ?? 1), level: kv.lvl ?? '90/90', params: paramList(kv['+params']) };
        } else if (sub[1] === 'set') {
          const name = /set\s*=\s*"([^"]+)"/.exec(rest)?.[1] ?? kv.set ?? '';
          const s = lookup(sets, name);
          if (!s) warnings.push(`unknown set "${name}" for ${key}`);
          b.sets.push({ key: s?.key ?? name, count: +(kv.count ?? 4) });
        } else {
          for (const [k, v] of Object.entries(kv)) {
            // gcsim also accepts products such as cr=0.0331*8 (written by its substat optimizer)
            const val = v.split('*').reduce((acc, x) => acc * Number(x), 1);
            if (STATS.has(k as Stat) && !Number.isNaN(val)) b.customStats![k as Stat] = (b.customStats![k as Stat] ?? 0) + val;
            else warnings.push(`unknown stat "${k}" for ${key}`);
          }
        }
      }
      continue;
    }
    if (HEADER_KEYWORDS.has(word)) {
      if (word === 'options') {
        const extra: string[] = [];
        for (const [k, v] of Object.entries(kvPairs(st.slice(7)))) {
          if (k === 'iteration') options.iteration = +v;
          else if (k === 'duration') options.duration = +v;
          else if (k === 'swap_delay') options.swapDelay = +v;
          else if (k === 'hitlag') options.hitlag = v !== 'false';
          else extra.push(`${k}=${v}`);
        }
        options.extraOptions = [options.extraOptions, ...extra].filter(Boolean).join(' ');
      } else if (word === 'target') targets.push(`${st};`);
      else if (word === 'energy' || word === 'hurt') env.push(`${st};`);
      else if (word === 'active') active = charKey(st.slice(6).trim()) ?? '';
      continue;
    }
    scriptParts.push(st.trim().endsWith('}') ? st : `${st};`);
  }

  if (targets.length) options.rawTargets = targets.join('\n');
  options.rawEnergy = env.join('\n');
  if (!env.length) options.energyMode = 'none';

  const team = order.slice(0, 4).map((k) => builds.get(k)!);
  if (order.length > 4) warnings.push('more than 4 characters; extra ones were dropped');
  const teamKeys = new Set(team.map((b) => b.key));

  // the last top-level loop becomes the rotation loop, the rest is the opener
  const items = parseScript(scriptParts.join('\n'), teamKeys);
  let loop: RotItem[] = [];
  let loopMode: 'while' | 'for' = 'while';
  let loopCount = 1;
  const last = items[items.length - 1];
  const lastStmt = scriptParts[scriptParts.length - 1] ?? '';
  if (last?.kind === 'repeat') {
    const name = forHeader(lastStmt.slice(0, lastStmt.indexOf('{')))?.name;
    loop = name ? renameVar(last.body, name, 'rot') : last.body;
    loopMode = 'for';
    loopCount = last.count;
    items.pop();
  } else if (last?.kind === 'raw' && /^while\s+1\s*\{/.test(lastStmt.trim())) {
    loop = parseScript(blockBody(lastStmt).body, teamKeys);
    items.pop();
  }

  const rawCount = [...items, ...loop].filter((x) => !isAction(x) && x.kind === 'raw').length;
  if (rawCount) warnings.push(`${rawCount} script block(s) kept as raw script`);

  return {
    project: {
      name: firstComment || name,
      team: [...team, ...Array(Math.max(0, 4 - team.length)).fill(null)],
      active: active || team[0]?.key || '',
      options,
      rotation: { opener: items, loop, loopMode, loopCount },
    },
    warnings,
  };
}

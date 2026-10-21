import type { Block, Clause, Condition, Project, RotationAction, RotItem, Rotation, Section } from './types';

/**
 * Rotation items form a tree: sections ('opener' / 'loop') hold items, and
 * blocks hold child lists. A list is addressed by a list id:
 *   'opener' | 'loop' | `${blockId}/then` | `${blockId}/else` | `${blockId}/body`
 */
export type ListId = string;

export const isAction = (x: RotItem): x is RotationAction => !x.kind || x.kind === 'action';
export const isBlock = (x: RotItem): x is Block => !isAction(x);

export function childLists(b: Block): { id: ListId; items: RotItem[]; label: string }[] {
  switch (b.kind) {
    case 'if': return [{ id: `${b.id}/then`, items: b.then, label: 'then' }, { id: `${b.id}/else`, items: b.else, label: 'else' }];
    case 'repeat': return [{ id: `${b.id}/body`, items: b.body, label: 'body' }];
    default: return [];
  }
}

export function getList(rot: Rotation, listId: ListId): RotItem[] | null {
  if (listId === 'opener' || listId === 'loop') return rot[listId];
  const [blockId, branch] = listId.split('/');
  const found = locate(rot, blockId);
  if (!found || !isBlock(found.item)) return null;
  const b = found.item;
  if (b.kind === 'if' && (branch === 'then' || branch === 'else')) return b[branch];
  if (b.kind === 'repeat' && branch === 'body') return b.body;
  return null;
}

export interface Located {
  item: RotItem;
  list: RotItem[];
  index: number;
  listId: ListId;
  section: Section;
}

export function locate(rot: Rotation, id: string): Located | null {
  const walk = (list: RotItem[], listId: ListId, section: Section): Located | null => {
    for (let i = 0; i < list.length; i++) {
      const item = list[i];
      if (item.id === id) return { item, list, index: i, listId, section };
      if (isBlock(item)) {
        for (const c of childLists(item)) {
          const r = walk(c.items, c.id, section);
          if (r) return r;
        }
      }
    }
    return null;
  };
  return walk(rot.opener, 'opener', 'opener') ?? walk(rot.loop, 'loop', 'loop');
}

export function sectionOfList(rot: Rotation, listId: ListId): Section {
  if (listId === 'opener' || listId === 'loop') return listId;
  return locate(rot, listId.split('/')[0])?.section ?? 'loop';
}

/** true if `listId` is inside the subtree of item `id` (to block dropping a block into itself) */
export function listInside(rot: Rotation, listId: ListId, id: string): boolean {
  let cur = listId;
  while (cur !== 'opener' && cur !== 'loop') {
    const blockId = cur.split('/')[0];
    if (blockId === id) return true;
    const loc = locate(rot, blockId);
    if (!loc) return false;
    cur = loc.listId;
  }
  return false;
}

export function removeItem(rot: Rotation, id: string): RotItem | null {
  const loc = locate(rot, id);
  if (!loc) return null;
  return loc.list.splice(loc.index, 1)[0];
}

export function walkItems(items: RotItem[], fn: (x: RotItem) => void) {
  for (const x of items) {
    fn(x);
    if (isBlock(x)) for (const c of childLists(x)) walkItems(c.items, fn);
  }
}

export function allActions(rot: Rotation): RotationAction[] {
  const out: RotationAction[] = [];
  const f = (x: RotItem) => isAction(x) && out.push(x);
  walkItems(rot.opener, f);
  walkItems(rot.loop, f);
  return out;
}

/** Drop actions of a character from the whole tree. */
export function pruneChar(items: RotItem[], char: string): RotItem[] {
  return items
    .filter((x) => !(isAction(x) && x.char === char))
    .map((x) => {
      if (x.kind === 'if') return { ...x, then: pruneChar(x.then, char), else: pruneChar(x.else, char) };
      if (x.kind === 'repeat') return { ...x, body: pruneChar(x.body, char) };
      return x;
    });
}

/** Deep copy with fresh ids. */
export function cloneWithIds(x: RotItem, newId: () => string): RotItem {
  const c = structuredClone(x);
  const re = (y: RotItem) => {
    y.id = newId();
    if (isBlock(y)) for (const l of childLists(y)) l.items.forEach(re);
  };
  re(c);
  return c;
}

// ------------------------------------------------------------------ notation

const LETTER: Record<string, string> = {
  charge: 'C', dash: 'D', jump: 'J', skill: 'E', burst: 'Q', aim: 'A', high_plunge: 'P', low_plunge: 'LP', walk: 'W', swap: 'S',
};

function actionNotation(a: RotationAction): string {
  if (a.action === 'wait' || a.action === 'delay') return ` ${a.action}${a.frames ?? 0} `;
  if (a.action === 'attack') return `N${Math.max(1, a.repeat)}`;
  const letter = a.action === 'skill' && a.params?.hold ? 'hE' : LETTER[a.action] ?? a.action;
  const s = letter.repeat(Math.max(1, a.repeat));
  return a.cond ? `${s}?` : s;
}

function charsIn(items: RotItem[], out = new Set<string>()): Set<string> {
  walkItems(items, (x) => {
    if (isAction(x) && x.char) out.add(x.char);
  });
  return out;
}

/** The single character acting in a fragment ('' when none or several). */
export function soleChar(items: RotItem[]): string {
  const c = [...charsIn(items)];
  return c.length === 1 ? c[0] : '';
}

/** Character of the last action in a fragment (in order; for `if` the then branch). */
export function lastChar(x: RotItem): string {
  if (isAction(x)) return x.char;
  if (x.kind === 'raw') return '';
  const list = x.kind === 'if' ? x.then : x.body;
  for (let i = list.length - 1; i >= 0; i--) {
    const c = lastChar(list[i]);
    if (c) return c;
  }
  return '';
}

/** "N2CDN2CDN2CD" -> "3(N2CD)" when a run is one combo repeated. */
function compress(run: string): string {
  for (let len = 2; len <= run.length / 2; len++) {
    if (run.length % len) continue;
    const unit = run.slice(0, len);
    if (/^\d/.test(unit) || (/\d$/.test(unit) && /^\d/.test(run.slice(len)))) continue;
    if (unit.repeat(run.length / len) === run) return `${run.length / len}(${unit})`;
  }
  return run;
}

/**
 * Compact rotation notation, e.g. "10(N2CD)" for repeat 10 x (N2, CA, dash) and
 * "E 10(N2CD) Q" around it. Character keys are added when several characters act.
 */
export interface NotationFormat {
  /** how a character is written (default: gcsim key) */
  name?: (key: string) => string;
  /** separator between character parts (default " · ") */
  sep?: string;
}

export function notation(items: RotItem[], showChars = charsIn(items).size > 1, fmt: NotationFormat = {}): string {
  const nameOf = fmt.name ?? ((k: string) => k);
  const parts: string[] = [];
  let curChar = '';
  let tokens: string[] = [];
  let run = '';
  const endRun = () => {
    if (run.trim()) tokens.push(...run.trim().split(/\s+/).map(compress));
    run = '';
  };
  const flush = () => {
    endRun();
    if (tokens.length) parts.push(`${showChars && curChar ? `${nameOf(curChar)} ` : ''}${tokens.join(' ')}`);
    tokens = [];
  };
  for (const x of items) {
    if (isAction(x)) {
      if (x.char && x.char !== curChar) {
        flush();
        curChar = x.char;
      }
      run += actionNotation(x);
    } else if (x.kind === 'repeat') {
      const chars = [...charsIn(x.body)];
      if (chars.length > 1) {
        flush();
        curChar = '';
        parts.push(`${x.count}(${notation(x.body, true, fmt)})`);
        continue;
      }
      const token = `${x.count}(${notation(x.body, false, fmt)})`;
      if (chars.length === 1 && chars[0] !== curChar) {
        flush();
        curChar = chars[0];
      }
      endRun();
      tokens.push(token);
    } else if (x.kind === 'if') {
      // branches acting with the same character as before the block don't repeat its name
      const before = curChar;
      const sole = soleChar([...x.then, ...x.else]);
      const same = !!sole && sole === before;
      flush();
      curChar = same ? before : '';
      const t = notation(x.then, showChars && !same, fmt) || '-';
      const e = notation(x.else, showChars && !same, fmt);
      const block = `[${t}${e ? ` | ${e}` : ''}]?`;
      if (same) parts[parts.length - 1] = `${parts[parts.length - 1] ?? ''} ${block}`.trim();
      else parts.push(block);
    } else {
      flush();
      curChar = '';
      parts.push('script');
    }
  }
  flush();
  return parts.join(fmt.sep ?? ' · ');
}

// ------------------------------------------------------------------ conditions

export function clauseToScript(c: Clause): string {
  const field = /[\s/*+-]/.test(c.field.trim()) ? `(${c.field.trim()})` : c.field.trim();
  return `${field} ${c.op} ${c.value.trim() || '0'}`;
}

export function condToScript(cond: Condition): string {
  const parts = cond.clauses.filter((c) => c.field.trim()).map(clauseToScript);
  if (!parts.length) return '1';
  if (parts.length === 1) return parts[0];
  return parts.map((p) => `(${p})`).join(cond.join === 'or' ? ' || ' : ' && ');
}

export const readyCond = (char: string, action: string): Condition => ({
  join: 'and',
  clauses: [{ field: `.${char}.${action}.ready`, op: '==', value: '1' }],
});

// ------------------------------------------------------------------ migration

/** Bring older / imported projects up to the current shape. */
export function normalizeProject(p: Project): Project {
  const fix = (items: RotItem[]): RotItem[] =>
    items.map((x) => {
      if (isAction(x)) {
        const a = { ...x, params: x.params ?? {}, repeat: x.repeat || 1 };
        if (a.ifReady && !a.cond && (a.action === 'skill' || a.action === 'burst')) a.cond = readyCond(a.char, a.action);
        delete a.ifReady;
        return a;
      }
      if (x.kind === 'if') return { ...x, then: fix(x.then ?? []), else: fix(x.else ?? []) };
      if (x.kind === 'repeat') return { ...x, body: fix(x.body ?? []) };
      return x;
    });
  return {
    ...p,
    team: p.team.map((b) => (b ? { ...b, statsMode: b.statsMode ?? 'kqms', charParams: b.charParams ?? {} } : null)),
    rotation: { ...p.rotation, opener: fix(p.rotation.opener ?? []), loop: fix(p.rotation.loop ?? []) },
  };
}

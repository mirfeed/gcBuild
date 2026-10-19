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

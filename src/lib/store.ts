import { useCallback, useEffect, useRef, useState } from 'react';
import { emptyProject, exampleProject, uid } from './project';
import { normalizeProject } from './rotation';
import type { Project } from './types';

/**
 * Several teams edited side by side (e.g. one per Stygian Onslaught boss): a "group". Each team keeps its own
 * undo / redo history; the group is autosaved to the browser and saved / loaded as one file in the teams folder.
 */
export interface Group {
  format?: 'gcbuild-group';
  name: string;
  teams: Project[];
  active: number;
}

const GROUP_KEY = 'gcbuild.group.v1';
/** single-project autosave of older versions (migrated into a one-team group) */
const OLD_PROJECT_KEY = 'gcbuild.project.v1';
const HISTORY_LIMIT = 100;

const withId = (p: Project): Project => (p.id ? p : { ...p, id: uid() });
const isProject = (p: unknown): p is Project => !!p && Array.isArray((p as Project).team) && !!(p as Project).rotation;

export function isGroup(x: unknown): x is Group {
  return !!x && Array.isArray((x as Group).teams) && (x as Group).teams.length > 0 && (x as Group).teams.every(isProject);
}

/** A loaded file (group or single project) as a group. */
export function toGroup(x: unknown, fallbackName = 'Group'): Group | null {
  if (isGroup(x)) {
    const teams = x.teams.map((t) => withId(normalizeProject(t)));
    return { format: 'gcbuild-group', name: x.name || fallbackName, teams, active: Math.min(Math.max(0, x.active ?? 0), teams.length - 1) };
  }
  if (isProject(x)) {
    const p = withId(normalizeProject(x));
    return { format: 'gcbuild-group', name: p.name || fallbackName, teams: [p], active: 0 };
  }
  return null;
}

function load(): Group {
  try {
    const g = toGroup(JSON.parse(localStorage.getItem(GROUP_KEY) ?? 'null'));
    if (g) return g;
    const old = toGroup(JSON.parse(localStorage.getItem(OLD_PROJECT_KEY) ?? 'null'));
    if (old) return old;
  } catch {
    // storage unavailable or corrupt: start fresh
  }
  const p = withId(exampleProject());
  return { format: 'gcbuild-group', name: p.name, teams: [p], active: 0 };
}

export type Updater = (draft: Project) => void;

interface History {
  past: Project[];
  future: Project[];
}

/**
 * The group with per-team undo / redo and autosave. `update` / `replace` / `undo` / `redo` act on the open team.
 * State lives in refs (updated synchronously) so several updates in one event handler compose, and StrictMode
 * double-invocation can't double-push.
 */
export function useGroup() {
  const [group, setGroup] = useState<Group>(load);
  const current = useRef(group);
  const histories = useRef(new Map<string, History>());
  const [, bump] = useState(0);

  useEffect(() => {
    try {
      localStorage.setItem(GROUP_KEY, JSON.stringify(group));
    } catch {
      // ignore quota / privacy mode errors
    }
  }, [group]);

  const commit = useCallback((next: Group) => {
    current.current = next;
    setGroup(next);
  }, []);

  const hist = (id: string): History => {
    let h = histories.current.get(id);
    if (!h) histories.current.set(id, (h = { past: [], future: [] }));
    return h;
  };

  /** replace the open team, recording the previous state for undo */
  const setTeam = useCallback((next: Project) => {
    const g = current.current;
    const cur = g.teams[g.active];
    const h = hist(cur.id!);
    h.past.push(cur);
    if (h.past.length > HISTORY_LIMIT) h.past.shift();
    h.future = [];
    const teams = [...g.teams];
    teams[g.active] = { ...next, id: cur.id };
    commit({ ...g, teams });
  }, [commit]);

  const update = useCallback((fn: Updater) => {
    const g = current.current;
    const next = structuredClone(g.teams[g.active]);
    fn(next);
    setTeam(next);
  }, [setTeam]);

  const replace = useCallback((p: Project) => setTeam(normalizeProject(p)), [setTeam]);

  const step = useCallback((dir: 'undo' | 'redo') => {
    const g = current.current;
    const cur = g.teams[g.active];
    const h = hist(cur.id!);
    const to = (dir === 'undo' ? h.past : h.future).pop();
    if (!to) return;
    (dir === 'undo' ? h.future : h.past).push(cur);
    const teams = [...g.teams];
    teams[g.active] = to;
    commit({ ...g, teams });
  }, [commit]);
  const undo = useCallback(() => step('undo'), [step]);
  const redo = useCallback(() => step('redo'), [step]);

  const setActive = useCallback((i: number) => {
    const g = current.current;
    if (i === g.active || i < 0 || i >= g.teams.length) return;
    commit({ ...g, active: i });
  }, [commit]);

  /** add a team (empty, or a copy / loaded project) after the open one and open it */
  const addTeam = useCallback((p?: Project) => {
    const g = current.current;
    const team = { ...normalizeProject(p ? structuredClone(p) : emptyProject()), id: uid() };
    if (!p) team.name = `Team ${g.teams.length + 1}`;
    const teams = [...g.teams];
    teams.splice(g.active + 1, 0, team);
    commit({ ...g, teams, active: g.active + 1 });
  }, [commit]);

  const removeTeam = useCallback((i: number) => {
    const g = current.current;
    if (g.teams.length <= 1) return;
    histories.current.delete(g.teams[i].id!);
    const teams = g.teams.filter((_, k) => k !== i);
    const active = i < g.active ? g.active - 1 : Math.min(g.active, teams.length - 1);
    commit({ ...g, teams, active });
  }, [commit]);

  const renameGroup = useCallback((name: string) => {
    commit({ ...current.current, name });
    bump((n) => n + 1);
  }, [commit]);

  /** replace the whole group (load from file / new group); histories start over */
  const replaceGroup = useCallback((g: Group) => {
    histories.current.clear();
    commit(g);
  }, [commit]);

  const project = group.teams[group.active];
  const h = histories.current.get(project.id!);
  return {
    group,
    project,
    update,
    replace,
    undo,
    redo,
    canUndo: !!h?.past.length,
    canRedo: !!h?.future.length,
    setActive,
    addTeam,
    removeTeam,
    renameGroup,
    replaceGroup,
  };
}

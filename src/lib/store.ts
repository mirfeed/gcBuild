import { useCallback, useEffect, useRef, useState } from 'react';
import { exampleProject } from './project';
import { normalizeProject } from './rotation';
import type { Project } from './types';

const STORAGE_KEY = 'gcbuild.project.v1';
const HISTORY_LIMIT = 100;

function load(): Project {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Project;
      if (p && Array.isArray(p.team) && p.rotation) return normalizeProject(p);
    }
  } catch {
    // storage unavailable or corrupt: start fresh
  }
  return exampleProject();
}

export type Updater = (draft: Project) => void;

/**
 * Project state with undo/redo and autosave. Updaters mutate a deep copy.
 * History lives in refs (updated synchronously) so several updates in one
 * event handler compose, and StrictMode double-invocation can't double-push.
 */
export function useProject() {
  const [project, setProject] = useState<Project>(load);
  const current = useRef(project);
  const past = useRef<Project[]>([]);
  const future = useRef<Project[]>([]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
    } catch {
      // ignore quota / privacy mode errors
    }
  }, [project]);

  const commit = useCallback((next: Project) => {
    current.current = next;
    setProject(next);
  }, []);

  const update = useCallback((fn: Updater) => {
    const cur = current.current;
    const next = structuredClone(cur);
    fn(next);
    past.current.push(cur);
    if (past.current.length > HISTORY_LIMIT) past.current.shift();
    future.current = [];
    commit(next);
  }, [commit]);

  const replace = useCallback((p: Project) => {
    past.current.push(current.current);
    future.current = [];
    commit(normalizeProject(p));
  }, [commit]);

  const undo = useCallback(() => {
    const prev = past.current.pop();
    if (!prev) return;
    future.current.push(current.current);
    commit(prev);
  }, [commit]);

  const redo = useCallback(() => {
    const next = future.current.pop();
    if (!next) return;
    past.current.push(current.current);
    commit(next);
  }, [commit]);

  return {
    project,
    update,
    replace,
    undo,
    redo,
    canUndo: past.current.length > 0,
    canRedo: future.current.length > 0,
  };
}

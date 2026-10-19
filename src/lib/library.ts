/** Personal build library, persisted in localStorage (separate from the current project). */
import { useCallback, useState } from 'react';
import { uid } from './project';
import type { CharBuild } from './types';

export interface SavedBuild {
  id: string;
  name: string;
  savedAt: number;
  source: 'manual';
  build: CharBuild;
}

const KEY = 'gcbuild.library.v2';
/** v1 held builds made by the old character-level GOOD import; they are discarded. */
const OLD_KEYS = ['gcbuild.library.v1'];

function read(): SavedBuild[] {
  try {
    for (const k of OLD_KEYS) localStorage.removeItem(k);
    const raw = localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as SavedBuild[]) : [];
    return Array.isArray(list) ? list.filter((x) => x && x.build && x.build.key) : [];
  } catch {
    return [];
  }
}

function write(list: SavedBuild[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // quota / privacy mode: keep the in-memory copy
  }
}

export function useLibrary() {
  const [items, setItems] = useState<SavedBuild[]>(read);

  const commit = useCallback((fn: (list: SavedBuild[]) => SavedBuild[]) => {
    setItems((cur) => {
      const next = fn(cur);
      write(next);
      return next;
    });
  }, []);

  /** Save a build; a fresh uid keeps library copies independent of the team slot. */
  const save = useCallback((build: CharBuild, name: string, source: SavedBuild['source'] = 'manual') => {
    const entry: SavedBuild = { id: uid(), name, savedAt: Date.now(), source, build: { ...structuredClone(build), uid: uid() } };
    commit((list) => [entry, ...list]);
    return entry;
  }, [commit]);

  const removeAll = useCallback(() => commit(() => []), [commit]);
  const remove = useCallback((id: string) => commit((list) => list.filter((x) => x.id !== id)), [commit]);
  const rename = useCallback((id: string, name: string) => commit((list) => list.map((x) => (x.id === id ? { ...x, name } : x))), [commit]);

  return { items, save, remove, removeAll, rename };
}

export type Library = ReturnType<typeof useLibrary>;

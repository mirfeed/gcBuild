/** Personal build library, saved to userdata/library.json (separate from the current project). */
import { useCallback } from 'react';
import { useStoredList } from './persist';
import { uid } from './project';
import type { CharBuild } from './types';

export interface SavedBuild {
  id: string;
  name: string;
  savedAt: number;
  source: 'manual';
  build: CharBuild;
}

/** v1 held builds made by the old character-level GOOD import; they are discarded. */
try {
  localStorage.removeItem('gcbuild.library.v1');
} catch {
  // storage unavailable
}

const isSaved = (x: SavedBuild) => !!x && !!x.build && !!x.build.key;

/** Library saved to userdata/library.json (with a browser cache). */
export function useLibrary() {
  const { items, commit, backup, restoreBackup, dropBackup } = useStoredList<SavedBuild>('library', 'gcbuild.library.v2', isSaved);

  /** Save a build; a fresh uid keeps library copies independent of the team slot. */
  const save = useCallback((build: CharBuild, name: string, source: SavedBuild['source'] = 'manual') => {
    const entry: SavedBuild = { id: uid(), name, savedAt: Date.now(), source, build: { ...structuredClone(build), uid: uid() } };
    commit((list) => [entry, ...list]);
    return entry;
  }, [commit]);

  const removeAll = useCallback(() => commit(() => []), [commit]);
  const remove = useCallback((id: string) => commit((list) => list.filter((x) => x.id !== id)), [commit]);
  const rename = useCallback((id: string, name: string) => commit((list) => list.map((x) => (x.id === id ? { ...x, name } : x))), [commit]);

  return { items, save, remove, removeAll, rename, backup, restoreBackup, dropBackup };
}

export type Library = ReturnType<typeof useLibrary>;

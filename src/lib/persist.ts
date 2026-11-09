/**
 * A list stored in the project's userdata/ folder (via the local server), with
 * localStorage as an offline cache. On first run, data found only in this
 * browser's localStorage is moved to disk.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

function readLocal<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function writeLocal(key: string, list: unknown[]): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

async function writeDisk(name: string, list: unknown[]): Promise<boolean> {
  try {
    const res = await fetch(`/api/userdata/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: list }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function useStoredList<T>(name: 'artifacts' | 'library' | 'accounts', localKey: string, valid: (x: T) => boolean = () => true) {
  const [items, setItems] = useState<T[]>(() => readLocal<T>(localKey).filter(valid));
  const [error, setError] = useState<string | null>(null);
  const [backup, setBackup] = useState<T[]>(() => readLocal<T>(`${localKey}.backup`).filter(valid));
  const current = useRef(items);
  const touched = useRef(false);

  // load from disk; migrate browser-only data on the first run
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/userdata/${name}`)
      .then((r) => r.json())
      .then(async (res: { data: T[] | null }) => {
        if (cancelled || touched.current) return;
        if (Array.isArray(res.data)) {
          const list = res.data.filter(valid);
          // the disk wins, but never drop a different copy that only this browser has
          if (current.current.length && JSON.stringify(current.current) !== JSON.stringify(list)) {
            writeLocal(`${localKey}.backup`, current.current);
            setBackup(current.current);
          }
          current.current = list;
          setItems(list);
          writeLocal(localKey, list);
        } else if (current.current.length) {
          if (!(await writeDisk(name, current.current))) setError('Could not save to the userdata folder.');
        }
      })
      .catch(() => setError('Local server not reachable: data is kept in this browser only.'));
    return () => {
      cancelled = true;
    };
  }, [name, localKey, valid]);

  const commit = useCallback((fn: (list: T[]) => T[]) => {
    touched.current = true;
    const next = fn(current.current);
    current.current = next;
    setItems(next);
    const local = writeLocal(localKey, next);
    writeDisk(name, next).then((ok) => {
      setError(ok ? null : local ? 'Could not save to the userdata folder: kept in this browser only.' : 'Could not save the data anywhere.');
    });
  }, [name, localKey]);

  /** replace the saved data with the browser backup taken when the disk copy differed */
  const restoreBackup = useCallback(() => {
    const b = backup;
    if (!b.length) return;
    commit(() => b);
    try {
      localStorage.removeItem(`${localKey}.backup`);
    } catch {
      // storage unavailable
    }
    setBackup([]);
  }, [backup, commit, localKey]);

  const dropBackup = useCallback(() => {
    try {
      localStorage.removeItem(`${localKey}.backup`);
    } catch {
      // storage unavailable
    }
    setBackup([]);
  }, [localKey]);

  return { items, commit, error, backup, restoreBackup, dropBackup };
}

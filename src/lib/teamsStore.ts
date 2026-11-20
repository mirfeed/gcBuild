/**
 * Saved teams: "<userdata>/teams/<name>.gcbuild.json" through the local API (server/teams.ts), or — in Web Lite,
 * where there is no server — this browser's localStorage. Same routes, so TeamsPanel doesn't need two code paths.
 */
import { IS_WEB_LITE } from './platform';

export interface TeamFile {
  name: string;
  modified: number;
}

const KEY = 'gcbuild.teams.v1';

interface Entry {
  name: string;
  modified: number;
  project: unknown;
}

function read(): Entry[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((e) => e && typeof e.name === 'string' && e.project) : [];
  } catch {
    return [];
  }
}

function write(list: Entry[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    throw new Error('Browser storage is full or blocked: the team was not saved.');
  }
}

/** `list` / `save` / `load` / `delete`, the same as the /api/teams/* routes. */
export async function callTeams<T>(route: string, body?: Record<string, unknown>): Promise<T> {
  if (!IS_WEB_LITE) {
    const res = await fetch(`/api/teams/${route}`, body === undefined
      ? undefined
      : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({ error: `error ${res.status}` }));
    if (!res.ok) throw new Error((data as { error?: string }).error ?? `error ${res.status}`);
    return data as T;
  }
  switch (route) {
    case 'list': {
      const teams = read()
        .map(({ name, modified }) => ({ name, modified }))
        .sort((a, b) => b.modified - a.modified);
      return { dir: '', teams } as T;
    }
    case 'save': {
      const name = String(body?.name ?? '').trim() || 'team';
      write([{ name, modified: Date.now(), project: body?.project }, ...read().filter((e) => e.name !== name)]);
      return { name, path: name } as T;
    }
    case 'load': {
      const found = read().find((e) => e.name === String(body?.name ?? ''));
      if (!found) throw new Error('this team is not in this browser\'s storage');
      return found.project as T;
    }
    case 'delete': {
      write(read().filter((e) => e.name !== String(body?.name ?? '')));
      return { ok: true } as T;
    }
  }
  throw new Error(`unknown route ${route}`);
}

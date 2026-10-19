/**
 * Saved teams on disk: <root>/teams/<name>.gcbuild.json (the builder project)
 * plus <name>.txt (the generated gcsim config). Served as Vite middleware.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

/** Keep names readable (Cyrillic etc. allowed) but safe as file names. */
function safeName(name: string): string {
  const n = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/\s+/g, ' ').trim().replace(/^\.+/, '');
  return n.slice(0, 100) || 'team';
}

export function createTeamsApi(root: string) {
  const dir = path.join(root, 'teams');

  async function list() {
    await fs.mkdir(dir, { recursive: true });
    const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.gcbuild.json'));
    const out = [];
    for (const f of files) {
      const st = await fs.stat(path.join(dir, f));
      out.push({ name: f.slice(0, -'.gcbuild.json'.length), modified: st.mtimeMs });
    }
    return out.sort((a, b) => b.modified - a.modified);
  }

  async function save(name: string, project: unknown, config: string) {
    await fs.mkdir(dir, { recursive: true });
    const n = safeName(name);
    await fs.writeFile(path.join(dir, `${n}.gcbuild.json`), JSON.stringify(project, null, 2));
    await fs.writeFile(path.join(dir, `${n}.txt`), config);
    return { name: n, path: path.join(dir, `${n}.txt`) };
  }

  async function load(name: string) {
    const text = await fs.readFile(path.join(dir, `${safeName(name)}.gcbuild.json`), 'utf8');
    return JSON.parse(text);
  }

  async function remove(name: string) {
    const n = safeName(name);
    await fs.rm(path.join(dir, `${n}.gcbuild.json`), { force: true });
    await fs.rm(path.join(dir, `${n}.txt`), { force: true });
    return { ok: true };
  }

  async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const text = Buffer.concat(chunks).toString('utf8');
    return text ? JSON.parse(text) : {};
  }

  function send(res: ServerResponse, code: number, data: unknown) {
    res.statusCode = code;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(data));
  }

  return async function middleware(req: IncomingMessage, res: ServerResponse, next: () => void) {
    const url = req.url ?? '';
    if (!url.startsWith('/api/teams/')) return next();
    const route = url.slice('/api/teams/'.length).split('?')[0];
    try {
      if (route === 'list' && req.method === 'GET') return send(res, 200, { dir, teams: await list() });
      if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' });
      const b = await body(req);
      const name = String(b.name ?? '');
      switch (route) {
        case 'save': return send(res, 200, await save(name, b.project, String(b.config ?? '')));
        case 'load': return send(res, 200, await load(name));
        case 'delete': return send(res, 200, await remove(name));
      }
      return send(res, 404, { error: 'unknown route' });
    } catch (e) {
      return send(res, 500, { error: (e as Error).message });
    }
  };
}

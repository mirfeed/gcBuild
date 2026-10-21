/**
 * Personal data on disk: <root>/userdata/<name>.json (artifact inventory, build library).
 * Kept outside the browser so it survives port / browser changes. Served as Vite middleware.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

const NAMES = new Set(['artifacts', 'library']);

export function createUserdataApi(root: string) {
  const dir = path.join(root, 'userdata');

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
    if (!url.startsWith('/api/userdata/')) return next();
    const name = url.slice('/api/userdata/'.length).split('?')[0];
    if (!NAMES.has(name)) return send(res, 404, { error: 'unknown data file' });
    const file = path.join(dir, `${name}.json`);
    try {
      if (req.method === 'GET') {
        const text = await fs.readFile(file, 'utf8').catch(() => null);
        return send(res, 200, { data: text === null ? null : JSON.parse(text), file });
      }
      if (req.method === 'POST') {
        const b = await body(req);
        await fs.mkdir(dir, { recursive: true });
        // write to a temp file first so a crash mid-write can't corrupt the data
        await fs.writeFile(`${file}.tmp`, JSON.stringify(b.data ?? null));
        await fs.rename(`${file}.tmp`, file);
        return send(res, 200, { ok: true, file });
      }
      return send(res, 405, { error: 'method not allowed' });
    } catch (e) {
      return send(res, 500, { error: (e as Error).message });
    }
  };
}

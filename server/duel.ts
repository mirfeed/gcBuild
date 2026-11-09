/**
 * Local bridge to the duel server (gcB-Bot on the VPS, https://gcbuild.duckdns.org/beta/duel).
 *
 *   POST /api/duel/join    { key }                     join the duel the key belongs to
 *   POST /api/duel/state   { key }                     current duel state
 *   POST /api/duel/submit  { key, config, dps, chars } hand in the final result
 *   POST /api/duel/verify  { key }                     re-run the opponent's config and report its DPS
 *
 * verify fetches the opponent's config, runs it with the local gcsim and sends back only the DPS: the config
 * (with the opponent's "secret" rotation) never reaches the page, localStorage or a log, and gcsim's temp folder
 * is deleted as soon as the run ends (see withTmp in gcsim.ts).
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { GcsimApi } from './gcsim';

const BASE = (process.env.GCBUILD_DUEL_URL || 'https://gcbuild.duckdns.org/beta/duel').replace(/\/+$/, '');
const KEY_RE = /^gcd_[\w-]{10,}$/;

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function createDuelApi(gcsim: GcsimApi) {
  async function remote<T>(route: string, key: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${BASE}/${route}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', 'user-agent': 'gcbuild' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (e) {
      throw new HttpError(502, `duel server unreachable (${(e as Error).message}). If this keeps happening, try with a VPN.`);
    }
    const data = (await res.json().catch(() => ({ error: `duel server error ${res.status}` }))) as T & { error?: string };
    if (!res.ok) throw new HttpError(res.status, data.error ?? `duel server error ${res.status}`);
    return data;
  }

  // a duel tab and the background watcher may ask at the same time: one gcsim run per key
  const verifying = new Map<string, Promise<unknown>>();
  function verifyOnce(key: string) {
    let p = verifying.get(key);
    if (!p) {
      p = verify(key).finally(() => verifying.delete(key));
      verifying.set(key, p);
    }
    return p;
  }

  async function verify(key: string) {
    // nothing to re-run (any more): the other re-run may have decided the duel already
    const now = await remote<{ state: string; opponent: { verified: boolean | null } }>('state', key);
    if (now.state !== 'verifying' || now.opponent.verified !== null) return now;
    const opp = await remote<{ config: string; gcsimVersion: string }>('opponent', key);
    const st = await gcsim.status();
    if (opp.gcsimVersion && st.release.tag !== opp.gcsimVersion) {
      throw new HttpError(409, `this duel runs on gcsim ${opp.gcsimVersion}, you have ${st.release.tag ?? 'none'}: update gcsim first`);
    }
    let config = opp.config;
    let dps: number;
    let sd: number;
    try {
      const r = await gcsim.simulate(config);
      dps = r.result.statistics.dps.mean;
      sd = r.result.statistics.dps.sd;
    } finally {
      config = '';
      opp.config = '';
    }
    return remote('verify', key, { dps, sd });
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
    if (!url.startsWith('/api/duel/')) return next();
    const route = url.slice('/api/duel/'.length).split('?')[0];
    try {
      if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' });
      const b = await body(req);
      const key = String(b.key ?? '').trim();
      if (!KEY_RE.test(key)) return send(res, 400, { error: 'not a duel key (it starts with gcd_)' });
      switch (route) {
        case 'join': return send(res, 200, await remote('join', key, {}));
        case 'state': return send(res, 200, await remote('state', key));
        case 'submit': return send(res, 200, await remote('submit', key, { config: b.config, dps: b.dps, sd: b.sd, chars: b.chars }));
        case 'verify': return send(res, 200, await verifyOnce(key));
      }
      return send(res, 404, { error: 'unknown route' });
    } catch (e) {
      return send(res, e instanceof HttpError ? e.status : 500, { error: (e as Error).message });
    }
  };
}

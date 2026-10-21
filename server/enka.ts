/**
 * Enka.Network proxy (the browser can't call it directly because of CORS).
 * GET /api/enka/:uid -> { player, ttl, avatars }: the in-game showcase plus, when the
 * UID is linked to an Enka profile, the builds saved there (like gcsim.app does).
 * Responses are cached for the ttl Enka asks for.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';

const UA = { 'User-Agent': 'gcBuild/1.0 (local gcsim config builder)' };

interface Cached {
  until: number;
  body: unknown;
}

export function createEnkaApi() {
  const cache = new Map<string, Cached>();

  async function fetchUid(uid: string) {
    const hit = cache.get(uid);
    if (hit && hit.until > Date.now()) return { ...(hit.body as object), cached: true };

    const resp = await fetch(`https://enka.network/api/uid/${uid}`, { headers: UA });
    if (!resp.ok) {
      const reasons: Record<number, string> = {
        400: 'wrong UID format',
        404: 'player does not exist',
        424: 'game maintenance or Enka is updating after a game update',
        429: 'rate limited by Enka, try again in a minute',
        500: 'Enka server error',
        503: 'Enka is temporarily down',
      };
      throw new Error(`Enka ${resp.status}: ${reasons[resp.status] ?? resp.statusText}`);
    }
    const d = (await resp.json()) as {
      playerInfo?: { nickname?: string; level?: number; signature?: string };
      avatarInfoList?: Record<string, unknown>[];
      ttl?: number;
      owner?: { username: string; hash: string };
    };
    const avatars: Record<string, unknown>[] = [...(d.avatarInfoList ?? [])];

    // builds saved on the linked Enka profile
    if (d.owner?.username && d.owner.hash) {
      try {
        const r = await fetch(`https://enka.network/api/profile/${d.owner.username}/hoyos/${d.owner.hash}/builds/`, { headers: UA });
        if (r.ok) {
          const builds = (await r.json()) as Record<string, { live?: boolean; name?: string; avatar_data: Record<string, unknown> }[]>;
          for (const list of Object.values(builds)) {
            for (const b of list) {
              if (b.live) continue;
              avatars.push({ ...b.avatar_data, buildName: b.name ?? 'saved build' });
            }
          }
        }
      } catch {
        // the showcase alone is still useful
      }
    }

    const body = { uid, player: d.playerInfo ?? {}, ttl: d.ttl ?? 60, avatars };
    cache.set(uid, { until: Date.now() + Math.max(30, d.ttl ?? 60) * 1000, body });
    return body;
  }

  function send(res: ServerResponse, code: number, data: unknown) {
    res.statusCode = code;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(data));
  }

  return async function middleware(req: IncomingMessage, res: ServerResponse, next: () => void) {
    const url = req.url ?? '';
    if (!url.startsWith('/api/enka/')) return next();
    const uid = url.slice('/api/enka/'.length).split('?')[0];
    if (!/^\d{9,10}$/.test(uid)) return send(res, 400, { error: 'UID must be 9-10 digits' });
    try {
      return send(res, 200, await fetchUid(uid));
    } catch (e) {
      return send(res, 502, { error: (e as Error).message });
    }
  };
}

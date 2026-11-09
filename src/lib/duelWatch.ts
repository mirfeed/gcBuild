/**
 * Background duty for duels: the re-run of the opponent's result must not depend on the duel's tab being open.
 * Every duel key this app joined goes into a small list in localStorage; while the app runs, each one is polled and,
 * once both players submitted, the opponent's config is re-run (server/duel.ts). A key leaves the list when its
 * duel is over or the server no longer knows it.
 */
import { useEffect } from 'react';
import { duelApi, type DuelView } from './duel';

const STORE = 'gcbuild.duels.watch';
const EVERY = 10_000;
const OVER = ['done', 'cancelled', 'expired'];

function load(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(STORE) ?? '[]');
    return Array.isArray(v) ? v.filter((k) => typeof k === 'string') : [];
  } catch {
    return [];
  }
}

function save(keys: string[]) {
  try {
    localStorage.setItem(STORE, JSON.stringify([...new Set(keys)]));
  } catch {
    /* storage off: only open duel tabs get checked */
  }
}

export function watchDuel(key: string) {
  const keys = load();
  if (!keys.includes(key)) save([...keys, key]);
}

function unwatch(key: string) {
  finished.add(key);
  save(load().filter((k) => k !== key));
}

/** the opponent's result is waiting for this app's re-run */
export const needsVerify = (v: DuelView) =>
  v.state === 'verifying' && v.you.submitted && v.opponent.submitted && v.opponent.verified === null;

const running = new Map<string, Promise<DuelView>>();
/** duels seen over in this session: their tabs may stay open, no need to ask again */
const finished = new Set<string>();
/** a failed re-run is retried after a minute, not on every tick */
const retryAt = new Map<string, number>();
const RETRY = 60_000;

/** re-run the opponent's config; one run per key at a time, whoever asks (duel tab or background) */
export function verifyDuel(key: string): Promise<DuelView> {
  let p = running.get(key);
  if (!p) {
    p = duelApi.verify(key).finally(() => running.delete(key));
    running.set(key, p);
  }
  return p;
}

/** one pass over the watched duels (+ `extra` keys) */
export async function checkDuels(extra: string[]) {
  for (const key of new Set([...load(), ...extra])) {
    if (finished.has(key)) continue;
    try {
      const v = await duelApi.state(key);
      if (OVER.includes(v.state)) unwatch(key);
      else {
        watchDuel(key);
        if (needsVerify(v) && !running.has(key) && Date.now() >= (retryAt.get(key) ?? 0)) {
          try {
            const after = await verifyDuel(key);
            if (OVER.includes(after.state)) unwatch(key);
          } catch (e) {
            retryAt.set(key, Date.now() + RETRY);
            throw e;
          }
        }
      }
    } catch (e) {
      // the bot prunes finished duels after two weeks: the key is unknown then
      const status = (e as { status?: number }).status;
      if (status === 401 || status === 404) unwatch(key);
    }
  }
}

/** keep re-running opponents' results in the background; `keys` = duel keys of the tabs open right now */
export function useDuelWatcher(keys: string[]) {
  const sig = keys.join(',');
  useEffect(() => {
    const extra = sig ? sig.split(',') : [];
    let busy = false;
    const run = () => {
      if (busy) return;
      busy = true;
      void checkDuels(extra).finally(() => (busy = false));
    };
    run();
    const id = setInterval(run, EVERY);
    return () => clearInterval(id);
  }, [sig]);
}

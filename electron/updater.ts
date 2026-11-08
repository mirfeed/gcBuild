/**
 * Auto-update (electron-updater). The installed app checks on start and every 6 hours, downloads a new version
 * in the background and tells the page, which shows "Restart to update".
 *
 * Two channels:
 *   stable  GitHub Releases. Only published releases count: drafts are invisible to users.
 *   beta    the closed beta feed on gcbuild.duckdns.org (gcB-Bot). Needs a personal key from the Discord bot
 *           (/beta-key), sent as `Authorization: Bearer <key>`. The feed also carries stable versions newer than
 *           the last beta, so testers aren't left behind. Turning beta off goes back to the latest stable,
 *           even if that is an older version (allowDowngrade).
 * The beta choice and key live in <userData>/beta.json (the key encrypted with the OS keystore when available).
 *
 * GCBUILD_UPDATE_URL=<url> switches the stable channel to a plain HTTP folder (latest.yml + installer), for
 * testing an update end to end without publishing anything. GCBUILD_BETA_URL overrides the beta feed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { app, ipcMain, net, safeStorage, type BrowserWindow } from 'electron';
import { autoUpdater } from 'electron-updater';

export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'none'; version: string }
  | { state: 'downloading'; version: string; percent: number }
  | { state: 'ready'; version: string }
  | { state: 'error'; message: string }
  /** beta channel: the server no longer accepts the key (revoked, or the Beta tester role was removed) */
  | { state: 'beta-key-rejected' }
  | { state: 'dev' };

export interface BetaInfo {
  enabled: boolean;
  hasKey: boolean;
  feed: string;
}

export type BetaSetResult = { ok: true; note?: 'no-beta-yet' } | { ok: false; error: 'invalid-key' | 'offline' | 'server' ; message?: string };

const SIX_HOURS = 6 * 60 * 60 * 1000;
const BETA_FEED = (process.env.GCBUILD_BETA_URL || 'https://gcbuild.duckdns.org/beta').replace(/\/+$/, '');
const KEY_RE = /^gcb_[\w-]{20,}$/;

// ---------- beta settings ----------

interface BetaFile { enabled: boolean; key?: string; keyEnc?: string }

const betaFile = () => path.join(app.getPath('userData'), 'beta.json');

function readBeta(): { enabled: boolean; key: string } {
  try {
    const f = JSON.parse(fs.readFileSync(betaFile(), 'utf8')) as BetaFile;
    let key = f.key ?? '';
    if (f.keyEnc && safeStorage.isEncryptionAvailable()) key = safeStorage.decryptString(Buffer.from(f.keyEnc, 'base64'));
    return { enabled: !!f.enabled && !!key, key };
  } catch {
    return { enabled: false, key: '' };
  }
}

function writeBeta(enabled: boolean, key: string) {
  const data: BetaFile = { enabled };
  if (key) {
    if (safeStorage.isEncryptionAvailable()) data.keyEnc = safeStorage.encryptString(key).toString('base64');
    else data.key = key;
  }
  fs.mkdirSync(path.dirname(betaFile()), { recursive: true });
  fs.writeFileSync(betaFile(), JSON.stringify(data, null, 2));
}

/** Asks the beta feed whether the key is accepted. */
async function probeKey(key: string): Promise<BetaSetResult> {
  try {
    const res = await net.fetch(`${BETA_FEED}/beta.yml`, { headers: { authorization: `Bearer ${key}` }, cache: 'no-store' });
    if (res.status === 401) return { ok: false, error: 'invalid-key' };
    if (res.status === 404) return { ok: true, note: 'no-beta-yet' };
    if (!res.ok) return { ok: false, error: 'server', message: `HTTP ${res.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: 'offline', message: e instanceof Error ? e.message : String(e) };
  }
}

const isPrerelease = (v: string) => v.includes('-');

// ---------- updater ----------

export function setupUpdater(getWin: () => BrowserWindow | null) {
  let status: UpdateStatus = app.isPackaged ? { state: 'idle' } : { state: 'dev' };
  let pendingVersion = '';
  let beta = readBeta();
  const emit = (s: UpdateStatus) => {
    status = s;
    getWin()?.webContents.send('update-status', s);
  };

  const applyChannel = () => {
    if (!app.isPackaged) return;
    if (beta.enabled) {
      autoUpdater.setFeedURL({ provider: 'generic', url: BETA_FEED, channel: 'beta' });
      autoUpdater.channel = 'beta'; // → beta.yml
      autoUpdater.requestHeaders = { authorization: `Bearer ${beta.key}` };
      autoUpdater.allowPrerelease = true;
      autoUpdater.allowDowngrade = false; // after `channel`, which turns it on
      autoUpdater.disableDifferentialDownload = true; // the beta feed serves whole files only
    } else {
      if (process.env.GCBUILD_UPDATE_URL) autoUpdater.setFeedURL({ provider: 'generic', url: process.env.GCBUILD_UPDATE_URL });
      else autoUpdater.setFeedURL({ provider: 'github', owner: 'mirfeed', repo: 'gcBuild' });
      autoUpdater.channel = 'latest';
      autoUpdater.requestHeaders = null;
      autoUpdater.allowPrerelease = false;
      // leaving the beta: go back to the latest stable even if it's older than the installed beta
      autoUpdater.allowDowngrade = isPrerelease(app.getVersion());
      autoUpdater.disableDifferentialDownload = false;
    }
  };

  const check = async () => {
    if (!app.isPackaged || status.state === 'downloading' || status.state === 'ready') return;
    try {
      await autoUpdater.checkForUpdates();
    } catch {
      // reported through the 'error' event
    }
  };

  ipcMain.handle('update-status', () => status);
  ipcMain.handle('update-install', () => {
    if (status.state === 'ready') autoUpdater.quitAndInstall(false, true);
  });
  ipcMain.handle('update-check', async () => {
    await check();
    return status;
  });

  ipcMain.handle('beta-get', (): BetaInfo => ({ enabled: beta.enabled, hasKey: !!beta.key, feed: BETA_FEED }));
  ipcMain.handle('beta-set', async (_e, enabled: unknown, keyArg: unknown): Promise<BetaSetResult> => {
    const key = typeof keyArg === 'string' && keyArg.trim() ? keyArg.trim() : beta.key;
    if (enabled === true) {
      if (!KEY_RE.test(key)) return { ok: false, error: 'invalid-key' };
      const probe = await probeKey(key);
      if (!probe.ok) return probe;
      beta = { enabled: true, key };
      writeBeta(true, key);
      applyChannel();
      if (status.state !== 'ready') emit(app.isPackaged ? { state: 'idle' } : { state: 'dev' });
      void check();
      return probe;
    }
    beta = { enabled: false, key };
    writeBeta(false, key); // keep the key so turning beta back on doesn't need it again
    applyChannel();
    if (status.state !== 'ready') emit(app.isPackaged ? { state: 'idle' } : { state: 'dev' });
    void check();
    return { ok: true };
  });

  if (!app.isPackaged) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = { info: () => {}, warn: console.warn, error: console.error, debug: () => {} };
  applyChannel();

  autoUpdater.on('checking-for-update', () => status.state !== 'downloading' && status.state !== 'ready' && emit({ state: 'checking' }));
  autoUpdater.on('update-not-available', () => emit({ state: 'none', version: app.getVersion() }));
  autoUpdater.on('update-available', (info) => {
    pendingVersion = info.version;
    emit({ state: 'downloading', version: info.version, percent: 0 });
  });
  autoUpdater.on('download-progress', (p) => emit({ state: 'downloading', version: pendingVersion, percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (info) => emit({ state: 'ready', version: info.version }));
  autoUpdater.on('error', (e) => {
    const message = e?.message ?? String(e);
    if (status.state === 'ready') return; // keep a ready update
    // a revoked key is worth telling about even on a background check
    if (beta.enabled && /\b401\b/.test(message)) return emit({ state: 'beta-key-rejected' });
    // no releases yet / offline: not worth bothering the user
    emit({ state: 'error', message });
  });

  setTimeout(check, 5000);
  setInterval(check, SIX_HOURS);
}

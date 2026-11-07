/**
 * Auto-update from GitHub Releases (electron-updater). The installed app checks on start and every 6 hours,
 * downloads a new version in the background (differential, via the .blockmap) and tells the page, which shows
 * "Restart to update". Only published releases count: drafts are invisible to users.
 *
 * GCBUILD_UPDATE_URL=<url> switches to a plain HTTP folder (latest.yml + installer), for testing an update
 * end to end without publishing anything.
 */
import { app, ipcMain, type BrowserWindow } from 'electron';
import { autoUpdater } from 'electron-updater';

export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'none'; version: string }
  | { state: 'downloading'; version: string; percent: number }
  | { state: 'ready'; version: string }
  | { state: 'error'; message: string }
  | { state: 'dev' };

const SIX_HOURS = 6 * 60 * 60 * 1000;

export function setupUpdater(getWin: () => BrowserWindow | null) {
  let status: UpdateStatus = app.isPackaged ? { state: 'idle' } : { state: 'dev' };
  let pendingVersion = '';
  const emit = (s: UpdateStatus) => {
    status = s;
    getWin()?.webContents.send('update-status', s);
  };

  ipcMain.handle('update-status', () => status);
  ipcMain.handle('update-install', () => {
    if (status.state === 'ready') autoUpdater.quitAndInstall(false, true);
  });
  ipcMain.handle('update-check', async () => {
    if (!app.isPackaged) return status;
    await check();
    return status;
  });

  if (!app.isPackaged) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = { info: () => {}, warn: console.warn, error: console.error, debug: () => {} };
  if (process.env.GCBUILD_UPDATE_URL) autoUpdater.setFeedURL({ provider: 'generic', url: process.env.GCBUILD_UPDATE_URL });

  autoUpdater.on('checking-for-update', () => status.state !== 'downloading' && status.state !== 'ready' && emit({ state: 'checking' }));
  autoUpdater.on('update-not-available', () => emit({ state: 'none', version: app.getVersion() }));
  autoUpdater.on('update-available', (info) => {
    pendingVersion = info.version;
    emit({ state: 'downloading', version: info.version, percent: 0 });
  });
  autoUpdater.on('download-progress', (p) => emit({ state: 'downloading', version: pendingVersion, percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (info) => emit({ state: 'ready', version: info.version }));
  autoUpdater.on('error', (e) => {
    // no releases yet / offline: not worth bothering the user; keep a ready update if there is one
    if (status.state !== 'ready') emit({ state: 'error', message: e?.message ?? String(e) });
  });

  const check = async () => {
    if (status.state === 'downloading' || status.state === 'ready') return;
    try {
      await autoUpdater.checkForUpdates();
    } catch {
      // reported through the 'error' event
    }
  };
  setTimeout(check, 5000);
  setInterval(check, SIX_HOURS);
}

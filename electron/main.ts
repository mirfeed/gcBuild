/**
 * gcBuild desktop app (Electron main process).
 *
 * The same local API the Vite dev server provides (server/*.ts: gcsim bridge, teams, userdata, Enka proxy)
 * runs here on a random 127.0.0.1 port, guarded by a per-launch token. The window loads app://gcbuild/,
 * a privileged scheme proxied to that server: the origin never changes (so localStorage survives restarts)
 * and no fixed port can collide.
 *
 * Data (userdata/, teams/, tools/gcsim.exe) lives in %APPDATA%\gcBuild, not next to the program, so updates
 * and reinstalls keep it. gcsim itself is downloaded on demand (AGPL: not bundled).
 */
import { app, BrowserWindow, dialog, ipcMain, nativeTheme, protocol, shell } from 'electron';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';
import { createDuelApi } from '../server/duel';
import { createEnkaApi } from '../server/enka';
import { createGcsimApi } from '../server/gcsim';
import { createTeamsApi } from '../server/teams';
import { createUserdataApi } from '../server/userdata';
import { setupUpdater } from './updater';

const SCHEME = 'app';
const ORIGIN = `${SCHEME}://gcbuild`;
const TOKEN = randomBytes(24).toString('hex');

app.setName('gcBuild');
// tests / portable use: GCBUILD_DATA points the data folder somewhere else
if (process.env.GCBUILD_DATA) app.setPath('userData', path.resolve(process.env.GCBUILD_DATA));
// keep Chromium's caches out of the data folder the user may open (userdata/, teams/, tools/ only)
app.setPath('sessionData', path.join(app.getPath('userData'), 'browser'));

protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

if (!app.requestSingleInstanceLock()) app.quit();

const dataRoot = () => app.getPath('userData');
const distDir = path.join(__dirname, '..', 'dist');
const ru = () => /^(ru|uk|be|kk)/i.test(app.getLocale());

// ------------------------------------------------------------------ local server

type Middleware = (req: IncomingMessage, res: ServerResponse, next: () => void) => unknown;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

async function serveStatic(req: IncomingMessage, res: ServerResponse) {
  let rel = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
  if (rel === '/') rel = '/index.html';
  let file = path.join(distDir, path.normalize(rel));
  if (!file.startsWith(distDir)) file = path.join(distDir, 'index.html');
  let data: Buffer;
  try {
    data = await fsp.readFile(file);
  } catch {
    file = path.join(distDir, 'index.html');
    data = await fsp.readFile(file);
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
  res.end(data);
}

function startServer(): Promise<number> {
  const root = dataRoot();
  const gcsim = createGcsimApi(root);
  const chain: Middleware[] = [createTeamsApi(root), createUserdataApi(root), createEnkaApi(), createDuelApi(gcsim), gcsim];
  const server = http.createServer((req, res) => {
    if (req.headers['x-gcbuild-token'] !== TOKEN) {
      res.writeHead(403).end();
      return;
    }
    const run = (i: number): void => {
      if (i >= chain.length) {
        serveStatic(req, res).catch((e) => res.writeHead(500).end(String(e)));
        return;
      }
      void chain[i](req, res, () => run(i + 1));
    };
    run(0);
  });
  // gcsim runs can take a while: no socket timeouts
  server.requestTimeout = 0;
  server.headersTimeout = 0;
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve((server.address() as { port: number }).port)));
}

// ------------------------------------------------------------------ window

interface WinState { x?: number; y?: number; width: number; height: number; maximized?: boolean }
const stateFile = () => path.join(dataRoot(), 'window.json');

function loadState(): WinState {
  try {
    return { width: 1500, height: 950, ...JSON.parse(fs.readFileSync(stateFile(), 'utf8')) };
  } catch {
    return { width: 1500, height: 950 };
  }
}

let win: BrowserWindow | null = null;

/** Height of the custom title bar; must match --titlebar-h in features.css. */
const TITLEBAR_H = 34;
/** Window controls (minimize / maximize / close) drawn by Windows over our own title bar, in the app's colours. */
const overlay = () => (nativeTheme.shouldUseDarkColors
  ? { color: '#0b0e13', symbolColor: '#c9d1e0', height: TITLEBAR_H }
  : { color: '#e6e9f0', symbolColor: '#1b2333', height: TITLEBAR_H });

function createWindow() {
  const st = loadState();
  win = new BrowserWindow({
    x: st.x, y: st.y, width: st.width, height: st.height, minWidth: 900, minHeight: 600,
    title: 'gcBuild', backgroundColor: nativeTheme.shouldUseDarkColors ? '#0f1218' : '#f3f5f9', autoHideMenuBar: true, show: false,
    // no system title bar: the page draws its own (see TitleBar.tsx), Windows keeps snap layouts
    titleBarStyle: 'hidden', titleBarOverlay: overlay(),
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  if (st.maximized) win.maximize();
  const onTheme = () => win?.setTitleBarOverlay(overlay());
  nativeTheme.on('updated', onTheme);
  win.on('closed', () => nativeTheme.off('updated', onTheme));
  win.once('ready-to-show', () => win?.show());
  // window size / position: saved shortly after every move / resize (and on close), restored on start
  let saveTimer: NodeJS.Timeout | undefined;
  const saveState = () => {
    if (!win || win.isDestroyed()) return;
    try {
      fs.mkdirSync(dataRoot(), { recursive: true });
      fs.writeFileSync(stateFile(), JSON.stringify({ ...win.getNormalBounds(), maximized: win.isMaximized() }));
    } catch {
      // not worth failing over
    }
  };
  const saveSoon = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveState, 400);
  };
  for (const ev of ['resize', 'move', 'maximize', 'unmaximize'] as const) win.on(ev as 'resize', saveSoon);
  win.on('close', saveState);

  // links (Report a bug, gcsim.app, Enka…) open in the normal browser; the app window never leaves app://
  const external = (url: string) => /^https?:\/\//i.test(url) && void shell.openExternal(url);
  win.webContents.setWindowOpenHandler(({ url }) => {
    external(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(ORIGIN)) {
      e.preventDefault();
      external(url);
    }
  });
  win.loadURL(`${ORIGIN}/`);
}

// ------------------------------------------------------------------ data from an old (start.bat) install

const IMPORTED_FLAG = () => path.join(dataRoot(), '.first-run-done');

async function copyIfMissing(from: string, to: string): Promise<number> {
  let n = 0;
  let entries: fs.Dirent[];
  try {
    entries = await fsp.readdir(from, { withFileTypes: true });
  } catch {
    return 0;
  }
  await fsp.mkdir(to, { recursive: true });
  for (const e of entries) {
    if (!e.isFile()) continue;
    const dst = path.join(to, e.name);
    if (fs.existsSync(dst)) continue;
    await fsp.copyFile(path.join(from, e.name), dst);
    n++;
  }
  return n;
}

/** Copies userdata/, teams/ and the downloaded gcsim from a gcBuild folder the user picks. */
async function importOldFolder(): Promise<string> {
  const pick = await dialog.showOpenDialog(win!, {
    title: ru() ? 'Папка со старым gcBuild (где лежит start.bat)' : 'Old gcBuild folder (the one with start.bat)',
    properties: ['openDirectory'],
  });
  if (pick.canceled || !pick.filePaths[0]) return '';
  const src = pick.filePaths[0];
  if (!['userdata', 'teams', 'tools'].some((d) => fs.existsSync(path.join(src, d)))) {
    await dialog.showMessageBox(win!, {
      type: 'warning',
      message: ru() ? 'В этой папке нет userdata/, teams/ или tools/.' : 'No userdata/, teams/ or tools/ in that folder.',
    });
    return '';
  }
  const root = dataRoot();
  const counts = await Promise.all(['userdata', 'teams', 'tools'].map((d) => copyIfMissing(path.join(src, d), path.join(root, d))));
  const total = counts.reduce((a, b) => a + b, 0);
  const msg = ru()
    ? `Скопировано файлов: ${total} (данные: ${counts[0]}, отряды: ${counts[1]}, gcsim: ${counts[2]}). Уже существующие файлы не перезаписаны.`
    : `Copied ${total} file(s) (data: ${counts[0]}, teams: ${counts[1]}, gcsim: ${counts[2]}). Existing files were kept.`;
  await dialog.showMessageBox(win!, { type: 'info', message: msg });
  win?.webContents.reload();
  return msg;
}

async function firstRun() {
  if (fs.existsSync(IMPORTED_FLAG()) || fs.existsSync(path.join(dataRoot(), 'userdata'))) return;
  fs.mkdirSync(dataRoot(), { recursive: true });
  fs.writeFileSync(IMPORTED_FLAG(), new Date().toISOString());
  const r = await dialog.showMessageBox(win!, {
    type: 'question',
    message: ru() ? 'Перенести данные из старой версии gcBuild?' : 'Bring over data from an older gcBuild?',
    detail: ru()
      ? 'Если вы запускали gcBuild через start.bat, можно скопировать оттуда артефакты, «Мои билды», отряды и скачанный gcsim. Это можно сделать и позже: меню ⋯ → «Импорт из старой папки».'
      : 'If you used gcBuild via start.bat, its artifacts, My builds, teams and downloaded gcsim can be copied over. You can also do this later: ⋯ menu → "Import from old folder".',
    buttons: ru() ? ['Выбрать папку…', 'Не сейчас'] : ['Choose folder…', 'Not now'],
    defaultId: 0,
    cancelId: 1,
  });
  if (r.response === 0) await importOldFolder();
}

ipcMain.handle('import-old', () => importOldFolder());
ipcMain.handle('open-data', () => shell.openPath(dataRoot()));
ipcMain.handle('app-version', () => app.getVersion());

// theme picked in the app: drives prefers-color-scheme, native widgets and the window controls overlay
const themeFile = () => path.join(dataRoot(), 'theme.json');
function loadTheme() {
  try {
    const th = JSON.parse(fs.readFileSync(themeFile(), 'utf8')).theme;
    if (th === 'dark' || th === 'light' || th === 'system') nativeTheme.themeSource = th;
  } catch {
    // first start: follow the OS
  }
}
ipcMain.handle('set-theme', (_e, th: unknown) => {
  if (th !== 'dark' && th !== 'light' && th !== 'system') return;
  nativeTheme.themeSource = th;
  win?.setTitleBarOverlay(overlay());
  try {
    fs.mkdirSync(dataRoot(), { recursive: true });
    fs.writeFileSync(themeFile(), JSON.stringify({ theme: th }));
  } catch {
    // not worth failing over
  }
});

// ------------------------------------------------------------------ lifecycle

app.on('second-instance', () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});

app.whenReady().then(async () => {
  loadTheme();
  const port = await startServer();
  protocol.handle(SCHEME, (request) => {
    const u = new URL(request.url);
    // forward only what the API reads; browser headers (Origin, Sec-Fetch-*) make crossorigin asset requests fail
    const headers = new Headers({ 'x-gcbuild-token': TOKEN });
    for (const h of ['content-type', 'accept']) {
      const v = request.headers.get(h);
      if (v) headers.set(h, v);
    }
    return fetch(`http://127.0.0.1:${port}${u.pathname}${u.search}`, {
      method: request.method,
      headers,
      body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
      // @ts-expect-error: needed by fetch for streamed request bodies
      duplex: 'half',
    }).catch((e: Error) => {
      console.error(`app:// ${request.method} ${u.pathname}: ${e.message}`);
      return new Response(JSON.stringify({ error: e.message }), { status: 502, headers: { 'Content-Type': 'application/json' } });
    });
  });
  createWindow();
  setupUpdater(() => win);
  win!.webContents.once('did-finish-load', () => void firstRun());
});

app.on('window-all-closed', () => app.quit());

import { execSync } from 'node:child_process';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { createGcsimApi } from './server/gcsim';
import { createTeamsApi } from './server/teams';
import { createUserdataApi } from './server/userdata';
import { createEnkaApi } from './server/enka';
import { createDuelApi } from './server/duel';

type Middleware = (req: IncomingMessage, res: ServerResponse, next: () => void) => unknown;

/**
 * Serves the local API from the dev and preview servers:
 * /api/gcsim/* (gcsim CLI bridge), /api/teams/* (teams/ folder), /api/userdata/* (userdata/ folder),
 * /api/enka/:uid (Enka.Network proxy), /api/duel/* (duel server bridge).
 */
function localApi(): Plugin {
  let chain: Middleware[] = [];
  const mw: Middleware = async (req, res, next) => {
    const run = (i: number): void => {
      if (i >= chain.length) return next();
      void chain[i](req, res, () => run(i + 1));
    };
    run(0);
  };
  return {
    name: 'local-api',
    configResolved(config) {
      const gcsim = createGcsimApi(config.root);
      chain = [createTeamsApi(config.root), createUserdataApi(config.root), createEnkaApi(), createDuelApi(gcsim), gcsim];
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => void mw(req, res, next));
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => void mw(req, res, next));
    },
  };
}

// Fixed port: the browser cache of the app's data is tied to the address (localhost:5179).
const PORT = 5179;

/** "0.1.0+abc1234" (git checkout, "-dirty" with local changes) or "0.1.0+zip" (downloaded archive): shown in bug reports. */
function appVersion(): string {
  const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };
  try {
    const sha = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    const dirty = execSync('git status --porcelain --untracked-files=no', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    return `${pkg.version}+${sha}${dirty ? '-dirty' : ''}`;
  } catch {
    return `${pkg.version}+zip`;
  }
}

export default defineConfig({
  plugins: [react(), localApi()],
  define: { __APP_VERSION__: JSON.stringify(appVersion()) },
  base: './',
  build: { chunkSizeWarningLimit: 1000 },
  server: {
    port: PORT,
    strictPort: true,
    // files written by the app itself: don't reload the page when they change
    watch: { ignored: ['**/teams/**', '**/userdata/**', '**/tools/**'] },
  },
  preview: { port: PORT, strictPort: true },
});

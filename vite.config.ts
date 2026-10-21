import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { createGcsimApi } from './server/gcsim';
import { createTeamsApi } from './server/teams';
import { createUserdataApi } from './server/userdata';
import { createEnkaApi } from './server/enka';

type Middleware = ReturnType<typeof createGcsimApi>;

/**
 * Serves the local API from the dev and preview servers:
 * /api/gcsim/* (gcsim CLI bridge), /api/teams/* (teams/ folder), /api/userdata/* (userdata/ folder),
 * /api/enka/:uid (Enka.Network proxy).
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
      chain = [createTeamsApi(config.root), createUserdataApi(config.root), createEnkaApi(), createGcsimApi(config.root)];
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

export default defineConfig({
  plugins: [react(), localApi()],
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

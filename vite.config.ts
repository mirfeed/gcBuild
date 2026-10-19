import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { createGcsimApi } from './server/gcsim';
import { createTeamsApi } from './server/teams';

/** Serves /api/gcsim/* (local gcsim CLI bridge) and /api/teams/* (teams/ folder) from the dev and preview servers. */
function localApi(): Plugin {
  let gcsim: ReturnType<typeof createGcsimApi>;
  let teams: ReturnType<typeof createTeamsApi>;
  const mw = (req: Parameters<typeof gcsim>[0], res: Parameters<typeof gcsim>[1], next: () => void) =>
    void teams(req, res, () => void gcsim(req, res, next));
  return {
    name: 'local-api',
    configResolved(config) {
      gcsim = createGcsimApi(config.root);
      teams = createTeamsApi(config.root);
    },
    configureServer(server) {
      server.middlewares.use(mw);
    },
    configurePreviewServer(server) {
      server.middlewares.use(mw);
    },
  };
}

export default defineConfig({
  plugins: [react(), localApi()],
  base: './',
  build: { chunkSizeWarningLimit: 1000 },
  // saved teams are written by the app itself; don't reload the page when they change
  server: { watch: { ignored: ['**/teams/**', '**/tools/**'] } },
});

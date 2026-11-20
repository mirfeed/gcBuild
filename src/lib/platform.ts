/**
 * Web Lite is the browser-only build the site serves at /app/ (vite.web.config.ts, `npm run build:web`).
 * There is no Electron bridge (src/lib/desktop.ts), no local API (server/) and no gcsim there, so everything
 * that needs one of them is hidden or falls back to browser storage:
 *   - hidden: simulation / ER check / substat optimizer, duels, update checks, data-folder actions
 *   - browser storage instead of userdata/ and teams/: artifacts, My builds, saved teams (src/lib/persist.ts,
 *     src/lib/teamsStore.ts)
 *   - Enka goes through the site's same-origin proxy /app/enka/ (the API sends no CORS headers)
 */
export const IS_WEB_LITE: boolean = typeof __WEB_LITE__ === 'boolean' ? __WEB_LITE__ : false;

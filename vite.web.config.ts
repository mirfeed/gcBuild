import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { appVersion } from './vite.shared';

/**
 * Web Lite: the browser-only build, served at <site>/app/ (nginx configs live in gcSite/deploy).
 *
 * No Electron bridge, no local API (server/), no gcsim: everything that needs one of them is hidden in the app
 * (src/lib/platform.ts). `npm run build:web` sets VITE_WEB_LITE=true and writes the bundle straight into the
 * site's dist/app, so one deploy ships the landing page and the app together.
 */
const OUT = fileURLToPath(new URL('../gcSite/dist/app', import.meta.url));
const WEB_LITE = process.env.VITE_WEB_LITE === 'true';

/** The app is one page of the site: its own title, and not indexed separately (the landing page is what search sees). */
function webPage(): Plugin {
  return {
    name: 'gcweb-page',
    transformIndexHtml(html) {
      return html
        .replace(/<title>[\s\S]*?<\/title>/, '<title>gcBuild — Web Lite</title>')
        .replace(/(\s*)<meta name="viewport"/, '$1<meta name="robots" content="noindex" />$1<meta name="viewport"');
    },
  };
}

export default defineConfig({
  base: '/app/',
  plugins: [react(), webPage()],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion()),
    __WEB_LITE__: JSON.stringify(WEB_LITE),
  },
  build: {
    outDir: OUT,
    // OUT is outside the project root, so Vite only clears it when asked to
    emptyOutDir: true,
    chunkSizeWarningLimit: 1000,
  },
});

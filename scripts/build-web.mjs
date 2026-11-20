/**
 * npm run build:web — Web Lite (base /app/, VITE_WEB_LITE=true) into ../gcSite/dist/app.
 *
 * The flag is set here rather than in the npm script so it works on Windows without cross-env;
 * vite.web.config.ts reads process.env.VITE_WEB_LITE and turns it into __WEB_LITE__.
 */
process.env.VITE_WEB_LITE = 'true';

const { build } = await import('vite');
await build({ configFile: 'vite.web.config.ts' });

// Bundles the Electron main process (electron/main.ts + server/*.ts) into dist-electron/ with esbuild.
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'dist-electron');
fs.mkdirSync(out, { recursive: true });

await build({
  entryPoints: [path.join(root, 'electron/main.ts')],
  outfile: path.join(out, 'main.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['electron'],
  sourcemap: 'linked',
  logLevel: 'warning',
});
fs.copyFileSync(path.join(root, 'electron/preload.cjs'), path.join(out, 'preload.cjs'));
console.log('dist-electron/main.cjs + preload.cjs');

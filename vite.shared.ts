/** Build info shared by vite.config.ts (desktop / local dev) and vite.web.config.ts (Web Lite). */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/** "0.1.0+abc1234" (git checkout, "-dirty" with local changes) or "0.1.0+zip" (downloaded archive): shown in bug reports. */
export function appVersion(): string {
  const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };
  try {
    const sha = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    const dirty = execSync('git status --porcelain --untracked-files=no', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    return `${pkg.version}+${sha}${dirty ? '-dirty' : ''}`;
  } catch {
    return `${pkg.version}+zip`;
  }
}

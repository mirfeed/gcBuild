/**
 * Bug reports: a prefilled GitHub issue (title + body in the URL) with the error, versions and the
 * current gcsim config, so the maintainer can reproduce it. "Copy report" gives the same text for
 * people without a GitHub account.
 */
import { gcsim } from './api';

export const REPO = 'mirfeed/gcBuild';
export const ISSUES_URL = `https://github.com/${REPO}/issues`;

/** GitHub refuses very long URLs; keep the encoded body under this many characters. */
const MAX_ENCODED_BODY = 6000;

export interface ReportInput {
  /** what broke, e.g. "TypeError: x is undefined" */
  error?: string;
  /** stack / extra technical details */
  details?: string;
  /** the generated gcsim config, to reproduce */
  config?: string;
}

export async function environment(): Promise<string> {
  let sim = 'unknown';
  try {
    const s = await gcsim.status();
    sim = s.installed ? `${s.release.tag ?? '?'} (${s.version.split('\n')[0] || '?'})` : 'not installed';
  } catch {
    sim = 'bridge not reachable';
  }
  return [`- gcBuild: ${__APP_VERSION__}`, `- gcsim: ${sim}`, `- Browser: ${navigator.userAgent}`, `- Page: ${location.host}`].join('\n');
}

const fence = (lang: string, text: string) => `\`\`\`${lang}\n${text.trim()}\n\`\`\``;

export function reportBody(r: ReportInput, env: string, configNote = ''): string {
  const parts = [
    '**What happened, and what did you expect?**',
    '<!-- describe the steps: which button, which character / rotation… -->',
    '',
  ];
  if (r.error) parts.push('**Error**', fence('text', [r.error, r.details ?? ''].join('\n\n')), '');
  parts.push('**Environment**', env, '');
  if (r.config) parts.push(`<details><summary>gcsim config${configNote}</summary>\n\n${fence('', r.config)}\n\n</details>`);
  return parts.join('\n');
}

/** Body for the URL: the config is cut first, then the stack, so the link stays openable. */
function fitBody(full: ReportInput, env: string): string {
  const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}\n…` : s);
  // the top of a stack is what matters; the config is the next thing to give up
  const r = { ...full, details: full.details && cut(full.details, 1500) };
  let body = reportBody(r, env);
  if (encodeURIComponent(body).length <= MAX_ENCODED_BODY) return body;
  const config = r.config ?? '';
  for (let n = config.length; n > 0; n = Math.floor(n * 0.8)) {
    body = reportBody({ ...r, config: cut(config, n) }, env, ' (cut: please also attach the full config, Export or the .txt from teams/)');
    if (encodeURIComponent(body).length <= MAX_ENCODED_BODY) return body;
  }
  const details = r.details ?? '';
  for (let n = details.length; n > 0; n = Math.floor(n * 0.7)) {
    body = reportBody({ ...r, details: cut(details, n), config: undefined }, env);
    if (encodeURIComponent(body).length <= MAX_ENCODED_BODY) return body;
  }
  return reportBody({ error: r.error?.slice(0, 500) }, env);
}

export function issueUrl(title: string, r: ReportInput, env: string): string {
  return `${ISSUES_URL}/new?title=${encodeURIComponent(title)}&labels=bug&body=${encodeURIComponent(fitBody(r, env))}`;
}

/** Opens a prefilled GitHub issue in a new tab. */
export async function openReport(title: string, r: ReportInput): Promise<void> {
  // open the tab right away (popup blockers allow it only inside the click), fill the address after
  const tab = window.open('about:blank', '_blank');
  const url = issueUrl(title, r, await environment());
  if (tab) tab.location.href = url;
  else location.href = url;
}

/** Full report as text (nothing cut), for the clipboard. */
export async function reportText(r: ReportInput): Promise<string> {
  return reportBody(r, await environment());
}

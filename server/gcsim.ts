/**
 * Local bridge to the gcsim CLI. Used as Vite dev/preview middleware, so the
 * browser app can download gcsim, run sims, compute ER requirements and run
 * gcsim's KQMS substat optimizer.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

const RELEASES = 'https://api.github.com/repos/genshinsim/gcsim/releases/latest';

interface RunOutput {
  code: number | null;
  stdout: string;
  stderr: string;
}

function exeName() {
  return process.platform === 'win32' ? 'gcsim.exe' : 'gcsim';
}

function assetName() {
  const plat = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'darwin' : 'linux';
  const arch = process.arch === 'arm64' ? 'arm64' : 'amd64';
  return `gcsim_${plat}_${arch}${process.platform === 'win32' ? '.exe' : ''}`;
}

function run(exe: string, args: string[], cwd: string, timeoutMs = 180_000): Promise<RunOutput> {
  return new Promise((resolve, reject) => {
    const p = spawn(exe, args, { cwd, windowsHide: true });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      p.kill();
      reject(new Error(`gcsim timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);
    p.stdout.on('data', (d) => (stdout += d));
    p.stderr.on('data', (d) => (stderr += d));
    p.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    p.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

async function withTmp<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gcbuild-'));
  try {
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

const exists = (p: string) => fs.access(p).then(() => true, () => false);

/** gcsim prints parse errors to stdout/stderr; surface the useful part. */
function cliError(out: RunOutput): Error {
  const text = `${out.stderr}\n${out.stdout}`.trim();
  const line = text.split('\n').reverse().find((l) => /error|invalid|unexpected|panic/i.test(l)) ?? text.split('\n').pop() ?? 'unknown error';
  return new Error(line.replace(/^\S+\s+(ERROR|FATAL)\s+/, '').trim() || `gcsim exited with code ${out.code}`);
}

// ------------------------------------------------------------------ sample trimming

type Log = { char_index: number; ended: number; event: string; frame: number; logs: Record<string, unknown>; msg: string };
type Sample = { config: string; initial_character: string; character_details: unknown[]; target_details: unknown[]; seed: string; logs: Log[] };

const DAMAGE_KEYS = ['abil', 'amp', 'cata', 'crit', 'damage', 'ele', 'target', 'attack-tag'];

/** Keep only what the timeline needs: drops calc/snapshot/icd noise and per-hit buff dumps. */
function trimSample(s: Sample) {
  const logs: Log[] = [];
  for (const l of s.logs) {
    const g = l.logs ?? {};
    const keep = (logs2: Record<string, unknown>) => logs.push({ ...l, logs: logs2 });
    switch (l.event) {
      case 'action':
        keep(g);
        break;
      case 'hitlag':
        if (/ started$/.test(l.msg)) keep({ State: g.State });
        else if (l.msg.startsWith('hitlag applied to char')) keep({ duration: g.duration });
        break;
      case 'damage':
        keep(Object.fromEntries(DAMAGE_KEYS.filter((k) => k in g).map((k) => [k, g[k]])));
        break;
      case 'element':
        if (l.msg === 'application') keep({ abil: g.abil, applied_ele: g.applied_ele, existing: g.existing, after: g.after, target: g.target });
        break;
      case 'energy':
      case 'cooldown':
      case 'hurt':
      case 'heal':
      case 'shield':
        keep(g);
        break;
      case 'status':
        if (!/extended|refreshed/.test(l.msg) || g.overwrite) keep({ key: g.key, expiry: g.expiry });
        break;
      case 'character':
        if (l.msg === 'starting hp set') keep(g);
        break;
      case 'sim':
        if (/could not execute/.test(l.msg)) keep(g);
        break;
    }
  }
  return { ...s, logs };
}

// ------------------------------------------------------------------ ER requirement

interface ErStats {
  char: string;
  bursts: number;
  /** total ER needed (p50 / p80 / max over samples) */
  needed: { p50: number; p80: number; max: number };
  /** ER the character actually had when particles arrived (weighted) */
  current: number;
  /** additional ER needed, p80 over samples (what gcsim's optimizer uses) */
  additional: number;
}

function percentile(xs: number[], p: number) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))];
}

/**
 * Mirrors gcsim's pkg/optimization/optstats/energy_stats.go on a sample log:
 * between bursts, sum raw particle energy (received / ER) and flat energy;
 * ER needed = (burst cost - flat) / raw. The first burst is ignored because
 * characters start with full energy.
 */
function erFromSample(s: Sample) {
  const n = s.character_details.length;
  const raw = Array(n).fill(0);
  const flat = Array(n).fill(0);
  const erWeighted = Array.from({ length: n }, () => ({ er: 0, w: 0 }));
  const needed: number[][] = Array.from({ length: n }, () => []);
  const weighted: number[][] = Array.from({ length: n }, () => []);
  for (const l of s.logs) {
    if (l.event !== 'energy' || l.char_index < 0) continue;
    const i = l.char_index;
    const g = l.logs as Record<string, number | string>;
    if (l.msg === 'particle') {
      const er = Number(g.ER) || 1;
      const r = Number(g.amt) / er;
      raw[i] += r;
      erWeighted[i].er += er * r;
      erWeighted[i].w += r;
    } else if (l.msg === 'adding energy') {
      const amt = Number(g["rec'd"]) || 0;
      flat[i] += amt < 0 ? -Math.min(-amt, Number(g.pre_recovery) || 0) : amt;
    } else if (l.msg === 'draining energy') {
      const cost = Number(g.max_energy) || 0;
      needed[i].push(raw[i] > 0 ? Math.max((cost - flat[i]) / raw[i], 1) : Infinity);
      weighted[i].push(erWeighted[i].w > 0 ? erWeighted[i].er / erWeighted[i].w : NaN);
      raw[i] = 0;
      flat[i] = 0;
      erWeighted[i] = { er: 0, w: 0 };
    }
  }
  return needed.map((xs, i) => {
    const ns = xs.slice(1);
    const ws = weighted[i].slice(1);
    let need = 1;
    let add = -Infinity;
    let cur = Infinity;
    ns.forEach((x, j) => {
      need = Math.max(need, x);
      if (!Number.isNaN(ws[j])) {
        cur = Math.min(cur, ws[j]);
        add = Math.max(add, x - ws[j]);
      }
    });
    return { bursts: xs.length, need, add: Number.isFinite(add) ? add : 0, cur: Number.isFinite(cur) ? cur : NaN };
  });
}

function withOption(config: string, opt: string) {
  return `options ${opt};\n${config}`;
}

// ------------------------------------------------------------------ API

export function createGcsimApi(root: string) {
  const toolsDir = path.join(root, 'tools');
  const exe = path.join(toolsDir, exeName());
  const versionFile = path.join(toolsDir, 'gcsim.version.json');

  async function status() {
    const installed = await exists(exe);
    let version = '';
    let release: { tag?: string; published?: string } = {};
    if (installed) {
      const out = await run(exe, ['-version'], toolsDir, 15_000).catch(() => null);
      version = out?.stdout.trim() ?? '';
      release = JSON.parse(await fs.readFile(versionFile, 'utf8').catch(() => '{}'));
    }
    return { installed, path: exe, version, release };
  }

  async function download() {
    const rel = await fetch(RELEASES, { headers: { 'User-Agent': 'gcbuild', Accept: 'application/vnd.github+json' } });
    if (!rel.ok) throw new Error(`GitHub API ${rel.status}`);
    const info = (await rel.json()) as { tag_name: string; published_at: string; assets: { name: string; browser_download_url: string }[] };
    const asset = info.assets.find((a) => a.name === assetName());
    if (!asset) throw new Error(`no gcsim build for ${assetName()} in ${info.tag_name}`);
    const bin = await fetch(asset.browser_download_url, { headers: { 'User-Agent': 'gcbuild' } });
    if (!bin.ok) throw new Error(`download failed: ${bin.status}`);
    await fs.mkdir(toolsDir, { recursive: true });
    const tmp = `${exe}.download`;
    await fs.writeFile(tmp, Buffer.from(await bin.arrayBuffer()));
    if (process.platform !== 'win32') await fs.chmod(tmp, 0o755);
    await fs.rename(tmp, exe);
    await fs.writeFile(versionFile, JSON.stringify({ tag: info.tag_name, published: info.published_at }));
    return status();
  }

  async function ensureExe() {
    if (!(await exists(exe))) throw new Error('gcsim CLI is not installed. Click "Download gcsim" first.');
  }

  async function simulate(config: string) {
    await ensureExe();
    return withTmp(async (dir) => {
      await fs.writeFile(path.join(dir, 'config.txt'), config);
      const out = await run(exe, ['-c', 'config.txt', '-out', 'result.json', '-sample', 'sample.json', '-nb'], dir);
      const resultPath = path.join(dir, 'result.json');
      if (out.code !== 0 || !(await exists(resultPath))) throw cliError(out);
      const result = JSON.parse(await fs.readFile(resultPath, 'utf8'));
      delete result.statistics?.dev_debug;
      const sample = JSON.parse(await fs.readFile(path.join(dir, 'sample.json'), 'utf8')) as Sample;
      return { result, sample: trimSample(sample), log: out.stdout };
    });
  }

  async function erCalc(config: string, samples = 24): Promise<ErStats[]> {
    await ensureExe();
    return withTmp(async (dir) => {
      await fs.writeFile(path.join(dir, 'config.txt'), withOption(config, 'ignore_burst_energy=true'));
      const per: ReturnType<typeof erFromSample>[] = [];
      let names: string[] = [];
      const one = async (k: number) => {
        const file = `s${k}.json`;
        const out = await run(exe, ['-c', 'config.txt', '-nr', '-sample', file, '-nb'], dir);
        const p = path.join(dir, file);
        if (!(await exists(p))) throw cliError(out);
        const s = JSON.parse(await fs.readFile(p, 'utf8')) as Sample;
        names = (s.character_details as { name: string }[]).map((c) => c.name);
        per.push(erFromSample(s));
        await fs.rm(p, { force: true });
      };
      const queue = Array.from({ length: samples }, (_, k) => k);
      await Promise.all(Array.from({ length: Math.min(4, samples) }, async () => {
        while (queue.length) await one(queue.shift()!);
      }));
      return names.map((char, i) => {
        const needs = per.map((p) => p[i].need).filter(Number.isFinite);
        const adds = per.map((p) => p[i].add);
        const curs = per.map((p) => p[i].cur).filter((x) => !Number.isNaN(x));
        return {
          char,
          bursts: Math.round(per.reduce((a, p) => a + p[i].bursts, 0) / Math.max(1, per.length)),
          needed: { p50: percentile(needs, 0.5), p80: percentile(needs, 0.8), max: Math.max(1, ...needs) },
          current: curs.length ? curs.reduce((a, b) => a + b, 0) / curs.length : NaN,
          additional: percentile(adds, 0.8),
        };
      });
    });
  }

  /** gcsim's own KQMS optimizer; returns the config with optimized substat lines. */
  async function optimize(config: string) {
    await ensureExe();
    return withTmp(async (dir) => {
      await fs.writeFile(path.join(dir, 'config.txt'), config);
      const out = await run(exe, ['-c', 'config.txt', '-substatOptim', '-out', 'optimized.txt', '-nb'], dir, 600_000);
      const p = path.join(dir, 'optimized.txt');
      if (!(await exists(p))) throw cliError(out);
      return { config: await fs.readFile(p, 'utf8'), log: `${out.stdout}\n${out.stderr}`.trim() };
    });
  }

  async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const text = Buffer.concat(chunks).toString('utf8');
    return text ? JSON.parse(text) : {};
  }

  function send(res: ServerResponse, code: number, data: unknown) {
    res.statusCode = code;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(data));
  }

  /** Connect-style middleware for /api/gcsim/*; `simulate` is also used directly by the duel bridge (server/duel.ts). */
  return Object.assign(async function middleware(req: IncomingMessage, res: ServerResponse, next: () => void) {
    const url = req.url ?? '';
    if (!url.startsWith('/api/gcsim/')) return next();
    const route = url.slice('/api/gcsim/'.length).split('?')[0];
    try {
      if (route === 'status' && req.method === 'GET') return send(res, 200, await status());
      if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' });
      const b = await body(req);
      const config = String(b.config ?? '');
      switch (route) {
        case 'download': return send(res, 200, await download());
        case 'run': return send(res, 200, await simulate(config));
        case 'ercalc': return send(res, 200, await erCalc(config, Math.min(64, Math.max(4, Number(b.samples) || 24))));
        case 'optimize': return send(res, 200, await optimize(config));
      }
      return send(res, 404, { error: 'unknown route' });
    } catch (e) {
      return send(res, 500, { error: (e as Error).message });
    }
  }, { simulate, status });
}

export type GcsimApi = ReturnType<typeof createGcsimApi>;

import { getChar } from '../data';
import { gearSets, gearStats } from './artifacts';
import { fmt, mainStatsLine, subStatsLine, SUB_ORDER } from './kqms';
import { withMovement } from './iansan';
import { condToScript, isAction, isBlock } from './rotation';
import type { CharBuild, Project, RotationAction, RotItem, Stat } from './types';

function paramsBlock(p: Record<string, number> | undefined, plus = false): string {
  const entries = Object.entries(p ?? {}).filter(([, v]) => v !== undefined && !Number.isNaN(v));
  if (!entries.length) return '';
  const body = entries.map(([k, v]) => `${k}=${v}`).join(',');
  return plus ? ` +params=[${body}]` : `[${body}]`;
}

export function actionToken(a: RotationAction): string {
  let s = a.action + paramsBlock(a.params);
  if (a.repeat > 1) s += `:${a.repeat}`;
  return s;
}

const LOOP_VARS = ['i', 'j', 'k', 'l', 'm', 'n'];

/** Turn rotation items into gcsim script lines, merging consecutive plain actions of one character. */
export function itemsToScript(list: RotItem[], indent: string, depth = 0): string[] {
  const lines: string[] = [];
  let curChar = '';
  let tokens: string[] = [];
  const flush = () => {
    if (curChar && tokens.length) lines.push(`${indent}${curChar} ${tokens.join(', ')};`);
    curChar = '';
    tokens = [];
  };
  for (const x of list) {
    if (isAction(x)) {
      if (x.action === 'wait' || x.action === 'delay') {
        flush();
        lines.push(`${indent}${x.action}(${Math.max(0, Math.round(x.frames ?? 0))});`);
        continue;
      }
      if (x.cond && x.cond.clauses.length) {
        flush();
        lines.push(`${indent}if ${condToScript(x.cond)} {`);
        lines.push(`${indent}  ${x.char} ${actionToken(x)};`);
        lines.push(`${indent}}`);
        continue;
      }
      if (x.char !== curChar) flush();
      curChar = x.char;
      tokens.push(actionToken(x));
      continue;
    }
    flush();
    if (x.kind === 'if') {
      lines.push(`${indent}if ${condToScript(x.cond)} {`);
      lines.push(...itemsToScript(x.then, indent + '  ', depth));
      if (x.else.length) {
        lines.push(`${indent}} else {`);
        lines.push(...itemsToScript(x.else, indent + '  ', depth));
      }
      lines.push(`${indent}}`);
    } else if (x.kind === 'repeat') {
      const v = LOOP_VARS[depth] ?? `i${depth}`;
      lines.push(`${indent}for let ${v} = 0; ${v} < ${Math.max(1, x.count)}; ${v} = ${v} + 1 {`);
      lines.push(...itemsToScript(x.body, indent + '  ', depth + 1));
      lines.push(`${indent}}`);
    } else if (x.kind === 'raw') {
      for (const l of x.text.split('\n')) lines.push(l.trim() ? indent + l : '');
    }
  }
  flush();
  return lines;
}

/** Characters referenced by the rotation must exist in the team, or gcsim rejects the config. */
function prune(list: RotItem[], keys: Set<string>): RotItem[] {
  return list
    .filter((x) => !isAction(x) || x.action === 'wait' || x.action === 'delay' || keys.has(x.char))
    .map((x) => {
      if (!isBlock(x)) return x;
      if (x.kind === 'if') return { ...x, then: prune(x.then, keys), else: prune(x.else, keys) };
      if (x.kind === 'repeat') return { ...x, body: prune(x.body, keys) };
      return x;
    });
}

function customStatsLine(stats: Partial<Record<Stat, number>>): string {
  return Object.entries(stats)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${fmt(v!)}`)
    .join(' ');
}

export function charLines(b: CharBuild, startEnergyZero = false): string[] {
  const k = b.key;
  const charParams = startEnergyZero ? { ...b.charParams, start_energy: 0 } : b.charParams;
  const lines = [
    `${k} char lvl=${b.level} cons=${b.cons} talent=${b.talents.join(',')}${paramsBlock(charParams, true)};`,
    `${k} add weapon="${b.weapon.key}" refine=${b.weapon.refine} lvl=${b.weapon.level}${paramsBlock(b.weapon.params, true)};`,
  ];
  const buildSets = b.statsMode === 'artifacts' ? gearSets(b.gear) : b.sets;
  for (const s of buildSets) if (s.key) lines.push(`${k} add set="${s.key}" count=${s.count};`);
  if (b.statsMode === 'artifacts') {
    const line = customStatsLine(gearStats(b.gear));
    if (line) lines.push(`${k} add stats ${line}; # artifacts`);
  } else if (b.statsMode === 'custom') {
    const line = customStatsLine(b.customStats ?? {});
    if (line) lines.push(`${k} add stats ${line};`);
  } else {
    lines.push(`${k} add stats ${mainStatsLine(b)}; # main`);
    const liquid = SUB_ORDER.reduce((n, s) => n + (b.liquid[s] ?? 0), 0);
    lines.push(`${k} add stats ${subStatsLine(b)}; # subs (KQMS, ${liquid} liquid)`);
  }
  return lines;
}

/** True when a target line sets hp= (gcsim then runs until the actions end or the target dies). */
export function hpMode(p: Project): boolean {
  return /\bhp\s*=/.test(p.options.rawTargets ?? '');
}

export function generateConfig(p: Project): string {
  const o = p.options;
  const team = p.team.filter((b): b is CharBuild => !!b && !!getChar(b.key));
  const out: string[] = [];
  out.push(`# ${p.name || 'gcsim config'} - generated by gcBuild`);
  let opt = `options iteration=${o.iteration} duration=${o.duration} swap_delay=${o.swapDelay}`;
  if (!o.hitlag) opt += ' hitlag=false';
  if (o.extraOptions?.trim()) opt += ` ${o.extraOptions.trim()}`;
  out.push(opt + ';');
  if (o.rawTargets?.trim()) {
    out.push(o.rawTargets.trim());
  } else {
    for (let i = 0; i < Math.max(1, o.targetCount); i++) {
      const pos = o.targetCount > 1 ? ` radius=2 pos=${(i * 2.4 - (o.targetCount - 1) * 1.2).toFixed(1)},2.4` : '';
      out.push(`target lvl=${o.targetLvl} resist=${o.targetResist}${pos};`);
    }
  }
  if (o.rawEnergy?.trim()) out.push(o.rawEnergy.trim());
  else if (o.energyMode === 'every') out.push(`energy every interval=${o.energyMin},${o.energyMax} amount=${o.energyAmount};`);
  out.push('');
  for (const b of team) {
    out.push(...charLines(b, !!o.startEnergyZero));
    out.push('');
  }
  const active = team.some((b) => b.key === p.active) ? p.active : team[0]?.key;
  if (active) out.push(`active ${active};`, '');

  if (hpMode(p)) {
    // a target with hp= puts gcsim in damage mode, which ignores `duration` and would run forever if an
    // action waits for energy that never comes: end the run at the time limit by killing the targets
    const targets = Math.max(1, (o.rawTargets?.match(/^\s*target\b/gm) ?? []).length);
    out.push('# damage mode ignores duration: stop at the time limit');
    out.push('fn time_limit() {');
    out.push(`  if f() >= ${Math.round(o.duration * 60)} {`);
    for (let i = 1; i <= targets; i++) out.push(`    kill_target(${i});`);
    out.push('  }');
    out.push('}');
    out.push('set_on_tick(time_limit);', '');
  }

  const keys = new Set(team.map((b) => b.key));
  // Iansan: movement for mobile characters' actions (lib/iansan.ts)
  const opener = withMovement(prune(p.rotation.opener, keys), p);
  const loop = withMovement(prune(p.rotation.loop, keys), p);
  const openerLines = itemsToScript(opener, '');
  const loopLines = itemsToScript(loop, '  ');
  // `rot` counts loop iterations (0 = first) for "Rotation #" conditions
  const usesRot = [...openerLines, ...loopLines].some((l) => /\brot\b/.test(l));
  if (usesRot) out.push('let rot = 0;');
  if (opener.length) {
    out.push('# opener');
    out.push(...openerLines);
    out.push('');
  }
  if (loop.length) {
    const forMode = p.rotation.loopMode === 'for';
    const whileHead = 'while 1 {';
    if (usesRot) {
      out.push(forMode ? `while rot < ${p.rotation.loopCount} {` : whileHead);
      out.push(...loopLines);
      out.push('  rot = rot + 1;');
    } else {
      out.push(forMode ? `for let r = 0; r < ${p.rotation.loopCount}; r = r + 1 {` : whileHead);
      out.push(...loopLines);
    }
    out.push('}');
  }
  return out.join('\n') + '\n';
}

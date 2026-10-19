import { useMemo, useState } from 'react';
import { generateConfig, hpMode } from '../lib/config';
import type { Updater } from '../lib/store';
import type { Project, SimOptions } from '../lib/types';

interface Props {
  project: Project;
  update: (fn: Updater) => void;
}

/**
 * Target / energy presets. The DPS Test Dummy++ ones mirror the Miliastra Wonderland
 * world by josjos041: 1 white orb (= 3 clear particles) per N damage dealt.
 */
interface TargetPreset {
  id: string;
  label: string;
  note: string;
  apply: (o: SimOptions) => void;
}

const dummy = (lvl: number, perOrb: number, energyZero: boolean) => (o: SimOptions) => {
  o.rawTargets = `target lvl=${lvl} resist=0.1 hp=999999999 particle_threshold=${perOrb} particle_drop_count=3;`;
  o.rawEnergy = '';
  o.energyMode = 'none';
  o.startEnergyZero = energyZero;
  o.targetLvl = lvl;
  o.targetResist = 0.1;
};

export const TARGET_PRESETS: TargetPreset[] = [
  {
    id: 'gcsim',
    label: 'gcsim / KQMS default',
    note: 'lvl 100, 10% res, a clear particle every 8-12s',
    apply: (o) => {
      o.rawTargets = '';
      o.rawEnergy = '';
      o.energyMode = 'every';
      o.energyMin = 480;
      o.energyMax = 720;
      o.energyAmount = 1;
      o.startEnergyZero = false;
      o.targetLvl = 100;
      o.targetResist = 0.1;
    },
  },
  {
    id: 'a12',
    label: 'DPS Test Dummy++: A12 (Abyss 12-3)',
    note: 'lvl 100, full energy start, 1 white orb per 1.5M damage',
    apply: dummy(100, 1500000, false),
  },
  {
    id: 'sof',
    label: 'DPS Test Dummy++: SoF (Stygian Onslaught Fearless)',
    note: 'in game lvl 105 (gcsim caps targets at 100), no energy start, 1 white orb per 2M damage',
    apply: dummy(100, 2000000, true),
  },
  {
    id: 'sod',
    label: 'DPS Test Dummy++: SoD (Stygian Onslaught Dire)',
    note: 'in game lvl 110 (gcsim caps targets at 100), no energy start, 1 white orb per 4M damage',
    apply: dummy(100, 4000000, true),
  },
];

function presetOf(o: SimOptions): string {
  for (const p of TARGET_PRESETS) {
    const probe = structuredClone(o);
    p.apply(probe);
    if (probe.rawTargets === o.rawTargets && probe.energyMode === o.energyMode && !!probe.startEnergyZero === !!o.startEnergyZero
      && (p.id !== 'gcsim' || (o.energyAmount === 1 && o.energyMin === 480 && o.energyMax === 720 && !o.rawEnergy))) return p.id;
  }
  return '';
}

function NumField({ label, value, step, onChange, title }: { label: string; value: number; step?: number; onChange: (n: number) => void; title?: string }) {
  return (
    <label className="field narrow" title={title}>
      <span>{label}</span>
      <input type="number" step={step ?? 1} value={value} onChange={(e) => onChange(+e.target.value)} />
    </label>
  );
}

export function ConfigPanel({ project, update }: Props) {
  const text = useMemo(() => generateConfig(project), [project]);
  const [copied, setCopied] = useState(false);
  const o = project.options;
  const set = <K extends keyof SimOptions>(k: K, v: SimOptions[K]) => update((p) => { p.options[k] = v; });

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const download = () => {
    const blob = new Blob([text], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${(project.name || 'config').replace(/[^\w-]+/g, '_')}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="config-panel">
      <div className="row wrap opts">
        <label className="field grow" title="Sets the target and energy lines">
          <span>Target preset</span>
          <select
            value={presetOf(o)}
            onChange={(e) => {
              const pr = TARGET_PRESETS.find((x) => x.id === e.target.value);
              if (pr) update((p) => pr.apply(p.options));
            }}
          >
            <option value="">custom</option>
            {TARGET_PRESETS.map((pr) => <option key={pr.id} value={pr.id}>{pr.label}</option>)}
          </select>
        </label>
        <span className="muted small preset-note">
          {TARGET_PRESETS.find((x) => x.id === presetOf(o))?.note ?? 'target / energy set by hand'}
          {hpMode(project) && ' · damage mode: a time_limit function ends each run at the duration'}
        </span>
        <label className="check" title="start_energy=0 for every character">
          <input type="checkbox" checked={!!o.startEnergyZero} onChange={(e) => set('startEnergyZero', e.target.checked)} /> start with 0 energy
        </label>
      </div>
      <div className="row wrap opts">
        <NumField label="Iterations" value={o.iteration} onChange={(n) => set('iteration', Math.max(1, n))} />
        <NumField label="Duration (s)" value={o.duration} onChange={(n) => set('duration', Math.max(1, n))} />
        <NumField label="Swap delay (f)" value={o.swapDelay} onChange={(n) => set('swapDelay', Math.max(0, n))} title="KQMS-style configs commonly use 12; gcsim default is 1" />
        <label className="check"><input type="checkbox" checked={o.hitlag} onChange={(e) => set('hitlag', e.target.checked)} /> hitlag</label>
        <NumField label="Target lvl" value={o.targetLvl} onChange={(n) => set('targetLvl', n)} />
        <NumField label="Resist" value={o.targetResist} step={0.05} onChange={(n) => set('targetResist', n)} />
        <NumField label="Targets" value={o.targetCount} onChange={(n) => set('targetCount', Math.max(1, Math.min(6, n)))} />
        <label className="field narrow">
          <span>Energy</span>
          <select value={o.energyMode} onChange={(e) => set('energyMode', e.target.value as SimOptions['energyMode'])}>
            <option value="every">every</option>
            <option value="none">none</option>
          </select>
        </label>
        {o.energyMode === 'every' && (
          <>
            <NumField label="min (f)" value={o.energyMin} onChange={(n) => set('energyMin', n)} />
            <NumField label="max (f)" value={o.energyMax} onChange={(n) => set('energyMax', n)} />
            <NumField label="amount" value={o.energyAmount} onChange={(n) => set('energyAmount', n)} />
          </>
        )}
      </div>
      <div className="row wrap opts">
        <label className="field grow" title="Extra key=value tokens for the options line, e.g. defhalt=false">
          <span>Extra options</span>
          <input value={o.extraOptions ?? ''} placeholder="e.g. defhalt=false" onChange={(e) => set('extraOptions', e.target.value)} />
        </label>
      </div>
      <div className="row wrap raw-lines">
        <label className="field grow">
          <span>
            Target lines {o.rawTargets?.trim() ? '(custom)' : '(generated)'}
            {o.rawTargets?.trim() && <button type="button" className="btn ghost small" onClick={() => set('rawTargets', '')}>use generated</button>}
          </span>
          <textarea
            spellCheck={false}
            rows={Math.max(1, (o.rawTargets ?? '').split('\n').length)}
            value={o.rawTargets ?? ''}
            placeholder="target lvl=100 resist=0.1 hp=999999999;  (empty = generated from the fields above)"
            onChange={(e) => set('rawTargets', e.target.value)}
          />
        </label>
        <label className="field grow">
          <span>
            Energy / hurt lines {o.rawEnergy?.trim() ? '(custom)' : '(generated)'}
            {o.rawEnergy?.trim() && <button type="button" className="btn ghost small" onClick={() => set('rawEnergy', '')}>use generated</button>}
          </span>
          <textarea
            spellCheck={false}
            rows={Math.max(1, (o.rawEnergy ?? '').split('\n').length)}
            value={o.rawEnergy ?? ''}
            placeholder="energy every interval=480,720 amount=1;  (empty = generated)"
            onChange={(e) => set('rawEnergy', e.target.value)}
          />
        </label>
      </div>
      <div className="config-actions">
        <button type="button" className="btn primary" onClick={copy}>{copied ? 'Copied ✓' : 'Copy config'}</button>
        <button type="button" className="btn" onClick={download}>Download .txt</button>
        <a className="btn ghost" href="https://gcsim.app/simulator" target="_blank" rel="noreferrer">Open gcsim ↗</a>
      </div>
      <pre className="config-text">{text}</pre>
    </div>
  );
}

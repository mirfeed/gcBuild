import { useMemo, useState } from 'react';
import { ELEMENT_COLORS, characters, getChar, sets, weaponByKey, weapons } from '../data';
import { CHAR_META } from '../data/curated';
import { charIcon, setIcon, weaponIcon } from '../data/icons';
import {
  allocate, buildSummary, CIRCLET_STATS, FIXED_ROLLS, generateKqms, GOBLET_STATS, liquidCap, MAIN_VALUES, mainStatList, SANDS_STATS,
  SUB_ORDER, SUB_VALUES, TOTAL_LIQUID,
} from '../lib/kqms';
import { createBuild, defaultRefine } from '../lib/project';
import { critValue, gearSets } from '../lib/artifacts';
import type { SavedBuild } from '../lib/library';
import { SLOTS, type Artifact, type CharBuild, type ScalingStat, type Slot, type Stat, type SubStat } from '../lib/types';
import { ArtifactPicker, fmtStat, SLOT_LABEL } from './Artifacts';
import { Combobox, Icon, type ComboOption } from './Combobox';

const ELEMENT_ORDER = ['pyro', 'hydro', 'anemo', 'electro', 'dendro', 'cryo', 'geo'];

const charOptions: ComboOption[] = [...characters]
  .sort((a, b) => ELEMENT_ORDER.indexOf(a.element) - ELEMENT_ORDER.indexOf(b.element) || a.name.localeCompare(b.name))
  .map((c) => ({
    value: c.key,
    label: c.name,
    hint: `${c.rarity}★ ${c.weapon}`,
    color: ELEMENT_COLORS[c.element],
    group: c.element[0].toUpperCase() + c.element.slice(1),
    icon: charIcon(c.id),
    rarity: c.rarity,
    search: `${c.element} ${c.weapon} ${c.aliases.join(' ')}`,
  }));

const setOptions: ComboOption[] = sets.map((s) => ({ value: s.key, label: s.name, icon: setIcon(s.key), search: s.aliases.join(' ') }));

const STAT_LABEL: Record<string, string> = {
  'atk%': 'ATK%', 'hp%': 'HP%', 'def%': 'DEF%', er: 'ER', em: 'EM', cr: 'Crit Rate', cd: 'Crit DMG', heal: 'Healing',
  'pyro%': 'Pyro DMG', 'hydro%': 'Hydro DMG', 'anemo%': 'Anemo DMG', 'electro%': 'Electro DMG', 'dendro%': 'Dendro DMG',
  'cryo%': 'Cryo DMG', 'geo%': 'Geo DMG', 'phys%': 'Phys DMG', atk: 'ATK', hp: 'HP', def: 'DEF',
};

const CUSTOM_STAT_ORDER: Stat[] = [
  'hp', 'hp%', 'atk', 'atk%', 'def', 'def%', 'er', 'em', 'cr', 'cd', 'heal',
  'pyro%', 'hydro%', 'anemo%', 'electro%', 'dendro%', 'cryo%', 'geo%', 'phys%',
];
const FLAT: Stat[] = ['hp', 'atk', 'def', 'em'];

interface Props {
  slot: number;
  build: CharBuild | null;
  taken: string[];
  isActive: boolean;
  onChange: (b: CharBuild | null) => void;
  onSetActive: () => void;
  onKqms: () => void;
  /** saved builds of this card's character */
  saved: SavedBuild[];
  onSave: () => void;
  /** imported artifact inventory, and which team character uses which artifact id */
  inventory: Artifact[];
  usedBy: Map<string, string>;
}

function StatSelect({ value, options, onChange, disabled }: { value: Stat; options: Stat[]; onChange: (s: Stat) => void; disabled?: boolean }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as Stat)} disabled={disabled}>
      {options.map((s) => (
        <option key={s} value={s}>{STAT_LABEL[s] ?? s}</option>
      ))}
    </select>
  );
}

export function CharCard({ slot, build, taken, isActive, onChange, onSetActive, onKqms, saved, onSave, inventory, usedBy }: Props) {
  const char = build ? getChar(build.key) : undefined;
  const weapon = build ? weaponByKey.get(build.weapon.key) : undefined;
  const color = char ? ELEMENT_COLORS[char.element] : 'var(--border)';
  const [addStat, setAddStat] = useState<Stat>('em');
  const [picking, setPicking] = useState<Slot | null>(null);

  const weaponOptions = useMemo<ComboOption[]>(
    () => (char
      ? weapons.filter((w) => w.type === char.weapon).map((w) => ({
        value: w.key, label: w.name, hint: `${w.rarity}★`, group: `${w.rarity}★`, icon: weaponIcon(w.key), rarity: w.rarity, search: w.aliases.join(' '),
      }))
      : []),
    [char],
  );

  const options = useMemo(() => charOptions.filter((o) => o.value === build?.key || !taken.includes(o.value)), [taken, build?.key]);

  if (!build || !char) {
    return (
      <div className="card char-card empty">
        <div className="slot-label">Slot {slot + 1}</div>
        <Combobox value="" options={options} variant="grid" placeholder="Add character…" onChange={(k) => onChange(createBuild(k))} />
      </div>
    );
  }

  const set = (fn: (b: CharBuild) => void) => {
    const next = structuredClone(build);
    fn(next);
    onChange(next);
  };

  const mode = build.statsMode ?? 'kqms';
  const custom = mode === 'custom';
  const arts = mode === 'artifacts';
  const summary = buildSummary(build, char, weapon);
  const fresh = mode === 'kqms' ? allocate(build, char, weapon) : null;
  const stale = !!fresh && (build.subsFrom ?? 'heuristic') === 'heuristic' && SUB_ORDER.some((s) => (fresh.liquid[s] ?? 0) !== (build.liquid[s] ?? 0));
  const erShort = mode === 'kqms' && summary.er + 1e-6 < build.erTarget;
  // artifacts worn by other team members (an artifact can only be on one character)
  const ownIds = new Set(SLOTS.map((s) => build.gear?.[s]?.id).filter(Boolean));
  const usedElsewhere = new Map([...usedBy].filter(([id]) => !ownIds.has(id)));
  const meta = CHAR_META[char.key];
  const setPieces = build.sets.reduce((n, s) => n + s.count, 0);

  return (
    <div className={`card char-card ${isActive ? 'is-active' : ''}`} style={{ ['--el' as string]: color }}>
      <div className="char-head">
        <Combobox
          className="char-pick"
          value={build.key}
          options={options}
          variant="grid"
          onChange={(k) => k !== build.key && onChange(createBuild(k))}
          renderValue={() => (
            <span className="combo-value">
              <span className="avatar-wrap" style={{ ['--el' as string]: color }}>
                <Icon src={charIcon(char.id)} rarity={char.rarity} size={44} className="avatar" />
              </span>
              <span className="char-title">
                <strong>{char.name}</strong>
                <span className="muted small">{char.rarity}★ {char.element} · {char.weapon} · {char.energy}⚡</span>
              </span>
            </span>
          )}
        />
        <button type="button" className={`icon-btn ${isActive ? 'on' : ''}`} title="Starting active character" onClick={onSetActive}>
          {isActive ? '★' : '☆'}
        </button>
        <button type="button" className="icon-btn" title="Save to My builds" onClick={onSave}>💾</button>
        <button type="button" className="icon-btn" title="Remove" onClick={() => onChange(null)}>✕</button>
      </div>
      {saved.length > 0 && (
        <select
          className="saved-pick"
          value=""
          onChange={(e) => {
            const s = saved.find((x) => x.id === e.target.value);
            if (s) onChange({ ...structuredClone(s.build), uid: build.uid });
          }}
        >
          <option value="">📂 Load a saved build ({saved.length})…</option>
          {saved.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} · {weaponByKey.get(s.build.weapon.key)?.name ?? s.build.weapon.key} R{s.build.weapon.refine} · {new Date(s.savedAt).toLocaleDateString()}
            </option>
          ))}
        </select>
      )}
      <div className="gcsim-key muted small">gcsim key: <code>{build.key}</code>{meta?.effects ? '' : ' · timing data from gcsim statuses'}</div>

      <div className="row">
        <label className="field narrow">
          <span>Lvl</span>
          <input value={build.level} onChange={(e) => set((b) => { b.level = e.target.value; })} />
        </label>
        <label className="field narrow">
          <span>Cons</span>
          <select value={build.cons} onChange={(e) => set((b) => { b.cons = +e.target.value; })}>
            {[0, 1, 2, 3, 4, 5, 6].map((c) => <option key={c} value={c}>C{c}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Talents</span>
          <span className="talents">
            {build.talents.map((tv, i) => (
              <input
                key={i}
                type="number"
                min={1}
                max={10}
                value={tv}
                onChange={(e) => set((b) => { b.talents[i] = Math.max(1, Math.min(10, +e.target.value || 1)); })}
              />
            ))}
          </span>
        </label>
      </div>

      <div className="row">
        <label className="field grow">
          <span>Weapon</span>
          <Combobox
            value={build.weapon.key}
            options={weaponOptions}
            variant="grid"
            onChange={(k) => set((b) => { b.weapon = { key: k, refine: defaultRefine(k), level: '90/90', params: {} }; })}
          />
        </label>
        <label className="field narrow">
          <span>Ref</span>
          <select value={build.weapon.refine} onChange={(e) => set((b) => { b.weapon.refine = +e.target.value; })}>
            {[1, 2, 3, 4, 5].map((r) => <option key={r} value={r}>R{r}</option>)}
          </select>
        </label>
      </div>
      {weapon && Object.keys(weapon.params).length > 0 && (
        <div className="row params">
          {Object.entries(weapon.params).map(([k, desc]) => (
            <label key={k} className="field narrow" title={desc}>
              <span>{k}</span>
              <input
                type="number"
                value={build.weapon.params[k] ?? ''}
                placeholder="-"
                onChange={(e) => set((b) => {
                  if (e.target.value === '') delete b.weapon.params[k];
                  else b.weapon.params[k] = +e.target.value;
                })}
              />
            </label>
          ))}
        </div>
      )}

      {arts ? (
        <div className="sets small">
          <span className="muted">Sets (from artifacts): </span>
          {gearSets(build.gear).length
            ? gearSets(build.gear).map((s) => <span key={s.key} className="gear-item"><Icon src={setIcon(s.key)} size={18} />{sets.find((x) => x.key === s.key)?.name} {s.count}pc</span>)
            : <span className="muted">none</span>}
        </div>
      ) : (
      <div className="sets">
        {build.sets.map((s, i) => (
          <div key={i} className="row tight set-row">
            <Combobox className="grow" value={s.key} options={setOptions} variant="grid" onChange={(k) => set((b) => { b.sets[i].key = k; })} />
            <select value={s.count} title="pieces" onChange={(e) => set((b) => { b.sets[i].count = +e.target.value; })}>
              {[1, 2, 3, 4, 5].map((c) => <option key={c} value={c}>{c}pc</option>)}
            </select>
            <button type="button" className="icon-btn" title="Remove set" onClick={() => set((b) => { b.sets.splice(i, 1); })}>✕</button>
          </div>
        ))}
        <div className="row tight">
          <button
            type="button"
            className="btn ghost small"
            disabled={setPieces >= 5}
            onClick={() => set((b) => {
              if (b.sets.length === 1 && b.sets[0].count === 4) b.sets[0].count = 2;
              b.sets.push({ key: 'gladiatorsfinale', count: 2 });
            })}
          >
            + set
          </button>
          {setPieces > 5 && <span className="warn small">more than 5 pieces</span>}
        </div>
      </div>
      )}

      <div className="kqms">
        <div className="kqms-head">
          <span className="seg">
            <button type="button" className={mode === 'kqms' ? 'on' : ''} onClick={() => mode === 'kqms' || set((b) => { Object.assign(b, generateKqms({ ...b, statsMode: 'kqms' }, char, weapon)); b.statsMode = 'kqms'; })}>
              KQMS
            </button>
            <button type="button" className={arts ? 'on' : ''} onClick={() => arts || set((b) => { b.statsMode = 'artifacts'; b.gear = b.gear ?? {}; })}>
              Artifacts
            </button>
            <button type="button" className={custom ? 'on' : ''} onClick={() => custom || set((b) => {
              // freeze the current KQMS artifact stats as editable numbers
              b.statsMode = 'custom';
              b.customStats = customFromKqms(build);
            })}>
              Custom stats
            </button>
          </span>
          {mode === 'kqms' && (
            <button type="button" className="btn primary small" onClick={onKqms} title="Allocate 20 fixed + 20 liquid substats (KQM standards)">
              Generate KQMS
            </button>
          )}
        </div>

        {arts ? (
          <>
            <div className="gear-slots">
              {SLOTS.map((s) => {
                const a = build.gear?.[s];
                return (
                  <button key={s} type="button" className={`gear-slot ${a ? 'filled' : ''}`} onClick={() => setPicking(s)} title={a ? `${SLOT_LABEL[s]}: click to change` : `Pick a ${s}`}>
                    {a ? (
                      <>
                        <Icon src={setIcon(a.set)} size={30} />
                        <span className="gs-main">{fmtStat(a.main, a.mainValue)}<small>{a.main}</small></span>
                        <span className="gs-cv">CV {critValue(a)}</span>
                      </>
                    ) : (
                      <span className="muted">+ {SLOT_LABEL[s]}</span>
                    )}
                  </button>
                );
              })}
            </div>
            {!inventory.length && <div className="hint small">No artifacts imported yet: open <b>Artifacts</b> in the header and import a GOOD export.</div>}
            {picking && (
              <ArtifactPicker
                slot={picking}
                inventory={inventory}
                current={build.gear?.[picking]}
                usedBy={usedElsewhere}
                onPick={(a) => { set((b) => { b.gear = { ...b.gear, [picking]: a }; }); setPicking(null); }}
                onClear={() => { set((b) => { const g = { ...b.gear }; delete g[picking]; b.gear = g; }); setPicking(null); }}
                onClose={() => setPicking(null)}
              />
            )}
          </>
        ) : custom ? (
          <>
            <div className="custom-stats">
              {CUSTOM_STAT_ORDER.filter((s) => (build.customStats ?? {})[s] !== undefined).map((s) => (
                <label key={s} className="field cstat">
                  <span>{STAT_LABEL[s]}</span>
                  <span className="row tight">
                    <input
                      type="number"
                      step={FLAT.includes(s) ? 1 : 0.001}
                      value={build.customStats?.[s] ?? 0}
                      onChange={(e) => set((b) => { b.customStats = { ...b.customStats, [s]: +e.target.value }; })}
                    />
                    <button type="button" className="icon-btn" title="Remove" onClick={() => set((b) => { const c = { ...b.customStats }; delete c[s]; b.customStats = c; })}>✕</button>
                  </span>
                </label>
              ))}
            </div>
            <div className="row tight">
              <select value={addStat} onChange={(e) => setAddStat(e.target.value as Stat)}>
                {CUSTOM_STAT_ORDER.filter((s) => (build.customStats ?? {})[s] === undefined).map((s) => <option key={s} value={s}>{STAT_LABEL[s]}</option>)}
              </select>
              <button type="button" className="btn ghost small" onClick={() => set((b) => { b.customStats = { ...b.customStats, [addStat]: 0 }; })}>+ stat</button>
              <span className="muted small">percent stats as fractions (0.466 = 46.6%)</span>
            </div>
          </>
        ) : (
          <>
            <div className="row">
              <label className="field narrow">
                <span>Scales on</span>
                <select value={build.profile.stat} onChange={(e) => set((b) => { b.profile.stat = e.target.value as ScalingStat; })}>
                  <option value="atk">ATK</option>
                  <option value="hp">HP</option>
                  <option value="def">DEF</option>
                  <option value="em">EM</option>
                </select>
              </label>
              <label className="check" title="Include crit in the damage proxy">
                <input type="checkbox" checked={build.profile.crit} onChange={(e) => set((b) => { b.profile.crit = e.target.checked; })} /> Crit
              </label>
              <label className="check" title="Vaporize / melt: value EM through the amplifying multiplier">
                <input type="checkbox" checked={build.profile.amp} onChange={(e) => set((b) => { b.profile.amp = e.target.checked; })} /> Vape/Melt
              </label>
              <label className="field narrow" title="Total Energy Recharge to reach before other substats">
                <span>ER target %</span>
                <input
                  type="number"
                  step={5}
                  value={Math.round(build.erTarget * 1000) / 10}
                  onChange={(e) => set((b) => { b.erTarget = (+e.target.value || 100) / 100; })}
                />
              </label>
            </div>
            <div className="row">
              <label className="field">
                <span>Sands</span>
                <StatSelect value={build.main.sands} options={SANDS_STATS} disabled={build.autoMain} onChange={(s) => set((b) => { b.main.sands = s; })} />
              </label>
              <label className="field">
                <span>Goblet</span>
                <StatSelect value={build.main.goblet} options={GOBLET_STATS} disabled={build.autoMain} onChange={(s) => set((b) => { b.main.goblet = s; })} />
              </label>
              <label className="field">
                <span>Circlet</span>
                <StatSelect value={build.main.circlet} options={CIRCLET_STATS} disabled={build.autoMain} onChange={(s) => set((b) => { b.main.circlet = s; })} />
              </label>
              <label className="check" title="Let KQMS pick sands / goblet / circlet">
                <input type="checkbox" checked={build.autoMain} onChange={(e) => set((b) => { b.autoMain = e.target.checked; })} /> auto
              </label>
            </div>

            <div className="liquid">
              {SUB_ORDER.map((s) => {
                const n = build.liquid[s] ?? 0;
                const cap = liquidCap(build, s);
                return (
                  <span key={s} className={`roll ${n ? 'has' : ''}`} title={`${STAT_LABEL[s]}: 2 fixed + ${n} liquid (cap ${cap})`}>
                    <button type="button" disabled={n <= 0} onClick={() => set((b) => { b.liquid[s as SubStat] = n - 1; b.subsFrom = 'manual'; })}>−</button>
                    <span>{s} <b>{n}</b></span>
                    <button
                      type="button"
                      disabled={n >= cap || summary.liquidUsed >= TOTAL_LIQUID}
                      onClick={() => set((b) => { b.liquid[s as SubStat] = n + 1; b.subsFrom = 'manual'; })}
                    >+</button>
                  </span>
                );
              })}
            </div>
            {build.subsFrom === 'gcsim' && <div className="hint small">Substats from gcsim's optimizer.</div>}
          </>
        )}

        <div className="stat-line small">
          <span>ATK <b>{Math.round(summary.atk)}</b></span>
          <span>HP <b>{Math.round(summary.hp)}</b></span>
          <span>DEF <b>{Math.round(summary.def)}</b></span>
          <span>EM <b>{Math.round(summary.em)}</b></span>
          <span className={erShort ? 'warn' : ''}>ER <b>{(summary.er * 100).toFixed(1)}%</b></span>
          <span>CR/CD <b>{(summary.cr * 100).toFixed(1)}/{(summary.cd * 100).toFixed(1)}</b></span>
          {mode === 'kqms' && <span className={summary.liquidUsed !== TOTAL_LIQUID ? 'warn' : 'muted'}>liquid {summary.liquidUsed}/{TOTAL_LIQUID}</span>}
        </div>
        {stale && <div className="hint small">Substats differ from the KQMS allocation for these inputs. Click Generate KQMS to reallocate.</div>}
        {erShort && !stale && <div className="hint warn small">ER target not reachable with KQMS liquid caps.</div>}
      </div>
    </div>
  );
}

/** Artifact stats (mains + subs) of a KQMS build, as one custom stat map. */
function customFromKqms(b: CharBuild): Partial<Record<Stat, number>> {
  const out: Partial<Record<Stat, number>> = {};
  const add = (k: Stat, v: number) => { out[k] = Math.round(((out[k] ?? 0) + v) * 10000) / 10000; };
  for (const m of mainStatList(b)) add(m, MAIN_VALUES[m] ?? 0);
  for (const s of SUB_ORDER) add(s, SUB_VALUES[s] * (FIXED_ROLLS + (b.liquid[s] ?? 0)));
  return out;
}

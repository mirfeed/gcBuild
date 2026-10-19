import { useEffect, useMemo, useRef, useState } from 'react';
import { getChar, setByKey } from '../data';
import { setIcon } from '../data/icons';
import { critValue, parseGoodArtifacts, subValue, type Inventory } from '../lib/artifacts';
import { SLOTS, type Artifact, type Slot, type Stat } from '../lib/types';
import { Icon } from './Combobox';

const SHORT: Record<string, string> = {
  hp: 'HP', 'hp%': 'HP%', atk: 'ATK', 'atk%': 'ATK%', def: 'DEF', 'def%': 'DEF%', em: 'EM', er: 'ER', cr: 'CR', cd: 'CD',
  heal: 'Heal', 'pyro%': 'Pyro', 'hydro%': 'Hydro', 'anemo%': 'Anemo', 'electro%': 'Electro', 'dendro%': 'Dendro',
  'cryo%': 'Cryo', 'geo%': 'Geo', 'phys%': 'Phys',
};
const FLAT = new Set<Stat>(['hp', 'atk', 'def', 'em']);
export const SLOT_LABEL: Record<Slot, string> = { flower: 'Flower', plume: 'Plume', sands: 'Sands', goblet: 'Goblet', circlet: 'Circlet' };

export const fmtStat = (s: Stat, v: number) => (FLAT.has(s) ? `${Math.round(v)}` : `${(v * 100).toFixed(1)}%`);

type SortKey = 'cv' | 'level' | Stat;
const SORTS: { key: SortKey; label: string }[] = [
  { key: 'cv', label: 'Crit value' }, { key: 'cr', label: 'CR' }, { key: 'cd', label: 'CD' }, { key: 'er', label: 'ER' },
  { key: 'em', label: 'EM' }, { key: 'hp%', label: 'HP%' }, { key: 'atk%', label: 'ATK%' }, { key: 'def%', label: 'DEF%' },
  { key: 'level', label: 'Level' },
];

export function ArtifactCard({ a, badge, onClick, selected }: { a: Artifact; badge?: string; onClick?: () => void; selected?: boolean }) {
  const set = setByKey.get(a.set);
  const loc = a.location ? getChar(a.location)?.name ?? a.location : '';
  return (
    <button type="button" className={`art-card r${a.rarity} ${selected ? 'sel' : ''}`} onClick={onClick} disabled={!onClick} title={set?.name}>
      <span className="art-top">
        <Icon src={setIcon(a.set)} size={34} />
        <span className="art-main">
          <b>{SHORT[a.main]} {fmtStat(a.main, a.mainValue)}</b>
          <span className="muted">{SLOT_LABEL[a.slot]} +{a.level} · {'★'.repeat(a.rarity)}</span>
        </span>
        <span className="art-cv" title="crit value (2×CR + CD)">{critValue(a)}</span>
      </span>
      <span className="art-subs">
        {a.subs.map((s) => (
          <span key={s.stat} className={s.stat === 'cr' || s.stat === 'cd' ? 'crit' : ''}>{SHORT[s.stat]} {fmtStat(s.stat, s.value)}</span>
        ))}
      </span>
      {(loc || badge) && (
        <span className="art-tags">
          {loc && <span className="muted">in game: {loc}</span>}
          {badge && <span className="warn">{badge}</span>}
        </span>
      )}
    </button>
  );
}

interface BrowserProps {
  items: Artifact[];
  slot?: Slot;
  selectedId?: string;
  usedBy?: Map<string, string>;
  onPick?: (a: Artifact) => void;
}

/** Filterable, sortable artifact grid (inventory view and slot picker). */
export function ArtifactBrowser({ items, slot, selectedId, usedBy, onPick }: BrowserProps) {
  const [slotF, setSlotF] = useState<Slot | ''>(slot ?? '');
  const [setF, setSetF] = useState('');
  const [mainF, setMainF] = useState('');
  const [sort, setSort] = useState<SortKey>('cv');
  const [limit, setLimit] = useState(60);

  const pool = useMemo(() => items.filter((a) => !slotF || a.slot === slotF), [items, slotF]);
  const setsHere = useMemo(() => [...new Set(pool.map((a) => a.set))].sort((x, y) => (setByKey.get(x)?.name ?? x).localeCompare(setByKey.get(y)?.name ?? y)), [pool]);
  const mainsHere = useMemo(() => [...new Set(pool.map((a) => a.main))], [pool]);

  const list = useMemo(() => {
    const f = pool.filter((a) => (!setF || a.set === setF) && (!mainF || a.main === mainF));
    const score = (a: Artifact) => (sort === 'cv' ? critValue(a) : sort === 'level' ? a.level * 10 + a.rarity : subValue(a, sort) * (FLAT.has(sort) ? 1 : 100));
    return f.sort((a, b) => score(b) - score(a) || critValue(b) - critValue(a));
  }, [pool, setF, mainF, sort]);

  useEffect(() => setLimit(60), [slotF, setF, mainF, sort]);

  return (
    <div className="art-browser">
      <div className="row tight art-filters">
        {!slot && (
          <select value={slotF} onChange={(e) => setSlotF(e.target.value as Slot | '')}>
            <option value="">all slots</option>
            {SLOTS.map((s) => <option key={s} value={s}>{SLOT_LABEL[s]}</option>)}
          </select>
        )}
        <select value={setF} onChange={(e) => setSetF(e.target.value)}>
          <option value="">all sets ({setsHere.length})</option>
          {setsHere.map((s) => <option key={s} value={s}>{setByKey.get(s)?.name ?? s}</option>)}
        </select>
        <select value={mainF} onChange={(e) => setMainF(e.target.value)}>
          <option value="">any main stat</option>
          {mainsHere.map((m) => <option key={m} value={m}>{SHORT[m]}</option>)}
        </select>
        <label className="small muted">sort
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
            {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </label>
        <span className="muted small">{list.length} artifact(s)</span>
      </div>
      <div className="art-grid">
        {list.slice(0, limit).map((a) => (
          <ArtifactCard
            key={a.id}
            a={a}
            selected={a.id === selectedId}
            badge={usedBy?.get(a.id) ? `used by ${usedBy.get(a.id)}` : undefined}
            onClick={onPick ? () => onPick(a) : undefined}
          />
        ))}
      </div>
      {list.length > limit && (
        <button type="button" className="btn ghost small" onClick={() => setLimit((n) => n + 120)}>show more ({list.length - limit} left)</button>
      )}
    </div>
  );
}

export function ArtifactPicker({
  slot, inventory, current, usedBy, onPick, onClear, onClose,
}: {
  slot: Slot;
  inventory: Artifact[];
  current?: Artifact;
  usedBy: Map<string, string>;
  onPick: (a: Artifact) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label={`Pick ${slot}`}>
        <div className="panel-head">
          <h2>Pick {SLOT_LABEL[slot].toLowerCase()}</h2>
          {current && <span className="muted small">current: {SHORT[current.main]} · CV {critValue(current)}</span>}
          <span className="grow" />
          {current && <button type="button" className="btn ghost small" onClick={onClear}>Unequip</button>}
          <button type="button" className="icon-btn" onClick={onClose} title="Close">✕</button>
        </div>
        {inventory.some((a) => a.slot === slot) ? (
          <ArtifactBrowser items={inventory} slot={slot} selectedId={current?.id} usedBy={usedBy} onPick={onPick} />
        ) : (
          <div className="muted">No {slot} artifacts in the inventory. Import a GOOD export from the Artifacts panel first.</div>
        )}
      </div>
    </div>
  );
}

export function ArtifactsPanel({ inventory, usedBy, onClose }: { inventory: Inventory; usedBy: Map<string, string>; onClose: () => void }) {
  const [paste, setPaste] = useState(false);
  const [text, setText] = useState('');
  const [msg, setMsg] = useState<{ text: string; warnings: string[] } | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const doImport = (raw: string) => {
    try {
      const { artifacts, warnings, source } = parseGoodArtifacts(raw);
      if (!artifacts.length) throw new Error('no artifacts found');
      inventory.replace(artifacts);
      setMsg({ text: `Imported ${artifacts.length} artifacts from ${source}. Build characters by switching a team card to "Artifacts".`, warnings });
      setPaste(false);
      setText('');
    } catch (e) {
      setMsg({ text: `Could not import: ${(e as Error).message}`, warnings: [] });
    }
  };

  const bySlot = SLOTS.map((s) => [s, inventory.items.filter((a) => a.slot === s).length] as const);

  return (
    <section className="panel library">
      <div className="panel-head">
        <h2>Artifacts</h2>
        <span className="muted small">
          {inventory.items.length ? bySlot.map(([s, n]) => `${n} ${s}`).join(' · ') : 'Import a GOOD export (Genshin Optimizer, Inventory Kamera, Irminsul…). Only artifacts are read.'}
        </span>
        <span className="grow" />
        <button type="button" className="btn primary small" onClick={() => file.current?.click()}>Import GOOD file</button>
        <button type="button" className="btn ghost small" onClick={() => setPaste((v) => !v)}>Paste GOOD</button>
        {inventory.items.length > 0 && (
          <button type="button" className="btn ghost small danger" onClick={() => confirm('Remove all imported artifacts? Builds keep their own copies.') && inventory.clear()}>
            Clear
          </button>
        )}
        <button type="button" className="icon-btn" onClick={onClose} title="Close">✕</button>
        <input
          ref={file}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f) doImport(await f.text());
            e.target.value = '';
          }}
        />
      </div>
      {paste && (
        <div className="lib-paste">
          <textarea className="import-text" spellCheck={false} placeholder='{"format":"GOOD","version":2,"artifacts":[…]}' value={text} onChange={(e) => setText(e.target.value)} />
          <button type="button" className="btn primary small" disabled={!text.trim()} onClick={() => doImport(text)}>Import</button>
        </div>
      )}
      {(msg || inventory.error) && (
        <div className="hint small lib-result">
          {msg && <div>{msg.text}</div>}
          {msg?.warnings.map((w) => <div key={w} className="warn">{w}</div>)}
          {inventory.error && <div className="warn">{inventory.error}</div>}
        </div>
      )}
      {inventory.items.length > 0 && <ArtifactBrowser items={inventory.items} usedBy={usedBy} />}
    </section>
  );
}

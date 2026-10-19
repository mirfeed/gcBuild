import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';

export interface ComboOption {
  value: string;
  label: string;
  hint?: string;
  color?: string;
  group?: string;
  icon?: string;
  rarity?: number;
  /** extra text matched by the search box (element, weapon type, aliases...) */
  search?: string;
}

interface Props {
  value: string;
  options: ComboOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  /** `grid` shows options as icon tiles, handy when you know the look but not the name */
  variant?: 'list' | 'grid';
  renderValue?: (o: ComboOption | undefined) => ReactNode;
}

export function Icon({ src, rarity, size = 22, className }: { src?: string; rarity?: number; size?: number; className?: string }) {
  const [broken, setBroken] = useState(false);
  if (!src || broken) return <span className={`ico ico-empty ${className ?? ''}`} style={{ width: size, height: size }} />;
  return (
    <img
      className={`ico ${rarity ? `r${rarity}` : ''} ${className ?? ''}`}
      src={src}
      width={size}
      height={size}
      loading="lazy"
      alt=""
      onError={() => setBroken(true)}
    />
  );
}

/** Searchable select with keyboard navigation, as a list or an icon grid. */
export function Combobox({ value, options, onChange, placeholder, className, variant = 'list', renderValue }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [hi, setHi] = useState(0);
  const [alignRight, setAlignRight] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.value === value);
  const grid = variant === 'grid';

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) => o.label.toLowerCase().includes(q) || o.value.includes(q) || o.hint?.toLowerCase().includes(q) || o.search?.toLowerCase().includes(q),
    );
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  useEffect(() => {
    if (open) {
      setQuery('');
      const idx = options.findIndex((o) => o.value === value);
      setHi(Math.max(0, idx));
      requestAnimationFrame(() => input.current?.focus());
    }
  }, [open, options, value]);

  // keep the popup inside the viewport
  useLayoutEffect(() => {
    if (!open || !pop.current || !root.current) return;
    const btn = root.current.getBoundingClientRect();
    const w = pop.current.offsetWidth;
    setAlignRight(btn.left + w > window.innerWidth - 8 && btn.right - w >= 8);
  }, [open]);

  useEffect(() => {
    const el = list.current?.querySelector<HTMLElement>(`[data-idx="${hi}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [hi, open]);

  const choose = (o: ComboOption | undefined) => {
    if (!o) return;
    onChange(o.value);
    setOpen(false);
  };

  const cols = () => {
    if (!grid || !list.current) return 1;
    const tile = list.current.querySelector<HTMLElement>('.combo-tile');
    return tile ? Math.max(1, Math.round(list.current.clientWidth / (tile.offsetWidth + 4))) : 1;
  };

  const groups: { name: string; items: { o: ComboOption; i: number }[] }[] = [];
  filtered.forEach((o, i) => {
    const name = o.group ?? '';
    if (!groups.length || groups[groups.length - 1].name !== name) groups.push({ name, items: [] });
    groups[groups.length - 1].items.push({ o, i });
  });

  return (
    <div className={`combo ${className ?? ''}`} ref={root}>
      <button type="button" className="combo-btn" onClick={() => setOpen((v) => !v)} aria-haspopup="listbox" aria-expanded={open}>
        {renderValue ? renderValue(selected) : (
          <span className="combo-value">
            {selected?.icon && <Icon src={selected.icon} rarity={selected.rarity} />}
            {!selected?.icon && selected?.color && <span className="dot" style={{ background: selected.color }} />}
            <span className="combo-text">{selected?.label ?? <span className="muted">{placeholder ?? 'Select…'}</span>}</span>
          </span>
        )}
        <span className="caret">▾</span>
      </button>
      {open && (
        <div ref={pop} className={`combo-pop ${grid ? 'grid' : ''} ${alignRight ? 'right' : ''}`}>
          <input
            ref={input}
            className="combo-search"
            value={query}
            placeholder="Search…"
            onChange={(e) => {
              setQuery(e.target.value);
              setHi(0);
            }}
            onKeyDown={(e) => {
              const step = e.key === 'ArrowDown' ? cols() : e.key === 'ArrowUp' ? -cols() : grid && e.key === 'ArrowRight' ? 1 : grid && e.key === 'ArrowLeft' ? -1 : 0;
              if (step) {
                e.preventDefault();
                setHi((h) => Math.max(0, Math.min(filtered.length - 1, h + step)));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                choose(filtered[hi]);
              } else if (e.key === 'Escape') {
                setOpen(false);
              }
              e.stopPropagation();
            }}
          />
          <div className="combo-list" role="listbox" ref={list}>
            {groups.map((g) => (
              <div key={g.name || '_'} className="combo-grp">
                {g.name && <div className="combo-group">{g.name}</div>}
                <div className={grid ? 'combo-tiles' : ''}>
                  {g.items.map(({ o, i }) => (
                    <div
                      key={o.value}
                      role="option"
                      aria-selected={o.value === value}
                      data-idx={i}
                      title={grid ? `${o.label}${o.hint ? ` · ${o.hint}` : ''}` : undefined}
                      className={`${grid ? 'combo-tile' : 'combo-opt'} ${i === hi ? 'hi' : ''} ${o.value === value ? 'sel' : ''}`}
                      onMouseEnter={() => setHi(i)}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        choose(o);
                      }}
                    >
                      {grid ? (
                        <>
                          <span className="tile-img" style={o.color ? { ['--el' as string]: o.color } : undefined}>
                            <Icon src={o.icon} rarity={o.rarity} size={56} />
                            {o.color && <span className="tile-el" style={{ background: o.color }} />}
                          </span>
                          <span className="tile-name">{o.label}</span>
                        </>
                      ) : (
                        <>
                          {o.icon ? <Icon src={o.icon} rarity={o.rarity} /> : o.color && <span className="dot" style={{ background: o.color }} />}
                          <span className="combo-label">{o.label}</span>
                          {o.hint && <span className="combo-hint">{o.hint}</span>}
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {!filtered.length && <div className="combo-empty">No matches</div>}
          </div>
        </div>
      )}
    </div>
  );
}

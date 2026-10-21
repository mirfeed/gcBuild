import { useMemo, useState } from 'react';
import { ELEMENT_COLORS, getChar, setByKey, weaponByKey } from '../data';
import { charIcon, setIcon, weaponIcon } from '../data/icons';
import { gearSets } from '../lib/artifacts';
import { buildSummary } from '../lib/kqms';
import type { Library, SavedBuild } from '../lib/library';
import type { CharBuild, Project } from '../lib/types';
import { Icon } from './Combobox';

interface Props {
  library: Library;
  project: Project;
  /** put a build into the team: slot index, or undefined = same character's slot / first free slot */
  onUse: (build: CharBuild, slot?: number) => void;
  onClose: () => void;
}

export function BuildStats({ build }: { build: CharBuild }) {
  const char = getChar(build.key);
  if (!char) return null;
  const s = buildSummary(build, char, weaponByKey.get(build.weapon.key));
  return (
    <div className="stat-line small">
      <span>ATK <b>{Math.round(s.atk)}</b></span>
      <span>HP <b>{Math.round(s.hp)}</b></span>
      <span>EM <b>{Math.round(s.em)}</b></span>
      <span>ER <b>{(s.er * 100).toFixed(1)}%</b></span>
      <span>CR/CD <b>{(s.cr * 100).toFixed(1)}/{(s.cd * 100).toFixed(1)}</b></span>
    </div>
  );
}

export function BuildGear({ build }: { build: CharBuild }) {
  const w = weaponByKey.get(build.weapon.key);
  const buildSets = build.statsMode === 'artifacts' ? gearSets(build.gear) : build.sets;
  return (
    <div className="gear small">
      <span className="gear-item" title={w?.name ?? build.weapon.key}>
        <Icon src={weaponIcon(build.weapon.key)} rarity={w?.rarity} size={22} />
        <span className="gear-name">{w?.name ?? build.weapon.key}</span> R{build.weapon.refine}
      </span>
      {buildSets.map((s) => (
        <span key={s.key} className="gear-item" title={setByKey.get(s.key)?.name ?? s.key}>
          <Icon src={setIcon(s.key)} size={22} />
          {s.count}pc
        </span>
      ))}
      <span className="muted">{build.statsMode === 'artifacts' ? 'artifacts' : build.statsMode === 'custom' ? 'custom stats' : 'KQMS'}</span>
    </div>
  );
}

export function LibraryPanel({ library, project, onUse, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const teamKeys = project.team.filter(Boolean).map((b) => b!.key);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? library.items.filter((x) => `${x.name} ${getChar(x.build.key)?.name ?? x.build.key}`.toLowerCase().includes(q))
      : library.items;
    // team characters first
    return [...list].sort((a, b) => Number(teamKeys.includes(b.build.key)) - Number(teamKeys.includes(a.build.key)));
  }, [library.items, query, teamKeys]);

  return (
    <section className="panel library">
      <div className="panel-head">
        <h2>My builds</h2>
        <span className="muted small">{library.items.length} saved in this browser. Save a team card with 💾; load it back from the card or from here.</span>
        <span className="grow" />
        <input className="lib-search" placeholder="search…" value={query} onChange={(e) => setQuery(e.target.value)} />
        {library.items.length > 0 && (
          <button
            type="button"
            className="btn ghost small danger"
            onClick={() => confirm(`Delete all ${library.items.length} saved builds?`) && library.removeAll()}
          >
            Delete all
          </button>
        )}
        <button type="button" className="icon-btn" onClick={onClose} title="Close">✕</button>
      </div>

      {library.backup.length > 0 && (
        <div className="hint warn small lib-result">
          <div>This browser had a different build list ({library.backup.length} builds) than the userdata folder ({library.items.length}).</div>
          <span className="row tight">
            <button type="button" className="btn primary small" onClick={() => confirm(`Replace the current ${library.items.length} builds with the ${library.backup.length} from the browser backup?`) && library.restoreBackup()}>
              Restore {library.backup.length} from browser backup
            </button>
            <button type="button" className="btn ghost small" onClick={library.dropBackup}>Dismiss</button>
          </span>
        </div>
      )}
      {filtered.length ? (
        <div className="lib-grid">
          {filtered.map((x) => (
            <LibCard
              key={x.id}
              item={x}
              inTeam={teamKeys.includes(x.build.key)}
              project={project}
              editing={editing === x.id}
              setEditing={(v) => setEditing(v ? x.id : null)}
              onRename={(n) => library.rename(x.id, n)}
              onDelete={() => library.remove(x.id)}
              onUse={(slot) => onUse(structuredClone(x.build), slot)}
            />
          ))}
        </div>
      ) : (
        <div className="muted small">No saved builds yet.</div>
      )}
    </section>
  );
}

function LibCard({
  item, inTeam, project, editing, setEditing, onRename, onDelete, onUse,
}: {
  item: SavedBuild;
  inTeam: boolean;
  project: Project;
  editing: boolean;
  setEditing: (v: boolean) => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  onUse: (slot?: number) => void;
}) {
  const char = getChar(item.build.key);
  const color = char ? ELEMENT_COLORS[char.element] : 'var(--border)';
  return (
    <div className={`card lib-card ${inTeam ? 'in-team' : ''}`} style={{ ['--el' as string]: color }}>
      <div className="lib-head">
        {char && <Icon src={charIcon(char.id)} rarity={char.rarity} size={36} className="avatar" />}
        <div className="lib-title">
          <strong>{char?.name ?? item.build.key}</strong>
          {editing ? (
            <input
              autoFocus
              defaultValue={item.name}
              onBlur={(e) => { onRename(e.target.value.trim() || item.name); setEditing(false); }}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
            />
          ) : (
            <span className="muted small" onDoubleClick={() => setEditing(true)} title="double-click to rename">
              {item.name} · C{item.build.cons} · {item.build.level} · {new Date(item.savedAt).toLocaleDateString()}
            </span>
          )}
        </div>
      </div>
      <BuildGear build={item.build} />
      <BuildStats build={item.build} />
      <div className="lib-actions">
        {inTeam ? (
          <button type="button" className="btn primary small" onClick={() => onUse()}>Use in team</button>
        ) : (
          <select value="" onChange={(e) => e.target.value !== '' && onUse(+e.target.value)} title="Put this build into a team slot">
            <option value="">Use in slot…</option>
            {project.team.map((b, i) => (
              <option key={i} value={i}>slot {i + 1}{b ? ` (replace ${getChar(b.key)?.name ?? b.key})` : ' (empty)'}</option>
            ))}
          </select>
        )}
        <button type="button" className="btn ghost small" onClick={() => setEditing(true)}>Rename</button>
        <span className="grow" />
        <button type="button" className="btn ghost small danger" onClick={() => confirm(`Delete "${item.name}"?`) && onDelete()}>Delete</button>
      </div>
    </div>
  );
}

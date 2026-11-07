import { useMemo, useState } from 'react';
import { ELEMENT_COLORS, getChar, setByKey, weaponByKey } from '../data';
import { charIcon, setIcon, weaponIcon } from '../data/icons';
import { gearSets } from '../lib/artifacts';
import { buildSummary } from '../lib/kqms';
import type { Library, SavedBuild } from '../lib/library';
import type { CharBuild, Project } from '../lib/types';
import { Icon } from './Combobox';
import { t } from '../i18n';

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
          {t('{n}pc', { n: s.count })}
        </span>
      ))}
      <span className="muted">{build.statsMode === 'artifacts' ? t('artifacts') : build.statsMode === 'custom' ? t('custom stats') : 'KQMS'}</span>
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
        <h2>{t('My builds')}</h2>
        <span className="muted small">{t('{n} saved. Save a team card with 💾; load it back from the card or from here.', { n: library.items.length })}</span>
        <span className="grow" />
        <input className="lib-search" placeholder={t('search…')} value={query} onChange={(e) => setQuery(e.target.value)} />
        {library.items.length > 0 && (
          <button
            type="button"
            className="btn ghost small danger"
            onClick={() => confirm(t('Delete all {n} saved builds?', { n: library.items.length })) && library.removeAll()}
          >
            {t('Delete all')}
          </button>
        )}
        <button type="button" className="icon-btn" onClick={onClose} title={t('Close')}>✕</button>
      </div>

      {library.backup.length > 0 && (
        <div className="hint warn small lib-result">
          <div>{t('This browser had a different build list ({a} builds) than the userdata folder ({b}).', { a: library.backup.length, b: library.items.length })}</div>
          <span className="row tight">
            <button type="button" className="btn primary small" onClick={() => confirm(t('Replace the current {a} builds with the {b} from the browser backup?', { a: library.items.length, b: library.backup.length })) && library.restoreBackup()}>
              {t('Restore {n} from browser backup', { n: library.backup.length })}
            </button>
            <button type="button" className="btn ghost small" onClick={library.dropBackup}>{t('Dismiss')}</button>
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
        <div className="muted small">{t('No saved builds yet.')}</div>
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
            <span className="muted small" onDoubleClick={() => setEditing(true)} title={t('double-click to rename')}>
              {item.name} · C{item.build.cons} · {item.build.level} · {new Date(item.savedAt).toLocaleDateString()}
            </span>
          )}
        </div>
      </div>
      <BuildGear build={item.build} />
      <BuildStats build={item.build} />
      <div className="lib-actions">
        {inTeam ? (
          <button type="button" className="btn primary small" onClick={() => onUse()}>{t('Use in team')}</button>
        ) : (
          <select value="" onChange={(e) => e.target.value !== '' && onUse(+e.target.value)} title={t('Put this build into a team slot')}>
            <option value="">{t('Use in slot…')}</option>
            {project.team.map((b, i) => (
              <option key={i} value={i}>{t('slot {n}', { n: i + 1 })} {b ? t('(replace {name})', { name: getChar(b.key)?.name ?? b.key }) : t('(empty)')}</option>
            ))}
          </select>
        )}
        <button type="button" className="btn ghost small" onClick={() => setEditing(true)}>{t('Rename')}</button>
        <span className="grow" />
        <button type="button" className="btn ghost small danger" onClick={() => confirm(t('Delete "{name}"?', { name: item.name })) && onDelete()}>{t('Delete')}</button>
      </div>
    </div>
  );
}

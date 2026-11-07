import { ELEMENT_COLORS, getChar } from '../data';
import { charIcon } from '../data/icons';
import { t } from '../i18n';
import type { Group } from '../lib/store';
import { Icon } from './Combobox';

interface Props {
  group: Group;
  /** last sim DPS per team id (stale = the team changed since) */
  dps: Record<string, { dps: number; stale: boolean } | undefined>;
  /** per team id: other teams that share a character with it */
  shared: Record<string, string[]>;
  onSelect: (i: number) => void;
  onAdd: () => void;
  onDuplicate: (i: number) => void;
  onRemove: (i: number) => void;
}

const fmtK = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}k` : String(Math.round(n)));

/** Summary strip: one card per team (members, last DPS, shared characters); click to edit that team below. */
export function TeamTabs({ group, dps, shared, onSelect, onAdd, onDuplicate, onRemove }: Props) {
  return (
    <div className="team-tabs" role="tablist" aria-label={t('Teams in this group')}>
      {group.teams.map((p, i) => {
        const id = p.id!;
        const d = dps[id];
        const sh = shared[id] ?? [];
        const active = i === group.active;
        return (
          <div
            key={id}
            role="tab"
            tabIndex={0}
            aria-selected={active}
            className={`team-tab ${active ? 'on' : ''}`}
            onClick={() => onSelect(i)}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onSelect(i)}
            title={sh.length ? t('Shares characters with: {teams}', { teams: sh.join(', ') }) : p.name}
          >
            <div className="tt-head">
              <span className="tt-num">{i + 1}</span>
              <span className="tt-name">{p.name || t('Team {n}', { n: i + 1 })}</span>
              {sh.length > 0 && <span className="tt-warn">⚠</span>}
              <span className="grow" />
              <button type="button" className="tt-btn" title={t('Duplicate this team')} onClick={(e) => { e.stopPropagation(); onDuplicate(i); }}>⧉</button>
              {group.teams.length > 1 && (
                <button
                  type="button"
                  className="tt-btn"
                  title={t('Remove this team from the group')}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!p.team.some(Boolean) || confirm(t('Remove "{name}" from the group?', { name: p.name || t('Team {n}', { n: i + 1 }) }))) onRemove(i);
                  }}
                >
                  ✕
                </button>
              )}
            </div>
            <div className="tt-body">
              <span className="tt-avatars">
                {p.team.map((b, k) => {
                  const c = b ? getChar(b.key) : undefined;
                  return c ? (
                    <span key={k} className="avatar-wrap sm" style={{ ['--el' as string]: ELEMENT_COLORS[c.element] }} title={c.name}>
                      <Icon src={charIcon(c.id)} rarity={c.rarity} size={26} className="avatar" />
                    </span>
                  ) : (
                    <span key={k} className="tt-empty" />
                  );
                })}
              </span>
              <span className={`tt-dps ${d?.stale ? 'stale' : ''}`} title={d ? (d.stale ? t('DPS of an earlier version of this team') : t('DPS of the last sim')) : t('Not simulated yet')}>
                {d ? fmtK(d.dps) : '—'}
                {d && <small> DPS</small>}
              </span>
            </div>
          </div>
        );
      })}
      <button type="button" className="team-tab add" onClick={onAdd} title={t('Add a team to this group')}>
        <span>+</span>
        <small>{t('Team')}</small>
      </button>
    </div>
  );
}

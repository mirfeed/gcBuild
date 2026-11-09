import { useState } from 'react';
import { ELEMENT_COLORS, getChar } from '../data';
import { charIcon } from '../data/icons';
import type { Inventory } from '../lib/artifacts';
import { artifactSignature, fetchEnka, parseEnka, type EnkaChar, type EnkaResponse } from '../lib/enka';
import type { Library } from '../lib/library';
import type { CharBuild, Project } from '../lib/types';
import { Icon } from './Combobox';
import { BuildGear, BuildStats } from './LibraryPanel';
import { t } from '../i18n';

const UID_KEY = 'gcbuild.enka.uid';

function lastUid(): string {
  try {
    return localStorage.getItem(UID_KEY) ?? '';
  } catch {
    return '';
  }
}

interface Props {
  project: Project;
  library: Library;
  inventory: Inventory;
  onUse: (b: CharBuild) => void;
  onClose: () => void;
}

/** Import characters (showcase + saved Enka builds) from Enka.Network by UID. */
export function EnkaPanel({ project, library, inventory, onUse, onClose }: Props) {
  const [uidText, setUid] = useState(lastUid);
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState<EnkaResponse | null>(null);
  const [chars, setChars] = useState<EnkaChar[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const team = project.team.filter(Boolean).map((b) => b!.key);

  const load = async () => {
    const u = uidText.trim();
    if (!/^\d{9,10}$/.test(u)) {
      setErrors([t('UID must be 9-10 digits')]);
      return;
    }
    setBusy(true);
    setErrors([]);
    setMsg(null);
    try {
      localStorage.setItem(UID_KEY, u);
    } catch {
      // storage unavailable
    }
    try {
      const d = await fetchEnka(u);
      const r = parseEnka(d);
      setData(d);
      setChars(r.chars);
      setErrors(r.errors);
      if (!r.chars.length) setMsg(t('No characters in the showcase. Put them in the in-game Character Showcase with "Show Character Details" on.'));
    } catch (e) {
      setData(null);
      setChars([]);
      setErrors([(e as Error).message]);
    } finally {
      setBusy(false);
    }
  };

  const save = (list: EnkaChar[]) => {
    for (const c of list) {
      const name = `${getChar(c.build.key)?.name ?? c.build.key} · Enka${c.label === 'Showcase' ? '' : ` · ${c.label}`}`;
      library.save(c.build, name);
    }
    setMsg(t('Saved {n} build(s) to My builds.', { n: list.length }));
  };

  // the profile's artifacts are an account of their own (by UID): never merged into a GOOD import
  const addArtifacts = () => {
    if (!data) return;
    const have = new Set<string>();
    const list = chars.flatMap((c) => c.artifacts).filter((a) => {
      const sig = artifactSignature(a);
      if (have.has(sig)) return false;
      have.add(sig);
      return true;
    });
    const name = `Enka · ${data.player.nickname ?? data.uid}`;
    const existing = inventory.accounts.find((a) => a.uid === data.uid);
    if (existing) inventory.replaceAccount(existing.id, list, { source: 'Enka' });
    else inventory.addAccount({ name, source: 'Enka', uid: data.uid }, list);
    setMsg(t('{n} artifact(s) saved as the account «{name}» (Artifacts panel). It is now the selected account.', { n: list.length, name: existing?.name || name }));
  };

  return (
    <section className="panel library">
      <div className="panel-head">
        <h2>Enka.Network</h2>
        <span className="muted small">
          {data
            ? <>{data.player.nickname ?? t('player')} · AR {data.player.level ?? '?'} · {t('{n} character(s)', { n: chars.length })}{data.cached ? ` ${t('(cached)')}` : ''}</>
            : t('Imports the in-game Character Showcase (and builds saved on a linked Enka profile).')}
        </span>
        <span className="grow" />
        <input
          className="lib-search"
          inputMode="numeric"
          placeholder="UID"
          value={uidText}
          onChange={(e) => setUid(e.target.value.replace(/\D/g, ''))}
          onKeyDown={(e) => e.key === 'Enter' && load()}
        />
        <button type="button" className="btn primary small" disabled={busy} onClick={load}>{busy ? t('Loading…') : t('Load')}</button>
        <button type="button" className="icon-btn" onClick={onClose} title={t('Close')}>✕</button>
      </div>

      {(errors.length > 0 || msg) && (
        <div className="hint small lib-result">
          {msg && <div>{msg}</div>}
          {errors.map((e) => <div key={e} className="warn">{e}</div>)}
        </div>
      )}

      {chars.length > 0 && (
        <>
          <div className="row tight" style={{ marginBottom: 8 }}>
            <button type="button" className="btn small" onClick={() => save(chars)}>{t('Save all to My builds')}</button>
            <button type="button" className="btn small" onClick={addArtifacts}>{t('Save their artifacts as an account')}</button>
          </div>
          <div className="lib-grid">
            {chars.map((c, i) => {
              const ch = getChar(c.build.key);
              const inTeam = team.includes(c.build.key);
              return (
                <div key={i} className={`card lib-card ${inTeam ? 'in-team' : ''}`} style={{ ['--el' as string]: ch ? ELEMENT_COLORS[ch.element] : 'var(--border)' }}>
                  <div className="lib-head">
                    {ch && <Icon src={charIcon(ch.id)} rarity={ch.rarity} size={36} className="avatar" />}
                    <div className="lib-title">
                      <strong>{ch?.name ?? c.build.key}</strong>
                      <span className="muted small">{c.label === 'Showcase' ? t('Showcase') : c.label} · C{c.build.cons} · {c.build.level} · {t('talents')} {c.build.talents.join('/')}</span>
                    </div>
                  </div>
                  <BuildGear build={c.build} />
                  <BuildStats build={c.build} />
                  <div className="lib-actions">
                    <button
                      type="button"
                      className="btn primary small"
                      disabled={!inTeam && !project.team.some((b) => !b)}
                      title={inTeam ? t('Replace this character in the team') : t('Put into a free team slot')}
                      onClick={() => {
                        onUse(structuredClone(c.build));
                        setMsg(t('{name} is now in the team.', { name: ch?.name ?? c.build.key }));
                      }}
                    >
                      {inTeam ? t('Replace in team') : t('Add to team')}
                    </button>
                    <button type="button" className="btn ghost small" onClick={() => save([c])}>{t('Save to My builds')}</button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}

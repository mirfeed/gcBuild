import { useEffect, useMemo, useRef, useState } from 'react';
import { ArtifactsPanel } from './components/Artifacts';
import { CharCard } from './components/CharCard';
import { ConfigPanel } from './components/ConfigPanel';
import { Menu } from './components/Menu';
import { HelpPanel, helpSeen, markHelpSeen } from './components/HelpPanel';
import { LibraryPanel } from './components/LibraryPanel';
import { EnkaPanel } from './components/EnkaPanel';
import { TeamsPanel } from './components/TeamsPanel';
import { endOf, insertAt, paletteFor, RotationBuilder, type Cursor } from './components/RotationBuilder';
import { SimPanel } from './components/SimPanel';
import { SimTimeline } from './components/SimTimeline';
import { Timeline } from './components/Timeline';
import { characters, getChar, weaponByKey } from './data';
import type { ErStats, SimResult } from './lib/api';
import { useInventory } from './lib/artifacts';
import { generateConfig } from './lib/config';
import { importConfig } from './lib/importConfig';
import { generateKqms } from './lib/kqms';
import { openReport } from './lib/report';
import { desktop } from './lib/desktop';
import { checkForUpdatesNow, UpdateBanner, useUpdateStatus } from './components/UpdateBanner';
import { BetaDialog } from './components/BetaDialog';
import { DuelBar } from './components/DuelBar';
import { DuelPanel } from './components/DuelPanel';
import { duelConfig, DUEL_ITERATIONS } from './lib/duel';
import { BetaBadge, TitleBar } from './components/TitleBar';
import { TeamTabs } from './components/TeamTabs';
import { useLibrary } from './lib/library';
import { act, emptyProject, exampleProject, uid } from './lib/project';
import { getList, locate, pruneChar, removeItem } from './lib/rotation';
import { parseSample, type SampleTimeline } from './lib/sample';
import { toGroup, useGroup, type Group } from './lib/store';
import { simulate } from './lib/timeline';
import { SLOTS, type CharBuild, type Project } from './lib/types';
import { setAdvanced, setBackgrounds, setTheme, useAdvanced, useBackgrounds, useTheme, type Theme } from './lib/ui';
import { LANGS, setLang, t, useLang } from './i18n';

interface SimState {
  result: SimResult;
  timeline: SampleTimeline;
  config: string;
}

export default function App() {
  const { group, project, update, replace, undo, redo, canUndo, canRedo, setActive, addTeam, removeTeam, moveTeam, renameGroup, replaceGroup } = useGroup();
  const [selected, setSelected] = useState<string | null>(null);
  const [cursor, setCursor] = useState<Cursor>(() => endOf(project, 'loop'));
  const [focusChar, setFocusChar] = useState(0);
  // reordering the team by dragging a card's handle onto another slot
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const [loops, setLoops] = useState(2);
  const [waitFrames, setWaitFrames] = useState(30);
  const [teamOpen, setTeamOpen] = useState(true);
  const [tlView, setTlView] = useState<'estimate' | 'sim'>('estimate');
  // sim results and ER checks per team: kept while switching between the group's teams
  const [sims, setSims] = useState<Record<string, SimState>>({});
  const [ers, setErs] = useState<Record<string, ErStats[]>>({});
  const teamId = project.id!;
  const sim = sims[teamId] ?? null;
  const er = ers[teamId] ?? null;
  const setSim = (s: SimState | null) => setSims((m) => {
    const n = { ...m };
    if (s) n[teamId] = s;
    else delete n[teamId];
    return n;
  });
  const setEr = (e: ErStats[] | null) => setErs((m) => {
    const n = { ...m };
    if (e) n[teamId] = e;
    else delete n[teamId];
    return n;
  });
  const [importOpen, setImportOpen] = useState(false);
  const [importMsg, setImportMsg] = useState<string[]>([]);
  const [libOpen, setLibOpen] = useState(false);
  const library = useLibrary();
  const [artsOpen, setArtsOpen] = useState(false);
  const [teamsOpen, setTeamsOpen] = useState(false);
  const [enkaOpen, setEnkaOpen] = useState(false);
  const [duelOpen, setDuelOpen] = useState(false);
  const inventory = useInventory();
  const fileInput = useRef<HTMLInputElement>(null);
  const advanced = useAdvanced();
  const backgrounds = useBackgrounds();
  const theme = useTheme();
  const update$ = useUpdateStatus();
  const [betaOpen, setBetaOpen] = useState(false);
  const [betaOn, setBetaOn] = useState(false);
  useEffect(() => {
    void desktop?.betaGet?.().then((b) => setBetaOn(b.enabled));
  }, []);
  const [helpOpen, setHelpOpen] = useState(() => !helpSeen());
  useEffect(() => {
    if (helpOpen) markHelpSeen();
  }, [helpOpen]);
  const lang = useLang();

  const timeline = useMemo(() => simulate(project, loops), [project, loops]);
  // a duel tab: the duel's fixed parts are enforced in the config that is tested and submitted
  const duel = project.duel;
  const config = useMemo(() => {
    try {
      return project.duel ? duelConfig(project) : generateConfig(project);
    } catch {
      return generateConfig(project);
    }
  }, [project]);
  const taken = project.team.filter(Boolean).map((b) => b!.key);

  const teamLabel = (p: Project, i: number) => p.name || t('Team {n}', { n: i + 1 });

  /** artifact id -> who wears it: "Name" in this team, "Name (Team 2)" in another team of the group */
  const usedBy = useMemo(() => {
    const m = new Map<string, string>();
    const order = group.teams.map((_, i) => i).filter((i) => i !== group.active).concat(group.active);
    for (const ti of order) {
      const p = group.teams[ti];
      for (const b of p.team) {
        if (!b || b.statsMode !== 'artifacts') continue;
        const who = getChar(b.key)?.name ?? b.key;
        for (const s of SLOTS) {
          const id = b.gear?.[s]?.id;
          if (id) m.set(id, ti === group.active ? who : `${who} (${t('team {n}', { n: ti + 1 })})`);
        }
      }
    }
    return m;
  }, [group]);

  /** characters / artifacts used by more than one team of the group (allowed, but flagged) */
  const sharing = useMemo(() => {
    const keysOf = (p: Project) => new Set(p.team.filter(Boolean).map((b) => b!.key));
    const artsOf = (p: Project) => new Set(p.team.flatMap((b) => (b?.statsMode === 'artifacts' ? SLOTS.map((s) => b.gear?.[s]?.id).filter(Boolean) as string[] : [])));
    const keys = group.teams.map(keysOf);
    const arts = group.teams.map(artsOf);
    const shared: Record<string, string[]> = {};
    group.teams.forEach((p, i) => {
      shared[p.id!] = group.teams.flatMap((q, j) => (j !== i && [...keys[i]].some((k) => keys[j].has(k)) ? [`${j + 1}. ${teamLabel(q, j)}`] : []));
    });
    // team numbers (1-based) are unambiguous even when teams share a name
    const alsoIn = new Map<string, string[]>();
    for (const k of keys[group.active]) {
      const where = group.teams.flatMap((_, j) => (j !== group.active && keys[j].has(k) ? [String(j + 1)] : []));
      if (where.length) alsoIn.set(k, where);
    }
    const sharedArts = [...arts[group.active]].filter((id) => arts.some((s, j) => j !== group.active && s.has(id))).length;
    return { shared, alsoIn, sharedArts };
  }, [group]);

  /** last sim DPS per team for the summary strip */
  const teamDps = useMemo(() => {
    const out: Record<string, { dps: number; stale: boolean } | undefined> = {};
    for (const p of group.teams) {
      const s = sims[p.id!];
      if (s) out[p.id!] = { dps: s.result.statistics.dps.mean, stale: s.config !== generateConfig(p) };
    }
    return out;
  }, [group, sims]);

  // switching teams: fresh cursor / selection, show that team's sim sample if it has one
  useEffect(() => {
    setSelected(null);
    setCursor(endOf(project, 'loop'));
    setFocusChar(0);
    setTlView(sims[teamId] ? 'sim' : 'estimate');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId]);

  // keep the cursor valid after edits / undo
  useEffect(() => {
    if (!getList(project.rotation, cursor.listId) || (cursor.afterId && !locate(project.rotation, cursor.afterId))) {
      setCursor(endOf(project, 'loop'));
    }
    if (selected && !locate(project.rotation, selected)) setSelected(null);
  }, [project, cursor, selected]);

  /** status keys for condition suggestions: extracted skill/burst statuses + whatever the last sim saw */
  const statusHints = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const b of project.team) {
      if (!b) continue;
      const c = getChar(b.key);
      out[b.key] = [...new Set([...(c?.statuses.map((s) => s.name) ?? []), ...(sim?.timeline.statusKeys[b.key] ?? [])])].sort();
    }
    out[''] = sim?.timeline.statusKeys[''] ?? [];
    return out;
  }, [project.team, sim]);

  const kqmsSlot = (p: Project, i: number) => {
    const b = p.team[i];
    if (!b || b.statsMode === 'custom') return;
    const c = getChar(b.key);
    if (c) p.team[i] = { ...generateKqms(b, c, weaponByKey.get(b.weapon.key)), subsFrom: 'heuristic' };
  };

  const setMember = (i: number, b: CharBuild | null) => {
    update((p) => {
      const prev = p.team[i];
      p.team[i] = b;
      // character swapped in a slot: drop that character's actions
      if (prev && prev.key !== b?.key) {
        p.rotation.opener = pruneChar(p.rotation.opener, prev.key);
        p.rotation.loop = pruneChar(p.rotation.loop, prev.key);
        if (p.active === prev.key) p.active = b?.key ?? '';
      }
      if (!p.active && b) p.active = b.key;
    });
  };

  /** Move the character in slot `from` to slot `to`; the others shift (the rotation follows characters, not slots). */
  const moveMember = (from: number, to: number) => {
    if (from === to) return;
    update((p) => {
      const [m] = p.team.splice(from, 1);
      p.team.splice(to, 0, m);
    });
    setFocusChar(to);
  };

  /** Put a library build into the team: the same character's slot, the given slot, or the first free one. */
  const applyBuild = (b: CharBuild, slot?: number) => {
    const same = project.team.findIndex((x) => x?.key === b.key);
    if (duel) {
      // duel: the squad is fixed, only a build's artifacts are taken (for the same character)
      const cur = project.team[same];
      if (!cur || b.statsMode !== 'artifacts') {
        setImportMsg([t('In a duel only the artifacts of the same character can be used.')]);
        return;
      }
      setMember(same, { ...cur, statsMode: 'artifacts', gear: structuredClone(b.gear ?? {}) });
      return;
    }
    let i = same >= 0 ? same : slot ?? project.team.findIndex((x) => !x);
    if (i < 0) i = 3;
    setMember(i, { ...b, uid: uid() });
  };

  const saveBuild = (b: CharBuild) => {
    const c = getChar(b.key);
    const w = weaponByKey.get(b.weapon.key);
    const name = prompt(t('Name for this build'), `${c?.name ?? b.key} · ${w?.name ?? b.weapon.key}`);
    if (name === null) return;
    library.save(b, name.trim() || `${c?.name ?? b.key}`);
    setImportMsg([t('Saved "{name}" to My builds.', { name: name.trim() || c?.name || '' })]);
  };

  const loadProject = (p: Project) => {
    replace(p);
    setSelected(null);
    setCursor(endOf(p, 'loop'));
    setSim(null);
    setEr(null);
    setTlView('estimate');
  };

  const doImport = (text: string) => {
    try {
      const { project: p, warnings } = importConfig(text);
      if (!p.team.some(Boolean)) throw new Error(t('no characters found'));
      loadProject(p);
      setImportMsg(warnings.length ? warnings : [t('Imported.')]);
      setImportOpen(false);
    } catch (err) {
      setImportMsg([t('Could not import: {error}', { error: (err as Error).message })]);
    }
  };

  // keyboard shortcuts for click-free rotation building
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(t.tagName) || t.isContentEditable) return;
      // letters and digits by physical key, so shortcuts work on any layout (on Russian, E types "у")
      const k = /^Key[A-Z]$/.test(e.code) ? e.code.slice(3).toLowerCase() : e.key.toLowerCase();
      const digit = /^(?:Digit|Numpad)([1-4])$/.exec(e.code)?.[1] ?? (/^[1-4]$/.test(e.key) ? e.key : null);
      if ((e.ctrlKey || e.metaKey) && k === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && k === 'y') {
        e.preventDefault();
        redo();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      if (digit) {
        if (project.team[+digit - 1]) setFocusChar(+digit - 1);
        return;
      }
      const list = getList(project.rotation, cursor.listId) ?? [];
      const curIdx = cursor.afterId ? list.findIndex((a) => a.id === cursor.afterId) : -1;
      if (k === 'escape') return setSelected(null);
      if (k === 'delete' || k === 'backspace') {
        const target = selected ? locate(project.rotation, selected)?.item : list[curIdx];
        if (!target) return;
        e.preventDefault();
        const loc = locate(project.rotation, target.id)!;
        update((p) => { removeItem(p.rotation, target.id); });
        setSelected(null);
        setCursor({ listId: loc.listId, afterId: loc.list[loc.index - 1]?.id ?? null });
        return;
      }
      if (k === 'arrowleft' || k === 'arrowright') {
        e.preventDefault();
        const ni = Math.max(-1, Math.min(list.length - 1, curIdx + (k === 'arrowleft' ? -1 : 1)));
        setCursor({ listId: cursor.listId, afterId: ni >= 0 ? list[ni].id : null });
        setSelected(ni >= 0 ? list[ni].id : null);
        return;
      }
      if (k === 'w') {
        insertAt(update, cursor, act('', 'wait', { frames: waitFrames }), setSelected, setCursor);
        return;
      }
      const b = project.team[focusChar];
      const c = b ? getChar(b.key) : undefined;
      if (!b || !c) return;
      const btns = paletteFor(c);
      let btn;
      switch (k) {
        case 'e':
          btn = e.shiftKey ? btns.find((x) => x.action === 'skill' && x.params) : btns.find((x) => x.action === 'skill' && !x.params);
          break;
        case 'q': btn = btns.find((x) => x.action === 'burst'); break;
        case 'a':
        case 'n': btn = btns.find((x) => x.action === 'attack' && x.repeat === 1); break;
        case 'c': btn = btns.find((x) => x.action === 'charge' || x.action === 'aim'); break;
        case 'p': btn = btns.find((x) => x.action === 'high_plunge'); break;
        case 'd': btn = btns.find((x) => x.action === 'dash'); break;
        case 'j': btn = btns.find((x) => x.action === 'jump'); break;
      }
      if (!btn) return;
      e.preventDefault();
      insertAt(update, cursor, act(b.key, btn.action, { params: btn.params ?? {}, repeat: btn.repeat ?? 1 }), setSelected, setCursor);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [project, cursor, selected, focusChar, waitFrames, update, undo, redo]);

  const multi = group.teams.length > 1;
  const exportJson = () => {
    // one team: the project as before; several: the whole group
    const data: Project | Group = multi ? { ...group, format: 'gcbuild-group' } : project;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${((multi ? group.name : project.name) || 'team').replace(/[^\w-]+/g, '_')}.gcbuild.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const openFile = async (file: File) => {
    const text = await file.text();
    if (/\.json$/i.test(file.name)) {
      try {
        const g = toGroup(JSON.parse(text));
        if (!g) throw new Error(t('not a gcBuild project'));
        // a group file replaces the group; a single team replaces the open team
        if (g.teams.length > 1) replaceGroup(g);
        else loadProject(g.teams[0]);
        setImportMsg([]);
      } catch (err) {
        setImportMsg([t('Could not open: {error}', { error: (err as Error).message })]);
      }
    } else {
      doImport(text);
    }
  };

  return (
    <div className={`app ${advanced ? 'advanced' : 'simple'} ${backgrounds ? 'fancy' : 'plain'} ${desktop ? 'desktop' : ''}`}>
      {desktop && (
        <TitleBar
          title={multi ? `${group.name} · ${project.name}` : project.name}
          onUndo={undo}
          onRedo={redo}
          canUndo={canUndo}
          canRedo={canRedo}
          helpOpen={helpOpen}
          onHelp={() => setHelpOpen((v) => !v)}
          onBeta={() => setBetaOpen(true)}
        />
      )}
      <header className="app-head">
        <div className="brand">
          <span className="logo">⚔</span>
          <h1>gcBuild</h1>
          {!desktop && <BetaBadge />}
        </div>
        <input className="project-name" value={project.name} onChange={(e) => update((p) => { p.name = e.target.value; })} aria-label={t('Project name')} />
        <div className="head-actions">
          {!desktop && (
            <>
              <button type="button" className="icon-btn" onClick={undo} disabled={!canUndo} title={t('Undo (Ctrl+Z)')}>↶</button>
              <button type="button" className="icon-btn" onClick={redo} disabled={!canRedo} title={t('Redo (Ctrl+Y)')}>↷</button>
              <span className="head-sep" />
            </>
          )}
          <button type="button" className={`btn ghost ${teamsOpen ? 'on' : ''}`} onClick={() => setTeamsOpen((v) => !v)} title={t("Save / load teams in the project's teams/ folder")}>
            {t('Teams')}
          </button>
          <button type="button" className={`btn ghost ${artsOpen ? 'on' : ''}`} onClick={() => setArtsOpen((v) => !v)}>
            {t('Artifacts')}{inventory.items.length ? <span className="count">{inventory.items.length}</span> : null}
          </button>
          <button type="button" className={`btn ghost ${libOpen ? 'on' : ''}`} onClick={() => setLibOpen((v) => !v)}>
            {t('My builds')}{library.items.length ? <span className="count">{library.items.length}</span> : null}
          </button>
          <button type="button" className={`btn ghost ${enkaOpen ? 'on' : ''}`} onClick={() => setEnkaOpen((v) => !v)} title={t('Import characters from Enka.Network by UID')}>
            Enka
          </button>
          <button type="button" className={`btn ghost ${duelOpen ? 'on' : ''}`} onClick={() => setDuelOpen((v) => !v)} title={t('Duels: same squad, your artifacts and rotation against another player')}>
            ⚔ {t('Duels')}
          </button>
          <Menu
            label="⋯"
            title={t('More')}
            items={[
              { label: t('Add a team'), onClick: () => addTeam({ ...emptyProject(), name: t('Team {n}', { n: group.teams.length + 1 }) }) },
              { label: t('Example team'), onClick: () => loadProject(exampleProject()), title: t('Replaces the open team (Ctrl+Z undoes it)') },
              {
                label: t('New group'),
                onClick: () => {
                  if (!confirm(t('Start over with one empty team? Save the current group in Teams first if you want to keep it.'))) return;
                  const p = { ...emptyProject(), id: uid(), name: t('Team {n}', { n: 1 }) };
                  replaceGroup({ format: 'gcbuild-group', name: t('New group'), teams: [p], active: 0 });
                  setSims({});
                  setErs({});
                },
              },
              { label: t('Import gcsim config'), onClick: () => { setImportOpen(true); setImportMsg([]); } },
              { label: t('Open file…'), onClick: () => fileInput.current?.click(), title: t('Open a .gcbuild.json project or a gcsim config .txt') },
              { label: t('Export project'), onClick: exportJson },
              { label: backgrounds ? t('Backgrounds: on') : t('Backgrounds: off'), onClick: () => setBackgrounds(!backgrounds) },
              ...(desktop
                ? [
                  { label: t('Import from old folder…'), onClick: () => void desktop!.importOld(), title: t('Copy artifacts, My builds, teams and gcsim from a gcBuild folder used with start.bat') },
                  { label: t('Open data folder'), onClick: () => void desktop!.openDataFolder() },
                  { label: t('Check for updates'), onClick: checkForUpdatesNow, disabled: update$.state === 'dev' || update$.state === 'downloading' || update$.state === 'ready' },
                  { label: betaOn ? t('Beta versions: on') : t('Beta versions…'), onClick: () => setBetaOpen(true), title: t('Closed beta for Beta testers in the gcBuild Discord') },
                ]
                : []),
              { label: t('Report a bug'), onClick: () => openReport('Bug: ', { config }), title: t('Report a problem on GitHub: opens a new issue with versions and the current config filled in') },
            ]}
          />
          {!desktop && (
            <button type="button" className={`btn ghost help-btn ${helpOpen ? 'on' : ''}`} onClick={() => setHelpOpen((v) => !v)} title={t('How to use')}>?</button>
          )}
          <span className="head-sep" />
          <span className="seg theme-switch" role="group" aria-label={t('Theme')}>
            {([['system', '◐', t('Theme: like the system')], ['dark', '☾', t('Theme: dark')], ['light', '☀', t('Theme: light')]] as [Theme, string, string][]).map(([id, icon, label]) => (
              <button key={id} type="button" className={theme === id ? 'on' : ''} onClick={() => setTheme(id)} title={label} aria-label={label}>{icon}</button>
            ))}
          </span>
          <span className="seg lang-switch" title={t('Language')}>
            {LANGS.map((l) => (
              <button key={l.id} type="button" className={lang === l.id ? 'on' : ''} onClick={() => setLang(l.id)}>{l.label}</button>
            ))}
          </span>
          <label className="switch" title={t('Show every setting: KQMS details, substat rolls, conditions help, raw config…')}>
            <input type="checkbox" checked={advanced} onChange={(e) => setAdvanced(e.target.checked)} />
            <span>{t('Advanced')}</span>
          </label>
          <input
            ref={fileInput}
            type="file"
            accept=".json,.txt,application/json,text/plain"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) openFile(f);
              e.target.value = '';
            }}
          />
        </div>
      </header>

      <UpdateBanner status={update$} onBeta={() => setBetaOpen(true)} />
      {betaOpen && <BetaDialog onClose={() => setBetaOpen(false)} onChange={setBetaOn} />}
      {helpOpen && <HelpPanel onClose={() => setHelpOpen(false)} />}
      {importOpen && <ImportBox onImport={doImport} onClose={() => setImportOpen(false)} />}
      {teamsOpen && (
        <TeamsPanel
          group={group}
          onLoadGroup={(g) => { replaceGroup(g); setSims({}); setErs({}); }}
          onAddTeams={(teams) => teams.forEach((p) => addTeam(p))}
          onRenameGroup={renameGroup}
          onClose={() => setTeamsOpen(false)}
        />
      )}
      {duelOpen && (
        <DuelPanel
          project={project}
          onJoined={(p) => {
            const i = group.teams.findIndex((x) => x.duel?.id === p.duel?.id);
            if (i >= 0) setActive(i);
            else addTeam(p);
          }}
          onClose={() => setDuelOpen(false)}
        />
      )}
      {enkaOpen && <EnkaPanel project={project} library={library} inventory={inventory} onUse={applyBuild} onClose={() => setEnkaOpen(false)} />}
      {artsOpen && <ArtifactsPanel inventory={inventory} usedBy={usedBy} onClose={() => setArtsOpen(false)} />}
      {libOpen && <LibraryPanel library={library} project={project} onUse={applyBuild} onClose={() => setLibOpen(false)} />}
      {importMsg.length > 0 && (
        <div className="hint small import-msg">
          {importMsg.map((m) => <div key={m}>{m}</div>)}
          <button type="button" className="btn ghost small" onClick={() => setImportMsg([])}>ok</button>
        </div>
      )}

      <TeamTabs
        group={group}
        dps={teamDps}
        shared={sharing.shared}
        onSelect={setActive}
        onAdd={() => addTeam({ ...emptyProject(), name: t('Team {n}', { n: group.teams.length + 1 }) })}
        onDuplicate={(i) => {
          setActive(i);
          const src = group.teams[i];
          addTeam({ ...src, name: `${src.name || t('Team {n}', { n: i + 1 })} (2)` });
        }}
        onMove={moveTeam}
        onRemove={(i) => {
          const id = group.teams[i].id!;
          removeTeam(i);
          setSims((m) => { const n = { ...m }; delete n[id]; return n; });
          setErs((m) => { const n = { ...m }; delete n[id]; return n; });
        }}
      />
      {(sharing.alsoIn.size > 0 || sharing.sharedArts > 0) && (
        <div className="hint warn small share-warn">
          ⚠ {sharing.alsoIn.size > 0 && t('Shared with team {teams}: {names}', {
            teams: [...new Set([...sharing.alsoIn.values()].flat())].sort((a, b) => +a - +b).join(', '),
            names: [...sharing.alsoIn.keys()].map((k) => getChar(k)?.name ?? k).join(', '),
          })}
          {sharing.sharedArts > 0 && `${sharing.alsoIn.size ? ' · ' : ''}${t('{n} artifact(s) are also worn in another team', { n: sharing.sharedArts })}`}
        </div>
      )}

      {duel && <DuelBar key={duel.id} project={project} config={config} />}

      <section className="panel">
        <div className="panel-head">
          <button type="button" className="collapse" onClick={() => setTeamOpen((v) => !v)} aria-expanded={teamOpen}>
            <span className="caret">{teamOpen ? '▾' : '▸'}</span> <h2>{t('Team')}</h2>
          </button>
          {duel ? (
            <span className="muted small">{t('Duel: the squad is fixed, pick your artifacts.')}</span>
          ) : (
            <span className="muted small adv">{t('Level 90/90, talents 9/9/9, 5★ C0 / 4★ C6, 5★ weapons R1 / 4★ R5 by default')}</span>
          )}
          <span className="grow" />
          {!duel && (
            <button
              type="button"
              className="btn primary"
              disabled={!project.team.some((b) => b && b.statsMode !== 'custom')}
              onClick={() => update((p) => p.team.forEach((_, i) => kqmsSlot(p, i)))}
              title={t('Allocate KQMS substats for every KQMS character')}
            >
              {t('Generate KQMS for team')}
            </button>
          )}
        </div>
        {teamOpen && (
          <div className="team-grid">
            {project.team.map((b, i) => (
              <div
                key={b?.uid ?? `empty-${i}`}
                className={`slot-wrap ${dragFrom === i ? 'dragging' : ''} ${dragFrom !== null && dropAt === i && dragFrom !== i ? 'drop-target' : ''}`}
                onDragOver={(e) => {
                  if (dragFrom === null || !e.dataTransfer.types.includes('application/x-gcbuild-member')) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  if (dropAt !== i) setDropAt(i);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragFrom !== null) moveMember(dragFrom, i);
                  setDragFrom(null);
                  setDropAt(null);
                }}
              >
              <CharCard
                slot={i}
                build={b}
                taken={taken}
                isActive={!!b && project.active === b.key}
                onChange={(nb) => setMember(i, nb)}
                onSetActive={() => b && update((p) => { p.active = b.key; })}
                onKqms={() => update((p) => kqmsSlot(p, i))}
                saved={b ? library.items.filter((x) => x.build.key === b.key) : []}
                onSave={() => b && saveBuild(b)}
                inventory={inventory.items}
                usedBy={usedBy}
                alsoIn={b ? sharing.alsoIn.get(b.key) : undefined}
                locked={!!duel}
                drag={b && !duel ? {
                  onDragStart: (e) => {
                    setDragFrom(i);
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('application/x-gcbuild-member', String(i));
                    const card = e.currentTarget.closest('.char-card');
                    if (card) e.dataTransfer.setDragImage(card, 40, 30);
                  },
                  onDragEnd: () => {
                    setDragFrom(null);
                    setDropAt(null);
                  },
                } : undefined}
              />
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>{t('Rotation')}</h2>
          <span className="muted small adv">
            {t('Click actions to add them at the cursor (▏). Keys:')} <kbd>1</kbd>-<kbd>4</kbd> {t('pick a character')}, <kbd>E</kbd> {t('skill')}, <kbd>⇧E</kbd> {t('hold')}, <kbd>Q</kbd> {t('burst')},
            {' '}<kbd>A</kbd> {t('attack')}, <kbd>C</kbd> {t('charge/aim')}, <kbd>D</kbd> {t('dash')}, <kbd>J</kbd> {t('jump')}, <kbd>W</kbd> {t('wait')}, <kbd>⌫</kbd> {t('delete')}, <kbd>←</kbd><kbd>→</kbd> {t('move cursor')}, <kbd>Ctrl+Z</kbd> {t('undo')}
          </span>
          <span className="muted small simple-only">{t('Click the skill buttons or type the rotation as text.')}</span>
        </div>
        <RotationBuilder
          project={project}
          update={update}
          timeline={timeline}
          selected={selected}
          setSelected={setSelected}
          cursor={cursor}
          setCursor={setCursor}
          focusChar={focusChar}
          setFocusChar={setFocusChar}
          waitFrames={waitFrames}
          setWaitFrames={setWaitFrames}
          statusHints={statusHints}
        />
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>{t('Simulate')}</h2>
          <span className="muted small adv">{t('Runs the config with the local gcsim CLI.')} <kbd>Ctrl+Enter</kbd> {t('runs the sim.')}</span>
        </div>
        {duel?.mode === 'blind' ? (
          <div className="muted small">{t('Blind duel: test sims are off. The final sim runs when you submit (duel strip above).')}</div>
        ) : (
          <SimPanel
            project={project}
            update={update}
            config={config}
            result={sim?.result ?? null}
            resultConfig={sim?.config ?? null}
            onResult={(r, cfg) => {
              setSim({ result: r.result, timeline: parseSample(r.sample), config: cfg });
              setTlView('sim');
            }}
            er={er}
            setEr={setEr}
            duel={!!duel}
          />
        )}
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>{t('Timeline')}</h2>
          <span className="seg">
            <button type="button" className={tlView === 'estimate' ? 'on' : ''} onClick={() => setTlView('estimate')}>{t('Estimate')}</button>
            <button type="button" className={tlView === 'sim' ? 'on' : ''} onClick={() => setTlView('sim')} disabled={!sim}>
              {t('gcsim sample')}{sim && sim.config !== config ? ` (${t('outdated')})` : ''}
            </button>
          </span>
          <span className="muted small adv">
            {tlView === 'estimate'
              ? t('Planned from gcsim frame data and cooldowns while you build. No hitlag, energy or HP: run the sim for the real thing.')
              : t('One real gcsim iteration: exact action timing with hitlag, statuses, energy, HP, damage and reactions.')}
          </span>
        </div>
        {tlView === 'sim' && sim ? (
          <SimTimeline tl={sim.timeline} />
        ) : (
          <Timeline
            project={project}
            timeline={timeline}
            selected={selected}
            onSelect={(id) => {
              const loc = locate(project.rotation, id);
              setSelected(id);
              if (loc) setCursor({ listId: loc.listId, afterId: id });
            }}
            loops={loops}
            setLoops={setLoops}
          />
        )}
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>{t('Sim settings')}</h2>
          <span className="muted small simple-only">{t('Target, energy and duration. Turn on Advanced for every option and the raw gcsim config.')}</span>
        </div>
        {duel ? (
          <div className="muted small">{t('Duel: the conditions are fixed ({s}s fight, DPS dummy lvl 100 with 10% RES, {n} iterations).', { s: duel.duration, n: DUEL_ITERATIONS })}</div>
        ) : (
          <ConfigPanel project={project} update={update} />
        )}
      </section>

      <footer className="muted small foot adv">
        {t('{n} characters. Data, frames and icons come from gcsim. Effect durations in the estimate are hand-curated approximations.', { n: characters.length })}
      </footer>
    </div>
  );
}

function ImportBox({ onImport, onClose }: { onImport: (text: string) => void; onClose: () => void }) {
  const [text, setText] = useState('');
  return (
    <section
      className="panel import-box"
      onDragOver={(e) => e.preventDefault()}
      onDrop={async (e) => {
        e.preventDefault();
        const f = e.dataTransfer.files[0];
        if (f) setText(await f.text());
      }}
    >
      <div className="panel-head">
        <h2>{t('Import gcsim config')}</h2>
        <span className="muted small">
          {t('Paste a config (or drop a .txt). Characters keep their exact stats; rotation lines, if/else and counted for-loops become editable blocks, anything else is kept as script.')}
        </span>
        <span className="grow" />
        <button type="button" className="icon-btn" onClick={onClose} title={t('Close')}>✕</button>
      </div>
      <textarea className="import-text" spellCheck={false} value={text} onChange={(e) => setText(e.target.value)} placeholder={'hutao char lvl=90/90 cons=0 talent=9,9,9;\nhutao add weapon="staffofhoma" refine=1 lvl=90/90;\n…'} />
      <div className="row">
        <button type="button" className="btn primary" disabled={!text.trim()} onClick={() => onImport(text)}>{t('Import (replaces the current project)')}</button>
      </div>
    </section>
  );
}

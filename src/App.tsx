import { useEffect, useMemo, useRef, useState } from 'react';
import { ArtifactsPanel } from './components/Artifacts';
import { CharCard } from './components/CharCard';
import { ConfigPanel } from './components/ConfigPanel';
import { LibraryPanel } from './components/LibraryPanel';
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
import { useLibrary } from './lib/library';
import { act, emptyProject, exampleProject, uid } from './lib/project';
import { getList, locate, pruneChar, removeItem } from './lib/rotation';
import { parseSample, type SampleTimeline } from './lib/sample';
import { useProject } from './lib/store';
import { simulate } from './lib/timeline';
import { SLOTS, type CharBuild, type Project } from './lib/types';

interface SimState {
  result: SimResult;
  timeline: SampleTimeline;
  config: string;
}

export default function App() {
  const { project, update, replace, undo, redo, canUndo, canRedo } = useProject();
  const [selected, setSelected] = useState<string | null>(null);
  const [cursor, setCursor] = useState<Cursor>(() => endOf(project, 'loop'));
  const [focusChar, setFocusChar] = useState(0);
  const [loops, setLoops] = useState(2);
  const [waitFrames, setWaitFrames] = useState(30);
  const [teamOpen, setTeamOpen] = useState(true);
  const [tlView, setTlView] = useState<'estimate' | 'sim'>('estimate');
  const [sim, setSim] = useState<SimState | null>(null);
  const [er, setEr] = useState<ErStats[] | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importMsg, setImportMsg] = useState<string[]>([]);
  const [libOpen, setLibOpen] = useState(false);
  const library = useLibrary();
  const [artsOpen, setArtsOpen] = useState(false);
  const [teamsOpen, setTeamsOpen] = useState(false);
  const inventory = useInventory();
  const fileInput = useRef<HTMLInputElement>(null);

  const timeline = useMemo(() => simulate(project, loops), [project, loops]);
  const config = useMemo(() => generateConfig(project), [project]);
  const taken = project.team.filter(Boolean).map((b) => b!.key);

  /** artifact id -> name of the team character wearing it (artifacts mode builds) */
  const usedBy = useMemo(() => {
    const m = new Map<string, string>();
    for (const b of project.team) {
      if (!b || b.statsMode !== 'artifacts') continue;
      for (const s of SLOTS) {
        const id = b.gear?.[s]?.id;
        if (id) m.set(id, getChar(b.key)?.name ?? b.key);
      }
    }
    return m;
  }, [project.team]);

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

  /** Put a library build into the team: the same character's slot, the given slot, or the first free one. */
  const applyBuild = (b: CharBuild, slot?: number) => {
    const same = project.team.findIndex((x) => x?.key === b.key);
    let i = same >= 0 ? same : slot ?? project.team.findIndex((x) => !x);
    if (i < 0) i = 3;
    setMember(i, { ...b, uid: uid() });
  };

  const saveBuild = (b: CharBuild) => {
    const c = getChar(b.key);
    const w = weaponByKey.get(b.weapon.key);
    const name = prompt('Name for this build', `${c?.name ?? b.key} · ${w?.name ?? b.weapon.key}`);
    if (name === null) return;
    library.save(b, name.trim() || `${c?.name ?? b.key}`);
    setImportMsg([`Saved "${name.trim() || c?.name}" to My builds.`]);
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
      if (!p.team.some(Boolean)) throw new Error('no characters found');
      loadProject(p);
      setImportMsg(warnings.length ? warnings : ['Imported.']);
      setImportOpen(false);
    } catch (err) {
      setImportMsg([`Could not import: ${(err as Error).message}`]);
    }
  };

  // keyboard shortcuts for click-free rotation building
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(t.tagName) || t.isContentEditable) return;
      const k = e.key.toLowerCase();
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

      if (/^[1-4]$/.test(e.key)) {
        if (project.team[+e.key - 1]) setFocusChar(+e.key - 1);
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

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${(project.name || 'team').replace(/[^\w-]+/g, '_')}.gcbuild.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const openFile = async (file: File) => {
    const text = await file.text();
    if (/\.json$/i.test(file.name)) {
      try {
        const p = JSON.parse(text) as Project;
        if (!Array.isArray(p.team) || !p.rotation) throw new Error('not a gcBuild project');
        loadProject(p);
        setImportMsg([]);
      } catch (err) {
        setImportMsg([`Could not open: ${(err as Error).message}`]);
      }
    } else {
      doImport(text);
    }
  };

  return (
    <div className="app">
      <header className="app-head">
        <div className="brand">
          <span className="logo">⚔</span>
          <div>
            <h1>gcsim Config Builder</h1>
            <span className="muted small">KQMS builds, click-to-build rotations, local gcsim</span>
          </div>
        </div>
        <input className="project-name" value={project.name} onChange={(e) => update((p) => { p.name = e.target.value; })} aria-label="Project name" />
        <div className="head-actions">
          <button type="button" className="btn ghost" onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)">↶</button>
          <button type="button" className="btn ghost" onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Y)">↷</button>
          <button type="button" className="btn ghost" onClick={() => loadProject(emptyProject())}>New</button>
          <button type="button" className="btn ghost" onClick={() => loadProject(exampleProject())}>Example</button>
          <button type="button" className={`btn ${teamsOpen ? 'primary' : 'ghost'}`} onClick={() => setTeamsOpen((v) => !v)} title="Save / load teams in the project's teams/ folder">
            Teams
          </button>
          <button type="button" className={`btn ${artsOpen ? 'primary' : 'ghost'}`} onClick={() => setArtsOpen((v) => !v)}>
            Artifacts{inventory.items.length ? ` (${inventory.items.length})` : ''}
          </button>
          <button type="button" className={`btn ${libOpen ? 'primary' : 'ghost'}`} onClick={() => setLibOpen((v) => !v)}>
            My builds{library.items.length ? ` (${library.items.length})` : ''}
          </button>
          <button type="button" className="btn ghost" onClick={() => { setImportOpen((v) => !v); setImportMsg([]); }}>Import config</button>
          <button type="button" className="btn ghost" onClick={exportJson}>Export</button>
          <button type="button" className="btn ghost" onClick={() => fileInput.current?.click()} title="Open a .gcbuild.json project or a gcsim config .txt">Open</button>
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

      {importOpen && <ImportBox onImport={doImport} onClose={() => setImportOpen(false)} />}
      {teamsOpen && <TeamsPanel project={project} onLoad={loadProject} onClose={() => setTeamsOpen(false)} />}
      {artsOpen && <ArtifactsPanel inventory={inventory} usedBy={usedBy} onClose={() => setArtsOpen(false)} />}
      {libOpen && <LibraryPanel library={library} project={project} onUse={applyBuild} onClose={() => setLibOpen(false)} />}
      {importMsg.length > 0 && (
        <div className="hint small import-msg">
          {importMsg.map((m) => <div key={m}>{m}</div>)}
          <button type="button" className="btn ghost small" onClick={() => setImportMsg([])}>ok</button>
        </div>
      )}

      <section className="panel">
        <div className="panel-head">
          <button type="button" className="collapse" onClick={() => setTeamOpen((v) => !v)} aria-expanded={teamOpen}>
            {teamOpen ? '▾' : '▸'} <h2>Team</h2>
          </button>
          <span className="muted small">Level 90/90, talents 9/9/9, 5★ C0 / 4★ C6, 5★ weapons R1 / 4★ R5 by default</span>
          <span className="grow" />
          <button
            type="button"
            className="btn primary"
            disabled={!project.team.some((b) => b && b.statsMode !== 'custom')}
            onClick={() => update((p) => p.team.forEach((_, i) => kqmsSlot(p, i)))}
            title="Allocate KQMS substats for every KQMS character"
          >
            Generate KQMS for team
          </button>
        </div>
        {teamOpen && (
          <div className="team-grid">
            {project.team.map((b, i) => (
              <CharCard
                key={b?.uid ?? `empty-${i}`}
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
              />
            ))}
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Rotation</h2>
          <span className="muted small">
            Click actions to add them at the cursor (▏). Keys: <kbd>1</kbd>-<kbd>4</kbd> pick a character, <kbd>E</kbd> skill, <kbd>⇧E</kbd> hold, <kbd>Q</kbd> burst,
            {' '}<kbd>A</kbd> attack, <kbd>C</kbd> charge/aim, <kbd>D</kbd> dash, <kbd>J</kbd> jump, <kbd>W</kbd> wait, <kbd>⌫</kbd> delete, <kbd>←</kbd><kbd>→</kbd> move cursor, <kbd>Ctrl+Z</kbd> undo
          </span>
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
          <h2>Simulate</h2>
          <span className="muted small">Runs the config with the local gcsim CLI. <kbd>Ctrl+Enter</kbd> runs the sim.</span>
        </div>
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
        />
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Timeline</h2>
          <span className="seg">
            <button type="button" className={tlView === 'estimate' ? 'on' : ''} onClick={() => setTlView('estimate')}>Estimate</button>
            <button type="button" className={tlView === 'sim' ? 'on' : ''} onClick={() => setTlView('sim')} disabled={!sim}>
              gcsim sample{sim && sim.config !== config ? ' (outdated)' : ''}
            </button>
          </span>
          <span className="muted small">
            {tlView === 'estimate'
              ? 'Planned from gcsim frame data and cooldowns while you build. No hitlag, energy or HP: run the sim for the real thing.'
              : 'One real gcsim iteration: exact action timing with hitlag, statuses, energy, HP, damage and reactions.'}
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
          <h2>gcsim config</h2>
        </div>
        <ConfigPanel project={project} update={update} />
      </section>

      <footer className="muted small foot">
        {characters.length} characters. Data, frames and icons come from gcsim. Effect durations in the estimate are hand-curated approximations.
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
        <h2>Import gcsim config</h2>
        <span className="muted small">
          Paste a config (or drop a .txt). Characters keep their exact stats; rotation lines, if/else and counted for-loops become editable blocks, anything else is kept as script.
        </span>
        <span className="grow" />
        <button type="button" className="icon-btn" onClick={onClose} title="Close">✕</button>
      </div>
      <textarea className="import-text" spellCheck={false} value={text} onChange={(e) => setText(e.target.value)} placeholder={'hutao char lvl=90/90 cons=0 talent=9,9,9;\nhutao add weapon="staffofhoma" refine=1 lvl=90/90;\n…'} />
      <div className="row">
        <button type="button" className="btn primary" disabled={!text.trim()} onClick={() => onImport(text)}>Import (replaces the current project)</button>
      </div>
    </section>
  );
}

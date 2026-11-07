import { useMemo, useState, type DragEvent, type ReactNode } from 'react';
import { ELEMENT_COLORS, getChar } from '../data';
import { CHAR_META } from '../data/curated';
import { charIcon } from '../data/icons';
import { attackHitCount, framesUntil, frameSlice } from '../lib/frames';
import { act, uid } from '../lib/project';
import {
  childLists, cloneWithIds, condToScript, getList, isAction, lastChar, listInside, locate, notation, readyCond, removeItem, soleChar, type ListId,
} from '../lib/rotation';
import type { Updater } from '../lib/store';
import { actionLabel, cooldowns, readinessAt, type TimelineResult } from '../lib/timeline';
import type { ActionType, CharBuild, CharData, Condition, Project, RotationAction, RotItem, Section } from '../lib/types';
import { Icon } from './Combobox';
import { ConditionEditor, newClause } from './ConditionEditor';
import { NotationBox } from './NotationBox';
import { t } from '../i18n';

export interface Cursor {
  listId: ListId;
  afterId: string | null;
}

interface Props {
  project: Project;
  update: (fn: Updater) => void;
  timeline: TimelineResult;
  selected: string | null;
  setSelected: (id: string | null) => void;
  cursor: Cursor;
  setCursor: (c: Cursor) => void;
  focusChar: number;
  setFocusChar: (i: number) => void;
  waitFrames: number;
  setWaitFrames: (n: number) => void;
  statusHints: Record<string, string[]>;
}

export interface PaletteButton {
  label: string;
  action: ActionType;
  params?: Record<string, number>;
  repeat?: number;
  hotkey?: string;
  title?: string;
}

/** Buttons a character offers in the palette. */
export function paletteFor(char: CharData): PaletteButton[] {
  const btns: PaletteButton[] = [];
  const meta = CHAR_META[char.key];
  btns.push({ label: 'E', action: 'skill', hotkey: 'E' });
  if (meta?.skillVariants) {
    for (const v of meta.skillVariants) btns.push({ label: v.label, action: 'skill', params: v.params });
  } else if (char.params.skill?.hold) {
    btns.push({ label: 'E hold', action: 'skill', params: { hold: 1 }, hotkey: '⇧E', title: char.params.skill.hold });
  }
  btns.push({ label: 'Q', action: 'burst', hotkey: 'Q' });
  const hits = attackHitCount(char);
  for (let n = 1; n <= hits; n++) btns.push({ label: `N${n}`, action: 'attack', repeat: n, hotkey: n === 1 ? 'A' : undefined });
  if (char.weapon === 'bow') btns.push({ label: 'Aim', action: 'aim', hotkey: 'C' });
  else btns.push({ label: 'CA', action: 'charge', hotkey: 'C' });
  btns.push({ label: 'Plunge', action: 'high_plunge', hotkey: 'P' });
  btns.push({ label: 'Dash', action: 'dash', hotkey: 'D' });
  btns.push({ label: 'Jump', action: 'jump', hotkey: 'J' });
  return btns;
}

function fmtS(frames: number) {
  return `${(frames / 60).toFixed(frames < 600 ? 2 : 1)}s`;
}

/** Cursor that points at the end of a list. */
export function endOf(project: Project, listId: ListId): Cursor {
  const list = getList(project.rotation, listId) ?? [];
  return { listId, afterId: list.length ? list[list.length - 1].id : null };
}

/**
 * Insert an item at the cursor. Identical consecutive actions merge into
 * `action:N`. Inserting a block moves the cursor inside it.
 */
export function insertAt(
  update: (fn: Updater) => void,
  cursor: Cursor,
  item: RotItem,
  setSelected: (id: string | null) => void,
  setCursor: (c: Cursor) => void,
) {
  let newSel = item.id;
  let listId = cursor.listId;
  update((p) => {
    let list = getList(p.rotation, listId);
    if (!list) {
      listId = 'loop';
      list = p.rotation.loop;
    }
    let idx = cursor.afterId ? list.findIndex((x) => x.id === cursor.afterId) : -1;
    if (cursor.afterId && idx < 0) idx = list.length - 1;
    const prev = list[idx];
    if (
      prev && isAction(prev) && isAction(item) && item.char && prev.char === item.char && prev.action === item.action &&
      item.action !== 'burst' && !prev.cond && !item.cond && JSON.stringify(prev.params) === JSON.stringify(item.params)
    ) {
      prev.repeat += item.repeat;
      newSel = prev.id;
      return;
    }
    list.splice(idx + 1, 0, item);
  });
  setSelected(newSel);
  if (!isAction(item) && item.kind !== 'raw') setCursor({ listId: `${item.id}/${item.kind === 'if' ? 'then' : 'body'}`, afterId: null });
  else setCursor({ listId, afterId: newSel });
}

interface StepInfo {
  waited: number;
  skipped: boolean;
  warnings: string[];
  dur: number;
}

interface Ctx {
  project: Project;
  update: (fn: Updater) => void;
  selected: string | null;
  setSelected: (id: string | null) => void;
  cursor: Cursor;
  setCursor: (c: Cursor) => void;
  stepInfo: Map<string, StepInfo>;
  setDragId: (id: string | null) => void;
  dropHint: { listId: ListId; index: number } | null;
  setDropHint: (h: { listId: ListId; index: number } | null) => void;
  onDrop: (listId: ListId, index: number) => void;
}

function locateSection(project: Project, listId: ListId): Section {
  if (listId === 'opener' || listId === 'loop') return listId;
  return locate(project.rotation, listId.split('/')[0])?.section ?? 'loop';
}

export function RotationBuilder(props: Props) {
  const { project, update, timeline, selected, setSelected, cursor, setCursor, focusChar, setFocusChar, waitFrames, setWaitFrames, statusHints } = props;
  const team = project.team.map((b) => (b && getChar(b.key) ? b : null));
  const teamList = team.filter((b): b is CharBuild => !!b);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropHint, setDropHint] = useState<{ listId: ListId; index: number } | null>(null);

  const cursorRes = useMemo(() => readinessAt(project, cursor.listId, cursor.afterId), [project, cursor]);

  const stepInfo = useMemo(() => {
    const m = new Map<string, StepInfo>();
    for (const s of timeline.steps) {
      if (s.loop > 0 || m.has(s.actionId)) continue;
      m.set(s.actionId, { waited: s.waited, skipped: s.skipped, warnings: s.warnings, dur: s.end - s.start });
    }
    return m;
  }, [timeline]);

  const onDrop = (listId: ListId, index: number) => {
    const id = dragId;
    setDragId(null);
    setDropHint(null);
    if (!id) return;
    update((p) => {
      if (listInside(p.rotation, listId, id)) return;
      const loc = locate(p.rotation, id);
      if (!loc) return;
      let at = index;
      if (loc.listId === listId && loc.index < index) at--;
      const item = removeItem(p.rotation, id)!;
      const list = getList(p.rotation, listId);
      if (!list) return;
      list.splice(Math.max(0, Math.min(at, list.length)), 0, item);
    });
  };

  const ctx: Ctx = { project, update, selected, setSelected, cursor, setCursor, stepInfo, setDragId, dropHint, setDropHint, onDrop };
  const add = (item: RotItem) => insertAt(update, cursor, item, setSelected, setCursor);
  const firstChar = teamList[0]?.key ?? '';
  const loc = selected ? locate(project.rotation, selected) : null;
  const sel = loc?.item;
  const targetSection = locateSection(project, cursor.listId);

  return (
    <div className="rotation">
      <div className="palette">
        {team.map((b, i) => {
          if (!b) return null;
          const c = getChar(b.key)!;
          const r = cursorRes.readiness.find((x) => x.char === b.key);
          const color = ELEMENT_COLORS[c.element];
          const cds = cooldowns(c, {});
          return (
            <div key={b.uid} className={`pal-row ${focusChar === i ? 'focus' : ''}`} style={{ ['--el' as string]: color }} onClick={() => setFocusChar(i)}>
              <div className="pal-char">
                <span className="kbd">{i + 1}</span>
                <span className="avatar-wrap sm"><Icon src={charIcon(c.id)} rarity={c.rarity} size={28} className="avatar" /></span>
                <span className="pal-name">{c.name}</span>
                <span className="pal-ready small" title={t('At the insertion cursor (estimate)')}>
                  <span className={r && r.skillIn > 0 ? 'cd' : 'ok'} title={t('E cooldown {n}s', { n: cds.skill })}>
                    E {r && r.skillIn > 0 ? fmtS(r.skillIn) : t('ready')}{r && r.skillMaxCharges > 1 ? ` (${r.skillCharges}/${r.skillMaxCharges})` : ''}
                  </span>
                  <span className={r && r.burstIn > 0 ? 'cd' : 'ok'} title={t('Q cooldown {n}s · {e} energy', { n: cds.burst, e: c.energy })}>
                    Q {r && r.burstIn > 0 ? fmtS(r.burstIn) : t('ready')}
                  </span>
                </span>
              </div>
              <div className="pal-btns">
                {paletteFor(c).map((btn) => {
                  const override = CHAR_META[c.key]?.frames?.[btn.action];
                  const fs = override ? { slice: override, generic: true } : frameSlice(c, btn.action, btn.params ?? {}, 0);
                  const cd = btn.action === 'skill' ? cooldowns(c, btn.params ?? {}).skill : btn.action === 'burst' ? cds.burst : null;
                  const tip = [
                    btn.title,
                    t('{a}f animation, {b}f to swap', { a: `${fs.generic ? '~' : ''}${framesUntil(fs.slice, null)}`, b: framesUntil(fs.slice, 'swap') }),
                    cd ? t('cooldown {n}s', { n: cd }) : '',
                    btn.hotkey ? t('hotkey {k}', { k: btn.hotkey }) : '',
                  ].filter(Boolean).join(' · ');
                  const notReady = (btn.action === 'skill' && r && r.skillIn > 0) || (btn.action === 'burst' && r && r.burstIn > 0);
                  return (
                    <button
                      key={btn.label}
                      type="button"
                      className={`act-btn act-${btn.action} ${notReady ? 'not-ready' : ''}`}
                      title={tip}
                      onClick={(e) => {
                        e.stopPropagation();
                        setFocusChar(i);
                        add(act(b.key, btn.action, { params: btn.params ?? {}, repeat: btn.repeat ?? 1 }));
                      }}
                    >
                      {t(btn.label)}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
        {!team.some(Boolean) && <div className="muted">{t('Add characters above to start building a rotation.')}</div>}
        <div className="pal-row util">
          <div className="pal-char"><span className="pal-name">{t('Timing')}</span></div>
          <div className="pal-btns">
            <input type="number" className="wait-input" min={1} value={waitFrames} onChange={(e) => setWaitFrames(Math.max(1, +e.target.value || 1))} title={t('frames (60 = 1s)')} />
            <span className="muted small">f</span>
            <button type="button" className="act-btn" onClick={() => add(act('', 'wait', { frames: waitFrames }))} title={t('wait(n): idle for n frames (hotkey W)')}>{t('Wait')}</button>
            <button type="button" className="act-btn" onClick={() => add(act('', 'delay', { frames: waitFrames }))} title={t('delay(n): delay the next action by n frames')}>{t('Delay')}</button>
          </div>
        </div>
        <div className="pal-row util adv">
          <div className="pal-char"><span className="pal-name">{t('Logic')}</span><span className="muted small">{t('inserts a block at the cursor')}</span></div>
          <div className="pal-btns">
            <button
              type="button"
              className="act-btn"
              title="if <condition> { … } else { … }"
              onClick={() => add({ kind: 'if', id: uid(), cond: readyCond(firstChar || 'char', 'burst'), then: [], else: [] })}
            >
              {t('If…')}
            </button>
            <button type="button" className="act-btn" title={t('for N times { … }')} onClick={() => add({ kind: 'repeat', id: uid(), count: 3, body: [] })}>
              {t('Repeat ×N')}
            </button>
            <button type="button" className="act-btn" title={t('raw gcsim script')} onClick={() => add({ kind: 'raw', id: uid(), text: '# gcsim script' })}>
              {t('Script')}
            </button>
          </div>
        </div>
      </div>

      <div className="sequence">
        <NotationBox project={project} update={update} cursor={cursor} setCursor={setCursor} setSelected={setSelected} />
        {(['opener', 'loop'] as Section[]).map((s) => {
          const list = project.rotation[s];
          return (
            <div key={s} className={`seq-section ${targetSection === s ? 'target' : ''}`}>
              <div className="seq-head">
                <strong>{s === 'opener' ? t('Opener') : t('Rotation loop')}</strong>
                <span className="muted small">
                  {s === 'opener' ? t('runs once') : project.rotation.loopMode === 'while' ? t('repeats until the sim ends') : t('repeats {n}×', { n: project.rotation.loopCount })}
                </span>
                {s === 'loop' && (
                  <span className="loop-opts adv">
                    <select value={project.rotation.loopMode} onChange={(e) => update((p) => { p.rotation.loopMode = e.target.value as 'while' | 'for'; })}>
                      <option value="while">while 1</option>
                      <option value="for">for N</option>
                    </select>
                    {project.rotation.loopMode === 'for' && (
                      <input type="number" min={1} value={project.rotation.loopCount} onChange={(e) => update((p) => { p.rotation.loopCount = Math.max(1, +e.target.value || 1); })} />
                    )}
                  </span>
                )}
                {list.length > 0 && (
                  <button
                    type="button"
                    className="btn ghost small"
                    onClick={() => {
                      if (confirm(s === 'opener' ? t('Clear the opener?') : t('Clear the loop?'))) {
                        update((p) => { p.rotation[s] = []; });
                        setCursor({ listId: s, afterId: null });
                        setSelected(null);
                      }
                    }}
                  >
                    {t('Clear')}
                  </button>
                )}
              </div>
              <ItemList
                items={list}
                listId={s}
                ctx={ctx}
                empty={s === 'opener' ? t('Optional. Actions here run once before the loop.') : t('Click action buttons (or press 1-4, then E / Q / A / C) to add actions.')}
              />
            </div>
          );
        })}
      </div>

      {sel && (
        <div className="action-editor card">
          {isAction(sel) ? (
            <ActionEditor
              a={sel}
              char={sel.char ? getChar(sel.char) : undefined}
              team={teamList}
              statusHints={statusHints}
              onChange={(fn) => update((p) => { const x = locate(p.rotation, sel.id)?.item; if (x && isAction(x)) fn(x); })}
            />
          ) : (
            <BlockEditor
              b={sel}
              team={teamList}
              statusHints={statusHints}
              onChange={(fn) => update((p) => { const x = locate(p.rotation, sel.id)?.item; if (x && !isAction(x)) fn(x); })}
            />
          )}
          <div className="ae-actions">
            <button
              type="button"
              className="btn ghost small"
              onClick={() => {
                const copy = cloneWithIds(sel, uid);
                update((p) => { const l = locate(p.rotation, sel.id); if (l) l.list.splice(l.index + 1, 0, copy); });
                setSelected(copy.id);
              }}
            >
              {t('Duplicate')}
            </button>
            <button
              type="button"
              className="btn ghost small"
              title={t('Put this inside an if block')}
              onClick={() => {
                const id = uid();
                update((p) => {
                  const l = locate(p.rotation, sel.id);
                  if (!l) return;
                  const cond = isAction(sel) && sel.char ? readyCond(sel.char, sel.action === 'skill' ? 'skill' : 'burst') : readyCond(firstChar || 'char', 'burst');
                  l.list.splice(l.index, 1, { kind: 'if', id, cond, then: [l.item], else: [] });
                });
                setSelected(id);
              }}
            >
              {t('Wrap in If')}
            </button>
            <button
              type="button"
              className="btn ghost small"
              title={t('Put this inside a repeat block')}
              onClick={() => {
                const id = uid();
                update((p) => { const l = locate(p.rotation, sel.id); if (l) l.list.splice(l.index, 1, { kind: 'repeat', id, count: 2, body: [l.item] }); });
                setSelected(id);
              }}
            >
              {t('Wrap in Repeat')}
            </button>
            {!isAction(sel) && sel.kind !== 'raw' && (
              <button
                type="button"
                className="btn ghost small"
                onClick={() => update((p) => {
                  const x = locate(p.rotation, sel.id)?.item;
                  if (x && !isAction(x) && x.kind !== 'raw') x.collapsed = !x.collapsed;
                })}
              >
                {sel.collapsed ? t('Expand') : t('Collapse')}
              </button>
            )}
            {!isAction(sel) && sel.kind !== 'raw' && (
              <button
                type="button"
                className="btn ghost small"
                title={t('Replace the block with its contents')}
                onClick={() => {
                  update((p) => {
                    const l = locate(p.rotation, sel.id);
                    if (!l || isAction(l.item) || l.item.kind === 'raw') return;
                    const inner = l.item.kind === 'if' ? l.item.then : l.item.body;
                    l.list.splice(l.index, 1, ...inner);
                  });
                  setSelected(null);
                }}
              >
                {t('Unwrap')}
              </button>
            )}
            <span className="grow" />
            <button
              type="button"
              className="btn ghost small danger"
              onClick={() => {
                update((p) => { removeItem(p.rotation, sel.id); });
                setSelected(null);
                if (loc) setCursor({ listId: loc.listId, afterId: loc.list[loc.index - 1]?.id ?? null });
              }}
            >
              {t('Delete')}
            </button>
            <button type="button" className="icon-btn" onClick={() => setSelected(null)} title={t('Close')}>✕</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ list / chips / blocks

function Caret() {
  return <span className="caret-mark" title={t('new actions are inserted here')} />;
}

function ItemList({ items, listId, ctx, empty }: { items: RotItem[]; listId: ListId; ctx: Ctx; empty?: ReactNode }) {
  const { cursor, setCursor, dropHint, setDropHint, onDrop, project } = ctx;
  const isTarget = cursor.listId === listId;
  return (
    <div
      className={`chips ${isTarget ? 'target' : ''}`}
      onClick={(e) => {
        e.stopPropagation();
        ctx.setSelected(null);
        setCursor(endOf(project, listId));
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.target === e.currentTarget && (dropHint?.listId !== listId || dropHint.index !== items.length)) setDropHint({ listId, index: items.length });
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onDrop(listId, dropHint?.listId === listId ? dropHint.index : items.length);
      }}
    >
      {isTarget && cursor.afterId === null && <Caret />}
      {items.map((x, idx) => {
        const prev = items[idx - 1];
        const prevChar = prev ? lastChar(prev) : '';
        const collapsed = !isAction(x) && x.kind !== 'raw' && !!x.collapsed;
        return (
          <span key={x.id} className={`item-wrap ${isAction(x) || collapsed ? '' : 'is-block'}`}>
            {dropHint?.listId === listId && dropHint.index === idx && <span className="drop-marker" />}
            {isAction(x) ? (
              <ActionChip a={x} prevChar={prevChar} listId={listId} idx={idx} ctx={ctx} />
            ) : collapsed ? (
              <BlockChip b={x} prevChar={prevChar} listId={listId} idx={idx} ctx={ctx} />
            ) : (
              <BlockView b={x} listId={listId} idx={idx} ctx={ctx} />
            )}
            {isTarget && cursor.afterId === x.id && <Caret />}
          </span>
        );
      })}
      {dropHint?.listId === listId && dropHint.index === items.length && <span className="drop-marker" />}
      {!items.length && empty && <span className="muted small empty-hint">{empty}</span>}
    </div>
  );
}

function dragProps(id: string, listId: ListId, idx: number, ctx: Ctx, vertical = false) {
  return {
    draggable: true,
    onDragStart: (e: DragEvent) => {
      e.stopPropagation();
      ctx.setDragId(id);
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', id);
    },
    onDragEnd: () => {
      ctx.setDragId(null);
      ctx.setDropHint(null);
    },
    onDragOver: (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const after = vertical ? e.clientY > rect.top + rect.height / 2 : e.clientX > rect.left + rect.width / 2;
      const index = after ? idx + 1 : idx;
      if (ctx.dropHint?.listId !== listId || ctx.dropHint.index !== index) ctx.setDropHint({ listId, index });
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      ctx.onDrop(listId, ctx.dropHint?.listId === listId ? ctx.dropHint.index : idx);
    },
  };
}

function ActionChip({ a, prevChar, listId, idx, ctx }: { a: RotationAction; prevChar: string; listId: ListId; idx: number; ctx: Ctx }) {
  const c = a.char ? getChar(a.char) : undefined;
  const info = ctx.stepInfo.get(a.id);
  const color = c ? ELEMENT_COLORS[c.element] : 'var(--muted)';
  const cdWait = !!info?.waited && info.warnings.some((w) => w.includes('cooldown'));
  return (
    <span
      className={`chip ${ctx.selected === a.id ? 'sel' : ''} ${info?.skipped ? 'skipped' : ''} ${cdWait ? 'waited' : ''} ${a.char && a.char !== prevChar ? 'new-char' : ''}`}
      style={{ ['--el' as string]: color }}
      {...dragProps(a.id, listId, idx, ctx)}
      onClick={(e) => {
        e.stopPropagation();
        ctx.setSelected(ctx.selected === a.id ? null : a.id);
        ctx.setCursor({ listId, afterId: a.id });
      }}
      title={[c ? c.name : '', info ? fmtS(info.dur) : '', a.cond ? t('only if {cond}', { cond: condToScript(a.cond) }) : '', ...(info?.warnings ?? [])].filter(Boolean).join('\n')}
    >
      {c && a.char !== prevChar && (
        <>
          <Icon src={charIcon(c.id)} size={20} className="avatar chip-avatar" />
          <span className="chip-char">{c.name.split(' ')[0]}</span>
        </>
      )}
      {a.cond && <span className="chip-flag cond-flag">if</span>}
      <span className="chip-act">{actionLabel(a, c)}</span>
      {a.action !== 'attack' && a.repeat > 1 && <span className="chip-flag">×{a.repeat}</span>}
      {cdWait ? <span className="chip-wait">+{fmtS(info!.waited)}</span> : null}
      <button
        type="button"
        className="chip-x"
        title={t('Remove')}
        onClick={(e) => {
          e.stopPropagation();
          ctx.update((p) => { removeItem(p.rotation, a.id); });
          if (ctx.selected === a.id) ctx.setSelected(null);
        }}
      >
        ×
      </button>
    </span>
  );
}

function toggleCollapse(ctx: Ctx, id: string, listId: ListId) {
  let nowCollapsed = false;
  ctx.update((p) => {
    const x = locate(p.rotation, id)?.item;
    if (x && !isAction(x) && x.kind !== 'raw') {
      x.collapsed = !x.collapsed;
      nowCollapsed = x.collapsed;
    }
  });
  // don't leave the insertion cursor inside a block that gets hidden
  if (nowCollapsed && listInside(ctx.project.rotation, ctx.cursor.listId, id)) ctx.setCursor({ listId, afterId: id });
}

/** A collapsed repeat / if block, drawn like an action chip: "10(N2CD)". */
function BlockChip({ b, prevChar, listId, idx, ctx }: { b: Exclude<RotItem, RotationAction>; prevChar: string; listId: ListId; idx: number; ctx: Ctx }) {
  const items = b.kind === 'if' ? [...b.then, ...b.else] : b.kind === 'repeat' ? b.body : [];
  const key = soleChar(items);
  const c = key ? getChar(key) : undefined;
  const color = c ? ELEMENT_COLORS[c.element] : 'var(--accent)';
  // the chip shows the character once; drop the key prefix the notation adds for single-character blocks
  const text = notation([b], !key) || (b.kind === 'repeat' ? `${b.count}()` : '[]?');
  return (
    <span
      className={`chip block-chip ${ctx.selected === b.id ? 'sel' : ''} ${c && key !== prevChar ? 'new-char' : ''}`}
      style={{ ['--el' as string]: color }}
      {...dragProps(b.id, listId, idx, ctx)}
      onClick={(e) => {
        e.stopPropagation();
        ctx.setSelected(ctx.selected === b.id ? null : b.id);
        ctx.setCursor({ listId, afterId: b.id });
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        toggleCollapse(ctx, b.id, listId);
      }}
      title={`${b.kind === 'if' ? `if ${condToScript(b.cond)}\n` : ''}${t('double-click to expand')}`}
    >
      <button
        type="button"
        className="blk-toggle chip-expand"
        title={t('Expand')}
        onClick={(e) => {
          e.stopPropagation();
          toggleCollapse(ctx, b.id, listId);
        }}
      >
        ▸
      </button>
      {c && key !== prevChar && (
        <>
          <Icon src={charIcon(c.id)} size={20} className="avatar chip-avatar" />
          <span className="chip-char">{c.name.split(' ')[0]}</span>
        </>
      )}
      <span className="chip-act">{text}</span>
      <button
        type="button"
        className="chip-x"
        title={t('Remove block')}
        onClick={(e) => {
          e.stopPropagation();
          ctx.update((p) => { removeItem(p.rotation, b.id); });
          if (ctx.selected === b.id) ctx.setSelected(null);
        }}
      >
        ×
      </button>
    </span>
  );
}

function BlockView({ b, listId, idx, ctx }: { b: Exclude<RotItem, RotationAction>; listId: ListId; idx: number; ctx: Ctx }) {
  const selected = ctx.selected === b.id;
  const collapsed = b.kind !== 'raw' && !!b.collapsed;
  const summary = b.kind === 'raw' ? '' : notation([b]);
  const toggle = () => toggleCollapse(ctx, b.id, listId);
  return (
    <div className={`blk blk-${b.kind} ${selected ? 'sel' : ''} ${collapsed ? 'collapsed' : ''}`} onClick={(e) => e.stopPropagation()}>
      <div
        className="blk-head"
        {...dragProps(b.id, listId, idx, ctx, true)}
        onClick={(e) => {
          e.stopPropagation();
          ctx.setSelected(selected ? null : b.id);
          ctx.setCursor({ listId, afterId: b.id });
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          toggle();
        }}
      >
        {b.kind !== 'raw' && (
          <button
            type="button"
            className="blk-toggle"
            title={collapsed ? t('Expand (double-click the header works too)') : t('Collapse')}
            onClick={(e) => {
              e.stopPropagation();
              toggle();
            }}
          >
            {collapsed ? '▸' : '▾'}
          </button>
        )}
        {b.kind === 'if' && (<><span className="blk-kw">if</span><code className="blk-cond">{condToScript(b.cond)}</code></>)}
        {b.kind === 'repeat' && (<><span className="blk-kw">repeat</span><b>{b.count}×</b></>)}
        {summary && b.kind !== 'raw' && <code className="blk-notation muted">{summary}</code>}
        {b.kind === 'raw' && (<><span className="blk-kw">script</span><span className="muted small">{t('raw gcsim script (the estimate skips it)')}</span></>)}
        <button
          type="button"
          className="chip-x"
          title={t('Remove block')}
          onClick={(e) => {
            e.stopPropagation();
            ctx.update((p) => { removeItem(p.rotation, b.id); });
            if (selected) ctx.setSelected(null);
          }}
        >
          ×
        </button>
      </div>
      {b.kind === 'raw' ? (
        <pre className="blk-raw" onClick={(e) => { e.stopPropagation(); ctx.setSelected(b.id); }}>{b.text}</pre>
      ) : (
        childLists(b).map((l) => (
          <div key={l.id} className="blk-branch">
            {b.kind === 'if' && <span className="blk-label">{t(l.label)}</span>}
            <ItemList items={l.items} listId={l.id} ctx={ctx} empty={t('click here, then add actions')} />
          </div>
        ))
      )}
    </div>
  );
}

// ------------------------------------------------------------------ editors

function ActionEditor({
  a, char, team, statusHints, onChange,
}: {
  a: RotationAction;
  char: CharData | undefined;
  team: CharBuild[];
  statusHints: Record<string, string[]>;
  onChange: (fn: (a: RotationAction) => void) => void;
}) {
  const known = char ? char.params[a.action] ?? {} : {};
  const extra = Object.keys(a.params).filter((k) => !(k in known));
  const [newKey, setNewKey] = useState('');
  const note = char?.notes[a.action];
  const defaultCond = (): Condition =>
    a.action === 'skill' || a.action === 'burst' ? readyCond(a.char, a.action) : { join: 'and', clauses: [newClause(a.char || team[0]?.key || 'char')] };

  return (
    <>
      <div className="ae-head">
        <strong>{char ? `${char.name} · ` : ''}{actionLabel(a, char)}</strong>
        <span className="muted small"><code>{a.action}</code></span>
      </div>
      <div className="row wrap">
        {a.action === 'wait' || a.action === 'delay' ? (
          <label className="field narrow">
            <span>{t('Frames')}</span>
            <input type="number" min={0} value={a.frames ?? 0} onChange={(e) => onChange((x) => { x.frames = Math.max(0, +e.target.value || 0); })} />
          </label>
        ) : (
          <label className="field narrow">
            <span>{a.action === 'attack' ? t('Hits (:N)') : t('Repeat (:N)')}</span>
            <input type="number" min={1} value={a.repeat} onChange={(e) => onChange((x) => { x.repeat = Math.max(1, +e.target.value || 1); })} />
          </label>
        )}
        {Object.entries(known).map(([k, desc]) => (
          <label key={k} className="field param" title={desc}>
            <span>{k}</span>
            <input
              type="number"
              value={a.params[k] ?? ''}
              placeholder={t('default')}
              onChange={(e) => onChange((x) => {
                if (e.target.value === '') delete x.params[k];
                else x.params[k] = +e.target.value;
              })}
            />
            <small className="muted">{desc}</small>
          </label>
        ))}
        {extra.map((k) => (
          <label key={k} className="field narrow">
            <span>{k}</span>
            <input
              type="number"
              value={a.params[k]}
              onChange={(e) => onChange((x) => {
                if (e.target.value === '') delete x.params[k];
                else x.params[k] = +e.target.value;
              })}
            />
          </label>
        ))}
        {a.char && (
          <label className="field narrow">
            <span>{t('Add param')}</span>
            <span className="row tight">
              <input value={newKey} placeholder={t('name')} onChange={(e) => setNewKey(e.target.value.replace(/[^a-z0-9_%]/gi, ''))} />
              <button type="button" className="btn small" disabled={!newKey} onClick={() => { onChange((x) => { x.params[newKey] = 1; }); setNewKey(''); }}>+</button>
            </span>
          </label>
        )}
      </div>
      {note && <div className="hint small">{note}</div>}
      {a.char && (
        <div className="ae-cond">
          <label className="check">
            <input type="checkbox" checked={!!a.cond} onChange={(e) => onChange((x) => { x.cond = e.target.checked ? defaultCond() : undefined; })} />
            {t('Only run if…')}
          </label>
          {a.cond && <ConditionEditor cond={a.cond} team={team} statusHints={statusHints} defaultChar={a.char} onChange={(c) => onChange((x) => { x.cond = c; })} />}
        </div>
      )}
    </>
  );
}

function BlockEditor({
  b, team, statusHints, onChange,
}: {
  b: Exclude<RotItem, RotationAction>;
  team: CharBuild[];
  statusHints: Record<string, string[]>;
  onChange: (fn: (b: Exclude<RotItem, RotationAction>) => void) => void;
}) {
  return (
    <>
      <div className="ae-head">
        <strong>{b.kind === 'if' ? t('If block') : b.kind === 'repeat' ? t('Repeat block') : t('Script block')}</strong>
        <span className="muted small">
          {b.kind === 'if' ? t('runs "then" when the condition holds, otherwise "else"') : b.kind === 'repeat' ? t('for N times { … }') : t('inserted verbatim into the config')}
        </span>
      </div>
      {b.kind === 'if' && <ConditionEditor cond={b.cond} team={team} statusHints={statusHints} onChange={(c) => onChange((x) => { if (x.kind === 'if') x.cond = c; })} />}
      {b.kind === 'repeat' && (
        <label className="field narrow">
          <span>{t('Times')}</span>
          <input type="number" min={1} value={b.count} onChange={(e) => onChange((x) => { if (x.kind === 'repeat') x.count = Math.max(1, +e.target.value || 1); })} />
        </label>
      )}
      {b.kind === 'raw' && (
        <textarea
          className="raw-edit"
          spellCheck={false}
          value={b.text}
          rows={Math.min(14, b.text.split('\n').length + 1)}
          onChange={(e) => onChange((x) => { if (x.kind === 'raw') x.text = e.target.value; })}
        />
      )}
    </>
  );
}

import { useMemo, useState } from 'react';
import { getChar } from '../data';
import { parseNotation } from '../lib/notationImport';
import { createBuild } from '../lib/project';
import { getList, notation } from '../lib/rotation';
import type { Updater } from '../lib/store';
import type { Project, RotItem } from '../lib/types';
import type { Cursor } from './RotationBuilder';
import { t } from '../i18n';

interface Props {
  project: Project;
  update: (fn: Updater) => void;
  cursor: Cursor;
  setCursor: (c: Cursor) => void;
  setSelected: (id: string | null) => void;
}

/** Display names without spaces ("HuTao") read back unambiguously by the parser. */
const textName = (k: string) => (getChar(k)?.name ?? k).replace(/[^0-9A-Za-z]/g, '');

/** Rotation as text: "Nicole QE Citlali E Yelan Q N1 E N1 E N1 HuTao E 10(N2CD) Q". */
export function rotationText(items: RotItem[]): string {
  return notation(items, true, { name: textName, sep: ' ' });
}

export function NotationBox({ project, update, cursor, setCursor, setSelected }: Props) {
  const [text, setText] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const team = project.team.filter(Boolean).map((b) => b!.key);
  const parsed = useMemo(() => (text.trim() ? parseNotation(text, team) : null), [text, team.join(',')]);

  const missing = parsed ? parsed.chars.filter((k) => !team.includes(k)) : [];
  const freeSlots = project.team.filter((b) => !b).length;
  const problems = [
    ...(parsed?.errors ?? []),
    ...(missing.length > freeSlots ? [t('not enough free team slots for {names}', { names: missing.map((k) => getChar(k)?.name ?? k).join(', ') })] : []),
  ];
  const ok = !!parsed && parsed.items.length > 0 && problems.length === 0;

  const apply = (mode: 'loop' | 'opener' | 'cursor') => {
    if (!parsed || !ok) return;
    const items = parsed.items;
    update((p) => {
      for (const k of missing) {
        const slot = p.team.findIndex((b) => !b);
        if (slot >= 0) p.team[slot] = createBuild(k);
      }
      if (!p.active) p.active = parsed.chars[0] ?? p.active;
      if (mode === 'cursor') {
        const list = getList(p.rotation, cursor.listId) ?? p.rotation.loop;
        const idx = cursor.afterId ? list.findIndex((x) => x.id === cursor.afterId) : -1;
        list.splice(idx + 1, 0, ...items);
      } else {
        p.rotation[mode] = items;
      }
    });
    const last = items[items.length - 1];
    setSelected(null);
    setCursor(mode === 'cursor' ? { listId: cursor.listId, afterId: last.id } : { listId: mode, afterId: last.id });
    setMsg(`${t('Added {n} item(s)', { n: items.length })}${missing.length ? `; ${t('new team members: {names}', { names: missing.map((k) => getChar(k)?.name ?? k).join(', ') })}` : ''}.`);
    setText('');
  };

  const copyLoop = async () => {
    const txt = rotationText(project.rotation.loop);
    try {
      await navigator.clipboard.writeText(txt);
      setMsg(t('Copied: {text}', { text: txt }));
    } catch {
      setText(txt);
      setMsg(t('Clipboard unavailable: the text is in the box above.'));
    }
  };

  return (
    <div className="notation-box">
      <div className="nb-row">
        <textarea
          rows={1}
          spellCheck={false}
          value={text}
          placeholder={t('Type rotation: {example}', { example: 'Nicole QE Citlali E Yelan Q N1 E N1 E N1 HuTao E 10N2CD Q' })}
          onChange={(e) => {
            setText(e.target.value);
            setMsg(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              apply('loop');
            }
          }}
        />
        <button type="button" className="btn primary small" disabled={!ok} onClick={() => apply('loop')} title="Enter">{t('Replace loop')}</button>
        <button type="button" className="btn ghost small" disabled={!ok} onClick={() => apply('opener')}>{t('Replace opener')}</button>
        <button type="button" className="btn ghost small" disabled={!ok} onClick={() => apply('cursor')}>{t('Insert at cursor')}</button>
        <button type="button" className="btn ghost small" disabled={!project.rotation.loop.length} onClick={copyLoop} title={t('Copy the rotation loop in this notation')}>{t('Copy loop as text')}</button>
      </div>
      {parsed && (
        <div className="small nb-preview">
          {parsed.items.length > 0 && <span>→ <code>{rotationText(parsed.items)}</code></span>}
          {missing.length > 0 && missing.length <= freeSlots && <span className="muted"> · {t('will add {names} to the team', { names: missing.map((k) => getChar(k)?.name ?? k).join(', ') })}</span>}
          {problems.map((p) => <div key={p} className="warn">{p}</div>)}
        </div>
      )}
      {!parsed && !msg && (
        <div className="small muted nb-preview">
          {t('N2 C/CA D J E hE Q A P · 10N2CD or 10(…) repeats · [N1Q | N2C]? if/else · Q? only if ready · wait30')}
        </div>
      )}
      {msg && <div className="small hint nb-preview">{msg}</div>}
    </div>
  );
}

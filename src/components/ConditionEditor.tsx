import { useId } from 'react';
import { getChar } from '../data';
import { displayValue, ELEMENTS, FIELDS, fieldOf, isEstimable, OPS, scriptValue, STAT_KEYS, unitSuffix, type FieldDef } from '../lib/conditions';
import { condToScript } from '../lib/rotation';
import type { CharBuild, Clause, Condition } from '../lib/types';
import { t } from '../i18n';

interface Props {
  cond: Condition;
  team: CharBuild[];
  /** status / modifier keys seen per character (from extracted data and the last sim) */
  statusHints: Record<string, string[]>;
  onChange: (c: Condition) => void;
  defaultChar?: string;
}

export function newClause(defaultChar: string): Clause {
  return { field: `.${defaultChar}.burst.ready`, op: '==', value: '1' };
}

export function ConditionEditor({ cond, team, statusHints, onChange, defaultChar }: Props) {
  const listId = useId();
  const firstChar = defaultChar || team[0]?.key || 'char';
  const set = (fn: (c: Condition) => void) => {
    const next = structuredClone(cond);
    fn(next);
    onChange(next);
  };
  const needsAssume = cond.clauses.some((c) => c.field.trim() && !isEstimable(c));

  return (
    <div className="cond">
      <div className="cond-head small">
        {cond.clauses.length > 1 ? (
          <>
            {t('match')}
            <select value={cond.join} onChange={(e) => set((c) => { c.join = e.target.value as Condition['join']; })}>
              <option value="and">{t('all (and)')}</option>
              <option value="or">{t('any (or)')}</option>
            </select>
            {t('of:')}
          </>
        ) : (
          t('when:')
        )}
      </div>
      {cond.clauses.map((clause, i) => (
        <ClauseRow
          key={i}
          clause={clause}
          team={team}
          statusHints={statusHints}
          datalistId={`${listId}-${i}`}
          onChange={(cl) => set((c) => { c.clauses[i] = cl; })}
          onRemove={cond.clauses.length > 1 ? () => set((c) => { c.clauses.splice(i, 1); }) : undefined}
        />
      ))}
      <div className="cond-foot">
        <button type="button" className="btn ghost small" onClick={() => set((c) => { c.clauses.push(newClause(firstChar)); })}>
          {t('+ condition')}
        </button>
        {needsAssume && (
          <label className="small muted" title={t("The timeline estimate can't know HP, statuses or auras. Pick what it should assume. The real sim always evaluates it.")}>
            {t('estimate assumes')}
            <select value={String(cond.assume ?? true)} onChange={(e) => set((c) => { c.assume = e.target.value === 'true'; })}>
              <option value="true">true</option>
              <option value="false">false</option>
            </select>
          </label>
        )}
        <code className="cond-preview small">{condToScript(cond)}</code>
      </div>
    </div>
  );
}

function ClauseRow({
  clause, team, statusHints, datalistId, onChange, onRemove,
}: {
  clause: Clause;
  team: CharBuild[];
  statusHints: Record<string, string[]>;
  datalistId: string;
  onChange: (c: Clause) => void;
  onRemove?: () => void;
}) {
  const { def, char, arg } = fieldOf(clause);
  const charKey = char || team[0]?.key || 'char';

  const rebuild = (d: FieldDef, c: string, a: string, keepValue = false): Clause => {
    let value = keepValue ? clause.value : clause.value;
    let op = clause.op;
    if (!keepValue) {
      if (d.unit === 'bool') {
        op = '==';
        value = '1';
      } else if (d.unit === 'ratio') {
        op = '<';
        value = '0.5';
      } else if (d.unit === 'frames') {
        op = '>';
        value = '0';
      } else if (d.unit === 'char') {
        op = '==';
        value = `.keys.char.${team[0]?.key ?? 'char'}`;
      } else if (d.id === 'custom') {
        op = '!=';
        value = '0';
      } else {
        value = '0';
        op = '>';
      }
    }
    return { field: d.build(c, a), op, value };
  };

  const suggestions = def.arg === 'status' || def.arg === 'mods' || def.arg === 'infusion'
    ? statusHints[charKey] ?? []
    : def.arg === 'stat' ? STAT_KEYS : def.arg === 'element' ? ELEMENTS : def.arg === 'coreStatus' ? statusHints[''] ?? [] : [];

  return (
    <div className="clause">
      <select
        value={def.id}
        onChange={(e) => {
          const d = FIELDS.find((f) => f.id === e.target.value)!;
          onChange(rebuild(d, charKey, d.id === 'custom' ? clause.field : '', false));
        }}
      >
        <optgroup label={t('Character')}>
          {FIELDS.filter((f) => f.scope === 'char').map((f) => <option key={f.id} value={f.id}>{t(f.label)}</option>)}
        </optgroup>
        <optgroup label={t('Global')}>
          {FIELDS.filter((f) => f.scope !== 'char').map((f) => <option key={f.id} value={f.id}>{t(f.label)}</option>)}
        </optgroup>
      </select>

      {def.scope === 'char' && (
        <select value={charKey} onChange={(e) => onChange({ ...clause, field: def.build(e.target.value, arg) })}>
          {team.map((b) => <option key={b.key} value={b.key}>{getChar(b.key)?.name ?? b.key}</option>)}
          {!team.some((b) => b.key === charKey) && <option value={charKey}>{charKey}</option>}
        </select>
      )}

      {def.arg && (
        <>
          <input
            className="clause-arg"
            list={datalistId}
            value={arg}
            placeholder={def.hint ? t(def.hint) : def.arg}
            onChange={(e) => onChange({ ...clause, field: def.build(charKey, e.target.value.trim()) })}
          />
          <datalist id={datalistId}>{suggestions.map((s) => <option key={s} value={s} />)}</datalist>
        </>
      )}

      {def.id === 'custom' && (
        <input
          className="clause-custom"
          value={clause.field}
          placeholder=".hutao.hpratio * 2"
          onChange={(e) => onChange({ ...clause, field: e.target.value })}
        />
      )}

      {def.unit === 'bool' ? (
        <select
          value={clause.op === '!=' ? (clause.value === '1' ? '0' : '1') : clause.value}
          onChange={(e) => onChange({ ...clause, op: '==', value: e.target.value })}
        >
          <option value="1">{t('is true')}</option>
          <option value="0">{t('is false')}</option>
        </select>
      ) : def.unit === 'char' ? (
        <>
          <select value={clause.op} onChange={(e) => onChange({ ...clause, op: e.target.value as Clause['op'] })}>
            <option value="==">{t('is')}</option>
            <option value="!=">{t('is not')}</option>
          </select>
          <select value={clause.value.replace('.keys.char.', '')} onChange={(e) => onChange({ ...clause, value: `.keys.char.${e.target.value}` })}>
            {team.map((b) => <option key={b.key} value={b.key}>{getChar(b.key)?.name ?? b.key}</option>)}
          </select>
        </>
      ) : (
        <>
          <select value={clause.op} onChange={(e) => onChange({ ...clause, op: e.target.value as Clause['op'] })}>
            {OPS.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
          <span className="clause-val">
            <input
              value={displayValue(def.unit, clause.value)}
              onChange={(e) => onChange({ ...clause, value: scriptValue(def.unit, e.target.value) })}
            />
            {unitSuffix(def.unit) && <span className="muted small">{unitSuffix(def.unit)}</span>}
          </span>
        </>
      )}
      {onRemove && <button type="button" className="icon-btn" title={t('Remove condition')} onClick={onRemove}>✕</button>}
    </div>
  );
}

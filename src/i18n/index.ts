/**
 * Tiny i18n: the English text is the key, `t('Run sim')` looks it up in the dictionary of the current
 * language and falls back to the English text. Placeholders: `t('{n} artifacts', { n: 5 })`.
 *
 * The language is module state (not React context) so plain functions can translate too; changing it
 * remounts the app (see main.tsx), which re-renders every label.
 */
import { useSyncExternalStore } from 'react';
import { RU } from './ru';

export type Lang = 'en' | 'ru';
export const LANGS: { id: Lang; label: string }[] = [
  { id: 'en', label: 'EN' },
  { id: 'ru', label: 'RU' },
];

const KEY = 'gcbuild.lang';
const DICTS: Record<Lang, Record<string, string>> = { en: {}, ru: RU };

function initial(): Lang {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'en' || saved === 'ru') return saved;
  } catch {
    // storage unavailable
  }
  return typeof navigator !== 'undefined' && /^(ru|uk|be|kk)\b/i.test(navigator.language) ? 'ru' : 'en';
}

let lang: Lang = initial();
const listeners = new Set<() => void>();

export const getLang = (): Lang => lang;

export function setLang(l: Lang) {
  if (l === lang) return;
  lang = l;
  try {
    localStorage.setItem(KEY, l);
  } catch {
    // storage unavailable
  }
  document.documentElement.lang = l;
  listeners.forEach((f) => f());
}

const subscribe = (f: () => void) => {
  listeners.add(f);
  return () => listeners.delete(f);
};

/** Current language, re-rendering on change. */
export const useLang = (): Lang => useSyncExternalStore(subscribe, getLang);

export function t(text: string, vars?: Record<string, string | number>): string {
  const out = DICTS[lang][text] ?? text;
  return vars ? out.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : out;
}

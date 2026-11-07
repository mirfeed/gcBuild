/**
 * UI preferences kept in the browser.
 * - advanced: simple / advanced mode. Advanced-only controls carry the `adv` class and are hidden by CSS in
 *   simple mode (`.app.simple .adv`), so components don't need the flag.
 * - backgrounds: decorative element-tinted backgrounds (`.app.plain` turns them off).
 */
import { useSyncExternalStore } from 'react';
import { desktop } from './desktop';

function pref(key: string, fallback: boolean) {
  let value = fallback;
  try {
    const v = localStorage.getItem(key);
    if (v === '1' || v === '0') value = v === '1';
  } catch {
    // storage unavailable
  }
  const listeners = new Set<() => void>();
  const subscribe = (f: () => void) => {
    listeners.add(f);
    return () => listeners.delete(f);
  };
  return {
    set(v: boolean) {
      value = v;
      try {
        localStorage.setItem(key, v ? '1' : '0');
      } catch {
        // storage unavailable
      }
      listeners.forEach((f) => f());
    },
    use: (): boolean => useSyncExternalStore(subscribe, () => value),
  };
}

const advancedPref = pref('gcbuild.advanced', false);
const backgroundsPref = pref('gcbuild.backgrounds', true);

export const setAdvanced = advancedPref.set;
export const useAdvanced = advancedPref.use;
export const setBackgrounds = backgroundsPref.set;
export const useBackgrounds = backgroundsPref.use;

// ------------------------------------------------------------------ theme: system / dark / light

export type Theme = 'system' | 'dark' | 'light';
const THEME_KEY = 'gcbuild.theme';

function savedTheme(): Theme {
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (v === 'dark' || v === 'light') return v;
  } catch {
    // storage unavailable
  }
  return 'system';
}

let theme: Theme = savedTheme();
const themeListeners = new Set<() => void>();

function applyTheme(th: Theme) {
  const el = document.documentElement;
  if (th === 'system') delete el.dataset.theme;
  else el.dataset.theme = th;
  // desktop app: the window controls / title bar colours and native widgets follow the same choice
  void desktop?.setTheme?.(th);
}

export function setTheme(th: Theme) {
  theme = th;
  try {
    localStorage.setItem(THEME_KEY, th);
  } catch {
    // storage unavailable
  }
  applyTheme(th);
  themeListeners.forEach((f) => f());
}

const subscribeTheme = (f: () => void) => {
  themeListeners.add(f);
  return () => themeListeners.delete(f);
};

export const useTheme = (): Theme => useSyncExternalStore(subscribeTheme, () => theme);

// sync the desktop window with the saved choice on start
applyTheme(theme);

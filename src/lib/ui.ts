/**
 * UI preferences kept in the browser.
 * - advanced: simple / advanced mode. Advanced-only controls carry the `adv` class and are hidden by CSS in
 *   simple mode (`.app.simple .adv`), so components don't need the flag.
 * - backgrounds: decorative element-tinted backgrounds (`.app.plain` turns them off).
 */
import { useSyncExternalStore } from 'react';

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

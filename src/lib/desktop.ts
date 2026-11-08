/** Bridge exposed by the desktop app's preload (electron/preload.cjs); undefined in a normal browser. */
export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'none'; version: string }
  | { state: 'downloading'; version: string; percent: number }
  | { state: 'ready'; version: string }
  | { state: 'error'; message: string }
  /** beta channel: the server no longer accepts the key (revoked, or the Beta tester role was removed) */
  | { state: 'beta-key-rejected' }
  | { state: 'dev' };

export interface BetaInfo {
  enabled: boolean;
  hasKey: boolean;
  feed: string;
}

export type BetaSetResult =
  | { ok: true; note?: 'no-beta-yet' }
  | { ok: false; error: 'invalid-key' | 'offline' | 'server'; message?: string };

export interface DesktopBridge {
  isDesktop: true;
  version: () => Promise<string>;
  /** window controls / native widgets follow the app theme */
  setTheme?: (theme: 'system' | 'dark' | 'light') => Promise<void>;
  /** pick an old gcBuild folder and copy its userdata/, teams/ and gcsim into the app's data folder */
  importOld: () => Promise<string>;
  openDataFolder: () => Promise<string>;
  updateStatus: () => Promise<UpdateStatus>;
  checkUpdates: () => Promise<UpdateStatus>;
  installUpdate: () => Promise<void>;
  /** closed beta channel (key from the Discord bot's /beta-key) */
  betaGet?: () => Promise<BetaInfo>;
  /** turns beta on (checks the key with the server first) or off; an empty key reuses the saved one */
  betaSet?: (enabled: boolean, key?: string) => Promise<BetaSetResult>;
  /** subscribe to update progress; returns the unsubscribe function */
  onUpdate: (cb: (s: UpdateStatus) => void) => () => void;
}

export const desktop: DesktopBridge | undefined = (globalThis as { gcbuild?: DesktopBridge }).gcbuild;

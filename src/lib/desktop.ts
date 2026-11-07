/** Bridge exposed by the desktop app's preload (electron/preload.cjs); undefined in a normal browser. */
export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'none'; version: string }
  | { state: 'downloading'; version: string; percent: number }
  | { state: 'ready'; version: string }
  | { state: 'error'; message: string }
  | { state: 'dev' };

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
  /** subscribe to update progress; returns the unsubscribe function */
  onUpdate: (cb: (s: UpdateStatus) => void) => () => void;
}

export const desktop: DesktopBridge | undefined = (globalThis as { gcbuild?: DesktopBridge }).gcbuild;

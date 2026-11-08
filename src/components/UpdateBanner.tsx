import { useEffect, useState, type ReactNode } from 'react';
import { t } from '../i18n';
import { desktop, type UpdateStatus } from '../lib/desktop';

let manualAt = 0;

/** "Check for updates" from the menu: its result (none / error) is shown, unlike the silent background checks. */
export function checkForUpdatesNow() {
  manualAt = Date.now();
  void desktop?.checkUpdates();
}

export function useUpdateStatus(): UpdateStatus {
  const [s, setS] = useState<UpdateStatus>({ state: 'idle' });
  useEffect(() => {
    if (!desktop) return;
    void desktop.updateStatus().then(setS);
    return desktop.onUpdate(setS);
  }, []);
  return s;
}

/** Desktop app only: download progress, "Restart to update", and the answer to a manual check. */
export function UpdateBanner({ status, onBeta }: { status: UpdateStatus; onBeta?: () => void }) {
  const [dismissed, setDismissed] = useState('');
  const [, tick] = useState(0);
  const manual = Date.now() - manualAt < 60_000;

  // hide the answer to a manual check after a few seconds
  useEffect(() => {
    if (!manual || (status.state !== 'none' && status.state !== 'error')) return;
    const id = setTimeout(() => { manualAt = 0; tick((n) => n + 1); }, 6000);
    return () => clearTimeout(id);
  }, [status, manual]);

  if (!desktop) return null;
  const key = JSON.stringify(status);
  if (dismissed === key) return null;

  let body: ReactNode = null;
  let tone = '';
  switch (status.state) {
    case 'downloading':
      body = <span>{t('Downloading update {v}… {p}%', { v: status.version, p: status.percent })}</span>;
      break;
    case 'ready':
      tone = 'ready';
      body = (
        <>
          <span>{t('Update {v} is ready.', { v: status.version })}</span>
          <button type="button" className="btn primary small" onClick={() => void desktop!.installUpdate()}>{t('Restart to update')}</button>
          <button type="button" className="btn ghost small" onClick={() => setDismissed(key)}>{t('Later')}</button>
        </>
      );
      break;
    case 'beta-key-rejected':
      // shown even after a background check: the tester would otherwise silently stop getting betas
      tone = 'warn';
      body = (
        <>
          <span>{t('Your beta key is no longer accepted, so beta updates have stopped.')}</span>
          {onBeta && <button type="button" className="btn small" onClick={onBeta}>{t('Beta versions…')}</button>}
          <button type="button" className="btn ghost small" onClick={() => setDismissed(key)}>{t('Later')}</button>
        </>
      );
      break;
    case 'checking':
      if (manual) body = <span>{t('Checking for updates…')}</span>;
      break;
    case 'none':
      if (manual) body = <span>{t('You have the latest version ({v}).', { v: status.version })}</span>;
      break;
    case 'error':
      if (manual) {
        tone = 'warn';
        body = <span>{t('Could not check for updates: {error}', { error: status.message.split('\n')[0].slice(0, 160) })}</span>;
      }
      break;
  }
  if (!body) return null;
  return <div className={`update-banner ${tone}`} role="status">{body}</div>;
}

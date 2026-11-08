import { useEffect, useState } from 'react';
import { t } from '../i18n';
import { desktop, type BetaInfo } from '../lib/desktop';

/**
 * Desktop app only: the closed beta channel. A Beta tester gets a personal key from the gcBuild Discord bot
 * (/beta-key); with it the app updates from the beta feed instead of GitHub. Turning it off goes back to the
 * latest stable version.
 */
export function BetaDialog({ onClose, onChange }: { onClose: () => void; onChange: (enabled: boolean) => void }) {
  const [info, setInfo] = useState<BetaInfo | null>(null);
  const [wantOn, setWantOn] = useState(false);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null);

  useEffect(() => {
    void desktop?.betaGet?.().then((i) => {
      setInfo(i);
      setWantOn(i.enabled);
    });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!desktop?.betaSet || !info) return null;

  const changed = wantOn !== info.enabled || (wantOn && key.trim() !== '');
  const canApply = changed && !busy && (!wantOn || info.hasKey || key.trim() !== '');

  const apply = async () => {
    setMsg(null);
    if (!wantOn && info.enabled && !confirm(t('Go back to the stable version? The app will install the latest stable release, which can be older than this beta. Teams and builds saved by the beta may not open in an older version.'))) return;
    setBusy(true);
    const r = await desktop!.betaSet!(wantOn, key);
    setBusy(false);
    if (!r.ok) {
      setMsg({
        tone: 'warn',
        text:
          r.error === 'invalid-key'
            ? t('The key was not accepted. Get a new one with /beta-key in the gcBuild Discord.')
            : r.error === 'offline'
              ? t('Could not reach the beta server: {error}', { error: (r.message ?? '').slice(0, 160) })
              : t('Beta server error: {error}', { error: r.message ?? '' }),
      });
      return;
    }
    setInfo({ ...info, enabled: wantOn, hasKey: info.hasKey || key.trim() !== '' });
    setKey('');
    onChange(wantOn);
    setMsg({
      tone: 'ok',
      text: !wantOn
        ? t('Beta off. The app will go back to the latest stable version.')
        : 'note' in r && r.note === 'no-beta-yet'
          ? t('Key accepted. There is no beta build yet: the app will update when one comes out.')
          : t('Beta on. The app is downloading the latest beta; "Restart to update" appears when it is ready.'),
    });
  };

  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal narrow beta-dialog" role="dialog" aria-label={t('Beta versions')}>
        <div className="panel-head">
          <h2>{t('Beta versions')}</h2>
          <span className="grow" />
          <button type="button" className="icon-btn" onClick={onClose} title={t('Close')}>✕</button>
        </div>
        <p className="muted small">
          {t('Closed beta for Beta testers in the gcBuild Discord. Get your personal key there with the /beta-key command.')}
        </p>
        <label className="switch">
          <input type="checkbox" checked={wantOn} onChange={(e) => { setWantOn(e.target.checked); setMsg(null); }} />
          <span>{t('Receive beta versions')}</span>
        </label>
        {wantOn && (
          <input
            className="beta-key"
            type="text"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && canApply && void apply()}
            placeholder={info.hasKey ? t('Saved key (paste a new one to replace it)') : 'gcb_…'}
            spellCheck={false}
            autoComplete="off"
            aria-label={t('Beta key')}
          />
        )}
        <div className="beta-actions">
          <button type="button" className="btn primary small" disabled={!canApply} onClick={() => void apply()}>
            {busy ? t('Checking the key…') : t('Apply')}
          </button>
          {info.enabled && <span className="muted small">{t('Now: beta channel')}</span>}
        </div>
        {msg && <div className={`update-banner ${msg.tone === 'ok' ? 'ready' : 'warn'} beta-msg`} role="status">{msg.text}</div>}
      </div>
    </div>
  );
}

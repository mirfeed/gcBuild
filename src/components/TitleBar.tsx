import { t } from '../i18n';
import { APP_VERSION, IS_PRERELEASE } from '../lib/version';

interface Props {
  title: string;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  helpOpen: boolean;
  onHelp: () => void;
  /** opens the beta settings; the badge is shown only in pre-release builds */
  onBeta?: () => void;
}

/** "Beta 0.1.7-beta.1" badge, shown in every pre-release build (nothing in stable versions). */
export function BetaBadge({ onClick }: { onClick?: () => void }) {
  if (!IS_PRERELEASE) return null;
  const title = t('This is a beta version ({v}): it may have bugs. Please report them in #beta on the gcBuild Discord.', { v: APP_VERSION });
  return onClick ? (
    <button type="button" className="beta-badge" onClick={onClick} title={title}>{t('Beta')} {APP_VERSION}</button>
  ) : (
    <span className="beta-badge" title={title}>{t('Beta')} {APP_VERSION}</span>
  );
}

/**
 * Desktop app only: the window's own title bar (the system one is hidden, Windows draws minimize / maximize /
 * close on the right in matching colours). Drag anywhere on it to move the window, double-click to maximize.
 */
export function TitleBar({ title, onUndo, onRedo, canUndo, canRedo, helpOpen, onHelp, onBeta }: Props) {
  return (
    <div className="titlebar">
      <button type="button" className="tb-btn" onClick={onUndo} disabled={!canUndo} title={t('Undo (Ctrl+Z)')} aria-label={t('Undo (Ctrl+Z)')}>←</button>
      <button type="button" className="tb-btn" onClick={onRedo} disabled={!canRedo} title={t('Redo (Ctrl+Y)')} aria-label={t('Redo (Ctrl+Y)')}>→</button>
      <div className="tb-title">
        <span className="tb-logo">⚔</span>
        <span>{title || 'gcBuild'}</span>
      </div>
      <div className="tb-right">
        <BetaBadge onClick={onBeta} />
        <button type="button" className={`tb-btn ${helpOpen ? 'on' : ''}`} onClick={onHelp} title={t('How to use')} aria-label={t('How to use')}>?</button>
      </div>
    </div>
  );
}

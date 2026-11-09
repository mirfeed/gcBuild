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
  /** opens the beta settings; the badge is shown in pre-release builds and to beta testers on a stable one */
  onBeta?: () => void;
  /** the beta channel is on (a tester) */
  betaOn?: boolean;
}

/**
 * The version badge: amber "Beta 0.1.7-beta.1" in every pre-release build, green "Stable 0.1.7" for beta testers who
 * are on a stable build (the beta feed hands out stables too), nothing for everyone else.
 */
export function BetaBadge({ onClick, betaOn }: { onClick?: () => void; betaOn?: boolean }) {
  if (!IS_PRERELEASE && !betaOn) return null;
  const stable = !IS_PRERELEASE;
  const title = stable
    ? t('Stable version {v}. Beta versions are on: the next beta arrives as an update.', { v: APP_VERSION })
    : t('This is a beta version ({v}): it may have bugs. Please report them in #beta on the gcBuild Discord.', { v: APP_VERSION });
  const cls = `beta-badge ${stable ? 'stable' : ''}`;
  const label = `${stable ? t('Stable') : t('Beta')} ${APP_VERSION}`;
  return onClick ? (
    <button type="button" className={cls} onClick={onClick} title={title}>{label}</button>
  ) : (
    <span className={cls} title={title}>{label}</span>
  );
}

/**
 * Desktop app only: the window's own title bar (the system one is hidden, Windows draws minimize / maximize /
 * close on the right in matching colours). Drag anywhere on it to move the window, double-click to maximize.
 */
export function TitleBar({ title, onUndo, onRedo, canUndo, canRedo, helpOpen, onHelp, onBeta, betaOn }: Props) {
  return (
    <div className="titlebar">
      <button type="button" className="tb-btn" onClick={onUndo} disabled={!canUndo} title={t('Undo (Ctrl+Z)')} aria-label={t('Undo (Ctrl+Z)')}>←</button>
      <button type="button" className="tb-btn" onClick={onRedo} disabled={!canRedo} title={t('Redo (Ctrl+Y)')} aria-label={t('Redo (Ctrl+Y)')}>→</button>
      <div className="tb-title">
        <span className="tb-logo">⚔</span>
        <span>{title || 'gcBuild'}</span>
      </div>
      <div className="tb-right">
        <BetaBadge onClick={onBeta} betaOn={betaOn} />
        <button type="button" className={`tb-btn ${helpOpen ? 'on' : ''}`} onClick={onHelp} title={t('How to use')} aria-label={t('How to use')}>?</button>
      </div>
    </div>
  );
}

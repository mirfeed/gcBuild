/**
 * The app version without build metadata: __APP_VERSION__ is "0.1.7-beta.1+abc1234" (or "+abc1234-dirty",
 * "+zip"), so everything after "+" is dropped before looking for a pre-release suffix.
 */
export const APP_VERSION = __APP_VERSION__.split('+')[0];

/** True for any pre-release (0.1.7-beta.1, 0.2.0-rc.1…): every beta build shows the beta badge. */
export const IS_PRERELEASE = APP_VERSION.includes('-');

/** Icons are served by gcsim's public asset API (the same one gcsim.app uses). */
export const ICON_BASE = 'https://gcsim.app/api/assets';

/** `id` is the canonical gcsim character key, e.g. "raidenshogun". */
export const charIcon = (id: string) => `${ICON_BASE}/avatar/${id}.png`;
export const weaponIcon = (key: string) => `${ICON_BASE}/weapons/${key}.png`;
export const setIcon = (key: string) => `${ICON_BASE}/artifacts/${key}_flower.png`;

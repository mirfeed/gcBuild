import type { ActionType, CharData, FrameSlice, WeaponType } from './types';

/** Rough fallback frames when gcsim's data couldn't be extracted for a character. */
const GENERIC: Record<WeaponType, { attack: FrameSlice[]; charge: FrameSlice; aim: FrameSlice }> = {
  sword: {
    attack: Array.from({ length: 5 }, () => ({ _: 30, attack: 24, swap: 14, skill: 14, burst: 14, dash: 14, jump: 14 })),
    charge: { _: 50, swap: 40 },
    aim: { _: 50 },
  },
  claymore: {
    attack: Array.from({ length: 4 }, () => ({ _: 55, attack: 45, swap: 30, skill: 30, burst: 30, dash: 30, jump: 30 })),
    charge: { _: 60, swap: 50 },
    aim: { _: 60 },
  },
  polearm: {
    attack: Array.from({ length: 6 }, () => ({ _: 26, attack: 20, swap: 13, skill: 13, burst: 13, dash: 13, jump: 13 })),
    charge: { _: 45, swap: 35 },
    aim: { _: 45 },
  },
  bow: {
    attack: Array.from({ length: 6 }, () => ({ _: 26, attack: 20, swap: 13, skill: 13, burst: 13, dash: 13, jump: 13 })),
    charge: { _: 94 },
    aim: { _: 94 },
  },
  catalyst: {
    attack: Array.from({ length: 4 }, () => ({ _: 40, attack: 30, swap: 20, skill: 20, burst: 20, dash: 20, jump: 20 })),
    charge: { _: 60, swap: 50 },
    aim: { _: 60 },
  },
};

const GENERIC_SKILL: FrameSlice = { _: 40, swap: 35 };
const GENERIC_BURST: FrameSlice = { _: 100, swap: 95 };
const GENERIC_DASH: FrameSlice = { _: 21 };
const GENERIC_JUMP: FrameSlice = { _: 30 };
const GENERIC_PLUNGE: FrameSlice = { _: 50 };

export interface FrameState {
  /** frame table base name overrides while in a state, e.g. Raiden's burst */
  attack?: string;
  charge?: string;
}

function pick(char: CharData, keys: string[]): FrameSlice | undefined {
  for (const k of keys) {
    const f = char.frames[k];
    if (f) return f;
  }
  return undefined;
}

/** Number of normal attack hits in the chain. */
export function attackHitCount(char: CharData, state?: FrameState): number {
  const base = state?.attack ?? 'attackFrames';
  let n = 0;
  while (char.frames[`${base}[${n}]`] || char.frames[`${base}[0][${n}]`]) n++;
  if (n === 0 && state?.attack) return attackHitCount(char);
  return n || GENERIC[char.weapon].attack.length;
}

export function frameSlice(
  char: CharData,
  action: ActionType,
  params: Record<string, number>,
  counter: number,
  state?: FrameState,
): { slice: FrameSlice; generic: boolean } {
  const hold = params.hold ?? 0;
  let f: FrameSlice | undefined;
  switch (action) {
    case 'attack': {
      const base = state?.attack ?? 'attackFrames';
      f = pick(char, [`${base}[${counter}]`, `${base}[0][${counter}]`, `attackFrames[${counter}]`, `attackFrames[0][${counter}]`]);
      if (!f) return { slice: GENERIC[char.weapon].attack[counter % GENERIC[char.weapon].attack.length], generic: true };
      break;
    }
    case 'charge': {
      const base = state?.charge ?? 'chargeFrames';
      f = pick(char, [base, `${base}[0]`, 'chargeFrames', 'chargeFrames[0]']);
      if (!f) return { slice: GENERIC[char.weapon].charge, generic: true };
      break;
    }
    case 'aim': {
      const idx = params.hold ?? (char.key === 'ganyu' ? 2 : 1);
      f = pick(char, [`aimedFrames[${idx}]`, 'aimedFrames[1]', 'aimedFrames[0]', 'aimedFrames']);
      if (!f) return { slice: GENERIC[char.weapon].aim, generic: true };
      break;
    }
    case 'skill':
      f = hold > 0
        ? pick(char, ['skillHoldFrames', 'skillHoldFrames[0]', `skillFrames[${hold}]`, 'skillFrames[1]', 'skillFrames', 'skillFrames[0]'])
        : pick(char, ['skillPressFrames', 'skillPressFrames[0]', 'skillTapFrames', 'skillFrames', 'skillFrames[0]']);
      if (!f) return { slice: GENERIC_SKILL, generic: true };
      break;
    case 'burst':
      f = pick(char, ['burstFrames', 'burstFrames[0]']);
      if (!f) return { slice: GENERIC_BURST, generic: true };
      break;
    case 'high_plunge':
      f = pick(char, ['highPlungeFrames', 'highPlungeFrames[0]']);
      if (!f) return { slice: GENERIC_PLUNGE, generic: true };
      break;
    case 'low_plunge':
      f = pick(char, ['lowPlungeFrames', 'lowPlungeFrames[0]']);
      if (!f) return { slice: GENERIC_PLUNGE, generic: true };
      break;
    case 'dash':
      f = pick(char, ['dashFrames']);
      if (!f) return { slice: GENERIC_DASH, generic: true };
      break;
    case 'jump':
      f = pick(char, ['jumpFrames']);
      if (!f) return { slice: GENERIC_JUMP, generic: true };
      break;
    case 'walk':
      return { slice: { _: params.f ?? 1 }, generic: false };
    case 'swap':
      return { slice: { _: 1 }, generic: false };
  }
  return { slice: f!, generic: false };
}

/** Frames until the next action can start. */
export function framesUntil(slice: FrameSlice, next: ActionType | null): number {
  if (!next) return slice._;
  return slice[next] ?? slice._;
}

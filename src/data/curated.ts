/**
 * Hand-curated rotation helper data: effect durations, buffs and KQMS presets.
 * Everything here is an approximation meant for planning; gcsim itself is the
 * source of truth when the config runs. Durations are in seconds.
 *
 * Characters without an entry here fall back to statuses extracted from the
 * gcsim source (see scripts/extract_gcsim.py).
 */
import type { ActionType, FrameSlice, Profile, Stat } from '../lib/types';

export type Trigger = 'skill' | 'skillPress' | 'skillHold' | 'burst' | 'attack' | 'charge' | 'plunge' | 'swapOut';

export type EffectKind = 'field' | 'buff' | 'debuff' | 'shield' | 'state' | 'summon' | 'cd';

export interface EffectDef {
  label: string;
  on: Trigger | Trigger[];
  dur: number;
  /** seconds from the start of the action until the effect starts */
  delay?: number;
  /** shown on the team lane (affects the party / enemy) */
  team?: boolean;
  kind?: EffectKind;
  minCons?: number;
  /** duration overrides by constellation: [cons, duration] */
  cons?: [number, number][];
  /** cannot retrigger while within this many seconds of the last trigger */
  icd?: number;
  note?: string;
}

export interface CharMeta {
  /** cooldown overrides (seconds) when the extracted value is missing / ambiguous */
  skillCD?: number;
  skillHoldCD?: number;
  burstCD?: number;
  /** extra quick buttons for the skill, e.g. Bennett hold levels */
  skillVariants?: { label: string; params: Record<string, number> }[];
  effects?: EffectDef[];
  /** fixed frame tables for actions gcsim times dynamically (e.g. Neuvillette's CA) */
  frames?: Partial<Record<ActionType, FrameSlice>>;
  /** frame-table overrides while an effect (by label) is active on this character */
  states?: { effect: string; attack?: string; charge?: string }[];
  kqms?: Partial<{ sands: Stat; goblet: Stat; circlet: Stat; er: number; profile: Profile }>;
}

const ATK: Profile = { stat: 'atk', crit: true, amp: false };
const ATK_AMP: Profile = { stat: 'atk', crit: true, amp: true };
const HP: Profile = { stat: 'hp', crit: true, amp: false };
const DEF: Profile = { stat: 'def', crit: true, amp: false };
const EM: Profile = { stat: 'em', crit: false, amp: false };
const HP_SUPPORT: Profile = { stat: 'hp', crit: false, amp: false };
const DEF_SUPPORT: Profile = { stat: 'def', crit: false, amp: false };

export const CHAR_META: Record<string, CharMeta> = {
  // ---------------------------------------------------------------- pyro
  bennett: {
    skillCD: 5,
    skillVariants: [{ label: 'E hold 1', params: { hold: 1 } }, { label: 'E hold 2', params: { hold: 2 } }],
    effects: [{ label: 'Inspiration Field', on: 'burst', dur: 12, delay: 0.6, team: true, kind: 'field' }],
    kqms: { sands: 'er', goblet: 'pyro%', circlet: 'cr', er: 2.0, profile: ATK },
  },
  xiangling: {
    effects: [
      { label: 'Guoba', on: 'skill', dur: 7.3, delay: 0.22, kind: 'summon' },
      { label: 'Pyronado', on: 'burst', dur: 10, delay: 0.93, kind: 'summon', cons: [[4, 14]] },
      { label: 'C6 Pyro DMG +15%', on: 'burst', dur: 10, delay: 0.93, team: true, minCons: 6, cons: [[4, 14]] },
    ],
    kqms: { er: 1.8, profile: ATK_AMP },
  },
  hutao: {
    effects: [{ label: 'Paramita Papilio', on: 'skill', dur: 9, delay: 0.5, kind: 'state' }],
    states: [{ effect: 'Paramita Papilio', attack: 'ppAttackFrames', charge: 'ppChargeFrames' }],
    kqms: { goblet: 'pyro%', er: 1.0, profile: { stat: 'atk', crit: true, amp: true, hpToAtk: 0.0626 } },
  },
  yoimiya: {
    effects: [
      { label: 'Niwabi Enshou', on: 'skill', dur: 10, kind: 'state' },
      { label: 'Aurous Blaze', on: 'burst', dur: 10, delay: 1.2, kind: 'debuff' },
      { label: "Summer Night's Dawn (ATK)", on: 'burst', dur: 15, delay: 1.2, team: true, kind: 'buff' },
    ],
    kqms: { er: 1.1, profile: ATK },
  },
  diluc: {
    effects: [{ label: 'Dawn Pyro Infusion', on: 'burst', dur: 12, delay: 1.0, kind: 'state' }],
    kqms: { er: 1.2, profile: ATK },
  },
  klee: {
    effects: [{ label: "Sparks 'n' Splash", on: 'burst', dur: 10, delay: 0.5, kind: 'field' }],
    kqms: { er: 1.2, profile: ATK },
  },
  thoma: {
    effects: [
      { label: 'Blazing Barrier', on: 'skill', dur: 8, team: true, kind: 'shield' },
      { label: 'Scorching Ooyoroi', on: 'burst', dur: 15, delay: 0.7, team: true, kind: 'field' },
    ],
    kqms: { sands: 'hp%', goblet: 'hp%', circlet: 'hp%', er: 2.0, profile: HP_SUPPORT },
  },
  yanfei: { effects: [{ label: 'Brilliance', on: 'burst', dur: 15, delay: 0.6, kind: 'state' }], kqms: { profile: ATK } },
  dehya: {
    effects: [
      { label: 'Fiery Sanctum', on: 'skill', dur: 12, delay: 0.3, team: true, kind: 'field' },
      { label: 'Flame-Mane', on: 'burst', dur: 4, delay: 0.5, kind: 'state' },
    ],
    kqms: { profile: ATK },
  },
  xinyan: { effects: [{ label: 'Shield', on: 'skill', dur: 12, team: true, kind: 'shield' }], kqms: { profile: ATK } },
  amber: {
    effects: [
      { label: 'Baron Bunny', on: 'skill', dur: 8.2, kind: 'summon' },
      { label: 'Fiery Rain', on: 'burst', dur: 2, delay: 0.6, kind: 'field' },
    ],
  },
  chevreuse: {
    effects: [{ label: 'Vertical Force Coordination (ATK)', on: 'skill', dur: 30, team: true, kind: 'buff', note: 'A4, after the Overcharged Ball' }],
    kqms: { sands: 'hp%', goblet: 'hp%', circlet: 'hp%', er: 1.6, profile: HP_SUPPORT },
  },
  arlecchino: {
    effects: [{ label: 'Blood-Debt Directive', on: 'skill', dur: 30, delay: 0.3, team: true, kind: 'debuff' }],
    kqms: { er: 1.0, profile: ATK },
  },

  // ---------------------------------------------------------------- hydro
  xingqiu: {
    effects: [
      { label: 'Rain Swords', on: 'skill', dur: 15, delay: 0.5, kind: 'shield' },
      { label: 'Raincutter', on: 'burst', dur: 15, delay: 0.3, team: true, kind: 'state', cons: [[2, 18]] },
    ],
    kqms: { er: 1.8, profile: ATK },
  },
  yelan: {
    effects: [
      { label: 'Exquisite Throw', on: 'burst', dur: 15, delay: 1.0, team: true, kind: 'state' },
      { label: 'Adapt With Ease (DMG%)', on: 'burst', dur: 15, delay: 1.0, team: true, kind: 'buff' },
    ],
    kqms: { er: 1.6, profile: HP },
  },
  furina: {
    effects: [
      { label: 'Salon Members', on: 'skill', dur: 30, delay: 0.3, kind: 'summon' },
      { label: 'Universal Revelry', on: 'burst', dur: 18, delay: 1.6, team: true, kind: 'buff' },
    ],
    kqms: { er: 1.6, profile: HP },
  },
  kokomi: {
    effects: [
      { label: 'Bake-Kurage', on: 'skill', dur: 12, delay: 0.4, kind: 'summon' },
      { label: 'Ceremonial Garment', on: 'burst', dur: 10, delay: 1.3, kind: 'state' },
    ],
    kqms: { sands: 'hp%', goblet: 'hydro%', circlet: 'heal', er: 1.3, profile: HP_SUPPORT },
  },
  nilou: {
    effects: [
      { label: 'Pirouette', on: 'skill', dur: 8, kind: 'state' },
      { label: "Golden Chalice's Bounty", on: 'skill', dur: 30, team: true, kind: 'buff' },
    ],
    kqms: { sands: 'hp%', goblet: 'hp%', circlet: 'hp%', er: 1.1, profile: HP_SUPPORT },
  },
  ayato: {
    effects: [
      { label: 'Takimoto Flurry', on: 'skill', dur: 6, kind: 'state' },
      { label: 'Suiyuan Field', on: 'burst', dur: 18, delay: 1.5, team: true, kind: 'field' },
    ],
    kqms: { er: 1.3, profile: ATK },
  },
  mona: {
    effects: [
      { label: 'Phantom', on: 'skill', dur: 5, kind: 'summon' },
      { label: 'Illusory Bubble', on: 'burst', dur: 8, delay: 1.7, team: true, kind: 'debuff' },
    ],
    kqms: { er: 1.8, profile: ATK },
  },
  candace: {
    effects: [{ label: 'Prayer of the Crimson Crown', on: 'burst', dur: 9, delay: 0.9, team: true, kind: 'buff' }],
    kqms: { sands: 'hp%', goblet: 'hp%', circlet: 'hp%', er: 1.8, profile: HP_SUPPORT },
  },
  barbara: { effects: [{ label: 'Melody Loop', on: 'skill', dur: 15, team: true, kind: 'field' }], kqms: { profile: HP_SUPPORT } },
  neuvillette: {
    // Equitable Judgment: windup + legal evaluation (shortened by droplets) + ~2.9s beam
    frames: { charge: { _: 330, skill: 300, burst: 300, dash: 300, jump: 300, swap: 320 } },
    kqms: { sands: 'hp%', goblet: 'hydro%', er: 1.2, profile: HP },
  },

  // ---------------------------------------------------------------- electro
  raiden: {
    effects: [
      { label: 'Eye of Stormy Judgment', on: 'skill', dur: 25, delay: 0.85, team: true, kind: 'buff' },
      { label: 'Musou Isshin', on: 'burst', dur: 7, delay: 1.63, kind: 'state' },
    ],
    states: [{ effect: 'Musou Isshin', attack: 'swordFrames', charge: 'swordCAFrames' }],
    kqms: { sands: 'er', goblet: 'electro%', er: 2.5, profile: ATK },
  },
  fischl: {
    effects: [
      { label: 'Oz (E)', on: 'skill', dur: 10, delay: 0.3, kind: 'summon', cons: [[6, 12]] },
      { label: 'Oz (Q)', on: 'burst', dur: 10, delay: 0.3, kind: 'summon', cons: [[6, 12]] },
    ],
    kqms: { er: 1.2, profile: ATK },
  },
  beidou: {
    effects: [{ label: 'Stormbreaker', on: 'burst', dur: 15, delay: 0.4, team: true, kind: 'state' }],
    kqms: { er: 1.8, profile: ATK },
  },
  kuki: {
    effects: [{ label: 'Grass Ring of Sanctification', on: 'skill', dur: 12, delay: 0.4, team: true, kind: 'field', cons: [[2, 15]] }],
    kqms: { sands: 'em', goblet: 'em', circlet: 'em', er: 1.3, profile: EM },
  },
  yaemiko: {
    effects: [{ label: 'Sesshou Sakura', on: 'skill', dur: 14, delay: 0.5, kind: 'summon' }],
    kqms: { er: 1.3, profile: ATK },
  },
  lisa: {
    effects: [
      { label: 'Lightning Rose', on: 'burst', dur: 15, delay: 0.9, kind: 'summon' },
      { label: 'Static Electricity (DEF -15%)', on: 'burst', dur: 10, delay: 1.0, team: true, kind: 'debuff' },
    ],
  },
  keqing: {
    effects: [
      { label: 'Lightning Stiletto', on: 'skill', dur: 5, delay: 0.3, kind: 'summon' },
      { label: 'Aristocratic Dignity (CR/ER)', on: 'burst', dur: 8, kind: 'buff' },
    ],
    kqms: { er: 1.1, profile: ATK },
  },
  sara: {
    effects: [{ label: 'Tengu Juurai (ATK)', on: 'skill', dur: 6, delay: 0.85, team: true, kind: 'buff' }],
    kqms: { er: 2.0, profile: ATK },
  },
  dori: { effects: [{ label: 'Jinni', on: 'burst', dur: 12, delay: 0.6, team: true, kind: 'summon' }], kqms: { er: 2.0, profile: HP_SUPPORT } },
  razor: {
    effects: [{ label: 'Lightning Fang', on: 'burst', dur: 15, delay: 0.5, kind: 'state' }],
    kqms: { goblet: 'phys%', er: 1.2, profile: ATK },
  },

  // ---------------------------------------------------------------- cryo
  ayaka: {
    effects: [
      { label: 'Soumetsu', on: 'burst', dur: 5, delay: 1.7, kind: 'field' },
      { label: 'Amatsumi Kunitsumi (NA/CA +30%)', on: 'skill', dur: 6, kind: 'buff' },
    ],
    kqms: { er: 1.3, profile: ATK },
  },
  ganyu: {
    effects: [
      { label: 'Ice Lotus', on: 'skill', dur: 6, kind: 'summon' },
      { label: 'Celestial Shower', on: 'burst', dur: 15, delay: 2.0, team: true, kind: 'field' },
    ],
    kqms: { er: 1.1, profile: ATK },
  },
  shenhe: {
    skillHoldCD: 15,
    effects: [
      { label: 'Icy Quill', on: 'skill', dur: 10, delay: 0.3, team: true, kind: 'buff' },
      { label: 'Spring Spirit (E/Q DMG)', on: 'skillPress', dur: 10, team: true, kind: 'buff' },
      { label: 'Spring Spirit (NA/CA DMG)', on: 'skillHold', dur: 15, team: true, kind: 'buff' },
      { label: "Divine Maiden's Deliverance", on: 'burst', dur: 12, delay: 1.0, team: true, kind: 'field', cons: [[2, 18]] },
    ],
    kqms: { sands: 'atk%', goblet: 'atk%', circlet: 'atk%', er: 1.6, profile: { stat: 'atk', crit: false, amp: false } },
  },
  rosaria: {
    effects: [
      { label: 'Rites of Termination', on: 'burst', dur: 8, delay: 0.7, kind: 'summon', cons: [[2, 12]] },
      { label: 'Shadow Samaritan (team CR)', on: 'burst', dur: 10, delay: 0.7, team: true, kind: 'buff' },
    ],
    kqms: { er: 1.4, profile: ATK },
  },
  diona: {
    effects: [
      { label: 'Icy Paws Shield', on: 'skill', dur: 12, delay: 0.5, team: true, kind: 'shield' },
      { label: 'Signature Mix', on: 'burst', dur: 12, delay: 0.7, team: true, kind: 'field' },
    ],
    kqms: { sands: 'hp%', goblet: 'hp%', circlet: 'hp%', er: 1.8, profile: HP_SUPPORT },
  },
  layla: {
    effects: [
      { label: 'Curtain of Slumber', on: 'skill', dur: 12, delay: 0.3, team: true, kind: 'shield' },
      { label: 'Starlight Slug', on: 'burst', dur: 12, delay: 0.6, kind: 'summon' },
    ],
    kqms: { sands: 'hp%', goblet: 'hp%', circlet: 'hp%', er: 1.6, profile: HP_SUPPORT },
  },
  eula: {
    effects: [
      { label: 'Lightfall Sword', on: 'burst', dur: 7, delay: 1.7, kind: 'summon' },
      { label: 'Icewhirl Brand (RES shred)', on: 'skillHold', dur: 7, delay: 0.8, team: true, kind: 'debuff' },
    ],
    kqms: { goblet: 'phys%', er: 1.2, profile: ATK },
  },
  chongyun: { effects: [{ label: 'Spirit Blade Field', on: 'skill', dur: 10, delay: 0.5, team: true, kind: 'field' }], kqms: { profile: ATK } },
  kaeya: { effects: [{ label: 'Glacial Waltz', on: 'burst', dur: 8, delay: 0.9, kind: 'summon' }], kqms: { er: 1.6, profile: ATK } },
  qiqi: { effects: [{ label: 'Herald of Frost', on: 'skill', dur: 15, delay: 0.5, kind: 'summon' }] },
  mika: {
    effects: [
      { label: 'Soulwind (ATK SPD)', on: 'skill', dur: 12, delay: 0.6, team: true, kind: 'buff' },
      { label: 'Eagleplume', on: 'burst', dur: 15, delay: 0.7, team: true, kind: 'field' },
    ],
    kqms: { sands: 'hp%', goblet: 'hp%', circlet: 'hp%', er: 1.8, profile: HP_SUPPORT },
  },

  // ---------------------------------------------------------------- anemo
  kazuha: {
    skillHoldCD: 9,
    effects: [
      { label: 'Autumn Whirlwind', on: 'burst', dur: 9, delay: 1.5, team: true, kind: 'field' },
      { label: 'Poetics of Fuubutsu (DMG%)', on: ['skill', 'burst'], dur: 8, delay: 0.5, team: true, kind: 'buff', note: 'A4, on swirl' },
    ],
    kqms: { sands: 'em', goblet: 'em', circlet: 'em', er: 1.6, profile: EM },
  },
  sucrose: {
    effects: [
      { label: 'Large Wind Spirit', on: 'burst', dur: 6, delay: 0.7, kind: 'summon', cons: [[2, 8]] },
      { label: 'Mollis Favonius (EM share)', on: ['skill', 'burst'], dur: 8, delay: 0.5, team: true, kind: 'buff' },
    ],
    kqms: { sands: 'em', goblet: 'em', circlet: 'em', er: 1.4, profile: EM },
  },
  venti: {
    skillHoldCD: 15,
    effects: [{ label: 'Stormeye', on: 'burst', dur: 8, delay: 1.5, team: true, kind: 'summon' }],
    kqms: { sands: 'em', goblet: 'em', circlet: 'em', er: 1.6, profile: EM },
  },
  jean: { effects: [{ label: 'Dandelion Field', on: 'burst', dur: 10.5, delay: 0.7, team: true, kind: 'field' }], kqms: { er: 1.8, profile: ATK } },
  xiao: {
    effects: [{ label: "Bane of All Evil (Yaksha's Mask)", on: 'burst', dur: 15, delay: 1.0, kind: 'state' }],
    kqms: { er: 1.3, profile: ATK },
  },
  faruzan: {
    effects: [{ label: "Prayerful Wind's Benefit", on: 'burst', dur: 12, delay: 0.8, team: true, kind: 'field' }],
    kqms: { sands: 'er', er: 2.4, profile: ATK },
  },
  lynette: { effects: [{ label: 'Bogglecat Box', on: 'burst', dur: 12, delay: 0.6, kind: 'summon' }], kqms: { er: 1.6, profile: ATK } },

  // ---------------------------------------------------------------- dendro
  nahida: {
    effects: [
      { label: 'Seed of Skandha', on: 'skill', dur: 25, delay: 0.3, team: true, kind: 'debuff' },
      { label: 'Shrine of Maya', on: 'burst', dur: 15, delay: 1.0, team: true, kind: 'field' },
    ],
    kqms: { sands: 'em', goblet: 'dendro%', circlet: 'cr', er: 1.2, profile: { stat: 'atk', crit: true, amp: false, emWeight: 2 } },
  },
  collei: { effects: [{ label: 'Cuilein-Anbar', on: 'burst', dur: 6, delay: 0.9, kind: 'summon' }], kqms: { er: 1.6, profile: ATK } },
  yaoyao: {
    effects: [
      { label: 'Yuegui', on: 'skill', dur: 10, delay: 0.5, kind: 'summon' },
      { label: 'Adeptal Legacy', on: 'burst', dur: 5, delay: 0.6, kind: 'state' },
    ],
    kqms: { sands: 'hp%', goblet: 'hp%', circlet: 'heal', er: 1.6, profile: HP_SUPPORT },
  },
  baizhu: {
    effects: [{ label: 'Holistic Revivification', on: 'burst', dur: 14, delay: 0.9, team: true, kind: 'shield' }],
    kqms: { sands: 'hp%', goblet: 'hp%', circlet: 'heal', er: 1.6, profile: HP_SUPPORT },
  },
  kaveh: { effects: [{ label: 'Painted Dome', on: 'burst', dur: 12, delay: 0.8, kind: 'state' }], kqms: { sands: 'em', goblet: 'em', circlet: 'em', profile: EM } },
  kirara: {
    effects: [{ label: 'Shield of Safe Transport', on: 'skill', dur: 12, delay: 0.5, team: true, kind: 'shield' }],
    kqms: { sands: 'hp%', goblet: 'hp%', circlet: 'hp%', er: 1.6, profile: HP_SUPPORT },
  },
  emilie: { effects: [{ label: 'Lumidouce Case', on: 'skill', dur: 22, delay: 0.5, kind: 'summon' }], kqms: { er: 1.3, profile: ATK } },
  tighnari: { kqms: { er: 1.1, profile: ATK } },
  alhaitham: { kqms: { er: 1.2, profile: { stat: 'atk', crit: true, amp: false, emWeight: 0.8 } } },

  // ---------------------------------------------------------------- geo
  zhongli: {
    skillCD: 4,
    skillHoldCD: 12,
    effects: [
      { label: 'Stone Stele', on: 'skill', dur: 30, delay: 0.5, kind: 'summon' },
      { label: 'Jade Shield (RES -20%)', on: 'skillHold', dur: 20, delay: 0.8, team: true, kind: 'shield' },
    ],
    kqms: { sands: 'hp%', goblet: 'geo%', er: 1.3, profile: HP },
  },
  albedo: {
    effects: [
      { label: 'Solar Isotoma', on: 'skill', dur: 30, delay: 0.4, team: true, kind: 'field' },
      { label: 'Homuncular Nature (EM +125)', on: 'burst', dur: 10, delay: 1.3, team: true, kind: 'buff' },
    ],
    kqms: { sands: 'def%', goblet: 'geo%', er: 1.2, profile: DEF },
  },
  itto: {
    effects: [{ label: 'Raging Oni King', on: 'burst', dur: 11, delay: 0.9, kind: 'state' }],
    kqms: { sands: 'def%', goblet: 'geo%', er: 1.4, profile: DEF },
  },
  noelle: {
    effects: [
      { label: 'Breastplate', on: 'skill', dur: 12, delay: 0.3, team: true, kind: 'shield' },
      { label: 'Sweeping Time', on: 'burst', dur: 15, delay: 1.0, kind: 'state' },
    ],
    kqms: { sands: 'def%', goblet: 'geo%', er: 1.3, profile: DEF },
  },
  gorou: {
    effects: [
      { label: "General's War Banner", on: 'skill', dur: 10, delay: 0.3, team: true, kind: 'field' },
      { label: 'Juuga: Forward Unto Victory', on: 'burst', dur: 9, delay: 0.6, team: true, kind: 'field' },
      { label: 'Heedless of the Wind (DEF +25%)', on: 'burst', dur: 12, delay: 0.6, team: true, kind: 'buff' },
    ],
    kqms: { sands: 'er', goblet: 'def%', circlet: 'def%', er: 2.0, profile: DEF_SUPPORT },
  },
  yunjin: {
    effects: [{ label: 'Flying Cloud Flag Formation', on: 'burst', dur: 12, delay: 0.9, team: true, kind: 'buff' }],
    kqms: { sands: 'er', goblet: 'def%', circlet: 'def%', er: 1.8, profile: DEF_SUPPORT },
  },
  chiori: { effects: [{ label: 'Tamoto', on: 'skill', dur: 17, delay: 0.7, kind: 'summon' }], kqms: { sands: 'def%', goblet: 'geo%', er: 1.2, profile: DEF } },
  navia: { kqms: { goblet: 'geo%', er: 1.2, profile: ATK } },
  xilonen: { kqms: { sands: 'def%', goblet: 'def%', circlet: 'def%', er: 1.4, profile: DEF_SUPPORT } },
};

/** Weapon effects that matter for timing. Keyed by weapon key. */
export const WEAPON_EFFECTS: Record<string, EffectDef[]> = {
  thrillingtalesofdragonslayers: [{ label: 'TTDS (+48% ATK, next char)', on: 'swapOut', dur: 10, team: true, kind: 'buff', icd: 20 }],
  engulfinglightning: [{ label: 'Engulfing (+30% ER)', on: 'burst', dur: 12, kind: 'buff' }],
  mistsplitterreforged: [{ label: "Mistsplitter's Emblem", on: 'burst', dur: 10, kind: 'buff' }],
  kagurasverity: [{ label: 'Kagura Dance stack', on: 'skill', dur: 16, kind: 'buff' }],
  calamityqueller: [{ label: 'Consummation', on: 'skill', dur: 20, kind: 'buff' }],
  keyofkhajnisut: [{ label: 'Grand Hymn', on: 'skill', dur: 20, kind: 'buff' }],
  tulaytullahsremembrance: [{ label: 'Tulaytullah stacks', on: 'skill', dur: 14, kind: 'buff' }],
  everlastingmoonglow: [{ label: 'Everlasting Moonglow (NA)', on: 'burst', dur: 12, kind: 'buff' }],
  skywardblade: [{ label: 'Skyward Blade (ATK SPD)', on: 'burst', dur: 12, kind: 'buff' }],
  windblumeode: [{ label: 'Windblume (ATK)', on: 'skill', dur: 6, kind: 'buff' }],
  favoniussword: [{ label: 'Favonius ICD', on: ['skill', 'burst'], dur: 12, kind: 'cd', icd: 12 }],
  favoniuslance: [{ label: 'Favonius ICD', on: ['skill', 'burst'], dur: 12, kind: 'cd', icd: 12 }],
  favoniusgreatsword: [{ label: 'Favonius ICD', on: ['skill', 'burst'], dur: 12, kind: 'cd', icd: 12 }],
  favoniuswarbow: [{ label: 'Favonius ICD', on: ['skill', 'burst'], dur: 12, kind: 'cd', icd: 12 }],
  favoniuscodex: [{ label: 'Favonius ICD', on: ['skill', 'burst'], dur: 12, kind: 'cd', icd: 12 }],
};

/** Sacrificial reset cooldown by refine. */
export const SACRIFICIAL_CD = [30, 26, 22, 19, 16];

/** 4-piece set effects that matter for timing. Keyed by set key. */
export const SET_EFFECTS: Record<string, EffectDef[]> = {
  noblesseoblige: [{ label: 'Noblesse (+20% ATK)', on: 'burst', dur: 12, team: true, kind: 'buff' }],
  viridescentvenerer: [{ label: 'VV shred (~swirl)', on: ['skill', 'burst'], dur: 10, delay: 0.5, team: true, kind: 'debuff' }],
  instructor: [{ label: 'Instructor (+120 EM, ~reaction)', on: ['skill', 'burst'], dur: 8, delay: 0.5, team: true, kind: 'buff' }],
  deepwoodmemories: [{ label: 'Deepwood (Dendro RES -30%)', on: ['skill', 'burst'], dur: 8, delay: 0.5, team: true, kind: 'debuff' }],
  tenacityofthemillelith: [{ label: 'Millelith (+20% ATK)', on: 'skill', dur: 3, delay: 0.3, team: true, kind: 'buff' }],
  archaicpetra: [{ label: 'Petra (+35% ele DMG, ~crystallize)', on: ['skill', 'burst'], dur: 10, delay: 0.5, team: true, kind: 'buff' }],
  scrolloftheheroofcindercity: [{ label: 'Cinder City (ele DMG, ~reaction)', on: ['skill', 'burst'], dur: 15, delay: 0.5, team: true, kind: 'buff' }],
  shimenawasreminiscence: [{ label: 'Shimenawa (+50% NA/CA)', on: 'skill', dur: 10, kind: 'buff' }],
  crimsonwitchofflames: [{ label: 'Crimson Witch stack', on: 'skill', dur: 10, kind: 'buff' }],
  heartofdepth: [{ label: 'Heart of Depth (+30% NA/CA)', on: 'skill', dur: 15, kind: 'buff' }],
  vermillionhereafter: [{ label: 'Vermillion (ATK)', on: 'burst', dur: 16, kind: 'buff' }],
  paleflame: [{ label: 'Pale Flame stack', on: 'skill', dur: 7, kind: 'buff' }],
  gildeddreams: [{ label: 'Gilded Dreams (~reaction)', on: ['skill', 'burst'], dur: 8, delay: 0.5, kind: 'buff' }],
  desertpavilionchronicle: [{ label: 'Desert Pavilion (NA)', on: 'charge', dur: 15, kind: 'buff' }],
  vourukashasglow: [{ label: 'Vourukasha stack', on: ['skill', 'burst'], dur: 5, kind: 'buff' }],
};

/** Flat stat bonuses from sets, used by the KQMS allocator (conditional ones assumed active). */
export const SET_STATS: Record<string, { 2?: Partial<Record<Stat, number>>; 4?: Partial<Record<Stat, number>> }> = {
  gladiatorsfinale: { 2: { 'atk%': 0.18 } },
  shimenawasreminiscence: { 2: { 'atk%': 0.18 } },
  vermillionhereafter: { 2: { 'atk%': 0.18 }, 4: { 'atk%': 0.4 } },
  echoesofanoffering: { 2: { 'atk%': 0.18 } },
  nighttimewhispersintheechoingwoods: { 2: { 'atk%': 0.18 } },
  fragmentofharmonicwhimsy: { 2: { 'atk%': 0.18 } },
  unfinishedreverie: { 2: { 'atk%': 0.18 } },
  emblemofseveredfate: { 2: { er: 0.2 } },
  scholar: { 2: { er: 0.2 } },
  tenacityofthemillelith: { 2: { 'hp%': 0.2 } },
  vourukashasglow: { 2: { 'hp%': 0.2 } },
  huskofopulentdreams: { 2: { 'def%': 0.3 } },
  wandererstroupe: { 2: { em: 80 } },
  instructor: { 2: { em: 80 } },
  gildeddreams: { 2: { em: 80 } },
  flowerofparadiselost: { 2: { em: 80 } },
  berserker: { 2: { cr: 0.12 } },
  marechausseehunter: { 4: { cr: 0.36 } },
  blizzardstrayer: { 4: { cr: 0.2 } },
  noblesseoblige: { 4: { 'atk%': 0.2 } },
};

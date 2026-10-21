/**
 * Enka.Network import: showcase characters (and builds saved on a linked Enka
 * profile) become builds in artifacts mode, plus their artifacts for the
 * inventory. Mirrors gcsim's EnkaToGOOD conversion.
 */
import { artifactMain, characters, sets, weapons } from '../data';
import { createBuild, uid } from './project';
import { SLOTS, type Artifact, type CharBuild, type Slot, type Stat } from './types';

/** Enka fight prop -> [GOOD key (main stat table), gcsim stat] */
const PROP: Record<string, [string, Stat]> = {
  FIGHT_PROP_HP: ['hp', 'hp'],
  FIGHT_PROP_HP_PERCENT: ['hp_', 'hp%'],
  FIGHT_PROP_ATTACK: ['atk', 'atk'],
  FIGHT_PROP_ATTACK_PERCENT: ['atk_', 'atk%'],
  FIGHT_PROP_DEFENSE: ['def', 'def'],
  FIGHT_PROP_DEFENSE_PERCENT: ['def_', 'def%'],
  FIGHT_PROP_ELEMENT_MASTERY: ['eleMas', 'em'],
  FIGHT_PROP_CHARGE_EFFICIENCY: ['enerRech_', 'er'],
  FIGHT_PROP_CRITICAL: ['critRate_', 'cr'],
  FIGHT_PROP_CRITICAL_HURT: ['critDMG_', 'cd'],
  FIGHT_PROP_HEAL_ADD: ['heal_', 'heal'],
  FIGHT_PROP_FIRE_ADD_HURT: ['pyro_dmg_', 'pyro%'],
  FIGHT_PROP_WATER_ADD_HURT: ['hydro_dmg_', 'hydro%'],
  FIGHT_PROP_WIND_ADD_HURT: ['anemo_dmg_', 'anemo%'],
  FIGHT_PROP_ELEC_ADD_HURT: ['electro_dmg_', 'electro%'],
  FIGHT_PROP_GRASS_ADD_HURT: ['dendro_dmg_', 'dendro%'],
  FIGHT_PROP_ICE_ADD_HURT: ['cryo_dmg_', 'cryo%'],
  FIGHT_PROP_ROCK_ADD_HURT: ['geo_dmg_', 'geo%'],
  FIGHT_PROP_PHYSICAL_ADD_HURT: ['physical_dmg_', 'phys%'],
};

const PERCENT = (prop: string) => PROP[prop]?.[0].endsWith('_') ?? false;

const SLOT: Record<string, Slot> = {
  EQUIP_BRACER: 'flower', EQUIP_NECKLACE: 'plume', EQUIP_SHOES: 'sands', EQUIP_RING: 'goblet', EQUIP_DRESS: 'circlet',
};

const ASC_MAX = [20, 40, 50, 60, 70, 80, 90];
const round = (v: number) => Math.round(v * 10000) / 10000;
const lvl = (level: number, asc: number) => `${level}/${Math.max(level, ASC_MAX[Math.min(Math.max(asc, 0), 6)] ?? 90)}`;

interface EnkaEquip {
  itemId: number;
  weapon?: { level: number; promoteLevel?: number; affixMap?: Record<string, number> };
  reliquary?: { level: number };
  flat: {
    itemType: string;
    equipType?: string;
    setNameTextMapHash?: string | number;
    rankLevel: number;
    reliquaryMainstat?: { mainPropId: string; statValue: number };
    reliquarySubstats?: { appendPropId: string; statValue: number }[];
  };
}

export interface EnkaAvatar {
  avatarId: number;
  skillDepotId: number;
  propMap: Record<string, { val?: string }>;
  talentIdList?: number[];
  skillLevelMap?: Record<string, number>;
  equipList: EnkaEquip[];
  /** set for builds saved on the linked Enka profile */
  buildName?: string;
}

export interface EnkaResponse {
  uid: string;
  player: { nickname?: string; level?: number; signature?: string };
  ttl: number;
  avatars: EnkaAvatar[];
  cached?: boolean;
}

export interface EnkaChar {
  build: CharBuild;
  artifacts: Artifact[];
  /** "Showcase" or the saved build's name */
  label: string;
}

function findChar(a: EnkaAvatar) {
  // travelers share one avatar id; the skill depot tells the element apart
  const sameId = characters.filter((c) => c.gameId === a.avatarId);
  return sameId.length > 1 ? sameId.find((c) => c.depot === a.skillDepotId) ?? sameId[0] : sameId[0];
}

function toArtifact(e: EnkaEquip, owner: string): Artifact | string {
  const f = e.flat;
  const slot = SLOT[f.equipType ?? ''];
  if (!slot) return `unknown artifact slot ${f.equipType}`;
  // sets gcsim doesn't implement (1-piece / low-rarity sets) are kept, without a set bonus
  const set = sets.find((s) => s.textMapId === String(f.setNameTextMapHash));
  const ms = f.reliquaryMainstat;
  const prop = ms ? PROP[ms.mainPropId] : undefined;
  if (!ms || !prop) return `unknown main stat ${ms?.mainPropId}`;
  const level = Math.max(0, (e.reliquary?.level ?? 1) - 1); // Enka counts from 1
  const table = artifactMain[String(f.rankLevel)]?.[prop[0]]?.[level];
  const mainValue = table ?? (PERCENT(ms.mainPropId) ? ms.statValue / 100 : ms.statValue);
  return {
    id: uid(),
    set: set?.key ?? '',
    slot,
    rarity: f.rankLevel,
    level,
    main: prop[1],
    mainValue: round(mainValue),
    subs: (f.reliquarySubstats ?? [])
      .filter((s) => PROP[s.appendPropId])
      .map((s) => ({ stat: PROP[s.appendPropId][1], value: round(PERCENT(s.appendPropId) ? s.statValue / 100 : s.statValue) })),
    location: owner,
  };
}

export function parseEnka(data: EnkaResponse): { chars: EnkaChar[]; errors: string[] } {
  const chars: EnkaChar[] = [];
  const errors: string[] = [];
  const unsupported = new Set<string>();
  for (const a of data.avatars ?? []) {
    const c = findChar(a);
    if (!c) {
      errors.push(`character id ${a.avatarId} is not in gcsim yet`);
      continue;
    }
    const base = createBuild(c.key);
    const level = parseInt(a.propMap?.['4001']?.val ?? '1', 10) || 1;
    const asc = parseInt(a.propMap?.['1002']?.val ?? '0', 10) || 0;
    const sl = a.skillLevelMap ?? {};

    const w = a.equipList.find((e) => e.flat.itemType === 'ITEM_WEAPON');
    let weapon = base.weapon;
    if (w?.weapon) {
      const wd = weapons.find((x) => x.gameId === w.itemId);
      if (!wd) errors.push(`${c.name}: weapon id ${w.itemId} is not in gcsim yet (kept the default)`);
      else {
        const affix = Object.values(w.weapon.affixMap ?? {})[0] ?? 0;
        weapon = { key: wd.key, refine: affix + 1, level: lvl(w.weapon.level, w.weapon.promoteLevel ?? 0), params: {} };
      }
    }

    const gear: Partial<Record<Slot, Artifact>> = {};
    for (const e of a.equipList.filter((x) => x.flat.itemType === 'ITEM_RELIQUARY')) {
      const art = toArtifact(e, c.key);
      if (typeof art === 'string') errors.push(`${c.name}: ${art}`);
      else {
        gear[art.slot] = art;
        if (!art.set) unsupported.add(c.name);
      }
    }

    const build: CharBuild = {
      ...base,
      level: lvl(level, asc),
      cons: a.talentIdList?.length ?? 0,
      talents: [sl[c.skillIds.attack] ?? 1, sl[c.skillIds.skill] ?? 1, sl[c.skillIds.burst] ?? 1],
      weapon,
      statsMode: 'artifacts',
      gear,
    };
    chars.push({ build, artifacts: SLOTS.map((s) => gear[s]).filter((x): x is Artifact => !!x), label: a.buildName ?? 'Showcase' });
  }
  if (unsupported.size) {
    errors.push(`some artifacts of ${[...unsupported].join(', ')} are from sets gcsim doesn't implement: imported with their stats, without a set bonus`);
  }
  return { chars, errors: [...new Set(errors)] };
}

/** Same artifact regardless of where it came from (GOOD or Enka). */
export function artifactSignature(a: Artifact): string {
  const subs = [...a.subs].sort((x, y) => x.stat.localeCompare(y.stat)).map((s) => `${s.stat}=${s.value}`).join(',');
  return `${a.set}|${a.slot}|${a.rarity}|${a.level}|${a.main}|${subs}`;
}

export async function fetchEnka(uidStr: string): Promise<EnkaResponse> {
  const res = await fetch(`/api/enka/${uidStr}`);
  const data = await res.json().catch(() => ({ error: `error ${res.status}` }));
  if (!res.ok) throw new Error(data.error ?? `error ${res.status}`);
  return data as EnkaResponse;
}

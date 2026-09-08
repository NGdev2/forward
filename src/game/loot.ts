import type { Affix, BaseItem, EquipSlot, ItemInstance, Rarity, StatKey } from './types';
import { EQUIP_SLOTS } from './types';
import { BASE_ITEMS, baseItemById, basesForSlot } from './data/items';
import { RARITY_TIERS, STAT_WEIGHT, isPercentStat, rarityById, rollRarity } from './config';

let uidCounter = 0;
function nextUid(): string {
  uidCounter += 1;
  return `i${Date.now().toString(36)}${uidCounter.toString(36)}`;
}

/* ============================================================================
 * Affix model
 * ----------------------------------------------------------------------------
 * Rarity decides HOW MANY bonus affixes roll (RARITY_TIERS[].affixCount, plus
 * one extra for set/relic bases). Each affix then rolls a quality factor q in
 * 0..1 which drives both the flat roll and the per-ilvl scaling, so two items
 * of the same rarity and level can differ by ~2x on a single line. That spread
 * is deliberate: a top-rolled rare should sometimes beat a floor-rolled epic.
 * ========================================================================== */

interface AffixDef {
  statKey: StatKey;
  /** Flat roll range before ilvl scaling. */
  min: number;
  max: number;
  /** Per-ilvl growth, itself modulated by the quality roll. */
  scale: number;
  /** Base pick weight. */
  weight: number;
  /** Per-slot pick multiplier; slots not listed use 1. */
  slotBias?: Partial<Record<EquipSlot, number>>;
}

const AFFIX_POOL: AffixDef[] = [
  {
    statKey: 'atk',
    min: 1,
    max: 4,
    scale: 0.4,
    weight: 100,
    slotBias: { weapon: 2.2, trinket: 1.4, offhand: 1.2, boots: 0.5, armor: 0.6 }
  },
  {
    statKey: 'def',
    min: 1,
    max: 4,
    scale: 0.34,
    weight: 100,
    slotBias: { armor: 2.2, helm: 1.9, offhand: 1.6, boots: 1.4, weapon: 0.35 }
  },
  {
    statKey: 'hp',
    min: 5,
    max: 16,
    scale: 1.2,
    weight: 100,
    slotBias: { armor: 2.0, helm: 1.6, trinket: 1.3, weapon: 0.4 }
  },
  {
    statKey: 'critChance',
    min: 0.01,
    max: 0.035,
    scale: 0.0008,
    weight: 62,
    slotBias: { weapon: 1.8, trinket: 1.6, helm: 1.1, armor: 0.5 }
  },
  {
    statKey: 'critDamage',
    min: 0.05,
    max: 0.16,
    scale: 0.004,
    weight: 62,
    slotBias: { weapon: 2.0, trinket: 1.3, offhand: 1.2, armor: 0.5 }
  },
  {
    statKey: 'goldFind',
    min: 0.02,
    max: 0.07,
    scale: 0.0045,
    weight: 48,
    slotBias: { trinket: 2.2, offhand: 1.2, weapon: 0.5 }
  },
  {
    statKey: 'lifesteal',
    min: 0.008,
    max: 0.03,
    scale: 0.0004,
    weight: 34,
    slotBias: { weapon: 2.0, trinket: 1.5, armor: 0.7 }
  },
  {
    statKey: 'speed',
    min: 1,
    max: 4,
    scale: 0.16,
    weight: 52,
    slotBias: { boots: 2.6, offhand: 1.1, armor: 0.5, helm: 0.6 }
  }
];

const AFFIX_BY_STAT = new Map<StatKey, AffixDef>(AFFIX_POOL.map(a => [a.statKey, a]));

/** How much rarity inflates each affix roll on top of adding more of them. */
function affixMult(rarity: Rarity): number {
  const idx = Math.max(0, RARITY_TIERS.findIndex(r => r.id === rarity));
  return 0.92 + idx * 0.12; // common 0.92 → mythic 1.52
}

/**
 * Per-ilvl growth of the primary stat. Base items already step up with their
 * minLevel, so this only needs to keep an old base competitive for a few levels.
 */
const ILVL_GROWTH = 0.04;

/** Primary stat variance: ±16% around the nominal value. */
const PRIMARY_SPREAD = 0.16;

export function roundStat(statKey: StatKey, raw: number): number {
  if (isPercentStat(statKey) || statKey === 'critDamage') return Math.round(raw * 1000) / 1000;
  return Math.max(1, Math.round(raw));
}

export function affixPower(affixes: Affix[]): number {
  return affixes.reduce((sum, a) => sum + a.value * STAT_WEIGHT[a.statKey], 0);
}

export function itemPower(item: Pick<ItemInstance, 'primary' | 'affixes'>): number {
  return Math.round(affixPower([item.primary, ...item.affixes]));
}

/* ------------------------------------------------------------- luck boost -- */

/**
 * Temporary drop-rarity boost granted by consumables (clover, incense).
 * Session-scoped: it is intentionally not persisted, so quitting mid-buff
 * loses it rather than letting it be banked forever.
 */
let luckBoost = { bonus: 0, dropsLeft: 0 };

export function addLuckCharges(bonus: number, drops: number) {
  luckBoost = { bonus: Math.max(luckBoost.bonus, bonus), dropsLeft: luckBoost.dropsLeft + drops };
}

export function activeLuckBonus(): { bonus: number; dropsLeft: number } {
  return { ...luckBoost };
}

function consumeLuck(): number {
  if (luckBoost.dropsLeft <= 0) return 0;
  luckBoost.dropsLeft -= 1;
  const bonus = luckBoost.bonus;
  if (luckBoost.dropsLeft <= 0) luckBoost = { bonus: 0, dropsLeft: 0 };
  return bonus;
}

/* ------------------------------------------------------------ affix rolls -- */

function affixValue(def: AffixDef, q: number, ilvl: number, rarity: Rarity): number {
  const flat = def.min + q * (def.max - def.min);
  const scaled = def.scale * ilvl * (0.55 + 0.9 * q);
  return roundStat(def.statKey, (flat + scaled) * affixMult(rarity));
}

/** Higher rarities skew their quality rolls upward (best of N samples). */
function qualityRoll(rarity: Rarity): number {
  const idx = Math.max(0, RARITY_TIERS.findIndex(r => r.id === rarity));
  const samples = idx >= 4 ? 2 : 1;
  let best = 0;
  for (let i = 0; i < samples; i++) best = Math.max(best, Math.random());
  return best;
}

function pickAffixDefs(count: number, slot: EquipSlot, exclude: StatKey): AffixDef[] {
  const picked: AffixDef[] = [];
  const remaining = AFFIX_POOL.filter(a => a.statKey !== exclude);
  for (let i = 0; i < count && remaining.length > 0; i++) {
    const weights = remaining.map(a => a.weight * (a.slotBias?.[slot] ?? 1));
    const total = weights.reduce((s, w) => s + w, 0);
    let roll = Math.random() * total;
    let idx = remaining.length - 1;
    for (let j = 0; j < remaining.length; j++) {
      if (roll < weights[j]) {
        idx = j;
        break;
      }
      roll -= weights[j];
    }
    picked.push(remaining[idx]);
    remaining.splice(idx, 1);
  }
  return picked;
}

/** Number of bonus affixes an item rolls. Set/relic bases roll one extra. */
export function affixCountFor(rarity: Rarity, isSet: boolean): number {
  return rarityById(rarity).affixCount + (isSet ? 1 : 0);
}

/* ---------------------------------------------------------------- naming -- */

export const PREFIX: Record<StatKey, string> = {
  atk: 'Vicious',
  def: 'Sturdy',
  hp: 'Vital',
  critChance: 'Keen',
  critDamage: 'Savage',
  goldFind: 'Gilded',
  lifesteal: 'Vampiric',
  speed: 'Swift'
};

export const SUFFIX: Record<StatKey, string> = {
  atk: 'of Fury',
  def: 'of Stone',
  hp: 'of the Bear',
  critChance: 'of Precision',
  critDamage: 'of Ruin',
  goldFind: 'of Greed',
  lifesteal: 'of Leeching',
  speed: 'of Winds'
};

function decorateName(base: BaseItem, rarity: Rarity, affixes: Affix[]): string {
  if (affixes.length === 0) return base.name;
  const idx = RARITY_TIERS.findIndex(r => r.id === rarity);
  const ranked = [...affixes].sort(
    (a, b) => b.value * STAT_WEIGHT[b.statKey] - a.value * STAT_WEIGHT[a.statKey]
  );
  let name = base.name;
  if (idx >= 1) name = `${PREFIX[ranked[0].statKey]} ${name}`;
  if (idx >= 3 && ranked[1]) name = `${name} ${SUFFIX[ranked[1].statKey]}`;
  return name;
}

/* ------------------------------------------------------------ base picker -- */

/**
 * Weighted base pick: bases close to (and just under) the player's level are
 * far more likely than trash they outgrew ten levels ago.
 */
function pickBase(pool: BaseItem[], level: number): BaseItem {
  const eligible = pool.filter(b => b.minLevel <= level + 2);
  const list = eligible.length > 0 ? eligible : pool;
  const weights = list.map(b => {
    const gap = Math.max(0, level - b.minLevel);
    return 1 / (1 + gap * 0.45);
  });
  const total = weights.reduce((s, w) => s + w, 0);
  let roll = Math.random() * total;
  for (let i = 0; i < list.length; i++) {
    if (roll < weights[i]) return list[i];
    roll -= weights[i];
  }
  return list[list.length - 1];
}

/* -------------------------------------------------------------- assembly -- */

function build(base: BaseItem, rarityId: Rarity, ilvl: number): ItemInstance {
  const rarity = rarityById(rarityId);
  const pq = Math.random();
  const primary: Affix = {
    statKey: base.statKey,
    value: roundStat(
      base.statKey,
      base.baseValue *
        rarity.mult *
        (1 + ilvl * ILVL_GROWTH) *
        (1 - PRIMARY_SPREAD + 2 * PRIMARY_SPREAD * pq)
    )
  };

  const count = affixCountFor(rarity.id, Boolean(base.setId));
  const defs = pickAffixDefs(count, base.slot, base.statKey);
  const affixes: Affix[] = defs.map(def => ({
    statKey: def.statKey,
    value: affixValue(def, qualityRoll(rarity.id), ilvl, rarity.id)
  }));

  return {
    uid: nextUid(),
    baseId: base.id,
    slot: base.slot,
    name: decorateName(base, rarity.id, affixes),
    icon: base.icon,
    rarity: rarity.id,
    ilvl,
    primary,
    affixes,
    power: itemPower({ primary, affixes }),
    abilityId: base.abilityId,
    setId: base.setId
  };
}

/** Rolls a random item of any slot. Signature is stable for other screens. */
export function rollItem(level: number, luck: number, forcedRarity?: Rarity): ItemInstance {
  const slot = EQUIP_SLOTS[Math.floor(Math.random() * EQUIP_SLOTS.length)];
  return rollItemForSlot(slot, level, luck, forcedRarity);
}

export function rollItemForSlot(
  slot: EquipSlot,
  level: number,
  luck: number,
  forcedRarity?: Rarity
): ItemInstance {
  const pool = basesForSlot(slot);
  const base = pickBase(pool.length > 0 ? pool : BASE_ITEMS, level);
  const bonus = forcedRarity ? 0 : consumeLuck();
  const rarity = forcedRarity ? rarityById(forcedRarity) : rollRarity(luck + bonus);
  return build(base, rarity.id, Math.max(1, Math.round(level)));
}

/** Rolls `count` items, guaranteeing distinct slots while it can. */
export function rollLoot(
  count: number,
  level: number,
  luck: number,
  forcedRarity?: Rarity
): ItemInstance[] {
  const slots = [...EQUIP_SLOTS].sort(() => Math.random() - 0.5);
  const out: ItemInstance[] = [];
  for (let i = 0; i < count; i++) {
    const slot = slots[i % slots.length];
    // Only the first drop honours a forced rarity; extras roll naturally.
    out.push(rollItemForSlot(slot, level, luck, i === 0 ? forcedRarity : undefined));
  }
  return out;
}

/** Builds a specific base at a specific rarity — used by the shop. */
export function makeItem(baseId: string, rarityId: Rarity, ilvl: number): ItemInstance | null {
  const base = baseItemById(baseId);
  if (!base) return null;
  return build(base, rarityId, Math.max(1, Math.round(ilvl)));
}

/* --------------------------------------------------------------- scoring -- */

/**
 * 0..1 roll quality: where this item landed between the worst and best
 * possible roll for its own base, rarity and affix lines.
 */
export function itemQuality(item: ItemInstance): number {
  const base = baseItemById(item.baseId);
  const rarity = rarityById(item.rarity);
  const nominal = base ? base.baseValue * rarity.mult * (1 + item.ilvl * ILVL_GROWTH) : item.primary.value;
  let min = nominal * (1 - PRIMARY_SPREAD) * STAT_WEIGHT[item.primary.statKey];
  let max = nominal * (1 + PRIMARY_SPREAD) * STAT_WEIGHT[item.primary.statKey];
  let actual = item.primary.value * STAT_WEIGHT[item.primary.statKey];

  for (const affix of item.affixes) {
    const def = AFFIX_BY_STAT.get(affix.statKey);
    if (!def) continue;
    const w = STAT_WEIGHT[affix.statKey];
    min += affixValue(def, 0, item.ilvl, item.rarity) * w;
    max += affixValue(def, 1, item.ilvl, item.rarity) * w;
    actual += affix.value * w;
  }
  if (max <= min) return 1;
  return Math.max(0, Math.min(1, (actual - min) / (max - min)));
}

export interface StatDelta {
  statKey: StatKey;
  from: number;
  to: number;
  diff: number;
}

/** Per-stat comparison of a candidate item against what's worn in its slot. */
export function compareItems(candidate: ItemInstance, current: ItemInstance | null): StatDelta[] {
  const sum = (item: ItemInstance | null) => {
    const map = new Map<StatKey, number>();
    if (!item) return map;
    for (const a of [item.primary, ...item.affixes]) {
      map.set(a.statKey, (map.get(a.statKey) ?? 0) + a.value);
    }
    return map;
  };
  const a = sum(candidate);
  const b = sum(current);
  const keys = new Set<StatKey>([...a.keys(), ...b.keys()]);
  const out: StatDelta[] = [];
  for (const key of keys) {
    const from = b.get(key) ?? 0;
    const to = a.get(key) ?? 0;
    if (Math.abs(to - from) < 1e-6) continue;
    out.push({ statKey: key, from, to, diff: to - from });
  }
  return out.sort((x, y) => Math.abs(y.diff) * STAT_WEIGHT[y.statKey] - Math.abs(x.diff) * STAT_WEIGHT[x.statKey]);
}

/**
 * Full English display name including any rolled prefix/suffix (the saved
 * `name`). Screens should use `itemDisplayName` from `src/i18n` instead: it
 * rebuilds the name in the current language from baseId + affixes.
 */
export function itemDisplayName(item: ItemInstance): string {
  return item.name;
}

/* ----------------------------------------------------------------- shop -- */

/** Rolls a shop inventory: spread across slots, biased toward decent rarities. */
export function rollShopStock(level: number, count = 6): ItemInstance[] {
  const slots = [...EQUIP_SLOTS].sort(() => Math.random() - 0.5);
  const out: ItemInstance[] = [];
  for (let i = 0; i < count; i++) {
    const slot = slots[i % slots.length];
    // Merchants never sell junk: uncommon floor, small chance of something great.
    const roll = Math.random();
    const rarity: Rarity =
      roll > 0.965 ? 'legendary' : roll > 0.84 ? 'epic' : roll > 0.5 ? 'rare' : 'uncommon';
    out.push(rollItemForSlot(slot, level, 0, rarity));
  }
  return out;
}

export function startingKit(): ItemInstance[] {
  const ids = ['w_dagger', 'a_leather', 'o_buckler'];
  return ids
    .map(id => makeItem(id, 'common', 1))
    .filter((i): i is ItemInstance => i !== null);
}

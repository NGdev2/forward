/* ============================================================================
 * FORWARD — content localisation.
 *
 * Game content (items, enemies, bosses, abilities…) keeps its English text in
 * the data tables. Translations are keyed by the content's STABLE ID, never
 * by its English text:
 *
 *   name('enemy', 'e_rat', base.name)        -> "Rat d'égout" (fr) / base.name (en)
 *   desc('ability', 'ab_rupture', ab.description)
 *   field('boss', 'b_ratking', 'title', base.title)
 *
 * Lookup: `<kind>.<id>` for the name, `<kind>.<id>.desc` for the description
 * and `<kind>.<id>.<field>` for anything else. English never needs an entry:
 * when the current language has no key, the data table's own field is used,
 * so nothing can ever render blank or as a bare key.
 *
 * Enemy MOVES are the one exception — they have no ids shared between the
 * archetype table and the boss scripts, so `moveLabel()` is keyed by the
 * English label (`move.<label>`).
 * ========================================================================== */

import type { EnemyInstance, EquipSlot, ItemInstance, Rarity, StatKey, StatusId, TalentKey } from '../game/types';
import type { SetElement } from '../game/data/items';
import { STAT_LABELS } from '../game/config';
import { baseItemById } from '../game/data/items';
import { STATUS_INFO } from '../game/data/abilities';
import { PREFIX, SUFFIX } from '../game/loot';
import { RARITY_TIERS, STAT_WEIGHT, rarityById } from '../game/config';
import { getLanguage, t, tryT } from './index';

export type ContentKind =
  | 'item'
  | 'enemy'
  | 'boss'
  | 'ability'
  | 'family'
  | 'status'
  | 'set'
  | 'consumable'
  | 'encounter'
  | 'biome'
  | 'stat'
  | 'talent'
  | 'passive'
  | 'rarity'
  | 'slot'
  | 'element'
  | 'archetype'
  | 'elite'
  | 'affix_prefix'
  | 'affix_suffix';

/** Localised display name of a content entry, or `fallback` (the data table's field). */
export function name(kind: ContentKind, id: string, fallback: string = id): string {
  return tryT(`${kind}.${id}`) ?? fallback;
}

/** Localised description (`<kind>.<id>.desc`), or `fallback`. */
export function desc(kind: ContentKind, id: string, fallback = ''): string {
  return tryT(`${kind}.${id}.desc`) ?? fallback;
}

/** Any other localised field (`<kind>.<id>.<field>`), or `fallback`. */
export function field(kind: ContentKind, id: string, fieldName: string, fallback = ''): string {
  return tryT(`${kind}.${id}.${fieldName}`) ?? fallback;
}

/* --------------------------------------------------------------- statuses -- */

export function statusName(id: StatusId): string {
  return name('status', id, STATUS_INFO[id]?.name ?? id);
}

export function statusDesc(id: StatusId): string {
  return desc('status', id, STATUS_INFO[id]?.description ?? '');
}

/** "Bleed x2" — the engine's status-event text; the log normalises it to "Bleed (2)". */
export function statusText(id: StatusId, stacks: number): string {
  const n = statusName(id);
  return stacks > 1 ? `${n} x${stacks}` : n;
}

/* ------------------------------------------------------------------ moves -- */

/** Enemy move label (archetype tables + boss scripts), keyed by its English label. */
export function moveLabel(label: string): string {
  return tryT(`move.${label}`) ?? label;
}

/* ----------------------------------------------------------------- bosses -- */

/** Boss phase name / banner, keyed `boss.<id>.phase<index>.name|banner`. */
export function phaseName(bossId: string, index: number, fallback: string): string {
  return tryT(`boss.${bossId}.phase${index}.name`) ?? fallback;
}

export function phaseBanner(bossId: string, index: number, fallback: string): string {
  return tryT(`boss.${bossId}.phase${index}.banner`) ?? fallback;
}

/** Set bonus label for a piece count, keyed `set.<id>.bonus<pieces>`. */
export function setBonusLabel(setId: string, pieces: number, fallback: string): string {
  return tryT(`set.${setId}.bonus${pieces}`) ?? fallback;
}

/* ------------------------------------------------------------------ items -- */

/**
 * Rebuilds an item's decorated name in the current language from its base id
 * and its ranked affixes, mirroring `decorateName()` in loot.ts:
 *   rarity index ≥ 1 → prefix from the strongest affix
 *   rarity index ≥ 3 → suffix from the second strongest
 * Word order comes from `data.affix_pattern` ("{prefix} {base} {suffix}" in
 * English, "{base} {prefix} {suffix}" in French). French adjectives take an
 * "s" when the base is flagged plural (`item.<id>.pl`). The saved `name`
 * field is never touched.
 */
export function itemDisplayName(item: Pick<ItemInstance, 'baseId' | 'name' | 'rarity' | 'affixes'>): string {
  // English is the reference: the saved name is exactly what the player saw
  // when the item dropped, so it is shown verbatim.
  if (getLanguage() === 'en' && item.name) return item.name;
  const base = baseItemById(item.baseId);
  const baseName = name('item', item.baseId, base?.name ?? item.name);
  if (!item.affixes || item.affixes.length === 0) return baseName;
  const idx = RARITY_TIERS.findIndex(r => r.id === item.rarity);
  const ranked = [...item.affixes].sort(
    (a, b) => b.value * STAT_WEIGHT[b.statKey] - a.value * STAT_WEIGHT[a.statKey]
  );
  const plural = tryT(`item.${item.baseId}.pl`) === '1';
  let prefix = '';
  let suffix = '';
  if (idx >= 1) {
    prefix = affixPrefix(ranked[0].statKey);
    if (plural && prefix && !prefix.endsWith('s')) prefix += 's';
  }
  if (idx >= 3 && ranked[1]) suffix = affixSuffix(ranked[1].statKey);
  return t('data.affix_pattern', { prefix, base: baseName, suffix }).replace(/\s+/g, ' ').trim();
}

export function affixPrefix(stat: StatKey): string {
  return name('affix_prefix', stat, PREFIX[stat]);
}

export function affixSuffix(stat: StatKey): string {
  return name('affix_suffix', stat, SUFFIX[stat]);
}

/* ---------------------------------------------------------------- enemies -- */

/**
 * Display name for an enemy instance. Instances are built in the current
 * language (see data/enemies.ts and data/bosses.ts), so this normally just
 * returns `name`; it exists so screens have one obvious call to make.
 */
export function enemyName(e: Pick<EnemyInstance, 'name'>): string {
  return e.name;
}

/* ------------------------------------------------------------ fixed enums -- */
/* These have entries in BOTH en.ts and fr.ts (`stat.*`, `slot.*`, `rarity.*`,
 * `element.*`, `talent.*`); the data-table fallback is only a safety net.   */

export function statLabel(key: StatKey): string {
  return name('stat', key, STAT_LABELS[key] ?? key);
}

const SLOT_FALLBACK: Record<EquipSlot, string> = {
  weapon: 'Weapon',
  offhand: 'Offhand',
  helm: 'Helm',
  armor: 'Armor',
  boots: 'Boots',
  trinket: 'Trinket'
};

export function slotLabel(slot: EquipSlot): string {
  return name('slot', slot, SLOT_FALLBACK[slot] ?? slot);
}

export function rarityLabel(id: Rarity): string {
  return name('rarity', id, rarityById(id).label);
}

const ELEMENT_FALLBACK: Record<SetElement, string> = {
  beast: 'Beast',
  metal: 'Metal',
  fire: 'Fire',
  water: 'Water',
  void: 'Void',
  holy: 'Holy'
};

export function elementLabel(element: SetElement): string {
  return name('element', element, ELEMENT_FALLBACK[element] ?? element);
}

const TALENT_FALLBACK: Record<TalentKey, { name: string; blurb: string }> = {
  might: { name: 'Might', blurb: 'Hit harder' },
  guard: { name: 'Guard', blurb: 'Take less' },
  vigor: { name: 'Vigor', blurb: 'Last longer' },
  precision: { name: 'Precision', blurb: 'Crit more often' }
};

export function talentName(key: TalentKey): string {
  return name('talent', key, TALENT_FALLBACK[key]?.name ?? key);
}

export function talentBlurb(key: TalentKey): string {
  return desc('talent', key, TALENT_FALLBACK[key]?.blurb ?? '');
}

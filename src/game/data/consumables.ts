import type { Consumable } from '../types';

/**
 * Consumables are stored on `state.stats.consumables` as `{ [id]: count }`.
 *
 * `where` says where the item may be spent:
 *   'field'  — usable from the inventory screen (heals, tomes, luck)
 *   'combat' — usable during a fight only (the combat workstream reads these)
 *   'both'   — either
 *
 * `effect` is a declarative description so the combat screen can resolve
 * combat-only items without importing screen code.
 */
export type ConsumableWhere = 'field' | 'combat' | 'both';

export type ConsumableEffect =
  | { kind: 'healPct'; value: number }
  | { kind: 'healFlat'; value: number }
  | { kind: 'xp'; value: number }
  | { kind: 'buffAtk'; value: number; turns: number }
  | { kind: 'buffDef'; value: number; turns: number }
  | { kind: 'damage'; value: number }
  | { kind: 'luck'; value: number }
  | { kind: 'energy'; value: number }
  | { kind: 'cleanse' };

export interface ConsumableDef extends Consumable {
  where: ConsumableWhere;
  effect: ConsumableEffect;
  /** Rough level the shop starts stocking it. */
  minLevel: number;
  /** Tint used for the tile, referencing a rarity token. */
  tone: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
}

export const CONSUMABLES: ConsumableDef[] = [
  {
    id: 'potion_small',
    name: 'Minor Potion',
    icon: '🧪',
    description: 'Restores 35% of max HP.',
    price: 50,
    where: 'both',
    effect: { kind: 'healPct', value: 0.35 },
    minLevel: 1,
    tone: 'common'
  },
  {
    id: 'potion_large',
    name: 'Greater Potion',
    icon: '⚗️',
    description: 'Restores 80% of max HP.',
    price: 220,
    where: 'both',
    effect: { kind: 'healPct', value: 0.8 },
    minLevel: 5,
    tone: 'uncommon'
  },
  {
    id: 'elixir_full',
    name: 'Elixir of Life',
    icon: '💖',
    description: 'Fully restores HP.',
    price: 520,
    where: 'both',
    effect: { kind: 'healPct', value: 1 },
    minLevel: 12,
    tone: 'rare'
  },
  {
    id: 'draught_might',
    name: 'Draught of Might',
    icon: '💪',
    description: '+40% Attack for 5 turns of the next fight.',
    price: 220,
    where: 'combat',
    effect: { kind: 'buffAtk', value: 0.4, turns: 5 },
    minLevel: 6,
    tone: 'uncommon'
  },
  {
    id: 'draught_stone',
    name: 'Stoneskin Draught',
    icon: '🪨',
    description: '+60% Defense for 5 turns of the next fight.',
    price: 220,
    where: 'combat',
    effect: { kind: 'buffDef', value: 0.6, turns: 5 },
    minLevel: 6,
    tone: 'uncommon'
  },
  {
    id: 'bomb_fire',
    name: 'Firebomb',
    icon: '💣',
    description: 'Hurls 250% weapon damage at the enemy.',
    price: 190,
    where: 'combat',
    effect: { kind: 'damage', value: 2.5 },
    minLevel: 8,
    tone: 'rare'
  },
  {
    id: 'antidote',
    name: 'Antidote',
    icon: '🌿',
    description: 'Clears poison, burn and bleed.',
    price: 110,
    where: 'combat',
    effect: { kind: 'cleanse' },
    minLevel: 4,
    tone: 'common'
  },
  {
    id: 'ether',
    name: 'Ether',
    icon: '🔷',
    description: 'Restores 6 energy in battle.',
    price: 150,
    where: 'combat',
    effect: { kind: 'energy', value: 6 },
    minLevel: 4,
    tone: 'uncommon'
  },
  {
    id: 'tome_wisdom',
    name: 'Tome of Wisdom',
    icon: '📘',
    description: 'Grants a chunk of XP instantly.',
    price: 320,
    where: 'field',
    effect: { kind: 'xp', value: 120 },
    minLevel: 3,
    tone: 'rare'
  },
  {
    id: 'clover_luck',
    name: 'Four-Leaf Clover',
    icon: '🍀',
    description: 'Raises the rarity odds of your next drops.',
    price: 380,
    where: 'field',
    effect: { kind: 'luck', value: 6 },
    minLevel: 10,
    tone: 'epic'
  },
  {
    id: 'incense_fortune',
    name: 'Fortune Incense',
    icon: '🕯️',
    description: 'Strongly raises drop rarity for a while.',
    price: 1100,
    where: 'field',
    effect: { kind: 'luck', value: 18 },
    minLevel: 20,
    tone: 'legendary'
  }
];

const BY_ID = new Map<string, ConsumableDef>(CONSUMABLES.map(c => [c.id, c]));

export function consumableById(id: string): ConsumableDef | undefined {
  return BY_ID.get(id);
}

export function fieldConsumables(): ConsumableDef[] {
  return CONSUMABLES.filter(c => c.where !== 'combat');
}

export function combatConsumables(): ConsumableDef[] {
  return CONSUMABLES.filter(c => c.where !== 'field');
}

/**
 * What the trader actually charges for a consumable. Base prices are the
 * level-1 price; they climb with the player's level so a potion stays worth
 * roughly two or three fights' gold instead of becoming pocket change.
 */
export function supplyPrice(c: ConsumableDef, level: number): number {
  return Math.round(c.price * (0.9 + 0.1 * Math.max(1, level)));
}

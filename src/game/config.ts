import type { RarityTier, StatKey } from './types';
import { PERCENT_STATS } from './types';

export const RARITY_TIERS: RarityTier[] = [
  { id: 'common', label: 'Common', color: 0x9aa4bf, hex: '#9aa4bf', mult: 1.0, weight: 100, affixCount: 0 },
  { id: 'uncommon', label: 'Uncommon', color: 0x5ee88f, hex: '#5ee88f', mult: 1.3, weight: 52, affixCount: 1 },
  { id: 'rare', label: 'Rare', color: 0x4fa8f2, hex: '#4fa8f2', mult: 1.7, weight: 24, affixCount: 2 },
  { id: 'epic', label: 'Epic', color: 0xb266f2, hex: '#b266f2', mult: 2.25, weight: 9, affixCount: 3 },
  { id: 'legendary', label: 'Legendary', color: 0xf2a541, hex: '#f2a541', mult: 3.1, weight: 2.6, affixCount: 4 },
  { id: 'mythic', label: 'Mythic', color: 0xff4d6d, hex: '#ff4d6d', mult: 4.2, weight: 0.5, affixCount: 5 }
];

export function rarityById(id: string): RarityTier {
  return RARITY_TIERS.find(r => r.id === id) ?? RARITY_TIERS[0];
}

/** Picks a rarity tier, biased toward better tiers as `luck` increases. */
export function rollRarity(luck: number): RarityTier {
  const boosted = RARITY_TIERS.map((r, i) => {
    const boost = i === 0 ? 1 : 1 + luck * 0.06 * i;
    return { r, w: r.weight * boost };
  });
  const total = boosted.reduce((s, b) => s + b.w, 0);
  let roll = Math.random() * total;
  for (const b of boosted) {
    if (roll < b.w) return b.r;
    roll -= b.w;
  }
  return RARITY_TIERS[0];
}

export const XP_CURVE = (level: number) => Math.round(20 * Math.pow(level, 1.32) + 10);

export const PROGRESS_MAX_FOR_CYCLE = (cycle: number) => 6 + Math.floor(cycle / 2);

export const STORAGE_KEY = 'forward-save-v2';

/** Player energy economy for combat. */
export const COMBAT = {
  maxEnergy: 10,
  startEnergy: 4,
  energyPerBasic: 3,
  energyPerTurn: 1,
  fleeChance: 0.6,
  defendReduction: 0.55
};

export const STAT_LABELS: Record<StatKey, string> = {
  atk: 'Attack',
  def: 'Defense',
  hp: 'Max HP',
  critChance: 'Crit Chance',
  critDamage: 'Crit Damage',
  goldFind: 'Gold Find',
  lifesteal: 'Lifesteal',
  speed: 'Speed'
};

export const STAT_ICONS: Record<StatKey, string> = {
  atk: '⚔',
  def: '🛡',
  hp: '❤',
  critChance: '✷',
  critDamage: '✸',
  goldFind: '💰',
  lifesteal: '🩸',
  speed: '⚡'
};

/** Relative worth of one point of each stat, used for the item power score. */
export const STAT_WEIGHT: Record<StatKey, number> = {
  atk: 1,
  def: 0.9,
  hp: 0.22,
  critChance: 60,
  critDamage: 25,
  goldFind: 14,
  lifesteal: 45,
  speed: 12
};

export function isPercentStat(stat: StatKey): boolean {
  return PERCENT_STATS.includes(stat);
}

export function formatStat(stat: StatKey, value: number): string {
  if (isPercentStat(stat)) return `${(value * 100).toFixed(1).replace(/\.0$/, '')}%`;
  return String(Math.round(value));
}

export function formatStatSigned(stat: StatKey, value: number): string {
  const sign = value >= 0 ? '+' : '';
  return sign + formatStat(stat, value);
}

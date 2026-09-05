/* ============================================================================
 * Shared type contracts. Owned by the integration layer.
 * Other modules may READ these freely; additive changes only.
 * ========================================================================== */

export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'mythic';

export type EquipSlot = 'weapon' | 'offhand' | 'helm' | 'armor' | 'boots' | 'trinket';

export const EQUIP_SLOTS: EquipSlot[] = ['weapon', 'offhand', 'helm', 'armor', 'boots', 'trinket'];

export type StatKey =
  | 'atk'
  | 'def'
  | 'hp'
  | 'critChance'
  | 'critDamage'
  | 'goldFind'
  | 'lifesteal'
  | 'speed';

/** Stat values that are percentages (0..1) rather than flat points. */
export const PERCENT_STATS: StatKey[] = ['critChance', 'critDamage', 'goldFind', 'lifesteal'];

export interface RarityTier {
  id: Rarity;
  label: string;
  color: number;
  hex: string;
  mult: number;
  weight: number;
  /** How many bonus affixes an item of this rarity rolls. */
  affixCount: number;
}

export interface Affix {
  statKey: StatKey;
  value: number;
}

/** A content-table entry: the template an item instance is rolled from. */
export interface BaseItem {
  id: string;
  slot: EquipSlot;
  name: string;
  icon: string;
  statKey: StatKey;
  baseValue: number;
  minLevel: number;
  /** Optional combat ability this weapon grants when equipped. */
  abilityId?: string;
  /** Optional equipment set this base belongs to. */
  setId?: string;
}

/** A concrete owned item, rolled from a BaseItem + Rarity. */
export interface ItemInstance {
  uid: string;
  baseId: string;
  slot: EquipSlot;
  name: string;
  icon: string;
  rarity: Rarity;
  ilvl: number;
  /** Main stat, derived from the base item. */
  primary: Affix;
  /** Bonus stats, count determined by rarity. */
  affixes: Affix[];
  /** Single comparison score used for sorting/auto-equip hints. */
  power: number;
  abilityId?: string;
  setId?: string;
}

export type EquipmentSet = Record<EquipSlot, ItemInstance | null>;

/* ---------------------------------------------------------------- combat -- */

export type StatusId =
  | 'poison'
  | 'burn'
  | 'bleed'
  | 'stun'
  | 'shield'
  | 'weaken'
  | 'fortify'
  | 'regen'
  | 'enrage';

export interface StatusEffect {
  id: StatusId;
  stacks: number;
  turns: number;
}

export type AbilityKind = 'attack' | 'buff' | 'debuff' | 'heal' | 'defend';

export interface Ability {
  id: string;
  name: string;
  icon: string;
  description: string;
  kind: AbilityKind;
  /** Energy cost. Basic attacks generate energy, skills spend it. */
  cost: number;
  /** Turns before it can be used again. */
  cooldown: number;
  /** Damage/heal multiplier applied to the user's atk. */
  power: number;
  hits?: number;
  applies?: {
    status: StatusId;
    stacks: number;
    turns: number;
    chance: number;
    /** Whether the status lands on the target or the caster. */
    onSelf?: boolean;
  };
}

export type IntentKind = 'attack' | 'heavy' | 'defend' | 'buff' | 'debuff' | 'heal' | 'special';

/** Telegraphed enemy action, shown to the player before they choose. */
export interface Intent {
  kind: IntentKind;
  label: string;
  icon: string;
  /** Estimated damage, when the intent is an attack. */
  value?: number;
}

export type EnemyAbility = 'lifesteal' | 'reflect' | 'enrage';

export interface EnemyBase {
  id: string;
  name: string;
  icon: string;
  tier: number;
  minLevel: number;
  hpBase: number;
  atkBase: number;
  goldBase: number;
  xpBase: number;
  flavor?: string;
}

export interface EnemyInstance {
  id: string;
  name: string;
  icon: string;
  hp: number;
  maxHp: number;
  atk: number;
  def: number;
  goldReward: number;
  xpReward: number;
  isBoss: boolean;
  isElite: boolean;
  guaranteedRarity?: Rarity;
  title?: string;
  ability?: EnemyAbility;
  /** Boss phase thresholds as fractions of max HP, descending. */
  phases?: number[];
  statuses: StatusEffect[];
  shield: number;
}

export interface BossBase {
  id: string;
  name: string;
  title: string;
  icon: string;
  hpMult: number;
  atkMult: number;
  goldMult: number;
  xpMult: number;
  guaranteedRarity: Rarity;
  flavor: string;
  ability?: EnemyAbility;
}

export type CombatOutcome = 'won' | 'lost' | 'fled';

export interface CombatResult {
  outcome: CombatOutcome;
  enemyName: string;
  enemyIcon: string;
  wasBoss: boolean;
  gold: number;
  xp: number;
  turns: number;
  loot: ItemInstance[];
}

/* ------------------------------------------------------------ encounters -- */

export type NodeKind =
  | 'battle'
  | 'elite'
  | 'treasure'
  | 'gold'
  | 'shrine'
  | 'shop'
  | 'rest'
  | 'mystery'
  | 'boss';

/** Danger rating: 0 safe, 3 deadly. Drives colour + reward scaling. */
export type Danger = 0 | 1 | 2 | 3;

export interface EncounterNode {
  kind: NodeKind;
  icon: string;
  title: string;
  subtitle: string;
  danger: Danger;
  /** Lane index 0..2, assigned by the run screen. */
  lane: number;
}

/* ----------------------------------------------------------------- state -- */

export interface Consumable {
  id: string;
  name: string;
  icon: string;
  description: string;
  price: number;
}

export interface PlayerSettings {
  sfx: boolean;
  music: boolean;
  reducedMotion: boolean;
  autoEquip: boolean;
}

export interface PlayerStats {
  level: number;
  xp: number;
  xpToNext: number;
  gold: number;
  gems: number;
  hp: number;
  maxHp: number;
  baseAtk: number;
  baseDef: number;
  /** Unspent stat points awarded on level up. */
  statPoints: number;
  progress: number;
  progressMax: number;
  worldCycle: number;
  distance: number;
  bestLevel: number;
  bestCycle: number;
  bestDistance: number;
  battlesWon: number;
  bossesFelled: number;
  equipment: EquipmentSet;
  inventory: ItemInstance[];
  inventoryCap: number;
  consumables: Record<string, number>;
  settings: PlayerSettings;
  onboarded: boolean;
}

/** Derived, fully-resolved combat stats for the player. */
export interface DerivedStats {
  atk: number;
  def: number;
  maxHp: number;
  critChance: number;
  critDamage: number;
  goldFind: number;
  lifesteal: number;
  speed: number;
  power: number;
}

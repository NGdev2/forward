import type {
  Affix,
  DerivedStats,
  EquipSlot,
  EquipmentSet,
  ItemInstance,
  PlayerStats,
  StatKey,
  TalentKey
} from './types';
import { EQUIP_SLOTS, TALENT_KEYS } from './types';
import { XP_CURVE, PROGRESS_MAX_FOR_CYCLE, STORAGE_KEY, STAT_WEIGHT } from './config';
import { activeSetBonuses, type ActiveSetBonus, type SetProc } from './data/items';
import { startingKit } from './loot';

/** What one talent point buys. Tuned alongside the level-up gains in addXp. */
export const TALENT_GAIN: Record<TalentKey, { statKey: StatKey; value: number }> = {
  might: { statKey: 'atk', value: 2 },
  guard: { statKey: 'def', value: 2 },
  vigor: { statKey: 'hp', value: 12 },
  precision: { statKey: 'critChance', value: 0.015 }
};

const SELL_RATE = 1.1;

function emptyEquipment(): EquipmentSet {
  return { weapon: null, offhand: null, helm: null, armor: null, boots: null, trinket: null };
}

/**
 * Repairs an item loaded from storage. Older saves (and half-written ones) can
 * carry items without `primary`/`affixes`, which used to crash every stat read.
 * Anything unrecoverable returns null and is dropped.
 */
function sanitizeItem(raw: unknown): ItemInstance | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Partial<ItemInstance> & Record<string, unknown>;
  if (typeof item.uid !== 'string' || typeof item.slot !== 'string') return null;
  if (!EQUIP_SLOTS.includes(item.slot as EquipSlot)) return null;

  const affix = (a: unknown): Affix | null => {
    if (!a || typeof a !== 'object') return null;
    const { statKey, value } = a as Partial<Affix>;
    if (typeof statKey !== 'string' || typeof value !== 'number' || !Number.isFinite(value)) {
      return null;
    }
    return { statKey: statKey as StatKey, value };
  };

  // v1 items stored the primary stat as loose top-level fields.
  const primary =
    affix(item.primary) ??
    affix({ statKey: item.statKey, value: item.value }) ??
    { statKey: 'atk' as StatKey, value: 1 };

  const affixes = Array.isArray(item.affixes)
    ? (item.affixes.map(affix).filter(Boolean) as Affix[])
    : [];

  return {
    ...(item as ItemInstance),
    slot: item.slot as EquipSlot,
    name: typeof item.name === 'string' ? item.name : 'Unknown Relic',
    icon: typeof item.icon === 'string' ? item.icon : '\u2753',
    rarity: (typeof item.rarity === 'string' ? item.rarity : 'common') as ItemInstance['rarity'],
    ilvl: typeof item.ilvl === 'number' ? item.ilvl : 1,
    power: typeof item.power === 'number' ? item.power : 1,
    primary,
    affixes
  };
}

/** A fresh hero starts with the starting kit already worn (dagger, leather vest, buckler). */
function startingEquipment(): EquipmentSet {
  const eq = emptyEquipment();
  for (const item of startingKit()) eq[item.slot] = item;
  return eq;
}

function freshStats(): PlayerStats {
  return {
    level: 1,
    xp: 0,
    xpToNext: XP_CURVE(1),
    gold: 0,
    gems: 50,
    hp: 40,
    maxHp: 40,
    baseAtk: 6,
    baseDef: 2,
    statPoints: 0,
    progress: 0,
    progressMax: PROGRESS_MAX_FOR_CYCLE(0),
    worldCycle: 0,
    distance: 0,
    bestLevel: 1,
    bestCycle: 0,
    bestDistance: 0,
    battlesWon: 0,
    bossesFelled: 0,
    kills: 0,
    killsById: {},
    damageDealt: 0,
    damageTaken: 0,
    perfectParries: 0,
    goldEarned: 0,
    fightsLost: 0,
    bossesLost: 0,
    talents: { might: 0, guard: 0, vigor: 0, precision: 0 },
    equipment: startingEquipment(),
    inventory: [],
    inventoryCap: 24,
    consumables: { potion_small: 2 },
    settings: {
      sfx: true,
      music: true,
      reducedMotion: false,
      autoEquip: false,
      sfxVolume: 0.8,
      musicVolume: 0.6,
      language: 'en'
    },
    onboarded: false
  };
}

export interface EquipResult {
  previous: ItemInstance | null;
  /** True when the swap was blocked because the bag is full. */
  blocked: boolean;
}

export class GameState {
  stats: PlayerStats;

  constructor() {
    this.stats = this.load() ?? freshStats();
  }

  private load(): PlayerStats | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as PlayerStats;
      if (typeof parsed.level !== 'number' || !parsed.equipment) return null;
      // Fill in any slot/field added after this save was written.
      parsed.equipment = { ...emptyEquipment(), ...parsed.equipment };
      for (const slot of EQUIP_SLOTS) {
        parsed.equipment[slot] = sanitizeItem(parsed.equipment[slot]);
      }
      parsed.inventory = Array.isArray(parsed.inventory)
        ? (parsed.inventory.map(sanitizeItem).filter(Boolean) as ItemInstance[])
        : [];
      parsed.consumables ??= {};
      parsed.settings = { ...freshStats().settings, ...(parsed.settings ?? {}) };
      // Fields added after the save was written.
      const fresh = freshStats();
      for (const key of ['kills', 'damageDealt', 'damageTaken', 'perfectParries', 'goldEarned', 'fightsLost', 'bossesLost'] as const) {
        if (typeof parsed[key] !== 'number') parsed[key] = 0;
      }
      if (!parsed.killsById || typeof parsed.killsById !== 'object') parsed.killsById = {};
      parsed.talents = { ...fresh.talents, ...(parsed.talents ?? {}) };
      return parsed;
    } catch {
      return null;
    }
  }

  save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.stats));
    } catch {
      /* storage unavailable (private mode) — progression just won't persist */
    }
  }

  reset() {
    this.stats = freshStats();
    this.save();
  }

  get equipment(): EquipmentSet {
    return this.stats.equipment;
  }

  /**
   * Sums a stat across every equipped item's primary and bonus affixes, plus
   * talent points and flat set bonuses.
   */
  private gearStat(key: StatKey): number {
    let total = 0;
    for (const slot of EQUIP_SLOTS) {
      const item = this.stats.equipment[slot];
      if (!item) continue;
      if (item.primary?.statKey === key) total += item.primary.value;
      for (const affix of item.affixes ?? []) {
        if (affix?.statKey === key) total += affix.value;
      }
    }
    for (const t of TALENT_KEYS) {
      const gain = TALENT_GAIN[t];
      if (gain.statKey === key) total += gain.value * (this.stats.talents?.[t] ?? 0);
    }
    for (const b of this.setBonuses) {
      total += b.bonus.stats?.[key] ?? 0;
    }
    return total;
  }

  /** Percentage multipliers granted by set bonuses, keyed by stat. */
  private setPct(key: StatKey): number {
    let pct = 0;
    for (const b of this.setBonuses) pct += b.bonus.statsPct?.[key] ?? 0;
    return pct;
  }

  /** Set bonuses currently active, resolved from worn gear. */
  get setBonuses(): ActiveSetBonus[] {
    return activeSetBonuses(this.stats.equipment);
  }

  /** Special behaviours granted by active set bonuses (the combat engine reads these). */
  get setProcs(): Set<SetProc> {
    const out = new Set<SetProc>();
    for (const b of this.setBonuses) if (b.bonus.proc) out.add(b.bonus.proc);
    return out;
  }

  get derived(): DerivedStats {
    const s = this.stats;
    const atk = Math.round((s.baseAtk + this.gearStat('atk')) * (1 + this.setPct('atk')));
    const def = Math.round((s.baseDef + this.gearStat('def')) * (1 + this.setPct('def')));
    const maxHp = Math.round((s.maxHp + this.gearStat('hp')) * (1 + this.setPct('hp')));
    const critChance = Math.min(0.75, 0.05 + this.gearStat('critChance') + this.setPct('critChance'));
    const critDamage = 1.5 + this.gearStat('critDamage') + this.setPct('critDamage');
    const goldFind = 1 + this.gearStat('goldFind') + this.setPct('goldFind');
    const lifesteal = this.gearStat('lifesteal') + this.setPct('lifesteal');
    const speed = 10 + this.gearStat('speed');
    const power = Math.round(
      atk * STAT_WEIGHT.atk +
        def * STAT_WEIGHT.def +
        maxHp * STAT_WEIGHT.hp +
        critChance * STAT_WEIGHT.critChance +
        lifesteal * STAT_WEIGHT.lifesteal
    );
    return { atk, def, maxHp, critChance, critDamage, goldFind, lifesteal, speed, power };
  }

  get maxHp(): number {
    return this.derived.maxHp;
  }

  get luck(): number {
    return this.stats.level * 0.45 + this.stats.worldCycle * 0.9;
  }

  /* ------------------------------------------------------------ currency -- */

  addGold(amount: number): number {
    const gained = Math.max(0, Math.round(amount * this.derived.goldFind));
    this.stats.gold += gained;
    this.stats.goldEarned = (this.stats.goldEarned ?? 0) + gained;
    return gained;
  }

  spendGold(n: number): boolean {
    if (this.stats.gold < n) return false;
    this.stats.gold -= n;
    return true;
  }

  addGems(n: number) {
    this.stats.gems += n;
  }

  spendGems(n: number): boolean {
    if (this.stats.gems < n) return false;
    this.stats.gems -= n;
    return true;
  }

  /* --------------------------------------------------------- progression -- */

  addXp(amount: number): { leveledUp: boolean; levels: number } {
    let levels = 0;
    this.stats.xp += amount;
    while (this.stats.xp >= this.stats.xpToNext) {
      this.stats.xp -= this.stats.xpToNext;
      this.stats.level += 1;
      this.stats.maxHp += 6;
      this.stats.baseAtk += 1;
      this.stats.baseDef += 1;
      this.stats.statPoints += 2;
      this.stats.xpToNext = XP_CURVE(this.stats.level);
      this.stats.hp = this.maxHp;
      levels += 1;
      if (this.stats.level > this.stats.bestLevel) this.stats.bestLevel = this.stats.level;
    }
    return { leveledUp: levels > 0, levels };
  }

  takeDamage(amount: number) {
    this.stats.hp = Math.max(0, this.stats.hp - Math.round(amount));
  }

  heal(amount: number) {
    this.stats.hp = Math.min(this.maxHp, this.stats.hp + Math.round(amount));
  }

  healFull() {
    this.stats.hp = this.maxHp;
  }

  isDead(): boolean {
    return this.stats.hp <= 0;
  }

  gainProgress(n = 1) {
    this.stats.progress = Math.min(this.stats.progressMax, this.stats.progress + n);
  }

  isBossReady(): boolean {
    return this.stats.progress >= this.stats.progressMax;
  }

  onBossDefeated() {
    const s = this.stats;
    s.bossesFelled += 1;
    s.worldCycle += 1;
    s.progress = 0;
    s.progressMax = PROGRESS_MAX_FOR_CYCLE(s.worldCycle);
    if (s.worldCycle > s.bestCycle) s.bestCycle = s.worldCycle;
  }

  /**
   * Losing to the boss sends you back to the start of this stretch of road:
   * the bar empties so you get a full set of encounters to gear up before the
   * same boss blocks the road again.
   */
  onBossLost() {
    const s = this.stats;
    s.bossesLost = (s.bossesLost ?? 0) + 1;
    s.progress = 0;
  }

  /* -------------------------------------------------------------- talents -- */

  /** Spends one unspent level-up point on a permanent stat. */
  spendTalent(key: TalentKey): boolean {
    if (this.stats.statPoints <= 0) return false;
    this.stats.statPoints -= 1;
    this.stats.talents[key] = (this.stats.talents[key] ?? 0) + 1;
    if (key === 'vigor') this.stats.hp += TALENT_GAIN.vigor.value;
    this.clampHp();
    return true;
  }

  /* -------------------------------------------------------------- records -- */

  recordKill(enemyId: string, isBoss: boolean) {
    const s = this.stats;
    s.kills = (s.kills ?? 0) + 1;
    s.killsById ??= {};
    s.killsById[enemyId] = (s.killsById[enemyId] ?? 0) + 1;
    if (isBoss) {
      /* bossesFelled is bumped by onBossDefeated when the reward lands */
    }
  }

  addDistance(meters: number) {
    this.stats.distance += meters;
    if (this.stats.distance > this.stats.bestDistance) {
      this.stats.bestDistance = this.stats.distance;
    }
  }

  /* ------------------------------------------------------------ inventory -- */

  get bagCount(): number {
    return this.stats.inventory.length;
  }

  get bagFull(): boolean {
    return this.stats.inventory.length >= this.stats.inventoryCap;
  }

  /** Hard ceiling on bag size — the grid stays readable on a phone. */
  static readonly BAG_CAP_MAX = 60;

  /** Grows the bag by `n` slots (bought from the trader). Returns the new cap. */
  expandBag(n: number): number {
    this.stats.inventoryCap = Math.min(GameState.BAG_CAP_MAX, this.stats.inventoryCap + Math.max(0, Math.round(n)));
    return this.stats.inventoryCap;
  }

  addItem(item: ItemInstance): boolean {
    if (this.bagFull) return false;
    this.stats.inventory.push(item);
    return true;
  }

  removeItem(uid: string): ItemInstance | null {
    const idx = this.stats.inventory.findIndex(i => i.uid === uid);
    if (idx < 0) return null;
    return this.stats.inventory.splice(idx, 1)[0];
  }

  /** Equips an item from the bag, moving anything already worn back into it. */
  equip(item: ItemInstance): EquipResult {
    const current = this.stats.equipment[item.slot];
    this.removeItem(item.uid);
    if (current && this.bagFull) {
      // Put it back — we can't unequip into a full bag.
      this.stats.inventory.push(item);
      return { previous: current, blocked: true };
    }
    this.stats.equipment[item.slot] = item;
    if (current) this.stats.inventory.push(current);
    this.clampHp();
    return { previous: current, blocked: false };
  }

  unequip(slot: EquipSlot): boolean {
    const current = this.stats.equipment[slot];
    if (!current) return false;
    if (this.bagFull) return false;
    this.stats.equipment[slot] = null;
    this.stats.inventory.push(current);
    this.clampHp();
    return true;
  }

  sellItem(uid: string): number {
    const item = this.removeItem(uid);
    if (!item) return 0;
    const value = this.sellValue(item);
    this.stats.gold += value;
    return value;
  }

  sellValue(item: ItemInstance): number {
    return Math.max(2, Math.round(item.power * SELL_RATE) + item.ilvl);
  }

  /** True when the item beats what's currently worn in its slot. */
  isUpgrade(item: ItemInstance): boolean {
    const current = this.stats.equipment[item.slot];
    return !current || item.power > current.power;
  }

  private clampHp() {
    this.stats.hp = Math.min(this.stats.hp, this.maxHp);
    if (this.stats.hp <= 0) this.stats.hp = 1;
  }

  /* ---------------------------------------------------------- consumables -- */

  consumableCount(id: string): number {
    return this.stats.consumables[id] ?? 0;
  }

  addConsumable(id: string, n = 1) {
    this.stats.consumables[id] = this.consumableCount(id) + n;
  }

  useConsumable(id: string): boolean {
    const have = this.consumableCount(id);
    if (have <= 0) return false;
    this.stats.consumables[id] = have - 1;
    return true;
  }
}

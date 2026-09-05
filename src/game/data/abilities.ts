/* ============================================================================
 * Ability content table — owned by the combat workstream.
 *
 * `CombatAbility` extends the shared `Ability` contract with the extra knobs
 * the engine needs. Anything reading only the shared fields still works.
 * ========================================================================== */

import type { Ability, StatusId } from '../types';

export type AbilityFx =
  | 'slash'
  | 'blunt'
  | 'pierce'
  | 'fire'
  | 'frost'
  | 'arcane'
  | 'poison'
  | 'shadow'
  | 'holy';

export interface StatusApplication {
  status: StatusId;
  stacks: number;
  turns: number;
  chance: number;
  onSelf?: boolean;
}

export interface CombatAbility extends Ability {
  /** Fraction of the target's defense ignored, 0..1. */
  pierce?: number;
  /** Extra damage multiplier at the target's lowest HP (linear with missing HP). */
  execute?: number;
  /** Shield granted to the caster as a multiple of their defense. */
  shieldFromDef?: number;
  /** Shield granted to the caster as a fraction of their max HP. */
  shieldFromHp?: number;
  /** Heal the caster for this fraction of their max HP. */
  healPct?: number;
  /** Bonus energy returned when used. */
  energyGain?: number;
  /** Extra lifesteal applied to this ability's damage only. */
  drain?: number;
  /** Removes all harmful statuses from the caster. */
  cleanse?: boolean;
  /** Second status application (e.g. damage + self-buff). */
  applies2?: StatusApplication;
  /** Crit chance bonus for this ability only. */
  critBonus?: number;
  /** Visual/audio flavour. */
  fx?: AbilityFx;
  /** Shown under the button when locked/derived from gear. */
  source?: string;
  applies?: StatusApplication;
}

/* -------------------------------------------------------------- the table -- */

export const ABILITIES: CombatAbility[] = [
  /* --- universal kit (always available) --- */
  {
    id: 'ab_power_strike',
    name: 'Power Strike',
    icon: '💥',
    description: 'A committed blow for 190% damage.',
    kind: 'attack',
    cost: 3,
    cooldown: 0,
    power: 1.9,
    fx: 'blunt',
    source: 'Innate'
  },
  {
    id: 'ab_second_wind',
    name: 'Second Wind',
    icon: '🌿',
    description: 'Heal 22% of max HP and gain Regen (2).',
    kind: 'heal',
    cost: 4,
    cooldown: 3,
    power: 0,
    healPct: 0.22,
    applies: { status: 'regen', stacks: 2, turns: 3, chance: 1, onSelf: true },
    fx: 'holy',
    source: 'Innate'
  },

  /* --- weapon-granted skills --- */
  {
    id: 'ab_rupture',
    name: 'Rupture',
    icon: '🩸',
    description: '130% damage and 2 stacks of Bleed.',
    kind: 'attack',
    cost: 3,
    cooldown: 1,
    power: 1.3,
    applies: { status: 'bleed', stacks: 2, turns: 3, chance: 1 },
    fx: 'slash'
  },
  {
    id: 'ab_flurry',
    name: 'Flurry',
    icon: '🌀',
    description: 'Three quick cuts of 75% damage each.',
    kind: 'attack',
    cost: 4,
    cooldown: 1,
    power: 0.75,
    hits: 3,
    fx: 'slash'
  },
  {
    id: 'ab_impale',
    name: 'Impale',
    icon: '🔱',
    description: '160% damage that ignores 70% of defense.',
    kind: 'attack',
    cost: 4,
    cooldown: 1,
    power: 1.6,
    pierce: 0.7,
    fx: 'pierce'
  },
  {
    id: 'ab_sunder',
    name: 'Sunder',
    icon: '🔨',
    description: '150% damage and Weaken (2) — the enemy hits softer.',
    kind: 'attack',
    cost: 4,
    cooldown: 2,
    power: 1.5,
    applies: { status: 'weaken', stacks: 2, turns: 3, chance: 1 },
    fx: 'blunt'
  },
  {
    id: 'ab_execute',
    name: 'Reaping Arc',
    icon: '☠️',
    description: '120% damage, up to 300% against a wounded foe.',
    kind: 'attack',
    cost: 5,
    cooldown: 2,
    power: 1.2,
    execute: 1.8,
    fx: 'shadow'
  },
  {
    id: 'ab_ignite',
    name: 'Ignite',
    icon: '🔥',
    description: '110% damage and 3 stacks of Burn.',
    kind: 'attack',
    cost: 4,
    cooldown: 1,
    power: 1.1,
    applies: { status: 'burn', stacks: 3, turns: 3, chance: 1 },
    fx: 'fire'
  },
  {
    id: 'ab_frostbind',
    name: 'Frostbind',
    icon: '❄️',
    description: '120% damage with a 55% chance to Stun.',
    kind: 'attack',
    cost: 5,
    cooldown: 3,
    power: 1.2,
    applies: { status: 'stun', stacks: 1, turns: 1, chance: 0.55 },
    fx: 'frost'
  },
  {
    id: 'ab_arcane_bolt',
    name: 'Arcane Bolt',
    icon: '🔮',
    description: '210% damage that ignores all defense.',
    kind: 'attack',
    cost: 5,
    cooldown: 1,
    power: 2.1,
    pierce: 1,
    fx: 'arcane'
  },
  {
    id: 'ab_venom_strike',
    name: 'Venom Strike',
    icon: '🐍',
    description: '100% damage and 4 stacks of Poison.',
    kind: 'attack',
    cost: 3,
    cooldown: 1,
    power: 1.0,
    applies: { status: 'poison', stacks: 4, turns: 4, chance: 1 },
    fx: 'poison'
  },
  {
    id: 'ab_drain',
    name: 'Life Drain',
    icon: '🧛',
    description: '130% damage, healing you for 60% of it.',
    kind: 'attack',
    cost: 4,
    cooldown: 1,
    power: 1.3,
    drain: 0.6,
    fx: 'shadow'
  },
  {
    id: 'ab_smite',
    name: 'Smite',
    icon: '⚡',
    description: '170% damage with +35% crit chance.',
    kind: 'attack',
    cost: 4,
    cooldown: 1,
    power: 1.7,
    critBonus: 0.35,
    fx: 'holy'
  },
  {
    id: 'ab_whirlwind',
    name: 'Whirlwind',
    icon: '🌪️',
    description: 'Two sweeps of 110% and Weaken (1).',
    kind: 'attack',
    cost: 5,
    cooldown: 2,
    power: 1.1,
    hits: 2,
    applies: { status: 'weaken', stacks: 1, turns: 2, chance: 0.8 },
    fx: 'slash'
  },
  {
    id: 'ab_void_lance',
    name: 'Void Lance',
    icon: '🌑',
    description: '240% damage ignoring 80% defense. Costly.',
    kind: 'attack',
    cost: 6,
    cooldown: 2,
    power: 2.4,
    pierce: 0.8,
    fx: 'shadow'
  },
  {
    id: 'ab_starfall',
    name: 'Starfall',
    icon: '⭐',
    description: 'Four falling shards of 70% damage each.',
    kind: 'attack',
    cost: 6,
    cooldown: 2,
    power: 0.7,
    hits: 4,
    fx: 'arcane'
  },

  /* --- defensive / utility skills (offhand, armor, trinket) --- */
  {
    id: 'ab_bulwark',
    name: 'Bulwark',
    icon: '🛡️',
    description: 'Shield for 2x defense + 10% max HP, and Fortify (2).',
    kind: 'defend',
    cost: 3,
    cooldown: 2,
    power: 0,
    shieldFromDef: 2,
    shieldFromHp: 0.1,
    applies: { status: 'fortify', stacks: 2, turns: 2, chance: 1, onSelf: true },
    fx: 'holy'
  },
  {
    id: 'ab_cleanse',
    name: 'Purify',
    icon: '✨',
    description: 'Clears every harmful effect and heals 10%.',
    kind: 'heal',
    cost: 3,
    cooldown: 3,
    power: 0,
    healPct: 0.1,
    cleanse: true,
    fx: 'holy'
  },
  {
    id: 'ab_battle_fury',
    name: 'Battle Fury',
    icon: '😤',
    description: 'Enrage (3) — +25% damage per stack for 3 turns.',
    kind: 'buff',
    cost: 4,
    cooldown: 4,
    power: 0,
    applies: { status: 'enrage', stacks: 3, turns: 3, chance: 1, onSelf: true },
    energyGain: 1,
    fx: 'fire'
  },
  {
    id: 'ab_focus',
    name: 'Focus',
    icon: '🧿',
    description: 'Restore 4 energy and Fortify (1).',
    kind: 'buff',
    cost: 0,
    cooldown: 3,
    power: 0,
    energyGain: 4,
    applies: { status: 'fortify', stacks: 1, turns: 2, chance: 1, onSelf: true },
    fx: 'arcane'
  }
];

const BY_ID = new Map(ABILITIES.map(a => [a.id, a]));

export function abilityById(id: string | undefined | null): CombatAbility | null {
  if (!id) return null;
  return BY_ID.get(id) ?? null;
}

/* ------------------------------------------------ gear → ability fallbacks -- */

/**
 * Weapon families map to a signature skill. Used when a base item does not
 * declare `abilityId` (the items table is owned by another workstream, so we
 * must never depend on it having one).
 */
const WEAPON_ABILITY: Record<string, string> = {
  w_fists: 'ab_flurry',
  w_dagger: 'ab_rupture',
  w_shortsword: 'ab_flurry',
  w_axe: 'ab_rupture',
  w_spear: 'ab_impale',
  w_hammer: 'ab_sunder',
  w_bow: 'ab_impale',
  w_claws: 'ab_venom_strike',
  w_scythe: 'ab_execute',
  w_blade: 'ab_whirlwind',
  w_staff: 'ab_arcane_bolt',
  w_gauntlet: 'ab_sunder',
  w_flail: 'ab_whirlwind',
  w_katana: 'ab_flurry',
  w_trident: 'ab_impale',
  w_warpick: 'ab_impale',
  w_chakram: 'ab_drain',
  w_glaive: 'ab_frostbind',
  w_wand: 'ab_ignite',
  w_cutlass: 'ab_rupture',
  w_maul: 'ab_sunder',
  w_rapier: 'ab_flurry',
  w_greataxe: 'ab_execute',
  w_voidblade: 'ab_void_lance',
  w_sceptre: 'ab_arcane_bolt',
  w_lance: 'ab_smite',
  w_reaper: 'ab_execute',
  w_starforge: 'ab_starfall'
};

/** Keyword fallbacks so unknown/new weapon ids still grant something sensible. */
const KEYWORD_ABILITY: [RegExp, string][] = [
  [/dagger|knife|shiv|razor|rapier|katana|sword|blade|cutlass|sabre/, 'ab_rupture'],
  [/axe|maul|hammer|club|pick|mace/, 'ab_sunder'],
  [/spear|lance|trident|pike|bow|javelin/, 'ab_impale'],
  [/staff|wand|sceptre|rod|orb|tome/, 'ab_arcane_bolt'],
  [/scythe|reaper|death|bone/, 'ab_execute'],
  [/claw|fang|venom|snake/, 'ab_venom_strike'],
  [/frost|ice|glacier/, 'ab_frostbind'],
  [/ember|flame|fire|burn/, 'ab_ignite'],
  [/void|shadow|night|dark/, 'ab_void_lance'],
  [/star|dawn|light|holy/, 'ab_smite']
];

export function weaponAbilityId(baseId: string | null | undefined): string {
  if (!baseId) return 'ab_flurry';
  const direct = WEAPON_ABILITY[baseId];
  if (direct) return direct;
  const lower = baseId.toLowerCase();
  for (const [re, id] of KEYWORD_ABILITY) if (re.test(lower)) return id;
  return 'ab_power_strike';
}

/** Offhand/armor/trinket families map to a support skill. */
export function supportAbilityId(baseId: string | null | undefined): string | null {
  if (!baseId) return null;
  const lower = baseId.toLowerCase();
  if (/shield|bulwark|aegis|guard|plate|bastion|tower/.test(lower)) return 'ab_bulwark';
  if (/charm|idol|relic|talisman|holy|tear|phoenix/.test(lower)) return 'ab_cleanse';
  if (/horn|fang|warband|dragon|crown|king|titan/.test(lower)) return 'ab_battle_fury';
  if (/orb|gem|rune|shard|hourglass|star/.test(lower)) return 'ab_focus';
  return null;
}

/* ---------------------------------------------------------------- statuses -- */

export interface StatusInfo {
  id: StatusId;
  name: string;
  icon: string;
  harmful: boolean;
  color: string;
  description: string;
}

export const STATUS_INFO: Record<StatusId, StatusInfo> = {
  poison: {
    id: 'poison',
    name: 'Poison',
    icon: '☠️',
    harmful: true,
    color: '#8ce05a',
    description: 'Damage each turn, ignores armour.'
  },
  burn: {
    id: 'burn',
    name: 'Burn',
    icon: '🔥',
    harmful: true,
    color: '#ff8a3d',
    description: 'Heavy damage each turn, burns out fast.'
  },
  bleed: {
    id: 'bleed',
    name: 'Bleed',
    icon: '🩸',
    harmful: true,
    color: '#ff4d6d',
    description: 'Damage each turn, worse when acting.'
  },
  stun: {
    id: 'stun',
    name: 'Stun',
    icon: '💫',
    harmful: true,
    color: '#ffd93d',
    description: 'Loses its next turn.'
  },
  weaken: {
    id: 'weaken',
    name: 'Weaken',
    icon: '🔻',
    harmful: true,
    color: '#b07cff',
    description: '-15% damage dealt per stack.'
  },
  shield: {
    id: 'shield',
    name: 'Shield',
    icon: '🛡️',
    harmful: false,
    color: '#7c9cff',
    description: 'Absorbs incoming damage.'
  },
  fortify: {
    id: 'fortify',
    name: 'Fortify',
    icon: '🧱',
    harmful: false,
    color: '#4fd8c4',
    description: '+25% defense per stack.'
  },
  regen: {
    id: 'regen',
    name: 'Regen',
    icon: '💚',
    harmful: false,
    color: '#5ee88f',
    description: 'Heals each turn.'
  },
  enrage: {
    id: 'enrage',
    name: 'Enrage',
    icon: '😤',
    harmful: false,
    color: '#ff6b3d',
    description: '+25% damage dealt per stack.'
  }
};
